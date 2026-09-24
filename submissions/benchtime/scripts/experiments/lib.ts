// Shared plumbing for the held-out experiments: a pool of worker processes (scripts/experiments/worker.ts,
// one per package root), a run cache keyed by the cell, the seed and a hash of the simulation code, the
// flattening of scorecards, t intervals, and the paired non-inferiority guardrails of
// out/tournament/criteria.json. Every run goes through runArena (the CLI arena path).

import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Scorecards } from "../../src/domain/types";
import { flattenScorecards } from "../../src/eval/metrics";
import type { CellSpec, JobResult } from "./worker";

export const ROOT = resolve(import.meta.dir, "../..");
export const OUT = join(ROOT, "out");
export const CACHE_DIR = join(OUT, "experiments");
export const CACHE = join(CACHE_DIR, "runs.jsonl");
export const range = (a: number, b: number): number[] => Array.from({ length: b - a + 1 }, (_, i) => a + i);

// ---------------------------------------------------------------------------------------------
// Cache

/** Hash of the code a run depends on (world, planners, evaluation, data, domain), per package root. */
const codeHashes = new Map<string, string>();
export function codeHash(root: string): string {
  const hit = codeHashes.get(root);
  if (hit) return hit;
  const h = createHash("sha256");
  const walk = (dir: string) => {
    for (const f of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const p = join(dir, f.name);
      if (f.isDirectory()) walk(p);
      else if (/\.(ts|json|csv)$/.test(f.name)) h.update(p.slice(root.length)).update(readFileSync(p));
    }
  };
  for (const d of ["src/world", "src/planner", "src/eval", "src/data", "src/domain", "data"]) if (existsSync(join(root, d))) walk(join(root, d));
  h.update(readFileSync(join(root, "scripts/experiments/worker.ts")));
  const out = h.digest("hex").slice(0, 16);
  codeHashes.set(root, out);
  return out;
}

export function jobKey(cell: CellSpec, seed: number): string {
  // the id and label only name a cell; identical specs share runs
  const { label: _l, id: _i, ...rest } = cell;
  const root = cell.root ?? ROOT;
  return createHash("sha256").update(JSON.stringify(rest)).update(`|${seed}|${codeHash(root)}`).digest("hex").slice(0, 24);
}

export type Cached = { key: string; cellId: string; seed: number; ms: number; scorecards: Scorecards };
let cache: Map<string, Cached> | null = null;
export function loadCache(): Map<string, Cached> {
  if (cache) return cache;
  cache = new Map();
  if (existsSync(CACHE))
    for (const line of readFileSync(CACHE, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const r = JSON.parse(line) as Cached;
        if (r.scorecards) cache.set(r.key, r);
      } catch {}
    }
  return cache;
}

// ---------------------------------------------------------------------------------------------
// Pool

interface Worker {
  proc: ReturnType<typeof Bun.spawn>;
  busy: boolean;
  resolveJob?: (r: JobResult) => void;
  buf: string;
  ready: Promise<void>;
}

function spawnWorker(root: string): Worker {
  const proc = Bun.spawn(["bun", join(root, "scripts/experiments/worker.ts")], { cwd: root, stdin: "pipe", stdout: "pipe", stderr: "inherit" });
  const w: Worker = { proc, busy: false, buf: "", ready: Promise.resolve() };
  let readyResolve!: () => void;
  w.ready = new Promise((r) => (readyResolve = r));
  (async () => {
    const dec = new TextDecoder();
    for await (const chunk of proc.stdout as ReadableStream<Uint8Array>) {
      w.buf += dec.decode(chunk, { stream: true });
      let i: number;
      while ((i = w.buf.indexOf("\n")) >= 0) {
        const line = w.buf.slice(0, i);
        w.buf = w.buf.slice(i + 1);
        if (!line.trim()) continue;
        const msg = JSON.parse(line);
        if (msg.ready) {
          readyResolve();
          continue;
        }
        const r = w.resolveJob;
        w.resolveJob = undefined;
        r?.(msg as JobResult);
      }
    }
  })();
  return w;
}

export interface Job {
  cell: CellSpec;
  seed: number;
  key: string;
}

/**
 * Run every job not already cached, `workers` processes per package root, in the order given. Results are
 * appended to the cache as they arrive; `onDone` sees each fresh result.
 */
export async function runJobs(jobs: Job[], workers: number, onDone?: (r: Cached, done: number, total: number) => void): Promise<void> {
  const c = loadCache();
  mkdirSync(CACHE_DIR, { recursive: true });
  const seen = new Set<string>();
  const todo = jobs.filter((j) => !c.has(j.key) && !seen.has(j.key) && seen.add(j.key));
  if (todo.length === 0) return;
  const byRoot = new Map<string, Job[]>();
  for (const j of todo) {
    const r = j.cell.root ?? ROOT;
    const list = byRoot.get(r);
    if (list) list.push(j);
    else byRoot.set(r, [j]);
  }
  let done = 0;
  const total = todo.length;
  const errors: string[] = [];
  // share the worker budget across roots in proportion to their jobs (at least one each)
  const roots = [...byRoot.keys()];
  const alloc = new Map(roots.map((r) => [r, Math.max(1, Math.round((workers * byRoot.get(r)!.length) / total))]));
  await Promise.all(
    roots.map(async (root) => {
      const queue = [...byRoot.get(root)!];
      const n = Math.min(alloc.get(root)!, queue.length);
      const pool = Array.from({ length: n }, () => spawnWorker(root));
      await Promise.all(
        pool.map(async (w) => {
          await w.ready;
          for (;;) {
            const job = queue.shift();
            if (!job) break;
            const res = await new Promise<JobResult>((resolveJob) => {
              w.resolveJob = resolveJob;
              (w.proc.stdin as import("bun").FileSink).write(JSON.stringify({ key: job.key, seed: job.seed, cell: job.cell }) + "\n");
              (w.proc.stdin as import("bun").FileSink).flush();
            });
            done++;
            if (res.error || !res.scorecards) {
              errors.push(`${job.cell.id} seed ${job.seed}: ${res.error}`);
              console.error(`ERROR ${job.cell.id} seed ${job.seed}: ${res.error?.slice(0, 400)}`);
              continue;
            }
            const rec: Cached = { key: job.key, cellId: job.cell.id, seed: job.seed, ms: res.ms, scorecards: res.scorecards };
            c.set(job.key, rec);
            appendFileSync(CACHE, JSON.stringify(rec) + "\n");
            onDone?.(rec, done, total);
          }
          (w.proc.stdin as import("bun").FileSink).end();
        }),
      );
      for (const w of pool) w.proc.kill();
    }),
  );
  if (errors.length) console.error(`${errors.length} jobs failed`);
}

// ---------------------------------------------------------------------------------------------
// Measures

export type Flat = Record<string, number>;

/** Every scorecard value as "family.key" (age bands as caseStudy.ageBandsEnd.4+), plus derived.meritsDisposals. */
export function flat(s: Scorecards): Flat {
  const out: Flat = {};
  const f = flattenScorecards(s);
  for (const [fam, rec] of Object.entries(f)) for (const [k, v] of Object.entries(rec)) if (typeof v === "number" && Number.isFinite(v)) out[`${fam}.${k}`] = v;
  out["derived.meritsDisposals"] = (out["extra.disposedVerdict"] ?? 0) + (out["extra.disposedSettlement"] ?? 0) + (out["extra.disposedCompounded"] ?? 0);
  return out;
}

/** The runs of one cell on the given seeds, in seed order (null where missing). */
export function runsOf(cell: CellSpec, seeds: number[]): (Cached | null)[] {
  const c = loadCache();
  return seeds.map((s) => c.get(jobKey(cell, s)) ?? null);
}

// ---------------------------------------------------------------------------------------------
// Statistics: t intervals (the guardrails use the same t bound)

/** two-sided 95% t quantile (0.975) by degrees of freedom */
const T975: number[] = [NaN, 12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.16, 2.145, 2.131, 2.12, 2.11, 2.101, 2.093, 2.086, 2.08, 2.074, 2.069, 2.064, 2.06, 2.056, 2.052, 2.048, 2.045, 2.042];
export const tq = (df: number): number => (df <= 0 ? NaN : df < T975.length ? T975[df]! : df <= 40 ? 2.021 : df <= 60 ? 2.0 : 1.96);
/** the tournament's own table (scripts/tournament.ts tcrit): 1.96 from 20 degrees of freedom on */
export const tqTournament = (df: number): number => (df <= 19 ? tq(df) : 1.96);

export interface TInterval {
  mean: number;
  lo: number;
  hi: number;
  sd: number;
  n: number;
}
export function tInterval(xs: number[]): TInterval {
  const v = xs.filter((x) => Number.isFinite(x));
  const n = v.length;
  if (n === 0) return { mean: NaN, lo: NaN, hi: NaN, sd: NaN, n };
  const m = v.reduce((a, b) => a + b, 0) / n;
  const sd = n > 1 ? Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1)) : 0;
  // one seed gives no interval
  const h = n > 1 ? (tq(n - 1) * sd) / Math.sqrt(n) : NaN;
  return { mean: m, lo: m - h, hi: m + h, sd, n };
}

export interface PairedT extends TInterval {
  wins: number;
  losses: number;
  /** correlation of the two series across seeds (how much the shared seeds pair) */
  corr: number;
}
export function pairedT(a: (number | undefined)[], b: (number | undefined)[]): PairedT {
  const d: number[] = [];
  const xa: number[] = [];
  const xb: number[] = [];
  let wins = 0;
  let losses = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) continue;
    d.push(x - y);
    xa.push(x);
    xb.push(y);
    if (x > y) wins++;
    else if (x < y) losses++;
  }
  const t = tInterval(d);
  const ma = xa.reduce((s, v) => s + v, 0) / Math.max(1, xa.length);
  const mb = xb.reduce((s, v) => s + v, 0) / Math.max(1, xb.length);
  let sab = 0;
  let saa = 0;
  let sbb = 0;
  for (let i = 0; i < xa.length; i++) {
    sab += (xa[i]! - ma) * (xb[i]! - mb);
    saa += (xa[i]! - ma) ** 2;
    sbb += (xb[i]! - mb) ** 2;
  }
  return { ...t, wins, losses, corr: saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : NaN };
}

// ---------------------------------------------------------------------------------------------
// Guardrails (out/tournament/criteria.json), paired non-inferiority against status_quo_60

export interface Guardrail {
  label: string;
  measure: string;
  vs: "absolute" | "status_quo_60";
  op: ">=" | "<=";
  value?: number;
  tol?: number;
  scale: number;
}
export interface Criteria {
  name: string;
  method?: string;
  guardrails: Guardrail[];
  objectives: { measure: string; dir: "max" | "min" }[];
  primary: string;
}
export function loadCriteria(): Criteria {
  return JSON.parse(readFileSync(join(OUT, "tournament", "criteria.json"), "utf8")) as Criteria;
}

export interface GuardResult {
  label: string;
  measure: string;
  op: string;
  vs: string;
  /** "-0.02" for higher-is-better guardrails, "+2" for lower, ">= 2985" for absolute */
  margin: string;
  candMean: number;
  todayMean: number;
  /** candidate - today (paired), or the candidate's mean for an absolute limit */
  diff: number;
  lo: number;
  hi: number;
  /** the one-sided bound compared with the margin (t 0.975 with n - 1 degrees of freedom) */
  bound: number;
  pass: boolean;
  shortfall: number;
  /** the same test with the tournament's t table (1.96 from 20 degrees of freedom) */
  passTournamentT: boolean;
  n: number;
}

export function evalGuardrails(cand: (Flat | null)[], today: (Flat | null)[], crit: Criteria): GuardResult[] {
  const out: GuardResult[] = [];
  for (const g of crit.guardrails) {
    const a = cand.map((f) => f?.[g.measure]);
    const b = today.map((f) => f?.[g.measure]);
    const margin = g.vs === "absolute" ? `${g.op} ${g.value}` : `${g.op === ">=" ? "-" : "+"}${g.tol ?? 0}`;
    if (g.vs === "absolute") {
      const t = tInterval(a.filter((x): x is number => typeof x === "number"));
      const short = g.op === ">=" ? Math.max(0, g.value! - t.mean) : Math.max(0, t.mean - g.value!);
      out.push({ label: g.label, measure: g.measure, op: g.op, vs: g.vs, margin, candMean: t.mean, todayMean: tInterval(b.filter((x): x is number => typeof x === "number")).mean, diff: t.mean, lo: t.lo, hi: t.hi, bound: t.mean, pass: short <= 1e-9, shortfall: short / g.scale, passTournamentT: short <= 1e-9, n: t.n });
      continue;
    }
    const p = pairedT(a, b);
    const tol = g.tol ?? 0;
    const half = p.n > 1 ? (tq(p.n - 1) * p.sd) / Math.sqrt(p.n) : 0;
    const halfT = p.n > 1 ? (tqTournament(p.n - 1) * p.sd) / Math.sqrt(p.n) : 0;
    const bound = g.op === ">=" ? p.mean - half : p.mean + half;
    const boundT = g.op === ">=" ? p.mean - halfT : p.mean + halfT;
    const short = g.op === ">=" ? Math.max(0, -tol - bound) : Math.max(0, bound - tol);
    const shortT = g.op === ">=" ? Math.max(0, -tol - boundT) : Math.max(0, boundT - tol);
    const am = tInterval(a.filter((x): x is number => typeof x === "number")).mean;
    const bm = tInterval(b.filter((x): x is number => typeof x === "number")).mean;
    out.push({ label: g.label, measure: g.measure, op: g.op, vs: g.vs, margin, candMean: am, todayMean: bm, diff: p.mean, lo: p.lo, hi: p.hi, bound, pass: short <= 1e-9, shortfall: short / g.scale, passTournamentT: shortT <= 1e-9, n: p.n });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Formatting

export function fmtNum(x: number | undefined, measure = ""): string {
  if (x === undefined || !Number.isFinite(x)) return "n/a";
  const share = /Share|Rate|utilisation|substantiveness|heldAs|heldOn|judgeTimeUsed|wastedListings|promisesHonoured|firstPromiseKept|heldSubstantive|idleMinutes/.test(measure) && Math.abs(x) <= 1.5;
  if (share) return `${(x * 100).toFixed(1)}%`;
  const a = Math.abs(x);
  return a >= 100 ? x.toFixed(0) : a >= 10 ? x.toFixed(1) : x.toFixed(2);
}
/** a difference: shares in percentage points */
export function fmtDiff(x: number | undefined, measure = ""): string {
  if (x === undefined || !Number.isFinite(x)) return "n/a";
  const share = /Share|Rate|utilisation|substantiveness|heldAs|heldOn|judgeTimeUsed|wastedListings|promisesHonoured|firstPromiseKept|heldSubstantive|idleMinutes/.test(measure);
  const v = share ? x * 100 : x;
  const a = Math.abs(v);
  const s = a >= 100 ? v.toFixed(0) : a >= 10 ? v.toFixed(1) : v.toFixed(2);
  return `${v > 0 ? "+" : ""}${s}${share ? " pts" : ""}`;
}

export const nowHHMM = (): string => new Date().toTimeString().slice(0, 5);
export const mtime = (p: string): number => (existsSync(p) ? statSync(p).mtimeMs : 0);
