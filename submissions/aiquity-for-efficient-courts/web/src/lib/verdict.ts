import { direction } from "./metrics";

type M = Record<string, number | undefined>;

const PHRASE: Record<string, [string, "pts" | "days" | "n" | "min"]> = {
  utilisation_pct: ["court time well used", "pts"],
  reach_rate_pct: ["matters called on the day given", "pts"],
  substantive_pct_of_heard: ["matters that moved forward", "pts"],
  backlog_4y_heard_pct: ["4+ year cases heard", "pts"],
  predictability_gap_days: ["the wait to be heard", "days"],
  old_minutes_share_pct: ["minutes on the oldest cases", "pts"],
  justice_weighted_progress_per_hour: ["progress per court hour", "n"],
  next_date_sane_pct: ["sane next dates", "pts"],
};

function amount(d: number, u: string): string {
  const a = Math.abs(d);
  if (u === "pts") return `${a.toFixed(1)} pts`;
  if (u === "days") return `${a.toFixed(1)} days`;
  if (u === "min") return `${a.toFixed(0)} min`;
  return a < 10 ? a.toFixed(2) : a.toFixed(0);
}

/** One plain-language sentence: what the judge changed, what it gained, what it cost. */
export function verdictLine(changes: string[], base: M, mod: M, days: number): string {
  const goods: string[] = [];
  const bads: string[] = [];
  for (const [k, [label, u]] of Object.entries(PHRASE)) {
    const a = mod[k];
    const b = base[k];
    if (a === undefined || b === undefined) continue;
    const d = a - b;
    const tiny = u === "n" ? Math.abs(d) < 0.005 : Math.abs(d) < 0.3;
    if (tiny) continue;
    const s = `${d > 0 ? "raises" : "lowers"} ${label} by ${amount(d, u)}`;
    (d * direction(k) > 0 ? goods : bads).push(s);
  }
  const unreachedBase = perDay(base, "reach_rate_pct");
  const unreachedMod = perDay(mod, "reach_rate_pct");
  if (unreachedBase !== null && unreachedMod !== null) {
    const d = unreachedMod - unreachedBase;
    if (Math.abs(d) >= 0.1) {
      const s = `${Math.abs(d).toFixed(1)} ${d > 0 ? "more" : "fewer"} matters per day go home unreached`;
      (d > 0 ? bads : goods).push(s);
    }
  }
  const trips = (mod.advocate_trips ?? 0) - (base.advocate_trips ?? 0);
  if (Math.abs(trips) >= 1) {
    (trips > 0 ? bads : goods).push(`advocates make ${Math.abs(trips).toFixed(0)} ${trips > 0 ? "more" : "fewer"} trips to court`);
  }
  const subject = changes.length ? cap(changes.join(", ")) : "The unchanged setup";
  const g = goods.slice(0, 3);
  const b = bads.slice(0, 3);
  if (g.length && b.length) return `${subject} ${g.join(", ")}, but ${b.join(", ")}.`;
  if (g.length) return `${subject} ${g.join(", ")}, with no measured cost over ${days} sitting days.`;
  if (b.length) return `${subject} ${b.join(", ")}, with no measured gain over ${days} sitting days.`;
  return `${subject} makes no measurable difference over ${days} sitting days.`;
}

function perDay(m: M, reachKey: string): number | null {
  const reach = m[reachKey];
  const listed = m.listed_per_day;
  if (reach === undefined || listed === undefined) return null;
  return listed * (1 - reach / 100);
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
