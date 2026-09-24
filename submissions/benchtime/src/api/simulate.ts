// POST /api/simulate and POST /api/compare: one rule set (or two) on the given world seeds, every scorecard
// field as a mean with its 95% interval, the weekly series, and paired differences on shared seeds.
// Seed results are cached one by one, so a quick five-seed run is reused by the full ten-seed run.

import type { JudgeConfig, Scorecards, SequentialType } from "../domain/types";
import { SEQUENCE } from "../domain/types";
import {
  AGE_BANDS,
  DEFAULT_SEEDS,
  HORIZON,
  HttpError,
  QUICK_SEEDS,
  canonical,
  checkPolicy,
  cleanConfig,
  effectiveConfig,
  endOfWeeks,
  horizonWeeks,
  makePolicy,
  type AgeBand,
} from "./context";
import { pairedInterval, tInterval, type Interval } from "./intervals";
import { runJobs } from "./pool";
import type { SeedResult } from "./runner";

// ---------------------------------------------------------------------------------------------
// Summary: every Scorecards field as an Interval, plus the backlog card (web/API.md, "Shared shapes")

type Get = (s: Scorecards) => number;
const README_KEYS = ["utilisation", "reachRate", "substantiveness", "backlog4yHeardShare", "backlog4ySubstantiveShare", "predictabilityGapDays"] as const;
const CASE_KEYS = ["utilisation", "overrunDays", "idleMinutesShare", "heldAsScheduled", "heldAsScheduledAllDue", "substantiveness", "nextDateExcessDays", "wastedRelistShare"] as const;
const SID_KEYS = ["throughputPerMonth", "judgeTimeUsed", "wastedListings", "heldOnPromisedDate", "oldestPendingAgeYears", "p95PendingAgeYears", "neverHeard", "loadBalanceCv"] as const;
const EXTRA_FIRST = ["listedPerDay", "reachedPerDay", "substantivePerDay", "disposed", "disposed4yPlus", "tripsPerSubstantive", "wastedTripShare", "deskPerDay", "vacatedPerDay"];

/** Every field as a getter, keyed by its dotted path (the ids meta.measures uses). */
export function fieldGetters(cards: readonly Scorecards[]): [string, Get][] {
  const out: [string, Get][] = [];
  for (const k of README_KEYS) out.push([`readme.${k}`, (s) => s.readme[k]]);
  for (const k of CASE_KEYS) out.push([`caseStudy.${k}`, (s) => s.caseStudy[k]]);
  for (const b of AGE_BANDS) {
    out.push([`caseStudy.ageBandsStart.${b}`, (s) => s.caseStudy.ageBandsStart[b] ?? NaN]);
    out.push([`caseStudy.ageBandsEnd.${b}`, (s) => s.caseStudy.ageBandsEnd[b] ?? NaN]);
  }
  for (const k of SID_KEYS) out.push([`siddarth.${k}`, (s) => s.siddarth[k]]);
  // the named extras first, then every other number the scorecards carry (rule 3: nothing dropped)
  const extras = [...EXTRA_FIRST];
  for (const c of cards) for (const k of Object.keys(c.extra)) if (!extras.includes(k)) extras.push(k);
  for (const k of extras) out.push([`extra.${k}`, (s) => s.extra[k] ?? NaN]);
  for (const n of ["3", "4", "5"] as const) {
    const band = `${n}+`;
    const st = (s: Scorecards) => s.caseStudy.ageBandsStart[band] ?? NaN;
    const en = (s: Scorecards) => s.caseStudy.ageBandsEnd[band] ?? NaN;
    out.push([`backlog.plus${n}Start`, st]);
    out.push([`backlog.plus${n}End`, en]);
    out.push([`backlog.plus${n}Change`, (s) => en(s) - st(s)]);
  }
  return out;
}

export type Summary = Record<"readme" | "caseStudy" | "siddarth" | "extra" | "backlog", Record<string, unknown>>;

function setPath(root: Summary, path: string, v: Interval): void {
  const parts = path.split(".");
  let o = root as unknown as Record<string, unknown>;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i]!;
    o[p] ??= {};
    o = o[p] as Record<string, unknown>;
  }
  o[parts[parts.length - 1]!] = v;
}

const emptySummary = (): Summary => ({ readme: {}, caseStudy: { ageBandsStart: {}, ageBandsEnd: {} }, siddarth: {}, extra: {}, backlog: {} });

/** Mean and 95% interval across seeds for every field. */
export function summaryOf(cards: readonly Scorecards[]): Summary {
  const s = emptySummary();
  for (const [path, get] of fieldGetters(cards)) setPath(s, path, tInterval(cards.map(get)));
  return s;
}

/** b minus a, paired by seed (both lists in the same seed order). */
export function diffSummary(a: readonly Scorecards[], b: readonly Scorecards[]): Summary {
  const s = emptySummary();
  for (const [path, get] of fieldGetters([...a, ...b])) setPath(s, path, pairedInterval(a.map(get), b.map(get)));
  return s;
}

// ---------------------------------------------------------------------------------------------
// Weekly series

export interface Weekly {
  week: number;
  start: string;
  end: string;
  sittingDays: number;
  listed: Interval;
  reached: Interval;
  substantive: Interval;
  disposed: Interval;
  desk: Interval;
  vacated: Interval;
  minutesUsed: Interval;
  overrunDays: Interval;
  pendingByAge: Record<AgeBand, Interval>;
  pendingByStage: Record<SequentialType, Interval>;
}

export function weeklyOf(results: readonly SeedResult[], end: string): Weekly[] {
  return horizonWeeks(end).map((w, i) => {
    const rows = results.map((r) => r.weeks[i]).filter((x) => x !== undefined);
    const iv = (f: (x: (typeof rows)[number]) => number) => tInterval(rows.map(f));
    return {
      ...w,
      listed: iv((x) => x.listed),
      reached: iv((x) => x.reached),
      substantive: iv((x) => x.substantive),
      disposed: iv((x) => x.disposed),
      desk: iv((x) => x.desk),
      vacated: iv((x) => x.vacated),
      minutesUsed: iv((x) => x.minutesUsed),
      overrunDays: iv((x) => x.overrunDays),
      pendingByAge: Object.fromEntries(AGE_BANDS.map((b) => [b, iv((x) => x.pendingByAge[b])])) as Record<AgeBand, Interval>,
      pendingByStage: Object.fromEntries(SEQUENCE.map((s) => [s, iv((x) => x.pendingByStage[s])])) as Record<SequentialType, Interval>,
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Running seeds, cached per seed

const seedCache = new Map<string, Promise<SeedResult>>();

export interface RunSpec {
  policy: string;
  config?: Partial<JudgeConfig>;
  seeds: number[];
  end: string;
  noBehaviour?: boolean;
}

/** Results for every seed in order, running only the seeds not already cached. */
export async function runSeeds(spec: RunSpec): Promise<SeedResult[]> {
  const eff = effectiveConfig(spec.policy, spec.config);
  const keyOf = (seed: number) => canonical({ p: spec.policy, c: eff, s: seed, e: spec.end, nb: !!spec.noBehaviour });
  const missing = spec.seeds.filter((s) => !seedCache.has(keyOf(s)));
  if (missing.length > 0) {
    const batch = runJobs(missing.map((seed) => ({ policy: spec.policy, config: spec.config, seed, end: spec.end, noBehaviour: spec.noBehaviour })));
    missing.forEach((seed, i) => {
      const p = batch.then((rs) => rs[i]!);
      seedCache.set(keyOf(seed), p);
      // a failed run is not cached
      p.catch(() => seedCache.delete(keyOf(seed)));
    });
  }
  return Promise.all(spec.seeds.map((s) => seedCache.get(keyOf(s))!));
}

// ---------------------------------------------------------------------------------------------
// Request parsing

export function parseSeeds(raw: unknown, quick: boolean): number[] {
  if (raw === undefined || raw === null) return quick ? [...QUICK_SEEDS] : [...DEFAULT_SEEDS];
  if (!Array.isArray(raw) || raw.length === 0) throw new HttpError(400, "seeds must be a non-empty list of whole numbers");
  const seeds = [...new Set(raw.map(Number))];
  if (seeds.some((s) => !Number.isInteger(s) || s < 0 || s > 1_000_000)) throw new HttpError(400, "seeds must be whole numbers");
  if (seeds.length > 60) throw new HttpError(400, "at most 60 seeds per request");
  return seeds.sort((a, b) => a - b);
}

export function parseWeeks(raw: unknown): { weeks: number; end: string } {
  const all = horizonWeeks().length;
  if (raw === undefined || raw === null) return { weeks: all, end: HORIZON.end };
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) throw new HttpError(400, "weeks must be a whole number of at least 1");
  const weeks = Math.min(all, n);
  return { weeks, end: endOfWeeks(weeks) };
}

const policyName = (id: string) => makePolicy(id).name;

// ---------------------------------------------------------------------------------------------
// Handlers

export async function simulateHandler(body: Record<string, unknown>) {
  const t0 = performance.now();
  const policy = checkPolicy(body.policy);
  const config = cleanConfig(body.config);
  const seeds = parseSeeds(body.seeds, body.quick === true);
  const { weeks, end } = parseWeeks(body.weeks);
  const noBehaviour = body.noBehaviour === true;
  const results = await runSeeds({ policy, config, seeds, end, noBehaviour });
  const first = results[0]!;
  return {
    policy,
    policyName: policyName(policy),
    config: effectiveConfig(policy, config),
    seeds,
    weeks,
    horizon: { start: HORIZON.start, end },
    sittingDays: horizonWeeks(end).reduce((s, w) => s + w.sittingDays, 0),
    noBehaviour,
    summary: summaryOf(results.map((r) => r.scorecards)),
    initial: { pendingByAge: first.initial.byAge, pendingByStage: first.initial.byStage },
    weekly: weeklyOf(results, end),
    elapsedMs: Math.round(performance.now() - t0),
  };
}

export async function compareHandler(body: Record<string, unknown>) {
  const t0 = performance.now();
  const side = (x: unknown, name: string) => {
    if (!x || typeof x !== "object") throw new HttpError(400, "a and b are required", `${name} is missing`);
    const o = x as Record<string, unknown>;
    return { policy: checkPolicy(o.policy), config: cleanConfig(o.config) };
  };
  const a = side(body.a, "a");
  const b = side(body.b, "b");
  const seeds = parseSeeds(body.seeds, body.quick === true);
  const { weeks, end } = parseWeeks(body.weeks);
  const noBehaviour = body.noBehaviour === true;
  const [ra, rb] = await Promise.all([runSeeds({ ...a, seeds, end, noBehaviour }), runSeeds({ ...b, seeds, end, noBehaviour })]);
  const out = (s: typeof a, r: SeedResult[]) => ({
    policy: s.policy,
    policyName: policyName(s.policy),
    config: effectiveConfig(s.policy, s.config),
    summary: summaryOf(r.map((x) => x.scorecards)),
    weekly: weeklyOf(r, end),
  });
  return {
    seeds,
    weeks,
    horizon: { start: HORIZON.start, end },
    a: out(a, ra),
    b: out(b, rb),
    diff: diffSummary(
      ra.map((x) => x.scorecards),
      rb.map((x) => x.scorecards),
    ),
    elapsedMs: Math.round(performance.now() - t0),
  };
}

