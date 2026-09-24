// Metric catalogue: labels, direction, units, and the five scored dimensions.
// Unknown keys render generically; nothing here throws on a missing key.

export type MetricMeta = { label: string; unit?: "%" | "days" | "min" | ""; dim?: string; blurb?: string };

export const SCORED = [
  "utilisation_pct",
  "predictability_gap_days",
  "substantive_pct_of_heard",
  "backlog_4y_heard_pct",
  "next_date_sane_pct",
] as const;

export const LOWER_IS_BETTER = new Set([
  "predictability_gap_days",
  "next_date_mean_gap_days",
  "cases_5y_pending_end",
  "advocate_trips",
  "idle_minutes_per_day",
  "overrun_minutes_per_day",
]);

export const NEUTRAL = new Set(["listed_total", "listed_per_day", "sitting_days", "cases_5y_pending_start"]);

export const METRICS: Record<string, MetricMeta> = {
  utilisation_pct: { label: "Court time well used", unit: "%", dim: "Court time",
    blurb: "Share of the 420 court minutes spent on hearings that actually happened." },
  predictability_gap_days: { label: "Days from first listing to hearing", unit: "days", dim: "Predictability",
    blurb: "Days from a matter's first listing to the day it is actually heard." },
  substantive_pct_of_heard: { label: "Matters that moved forward", unit: "%", dim: "Moved forward",
    blurb: "Of hearings that took place, the share that moved the case forward." },
  backlog_4y_heard_pct: { label: "Cases over 4 years old heard", unit: "%", dim: "Oldest cases",
    blurb: "Share of cases pending four years or more that were heard at all." },
  next_date_sane_pct: { label: "Next dates that fit the next step", unit: "%", dim: "Next date",
    blurb: "Next dates that fit the procedural need of the next step." },
  reach_rate_pct: { label: "Called on the day given", unit: "%" },
  heard_on_first_listing_pct: { label: "Heard on first listing", unit: "%" },
  next_date_mean_gap_days: { label: "Mean next-date gap", unit: "days" },
  eju_pct: { label: "Court time on hearings that moved", unit: "%" },
  justice_weighted_progress_per_hour: { label: "Progress per court hour (weighted for age)" },
  disposed: { label: "Cases disposed" },
  cases_5y_pending_start: { label: "5+ yr pending at start" },
  cases_5y_pending_end: { label: "5+ yr pending at end" },
  substantive_total: { label: "Hearings that moved the case" },
  heard_total: { label: "Hearings heard" },
  listed_total: { label: "Matters listed" },
  listed_per_day: { label: "Listed per day" },
  advocate_trips: { label: "Advocate trips" },
  hearings_per_advocate_trip: { label: "Hearings per advocate trip" },
  idle_minutes_per_day: { label: "Idle minutes / day", unit: "min" },
  overrun_minutes_per_day: { label: "Overrun minutes / day", unit: "min" },
  old_minutes_share_pct: { label: "Court time on cases over 4 years old", unit: "%" },
  sitting_days: { label: "Sitting days" },
};

export function meta(key: string): MetricMeta {
  return METRICS[key] ?? { label: key.replace(/_/g, " ").replace(/\bpct\b/, "%") };
}

export function unitOf(key: string): string {
  const u = METRICS[key]?.unit;
  if (u) return u;
  if (key.endsWith("_pct")) return "%";
  if (key.endsWith("_days")) return "days";
  return "";
}

/** +1 higher is better, -1 lower is better, 0 neutral. */
export function direction(key: string): 1 | -1 | 0 {
  if (NEUTRAL.has(key)) return 0;
  return LOWER_IS_BETTER.has(key) ? -1 : 1;
}

export function decimals(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (Number.isInteger(v)) return 0;
  return Math.abs(v) < 10 ? (Math.abs(v) < 1 ? 3 : 2) : 1;
}

export function fmtNum(v: number | undefined | null, d?: number): string {
  if (v === undefined || v === null || !Number.isFinite(v)) return "--";
  const dd = d ?? decimals(v);
  return v.toLocaleString("en-IN", { minimumFractionDigits: dd, maximumFractionDigits: dd });
}

export function fmtMetric(key: string, v: number | undefined | null): string {
  if (v === undefined || v === null || !Number.isFinite(v)) return "--";
  const u = unitOf(key);
  const d = u === "%" || u === "days" || u === "min" ? 1 : undefined;
  return `${fmtNum(v, d)}${u === "%" ? "%" : u ? ` ${u}` : ""}`;
}

export function fmtDelta(key: string, a: number | undefined, b: number | undefined): string {
  if (a === undefined || b === undefined || !Number.isFinite(a) || !Number.isFinite(b)) return "";
  const d = a - b;
  const u = unitOf(key);
  const dd = Number.isInteger(a) && Number.isInteger(b) ? 0 : u ? 1 : decimals(d);
  const s = `${d >= 0 ? "+" : "-"}${fmtNum(Math.abs(d), dd)}`;
  return `${s}${u === "%" ? " pts" : u ? ` ${u}` : ""}`;
}

/** "good" | "bad" | "flat" | "neutral" for colouring a delta. */
export function deltaTone(key: string, a?: number, b?: number): "good" | "bad" | "flat" | "neutral" {
  if (a === undefined || b === undefined) return "neutral";
  const dir = direction(key);
  if (Math.abs(a - b) < 1e-9) return "flat";
  if (dir === 0) return "neutral";
  return (a - b) * dir > 0 ? "good" : "bad";
}

export function orderedKeys(keys: Iterable<string>): string[] {
  const all = Array.from(new Set(keys));
  const known = Object.keys(METRICS);
  return [
    ...SCORED.filter((k) => all.includes(k)),
    ...known.filter((k) => !(SCORED as readonly string[]).includes(k) && all.includes(k)),
    ...all.filter((k) => !known.includes(k)).sort(),
  ];
}
