// The head-to-head arena: every policy against the same simulated court, roster by roster and seed by
// seed (rule 2: the world's draws depend only on the seed and semantic keys, so pairing by seed pairs
// the same court). Each run is scored by src/eval/metrics.ts, the same code for every policy.

import { loadCalendar } from "../data/calendar";
import { loadRefTables } from "../data/reference";
import { loadRoster } from "../data/roster";
import { HEARING_TYPES } from "../domain/types";
import type { CaseRecord, HearingType, JudgeConfig, RefTables, RunResult } from "../domain/types";
import { MIN_AGEING_FLOOR, POLICIES, POLICY_IDS, defaultConfig } from "../planner/index";
import { genomeConfig } from "../planner/zoo/genome";
import { AIM_GENOMES } from "../planner/zoo/presets";
import type { WorldParams } from "../world/api";
import { defaultParams } from "../world/defaults";
import { simulate } from "../world/simulate";
import { scorecards } from "./metrics";

export const CAPACITY_MINUTES = 420;

export interface ArenaOptions {
  rosters: { id: string; path: string }[];
  /** policy ids, or ["all"] */
  policies: string[];
  seeds: number[];
  start: string;
  end: string;
  /** per policy id, settings layered over the policy's own defaults (the 15% fairness floor still holds) */
  configOverrides?: Record<string, Partial<JudgeConfig>>;
  noBehaviour?: boolean;
  /** the tables the planners are shown (robustness: perturbed); the world always runs on the true tables */
  plannerRef?: RefTables;
  paramsOverride?: Partial<WorldParams>;
  capacityMinutes?: number;
  /** keep each run's hearing log (large: thousands of rows per run); off by default, day totals are kept */
  keepLogs?: boolean;
  /** progress callback after each run */
  onRun?: (run: RunResult, done: number, total: number) => void;
}

/** "all" expands to every registered policy; unknown ids fail before any run starts. */
export function resolvePolicies(ids: readonly string[]): string[] {
  const list = ids.length === 1 && ids[0] === "all" ? [...POLICY_IDS] : [...ids];
  const unknown = list.filter((id) => !(id in POLICIES));
  if (unknown.length) throw new Error(`Unknown policy: ${unknown.join(", ")}. Known: ${Object.keys(POLICIES).join(", ")}`);
  return list;
}

/** The policy's own configuration with the overrides layered on; the fairness floor cannot go below 15%. */
export function configFor(policyId: string, override?: Partial<JudgeConfig>): JudgeConfig {
  // a judge's aim starts the zoo from that aim's genome, so its fill, standby and other settings are the aim's
  const aim = (override as { aim?: unknown } | undefined)?.aim;
  const aimGenome = policyId === "zoo" && typeof aim === "string" ? AIM_GENOMES[aim] : undefined;
  const d = aimGenome ? genomeConfig(aimGenome) : defaultConfig(policyId);
  const c: JudgeConfig = { ...d, ...override, weights: { ...d.weights, ...(override?.weights ?? {}) } };
  c.ageingFloor = Math.max(MIN_AGEING_FLOOR, c.ageingFloor);
  return c;
}

/** PUCAR's reference gap per hearing type: the procedural minimum the next-date measure is scored against. */
export function minGapDays(ref: RefTables): Partial<Record<HearingType, number>> {
  return Object.fromEntries(HEARING_TYPES.map((t) => [t, ref[t].gapDays]));
}

/** The world's calibrated defaults for this roster, with any override layered on (behaviour and latent merged). */
export function worldParams(ref: RefTables, records: readonly CaseRecord[], override?: Partial<WorldParams>): WorldParams {
  const base = defaultParams(ref, records);
  const out: WorldParams = { ...base, ...override, behaviour: { ...base.behaviour, ...(override?.behaviour ?? {}) } };
  if (base.latent || override?.latent) out.latent = { ...base.latent!, ...(override?.latent ?? {}) };
  return out;
}

export function runArena(opts: ArenaOptions): RunResult[] {
  const policies = resolvePolicies(opts.policies);
  const ref = loadRefTables();
  const calendar = loadCalendar();
  const capacityMinutes = opts.capacityMinutes ?? CAPACITY_MINUTES;
  const gaps = minGapDays(ref);
  const total = opts.rosters.length * policies.length * opts.seeds.length;
  const out: RunResult[] = [];

  for (const roster of opts.rosters) {
    const records: CaseRecord[] = loadRoster(roster.path);
    const params = worldParams(ref, records, opts.paramsOverride);
    for (const policyId of policies) {
      const override = opts.configOverrides?.[policyId];
      const config = configFor(policyId, override);
      for (const worldSeed of opts.seeds) {
        // a fresh policy per run: policies may keep ledgers, and no state may leak between seeds
        const factory = POLICIES[policyId];
        if (!factory) throw new Error(`Unknown policy: ${policyId}`);
        const policy = factory(override);
        const run = simulate({
          records,
          rosterId: roster.id,
          policy,
          config,
          ref,
          plannerRef: opts.plannerRef,
          calendar,
          worldSeed,
          start: opts.start,
          end: opts.end,
          params,
          capacityMinutes,
          noBehaviour: opts.noBehaviour,
          scorecards: false, // scored below, with the reference gaps, by the same code for every policy
        });
        const scored: RunResult = {
          ...run,
          policyId,
          rosterId: roster.id,
          worldSeed,
          scorecards: scorecards({
            hearings: run.hearings,
            days: run.days,
            records,
            start: opts.start,
            end: opts.end,
            capacityMinutes,
            asOf: opts.end,
            minGapDays: gaps,
          }),
          hearings: opts.keepLogs ? run.hearings : [],
        };
        out.push(scored);
        opts.onRun?.(scored, out.length, total);
      }
    }
  }
  return out;
}

/** "31-60", "1,2,5-7" to a sorted list of seeds. */
export function parseSeeds(spec: string): number[] {
  const out = new Set<number>();
  for (const part of spec.split(",").map((s) => s.trim()).filter(Boolean)) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(part);
    if (!m) throw new Error(`Bad seed list "${spec}": use forms like 31-60 or 1,2,5-7`);
    const a = Number(m[1]);
    const b = m[2] !== undefined ? Number(m[2]) : a;
    if (b < a) throw new Error(`Bad seed range "${part}"`);
    for (let s = a; s <= b; s++) out.add(s);
  }
  return [...out].sort((x, y) => x - y);
}
