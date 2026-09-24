// One tournament worker: loads the shared court once (roster seed 42, PUCAR's tables, the calibrated
// corrected world), then reads jobs from stdin, one JSON line each ({ key, seed, genome } or
// { key, seed, policy }), simulates the run on that world seed and writes every measure back as one JSON
// line. Every candidate faces the same seeds (rule 2: common random numbers), and every run is scored by
// the same code (src/eval/metrics.ts).

import { loadCalendar } from "../src/data/calendar";
import { loadRefTables } from "../src/data/reference";
import { loadRoster } from "../src/data/roster";
import type { CaseRecord, CourtCalendar, JudgeConfig, Policy, RefTables, Scorecards } from "../src/domain/types";
import { configFor, minGapDays, worldParams } from "../src/eval/arena";
import { scorecards } from "../src/eval/metrics";
import { POLICIES } from "../src/planner/index";
import { zooPolicy } from "../src/planner/zoo";
import { genomeConfig, validate, type Genome } from "../src/planner/zoo/genome";
import type { WorldParams } from "../src/world/api";
import { simulate } from "../src/world/simulate";

export const START = "2026-10-01";
export const END = "2026-12-15";
const ROSTER = new URL("../data/roster_3000_seed42.csv", import.meta.url).pathname;
/** the roster id the CLI arena uses (the world keys every case's draws by roster id and case id) */
export const ROSTER_ID = "roster_3000_seed42";

export interface Court {
  records: CaseRecord[];
  ref: RefTables;
  calendar: CourtCalendar;
  params: WorldParams;
}

let court: Court | null = null;
export function loadCourt(): Court {
  if (court) return court;
  const ref = loadRefTables();
  const records = loadRoster(ROSTER);
  court = { records, ref, calendar: loadCalendar(), params: worldParams(ref, records) };
  return court;
}

/** Flatten the three scorecards (every extra, and the age bands as card.band.label) into one record of numbers. */
export function flatten(s: Scorecards): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [card, fields] of Object.entries(s) as [string, Record<string, unknown>][])
    for (const [k, v] of Object.entries(fields)) {
      if (typeof v === "number" && Number.isFinite(v)) out[`${card}.${k}`] = v;
      else if (v && typeof v === "object") for (const [b, x] of Object.entries(v as Record<string, unknown>)) if (typeof x === "number" && Number.isFinite(x)) out[`${card}.${k}.${b}`] = x;
    }
  // derived: disposals on the merits (criteria.json)
  out["derived.meritsDisposals"] = (out["extra.disposedVerdict"] ?? 0) + (out["extra.disposedSettlement"] ?? 0) + (out["extra.disposedCompounded"] ?? 0);
  return out;
}

export interface Job {
  key: string;
  seed: number;
  genome?: Genome;
  policy?: string;
}

/** Simulate one candidate on one world seed and return every measure. */
export function evaluate(job: Job): Record<string, number> {
  const c = loadCourt();
  let policy: Policy;
  let config: JudgeConfig;
  if (job.genome) {
    const g = validate(job.genome);
    config = genomeConfig(g);
    policy = zooPolicy(config, g, "zoo");
  } else {
    const id = job.policy!;
    config = configFor(id);
    const f = POLICIES[id];
    if (!f) throw new Error(`Unknown policy ${id}`);
    policy = f();
  }
  const run = simulate({
    records: c.records,
    rosterId: ROSTER_ID,
    policy,
    config,
    ref: c.ref,
    calendar: c.calendar,
    worldSeed: job.seed,
    start: START,
    end: END,
    params: c.params,
    capacityMinutes: 420,
    scorecards: false,
  });
  const cards = scorecards({ hearings: run.hearings, days: run.days, records: c.records, start: START, end: END, capacityMinutes: 420, asOf: END, minGapDays: minGapDays(c.ref) });
  return flatten(cards);
}

if (import.meta.main) {
  loadCourt();
  process.stdout.write(JSON.stringify({ ready: true }) + "\n");
  for await (const line of console) {
    if (!line.trim()) continue;
    let job: Job;
    try {
      job = JSON.parse(line) as Job;
    } catch {
      continue;
    }
    const t0 = performance.now();
    try {
      const m = evaluate(job);
      process.stdout.write(JSON.stringify({ key: job.key, seed: job.seed, ms: Math.round(performance.now() - t0), m }) + "\n");
    } catch (e) {
      process.stdout.write(JSON.stringify({ key: job.key, seed: job.seed, error: String((e as Error)?.stack ?? e) }) + "\n");
    }
  }
}
