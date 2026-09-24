// One policy on one world seed over the horizon (or its first weeks): the arena's run, scored by the same
// code with the same inputs (src/eval/metrics.ts), plus the weekly series the console charts. The policy is
// wrapped only to read the docket each morning at week boundaries (age band and stage counts); it plans
// exactly as it would unwrapped. The run goes one working day past the window so the last week's end state
// can be read the same way; rows after the window are dropped before scoring.

import { caseIdOf } from "../data/roster";
import type { CaseView, HearingLog, JudgeConfig, Policy, RunResult, Scorecards, SequentialType } from "../domain/types";
import { SEQUENCE } from "../domain/types";
import { scorecards } from "../eval/metrics";
import { simulate } from "../world/simulate";
import { AGE_BANDS, CAPACITY, HORIZON, ROSTER_ID, ageBand, ageYears, effectiveConfig, getEnv, horizonWeeks, makePolicy, nextWorkingDayAfter, type AgeBand } from "./context";

export interface SeedJob {
  policy: string;
  config?: Partial<JudgeConfig>;
  seed: number;
  /** last day of the window (inclusive) */
  end: string;
  noBehaviour?: boolean;
}

export interface WeekRow {
  listed: number;
  reached: number;
  substantive: number;
  disposed: number;
  desk: number;
  vacated: number;
  minutesUsed: number;
  overrunDays: number;
  /** pending at the end of the week */
  pendingByAge: Record<AgeBand, number>;
  pendingByStage: Record<SequentialType, number>;
  pending4Plus: number;
  /** disposals that week of cases then aged 3-4, 4-5 and 5+ years */
  out: Record<"3" | "4" | "5", number>;
}

export interface SeedResult {
  seed: number;
  scorecards: Scorecards;
  weeks: WeekRow[];
  /** the docket on the first morning (the same on every seed and policy) */
  initial: { byAge: Record<AgeBand, number>; byStage: Record<SequentialType, number> };
  elapsedMs: number;
}

const zeroBands = (): Record<AgeBand, number> => Object.fromEntries(AGE_BANDS.map((b) => [b, 0])) as Record<AgeBand, number>;
const zeroStages = (): Record<SequentialType, number> => Object.fromEntries(SEQUENCE.map((s) => [s, 0])) as Record<SequentialType, number>;

/** Pending counts by age band (ages on `asOf`) and by underlying stage, from the morning views. */
export function docketCounts(cases: readonly CaseView[], asOf: string): { byAge: Record<AgeBand, number>; byStage: Record<SequentialType, number>; plus4: number } {
  const byAge = zeroBands();
  const byStage = zeroStages();
  let plus4 = 0;
  for (const c of cases) {
    if (c.disposed) continue;
    const a = ageYears(c.filingDate, asOf);
    byAge[ageBand(a)]++;
    if (a >= 4) plus4++;
    byStage[c.stage]++;
  }
  return { byAge, byStage, plus4 };
}

export function runSeed(job: SeedJob): SeedResult {
  const t0 = performance.now();
  const env = getEnv();
  const config = effectiveConfig(job.policy, job.config);
  const inner = makePolicy(job.policy, job.config);
  const weeks = horizonWeeks(job.end);
  const runEnd = nextWorkingDayAfter(job.end, env.calendar);
  // the morning after each week is that week's end state
  const snapAt = new Map<string, number>();
  weeks.forEach((w, i) => snapAt.set(nextWorkingDayAfter(w.end, env.calendar), i));
  const snaps: ({ byAge: Record<AgeBand, number>; byStage: Record<SequentialType, number>; plus4: number } | null)[] = weeks.map(() => null);
  let lastViews: readonly CaseView[] | null = null;
  let initial: SeedResult["initial"] | null = null;
  const policy: Policy = {
    id: inner.id,
    name: inner.name,
    description: inner.description,
    asksCheckin: inner.asksCheckin,
    initialDates: (ctx) => inner.initialDates(ctx),
    nextDate: (ctx, c, outcome, d) => inner.nextDate(ctx, c, outcome, d),
    plan: (ctx) => {
      const i = snapAt.get(ctx.date);
      if (i !== undefined) snaps[i] = docketCounts(ctx.cases, weeks[i]!.end);
      if (!initial) {
        const d = docketCounts(ctx.cases, HORIZON.start);
        initial = { byAge: d.byAge, byStage: d.byStage };
      }
      lastViews = ctx.cases;
      return inner.plan(ctx);
    },
  };
  const run: RunResult = simulate({
    records: env.records,
    rosterId: ROSTER_ID,
    policy,
    config,
    ref: env.ref,
    calendar: env.calendar,
    worldSeed: job.seed,
    start: HORIZON.start,
    end: runEnd,
    params: env.params,
    capacityMinutes: CAPACITY,
    noBehaviour: job.noBehaviour,
    scorecards: false,
  });
  const hearings: HearingLog[] = run.hearings.filter((h) => h.date <= job.end);
  const days = run.days.filter((d) => d.date <= job.end);
  const cards = scorecards({
    hearings,
    days,
    records: env.records,
    start: HORIZON.start,
    end: job.end,
    capacityMinutes: CAPACITY,
    asOf: job.end,
    minGapDays: env.gaps,
  });

  // a week whose morning-after was never simulated (should not happen) falls back to the last views seen
  const filingOf = new Map(env.records.map((r) => [caseIdOf(r), r.filingDate]));
  const rows: WeekRow[] = weeks.map((w, i) => {
    const inWeek = (d: string) => d >= w.start && d <= w.end;
    const ds = days.filter((d) => inWeek(d.date));
    const out = { "3": 0, "4": 0, "5": 0 };
    let disposed = 0;
    for (const h of hearings) {
      if (!h.disposed || !inWeek(h.date)) continue;
      disposed++;
      const a = ageYears(filingOf.get(h.caseId) ?? h.date, h.date);
      if (a >= 5) out["5"]++;
      else if (a >= 4) out["4"]++;
      else if (a >= 3) out["3"]++;
    }
    const snap = snaps[i] ?? docketCounts(lastViews ?? [], w.end);
    return {
      listed: sum(ds.map((d) => d.listed)),
      reached: sum(ds.map((d) => d.reached)),
      substantive: sum(ds.map((d) => d.substantive)),
      disposed,
      desk: sum(ds.map((d) => d.desk)),
      vacated: sum(ds.map((d) => d.vacated)),
      minutesUsed: sum(ds.map((d) => d.minutesUsed)),
      overrunDays: ds.filter((d) => d.overran || d.minutesUsed > CAPACITY).length,
      pendingByAge: snap.byAge,
      pendingByStage: snap.byStage,
      pending4Plus: snap.plus4,
      out,
    };
  });
  const first = initial ?? { byAge: zeroBands(), byStage: zeroStages() };
  return { seed: job.seed, scorecards: cards, weeks: rows, initial: first, elapsedMs: Math.round(performance.now() - t0) };
}

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
