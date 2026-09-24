// The tournament: as many approaches as the time allows, the best chosen by evidence, not by hand.
// A pool of worker processes (scripts/tournament-worker.ts) simulates candidates on the corrected world;
// every candidate faces the same world seeds (common random numbers) and is scored by the same code.
//   stage 1: random genomes (plus every preset) on tuning seeds 1-4;
//   stage 2: NSGA-II multi-objective evolution on tuning seeds 1-6, with the merge brief's guardrails as
//            constraints (constrained domination: feasible beats infeasible, less violation beats more);
//   stage 3: the top 30 of the final fronts re-scored on tuning seeds 1-20;
//   stage 4: the top 8 by the pre-registered selection on validation seeds 21-30, against every baseline,
//            every preset and the current benchtime.
// Seeds 31-60 are the held-out test set and are never used here.
// Usage: bun run scripts/tournament.ts [--random 450] [--pop 64] [--gens 10] [--workers 5] [--budget-min 38]

import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Rng } from "../src/domain/rng";
import { describeGenome } from "../src/planner/zoo";
import { crossover, genomeKey, mutate, randomGenome, validate, type Genome } from "../src/planner/zoo/genome";
import { PRESETS } from "../src/planner/zoo/presets";

const ROOT = new URL("..", import.meta.url).pathname;
const OUT = process.env.TOURNAMENT_OUT ?? join(ROOT, "out", "tournament");
const arg = (name: string, def: number): number => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? Number(process.argv[i + 1]) : def;
};
const N_RANDOM = arg("random", 420);
const POP = arg("pop", 40);
const GENS = arg("gens", 15);
const WORKERS = arg("workers", 5);
const BUDGET_MIN = arg("budget-min", 40);
/** "amended": the selection rule as amended at 14:05 (predictability and coverage guardrails added) */
const RULE: "original" | "amended" = process.argv.includes("--amended") ? "amended" : "original";
/** the amended guardrail (c): at most this many cases with no hearing reached and no desk action */
const NEVER_ACTED_MAX = 600;
const RNG_SEED = arg("seed", 20260924);

const range = (a: number, b: number): number[] => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const S1 = range(1, 4);
const S2 = range(1, 6);
const SMOKE = process.argv.includes("--smoke");
const S3 = SMOKE ? range(1, 7) : range(1, 20);
const S4 = SMOKE ? range(21, 22) : range(21, 30);
for (const s of [...S3, ...S4]) if (s >= 31) throw new Error("seeds 31-60 are held out");

export const BASELINES = ["status_quo_60", "status_quo_ref", "fifo_capped", "bin_packing", "oldest_first", "sehgal", "dimakar", "joshi"];
const RIVALS = ["benchtime"];

// ---------------------------------------------------------------------------------------------
// Measures

const M = {
  useful: "extra.substantivePerDay",
  sub4y: "readme.backlog4ySubstantiveShare",
  heard4y: "readme.backlog4yHeardShare",
  disposals: "extra.disposed",
  trips: "extra.tripsPerSubstantive",
  held: "siddarth.heldOnPromisedDate",
  overrun: "caseStudy.overrunDays",
  excess: "caseStudy.nextDateExcessDays",
  wasted: "siddarth.wastedListings",
  heldAllDue: "caseStudy.heldAsScheduledAllDue",
  neverHeard: "siddarth.neverHeard",
  neverActed: "extra.neverActedOn",
} as const;
const KEY_MEASURES = Object.values(M);

/** Direction of every measure a table reports ("higher" is better, "lower" is better). */
const DIRECTION: Record<string, "higher" | "lower"> = {
  "readme.utilisation": "higher",
  "readme.reachRate": "higher",
  "readme.substantiveness": "higher",
  "readme.backlog4yHeardShare": "higher",
  "readme.backlog4ySubstantiveShare": "higher",
  "readme.predictabilityGapDays": "lower",
  "caseStudy.utilisation": "higher",
  "caseStudy.overrunDays": "lower",
  "caseStudy.idleMinutesShare": "lower",
  "caseStudy.heldAsScheduled": "higher",
  "caseStudy.heldAsScheduledAllDue": "higher",
  "caseStudy.substantiveness": "higher",
  "caseStudy.nextDateExcessDays": "lower",
  "caseStudy.wastedRelistShare": "lower",
  "siddarth.throughputPerMonth": "higher",
  "siddarth.judgeTimeUsed": "higher",
  "siddarth.wastedListings": "lower",
  "siddarth.heldOnPromisedDate": "higher",
  "siddarth.oldestPendingAgeYears": "lower",
  "siddarth.p95PendingAgeYears": "lower",
  "siddarth.neverHeard": "lower",
  "siddarth.loadBalanceCv": "lower",
  "extra.substantivePerDay": "higher",
  "extra.disposed": "higher",
  "extra.disposed4yPlus": "higher",
  "extra.tripsPerSubstantive": "lower",
  "extra.wastedTripShare": "lower",
  "extra.neverActedOn": "lower",
};
const SCORED = Object.keys(DIRECTION);

type Measures = Record<string, number>;
const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
function ci95(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
  const t = xs.length >= 20 ? 2.093 : xs.length >= 10 ? 2.262 : xs.length >= 6 ? 2.571 : 3.182;
  return (t * sd) / Math.sqrt(xs.length);
}

// ---------------------------------------------------------------------------------------------
// The worker pool

interface Result {
  key: string;
  seed: number;
  m?: Measures;
  error?: string;
  ms?: number;
}

class Pool {
  private workers: { proc: ReturnType<typeof Bun.spawn>; busy: boolean; job: string | null }[] = [];
  private queue: { line: string; id: string }[] = [];
  private waiting = new Map<string, (r: Result) => void>();
  private readyCount = 0;
  private readyResolve: (() => void) | null = null;
  runs = 0;
  ms = 0;

  async start(n: number): Promise<void> {
    const ready = new Promise<void>((res) => (this.readyResolve = res));
    for (let i = 0; i < n; i++) {
      const proc = Bun.spawn(["bun", "run", join(ROOT, "scripts", "tournament-worker.ts")], { stdin: "pipe", stdout: "pipe", stderr: "inherit", cwd: ROOT });
      const w = { proc, busy: false, job: null as string | null };
      this.workers.push(w);
      this.read(w);
    }
    await ready;
  }

  private async read(w: (typeof this.workers)[number]): Promise<void> {
    const reader = (w.proc.stdout as ReadableStream<Uint8Array>).getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (!line.trim()) continue;
        let msg: Result & { ready?: boolean };
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (msg.ready) {
          this.readyCount++;
          if (this.readyCount === this.workers.length) this.readyResolve?.();
          this.pump();
          continue;
        }
        const id = `${msg.key}#${msg.seed}`;
        this.runs++;
        this.ms += msg.ms ?? 0;
        w.busy = false;
        w.job = null;
        this.waiting.get(id)?.(msg);
        this.waiting.delete(id);
        this.pump();
      }
    }
  }

  private pump(): void {
    for (const w of this.workers) {
      if (w.busy || this.queue.length === 0) continue;
      const j = this.queue.shift()!;
      w.busy = true;
      w.job = j.id;
      const sink = w.proc.stdin as unknown as { write(s: string): void; flush(): void };
      sink.write(j.line + "\n");
      sink.flush();
    }
  }

  private inflight = new Map<string, Promise<Result>>();

  run(key: string, seed: number, payload: { genome?: Genome; policy?: string }): Promise<Result> {
    const id = `${key}#${seed}`;
    // the same candidate on the same seed is simulated once, however many stages ask for it at once
    const hit = this.inflight.get(id);
    if (hit) return hit;
    const p = new Promise<Result>((res) => {
      this.waiting.set(id, res);
      this.queue.push({ id, line: JSON.stringify({ key, seed, ...payload }) });
      this.pump();
    });
    this.inflight.set(id, p);
    p.then(() => this.inflight.delete(id));
    return p;
  }

  stop(): void {
    for (const w of this.workers) w.proc.kill();
  }
}

// ---------------------------------------------------------------------------------------------
// Candidates

interface Cand {
  key: string;
  name: string;
  origin: string;
  genome?: Genome;
  policy?: string;
  runs: Map<number, Measures>;
}

const cands = new Map<string, Cand>();
const pool = new Pool();
const T0 = performance.now();
const elapsedMin = () => (performance.now() - T0) / 60000;
const log = (s: string) => console.log(`[${elapsedMin().toFixed(1)} min] ${s}`);
let approaches = 0;

function addGenome(g: Genome, origin: string, name?: string): Cand {
  const v = validate(g);
  const key = genomeKey(v);
  let c = cands.get(key);
  if (!c) {
    c = { key, name: name ?? `g${cands.size}`, origin, genome: v, runs: new Map() };
    cands.set(key, c);
    approaches++;
  } else if (name && c.name.startsWith("g")) c.name = name;
  return c;
}
function addPolicy(id: string): Cand {
  const key = `policy:${id}`;
  let c = cands.get(key);
  if (!c) cands.set(key, (c = { key, name: id, origin: "policy", policy: id, runs: new Map() }));
  return c;
}

async function evalOn(list: Cand[], seeds: number[], stage: string): Promise<void> {
  const cs = [...new Set(list)];
  const jobs: Promise<void>[] = [];
  // each candidate is logged the moment its last seed for this stage comes back (the log is watched live)
  const done = (c: Cand) => seeds.every((s) => c.runs.has(s));
  for (const c of cs) {
    if (done(c)) {
      logCand(c, seeds, stage);
      continue;
    }
    for (const s of seeds) {
      if (c.runs.has(s)) continue;
      jobs.push(
        pool.run(c.key, s, c.genome ? { genome: c.genome } : { policy: c.policy }).then((r) => {
          if (r.m) c.runs.set(s, r.m);
          else {
            console.error(`run failed ${c.name} seed ${s}: ${r.error?.slice(0, 400)}`);
            c.runs.set(s, { failed: 1 });
          }
          if (done(c)) logCand(c, seeds, stage);
        }),
      );
    }
  }
  await Promise.all(jobs);
}

function logCand(c: Cand, seeds: number[], stage: string): void {
  const m = means(c, seeds);
  const perSeed: Record<number, Measures> = {};
  for (const s of seeds) {
    const r = c.runs.get(s);
    if (r) perSeed[s] = Object.fromEntries(KEY_MEASURES.map((k) => [k, r[k] ?? NaN]));
  }
  appendFileSync(join(OUT, "candidates.jsonl"), JSON.stringify({ stage, key: c.key, name: c.name, origin: c.origin, policy: c.policy, genome: c.genome, seeds, mean: m, perSeed }) + "\n");
}

function means(c: Cand, seeds: number[]): Measures {
  const out: Measures = {};
  const rs = seeds.map((s) => c.runs.get(s)).filter((r): r is Measures => !!r);
  if (!rs.length) return out;
  for (const k of Object.keys(rs[0]!)) out[k] = mean(rs.map((r) => r[k] ?? NaN));
  return out;
}
const valuesOn = (c: Cand, seeds: number[], k: string): number[] => seeds.map((s) => c.runs.get(s)?.[k]).filter((x): x is number => typeof x === "number");
const failed = (c: Cand, seeds: number[]) => seeds.some((s) => c.runs.get(s)?.failed);

// ---------------------------------------------------------------------------------------------
// Guardrails (merge brief) and objectives

/** Constraint violation on the given seeds: 0 when every guardrail holds (small noise tolerances). */
// ---------------------------------------------------------------------------------------------
// Criteria: guardrails, objectives and the final pick, as data (out/tournament/criteria.json), so that
// re-selecting under revised criteria is a pure function over the archive and needs no re-run.

export interface Guardrail {
  label: string;
  measure: string;
  /** what the candidate is compared with */
  vs: "status_quo_60" | "best_baseline" | "best_rival_all" | "absolute";
  op: ">=" | "<=";
  /** noise tolerance, in the measure's units */
  tol?: number;
  /** for vs "absolute" */
  value?: number;
  /** the shortfall that counts as one unit of violation (normalises the constraint for the search) */
  scale: number;
  /** relaxed to the smallest level reached when no candidate meets it (the other guardrails stay hard) */
  relaxable?: boolean;
  /** "mean": compare means (candidate against today's mean plus the margin) instead of the paired t-bound */
  on?: "mean" | "paired";
}
export interface Criteria {
  name: string;
  note?: string;
  guardrails: Guardrail[];
  /** NSGA-II objectives */
  objectives: { measure: string; dir: "max" | "min" }[];
  /** the final pick: guardrails first, then the most of this measure, then the most measures best or tied */
  primary: string;
}

const ORIGINAL_GUARDRAILS: Guardrail[] = [
  { label: "4y+ heard", measure: M.heard4y, vs: "status_quo_60", op: ">=", tol: 0.005, scale: 0.05 },
  { label: "4y+ substantive", measure: M.sub4y, vs: "status_quo_60", op: ">=", tol: 0.005, scale: 0.05 },
  { label: "disposals", measure: M.disposals, vs: "status_quo_60", op: ">=", tol: 2, scale: 20 },
  { label: "next-date excess", measure: M.excess, vs: "status_quo_60", op: "<=", tol: 1, scale: 10 },
  { label: "overrun days", measure: M.overrun, vs: "status_quo_60", op: "<=", tol: 1, scale: 5 },
  { label: "trips per useful hearing", measure: M.trips, vs: "best_baseline", op: "<=", tol: 0.1, scale: 1 },
  { label: "wasted listings", measure: M.wasted, vs: "best_baseline", op: "<=", tol: 0.005, scale: 0.05 },
];
const BASE_OBJECTIVES: Criteria["objectives"] = [
  { measure: M.useful, dir: "max" },
  { measure: M.sub4y, dir: "max" },
  { measure: M.disposals, dir: "max" },
  { measure: M.trips, dir: "min" },
  { measure: M.held, dir: "max" },
  { measure: M.overrun, dir: "min" },
  { measure: M.heldAllDue, dir: "max" },
];
export const ORIGINAL_CRITERIA: Criteria = {
  name: "original (merge brief, pre-registered)",
  guardrails: ORIGINAL_GUARDRAILS,
  objectives: [...BASE_OBJECTIVES, { measure: M.neverHeard, dir: "min" }],
  primary: M.useful,
};
export const AMENDED_CRITERIA: Criteria = {
  name: "amended at 14:05",
  note: "Added on tuning seeds, before validation or test seeds were looked at for this rule: the leader under the original rule kept 45% of promised dates (today's way: 91%) and left about 1,350 cases never heard (today: 262). Predictability is a criterion in all three scorecards, and a date fixed in the order sheet must be honoured.",
  guardrails: [
    ...ORIGINAL_GUARDRAILS,
    { label: "held on the promised date", measure: M.held, vs: "status_quo_60", op: ">=", tol: 0.01, scale: 0.05 },
    { label: "held as scheduled (all due)", measure: M.heldAllDue, vs: "status_quo_60", op: ">=", tol: 0.01, scale: 0.05 },
    { label: "never acted on", measure: M.neverActed, vs: "absolute", op: "<=", value: NEVER_ACTED_MAX, scale: 200, relaxable: true },
  ],
  objectives: [...BASE_OBJECTIVES, { measure: M.neverActed, dir: "min" }],
  primary: M.useful,
};

let criteriaCache: Criteria | null = null;
/** The criteria in force: --criteria <file>, else out/tournament/criteria.json, else the rule named on the command line. */
function criteria(): Criteria {
  if (criteriaCache) return criteriaCache;
  const i = process.argv.indexOf("--criteria");
  const path = i >= 0 ? process.argv[i + 1]! : join(OUT, "criteria.json");
  try {
    if (i >= 0 || process.argv.includes("--finals")) {
      criteriaCache = JSON.parse(readFileSync(path, "utf8")) as Criteria;
      return criteriaCache;
    }
  } catch (e) {
    if (i >= 0) throw e;
  }
  criteriaCache = RULE === "amended" ? AMENDED_CRITERIA : ORIGINAL_CRITERIA;
  return criteriaCache;
}

/** Constraint violation on the given seeds: 0 when every guardrail holds; cvHard leaves out relaxable ones. */
function violation(c: Cand, seeds: number[]): { cv: number; cvHard: number; broken: string[] } {
  if (failed(c, seeds)) return { cv: 1e9, cvHard: 1e9, broken: ["run failed"] };
  const m = means(c, seeds);
  const sq = means(cands.get("policy:status_quo_60")!, seeds);
  const base = BASELINES.map((b) => means(cands.get(`policy:${b}`)!, seeds));
  // best_rival_all: the eight baselines and the original benchtime (the "benchtime" policy as registered)
  const rivals = [...BASELINES, ...RIVALS].map((b) => cands.get(`policy:${b}`)).filter((c): c is Cand => !!c).map((c) => means(c, seeds));
  let cv = 0;
  let cvHard = 0;
  const broken: string[] = [];
  for (const g of criteria().guardrails) {
    const x = m[g.measure] ?? (g.op === ">=" ? -1e6 : 1e6);
    const pool = g.vs === "best_rival_all" ? rivals : base;
    const ref =
      g.vs === "absolute" ? g.value! : g.vs === "status_quo_60" ? sq[g.measure]! : g.op === "<=" ? Math.min(...pool.map((b) => b[g.measure]!)) : Math.max(...pool.map((b) => b[g.measure]!));
    const tol = g.tol ?? 0;
    const short = g.op === ">=" ? Math.max(0, ref - tol - x) : Math.max(0, x - ref - tol);
    const v = short / g.scale;
    if (v > 0) broken.push(g.label);
    cv += v;
    if (!g.relaxable) cvHard += v;
  }
  return { cv, cvHard, broken };
}

/** NSGA-II objectives, all to minimise (from the criteria). */
function objectives(c: Cand, seeds: number[]): number[] {
  const m = means(c, seeds);
  return criteria().objectives.map((o) => (o.dir === "max" ? -(m[o.measure] ?? -1e9) : (m[o.measure] ?? 1e9))).map((x) => (Number.isFinite(x) ? x : 1e9));
}

/** The orchestrator's six axes: useful/day, old moved, disposals, trips, held all-due, never heard. */
function sixAxes(c: Cand, seeds: number[]): number[] {
  const m = means(c, seeds);
  return [-m[M.useful]!, -m[M.sub4y]!, -m[M.disposals]!, m[M.trips]!, -m[M.heldAllDue]!, m[M.neverHeard]!].map((x) => (Number.isFinite(x) ? x : 1e9));
}

interface Scored {
  c: Cand;
  f: number[];
  cv: number;
  rank: number;
  crowd: number;
}

function dominates(a: Scored, b: Scored): boolean {
  if (a.cv === 0 && b.cv > 0) return true;
  if (a.cv > 0 && b.cv === 0) return false;
  if (a.cv > 0 && b.cv > 0) return a.cv < b.cv;
  let better = false;
  for (let i = 0; i < a.f.length; i++) {
    if (a.f[i]! > b.f[i]! + 1e-12) return false;
    if (a.f[i]! < b.f[i]! - 1e-12) better = true;
  }
  return better;
}

/** Fast non-dominated sort with constrained domination, then crowding distance within each front. */
function nsgaSort(xs: Scored[]): Scored[][] {
  const S = xs.map(() => [] as number[]);
  const n = xs.map(() => 0);
  const fronts: number[][] = [[]];
  for (let p = 0; p < xs.length; p++) {
    for (let q = 0; q < xs.length; q++) {
      if (p === q) continue;
      if (dominates(xs[p]!, xs[q]!)) S[p]!.push(q);
      else if (dominates(xs[q]!, xs[p]!)) n[p]!++;
    }
    if (n[p] === 0) {
      xs[p]!.rank = 0;
      fronts[0]!.push(p);
    }
  }
  let i = 0;
  while (fronts[i]!.length) {
    const next: number[] = [];
    for (const p of fronts[i]!)
      for (const q of S[p]!) {
        n[q]!--;
        if (n[q] === 0) {
          xs[q]!.rank = i + 1;
          next.push(q);
        }
      }
    i++;
    fronts.push(next);
  }
  const out = fronts.filter((f) => f.length).map((f) => f.map((k) => xs[k]!));
  for (const front of out) {
    for (const s of front) s.crowd = 0;
    const m = front[0]?.f.length ?? 0;
    for (let k = 0; k < m; k++) {
      front.sort((a, b) => a.f[k]! - b.f[k]!);
      const lo = front[0]!.f[k]!;
      const hi = front[front.length - 1]!.f[k]!;
      front[0]!.crowd = Infinity;
      front[front.length - 1]!.crowd = Infinity;
      if (hi - lo <= 0) continue;
      for (let j = 1; j < front.length - 1; j++) front[j]!.crowd += (front[j + 1]!.f[k]! - front[j - 1]!.f[k]!) / (hi - lo);
    }
  }
  return out;
}

const scoredOf = (cs: Cand[], seeds: number[]): Scored[] => cs.map((c) => ({ c, f: objectives(c, seeds), cv: violation(c, seeds).cv, rank: 0, crowd: 0 }));

/** Keep n by front, then crowding. */
function selectN(xs: Scored[], n: number): Scored[] {
  const out: Scored[] = [];
  for (const front of nsgaSort(xs)) {
    if (out.length + front.length <= n) out.push(...front);
    else {
      out.push(...[...front].sort((a, b) => b.crowd - a.crowd).slice(0, n - out.length));
      break;
    }
  }
  return out;
}

const better = (a: Scored, b: Scored): Scored => (a.rank !== b.rank ? (a.rank < b.rank ? a : b) : a.crowd >= b.crowd ? a : b);

/**
 * The pre-registered selection: guardrails first (feasible before infeasible, then less violation), then
 * useful hearings per day, then the number of measures on which the candidate is best or tied among `field`.
 */
function preRegistered(cs: Cand[], seeds: number[], field: Cand[]): Cand[] {
  const bestCount = (c: Cand) => {
    const m = means(c, seeds);
    let n = 0;
    for (const k of SCORED) {
      const vals = field.map((x) => means(x, seeds)[k]).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
      if (!vals.length || !Number.isFinite(m[k]!)) continue;
      const best = DIRECTION[k] === "higher" ? Math.max(...vals) : Math.min(...vals);
      if (Math.abs(m[k]! - best) <= 1e-9 + 0.005 * Math.abs(best)) n++;
    }
    return n;
  };
  const rows = cs.map((c) => ({ c, cv: violation(c, seeds).cv, useful: means(c, seeds)[criteria().primary] ?? -1e9, best: bestCount(c) }));
  const relax = criteria().guardrails.filter((g) => g.relaxable);
  if (relax.length) {
    // the relaxable guardrails: when nothing meets them, each is relaxed to the smallest level a candidate
    // meeting every hard guardrail reaches (plus 5%); the primary measure decides within that level
    const hard = rows.filter((r) => violation(r.c, seeds).cvHard === 0);
    const levels = relax.map((g) => {
      const vals = hard.map((r) => means(r.c, seeds)[g.measure] ?? (g.op === "<=" ? 1e9 : -1e9));
      const best = g.op === "<=" ? Math.min(...vals) : Math.max(...vals);
      const lim = g.value ?? best;
      return g.op === "<=" ? Math.max(lim, best * 1.05) : Math.min(lim, best * 0.95);
    });
    const inLevel = (r: (typeof rows)[number]) =>
      violation(r.c, seeds).cvHard === 0 && relax.every((g, i) => { const x = means(r.c, seeds)[g.measure] ?? NaN; return g.op === "<=" ? x <= levels[i]! : x >= levels[i]!; });
    rows.sort((a, b) => (inLevel(a) !== inLevel(b) ? (inLevel(a) ? -1 : 1) : inLevel(a) ? b.useful - a.useful || b.best - a.best : a.cv - b.cv || b.useful - a.useful));
    return rows.map((r) => r.c);
  }
  rows.sort((a, b) => (a.cv === 0) !== (b.cv === 0) ? (a.cv === 0 ? -1 : 1) : a.cv > 0 && Math.abs(a.cv - b.cv) > 1e-9 ? a.cv - b.cv : b.useful - a.useful || b.best - a.best);
  return rows.map((r) => r.c);
}

// ---------------------------------------------------------------------------------------------
// Reporting

const fmt = (x: number | undefined, k: string): string => {
  if (x === undefined || !Number.isFinite(x)) return "n/a";
  if (k.includes("Share") || k.includes("heldOn") || k.includes("utilisation") || k.includes("reachRate") || k.includes("substantiveness") || k.includes("wasted") || k.includes("judgeTime") || k.includes("heldAs")) return `${(x * 100).toFixed(1)}%`;
  return Math.abs(x) >= 100 ? x.toFixed(0) : x.toFixed(2);
};
const LABEL: Record<string, string> = {
  [M.useful]: "Useful (substantive) hearings per day",
  [M.sub4y]: "4y+ cases with a substantive hearing",
  [M.heard4y]: "4y+ cases heard at all",
  [M.disposals]: "Headline disposals",
  [M.trips]: "Trips per useful hearing",
  [M.held]: "Held on the promised date",
  [M.overrun]: "Days that overran",
  [M.excess]: "Next-date excess over the minimum (days)",
  [M.wasted]: "Wasted listings",
  [M.heldAllDue]: "Held as scheduled (all due)",
  [M.neverHeard]: "Cases never heard",
  [M.neverActed]: "Cases never acted on (no hearing reached, no desk action)",
};
const label = (k: string) => LABEL[k] ?? k;

function genomeLine(g: Genome): string {
  return `${g.selection} / first ${g.firstDates} / next ${g.nextDate} / coverage ${g.coverage} / desk ${g.desk ? "on" : "off"} / check-in ${g.checkin ? (g.checkinRobust ? "robust" : "on") : "off"} / calib ${g.calibration} / fill ${g.fillTarget.toFixed(2)} / standby ${g.standbyShare.toFixed(2)}`;
}

function familyTable(front: Cand[], all: Cand[]): string[] {
  const genes: (keyof Genome)[] = ["selection", "firstDates", "nextDate", "coverage", "callOrder", "calibration", "caseEstimate", "priorCheck", "desk", "checkin", "checkinRobust", "cluster", "callTimes", "quickRelist", "gapOfHeard", "countDiary", "purposeDays", "carryForward"];
  const L: string[] = ["| Gene | Value | Share of the top set | Share of all evaluated |", "|---|---|---|---|"];
  const fg = front.filter((c) => c.genome).map((c) => c.genome!);
  const ag = all.filter((c) => c.genome).map((c) => c.genome!);
  for (const gene of genes) {
    const values = [...new Set(ag.map((g) => String(g[gene])))].sort();
    for (const v of values) {
      const fs = fg.filter((g) => String(g[gene]) === v).length / Math.max(1, fg.length);
      const as = ag.filter((g) => String(g[gene]) === v).length / Math.max(1, ag.length);
      L.push(`| ${gene} | ${v} | ${(fs * 100).toFixed(0)}% | ${(as * 100).toFixed(0)}% |`);
    }
  }
  const nums: string[] = ["fillTarget", "standbyShare", "promiseFill", "initialFill", "firstOldShare", "ageExponent", "ageingFloor", "relistDays", "relistCap", "pendingHold"];
  L.push("", "| Dial | Mean in the top set | Mean of all evaluated |", "|---|---|---|");
  for (const k of nums) {
    const f = mean(fg.map((g) => (g as unknown as Record<string, number>)[k]!));
    const a = mean(ag.map((g) => (g as unknown as Record<string, number>)[k]!));
    L.push(`| ${k} | ${f.toFixed(2)} | ${a.toFixed(2)} |`);
  }
  for (const w of ["throughput", "disposal", "fairness", "trips", "predictability"] as const)
    L.push(`| weight ${w} | ${mean(fg.map((g) => g.weights[w])).toFixed(2)} | ${mean(ag.map((g) => g.weights[w])).toFixed(2)} |`);
  return L;
}

// ---------------------------------------------------------------------------------------------
// The run

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "candidates.jsonl"), "");
  const rng = new Rng(RNG_SEED);
  log(`starting ${WORKERS} workers`);
  await pool.start(WORKERS);

  // references: every baseline and the current benchtime on every seed used (tuning and validation)
  const refs = [...BASELINES, ...RIVALS].map(addPolicy);
  await evalOn(refs, S3, "reference");
  log(`references on seeds 1-20 done (${pool.runs} runs, ${(pool.ms / Math.max(1, pool.runs) / 1000).toFixed(2)} s per run)`);

  // stage 1: every preset and N random genomes on seeds 1-4
  const presetCands = Object.entries(PRESETS).map(([name, g]) => addGenome(g, "preset", name));
  const s1: Cand[] = [...presetCands];
  for (let i = 0; i < N_RANDOM; i++) s1.push(addGenome(randomGenome(rng), "random"));
  // mutants of every candidate preset seed the space around the redesigns too
  for (const p of presetCands.filter((c) => c.genome!.enforceFloor)) for (let k = 0; k < (SMOKE ? 0 : 3); k++) s1.push(addGenome(mutate(p.genome!, rng, 0.25), `mutant of ${p.name}`));
  await evalOn(s1, S1, "stage1");
  const s1ok = s1.filter((c) => !failed(c, S1));
  log(`stage 1: ${s1.length} genomes on seeds 1-4 (${s1.length - s1ok.length} failed); ${pool.runs} runs so far`);

  // stage 2: NSGA-II on seeds 1-6, starting from the best of stage 1 (floor-honouring genomes only)
  const eligible = s1ok.filter((c) => c.genome!.enforceFloor);
  let pop = selectN(scoredOf(eligible, S1), POP).map((s) => s.c);
  await evalOn(pop, S2, "stage2-init");
  let scored = scoredOf(pop, S2);
  nsgaSort(scored);
  // the time budget: generations run while there is time for one more and for stages 3 and 4 after it
  const runsPerMin = () => pool.runs / Math.max(0.1, elapsedMin());
  const reserveMin = () => (30 * 14 + Object.keys(PRESETS).length * 16 + (8 + refs.length + Object.keys(PRESETS).length) * 10) / runsPerMin() + 1;
  let gen = 0;
  for (; gen < GENS; gen++) {
    if (elapsedMin() + (POP * S2.length) / runsPerMin() + reserveMin() > BUDGET_MIN) {
      log(`stage 2 stopped after ${gen} generations: time budget (${runsPerMin().toFixed(0)} runs a minute)`);
      break;
    }
    const kids: Cand[] = [];
    const seen = new Set(pop.map((c) => c.key));
    let tries = 0;
    while (kids.length < POP && tries < POP * 20) {
      tries++;
      const a = better(scored[Math.floor(rng.next() * scored.length)]!, scored[Math.floor(rng.next() * scored.length)]!);
      const b = better(scored[Math.floor(rng.next() * scored.length)]!, scored[Math.floor(rng.next() * scored.length)]!);
      const child = mutate(rng.next() < 0.9 ? crossover(a.c.genome!, b.c.genome!, rng) : a.c.genome!, rng, 0.12);
      const k = genomeKey(child);
      if (seen.has(k)) continue;
      seen.add(k);
      kids.push(addGenome(child, `nsga gen ${gen + 1}`));
    }
    await evalOn(kids, S2, `stage2-gen${gen + 1}`);
    const merged = scoredOf([...pop, ...kids.filter((c) => !failed(c, S2))], S2);
    const next = selectN(merged, POP);
    pop = next.map((s) => s.c);
    scored = scoredOf(pop, S2);
    nsgaSort(scored);
    const feasible = scored.filter((s) => s.cv === 0).length;
    const top = [...scored].sort((x, y) => x.f[0]! - y.f[0]!)[0]!;
    log(`stage 2 gen ${gen + 1}: ${kids.length} children; ${feasible}/${scored.length} feasible; best useful/day ${(-top.f[0]!).toFixed(2)}; ${pool.runs} runs`);
  }

  // stage 3: the top 30 of all genomes evaluated on seeds 1-6, re-scored on seeds 1-20
  const top30 = stageSets().top30;
  await evalOn([...top30, ...presetCands], S3, "stage3");
  log(`stage 3: top 30 re-scored on seeds 1-20; ${scoredOf(top30, S3).filter((s) => s.cv === 0).length} feasible; ${pool.runs} runs`);

  // stage 4: the top 8 by the pre-registered selection on validation seeds 21-30, with every comparator
  const { top8, comparators } = stageSets();
  await evalOn([...top8, ...comparators], S4, "stage4");
  log(`stage 4 done; ${pool.runs} runs in total`);
  pool.stop();
  const meta = { gen, wallMin: elapsedMin(), runs: pool.runs, msPerRun: pool.ms / Math.max(1, pool.runs) };
  // every run kept, so the report can be checked or rebuilt without simulating again (--report-only)
  writeFileSync(join(OUT, "runs.json"), JSON.stringify({ meta, cands: [...cands.values()].map((c) => ({ key: c.key, name: c.name, origin: c.origin, policy: c.policy, genome: c.genome, runs: Object.fromEntries(c.runs) })) }));
  writeReport(meta);
}

/** The candidate sets of stages 3 and 4, recomputed from the runs (deterministic given the same runs). */
function stageSets() {
  const refs = [...BASELINES, ...RIVALS].map((id) => cands.get(`policy:${id}`)!).filter(Boolean);
  const presetCands = Object.keys(PRESETS).map((n) => cands.get(genomeKey(PRESETS[n]!))!).filter(Boolean);
  const s1ok = [...cands.values()].filter((c) => c.genome && S1.every((s) => c.runs.has(s)) && !failed(c, S1));
  const onS2 = [...cands.values()].filter((c) => c.genome && c.genome.enforceFloor && S2.every((s) => c.runs.has(s)) && !failed(c, S2));
  const top30 = selectN(scoredOf(onS2, S2), 30).map((s) => s.c);
  const top8 = top30.every((c) => S3.every((s) => c.runs.has(s))) ? preRegistered(top30, S3, [...top30, ...refs]).slice(0, 8) : [];
  const comparators = [...refs, ...presetCands];
  return { refs, presetCands, s1ok, onS2, top30, top8, comparators };
}

function writeReport(meta: { gen: number; wallMin: number; runs: number; msPerRun: number }): void {
  const { refs, presetCands, s1ok, onS2, top30, top8, comparators } = stageSets();
  const gen = meta.gen;
  const s3Scored = scoredOf(top30, S3);
  const fronts3 = nsgaSort(s3Scored);
  // named finalists from outside the zoo (the ADP planner) are judged by the same rule
  const extras = [...cands.values()].filter((c) => c.origin.startsWith("named finalist") && S4.every((s) => c.runs.has(s)));
  const field4 = [...top8, ...extras, ...comparators];
  const ranked4 = preRegistered([...top8, ...extras], S4, field4);
  const winner = ranked4[0]!;
  const bestGenome = ranked4.find((c) => c.genome)!;
  // ---- outputs
  const wv = violation(winner, S4);
  writeFileSync(
    join(OUT, "winner.json"),
    JSON.stringify(
      {
        // the best zoo genome (what benchtime's default can be set from); overallWinner names a named
        // finalist from outside the zoo when it outranks every genome under the same rule
        name: bestGenome.name,
        origin: bestGenome.origin,
        key: bestGenome.key,
        description: describeGenome(bestGenome.genome!),
        validationSeeds: S4,
        guardrailsBroken: violation(bestGenome, S4).broken,
        validation: Object.fromEntries(SCORED.map((k) => [k, { mean: means(bestGenome, S4)[k], ci95: ci95(valuesOn(bestGenome, S4, k)) }])),
        overallWinner: winner === bestGenome ? null : { name: winner.name, policy: winner.policy, origin: winner.origin, guardrailsBroken: wv.broken, validation: Object.fromEntries(SCORED.map((k) => [k, { mean: means(winner, S4)[k], ci95: ci95(valuesOn(winner, S4, k)) }])) },
        genome: bestGenome.genome,
      },
      null,
      2,
    ) + "\n",
  );

  const L: string[] = [];
  const nGenomes = [...cands.values()].filter((c) => c.genome).length;
  L.push("# Tournament of scheduling approaches", "");
  L.push(
    `Approaches tried: ${nGenomes} distinct genomes of the zoo meta-policy (src/planner/zoo.ts): ${Object.keys(PRESETS).length} named presets (every baseline, judge and redesign), ${[...cands.values()].filter((c) => c.origin === "random").length} random genomes, ${[...cands.values()].filter((c) => c.origin.startsWith("mutant")).length} mutants of the presets and ${[...cands.values()].filter((c) => c.origin.startsWith("nsga")).length} children over ${gen} generations of NSGA-II. Plus ${refs.length} reference policies run as coded. ${meta.runs} simulations of the corrected world (roster seed 42, 2026-10-01 to 2026-12-15), ${(meta.msPerRun / 1000).toFixed(2)} s each, ${meta.wallMin.toFixed(0)} minutes of wall time on ${WORKERS} workers.`,
    "",
    "Seeds: tuning 1-4 (stage 1), 1-6 (stage 2, NSGA-II), 1-20 (stage 3), validation 21-30 (stage 4). The held-out test seeds 31-60 were never used. Every candidate ran on the same world seeds (common random numbers).",
    "",
    `Criteria in force: ${criteria().name}. Guardrails (noise tolerance in brackets): ${criteria()
      .guardrails.map((g) => `${g.label} ${g.op === ">=" ? "at least" : "at most"} ${g.vs === "absolute" ? g.value : g.vs === "status_quo_60" ? "status_quo_60's" : g.vs === "best_rival_all" ? "the best of the baselines and the original benchtime" : "the best baseline's"}${g.tol ? ` (${g.tol})` : ""}${g.relaxable ? ", relaxed to the smallest level reached if nothing meets it" : ""}`)
      .join("; ")}. Then the most ${label(criteria().primary).toLowerCase()}, then the most measures best or tied. NSGA-II objectives: ${criteria().objectives.map((o) => `${o.dir === "max" ? "maximise" : "minimise"} ${label(o.measure).toLowerCase()}`).join(", ")}.`,
    "",
    criteria().note ? `Why the criteria changed: ${criteria().note} The original rule's pick is shown side by side below. A new gene (rotationAll: the rotation covers every case, a hearing or a desk action every K working days) was added with the amendment and seeded into the search.` : "",
    "",
  );

  L.push("## The winner", "");
  if (winner !== bestGenome) {
    L.push(`**${winner.name}** (${winner.origin}) ranks first under the pre-registered selection on the validation seeds. ${wv.broken.length ? `Guardrails it breaks: ${wv.broken.join(", ")}.` : "It breaks no guardrail."}`, "");
    L.push("The best zoo genome, which winner.json carries:", "");
  }
  const bv = violation(bestGenome, S4);
  L.push(`**${bestGenome.name}** (${bestGenome.origin}). ${describeGenome(bestGenome.genome!)}`, "");
  L.push(`Genes: ${genomeLine(bestGenome.genome!)}.`, "");
  L.push(bv.broken.length ? `Guardrails broken on validation seeds: ${bv.broken.join(", ")}.` : "Every guardrail holds on the validation seeds.", "");

  // validation table: winner vs every baseline, preset and benchtime
  // the baseline presets reproduce the reference policies run for run, so only the redesign presets get columns
  const cols = [...new Set([winner, bestGenome, ...extras, ...refs, ...presetCands.filter((c) => !BASELINES.includes(c.name))])];
  L.push("## Validation (seeds 21-30): the winner against every baseline, preset and the current benchtime", "");
  L.push("Means over ten seeds; the winner's 95% interval in brackets.", "");
  const head = ["Measure", ...cols.map((c) => c.name)];
  L.push(`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`);
  for (const k of SCORED) {
    const row = [label(k), ...cols.map((c, i) => (i === 0 ? `${fmt(means(c, S4)[k], k)} [±${fmt(ci95(valuesOn(c, S4, k)), k)}]` : fmt(means(c, S4)[k], k)))];
    L.push(`| ${row.join(" | ")} |`);
  }
  L.push("");
  L.push("### Stage 4 ranking (pre-registered selection on validation seeds)", "");
  L.push("| Rank | Candidate | Guardrails broken | Useful/day | 4y+ substantive | Disposals | Trips/useful | Held on promise | Held all-due | Never acted on | Overrun days |", "|---|---|---|---|---|---|---|---|---|---|---|");
  ranked4.forEach((c, i) => {
    const m = means(c, S4);
    L.push(`| ${i + 1} | ${c.name} (${c.origin}) | ${violation(c, S4).broken.join(", ") || "none"} | ${fmt(m[M.useful], M.useful)} | ${fmt(m[M.sub4y], M.sub4y)} | ${fmt(m[M.disposals], M.disposals)} | ${fmt(m[M.trips], M.trips)} | ${fmt(m[M.held], M.held)} | ${fmt(m[M.heldAllDue], M.heldAllDue)} | ${fmt(m[M.neverActed], M.neverActed)} | ${fmt(m[M.overrun], M.overrun)} |`);
  });
  L.push("");
  // side by side: what the original rule picked (its run's winner.json, kept in old-rule/)
  try {
    const old = JSON.parse(readFileSync(join(OUT, "old-rule", "winner.json"), "utf8")) as { name: string; description: string; key: string; genome?: Genome };
    const oc = old.genome ? cands.get(genomeKey(validate(old.genome))) : undefined;
    L.push("### What the original rule picked", "");
    L.push(`Under the original rule (before the 14:05 amendment) the tournament picked **${old.name}**: ${old.description}`, "");
    if (oc && S4.every((s2) => oc.runs.has(s2))) {
      const m = means(oc, S4);
      const w = means(winner, S4);
      L.push("| Measure (validation seeds 21-30) | Original rule's pick | Amended rule's pick | status_quo_60 |", "|---|---|---|---|");
      const sq = means(cands.get("policy:status_quo_60")!, S4);
      for (const k of [M.useful, M.sub4y, M.heard4y, M.disposals, M.trips, M.held, M.heldAllDue, M.neverHeard, M.neverActed, M.overrun, M.excess, M.wasted]) L.push(`| ${label(k)} | ${fmt(m[k], k)} | ${fmt(w[k], k)} | ${fmt(sq[k], k)} |`);
      L.push("", `Guardrails the original rule's pick breaks under the amended rule: ${violation(oc, S4).broken.join(", ") || "none"}.`);
    }
    L.push("");
  } catch {}
  L.push("");
  L.push("Presets and baselines on the validation seeds, with the guardrails they break:", "");
  L.push("| Candidate | Guardrails broken | Useful/day | 4y+ substantive |", "|---|---|---|---|");
  for (const c of comparators) L.push(`| ${c.name} | ${violation(c, S4).broken.join(", ") || "none"} | ${fmt(means(c, S4)[M.useful], M.useful)} | ${fmt(means(c, S4)[M.sub4y], M.sub4y)} |`);
  L.push("");

  L.push("## Pareto front (stage 3, seeds 1-20)", "");
  L.push("Constrained non-dominated sorting on the six objectives (useful hearings per day, 4y+ substantive share, headline disposals, trips per useful hearing, held on the promised date, overrun days).", "");
  L.push("| Front | Candidate | Origin | Guardrails broken | Useful/day | 4y+ subst. | 4y+ heard | Disposals | Trips/useful | Held | Overrun | Excess | Wasted | Genes |", "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const [fi, front] of fronts3.entries())
    for (const s of front) {
      const m = means(s.c, S3);
      L.push(
        `| ${fi + 1} | ${s.c.name} | ${s.c.origin} | ${violation(s.c, S3).broken.join(", ") || "none"} | ${fmt(m[M.useful], M.useful)} | ${fmt(m[M.sub4y], M.sub4y)} | ${fmt(m[M.heard4y], M.heard4y)} | ${fmt(m[M.disposals], M.disposals)} | ${fmt(m[M.trips], M.trips)} | ${fmt(m[M.held], M.held)} | ${fmt(m[M.overrun], M.overrun)} | ${fmt(m[M.excess], M.excess)} | ${fmt(m[M.wasted], M.wasted)} | ${genomeLine(s.c.genome!)} |`,
      );
    }
  L.push("");
  L.push("Reference policies on seeds 1-20:", "");
  L.push("| Policy | Useful/day | 4y+ subst. | 4y+ heard | Disposals | Trips/useful | Held | Overrun | Excess | Wasted |", "|---|---|---|---|---|---|---|---|---|---|");
  for (const c of refs) {
    const m = means(c, S3);
    L.push(`| ${c.name} | ${fmt(m[M.useful], M.useful)} | ${fmt(m[M.sub4y], M.sub4y)} | ${fmt(m[M.heard4y], M.heard4y)} | ${fmt(m[M.disposals], M.disposals)} | ${fmt(m[M.trips], M.trips)} | ${fmt(m[M.held], M.held)} | ${fmt(m[M.overrun], M.overrun)} | ${fmt(m[M.excess], M.excess)} | ${fmt(m[M.wasted], M.wasted)} |`);
  }
  L.push("");

  // the six axes the orchestrator asked for, and whether held-as-scheduled and never-heard can be closed
  const nondominated = (cs: Cand[], seeds: number[]): Cand[] => {
    const f = cs.map((c) => sixAxes(c, seeds));
    return cs.filter((_, i) => !f.some((g, j) => j !== i && g.every((x, k) => x <= f[i]![k]! + 1e-12) && g.some((x, k) => x < f[i]![k]! - 1e-12)));
  };
  const pool6 = [...top30, ...presetCands, ...refs, ...[...cands.values()].filter((c) => c.origin.startsWith("named finalist") && S3.every((s) => c.runs.has(s)))];
  const front6 = nondominated(pool6, S3);
  L.push("## Pareto front on six axes (seeds 1-20)", "");
  L.push("Useful hearings per day, 4y+ cases moved (a substantive hearing), headline disposals, trips per useful hearing, held as scheduled (all due) and cases never heard; non-dominated among the top 30, every preset and every reference policy.", "");
  L.push("| Candidate | Origin | Useful/day | 4y+ moved | Disposals | Trips/useful | Held all-due | Never heard | Never acted on |", "|---|---|---|---|---|---|---|---|---|");
  for (const c of [...front6].sort((a, b) => means(b, S3)[M.useful]! - means(a, S3)[M.useful]!)) {
    const m = means(c, S3);
    L.push(`| ${c.name} | ${c.origin} | ${fmt(m[M.useful], M.useful)} | ${fmt(m[M.sub4y], M.sub4y)} | ${fmt(m[M.disposals], M.disposals)} | ${fmt(m[M.trips], M.trips)} | ${fmt(m[M.heldAllDue], M.heldAllDue)} | ${fmt(m[M.neverHeard], M.neverHeard)} | ${fmt(m[M.neverActed], M.neverActed)} |`);
  }
  L.push("");
  {
    const sq2 = means(cands.get("policy:status_quo_60")!, S2);
    const rows = onS2.map((c) => ({ c, m: means(c, S2) }));
    const gains = (m: Measures) => m[M.useful]! > sq2[M.useful]! && m[M.sub4y]! >= sq2[M.sub4y]! - 0.005 && m[M.disposals]! >= sq2[M.disposals]! - 2 && m[M.trips]! <= sq2[M.trips]!;
    const closes = (m: Measures, slackHeld: number, slackNever: number) => m[M.heldAllDue]! >= sq2[M.heldAllDue]! - slackHeld && m[M.neverHeard]! <= sq2[M.neverHeard]! + slackNever;
    L.push("## Held as scheduled and never heard: closable or a trade-off?", "");
    L.push(`Status quo 60 on seeds 1-6: held as scheduled (all due) ${fmt(sq2[M.heldAllDue], M.heldAllDue)}, never heard ${fmt(sq2[M.neverHeard], M.neverHeard)}, useful/day ${fmt(sq2[M.useful], M.useful)}. "Keeps the gains" = more useful hearings per day than the status quo, 4y+ moved and disposals not worse, trips per useful hearing not higher.`, "");
    L.push("| Tolerance on held all-due / never heard | Genomes that close both | Of those, keeping the gains | Best useful/day among them |", "|---|---|---|---|");
    for (const [sh, sn] of [[0, 0], [0.05, 100], [0.1, 250], [0.2, 500]] as [number, number][]) {
      const cl = rows.filter((r) => closes(r.m, sh, sn));
      const kg = cl.filter((r) => gains(r.m));
      const best = kg.length ? Math.max(...kg.map((r) => r.m[M.useful]!)) : NaN;
      L.push(`| ${(sh * 100).toFixed(0)} points / ${sn} cases | ${cl.length} | ${kg.length} | ${fmt(best, M.useful)} |`);
    }
    L.push("");
    L.push("The frontier: the most useful hearings per day found at each level of held as scheduled (all due), among genomes that keep the other gains (seeds 1-6).", "");
    L.push("| Held all-due at least | Best useful/day | Its never heard | Genes |", "|---|---|---|---|");
    for (const t of [0.5, 0.6, 0.7, 0.75, 0.8, 0.85, 0.9]) {
      const ok = rows.filter((r) => r.m[M.heldAllDue]! >= t && r.m[M.sub4y]! >= sq2[M.sub4y]! - 0.005 && r.m[M.disposals]! >= sq2[M.disposals]! - 2);
      if (!ok.length) {
        L.push(`| ${(t * 100).toFixed(0)}% | none found | | |`);
        continue;
      }
      const b = ok.reduce((x, y) => (y.m[M.useful]! > x.m[M.useful]! ? y : x));
      L.push(`| ${(t * 100).toFixed(0)}% | ${fmt(b.m[M.useful], M.useful)} | ${fmt(b.m[M.neverHeard], M.neverHeard)} | ${genomeLine(b.c.genome!)} |`);
    }
    L.push("");
  }

  // the frontier the amended rule asks for: useful hearings against cases never acted on
  {
    const hardOK = onS2.filter((c) => violation(c, S2).cvHard === 0);
    L.push("## Useful hearings against cases never acted on (seeds 1-6)", "");
    L.push(`Among the ${hardOK.length} genomes that meet every other guardrail${RULE === "amended" ? " (including held on the promised date and held as scheduled)" : ""}: the most useful hearings per day found at each ceiling on cases never acted on (no hearing reached, no desk action).`, "");
    L.push("| Never acted on at most | Genomes | Best useful/day | Its 4y+ moved | Its disposals | Its held on promise | Genes |", "|---|---|---|---|---|---|---|");
    for (const t of [300, 400, 500, 600, 800, 1000, 1200, 1500, 2000]) {
      const ok = hardOK.filter((c) => (means(c, S2)[M.neverActed] ?? 1e6) <= t);
      if (!ok.length) {
        L.push(`| ${t} | 0 | none | | | | |`);
        continue;
      }
      const b = ok.reduce((x, y) => (means(y, S2)[M.useful]! > means(x, S2)[M.useful]! ? y : x));
      const m = means(b, S2);
      L.push(`| ${t} | ${ok.length} | ${fmt(m[M.useful], M.useful)} | ${fmt(m[M.sub4y], M.sub4y)} | ${fmt(m[M.disposals], M.disposals)} | ${fmt(m[M.held], M.held)} | ${genomeLine(b.genome!)}${b.genome!.rotationAll ? " / rotation covers every case" : ""} |`);
    }
    L.push("");
  }

  // fidelity: each redesign preset against its source planner re-benched on the corrected court
  {
    const SRC: Record<string, string> = { g_index: "index", c_portfolio: "portfolio", b_horizon: "horizon", a_fillfair: "fill-fair", f_lookahead: "lookahead", e_search: "search" };
    const keys = [M.useful, M.heard4y, M.sub4y, M.disposals, M.trips, M.wasted, M.excess, M.heldAllDue, M.neverHeard, M.neverActed];
    const rowsF: string[] = [];
    for (const [preset, src] of Object.entries(SRC)) {
      let fields: Record<string, { mean: number }> | null = null;
      try {
        const d = JSON.parse(readFileSync(`/tmp/rebench/${src}/arena.json`, "utf8")) as { cells: { fields: Record<string, { mean: number }> }[] };
        fields = d.cells[0]?.fields ?? null;
      } catch {}
      const c = cands.get(genomeKey(PRESETS[preset]!));
      if (!c) continue;
      const m = means(c, S3);
      rowsF.push(`| ${preset} (zoo) | ${keys.map((k) => fmt(m[k], k)).join(" | ")} |`);
      if (fields) rowsF.push(`| ${src} (source planner) | ${keys.map((k) => fmt(fields![k]?.mean, k)).join(" | ")} |`);
    }
    L.push("## Fidelity: redesign presets against their source planners (corrected court, seeds 1-20)", "");
    L.push("Baselines and judges reproduce their coded policies exactly on seed 1 (test/zoo.test.ts checks seeds 1-3). The redesigns are re-implemented from their components, so they match in kind, not to the decimal.", "");
    L.push(`| Candidate | ${keys.map(label).join(" | ")} |`, `|---|${keys.map(() => "---").join("|")}|`);
    L.push(...rowsF, "");
  }

  // family breakdown: which components win
  const allEval = [...cands.values()].filter((c) => c.genome && c.genome.enforceFloor && !failed(c, S1));
  const feasibleS2 = onS2.filter((c) => violation(c, S2).cv === 0);
  L.push("## Which components win", "");
  L.push(`Top set = the 30 candidates re-scored in stage 3 (chosen by constrained non-dominated sorting on seeds 1-6). ${feasibleS2.length} of ${onS2.length} genomes evaluated on seeds 1-6 met every guardrail.`, "");
  L.push(...familyTable(top30, allEval), "");
  L.push("### Stage 1 by family (seeds 1-4): mean useful hearings per day and share meeting every guardrail", "");
  for (const gene of ["selection", "firstDates", "nextDate", "coverage", "calibration", "desk", "checkin"] as (keyof Genome)[]) {
    L.push(`| ${gene} | n | Useful/day | 4y+ subst. | Trips/useful | Meets guardrails |`, "|---|---|---|---|---|---|");
    const groups = new Map<string, Cand[]>();
    for (const c of s1ok.filter((x) => x.genome!.enforceFloor)) {
      const v = String(c.genome![gene]);
      groups.set(v, [...(groups.get(v) ?? []), c]);
    }
    for (const [v, cs] of [...groups].sort()) {
      const u = mean(cs.map((c) => means(c, S1)[M.useful]!));
      const s4 = mean(cs.map((c) => means(c, S1)[M.sub4y]!));
      const tr = mean(cs.map((c) => means(c, S1)[M.trips]!));
      const ok = cs.filter((c) => violation(c, S1).cv === 0).length / cs.length;
      L.push(`| ${v} | ${cs.length} | ${u.toFixed(2)} | ${(s4 * 100).toFixed(1)}% | ${tr.toFixed(2)} | ${(ok * 100).toFixed(0)}% |`);
    }
    L.push("");
  }
  writeFileSync(join(OUT, "summary.md"), L.join("\n") + "\n");
  console.log(`wrote ${join(OUT, "summary.md")} and winner.json`);
}

async function reportOnly(): Promise<void> {
  let meta = loadSaved(join(OUT, "runs.json"));
  const ai = process.argv.indexOf("--adp");
  if (ai >= 0) {
    const runs = JSON.parse(readFileSync(process.argv[ai + 1]!, "utf8")) as Record<string, Measures>;
    cands.set("policy:adp", { key: "policy:adp", name: "adp", origin: "named finalist (ADP learned case value; tuned on seeds 13-20, so its seeds 1-20 numbers are optimistic)", policy: "adp", runs: new Map(Object.entries(runs).map(([s2, m]) => [Number(s2), m] as [number, Measures])) });
  }
  if (!meta) {
    // an older runs.json without its meta: rebuild it from the stage log and the run log
    const stages = readFileSync(join(OUT, "candidates.jsonl"), "utf8").match(/"stage":"stage2-gen(\d+)"/g) ?? [];
    const gens = Math.max(0, ...stages.map((x) => Number(/(\d+)/.exec(x)![1])));
    const logText = readFileSync(join(OUT, "run.log"), "utf8");
    const mins = [...logText.matchAll(/\[([\d.]+) min\]/g)].map((m) => Number(m[1]));
    const secs = [...logText.matchAll(/([\d.]+) s per run/g)].map((m) => Number(m[1]));
    meta = { gen: gens, wallMin: mins.length ? mins[mins.length - 1]! : NaN, runs: [...cands.values()].reduce((n, c) => n + c.runs.size, 0), msPerRun: secs.length ? secs[0]! * 1000 : NaN };
  }
  writeReport(meta);
}

/** Load a saved runs.json into the candidate table (keys recomputed, so genomes saved before a new gene still match). */
function loadSaved(path: string): { gen: number; wallMin: number; runs: number; msPerRun: number } | null {
  type Saved = { key: string; name: string; origin: string; policy?: string; genome?: Genome; runs: Record<string, Measures> }[];
  const raw = JSON.parse(readFileSync(path, "utf8")) as Saved | { meta: { gen: number; wallMin: number; runs: number; msPerRun: number }; cands: Saved };
  const list = Array.isArray(raw) ? raw : raw.cands;
  for (const c of list) {
    const genome = c.genome ? validate(c.genome) : undefined;
    const key = genome ? genomeKey(genome) : c.key;
    const prev = cands.get(key);
    const runs = new Map(Object.entries(c.runs).map(([s, m]) => [Number(s), m] as [number, Measures]));
    if (prev) for (const [s2, m] of runs) prev.runs.set(s2, m);
    else cands.set(key, { key, name: c.name, origin: c.origin, policy: c.policy, genome, runs });
  }
  approaches = [...cands.values()].filter((c) => c.genome).length;
  return Array.isArray(raw) ? null : raw.meta;
}

/** Continue the search from a saved run under the amended rule, until a wall-clock time, then stages 3 and 4. */
async function resume(path: string, until: Date): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const prevMeta = loadSaved(path);
  const ai = process.argv.indexOf("--adp");
  if (ai >= 0) {
    const runs = JSON.parse(readFileSync(process.argv[ai + 1]!, "utf8")) as Record<string, Measures>;
    cands.set("policy:adp", { key: "policy:adp", name: "adp", origin: "named finalist (ADP learned case value; tuned on seeds 13-20, so its seeds 1-20 numbers are optimistic)", policy: "adp", runs: new Map(Object.entries(runs).map(([s2, m]) => [Number(s2), m] as [number, Measures])) });
  }
  const prevRuns = [...cands.values()].reduce((n, c) => n + c.runs.size, 0);
  const rng = new Rng(RNG_SEED + 1);
  log(`resuming from ${path}: ${cands.size} candidates, ${prevRuns} runs; rule ${RULE}; stage 2 until ${until.toTimeString().slice(0, 5)}`);
  await pool.start(WORKERS);
  const refs = [...BASELINES, ...RIVALS].map(addPolicy);
  await evalOn(refs, [...S3, ...S4], "reference");
  const presetCands = Object.entries(PRESETS).map(([name, g]) => addGenome(g, "preset", name));
  const onS2 = () => [...cands.values()].filter((c) => c.genome && c.genome.enforceFloor && S2.every((s) => c.runs.has(s)) && !failed(c, S2));
  let pop = selectN(scoredOf(onS2(), S2), POP).map((x) => x.c);
  // seed the new gene: the rotation extended to every case, on the leaders and on the presets
  const inject: Cand[] = [];
  const bases = [...pop.slice(0, 24), ...presetCands.filter((c) => c.genome!.enforceFloor)];
  for (const b of bases) {
    const K = 15 + Math.floor(rng.next() * 31);
    inject.push(addGenome({ ...b.genome!, coverage: "rotation", rotationAll: true, rotationDays: K, rotationCap: 0.3 + 0.3 * rng.next() }, `rotation-all seed from ${b.name}`));
  }
  await evalOn(inject, S2, "stage2b-inject");
  pop = selectN(scoredOf([...pop, ...inject.filter((c) => !failed(c, S2))], S2), POP).map((x) => x.c);
  let scored = scoredOf(pop, S2);
  nsgaSort(scored);
  const t0 = performance.now();
  let gen = 0;
  for (; ; gen++) {
    const perGen = gen > 0 ? (performance.now() - t0) / gen : 70_000;
    if (Date.now() + perGen > until.getTime()) {
      log(`stage 2b stopped after ${gen} generations at the deadline`);
      break;
    }
    const kids: Cand[] = [];
    const seen = new Set(pop.map((c) => c.key));
    let tries = 0;
    while (kids.length < POP && tries < POP * 20) {
      tries++;
      const a = better(scored[Math.floor(rng.next() * scored.length)]!, scored[Math.floor(rng.next() * scored.length)]!);
      const b = better(scored[Math.floor(rng.next() * scored.length)]!, scored[Math.floor(rng.next() * scored.length)]!);
      const child = mutate(rng.next() < 0.9 ? crossover(a.c.genome!, b.c.genome!, rng) : a.c.genome!, rng, 0.12);
      const k = genomeKey(child);
      if (seen.has(k) || cands.has(k)) continue;
      seen.add(k);
      kids.push(addGenome(child, `nsga (amended rule) gen ${gen + 1}`));
    }
    await evalOn(kids, S2, `stage2b-gen${gen + 1}`);
    pop = selectN(scoredOf([...pop, ...kids.filter((c) => !failed(c, S2))], S2), POP).map((x) => x.c);
    scored = scoredOf(pop, S2);
    nsgaSort(scored);
    const feasible = scored.filter((x) => x.cv === 0).length;
    const hard = scored.filter((x) => violation(x.c, S2).cvHard === 0);
    const bestNa = hard.length ? Math.min(...hard.map((x) => means(x.c, S2)[M.neverActed] ?? 1e6)) : NaN;
    log(`stage 2b gen ${gen + 1}: ${kids.length} children; ${feasible}/${scored.length} meet every guardrail; ${hard.length} meet all but (c), fewest never acted on among them ${bestNa.toFixed(0)}; ${pool.runs} runs`);
  }
  if (process.argv.includes("--no-finals")) {
    // the archive only: the finals run later under the final criteria (--finals)
    pool.stop();
    const meta = { gen: (prevMeta?.gen ?? 15) + gen, wallMin: (prevMeta?.wallMin ?? 0) + elapsedMin(), runs: prevRuns + pool.runs, msPerRun: pool.ms / Math.max(1, pool.runs) };
    writeFileSync(join(OUT, "archive.json"), JSON.stringify({ meta, cands: [...cands.values()].map((c) => ({ key: c.key, name: c.name, origin: c.origin, policy: c.policy, genome: c.genome, runs: Object.fromEntries(c.runs) })) }));
    log(`archive written (${cands.size} candidates)`);
    return;
  }
  const top30 = stageSets().top30;
  await evalOn([...top30, ...presetCands], S3, "stage3");
  log(`stage 3: top 30 re-scored on seeds 1-20; ${pool.runs} runs`);
  const { top8, comparators } = stageSets();
  await evalOn([...top8, ...comparators], S4, "stage4");
  log(`stage 4 done; ${pool.runs} runs`);
  pool.stop();
  const meta = { gen: (prevMeta?.gen ?? 15) + gen, wallMin: (prevMeta?.wallMin ?? 0) + elapsedMin(), runs: prevRuns + pool.runs, msPerRun: pool.ms / Math.max(1, pool.runs) };
  writeFileSync(join(OUT, "runs.json"), JSON.stringify({ meta, cands: [...cands.values()].map((c) => ({ key: c.key, name: c.name, origin: c.origin, policy: c.policy, genome: c.genome, runs: Object.fromEntries(c.runs) })) }));
  writeReport(meta);
}

/** The finals from the archive under the criteria in force: stage 3 (top 30, seeds 1-20) and stage 4 (validation). */
async function finals(): Promise<void> {
  const ai2 = process.argv.indexOf("--archive");
  const path = ai2 >= 0 ? process.argv[ai2 + 1]! : join(OUT, "archive.json");
  const prevMeta = loadSaved(path);
  const prevRuns = [...cands.values()].reduce((n, c) => n + c.runs.size, 0);
  const ai = process.argv.indexOf("--adp");
  if (ai >= 0) {
    const runs = JSON.parse(readFileSync(process.argv[ai + 1]!, "utf8")) as Record<string, Measures>;
    cands.set("policy:adp", { key: "policy:adp", name: "adp", origin: "named finalist (ADP learned case value; tuned on seeds 13-20, so its seeds 1-20 numbers are optimistic)", policy: "adp", runs: new Map(Object.entries(runs).map(([s2, m]) => [Number(s2), m] as [number, Measures])) });
  }
  writeFileSync(join(OUT, "criteria-used.json"), JSON.stringify(criteria(), null, 2) + "\n");
  log(`finals from ${path}: ${cands.size} candidates; criteria "${criteria().name}"`);
  await pool.start(WORKERS);
  const refs = [...BASELINES, ...RIVALS].map(addPolicy);
  const presetCands = Object.entries(PRESETS).map(([name, g]) => addGenome(g, "preset", name));
  await evalOn([...refs, ...presetCands], [...S3, ...S4], "reference");
  const top30 = stageSets().top30;
  await evalOn(top30, S3, "stage3");
  log(`stage 3: top 30 re-scored on seeds 1-20; ${pool.runs} runs`);
  const { top8 } = stageSets();
  await evalOn(top8, S4, "stage4");
  log(`stage 4 done; ${pool.runs} runs`);
  pool.stop();
  const meta = { gen: prevMeta?.gen ?? 0, wallMin: (prevMeta?.wallMin ?? 0) + elapsedMin(), runs: prevRuns + pool.runs, msPerRun: prevMeta?.msPerRun ?? pool.ms / Math.max(1, pool.runs) };
  writeFileSync(join(OUT, "runs.json"), JSON.stringify({ meta, cands: [...cands.values()].map((c) => ({ key: c.key, name: c.name, origin: c.origin, policy: c.policy, genome: c.genome, runs: Object.fromEntries(c.runs) })) }));
  writeReport(meta);
}

// =============================================================================================
// The final rule (criteria.json, 14:40): paired non-inferiority against status_quo_60, one ranking
// everywhere (guardrails failed, then the worst shortfall relative to its margin, then the primary
// measure), search on seeds 1-6, decide on fresh seeds 7-20, confirm on 21-30, headline only on 31-60
// (not run here). Every run in this mode is fresh, on current code, with the CLI arena's roster id.

interface FinalCriteria {
  name: string;
  note?: string;
  method?: string;
  guardrails: Guardrail[];
  objectives: { measure: string; dir: "max" | "min" }[];
  primary: string;
  dominance?: string;
  ties?: string;
  frontier?: string;
}
const T95: Record<number, number> = { 1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571, 6: 2.447, 7: 2.365, 8: 2.306, 9: 2.262, 10: 2.228, 11: 2.201, 12: 2.179, 13: 2.16, 14: 2.145, 15: 2.131, 16: 2.12, 17: 2.11, 18: 2.101, 19: 2.093 };
const tcrit = (df: number) => T95[df] ?? 1.96;

let finalCrit: FinalCriteria | null = null;
function fcrit(): FinalCriteria {
  if (!finalCrit) finalCrit = JSON.parse(readFileSync(join(OUT, "criteria.json"), "utf8")) as FinalCriteria;
  return finalCrit;
}

interface GuardResult {
  label: string;
  measure: string;
  pass: boolean;
  /** shortfall past the margin, in units of the guardrail's scale (0 when it passes) */
  shortfall: number;
  /** mean paired difference (candidate - today), or the mean for an absolute limit */
  diff: number;
  /** the bound compared with the margin */
  bound: number;
}

/** Paired non-inferiority on every guardrail, on the given seeds. */
function guards(c: Cand, seeds: number[]): GuardResult[] {
  const sq = cands.get("policy:status_quo_60")!;
  const out: GuardResult[] = [];
  for (const g of fcrit().guardrails) {
    const xs = seeds.map((s) => c.runs.get(s)?.[g.measure]);
    if (xs.some((x) => typeof x !== "number")) {
      out.push({ label: g.label, measure: g.measure, pass: false, shortfall: 99, diff: NaN, bound: NaN });
      continue;
    }
    const vals = xs as number[];
    if (g.vs === "absolute") {
      const m = mean(vals);
      const short = g.op === ">=" ? Math.max(0, g.value! - m) : Math.max(0, m - g.value!);
      out.push({ label: g.label, measure: g.measure, pass: short <= 1e-9, shortfall: short / g.scale, diff: m, bound: m });
      continue;
    }
    const d = seeds.map((s, i) => vals[i]! - (sq.runs.get(s)?.[g.measure] ?? NaN));
    const md = mean(d);
    if (g.on === "mean") {
      const tol0 = g.tol ?? 0;
      const short0 = g.op === ">=" ? Math.max(0, -tol0 - md) : Math.max(0, md - tol0);
      out.push({ label: g.label, measure: g.measure, pass: short0 <= 1e-9, shortfall: short0 / g.scale, diff: md, bound: md });
      continue;
    }
    const sd = d.length > 1 ? Math.sqrt(d.reduce((a, b) => a + (b - md) ** 2, 0) / (d.length - 1)) : 0;
    const half = (tcrit(d.length - 1) * sd) / Math.sqrt(d.length);
    const tol = g.tol ?? 0;
    const bound = g.op === ">=" ? md - half : md + half;
    const short = g.op === ">=" ? Math.max(0, -tol - bound) : Math.max(0, bound - tol);
    out.push({ label: g.label, measure: g.measure, pass: short <= 1e-9, shortfall: short / g.scale, diff: md, bound });
  }
  return out;
}

interface Ranked {
  c: Cand;
  failed: number;
  worst: number;
  primary: number;
  g: GuardResult[];
}
/** The one ranking: guardrails failed, then worst shortfall relative to its margin, then the primary. */
function rankFinal(cs: Cand[], seeds: number[]): Ranked[] {
  const rows = cs.map((c) => {
    const g = guards(c, seeds);
    return { c, g, failed: g.filter((x) => !x.pass).length, worst: Math.max(0, ...g.map((x) => x.shortfall)), primary: means(c, seeds)[fcrit().primary] ?? -1e9 };
  });
  rows.sort((a, b) => a.failed - b.failed || (Math.abs(a.worst - b.worst) > 1e-9 ? a.worst - b.worst : b.primary - a.primary));
  // ties on the primary: within the 95% paired interval of the leader of the same group, prefer more
  // merits disposals, then fewer promises broken, then fewer never heard
  if (rows.length > 1) {
    const lead = rows[0]!;
    const same = rows.filter((r) => r.failed === lead.failed && Math.abs(r.worst - lead.worst) <= 1e-9);
    const tied = same.filter((r) => {
      if (r === lead) return true;
      const d = seeds.map((s) => (lead.c.runs.get(s)?.[fcrit().primary] ?? 0) - (r.c.runs.get(s)?.[fcrit().primary] ?? 0));
      const md = mean(d);
      const sd = Math.sqrt(d.reduce((a, b) => a + (b - md) ** 2, 0) / Math.max(1, d.length - 1));
      return md - (tcrit(d.length - 1) * sd) / Math.sqrt(d.length) <= 0;
    });
    const key = (r: Ranked): number[] => {
      const m = means(r.c, seeds);
      return [-(m["derived.meritsDisposals"] ?? 0), m["extra.promisesBroken"] ?? 1e9, m[M.neverHeard] ?? 1e9];
    };
    tied.sort((a, b) => {
      const ka = key(a);
      const kb = key(b);
      for (let i = 0; i < ka.length; i++) if (Math.abs(ka[i]! - kb[i]!) > 1e-9) return ka[i]! - kb[i]!;
      return b.primary - a.primary;
    });
    const rest = rows.filter((r) => !tied.includes(r));
    return [...tied, ...rest];
  }
  return rows;
}

/** NSGA-II under the final rule: objectives from criteria.json, constraint = total shortfall. */
const scoredFinal = (cs: Cand[], seeds: number[]): Scored[] =>
  cs.map((c) => {
    const m = means(c, seeds);
    const f = fcrit().objectives.map((o) => (o.dir === "max" ? -(m[o.measure] ?? -1e9) : (m[o.measure] ?? 1e9))).map((x) => (Number.isFinite(x) ? x : 1e9));
    const g = guards(c, seeds);
    return { c, f, cv: g.reduce((a, x) => a + x.shortfall, 0), rank: 0, crowd: 0 };
  });

function srcHashes(): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const f of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, f.name);
      if (f.isDirectory()) walk(p);
      else if (/\.(ts|json)$/.test(f.name)) out[p.slice(ROOT.length)] = createHash("sha256").update(readFileSync(p)).digest("hex").slice(0, 16);
    }
  };
  walk(join(ROOT, "src"));
  for (const f of ["scripts/tournament.ts", "scripts/tournament-worker.ts"]) out[f] = createHash("sha256").update(readFileSync(join(ROOT, f))).digest("hex").slice(0, 16);
  return out;
}

async function finalMode(until: Date): Promise<void> {
  const S7 = range(7, 20);
  const rng = new Rng(RNG_SEED + 7);
  // the archive: genomes only (their numbers were on a differently keyed court and older code)
  const archive = new Map<string, { g: Genome; name: string; m: Measures }>();
  let lines = readFileSync(join(OUT, "candidates.jsonl"), "utf8").split("\n");
  // --entry-from-final: seed from the latest final-rule stage only (its runs were on the arena's court)
  const fromFinal = process.argv.includes("--entry-from-final");
  if (fromFinal) {
    const at = lines.map((l, i) => (l.includes('"stage":"final-rule-start"') ? i : -1)).filter((i) => i >= 0).pop() ?? 0;
    lines = lines.slice(at + 1);
  }
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line) as { genome?: Genome; name: string; mean: Measures; seeds: number[] };
      if (fromFinal && r.seeds?.length !== 6) continue;
      if (!r.genome) continue;
      const g = validate(r.genome);
      if (!g.enforceFloor) continue;
      const k = genomeKey(g);
      const prev = archive.get(k);
      if (!prev || r.seeds.length >= 6) archive.set(k, { g, name: fromFinal ? `${r.name}` : r.name, m: r.mean });
    } catch {}
  }
  appendFileSync(join(OUT, "candidates.jsonl"), JSON.stringify({ stage: "final-rule-start", note: "from here on: fresh runs on current code, roster id roster_3000_seed42, criteria.json of 14:40" }) + "\n");
  log(`final mode: ${archive.size} archived genomes; search until ${until.toTimeString().slice(0, 5)}`);
  await pool.start(WORKERS);
  const refs = [...BASELINES, ...RIVALS].map(addPolicy);
  const presetCands = Object.entries(PRESETS).map(([name, g]) => addGenome(g, "preset", name));
  await evalOn([...refs, ...presetCands], S2, "final-reference");
  // stage-3 entry pool: the archive's best under an approximate (unpaired, archived-means) ranking
  const sqA = [...archive.values()].length ? null : null;
  void sqA;
  const approx = [...archive.values()]
    .map((a) => {
      const m = a.m;
      const merits = (m["extra.disposedVerdict"] ?? 0) + (m["extra.disposedSettlement"] ?? 0) + (m["extra.disposedCompounded"] ?? 0);
      const sqm = means(cands.get("policy:status_quo_60")!, S2);
      let failedN = 0;
      for (const g of fcrit().guardrails) {
        const x = g.measure === "derived.meritsDisposals" ? (m[g.measure] ?? merits) : m[g.measure];
        if (typeof x !== "number") continue;
        const ref = g.vs === "absolute" ? g.value! : sqm[g.measure]!;
        const ok = g.op === ">=" ? x >= ref - (g.tol ?? 0) : x <= ref + (g.tol ?? 0);
        if (!ok) failedN++;
      }
      return { a, failedN, useful: m[M.useful] ?? 0, nh: m[M.neverHeard] ?? 1e9 };
    })
    .sort((x, y) => x.failedN - y.failedN || y.useful - x.useful);
  const entry: Cand[] = approx.slice(0, 60).map((x) => addGenome(x.a.g, `archive ${x.a.name}`, `${x.a.name}`));
  // frontier coverage from the archive: the most useful at each never-heard level
  for (const lvl of [400, 550, 850, 1250]) {
    const b = approx.filter((x) => x.nh <= lvl).sort((x, y) => x.failedN - y.failedN || y.useful - x.useful)[0];
    if (b) entry.push(addGenome(b.a.g, `archive ${b.a.name}`, b.a.name));
  }
  // the g504 family: every case dated inside the quarter, a real floor for old cases, desk on
  const baseNames = process.argv.includes("--bases") ? process.argv[process.argv.indexOf("--bases") + 1]!.split(",") : ["g504"];
  for (const bn of baseNames) {
    const found = [...archive.values()].filter((a) => a.name === bn).pop();
    if (!found) continue;
    const base = found.g;
    // every old case heard: a small rotation or mention for old cases only, a higher old share of first dates
    for (const K of [20, 30, 40, 45]) entry.push(addGenome({ ...base, coverage: "rotation", rotationAll: false, rotationDays: K, rotationCap: 0.3 }, `${bn} old-case rotation`));
    for (const fos of [0.3, 0.45, 0.6]) entry.push(addGenome({ ...base, firstOldShare: fos }, `${bn} higher old share`));
    entry.push(addGenome({ ...base, coverage: "mention", mentionAfter: 0 }, `${bn} old-case mention`));
    entry.push(addGenome({ ...base, coverage: "mention", mentionAfter: 1 }, `${bn} old-case mention`));
    for (let i = 0; i < 12; i++) entry.push(addGenome(mutate({ ...base, coverage: "rotation", rotationAll: false, rotationDays: 20 + Math.floor(rng.next() * 26) }, rng, 0.15), `${bn} rotation mutant`));
    if (bn !== "g504") continue;
    const variants: Partial<Genome>[] = [
      { coverage: "floor", ageingFloor: 0.25 },
      { coverage: "floor", ageingFloor: 0.35 },
      { coverage: "floor", ageingFloor: 0.45 },
      { coverage: "floor", ageingFloor: 0.35, checkin: true, checkinRobust: true },
      { coverage: "rotation", rotationDays: 30, ageingFloor: 0.3 },
      { coverage: "rotation", rotationDays: 20, ageingFloor: 0.3 },
      { coverage: "mention", mentionAfter: 1, ageingFloor: 0.3 },
      { coverage: "floor", ageingFloor: 0.35, standbyShare: 0.3 },
      { coverage: "floor", ageingFloor: 0.35, selection: "knapsack" },
      { coverage: "floor", ageingFloor: 0.35, fillTarget: 1.2 },
    ];
    for (const v of variants) entry.push(addGenome({ ...base, ...v }, "g504 variant"));
    for (let i = 0; i < 30; i++) entry.push(addGenome(mutate({ ...base, coverage: "floor", ageingFloor: 0.25 + 0.2 * rng.next() }, rng, 0.2), "g504 mutant"));
  }
  // component variants (the coordinator's 14:43 guidance): call times, the process desk, both, both with a
  // robust check-in; g364 also with a small old-case rotation. The best of them go to the finals regardless.
  const componentVariants: Cand[] = [];
  const cvBases = process.argv.includes("--component-bases") ? process.argv[process.argv.indexOf("--component-bases") + 1]!.split(",") : [];
  for (const bn of cvBases) {
    const found = [...archive.values()].filter((a) => a.name === bn).pop();
    if (!found) continue;
    const b = found.g;
    const vs: [string, Partial<Genome>][] = [
      ["call times", { callTimes: true }],
      ["desk", { desk: true, recheckDays: 10 }],
      ["call times and desk", { callTimes: true, desk: true, recheckDays: 10 }],
      ["call times, desk, robust check-in", { callTimes: true, desk: true, recheckDays: 10, checkin: true, checkinRobust: true }],
    ];
    if (bn === "g364") for (const K of [30, 45]) vs.push([`old-case rotation ${K} with call times and desk`, { coverage: "rotation", rotationAll: false, rotationDays: K, rotationCap: 0.3, callTimes: true, desk: true, recheckDays: 10 }]);
    for (const [label2, v] of vs) componentVariants.push(addGenome({ ...b, ...v }, `${bn} + ${label2}`));
  }
  entry.push(...componentVariants);
  await evalOn(entry, S2, "final-entry");
  const onS2f = () => [...cands.values()].filter((c) => c.genome && c.genome.enforceFloor && S2.every((s) => c.runs.has(s)) && !failed(c, S2));
  let pop = selectN(scoredFinal(onS2f(), S2), POP).map((x) => x.c);
  let scored = scoredFinal(pop, S2);
  nsgaSort(scored);
  const t0 = performance.now();
  let gen = 0;
  for (; ; gen++) {
    const perGen = gen > 0 ? (performance.now() - t0) / gen : 70_000;
    if (Date.now() + perGen > until.getTime()) break;
    const kids: Cand[] = [];
    const seen = new Set(pop.map((c) => c.key));
    let tries = 0;
    while (kids.length < POP && tries < POP * 20) {
      tries++;
      const a = better(scored[Math.floor(rng.next() * scored.length)]!, scored[Math.floor(rng.next() * scored.length)]!);
      const b = better(scored[Math.floor(rng.next() * scored.length)]!, scored[Math.floor(rng.next() * scored.length)]!);
      const child = mutate(rng.next() < 0.9 ? crossover(a.c.genome!, b.c.genome!, rng) : a.c.genome!, rng, 0.12);
      const k = genomeKey(child);
      if (seen.has(k) || cands.has(k)) continue;
      seen.add(k);
      kids.push(addGenome(child, `nsga (final rule) gen ${gen + 1}`));
    }
    await evalOn(kids, S2, `final-gen${gen + 1}`);
    pop = selectN(scoredFinal([...pop, ...kids.filter((c) => !failed(c, S2))], S2), POP).map((x) => x.c);
    scored = scoredFinal(pop, S2);
    nsgaSort(scored);
    const r = rankFinal(pop, S2)[0]!;
    log(`final gen ${gen + 1}: leader ${r.c.name} fails ${r.failed} (worst ${r.worst.toFixed(2)}), ${r.primary.toFixed(2)} useful/day; ${pool.runs} runs`);
  }
  // finalists: the top 10 by the one ranking on 1-6, plus the frontier points (never heard and promises broken levels)
  const all6 = onS2f();
  const ranked6 = rankFinal(all6, S2);
  const finalists = new Set<Cand>(ranked6.slice(0, 10).map((r) => r.c));
  const sq6 = means(cands.get("policy:status_quo_60")!, S2);
  const frontierPts: { level: string; c: Cand }[] = [];
  for (const add of [150, 300, 600, 1000]) {
    const lvl = (sq6[M.neverHeard] ?? 0) + add;
    const b = ranked6.find((r) => (means(r.c, S2)[M.neverHeard] ?? 1e9) <= lvl);
    if (b) {
      finalists.add(b.c);
      frontierPts.push({ level: `never heard at most today + ${add}`, c: b.c });
    }
  }
  const pb = sq6["extra.promisesBroken"];
  if (typeof pb === "number")
    for (const add of [100, 300, 600]) {
      const b = ranked6.find((r) => (means(r.c, S2)["extra.promisesBroken"] ?? 1e9) <= pb + add);
      if (b) {
        finalists.add(b.c);
        frontierPts.push({ level: `promises broken at most today + ${add}`, c: b.c });
      }
    }
  // the best three component variants go to the finals regardless of rank
  for (const r of rankFinal(componentVariants.filter((c) => S2.every((s2) => c.runs.has(s2))), S2).slice(0, 3)) finalists.add(r.c);
  const fl = [...finalists];
  log(`search done after ${gen} generations; ${fl.length} finalists to seeds 7-20`);
  // decide on fresh seeds 7-20, then confirm on 21-30, with every rival and preset on the same code
  const adpPath = process.argv.includes("--adp") ? process.argv[process.argv.indexOf("--adp") + 1]! : null;
  await evalOn([...fl, ...refs, ...presetCands], S7, "final-decide");
  const ranked7 = rankFinal([...fl], S7);
  await evalOn([...fl, ...refs, ...presetCands], S4, "final-confirm");
  if (adpPath) {
    try {
      const runs = JSON.parse(readFileSync(adpPath, "utf8")) as Record<string, Measures>;
      cands.set("policy:adp", { key: "policy:adp", name: "adp", origin: "named finalist (ADP; tuned on seeds 13-20, so its 7-20 numbers are optimistic)", policy: "adp", runs: new Map(Object.entries(runs).map(([s2, m]) => [Number(s2), m] as [number, Measures])) });
    } catch {}
  }
  pool.stop();
  const adp = cands.get("policy:adp");
  const decideField = [...fl, ...(adp ? [adp] : [])];
  const decided = rankFinal(decideField, S7);
  const confirmed = rankFinal(decideField, S4);
  const pick = decided[0]!;
  // everything kept before the report, so the report can be rebuilt without simulating (--final-report)
  writeFileSync(join(OUT, "final-state.json"), JSON.stringify({ gen, finalists: fl.map((c) => c.key), frontier: frontierPts.map((f) => ({ level: f.level, key: f.c.key })) }));
  writeFileSync(join(OUT, "runs.json"), JSON.stringify({ meta: { mode: "final" }, cands: [...cands.values()].map((c) => ({ key: c.key, name: c.name, origin: c.origin, policy: c.policy, genome: c.genome, runs: Object.fromEntries(c.runs) })) }));
  writeFinalOutputs({ gen, fl, ranked6, decided, confirmed, pick, frontierPts, refs, presetCands, S7 });
  void ranked7;
}

/** Rebuild the final report from runs.json and final-state.json. */
function finalReport(): void {
  const raw = JSON.parse(readFileSync(join(OUT, "runs.json"), "utf8")) as { cands: { key: string; name: string; origin: string; policy?: string; genome?: Genome; runs: Record<string, Measures> }[] };
  for (const c of raw.cands) cands.set(c.key, { key: c.key, name: c.name, origin: c.origin, policy: c.policy, genome: c.genome, runs: new Map(Object.entries(c.runs).map(([s2, m]) => [Number(s2), m] as [number, Measures])) });
  const st = JSON.parse(readFileSync(join(OUT, "final-state.json"), "utf8")) as { gen: number; finalists: string[]; frontier: { level: string; key: string }[] };
  const S7 = range(7, 20);
  const refs = [...BASELINES, ...RIVALS].map((id) => cands.get(`policy:${id}`)!).filter(Boolean);
  const presetCands = Object.keys(PRESETS).map((n) => cands.get(genomeKey(PRESETS[n]!))!).filter(Boolean);
  const fl = st.finalists.map((k) => cands.get(k)!).filter(Boolean);
  const all6 = [...cands.values()].filter((c) => c.genome && c.genome.enforceFloor && S2.every((s2) => c.runs.has(s2)) && !failed(c, S2));
  const adp = cands.get("policy:adp");
  const field = [...fl, ...(adp ? [adp] : [])];
  const decided = rankFinal(field, S7);
  writeFinalOutputs({ gen: st.gen, fl, ranked6: rankFinal(all6, S2), decided, confirmed: rankFinal(field, S4), pick: decided[0]!, frontierPts: st.frontier.map((f) => ({ level: f.level, c: cands.get(f.key)! })), refs, presetCands, S7 });
}

function writeFinalOutputs(o: { gen: number; fl: Cand[]; ranked6: Ranked[]; decided: Ranked[]; confirmed: Ranked[]; pick: Ranked; frontierPts: { level: string; c: Cand }[]; refs: Cand[]; presetCands: Cand[]; S7: number[] }): void {
  const { pick, decided, confirmed, refs, presetCands, S7 } = o;
  const w = pick.c;
  const bestGenome = decided.find((r) => r.c.genome)!.c;
  const conf = confirmed.find((r) => r.c === w)!;
  const measuresFor = (c: Cand, seeds: number[]) => Object.fromEntries(Object.entries(means(c, seeds)).map(([k, v]) => [k, { mean: v, ci95: ci95(valuesOn(c, seeds, k)) }]));
  const guardsOut = (r: Ranked) => r.g.map((x) => ({ label: x.label, pass: x.pass, shortfall: Math.round(x.shortfall * 1000) / 1000, diff: Math.round(x.diff * 1000) / 1000, bound: Math.round(x.bound * 1000) / 1000 }));
  const rivals = [...refs, ...(cands.get("policy:adp") ? [cands.get("policy:adp")!] : [])];
  // dominance: no rival better than the pick on every guarded measure
  const guarded = fcrit().guardrails.map((g) => ({ m: g.measure, better: g.op === ">=" ? 1 : -1 }));
  const beatsOn = (r: Cand, seeds: number[]) => guarded.filter((g) => ((means(r, seeds)[g.m] ?? NaN) - (means(bestGenome, seeds)[g.m] ?? NaN)) * g.better > 1e-9).map((g) => g.m);
  const dominators = rivals.filter((r) => beatsOn(r, S7).length === guarded.length).map((r) => r.name);
  writeFileSync(
    join(OUT, "winner.json"),
    JSON.stringify(
      {
        criteria: fcrit().name,
        decidedOn: S7,
        confirmedOn: S4,
        confirmNote: "seeds 21-30 were already used once under the original rule; the headline comes only from seeds 31-60",
        name: bestGenome.name,
        origin: bestGenome.origin,
        key: bestGenome.key,
        description: describeGenome(bestGenome.genome!),
        guardrailsDecide: guardsOut(decided.find((r) => r.c === bestGenome)!),
        guardrailsConfirm: guardsOut(confirmed.find((r) => r.c === bestGenome)!),
        failedDecide: decided.find((r) => r.c === bestGenome)!.failed,
        failedConfirm: confirmed.find((r) => r.c === bestGenome)!.failed,
        overallPick: w === bestGenome ? null : { name: w.name, policy: w.policy, failedDecide: pick.failed, failedConfirm: conf.failed },
        dominatedBy: dominators,
        measuresDecide: measuresFor(bestGenome, S7),
        measuresConfirm: measuresFor(bestGenome, S4),
        genome: bestGenome.genome,
        srcHashes: srcHashes(),
      },
      null,
      2,
    ) + "\n",
  );
  // the report
  const L: string[] = [];
  const nG = [...new Set([...readFileSync(join(OUT, "candidates.jsonl"), "utf8").matchAll(/"genome":(\{[^}]*"weights":\{[^}]*\}[^}]*\})/g)].map((m) => m[1]))].length;
  L.push("# Tournament of scheduling approaches (final rule)", "");
  L.push(`Approaches tried: about ${nG} distinct genomes of the zoo meta-policy over the whole tournament (random genomes across the whole space, every preset and its mutants, NSGA-II under the original rule, the 14:05 amendment and the final rule), plus the eight baselines, the original benchtime and the ADP planner run as coded. This final stage: ${[...cands.values()].filter((c) => c.genome).length} genomes run fresh on current code, ${o.gen} generations of NSGA-II under the final rule.`, "");
  L.push(`Criteria: ${fcrit().name}. ${fcrit().method ?? ""}`, "");
  if (fcrit().note) L.push(`Why: ${fcrit().note}`, "");
  L.push("Seeds: search 1-6; decide on fresh seeds 7-20; confirm on 21-30 (used once before, under the original rule); the headline must come only from seeds 31-60, which were never run here. The world keys every case's draws by roster id; every run here uses the CLI arena's roster id (roster_3000_seed42), so numbers match `bun run src/cli.ts arena` exactly. Earlier stages of this tournament ran on a court keyed \"seed42\" (an equally valid court, not the arena's); their numbers were used only to choose genomes to re-run.", "");
  L.push("## The pick", "");
  const gd = decided.find((r) => r.c === bestGenome)!;
  const gc = confirmed.find((r) => r.c === bestGenome)!;
  if (w !== bestGenome) L.push(`Ranked first on seeds 7-20: **${w.name}** (${w.origin}), failing ${pick.failed} guardrails. The best zoo genome follows; winner.json carries it.`, "");
  L.push(`**${bestGenome.name}** (${bestGenome.origin}). ${describeGenome(bestGenome.genome!)}`, "");
  L.push(`Genes: ${genomeLine(bestGenome.genome!)}.`, "");
  L.push(
    gd.failed === 0 ? "It passes every guardrail on the decision seeds 7-20." : `It fails ${gd.failed} of ${gd.g.length} guardrails on seeds 7-20: ${gd.g.filter((x) => !x.pass).map((x) => `${x.label} (shortfall ${x.shortfall.toFixed(2)} of its scale)`).join("; ")}. Nothing was relaxed: this is the candidate with the fewest failures, then the smallest worst shortfall.`,
    "",
  );
  L.push(gc.failed === 0 ? "On the confirmation seeds 21-30 it passes every guardrail." : `On the confirmation seeds 21-30 it fails ${gc.failed}: ${gc.g.filter((x) => !x.pass).map((x) => x.label).join(", ")}.`, "");
  L.push(dominators.length ? `Rivals better on every guarded measure (seeds 7-20): ${dominators.join(", ")}.` : "No rival (the eight baselines, the original benchtime, ADP) is better than it on every guarded measure.", "");
  L.push("## Guardrails for the pick (paired against status_quo_60)", "");
  L.push("| Guardrail | Margin | Seeds 7-20: difference (bound) | Pass | Seeds 21-30: difference (bound) | Pass |", "|---|---|---|---|---|---|");
  fcrit().guardrails.forEach((g, i) => {
    const a = gd.g[i]!;
    const b = gc.g[i]!;
    const mg = g.vs === "absolute" ? `${g.op} ${g.value}` : `${g.op === ">=" ? "-" : "+"}${g.tol ?? 0}`;
    L.push(`| ${g.label} | ${mg} | ${a.diff.toFixed(3)} (${a.bound.toFixed(3)}) | ${a.pass ? "yes" : "no"} | ${b.diff.toFixed(3)} (${b.bound.toFixed(3)}) | ${b.pass ? "yes" : "no"} |`);
  });
  L.push("");
  // finalists table
  L.push("## Finalists (decided on seeds 7-20, confirmed on 21-30)", "");
  L.push("| Rank 7-20 | Candidate | Origin | Failed 7-20 | Worst shortfall | Failed 21-30 | Useful/day | Merits disposals | Promises broken | Never heard | Never acted on | Honoured incl. desk | 4y+ moved | Trips/useful |", "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  decided.forEach((r, i) => {
    const m = means(r.c, S7);
    const cr = confirmed.find((x) => x.c === r.c)!;
    L.push(`| ${i + 1} | ${r.c.name} | ${r.c.origin} | ${r.failed} | ${r.worst.toFixed(2)} | ${cr.failed} | ${fmt(m[M.useful], M.useful)} | ${fmt(m["derived.meritsDisposals"], "x")} | ${fmt(m["extra.promisesBroken"], "x")} | ${fmt(m[M.neverHeard], "x")} | ${fmt(m[M.neverActed], "x")} | ${fmt(m["extra.promisesHonouredInclDesk"], "Share")} | ${fmt(m[M.sub4y], M.sub4y)} | ${fmt(m[M.trips], M.trips)} |`);
  });
  L.push("");
  L.push("Frontier points carried to the finals (chosen on seeds 1-6):", "");
  for (const f of o.frontierPts) L.push(`- ${f.level}: ${f.c.name} (${genomeLine(f.c.genome!)})`);
  L.push("");
  // every measure, pick vs rivals and presets, confirmation seeds
  const cols = [...new Set([bestGenome, ...(w !== bestGenome ? [w] : []), ...rivals, ...presetCands.filter((c) => !BASELINES.includes(c.name))])];
  L.push("## Every measure on the confirmation seeds 21-30 (means; the pick's 95% interval in brackets)", "");
  const head = ["Measure", ...cols.map((c) => c.name)];
  L.push(`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`);
  const keysAll = [...new Set([...fcrit().guardrails.map((g) => g.measure), ...SCORED, "extra.promisesBroken", "siddarth.heldOnPromisedDate", "caseStudy.ageBandsEnd.5+", "caseStudy.ageBandsEnd.4-5"])];
  for (const k of keysAll) {
    L.push(`| ${label(k)} | ${cols.map((c, i) => (i === 0 ? `${fmt(means(c, S4)[k], k)} [±${fmt(ci95(valuesOn(c, S4, k)), k)}]` : fmt(means(c, S4)[k], k))).join(" | ")} |`);
  }
  L.push("");
  L.push("Rivals and presets: guardrails failed under the final rule (seeds 7-20 / 21-30):", "");
  L.push("| Candidate | Failed 7-20 | Failed 21-30 | Worst shortfall 7-20 |", "|---|---|---|---|");
  for (const c of [...rivals, ...presetCands.filter((x) => !BASELINES.includes(x.name))]) {
    const a = rankFinal([c], S7)[0]!;
    const b = rankFinal([c], S4)[0]!;
    L.push(`| ${c.name} | ${a.failed} | ${b.failed} | ${a.worst.toFixed(2)} |`);
  }
  L.push("");
  // the search on 1-6
  L.push("## The search under the final rule (seeds 1-6)", "");
  L.push("| Rank | Candidate | Origin | Failed | Worst shortfall | Useful/day | Never heard | Promises broken | Genes |", "|---|---|---|---|---|---|---|---|---|");
  o.ranked6.slice(0, 25).forEach((r, i) => {
    const m = means(r.c, S2);
    L.push(`| ${i + 1} | ${r.c.name} | ${r.c.origin} | ${r.failed} | ${r.worst.toFixed(2)} | ${fmt(m[M.useful], M.useful)} | ${fmt(m[M.neverHeard], "x")} | ${fmt(m["extra.promisesBroken"], "x")} | ${genomeLine(r.c.genome!)} |`);
  });
  L.push("");
  const failCount = new Map<string, number>();
  for (const r of o.ranked6) for (const x of r.g) if (!x.pass) failCount.set(x.label, (failCount.get(x.label) ?? 0) + 1);
  L.push(`Which guardrails bind: share of the ${o.ranked6.length} genomes run on seeds 1-6 that fail each one.`, "", "| Guardrail | Fails |", "|---|---|");
  for (const [k, v] of [...failCount].sort((a, b) => b[1] - a[1])) L.push(`| ${k} | ${((v / Math.max(1, o.ranked6.length)) * 100).toFixed(0)}% |`);
  L.push("");
  const top = o.ranked6.slice(0, 30).map((r) => r.c);
  L.push("## Which components win (top 30 on seeds 1-6 against everything run in this stage)", "");
  L.push(...familyTable(top, o.ranked6.map((r) => r.c)), "");
  L.push("The earlier stages (original rule, 14:05 amendment) are summarised in old-rule/summary.md; their pick is not the pick.", "");
  writeFileSync(join(OUT, "summary.md"), L.join("\n") + "\n");
  writeFileSync(join(OUT, "runs.json"), JSON.stringify({ meta: { mode: "final" }, cands: [...cands.values()].map((c) => ({ key: c.key, name: c.name, origin: c.origin, policy: c.policy, genome: c.genome, runs: Object.fromEntries(c.runs) })) }));
  log(`wrote summary.md and winner.json: ${bestGenome.name} fails ${gd.failed} on 7-20, ${gc.failed} on 21-30`);
}

/** An extra candidate after the finals (same rule, same seeds): the pick with one gene changed. */
async function extraCandidate(): Promise<void> {
  const raw = JSON.parse(readFileSync(join(OUT, "runs.json"), "utf8")) as { cands: { key: string; name: string; origin: string; policy?: string; genome?: Genome; runs: Record<string, Measures> }[] };
  for (const c of raw.cands) cands.set(c.key, { key: c.key, name: c.name, origin: c.origin, policy: c.policy, genome: c.genome, runs: new Map(Object.entries(c.runs).map(([s2, m]) => [Number(s2), m] as [number, Measures])) });
  const w = JSON.parse(readFileSync(join(OUT, "winner.json"), "utf8")) as Record<string, unknown> & { name: string; genome: Genome };
  const pick = [...cands.values()].find((c) => c.genome && genomeKey(c.genome) === genomeKey(w.genome))!;
  const spec = JSON.parse(process.argv[process.argv.indexOf("--extra-candidate") + 1]!) as Partial<Genome>;
  const label2 = Object.entries(spec).map(([k, v]) => `${k} ${v}`).join(", ");
  const extra = addGenome({ ...w.genome, ...spec }, `added after the finals: ${w.name} with ${label2}`, `${w.name}+${Object.keys(spec).join("+")}`);
  const S7 = range(7, 20);
  await pool.start(WORKERS);
  await evalOn([extra], [...S7, ...S4], "after-finals");
  pool.stop();
  const a7 = rankFinal([pick], S7)[0]!;
  const b7 = rankFinal([extra], S7)[0]!;
  const a4 = rankFinal([pick], S4)[0]!;
  const b4 = rankFinal([extra], S4)[0]!;
  const passSet = (r: Ranked) => new Set(r.g.filter((x) => x.pass).map((x) => x.label));
  const lost = [...passSet(a4)].filter((l) => !passSet(b4).has(l));
  const replaces = b7.failed === 0 && lost.length === 0;
  const row = (r: Ranked, seeds: number[]) => {
    const m = means(r.c, seeds);
    return `failed ${r.failed} (${r.g.filter((x) => !x.pass).map((x) => x.label).join(", ") || "none"}); useful/day ${fmt(m[M.useful], M.useful)}, minutes waited ${fmt(m["extra.minutesWaited"], "x")}, trips/useful ${fmt(m[M.trips], M.trips)}, never heard ${fmt(m[M.neverHeard], "x")}, promises broken ${fmt(m["extra.promisesBroken"], "x")}, merits disposals ${fmt(m["derived.meritsDisposals"], "x")}`;
  };
  const lines = [
    "",
    `## Added after the finals: ${extra.name} (same rule, same seeds)`,
    "",
    `${w.name} with ${label2}, run fresh on seeds 7-20 and 21-30 and judged by the same paired guardrails. It ${replaces ? "passes every guardrail on 7-20 and fails nothing on 21-30 that " + w.name + " passes, so it takes " + w.name + "'s place in winner.json" : "does not qualify to replace " + w.name + " (it must pass all guardrails on 7-20 and fail nothing on 21-30 that " + w.name + " passes)"}. ${w.name} stays the pre-registered pick of the finals above.`,
    "",
    `- ${w.name}, seeds 7-20: ${row(a7, S7)}`,
    `- ${extra.name}, seeds 7-20: ${row(b7, S7)}`,
    `- ${w.name}, seeds 21-30: ${row(a4, S4)}`,
    `- ${extra.name}, seeds 21-30: ${row(b4, S4)}`,
    "",
  ];
  appendFileSync(join(OUT, "summary.md"), lines.join("\n"));
  if (replaces) {
    const measuresFor = (c: Cand, seeds: number[]) => Object.fromEntries(Object.entries(means(c, seeds)).map(([k, v]) => [k, { mean: v, ci95: ci95(valuesOn(c, seeds, k)) }]));
    const guardsOut = (r: Ranked) => r.g.map((x) => ({ label: x.label, pass: x.pass, shortfall: Math.round(x.shortfall * 1000) / 1000, diff: Math.round(x.diff * 1000) / 1000, bound: Math.round(x.bound * 1000) / 1000 }));
    const out = {
      ...w,
      note: `added after the finals: ${w.name} with ${label2}; same rule, same seeds`,
      preRegisteredPick: { name: w.name, genome: w.genome, failedDecide: a7.failed, failedConfirm: a4.failed },
      name: extra.name,
      origin: extra.origin,
      key: extra.key,
      description: describeGenome(extra.genome!),
      guardrailsDecide: guardsOut(b7),
      guardrailsConfirm: guardsOut(b4),
      failedDecide: b7.failed,
      failedConfirm: b4.failed,
      measuresDecide: measuresFor(extra, S7),
      measuresConfirm: measuresFor(extra, S4),
      genome: extra.genome,
      srcHashes: srcHashes(),
    };
    writeFileSync(join(OUT, "winner.json"), JSON.stringify(out, null, 2) + "\n");
  }
  writeFileSync(join(OUT, "runs.json"), JSON.stringify({ meta: { mode: "final" }, cands: [...cands.values()].map((c) => ({ key: c.key, name: c.name, origin: c.origin, policy: c.policy, genome: c.genome, runs: Object.fromEntries(c.runs) })) }));
  console.log(lines.join("\n"));
}

if (process.argv.includes("--extra-candidate")) extraCandidate().catch((e) => {
  console.error(e);
  pool.stop();
  process.exit(1);
});
else if (process.argv.includes("--final-report")) finalReport();
else if (process.argv.includes("--final")) {
  const hhmm = process.argv.includes("--until") ? process.argv[process.argv.indexOf("--until") + 1]! : "14:47";
  const [hh, mm] = hhmm.split(":").map(Number);
  const until = new Date();
  until.setHours(hh!, mm!, 0, 0);
  finalMode(until).catch((e) => {
    console.error(e);
    pool.stop();
    process.exit(1);
  });
} else if (process.argv.includes("--finals")) {
  finals().catch((e) => {
    console.error(e);
    pool.stop();
    process.exit(1);
  });
} else if (process.argv.includes("--resume")) {
  const path = process.argv[process.argv.indexOf("--resume") + 1]!;
  const hhmm = process.argv.includes("--until") ? process.argv[process.argv.indexOf("--until") + 1]! : "14:30";
  const [hh, mm] = hhmm.split(":").map(Number);
  const until = new Date();
  until.setHours(hh!, mm!, 0, 0);
  resume(path, until).catch((e) => {
    console.error(e);
    pool.stop();
    process.exit(1);
  });
} else if (process.argv.includes("--report-only")) reportOnly().catch((e) => {
  console.error(e);
  process.exit(1);
});
else main().catch((e) => {
  console.error(e);
  pool.stop();
  process.exit(1);
});
