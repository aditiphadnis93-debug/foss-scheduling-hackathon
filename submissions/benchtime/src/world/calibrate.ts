// Fit the world's per-type latent parameters so that, under a plain status-quo court, the simulated
// P(substantive | reached) and failure-reason shares per hearing type match PUCAR's tables. The
// resolution order makes each reason a hazard given the earlier steps passed, so each knob is adjusted
// against its own step's hazard (iterative proportional fitting, averaged over the training seeds).
// The calibration court is a realistic one: about 75 cases listed a day (PUCAR's real 22 Sep list has 90),
// dates spread by a daily cap so no Monday carries a weekend's pile-up. The fit is also reported under
// status_quo_60, the case study's default court.
// CLI: bun run src/world/calibrate.ts [--cases 3000] [--seeds 20] [--iterations 10] [--judgement table] [--cap 75]

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { addDays, loadCalendar, nextWorkingDayAfter, nextWorkingDayOnOrAfter } from "../data/calendar";
import { DATA_DIR, loadRefTables } from "../data/reference";
import { loadRoster } from "../data/roster";
import { hashSeed } from "../domain/rng";
import { FAILURE_REASONS, HEARING_TYPES } from "../domain/types";
import type { CaseRecord, CaseView, CourtCalendar, DayPlan, FailureReason, HearingType, JudgeConfig, Listing, PlanContext, Policy, RefTables, RunResult } from "../domain/types";
import type { WorldParams } from "./api";
import { CALIBRATED_PATH, defaultParams, targetsFor, type JudgementRule, type TypeTarget } from "./defaults";
import { simulate } from "./simulate";
import { PER_TYPE_KEYS, type PerTypeKey } from "./world";
// the CLI also reports the fit under the case study's default court (the world may import planners; never the reverse)
import { defaultConfig, POLICIES } from "../planner/index";

// ---------------------------------------------------------------------------------------------
// The calibration court: every due case listed, oldest first; next date = PUCAR's gap for the next purpose,
// on the first working day from there with room under a daily cap

const fifo = (a: CaseView, b: CaseView): number =>
  (a.nextDate ?? "") < (b.nextDate ?? "") ? -1 : (a.nextDate ?? "") > (b.nextDate ?? "") ? 1 : a.filingDate < b.filingDate ? -1 : a.filingDate > b.filingDate ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/** First working day on or after `date + days`, strictly after `date`. */
function afterGapDays(date: string, days: number, cal: CourtCalendar): string {
  return nextWorkingDayOnOrAfter(addDays(date, Math.max(1, Math.round(days))), cal);
}

/** Cases a day the calibration court lists: the middle of 60-90 (PUCAR's real 22 Sep list has 90). */
export const CALIBRATION_DAILY_CAP = 75;

/**
 * A status-quo court with a daily cap. Its booking ledger is reset by initialDates, which the simulator calls
 * first in every run, so one policy object serves consecutive runs.
 */
export function makeCalibrationPolicy(dailyCap = CALIBRATION_DAILY_CAP): Policy {
  const booked = new Map<string, number>();
  const book = (from: string, cal: CourtCalendar): string => {
    let d = nextWorkingDayOnOrAfter(from, cal);
    while ((booked.get(d) ?? 0) >= dailyCap) d = nextWorkingDayAfter(d, cal);
    booked.set(d, (booked.get(d) ?? 0) + 1);
    return d;
  };
  return {
    id: "calibration_status_quo",
    name: "Calibration status quo",
    description: `Every due case is listed, earliest promised date first; the next date is PUCAR's reference gap for the next purpose, on the first working day with room under ${dailyCap} cases a day.`,
    asksCheckin: false,
    initialDates(ctx) {
      booked.clear();
      // in an order fixed by a hash of the case id, so every stage and age is represented from the first week
      const live = ctx.cases.filter((c) => !c.disposed).sort((a, b) => hashSeed(a.id) - hashSeed(b.id) || (a.id < b.id ? -1 : 1));
      return new Map(live.map((c) => [c.id, book(ctx.date, ctx.calendar)]));
    },
    plan: (ctx) => calibrationPlan(ctx),
    nextDate: (ctx, c, _outcome, date) => book(afterGapDays(date, ctx.ref[c.nextPurpose].gapDays, ctx.calendar), ctx.calendar),
  };
}

/** Every due case, earliest promised date first (the cap keeps the list near a real day's size). */
function calibrationPlan(ctx: PlanContext): DayPlan {
  const due = ctx.cases.filter((c) => !c.disposed && c.nextDate !== null && c.nextDate <= ctx.date).sort(fifo);
  const listings: Listing[] = due.map((c, i) => ({
    caseId: c.id,
    type: c.nextPurpose,
    order: i,
    callTime: null,
    window: null,
    standby: false,
    expectedMinutes: ctx.ref[c.nextPurpose].durationMin,
    pSubstantive: ctx.ref[c.nextPurpose].pSubstantive,
    why: ["due today"],
  }));
  const minutes = listings.reduce((s, l) => s + l.expectedMinutes * l.pSubstantive + 2 * (1 - l.pSubstantive), 0);
  const substantive = listings.reduce((s, l) => s + l.pSubstantive, 0);
  return { date: ctx.date, listings, desk: [], deferred: [], expected: { minutes, substantive, overrunRisk: minutes > ctx.capacityMinutes ? 1 : 0 } };
}

export const calibrationPolicy: Policy = makeCalibrationPolicy();

/** A neutral judge configuration (the calibration policy reads none of it). */
export const CALIBRATION_CONFIG: JudgeConfig = {
  weights: { throughput: 1, substantiveness: 1, fairness: 1, predictability: 1, trips: 1 },
  fillTarget: 1,
  ageingFloor: 0.15,
  clusterByAdvocate: false,
  blocks: [],
  carryForward: false,
  processDesk: false,
  checkin: false,
  standbyShare: 0,
  smartNextDate: false,
};

// ---------------------------------------------------------------------------------------------
// Measurement

/** Resolution steps a failure reason stops at (see resolve.ts STEPS). */
const STEP_OF: Record<FailureReason, number> = {
  court_admin: 0,
  court_holiday: -1,
  awaiting_process: 1,
  external_dependency: 2,
  respondent_absent: 3,
  petitioner_absent: 3,
  both_absent: 3,
  not_ready: 4,
  sought_time: 5,
  unclear: 6,
};

export interface TypeCounts {
  reached: number;
  substantive: number;
  reasons: Record<FailureReason, number>;
  /** substantive rows that moved on at a failure step (an absence moving APPEARANCE to WARRANT, a default acquittal), by step */
  moved: number[];
}

const zeroReasons = (): Record<FailureReason, number> => Object.fromEntries(FAILURE_REASONS.map((f) => [f, 0])) as Record<FailureReason, number>;

/** Count called hearings per type by outcome and reason across runs. */
export function countByType(runs: readonly RunResult[]): Record<HearingType, TypeCounts> {
  const out = {} as Record<HearingType, TypeCounts>;
  for (const t of HEARING_TYPES) out[t] = { reached: 0, substantive: 0, reasons: zeroReasons(), moved: [0, 0, 0, 0, 0, 0, 0] };
  for (const run of runs) {
    for (const h of run.hearings) {
      if (h.outcome !== "substantive" && h.outcome !== "failed") continue;
      const c = out[h.type];
      c.reached++;
      if (h.outcome === "substantive") {
        c.substantive++;
        const st = h.movedBy ? STEP_OF[h.movedBy] : -1;
        if (st >= 0) c.moved[st]!++;
      } else if (h.reason) c.reasons[h.reason]++;
    }
  }
  return out;
}

export interface TypeFit {
  type: HearingType;
  reached: number;
  target: { pSub: number; share: Record<FailureReason, number>; source: string };
  simulated: { pSub: number; share: Record<FailureReason, number> };
  pSubError: number;
  /** largest absolute error over the failure shares */
  maxShareError: number;
  /** PUCAR's own evidence: failed hearings in its failure table, hearings implied behind P(substantive), and each table's source */
  pucar: { failures: number; hearings: number; pSubSource: "real" | "estimated"; failureSource: "real" | "estimated" };
  /** the tolerance this type is judged by (two standard errors of PUCAR's own estimate, never tighter than the floors) */
  tol: { pSub: number; share: number };
  /** what was judged: P(substantive), the shares, both, or nothing (estimated targets or too little evidence) */
  judged: { pSub: boolean; share: boolean };
  withinTolerance: boolean;
}

export interface CalibrationFit {
  seeds: number[];
  cases: number;
  iterations: number;
  judgement: JudgementRule;
  tolerance: { pSub: number; share: number; minReached: number };
  perType: Record<HearingType, TypeFit>;
  /** reached-weighted mean absolute error in P(substantive) */
  meanPSubError: number;
  notes: string[];
}

/**
 * Judge the fit by PUCAR's own evidence. P(substantive) is judged when its source is real and rests on at
 * least 50 hearings; the shares when the failure table is real and counts at least 30 failures. Each is
 * allowed two standard errors of PUCAR's estimate (a share from 45 failures is itself uncertain by several
 * points), never less than the floors. The simulation must also have called enough hearings to measure.
 */
export function fitReport(counts: Record<HearingType, TypeCounts>, targets: Record<HearingType, TypeTarget>, ref?: RefTables, tol = { pSub: 0.03, share: 0.06, minReached: 200 }): Omit<CalibrationFit, "seeds" | "cases" | "iterations" | "judgement" | "notes"> {
  const perType = {} as Record<HearingType, TypeFit>;
  let wErr = 0;
  let wSum = 0;
  for (const t of HEARING_TYPES) {
    const c = counts[t];
    const tg = targets[t];
    const failed = c.reached - c.substantive;
    const share = zeroReasons();
    for (const f of FAILURE_REASONS) share[f] = failed > 0 ? c.reasons[f] / failed : 0;
    const pSub = c.reached > 0 ? c.substantive / c.reached : NaN;
    const pSubError = c.reached > 0 ? Math.abs(pSub - tg.pSub) : NaN;
    let maxShareError = 0;
    let worstShare = 0.5;
    if (failed > 0 && tg.pSub < 1)
      for (const f of FAILURE_REASONS) {
        const e = Math.abs(share[f] - tg.share[f]);
        if (e > maxShareError) {
          maxShareError = e;
          worstShare = tg.share[f];
        }
      }
    const r = ref?.[t];
    const failures = r?.failureCount ?? 0;
    const hearings = r ? (r.pSubstantive < 1 ? Math.round(failures / (1 - r.pSubstantive)) : 0) : 0;
    const pucar = { failures, hearings, pSubSource: r?.pSubstantiveSource ?? "real", failureSource: r?.failureSource ?? "real" };
    const se = (p: number, n: number) => (n > 0 ? Math.sqrt(Math.max(p * (1 - p), 0.01) / n) : 1);
    const typeTol = { pSub: Math.max(tol.pSub, 2 * se(tg.pSub, hearings)), share: Math.max(tol.share, 2 * se(worstShare, failures)) };
    const enoughSim = c.reached >= tol.minReached;
    const judged = {
      pSub: enoughSim && (!r || (pucar.pSubSource === "real" && hearings >= 50)),
      share: enoughSim && failed >= tol.minReached / 2 && (!r || (pucar.failureSource === "real" && failures >= 30)),
    };
    perType[t] = {
      type: t,
      reached: c.reached,
      target: { pSub: tg.pSub, share: tg.share, source: tg.source },
      simulated: { pSub, share },
      pSubError,
      maxShareError,
      pucar,
      tol: typeTol,
      judged,
      withinTolerance: (!judged.pSub || pSubError <= typeTol.pSub) && (!judged.share || maxShareError <= typeTol.share),
    };
    if (c.reached > 0) {
      wErr += pSubError * c.reached;
      wSum += c.reached;
    }
  }
  return { tolerance: tol, perType, meanPSubError: wSum > 0 ? wErr / wSum : NaN };
}

// ---------------------------------------------------------------------------------------------
// Fitting

export interface CalibrateOptions {
  records: readonly CaseRecord[];
  ref: RefTables;
  calendar: CourtCalendar;
  seeds: readonly number[];
  start?: string;
  end?: string;
  iterations?: number;
  judgement?: JudgementRule;
  /** starting parameters; defaults to the analytic first guess from the tables */
  initial?: WorldParams;
  /** the court the fit runs under (default: the calibration status quo) */
  policy?: Policy;
  config?: JudgeConfig;
  onIteration?: (i: number, meanPSubError: number, seconds: number) => void;
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/**
 * Knobs held at a stated value instead of fitted. Before APPEARANCE the accused is not yet a party, so an
 * accused-side absence multiplier there has no effect: it is held neutral (PUCAR's 3.6% respondent absence
 * at ADMISSION cannot be reproduced and is reported). JUDGEMENT: a warrant issues only after the accused
 * stays away (never on entry), so its process share comes through absences; the accused-side multiplier is
 * an assumption and the residual rate is fitted to P(substantive) instead of to the 4-failure table.
 */
export const PINNED: Partial<Record<HearingType, Partial<Record<PerTypeKey, number>>>> = {
  ADMISSION: { absA: 1 },
  DELAY_CONDONATION_HEARING: { absA: 1 },
  COGNIZANCE: { absA: 1 },
  JUDGEMENT: { procP: 0, procScale: 1, absA: 0.25 },
};
const FIT_UNCLEAR_TO_PSUB = new Set<HearingType>(["JUDGEMENT"]);

/** Adjust a probability knob and its delay-scale partner toward a target hazard (probability first, then delay). */
function adjustPair(tp: Record<string, number>, pKey: string, sKey: string, target: number, sim: number, reach: number): void {
  if (reach < 20) return;
  if (target <= 1e-9) {
    tp[pKey] = 0;
    // structural process can still be out: make it come back faster
    if (sim > 0.002) tp[sKey] = clamp(tp[sKey]! * 0.6, 0.05, 20);
    return;
  }
  const ratio = sim > 1e-9 ? clamp(target / sim, 0.3, 3) : 3;
  const damp = Math.pow(ratio, 0.8);
  let p = tp[pKey]!;
  let s = tp[sKey]!;
  if (ratio > 1) {
    if (s < 1) s = Math.min(1, s * damp);
    else if (p < 1) p = Math.min(1, Math.max(p, 0.02) * damp);
    else s = s * damp;
  } else {
    if (s > 1) s = Math.max(1, s * damp);
    else if (p > 0.02) p = p * damp;
    else s = s * damp;
  }
  tp[pKey] = clamp(p, 0, 1);
  tp[sKey] = clamp(s, 0.05, 20);
}

/** One multiplicative step on a directly drawn rate toward its target hazard. */
function adjustRate(tp: Record<string, number>, key: string, target: number, sim: number, reach: number): void {
  if (reach < 20) return;
  if (target <= 1e-9) {
    tp[key] = 0;
    return;
  }
  const cur = tp[key]!;
  tp[key] = clamp(sim > 1e-9 && cur > 0 ? cur * clamp(target / sim, 0.3, 3) : Math.max(cur, target), 0, 0.95);
}

/**
 * Target hazards per step: the reason's probability given every earlier step passed. `moved` is the share of
 * called hearings the simulation moves on at each step (substantive by PUCAR's definition, an absence drawing
 * a warrant): they leave the risk set too, so the unconditional failure rates still land on PUCAR's and
 * P(substantive), moves included, lands on its target.
 */
function targetHazards(q: Record<FailureReason, number>, moved: readonly number[] = []): { step: number[]; att: { resp: number; pet: number; both: number } } {
  const stepQ = [q.court_admin, q.awaiting_process, q.external_dependency, q.respondent_absent + q.petitioner_absent + q.both_absent, q.not_ready, q.sought_time, q.unclear];
  const step: number[] = [];
  let left = 1;
  stepQ.forEach((x, k) => {
    step.push(left > 1e-9 ? Math.min(0.95, x / left) : 0);
    left -= x + (moved[k] ?? 0);
  });
  const leftAtt = 1 - q.court_admin - q.awaiting_process - q.external_dependency - (moved[0] ?? 0) - (moved[1] ?? 0) - (moved[2] ?? 0);
  const h = (x: number) => (leftAtt > 1e-9 ? x / leftAtt : 0);
  return { step, att: { resp: h(q.respondent_absent), pet: h(q.petitioner_absent), both: h(q.both_absent) } };
}

/** Simulated hazards per step from the counts (rows that moved on at a step leave the later steps' risk set). */
function simHazards(c: TypeCounts): { step: number[]; reach: number[]; att: { resp: number; pet: number; both: number } } {
  const fails = [0, 0, 0, 0, 0, 0, 0];
  for (const f of FAILURE_REASONS) {
    const s = STEP_OF[f];
    if (s >= 0) fails[s]! += c.reasons[f];
  }
  const reach: number[] = [];
  const step: number[] = [];
  let left = c.reached;
  for (let k = 0; k < 7; k++) {
    reach.push(left);
    step.push(left > 0 ? fails[k]! / left : 0);
    left -= fails[k]! + (c.moved[k] ?? 0);
  }
  const r3 = reach[3]!;
  const h = (x: number) => (r3 > 0 ? x / r3 : 0);
  return { step, reach, att: { resp: h(c.reasons.respondent_absent), pet: h(c.reasons.petitioner_absent), both: h(c.reasons.both_absent) } };
}

export function runSeeds(params: WorldParams, o: CalibrateOptions): RunResult[] {
  return o.seeds.map((worldSeed) =>
    simulate({
      records: o.records,
      rosterId: "calibration",
      policy: o.policy ?? calibrationPolicy,
      config: o.config ?? CALIBRATION_CONFIG,
      ref: o.ref,
      calendar: o.calendar,
      worldSeed,
      start: o.start ?? "2026-10-01",
      end: o.end ?? "2026-12-15",
      params,
      scorecards: false,
    }),
  );
}

export function calibrate(o: CalibrateOptions): { params: WorldParams; fit: CalibrationFit } {
  const judgement = o.judgement ?? "hearings_per_case";
  const targets = targetsFor(o.ref, judgement);
  const params: WorldParams = structuredClone(o.initial ?? defaultParams(o.ref, o.records, { useCalibrated: false }));
  for (const [t, pin] of Object.entries(PINNED)) params.perType[t] = { ...(params.perType[t] ?? {}), ...pin };
  const iterations = o.iterations ?? 8;
  let counts = countByType(runSeeds(params, o));
  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now();
    for (const t of HEARING_TYPES) {
      const c = counts[t];
      if (c.reached < 20) continue;
      const tp = (params.perType[t] ??= {});
      const T = targetHazards(
        targets[t].q,
        c.moved.map((m) => m / c.reached),
      );
      const S = simHazards(c);
      const pinned = PINNED[t] ?? {};
      const free = (k: PerTypeKey) => pinned[k] === undefined;
      if (free("admin")) adjustRate(tp, "admin", T.step[0]!, S.step[0]!, S.reach[0]!);
      if (free("procP")) adjustPair(tp, "procP", "procScale", T.step[1]!, S.step[1]!, S.reach[1]!);
      adjustPair(tp, "extP", "extScale", T.step[2]!, S.step[2]!, S.reach[2]!);
      if (S.reach[3]! >= 20) {
        // absences: scale each side's absence toward its reason's hazard; the joint shock takes up the rest of "both"
        const side = (key: "absA" | "absC", target: number, sim: number) => {
          if (!free(key)) return;
          if (target <= 1e-9) tp[key] = 0;
          else tp[key] = clamp(sim > 1e-9 ? Math.max(tp[key]!, 0.01) * Math.pow(clamp(target / sim, 0.3, 3), 0.8) : Math.max(tp[key]!, 0.05) * 2, 0, 5);
        };
        side("absA", T.att.resp, S.att.resp);
        side("absC", T.att.pet, S.att.pet);
        tp.both = clamp(tp.both! + 0.8 * (T.att.both - S.att.both), 0, 0.9);
      }
      adjustRate(tp, "notReady", T.step[4]!, S.step[4]!, S.reach[4]!);
      adjustRate(tp, "soughtTime", T.step[5]!, S.step[5]!, S.reach[5]!);
      if (FIT_UNCLEAR_TO_PSUB.has(t)) {
        // the residual takes up whatever keeps P(substantive) off target
        const simFail = c.reached > 0 ? 1 - c.substantive / c.reached : 0;
        const want = 1 - targets[t].pSub;
        const cur = tp.unclear ?? 0;
        tp.unclear = clamp(cur + 0.8 * (want - simFail), 0, 0.95);
      } else adjustRate(tp, "unclear", T.step[6]!, S.step[6]!, S.reach[6]!);
    }
    counts = countByType(runSeeds(params, o));
    o.onIteration?.(i + 1, fitReport(counts, targets, o.ref).meanPSubError, (performance.now() - t0) / 1000);
  }
  // round for a readable file; the rounding is far below the fit's noise
  for (const t of HEARING_TYPES) for (const k of PER_TYPE_KEYS) if (params.perType[t]?.[k] !== undefined) params.perType[t]![k] = Math.round(params.perType[t]![k]! * 1e4) / 1e4;
  const rep = fitReport(counts, targets, o.ref);
  const notes = [
    `JUDGEMENT follows ${targets.JUDGEMENT.source}: PUCAR's substantiveness table marks it 100% (estimated) while its failure row lists adjourned judgement hearings and the observed mean is ${o.ref.JUDGEMENT.hearingsPerCase.mean} hearings per case.`,
    "Court holiday shares are left out of the per-type targets: a no-sitting day is a whole-day closure (closureProb), never a called hearing.",
    "Types with fewer than 200 called hearings across the seeds are reported but not judged against the tolerance; failure shares are judged only when there are at least 100 failed hearings.",
    "Process and mediation reports recorded as out in a roster summary were ordered at the last hearing, taken to be 1 to 60 days before the start (the roster's own next dates are ignored), so some are already back when the horizon opens.",
    "Absconding (warrants never executed) is modelled only at the WARRANT stage; warrants at plea, examination or judgment come back on their fitted delay. Without this the roster's outstanding warrants at PLEA would contradict PUCAR's 0% awaiting-process share there.",
    "Awaiting-process and external-dependency failures are fitted through two knobs per type: the probability that process (or a report) is out when a case comes to the purpose, then a multiplier on its delay once that probability reaches 1 or the lifecycle's own summons and warrants already exceed the target.",
    "A failure that changes the purpose (the accused away after service, APPEARANCE to WARRANT) and a failure that ends the case (default acquittal, dismissal for steps, split-up) count as substantive: PUCAR's definition is that the hearing moved the case to its next purpose. So PUCAR's respondent-absence share at APPEARANCE is reachable only through the absences that do not draw a warrant.",
    "Process and reports ordered before the horizon but not recorded in the roster summary are hidden from planners until a hearing fails for them; the fit is unaffected (the calibration court reads neither).",
    "Held, not fitted: the accused-side absence multiplier before APPEARANCE (no effect: the accused is not yet a party) and at JUDGEMENT (0.25, an assumption: a warrant issues only after the accused stays away, so JUDGEMENT's residual rate is fitted to P(substantive) rather than to its four-failure estimated table).",
  ];
  return { params, fit: { ...rep, seeds: [...o.seeds], cases: o.records.length, iterations, judgement, notes } };
}

// ---------------------------------------------------------------------------------------------
// Report

const pct = (x: number) => (Number.isFinite(x) ? `${(x * 100).toFixed(1)}%` : "n/a");
const SHORT: Record<FailureReason, string> = {
  court_admin: "admin",
  court_holiday: "holiday",
  respondent_absent: "resp. absent",
  petitioner_absent: "pet. absent",
  sought_time: "sought time",
  not_ready: "not ready",
  awaiting_process: "process",
  external_dependency: "external",
  both_absent: "both absent",
  unclear: "unclear",
};

function verdictOf(f: TypeFit): string {
  if (!f.judged.pSub && !f.judged.share) return f.pucar.pSubSource === "estimated" && f.pucar.failureSource === "estimated" ? "estimated targets: reported, not judged" : "too little evidence to judge";
  const what = f.judged.pSub && f.judged.share ? "" : f.judged.pSub ? " (P(substantive) only)" : " (shares only)";
  return `${f.withinTolerance ? "yes" : "no"}${what}`;
}

function fitTable(L: string[], perType: Record<HearingType, TypeFit>): void {
  L.push(
    "| Type | Called hearings | Target | Simulated | Error | PUCAR hearings (P(sub) source) | PUCAR failures (source) | Tolerance P(sub) / share | Largest share error | Within tolerance |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|---|",
  );
  for (const t of HEARING_TYPES) {
    const f = perType[t];
    const hearings = f.pucar.pSubSource === "estimated" ? "estimated" : `${f.pucar.hearings} (real)`;
    L.push(
      `| ${t} | ${f.reached} | ${pct(f.target.pSub)} | ${pct(f.simulated.pSub)} | ${pct(f.pSubError)} | ${hearings} | ${f.pucar.failures} (${f.pucar.failureSource}) | ${pct(f.tol.pSub)} / ${pct(f.tol.share)} | ${pct(f.maxShareError)} | ${verdictOf(f)} |`,
    );
  }
}

export function fitMarkdown(
  fit: CalibrationFit,
  params: WorldParams,
  runtime: { oneRunSeconds: number; totalSeconds: number; subsample: string; dailyCap?: number },
  statusQuo?: { perType: Record<HearingType, TypeFit>; meanPSubError: number; listedPerDay: number; reachedPerDay: number },
): string {
  const L: string[] = [];
  L.push("# World calibration fit", "");
  L.push(
    `Fitted under the calibration status quo (every due case listed, earliest promised date first; next date at PUCAR's reference gap, on the first working day with room under ${runtime.dailyCap ?? CALIBRATION_DAILY_CAP} cases a day, so no Monday carries a weekend's pile-up; first dates spread the same way in a fixed hash order) on world seeds ${fit.seeds[0]}-${fit.seeds[fit.seeds.length - 1]} ` +
      `with ${fit.cases} cases of the seed-42 roster (${runtime.subsample}), ${fit.iterations} iterations of proportional fitting.`,
  );
  L.push(`One simulate() call on this roster took ${runtime.oneRunSeconds.toFixed(2)} s; the whole fit took ${runtime.totalSeconds.toFixed(0)} s.`, "");
  L.push(
    `Tolerance is judged by PUCAR's own evidence: P(substantive) where its source is real and rests on at least 50 hearings, the failure shares where PUCAR's failure table is real and counts at least 30 failures. ` +
      `Each is allowed two standard errors of PUCAR's estimate, never less than ${fit.tolerance.pSub * 100} points for P(substantive) and ${fit.tolerance.share * 100} points for a share; the simulation must also have called at least ${fit.tolerance.minReached} hearings of the type.`,
  );
  L.push(`Reached-weighted mean absolute error in P(substantive): ${pct(fit.meanPSubError)}.`, "");
  L.push("## P(substantive | reached)", "");
  fitTable(L, fit.perType);
  L.push("", "## Failure shares among failed called hearings (target / simulated)", "");
  const reasons = FAILURE_REASONS.filter((r) => r !== "court_holiday");
  L.push(`| Type | ${reasons.map((r) => SHORT[r]).join(" | ")} |`, `|---|${reasons.map(() => "---:").join("|")}|`);
  for (const t of HEARING_TYPES) {
    const f = fit.perType[t];
    L.push(`| ${t} | ${reasons.map((r) => `${pct(f.target.share[r])} / ${pct(f.simulated.share[r])}`).join(" | ")} |`);
  }
  L.push("", "## Fitted per-type parameters", "");
  L.push(`| Type | ${PER_TYPE_KEYS.join(" | ")} |`, `|---|${PER_TYPE_KEYS.map(() => "---:").join("|")}|`);
  for (const t of HEARING_TYPES) L.push(`| ${t} | ${PER_TYPE_KEYS.map((k) => (params.perType[t]?.[k] ?? 0).toFixed(3)).join(" | ")} |`);
  if (statusQuo) {
    L.push("", "## The same world under status_quo_60", "");
    L.push(
      `The fitted world, unchanged, run under the case study's default court (every due case listed, a flat 60-day gap, called in list order) on the same seeds: ${statusQuo.listedPerDay.toFixed(1)} listed and ${statusQuo.reachedPerDay.toFixed(1)} reached per sitting day. ` +
        `Reached-weighted mean absolute error in P(substantive): ${pct(statusQuo.meanPSubError)}. The world's latent rates do not depend on the court, so differences here come from which cases and stages each court reaches.`,
      "",
    );
    fitTable(L, statusQuo.perType);
  }
  L.push("", "## Notes", "");
  for (const n of fit.notes) L.push(`- ${n}`);
  L.push(
    `- Assumptions held fixed during the fit: failed hearings take ${params.callMinutes} minutes, duration CV ${params.durationCv}, closure probability ${params.closureProb.toFixed(4)} per day (PUCAR's holiday count over all hearings), ${Math.round(params.abscondShare * 100)}% of warrants at the WARRANT stage never executed, ${Math.round(params.settleOnReport * 100)}% of substantive mediation reports settle.`,
  );
  L.push("- The calibration policy asks no check-in and gives no call times, so the behaviour responses (and the check-in's false-alarm and unforeseen-failure rates) are not identified by this fit; they are assumptions and are swept in the experiments.");
  const d = params.disposal;
  L.push(
    `- Branch and disposal assumptions held fixed (PUCAR's hearing counts cannot identify them): P(delay condonation needed) ${params.pDelayCondonation ?? "default"}, P(warrant when a served accused stays away) ${params.pWarrantOnAbsence ?? "default"}` +
      (d ? `, default acquittal ${d.acquittalOnDefault}, dismissal for steps ${d.dismissalForSteps}, compounding ${d.compoundingHazard} per hearing with both parties present, split-up ${d.lpSplit} per call after ${d.lpAfterWarrantHearings} warrant hearings.` : "."),
  );
  L.push("");
  return L.join("\n");
}

// ---------------------------------------------------------------------------------------------
// CLI

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

if (import.meta.main) {
  const root = resolve(import.meta.dir, "../..");
  const ref = loadRefTables(DATA_DIR);
  const calendar = loadCalendar(DATA_DIR);
  const all = loadRoster(resolve(root, "data/roster_3000_seed42.csv"));
  const nSeeds = Number(arg("seeds") ?? 20);
  const seeds = Array.from({ length: nSeeds }, (_, i) => i + 1);
  const judgement = (arg("judgement") ?? "hearings_per_case") as JudgementRule;
  const dailyCap = Number(arg("cap") ?? CALIBRATION_DAILY_CAP);
  const policy = makeCalibrationPolicy(dailyCap);

  // time one full-roster run: advice only, the fit uses the full roster unless --cases says otherwise
  const base = defaultParams(ref, all, { useCalibrated: false });
  let t = performance.now();
  simulate({ records: all, rosterId: "seed42", policy, config: CALIBRATION_CONFIG, ref, calendar, worldSeed: 1, start: "2026-10-01", end: "2026-12-15", params: base, scorecards: false });
  const oneRunSeconds = (performance.now() - t) / 1000;
  const iterations = Number(arg("iterations") ?? 10);
  const projected = oneRunSeconds * nSeeds * (iterations + 2);
  let n = Number(arg("cases") ?? all.length);
  // a deterministic subsample when asked: every k-th case in roster order keeps the stage and age mix
  const records = n >= all.length ? all : all.filter((_, i) => i % Math.ceil(all.length / n) === 0);
  n = records.length;
  const subsample = n === all.length ? "the full roster" : `every ${Math.ceil(all.length / n)}th case, as asked with --cases`;
  console.log(`one full-roster run: ${oneRunSeconds.toFixed(2)} s; a full-roster fit should take about ${projected.toFixed(0)} s (pass --cases 600 for a quick look)`);
  console.log(`fitting on ${n} cases (${subsample}), ${nSeeds} seeds, ${iterations} iterations, at most ${dailyCap} cases listed a day`);

  t = performance.now();
  const { params, fit } = calibrate({
    records,
    ref,
    calendar,
    seeds,
    iterations,
    judgement,
    policy,
    initial: defaultParams(ref, all, { useCalibrated: false }),
    onIteration: (i, err, s) => console.log(`iteration ${i}: mean |P(sub) error| ${(err * 100).toFixed(2)} points (${s.toFixed(1)} s)`),
  });
  const totalSeconds = (performance.now() - t) / 1000;

  // the same fitted world under the case study's default court
  const sqRuns = runSeeds(params, { records, ref, calendar, seeds, policy: POLICIES.status_quo_60!(), config: defaultConfig("status_quo_60") });
  const sqRep = fitReport(countByType(sqRuns), targetsFor(ref, judgement), ref);
  const sitting = sqRuns.reduce((s, r) => s + r.days.filter((d) => d.listed > 0).length, 0);
  const statusQuo = {
    ...sqRep,
    listedPerDay: sqRuns.reduce((s, r) => s + r.days.reduce((a, d) => a + d.listed, 0), 0) / Math.max(1, sitting),
    reachedPerDay: sqRuns.reduce((s, r) => s + r.days.reduce((a, d) => a + d.reached, 0), 0) / Math.max(1, sitting),
  };

  const file = {
    note: "Fitted by src/world/calibrate.ts; see out/calibration-fit.md. Per-type keys are documented in src/world/world.ts.",
    fittedOn: { roster: "data/roster_3000_seed42.csv", cases: n, seeds, iterations, judgement, dailyCap },
    judgement,
    callMinutes: params.callMinutes,
    durationCv: params.durationCv,
    closureProb: params.closureProb,
    abscondShare: params.abscondShare,
    settleOnReport: params.settleOnReport,
    pDelayCondonation: params.pDelayCondonation,
    pWarrantOnAbsence: params.pWarrantOnAbsence,
    disposal: params.disposal,
    behaviour: params.behaviour,
    latent: params.latent,
    perType: params.perType,
    fit: Object.fromEntries(HEARING_TYPES.map((ty) => [ty, { reached: fit.perType[ty].reached, targetPSub: fit.perType[ty].target.pSub, simulatedPSub: fit.perType[ty].simulated.pSub, maxShareError: fit.perType[ty].maxShareError, withinTolerance: fit.perType[ty].withinTolerance }])),
    statusQuo60: { meanPSubError: statusQuo.meanPSubError, listedPerDay: statusQuo.listedPerDay, reachedPerDay: statusQuo.reachedPerDay },
  };
  writeFileSync(CALIBRATED_PATH, JSON.stringify(file, null, 2) + "\n");
  mkdirSync(resolve(root, "out"), { recursive: true });
  writeFileSync(resolve(root, "out/calibration-fit.md"), fitMarkdown(fit, params, { oneRunSeconds, totalSeconds, subsample, dailyCap }, statusQuo));
  console.log(`wrote ${CALIBRATED_PATH} and out/calibration-fit.md (${totalSeconds.toFixed(0)} s)`);
  for (const ty of HEARING_TYPES) {
    const f = fit.perType[ty];
    console.log(`${ty.padEnd(28)} n=${String(f.reached).padStart(6)} target ${pct(f.target.pSub).padStart(6)} sim ${pct(f.simulated.pSub).padStart(6)} max share err ${pct(f.maxShareError).padStart(6)} ${f.withinTolerance ? "" : "OUT"}`);
  }
  console.log(`under status_quo_60: mean |P(sub) error| ${(statusQuo.meanPSubError * 100).toFixed(2)} points, ${statusQuo.listedPerDay.toFixed(1)} listed a day`);
}
