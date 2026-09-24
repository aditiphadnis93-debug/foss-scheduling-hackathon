// Judge day profiles: when the court sits, when the judge does administrative work, and the guardrails.
// Source order: run.meta.profile_report (engine) -> meta.config_detail.day_profile -> preset mirror -> single window.
import type { Run } from "./types";

export const GUARDRAILS = {
  minWeekly: 1050, // average of at least 3.5 hours of hearings per sitting day
  minDay: 120,
  maxDay: 420,
  norm: 360, // the reference 6-hour day
};

export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri"] as const;
export const WEEKDAY_LABEL: Record<string, string> = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri" };

export type Win = [number, number]; // minutes after midnight
export type DayShape = { weekday: string; sittings: Win[]; admin: Win[]; sitting_minutes: number; admin_minutes: number };
export type Week = { days: DayShape[]; weekly: number; vsNormPct: number; source: "engine" | "config" | "preset" | "default" };

type RawWin = [string, string] | [number, number] | { start: string | number; end: string | number };
export type DayProfile = Record<string, { sittings?: RawWin[]; admin?: RawWin[] }>;

// Mirrors config/morning_bench.yaml and config/marathon_bench.yaml until their runs carry config_detail.
const PRESET_PROFILES: Record<string, DayProfile> = {
  morning_bench: { default: { sittings: [["10:15", "13:45"]], admin: [["14:30", "17:00"]] } },
  marathon_bench: {
    default: { sittings: [["10:30", "17:30"]] },
    fri: { sittings: [["10:30", "13:30"]], admin: [["14:00", "17:00"]] },
  },
};

export function toMinutes(t: string | number): number {
  if (typeof t === "number") return t;
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m || 0);
}
export function hhmm(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(Math.round(m % 60)).padStart(2, "0")}`;
}

function win(w: RawWin): Win {
  if (Array.isArray(w)) return [toMinutes(w[0]), toMinutes(w[1])];
  return [toMinutes(w.start), toMinutes(w.end)];
}

const sum = (ws: Win[]) => ws.reduce((s, [a, b]) => s + Math.max(0, b - a), 0);

export function weekFromProfile(profile: DayProfile | null, dayStart = "10:30", dayMinutes = 420, source: Week["source"] = "config"): Week {
  const days: DayShape[] = WEEKDAYS.map((wd) => {
    const p = profile ? profile[wd] ?? profile.default : undefined;
    const sittings = p?.sittings?.length ? p.sittings.map(win) : [[toMinutes(dayStart), toMinutes(dayStart) + dayMinutes] as Win];
    const admin = (p?.admin ?? []).map(win);
    return { weekday: wd, sittings, admin, sitting_minutes: sum(sittings), admin_minutes: sum(admin) };
  });
  const weekly = days.reduce((s, d) => s + d.sitting_minutes, 0);
  return { days, weekly, vsNormPct: (100 * weekly) / (5 * GUARDRAILS.norm), source: profile ? source : "default" };
}

type Report = { days: { weekday: string; sittings: RawWin[]; admin: RawWin[]; sitting_minutes: number; admin_minutes: number }[]; weekly_sitting_minutes: number; vs_norm_pct?: number };

export function weekOf(run: Run | null | undefined, preset?: string): Week {
  const rep = (run?.meta as (Run["meta"] & { profile_report?: Report }) | undefined)?.profile_report;
  if (rep?.days?.length) {
    const days = rep.days.map((d) => ({
      weekday: d.weekday,
      sittings: (d.sittings ?? []).map(win),
      admin: (d.admin ?? []).map(win),
      sitting_minutes: d.sitting_minutes,
      admin_minutes: d.admin_minutes ?? 0,
    }));
    const weekly = rep.weekly_sitting_minutes ?? days.reduce((s, d) => s + d.sitting_minutes, 0);
    return { days, weekly, vsNormPct: rep.vs_norm_pct ?? (100 * weekly) / (5 * GUARDRAILS.norm), source: "engine" };
  }
  const det = run?.meta?.config_detail ?? {};
  const dayStart = String(det.day_start ?? "10:30");
  const dayMinutes = Number(det.day_minutes ?? 420);
  const prof = det.day_profile as DayProfile | undefined;
  if (prof && Object.keys(prof).length) return weekFromProfile(prof, dayStart, dayMinutes, "config");
  const name = preset ?? run?.meta?.config;
  if (name && PRESET_PROFILES[name]) return weekFromProfile(PRESET_PROFILES[name], dayStart, dayMinutes, "preset");
  return weekFromProfile(null, dayStart, dayMinutes, "default");
}

/** Client-side mirror of config.check_day_profile. Empty list = valid. */
export function validateWeek(w: Week): string[] {
  const errs: string[] = [];
  for (const d of w.days) {
    const s = [...d.sittings].sort((a, b) => a[0] - b[0]);
    if (s.some(([a, b]) => b <= a) || s.some((x, i) => i < s.length - 1 && x[1] > s[i + 1][0]))
      errs.push(`${WEEKDAY_LABEL[d.weekday]}: sittings overlap or end before they start`);
    if (d.sitting_minutes < GUARDRAILS.minDay || d.sitting_minutes > GUARDRAILS.maxDay)
      errs.push(`${WEEKDAY_LABEL[d.weekday]}: ${d.sitting_minutes} sitting minutes (allowed ${GUARDRAILS.minDay}-${GUARDRAILS.maxDay})`);
    for (const a of d.admin) if (s.some(([x, y]) => a[0] < y && a[1] > x)) errs.push(`${WEEKDAY_LABEL[d.weekday]}: admin time overlaps a sitting`);
  }
  if (w.weekly < GUARDRAILS.minWeekly)
    errs.push(`Week: ${(w.weekly / 60).toFixed(1)} h of sittings is below the ${(GUARDRAILS.minWeekly / 60).toFixed(1)} h minimum (3.5 h a day on average)`);
  return [...new Set(errs)];
}

export function toProfile(defaultDay: { sittings: Win[]; admin: Win[] }): DayProfile {
  return { default: { sittings: defaultDay.sittings.map(([a, b]) => [hhmm(a), hhmm(b)]), admin: defaultDay.admin.map(([a, b]) => [hhmm(a), hhmm(b)]) } };
}
