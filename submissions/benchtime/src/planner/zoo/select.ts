// The day's selection for the zoo: how each case is scored (the knapsack value, the index, P per minute,
// age, freshness, promise order, the simple rule's bands) and how the list is filled from the scores
// (exact knapsack with the floor, greedy in rank order with the floor, or the portfolio's budgets).

import { ageYears, daysBetween } from "../../data/calendar";
import { stageIndex } from "../../domain/lifecycle";
import type { CaseView, HearingType, PlanContext } from "../../domain/types";
import { solveKnapsack, clusterByAdvocate, type KnapsackItem } from "../knapsack";
import { closeness, type PopulationStats } from "../predict";
import type { Estimate } from "./estimate";
import { progress } from "./estimate";
import type { Genome, Selection } from "./genome";

export interface Cand {
  view: CaseView;
  est: Estimate;
  age: number;
  old: boolean;
  /** knapsack value (always > 0) */
  value: number;
  /** the index redesign's priority per expected minute */
  index: number;
  /** "ready", or a desk or released matter competing for a short review call */
  kind: "ready" | "desk" | "released";
  why: string[];
}

/** days since the case was last before the bench (reached), or since it first came up */
export function daysUnseen(view: CaseView, date: string): number {
  for (let i = view.history.length - 1; i >= 0; i--) {
    const h = view.history[i]!;
    if (h.outcome === "substantive" || h.outcome === "failed") return daysBetween(h.date, date);
  }
  const first = view.history[0]?.date ?? view.firstScheduledOn ?? date;
  return Math.max(0, daysBetween(first < date ? first : date, date));
}

/** true when the case has been before the bench (reached) in the horizon */
export const heardInHorizon = (v: CaseView): boolean => v.history.some((h) => h.outcome === "substantive" || h.outcome === "failed");

/** Score one case: the knapsack value and the index, both from the genome's weights. */
export function score(view: CaseView, est: Estimate, ctx: PlanContext, g: Genome, stats: PopulationStats, kind: Cand["kind"] = "ready"): Cand {
  const w = g.weights;
  const p = est.p;
  const age = ageYears(view.filingDate, ctx.date);
  const ageTerm = Math.pow(Math.max(Math.min(age, 10), 0.25) / 4, g.ageExponent);
  const prog = progress(view, ctx.ref);
  const why = [...est.why];
  let broken = 0;
  for (const h of view.history) if (h.outcome === "deferred" || h.outcome === "not_reached") broken++;
  // knapsack value: progress toward disposal x P x age, stuck and last-chance weights, promises, trips
  const median = ctx.ref[view.nextPurpose].hearingsPerCase.median;
  const over = Math.max(0, view.hearingsAtPurpose - median) / Math.max(1, median);
  const stuckW = 1 + 0.5 * Math.min(1, over);
  const lcW = view.lastSummary.lastChance ? 1.25 : 1;
  const gain = 1 + 3 * w.throughput * closeness(view) + w.disposal * prog;
  const ageW = 1 + 0.8 * w.fairness * ageTerm;
  let value = p * gain * ageW * stuckW * lcW;
  if (view.nextDate !== null && view.nextDate <= ctx.date) value += 0.3 * w.predictability;
  if (broken > 0) value += Math.min(1, 0.2 * broken) * w.predictability;
  value -= 0.15 * w.trips * (1 - p);
  value = Math.max(0.01 * ageW, value);
  // the index: (useful hearing + disposal progress + waiting cost stopped - wasted trips) per minute
  const unseen = daysUnseen(view, ctx.date) > 7 || !heardInHorizon(view) ? 1 : 0;
  const wait = 0.5 * w.fairness * ageTerm * (1 + 0.5 * w.predictability * Math.min(broken, 4)) * (p + 0.5 * (1 - p) * unseen);
  const trips = stats.roleRate.complainant + stats.roleRate.complainantAdvocate + stats.roleRate.accused + stats.roleRate.accusedAdvocate;
  const index = (p * (w.throughput + w.disposal * prog) + wait - 0.1 * w.trips * (1 - p) * trips) / Math.max(0.5, est.minutes);
  if (age >= 4) why.push(`${age.toFixed(1)} years old`);
  if (broken > 0) why.push(`put off ${broken} time${broken > 1 ? "s" : ""} before`);
  if (prog === 1) why.push("a substantive hearing can dispose of the case");
  return { view, est, age, old: age >= 4, value, index, kind, why };
}

const byFilingThenId = (a: CaseView, b: CaseView): number =>
  a.filingDate < b.filingDate ? -1 : a.filingDate > b.filingDate ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
const byId = (a: Cand, b: Cand): number => (a.view.id < b.view.id ? -1 : a.view.id > b.view.id ? 1 : 0);
const JUDGMENT_FIRST = new Set<HearingType>(["JUDGEMENT", "ARGUMENTS"]);

/** The rank order each selection rule implies (also the first-date order for the "priority" rule). */
export function rankCands(sel: Selection, xs: Cand[]): Cand[] {
  const a = [...xs];
  switch (sel) {
    case "index":
      return a.sort((x, y) => y.index - x.index || byId(x, y));
    case "ppm":
      return a.sort((x, y) => y.est.p / y.est.minutes - x.est.p / x.est.minutes || byFilingThenId(x.view, y.view));
    case "oldest":
      return a.sort((x, y) => byFilingThenId(x.view, y.view));
    case "youngest":
      return a.sort((x, y) => stageIndex(x.view.stage) - stageIndex(y.view.stage) || (x.view.filingDate > y.view.filingDate ? -1 : x.view.filingDate < y.view.filingDate ? 1 : byId(x, y)));
    case "fifo":
      return a.sort((x, y) => {
        const dx = x.view.nextDate ?? "";
        const dy = y.view.nextDate ?? "";
        return dx < dy ? -1 : dx > dy ? 1 : byFilingThenId(x.view, y.view);
      });
    case "simple": {
      const first = (x: Cand) => (x.old || JUDGMENT_FIRST.has(x.view.nextPurpose) ? 1 : 0);
      const band = (x: Cand) => Math.floor(x.est.p / 0.1 + 1e-9);
      return a.sort((x, y) => first(y) - first(x) || band(y) - band(x) || byFilingThenId(x.view, y.view));
    }
    case "listAll":
      return a;
    default:
      // knapsack and portfolio: value per expected minute
      return a.sort((x, y) => y.value / Math.max(0.5, y.est.minutes) - x.value / Math.max(0.5, x.est.minutes) || byId(x, y));
  }
}

/** Greedy in rank order: the floor share to 4+ year cases first (in rank order), then the rest to the cap. */
export function greedyWithFloor(ranked: Cand[], cap: number, floorShare: number, oldOrder?: (a: Cand, b: Cand) => number): { chosen: Cand[]; floorPicks: Set<string> } {
  const chosen: Cand[] = [];
  const floorPicks = new Set<string>();
  let used = 0;
  if (floorShare > 0) {
    const olds = ranked.filter((x) => x.old);
    if (oldOrder) olds.sort(oldOrder);
    for (const x of olds) {
      if (used >= floorShare * cap) break;
      if (used + x.est.minutes > floorShare * cap && used > 0) continue;
      chosen.push(x);
      floorPicks.add(x.view.id);
      used += x.est.minutes;
    }
  }
  for (const x of ranked) {
    if (floorPicks.has(x.view.id)) continue;
    if (chosen.length === 0 || used + x.est.minutes <= cap + 1e-9) {
      chosen.push(x);
      used += x.est.minutes;
    }
  }
  return { chosen, floorPicks };
}

const itemOf = (x: Cand, value = x.value): KnapsackItem => ({ id: x.view.id, minutes: x.est.minutes, value, old: x.old, advocate: x.view.advocateId });

/** Exact knapsack on the value with the floor as a Lagrangian side constraint; optional advocate clustering. */
export function knapsackSelect(xs: Cand[], cap: number, floorShare: number, cluster: boolean): Cand[] {
  const items = xs.map((x) => itemOf(x));
  const r = solveKnapsack(items, cap, { floorShare });
  let ids = r.chosen;
  if (cluster) ids = clusterByAdvocate(items, r.chosen, cap, { floorShare, epsilon: 0.02 }).chosen;
  const set = new Set(ids);
  return xs.filter((x) => set.has(x.view.id));
}

const EARLY = new Set<HearingType>(["ADMISSION", "COGNIZANCE", "PLEA", "APPLICATION_REVIEW", "DELAY_CONDONATION_HEARING", "WARRANT", "APPEARANCE"]);

/** The portfolio redesign's budget a case draws on. */
export function blockOf(c: CaseView, date: string): "old" | "dispose" | "early" | "rest" {
  if (c.firstHeardOn === null && ageYears(c.filingDate, date) >= 4) return "old";
  if (JUDGMENT_FIRST.has(c.nextPurpose) || c.lastSummary.judgmentPronounced) return "dispose";
  if (EARLY.has(c.nextPurpose)) return "early";
  return "rest";
}

/**
 * The portfolio: budgets for never-heard 4+ year cases, hearings that can dispose (15%) and cheap early
 * hearings (30%), each by the exact knapsack; the rest of the day by expected useful hearings (the value
 * breaks near-ties), with the floor still enforced on the whole day.
 */
export function portfolioSelect(xs: Cand[], cap: number, floorShare: number, oldBudget: number, date: string): Cand[] {
  const total = Math.max(0, Math.floor(cap));
  const taken = new Set<string>();
  let left = total;
  let oldMin = 0;
  const budgets: ["old" | "dispose" | "early", number][] = [
    ["old", oldBudget],
    ["dispose", 0.15],
    ["early", 0.3],
  ];
  for (const [b, share] of budgets) {
    const budget = Math.min(left, Math.floor(share * total));
    if (budget <= 0) continue;
    const pool = xs.filter((x) => !taken.has(x.view.id) && blockOf(x.view, date) === b);
    if (!pool.length) continue;
    for (const id of solveKnapsack(pool.map((x) => itemOf(x)), budget).chosen) {
      const x = pool.find((y) => y.view.id === id)!;
      taken.add(id);
      const m = Math.max(0, Math.round(x.est.minutes));
      left -= m;
      if (x.old) oldMin += m;
    }
  }
  if (left > 0) {
    const pool = xs.filter((x) => !taken.has(x.view.id));
    let top = 0;
    for (const x of pool) top = Math.max(top, x.value);
    const items = pool.map((x) => itemOf(x, x.est.p + (top > 0 ? (0.1 * x.value) / top : 0)));
    const floorLeft = Math.max(0, floorShare * total - oldMin);
    for (const id of solveKnapsack(items, left, { floorShare: Math.min(1, floorLeft / left) }).chosen) taken.add(id);
  }
  return xs.filter((x) => taken.has(x.view.id));
}
