// The zoo's genome: every design choice the seven redesigns, the baselines and the judges made, as one
// flat record of named genes. A genome is data, not code, so the tournament can sample, mutate and cross
// it, and a judge can read it. Bounds are part of the contract: validate() clamps any genome into them,
// and the fairness floor never goes below 15% of minutes for 4+ year cases unless a preset reproduces a
// baseline that has no floor (enforceFloor false; never sampled).

import { Rng } from "../../domain/rng";
import type { JudgeConfig } from "../../domain/types";

/** How the day's list is chosen from the ready due cases. */
export const SELECTIONS = ["knapsack", "index", "ppm", "oldest", "youngest", "fifo", "portfolio", "simple", "listAll"] as const;
/** How every case gets its first date at the start of the horizon. */
export const FIRST_DATES = ["spread", "priority", "horizon", "rotation"] as const;
/** How a next date is given after a hearing. */
export const NEXT_DATES = ["flat60", "pucar", "window", "earliest", "projected"] as const;
/** Extra coverage for 4+ year cases on top of the minutes floor. */
export const COVERAGES = ["none", "floor", "rotation", "mention"] as const;
/** Planner-side calibration of P(substantive) against what the court records. */
export const CALIBRATIONS = ["off", "fail", "pscale", "learned"] as const;
/** The order the day's list is called in. */
export const CALL_ORDERS = ["rank", "short", "simple", "cluster"] as const;

export type Selection = (typeof SELECTIONS)[number];
export type FirstDates = (typeof FIRST_DATES)[number];
export type NextDateRule = (typeof NEXT_DATES)[number];
export type Coverage = (typeof COVERAGES)[number];
export type Calibration = (typeof CALIBRATIONS)[number];
export type CallOrder = (typeof CALL_ORDERS)[number];

export interface Weights {
  throughput: number;
  disposal: number;
  fairness: number;
  trips: number;
  predictability: number;
}

export interface Genome {
  selection: Selection;
  firstDates: FirstDates;
  nextDate: NextDateRule;
  coverage: Coverage;
  callOrder: CallOrder;
  calibration: Calibration;
  /** P(substantive) from the case's own record (true) or PUCAR's prior for the type alone (false, the baselines) */
  caseEstimate: boolean;
  /** PUCAR's estimated P checked against its own hearings per case (JUDGEMENT about 0.28, not 1) */
  priorCheck: boolean;
  desk: boolean;
  checkin: boolean;
  /** check-in answers are noisy: a case is released at most once in a row, then called anyway */
  checkinRobust: boolean;
  /** next dates prefer a day the same advocate is already coming (and the knapsack swaps to join them) */
  cluster: boolean;
  /** listings carry fixed call times (a slot lifts attendance in the world's behaviour model) */
  callTimes: boolean;
  /** expected minutes listed, as a share of the day */
  fillTarget: number;
  /** standby list, as a share of the day */
  standbyShare: number;
  /** expected minutes a day may be promised when giving dates, as a share of the day */
  promiseFill: number;
  /** first dates fill each day to this share of the promise cap, leaving room for returns */
  initialFill: number;
  /** share of each first-date day offered first to 4+ year cases */
  firstOldShare: number;
  weights: Weights;
  /** convexity of the value of age: (age / 4 years) ^ ageExponent */
  ageExponent: number;
  /** share of the day's minutes offered first to 4+ year cases (at least 0.15 when enforced) */
  ageingFloor: number;
  /** false only in presets that reproduce a floorless baseline or judge */
  enforceFloor: boolean;
  /** the "window" rule: working days after the gap searched for a day with room */
  windowDays: number;
  /** calendar days before a failed or released matter comes back (never more than PUCAR's gap) */
  relistDays: number;
  /** relistings may book a day up to this share of the day (the selection decides who is heard) */
  relistCap: number;
  /** failed, released and unheard matters come back early (false: PUCAR's or the flat gap for all) */
  quickRelist: boolean;
  /** the gap follows the purpose just heard (true) or the purpose the case moved to (false) */
  gapOfHeard: boolean;
  /** the diary counts matters (true, list-size diary with countCap) or expected minutes (false) */
  countDiary: boolean;
  countCap: number;
  /** share of its minutes a case waiting on process holds on the day it is dated for */
  pendingHold: number;
  /** a pending return is dated this many times its expected span out */
  returnMargin: number;
  /** days between desk re-checks of an overdue process or report */
  recheckDays: number;
  /** rotation: every 4+ year case is before the bench at least once every K working days */
  rotationDays: number;
  /** most of the day the rotation's calls may take, as a share of the fill target */
  rotationCap: number;
  /** the rotation covers every case, not only 4+ year ones (a hearing or a desk action every K working days) */
  rotationAll: boolean;
  /** desk and released matters unseen for this many days compete for a short review call (0 = off) */
  reviewDays: number;
  /** mention: desk visits (0 or 1) a never-heard 4+ year case has before its 2-minute mention */
  mentionAfter: number;
  /** portfolio: share of the day reserved for 4+ year cases never heard */
  portfolioOld: number;
  /** the judges' rules that are not in JudgeConfig's named fields */
  blocks: "none" | "sehgal";
  purposeDays: boolean;
  carryForward: boolean;
}

/** Numeric genes and their bounds (inclusive). */
export const NUMERIC_BOUNDS: Record<string, [number, number]> = {
  fillTarget: [0.8, 1.5],
  standbyShare: [0, 0.3],
  promiseFill: [0.8, 1.5],
  initialFill: [0.5, 1],
  firstOldShare: [0.15, 0.7],
  ageExponent: [0.5, 3],
  ageingFloor: [0.15, 0.5],
  windowDays: [5, 40],
  relistDays: [3, 14],
  relistCap: [0.8, 1.4],
  countCap: [40, 120],
  pendingHold: [0, 1],
  returnMargin: [1, 1.4],
  recheckDays: [7, 21],
  rotationDays: [10, 60],
  rotationCap: [0.2, 0.6],
  reviewDays: [0, 60],
  mentionAfter: [0, 1],
  portfolioOld: [0.1, 0.5],
};
export const WEIGHT_BOUNDS: [number, number] = [0, 3];
const INTEGER_GENES = new Set(["windowDays", "relistDays", "countCap", "recheckDays", "rotationDays", "reviewDays", "mentionAfter"]);
const BOOLEAN_GENES = ["caseEstimate", "priorCheck", "desk", "checkin", "checkinRobust", "cluster", "callTimes", "quickRelist", "gapOfHeard", "countDiary", "purposeDays", "carryForward", "rotationAll"] as const;
const WEIGHT_KEYS: (keyof Weights)[] = ["throughput", "disposal", "fairness", "trips", "predictability"];

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
const pick = <T>(xs: readonly T[], r: Rng): T => xs[Math.floor(r.next() * xs.length) % xs.length]!;

/** Clamp every gene into its bounds (the floor to 15% whenever it is enforced). Returns a new genome. */
export function validate(g: Genome): Genome {
  const out: Genome = { ...g, weights: { ...g.weights } };
  const rec = out as unknown as Record<string, number>;
  for (const [k, [lo, hi]] of Object.entries(NUMERIC_BOUNDS)) {
    let v = Number.isFinite(rec[k]) ? rec[k]! : lo;
    v = clamp(v, lo, hi);
    rec[k] = INTEGER_GENES.has(k) ? Math.round(v) : Math.round(v * 1000) / 1000;
  }
  for (const k of WEIGHT_KEYS) out.weights[k] = Math.round(clamp(Number.isFinite(out.weights[k]) ? out.weights[k] : 1, ...WEIGHT_BOUNDS) * 1000) / 1000;
  if (!SELECTIONS.includes(out.selection)) out.selection = "knapsack";
  if (!FIRST_DATES.includes(out.firstDates)) out.firstDates = "priority";
  if (!NEXT_DATES.includes(out.nextDate)) out.nextDate = "earliest";
  if (!COVERAGES.includes(out.coverage)) out.coverage = "none";
  if (!CALIBRATIONS.includes(out.calibration)) out.calibration = "off";
  if (!CALL_ORDERS.includes(out.callOrder)) out.callOrder = "rank";
  if (out.blocks !== "none" && out.blocks !== "sehgal") out.blocks = "none";
  if (out.enforceFloor) out.ageingFloor = Math.max(0.15, out.ageingFloor);
  // genomes saved before the gene existed read as the 4+ year rotation only
  if (typeof out.rotationAll !== "boolean") out.rotationAll = false;
  return out;
}

/** The floor share the day's selection enforces (0 only for floorless presets). */
export function floorOf(g: Genome, config?: JudgeConfig): number {
  if (!g.enforceFloor) return 0;
  const gene = g.coverage === "none" ? 0.15 : g.ageingFloor;
  return Math.max(0.15, gene, config?.ageingFloor ?? 0.15);
}

/** A uniformly random valid genome (always with the floor enforced: sampled genomes are candidates for benchtime). */
export function randomGenome(r: Rng): Genome {
  const u = (k: string): number => {
    const [lo, hi] = NUMERIC_BOUNDS[k]!;
    return lo + (hi - lo) * r.next();
  };
  const g: Genome = {
    selection: pick(SELECTIONS.filter((s) => s !== "listAll"), r),
    firstDates: pick(FIRST_DATES, r),
    nextDate: pick(NEXT_DATES, r),
    coverage: pick(COVERAGES, r),
    callOrder: pick(CALL_ORDERS, r),
    calibration: pick(CALIBRATIONS, r),
    caseEstimate: r.next() < 0.85,
    priorCheck: r.next() < 0.6,
    desk: r.next() < 0.75,
    checkin: r.next() < 0.75,
    checkinRobust: r.next() < 0.5,
    cluster: r.next() < 0.5,
    callTimes: r.next() < 0.8,
    fillTarget: u("fillTarget"),
    standbyShare: u("standbyShare"),
    promiseFill: u("promiseFill"),
    initialFill: u("initialFill"),
    firstOldShare: u("firstOldShare"),
    weights: {
      throughput: 3 * r.next(),
      disposal: 3 * r.next(),
      fairness: 3 * r.next(),
      trips: 3 * r.next(),
      predictability: 3 * r.next(),
    },
    ageExponent: u("ageExponent"),
    ageingFloor: u("ageingFloor"),
    enforceFloor: true,
    windowDays: u("windowDays"),
    relistDays: u("relistDays"),
    relistCap: u("relistCap"),
    quickRelist: r.next() < 0.7,
    gapOfHeard: r.next() < 0.6,
    countDiary: r.next() < 0.1,
    countCap: u("countCap"),
    pendingHold: u("pendingHold"),
    returnMargin: u("returnMargin"),
    recheckDays: u("recheckDays"),
    rotationDays: u("rotationDays"),
    rotationCap: u("rotationCap"),
    rotationAll: r.next() < 0.3,
    reviewDays: r.next() < 0.5 ? 0 : u("reviewDays"),
    mentionAfter: u("mentionAfter"),
    portfolioOld: u("portfolioOld"),
    blocks: "none",
    purposeDays: r.next() < 0.1,
    carryForward: r.next() < 0.1,
  };
  return validate(g);
}

/** Mutate each gene with probability `rate`: numbers by a Gaussian step of 15% of their range, choices re-drawn. */
export function mutate(g: Genome, r: Rng, rate = 0.15): Genome {
  const out: Genome = { ...g, weights: { ...g.weights } };
  const rec = out as unknown as Record<string, unknown>;
  for (const [k, [lo, hi]] of Object.entries(NUMERIC_BOUNDS)) if (r.next() < rate) rec[k] = (rec[k] as number) + r.normal(0, 0.15 * (hi - lo));
  for (const k of WEIGHT_KEYS) if (r.next() < rate) out.weights[k] += r.normal(0, 0.45);
  for (const k of BOOLEAN_GENES) if (r.next() < rate) rec[k] = !rec[k];
  if (r.next() < rate) out.selection = pick(SELECTIONS.filter((s) => s !== "listAll"), r);
  if (r.next() < rate) out.firstDates = pick(FIRST_DATES, r);
  if (r.next() < rate) out.nextDate = pick(NEXT_DATES, r);
  if (r.next() < rate) out.coverage = pick(COVERAGES, r);
  if (r.next() < rate) out.callOrder = pick(CALL_ORDERS, r);
  if (r.next() < rate) out.calibration = pick(CALIBRATIONS, r);
  out.enforceFloor = true;
  return validate(out);
}

/** Uniform crossover: each gene (each weight separately) from one parent or the other. */
export function crossover(a: Genome, b: Genome, r: Rng): Genome {
  const out = { ...a, weights: { ...a.weights } } as unknown as Record<string, unknown>;
  const bb = b as unknown as Record<string, unknown>;
  for (const k of Object.keys(a)) if (k !== "weights" && r.next() < 0.5) out[k] = bb[k];
  const w = out.weights as Weights;
  for (const k of WEIGHT_KEYS) if (r.next() < 0.5) w[k] = b.weights[k];
  (out as unknown as Genome).enforceFloor = true;
  return validate(out as unknown as Genome);
}

/** A stable short key for a genome (dedupe in the tournament). */
export function genomeKey(g: Genome): string {
  const v = validate(g);
  const keys = Object.keys(v).sort();
  return keys.map((k) => (k === "weights" ? WEIGHT_KEYS.map((w) => v.weights[w]).join("/") : String((v as unknown as Record<string, unknown>)[k]))).join("|");
}

/** The JudgeConfig a genome implies (the fields the simulator and the console read). */
export function genomeConfig(g: Genome): JudgeConfig {
  return {
    weights: { throughput: g.weights.throughput, substantiveness: 1, fairness: g.weights.fairness, predictability: g.weights.predictability, trips: g.weights.trips },
    fillTarget: g.fillTarget,
    ageingFloor: Math.max(0.15, g.ageingFloor),
    clusterByAdvocate: g.cluster,
    blocks: [],
    carryForward: g.carryForward,
    processDesk: g.desk,
    checkin: g.checkin,
    standbyShare: g.standbyShare,
    smartNextDate: g.nextDate !== "flat60" && g.nextDate !== "pucar",
  };
}
