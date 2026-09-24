"use client";

import { fetchIndex, fetchRun, preferredRoster } from "./data";
import type { Roster } from "./types";

/** Headline metrics for ours vs current practice; 3,000 roster when present, else the 100 sample. */
export async function headline(): Promise<{
  roster: Roster;
  ours: Record<string, number>;
  base: Record<string, number>;
  sittingDays?: number;
} | null> {
  const roster = await preferredRoster(["optimal", "baseline"]);
  const idx = await fetchIndex();
  const pick = async (config: string) => {
    const s = idx?.scenarios.find((x) => x.roster === roster && x.config === config);
    if (s?.metrics) return s.metrics;
    return (await fetchRun(roster, config))?.metrics ?? null;
  };
  const [ours, base] = await Promise.all([pick("optimal"), pick("baseline")]);
  if (!ours || !base) return null;
  return { roster, ours, base, sittingDays: ours.sitting_days };
}

/** Hours of people's lives saved vs current practice (travel + waiting), read from the runs. */
export async function livesSaved(): Promise<{ roster: string; hours: number; trips: number; days: number } | null> {
  const { accessOf, hoursSaved } = await import("./access");
  const roster = await preferredRoster(["optimal", "baseline"]);
  const [o, b] = await Promise.all([fetchRun(roster, "optimal"), fetchRun(roster, "baseline")]);
  if (!o || !b) return null;
  const ao = accessOf(o);
  const ab = accessOf(b);
  return { roster, hours: hoursSaved(ao, ab), trips: ab.possibility.wasted_trips - ao.possibility.wasted_trips, days: o.meta.sitting_days };
}
