// One experiment worker: reads jobs from stdin (one JSON line each: { key, seed, cell }), runs the cell on
// that world seed through the CLI arena path (src/eval/arena.ts runArena: the same roster id, world
// parameters, configuration merge and scorecards as `bun run src/cli.ts arena`), and writes the scorecards
// back as one JSON line. Genome cells are registered as zoo policies under their own id for this process
// only; nothing under src/ is changed. Run from the package root it lives in (temp copies carry their own).

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadRefTables } from "../../src/data/reference";
import { loadRoster } from "../../src/data/roster";
import type { JudgeConfig, Policy, RefTables, Scorecards } from "../../src/domain/types";
import { HEARING_TYPES } from "../../src/domain/types";
import { runArena } from "../../src/eval/arena";
import { POLICIES } from "../../src/planner/index";
import { zooPolicy } from "../../src/planner/zoo";
import { genomeConfig, validate, type Genome } from "../../src/planner/zoo/genome";
import type { WorldParams } from "../../src/world/api";
import { defaultParams } from "../../src/world/defaults";

const ROOT = resolve(import.meta.dir, "../..");
export const START = "2026-10-01";
export const END = "2026-12-15";
export const MAIN_ROSTER = "roster_3000_seed42";

/** One experimental condition: a policy (registered, or a zoo genome), a court, and what the planner is shown. */
export interface CellSpec {
  /** unique id; the run's policy id */
  id: string;
  label: string;
  /** a registered policy id (src/planner/index.ts POLICIES) */
  policy?: string;
  /** a zoo genome, registered for this process under `id` with genomeConfig(genome) as its configuration */
  genome?: Genome;
  /** configuration laid over the policy's own (judge's rules); the 15% floor still holds */
  config?: Record<string, unknown>;
  /** wrap the zoo policy in settlement days (temp copy with src/planner/settlement.ts only) */
  settlement?: string;
  /** roster id under data/ (default roster_3000_seed42) */
  roster?: string;
  noBehaviour?: boolean;
  /** world changes (the world always runs on the true tables) */
  world?: { durationCv?: number; processScale?: number; falseAlarmScale?: number };
  /** planner shown PUCAR's P(substantive) times (1 + plannerBias), clamped to [0.01, 0.99] */
  plannerBias?: number;
  /** package root the cell runs in (temp copies for patches); default this package */
  root?: string;
}

export interface JobResult {
  key: string;
  seed: number;
  cellId: string;
  ms: number;
  scorecards?: Scorecards;
  error?: string;
}

const refTrue = loadRefTables();
const paramCache = new Map<string, WorldParams>();
function baseParams(rosterPath: string): WorldParams {
  let p = paramCache.get(rosterPath);
  if (!p) {
    p = defaultParams(refTrue, loadRoster(rosterPath));
    paramCache.set(rosterPath, p);
  }
  return p;
}

function biasedRef(bias: number): RefTables {
  const out = structuredClone(refTrue) as RefTables;
  for (const t of HEARING_TYPES) out[t].pSubstantive = Math.min(0.99, Math.max(0.01, refTrue[t].pSubstantive * (1 + bias)));
  return out;
}

let settlementMod: { withSettlementDays: (p: Policy, cfg: unknown, id: string) => Policy; SETTLEMENT_CONFIGS: Record<string, unknown> } | null = null;
async function settlement() {
  if (settlementMod) return settlementMod;
  const path = resolve(ROOT, "src/planner/settlement.ts");
  if (!existsSync(path)) throw new Error(`settlement days need src/planner/settlement.ts in ${ROOT}`);
  settlementMod = (await import(path)) as typeof settlementMod;
  return settlementMod!;
}

export async function runCell(cell: CellSpec, seed: number): Promise<Scorecards> {
  const rosterId = cell.roster ?? MAIN_ROSTER;
  const rosterPath = resolve(ROOT, "data", `${rosterId}.csv`);
  let policyId: string;
  let override: Partial<JudgeConfig> | undefined;
  if (cell.genome) {
    const g = validate(cell.genome);
    policyId = cell.id;
    override = { ...genomeConfig(g), ...(cell.config ?? {}) } as Partial<JudgeConfig>;
    const own = override as JudgeConfig;
    if (cell.settlement) {
      const s = await settlement();
      const cfg = s.SETTLEMENT_CONFIGS[cell.settlement];
      if (!cfg) throw new Error(`unknown settlement set-up ${cell.settlement}`);
      POLICIES[policyId] = () => s.withSettlementDays(zooPolicy(own, g, policyId, cell.label), cfg, policyId);
    } else POLICIES[policyId] = () => zooPolicy(own, g, policyId, cell.label);
  } else {
    policyId = cell.policy!;
    if (!(policyId in POLICIES)) throw new Error(`unknown policy ${policyId} in ${ROOT}`);
    override = cell.config as Partial<JudgeConfig> | undefined;
  }
  let paramsOverride: Partial<WorldParams> | undefined;
  if (cell.world) {
    const base = baseParams(rosterPath);
    paramsOverride = {};
    if (cell.world.durationCv !== undefined) paramsOverride.durationCv = cell.world.durationCv;
    const latent = { ...base.latent! };
    let touched = false;
    if (cell.world.processScale !== undefined) {
      const m = base.latent!.processMeanDays;
      const k = cell.world.processScale;
      latent.processMeanDays = { summons: m.summons * k, notice: m.notice * k, warrant: m.warrant * k };
      touched = true;
    }
    if (cell.world.falseAlarmScale !== undefined) {
      latent.checkinFalseAlarm = Math.min(1, base.latent!.checkinFalseAlarm * cell.world.falseAlarmScale);
      touched = true;
    }
    if (touched) paramsOverride.latent = latent;
  }
  const runs = runArena({
    rosters: [{ id: rosterId, path: rosterPath }],
    policies: [policyId],
    seeds: [seed],
    start: START,
    end: END,
    configOverrides: override ? { [policyId]: override } : undefined,
    noBehaviour: cell.noBehaviour,
    plannerRef: cell.plannerBias ? biasedRef(cell.plannerBias) : undefined,
    paramsOverride,
  });
  const sc = runs[0]!.scorecards;
  // derived (criteria.json): disposals on the merits = verdict + settlement + compounded
  sc.extra.meritsDisposals = (sc.extra.disposedVerdict ?? 0) + (sc.extra.disposedSettlement ?? 0) + (sc.extra.disposedCompounded ?? 0);
  return sc;
}

if (import.meta.main) {
  process.stdout.write(JSON.stringify({ ready: true, root: ROOT }) + "\n");
  for await (const line of console) {
    if (!line.trim()) continue;
    let job: { key: string; seed: number; cell: CellSpec };
    try {
      job = JSON.parse(line);
    } catch {
      continue;
    }
    const t0 = performance.now();
    let out: JobResult;
    try {
      const scorecards = await runCell(job.cell, job.seed);
      out = { key: job.key, seed: job.seed, cellId: job.cell.id, ms: Math.round(performance.now() - t0), scorecards };
    } catch (e) {
      out = { key: job.key, seed: job.seed, cellId: job.cell.id, ms: Math.round(performance.now() - t0), error: String((e as Error)?.stack ?? e) };
    }
    process.stdout.write(JSON.stringify(out, (_k, v) => (typeof v === "number" && !Number.isFinite(v) ? null : v)) + "\n");
  }
}
