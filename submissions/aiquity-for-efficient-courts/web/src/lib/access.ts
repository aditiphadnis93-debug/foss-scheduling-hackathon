// What people see, and what they can do. Mirrors src/causelist/access.py; uses run.access when the
// engine exports it, otherwise derives the same numbers from the day records with the same assumptions.
import type { Run } from "./types";
import { toMin } from "./format";

export const TRAVEL_HOURS = 2.0; // round trip to court, per person per listing
export const ALL_DAY_WAIT_HOURS = 5.0; // waiting without a time window
export const PEOPLE_PER_LISTING = 2; // one person for each side

export type PartyBurden = { party: string; trips: number; wasted: number; hours: number; moved: number };
export type Access = {
  visibility: {
    date_certainty_pct: number;
    time_window_pct: number;
    prerequisites_known_in_advance_pct: number;
    reason_shown_pct: number;
    prerequisites_foreseen: number;
    prerequisites_failed_on_the_day: number;
    prerequisites_count_estimated?: boolean;
  };
  possibility: {
    life_hours_total: number;
    life_hours_per_hearing_moved: number;
    wasted_trips: number;
    wasted_trip_pct: number;
    mean_wait_hours: number;
    actions_open: string[];
  };
  assumptions: { travel_hours: number; all_day_wait_hours: number; people_per_listing: number };
  parties_most_burdened: PartyBurden[];
  derived?: boolean;
};

export const ALL_ACTIONS = [
  "confirm readiness ahead (check-in)",
  "told of a missing prerequisite before travelling",
  "real appointment window",
  "short, firm date after a time request",
  "date published days ahead",
];

const r1 = (x: number) => Math.round(x * 10) / 10;

export function accessOf(run: Run): Access {
  const own = (run as Run & { access?: Access }).access;
  if (own?.visibility && own?.possibility) return own;
  const det = run.meta.config_detail ?? {};
  const baseline = run.meta.planner === "baseline";
  const windows = Boolean(det.give_appointments ?? true) && !baseline;
  const useReadiness = Boolean(det.use_readiness ?? true);
  const visibility = Number(det.readiness_visibility ?? 0.8);
  let listed = 0, called = 0, withWindow = 0, onDay = 0, foreseen = 0, wasted = 0, trips = 0, moved = 0, wait = 0;
  const by = new Map<string, PartyBurden>();
  for (const d of run.days) {
    foreseen += d.held_back.filter((h) => h.reason.startsWith("prerequisite") || h.reason.startsWith("checklist")).length;
    for (const l of d.listings) {
      const o = l.outcome;
      if (!o) continue;
      listed += 1;
      trips += PEOPLE_PER_LISTING;
      if (o.kind !== "not_reached") called += 1;
      const w = windows ? Math.max(0.25, (toMin(l.end) - toMin(l.start)) / 60) / 2 : ALL_DAY_WAIT_HOURS;
      if (windows) withWindow += 1;
      wait += w * PEOPLE_PER_LISTING;
      if (o.kind === "not_ready") onDay += 1;
      if (o.kind === "substantive") moved += 1;
      else wasted += PEOPLE_PER_LISTING;
      const key = run.cases?.[l.case_id]?.party ?? l.case_id;
      const p = by.get(key) ?? { party: key, trips: 0, wasted: 0, hours: 0, moved: 0 };
      p.trips += 1;
      p.wasted += o.kind !== "substantive" ? 1 : 0;
      p.hours += TRAVEL_HOURS + w;
      p.moved += o.kind === "substantive" ? 1 : 0;
      by.set(key, p);
    }
  }
  let estimated = false;
  if (!foreseen && useReadiness && !baseline && onDay) {
    foreseen = Math.round((onDay * visibility) / Math.max(1e-6, 1 - visibility));
    estimated = true;
  }
  const life = trips * TRAVEL_HOURS + wait;
  const parties = [...by.values()].map((p) => ({ ...p, hours: r1(p.hours) })).sort((a, b) => b.hours - a.hours);
  const on = [!baseline, useReadiness && !baseline, windows, !baseline, Boolean(det.use_horizon) && !baseline];
  return {
    visibility: {
      date_certainty_pct: r1((100 * called) / Math.max(listed, 1)),
      time_window_pct: r1((100 * withWindow) / Math.max(listed, 1)),
      prerequisites_known_in_advance_pct: r1((100 * foreseen) / Math.max(foreseen + onDay, 1)),
      reason_shown_pct: baseline ? 0 : 100,
      prerequisites_foreseen: foreseen,
      prerequisites_failed_on_the_day: onDay,
      prerequisites_count_estimated: estimated,
    },
    possibility: {
      life_hours_total: Math.round(life),
      life_hours_per_hearing_moved: r1(life / Math.max(moved, 1)),
      wasted_trips: wasted,
      wasted_trip_pct: r1((100 * wasted) / Math.max(trips, 1)),
      mean_wait_hours: Math.round((wait / Math.max(trips, 1)) * 100) / 100,
      actions_open: ALL_ACTIONS.filter((_, i) => on[i]),
    },
    assumptions: { travel_hours: TRAVEL_HOURS, all_day_wait_hours: ALL_DAY_WAIT_HOURS, people_per_listing: PEOPLE_PER_LISTING },
    parties_most_burdened: parties.slice(0, 25),
    derived: true,
  };
}

export function hoursSaved(ours: Access, base: Access): number {
  return base.possibility.life_hours_total - ours.possibility.life_hours_total;
}
