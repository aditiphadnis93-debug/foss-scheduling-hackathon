// The teams: every policy the arena runs, and each judge's default configuration. Planners see only
// PlanContext and CaseView (rule 1); nothing under src/planner imports src/world.

import type { JudgeConfig, Policy } from "../domain/types";
import { binPacking, fifoCapped, oldestFirst, statusQuo60, statusQuoRef } from "./baselines";
import { benchtime } from "./benchtime";
import { defaultSehgalBlocks, dimakar, joshi, sehgal } from "./judges";
import { genomeConfig, zooPolicy } from "./zoo";
import { BENCHTIME_FINAL_GENOME } from "./zoo/final";
import { AIM_GENOMES, DEFAULT_GENOME } from "./zoo/presets";

export const POLICY_IDS = [
  "status_quo_60",
  "status_quo_ref",
  "fifo_capped",
  "bin_packing",
  "oldest_first",
  "sehgal",
  "dimakar",
  "joshi",
  "benchtime",
  "benchtime_final",
  "zoo",
] as const;
export type PolicyId = (typeof POLICY_IDS)[number];

/** the fairness floor no judge may go below: 15% of expected minutes offered first to 4+ year cases */
export const MIN_AGEING_FLOOR = 0.15;

const BASE: JudgeConfig = {
  weights: { throughput: 1, substantiveness: 1, fairness: 1, predictability: 1, trips: 1 },
  fillTarget: 1,
  ageingFloor: MIN_AGEING_FLOOR,
  clusterByAdvocate: false,
  blocks: [],
  carryForward: false,
  processDesk: false,
  checkin: false,
  standbyShare: 0,
  smartNextDate: false,
};

/** Each policy's own settings; the arena may override any field (the floor is clamped to 15%). */
export function defaultConfig(policyId: string): JudgeConfig {
  const c: JudgeConfig = { ...BASE, weights: { ...BASE.weights }, blocks: [] };
  switch (policyId) {
    case "sehgal":
      // "I list 10 for every day and hear 5": he lists well past the day's minutes, in blocks
      return { ...c, fillTarget: 1.3, blocks: defaultSehgalBlocks(), carryForward: true };
    case "dimakar":
      return { ...c, clusterByAdvocate: true, weights: { ...c.weights, fairness: 2 } };
    case "joshi":
      return { ...c, weights: { ...c.weights, fairness: 0 } };
    case "benchtime":
      return { ...c, fillTarget: 0.95, clusterByAdvocate: true, processDesk: true, checkin: true, standbyShare: 0.1, smartNextDate: true };
    case "benchtime_final":
      // the tournament's pick (src/planner/zoo/final.ts, frozen from out/tournament/winner.json)
      return genomeConfig(BENCHTIME_FINAL_GENOME);
    case "zoo":
      // the genome-configurable meta-policy (src/planner/zoo.ts), at its default genome
      return genomeConfig(DEFAULT_GENOME);
    default:
      return c;
  }
}

function merged(id: string, config?: Partial<JudgeConfig>): JudgeConfig {
  const d = defaultConfig(id);
  const m: JudgeConfig = { ...d, ...config, weights: { ...d.weights, ...(config?.weights ?? {}) } };
  m.ageingFloor = Math.max(MIN_AGEING_FLOOR, m.ageingFloor);
  return m;
}

export const POLICIES: Record<string, (config?: Partial<JudgeConfig>) => Policy> = {
  status_quo_60: () => statusQuo60(),
  status_quo_ref: () => statusQuoRef(),
  fifo_capped: (c) => fifoCapped(merged("fifo_capped", c)),
  bin_packing: (c) => binPacking(merged("bin_packing", c)),
  oldest_first: (c) => oldestFirst(merged("oldest_first", c)),
  sehgal: (c) => sehgal(merged("sehgal", c)),
  dimakar: (c) => dimakar(merged("dimakar", c)),
  joshi: (c) => joshi(merged("joshi", c)),
  benchtime: (c) => benchtime(merged("benchtime", c)),
  benchtime_final: (c) => zooPolicy(merged("benchtime_final", c), BENCHTIME_FINAL_GENOME, "benchtime_final", "benchtime (final)"),
  zoo: (c) => zooForAim(c),
};

/**
 * The judge's aim ("what should the list aim for?") picks the genome the tournament found best for it; the
 * judge's own rules still apply on top, and only the fields the judge actually set override the aim's genome.
 */
function zooForAim(config?: Partial<JudgeConfig>): Policy {
  const aim = (config as { aim?: unknown } | undefined)?.aim;
  const g = typeof aim === "string" ? AIM_GENOMES[aim] : undefined;
  if (!g) return zooPolicy(merged("zoo", config));
  const d = genomeConfig(g);
  const m: JudgeConfig = { ...d, ...config, weights: { ...d.weights, ...(config?.weights ?? {}) } };
  m.ageingFloor = Math.max(MIN_AGEING_FLOOR, m.ageingFloor);
  return zooPolicy(m, g, "zoo");
}
export const AIMS = Object.keys(AIM_GENOMES);

export { solveKnapsack, greedyKnapsack, clusterByAdvocate } from "./knapsack";
export { predictSubstantive, expectedMinutes, caseValue, assess, populationStats } from "./predict";
export { LoadLedger, recommendNextDate } from "./nextdate";
export type { BenchtimeDayPlan, OptimiserReport } from "./benchtime";
