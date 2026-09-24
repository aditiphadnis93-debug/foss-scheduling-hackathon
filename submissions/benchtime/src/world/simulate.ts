// The simulated court, day by day: the day-before check-in, the policy's plan (validated), the bench
// clock, and the consequences of each outcome (lifecycle, process, next date, disposal route). The policy
// sees only frozen CaseViews built fresh each morning and deep-frozen copies of the tables, calendar,
// configuration and check-ins (rule 1); the world keeps and reads its own copies. The world, never the
// policy's label, classifies every outcome. Every chance event comes from world.ts and resolve.ts through
// stateless keyed draws (rule 2).

import { isWorkingDay, workingDays } from "../data/calendar";
import { caseIdOf } from "../data/roster";
import { LEAK, u } from "./probe";
import { isSequential, onFailure, requiredRoles, stageIndex, transition } from "../domain/lifecycle";
import type {
  CaseView,
  CheckinAnswer,
  CourtCalendar,
  DayPlan,
  DisposalRoute,
  FailureReason,
  HearingLog,
  HearingType,
  ObservedHearing,
  Outcome,
  ParsedSummary,
  PlanContext,
  Role,
  RunResult,
  Scorecards,
} from "../domain/types";
import { scorecards } from "../eval/metrics";
import type { Simulate, SimulateOptions } from "./api";
import { checkinAnswers, drawAttendance, resolveHearing, type CallFlags } from "./resolve";
import {
  absconds,
  buildWorld,
  clearStale,
  isComplainantSide,
  issueRound,
  processFamily,
  knownOn,
  onEnterPurpose,
  processOut,
  processTarget,
  resolveParams,
  type Resolved,
  type WorldCase,
} from "./world";

const DEFAULT_CAPACITY = 420;

function deepFreeze<T>(o: T): T {
  if (o && typeof o === "object" && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o as object)) deepFreeze(v);
  }
  return o;
}

const readOnly = (what: string) => () => {
  throw new TypeError(`${what} handed to a planner is read-only`);
};

/** A copy of a set whose mutators throw (Object.freeze alone leaves a Set writable). */
function readOnlySet<T>(s: ReadonlySet<T>, what: string): Set<T> {
  const out = new Set(s);
  for (const m of ["add", "delete", "clear"]) Object.defineProperty(out, m, { value: readOnly(what) });
  return Object.freeze(out);
}

function readOnlyMap<K, V>(m: ReadonlyMap<K, V>, what: string): Map<K, V> {
  const out = new Map(m);
  for (const k of ["set", "delete", "clear"]) Object.defineProperty(out, k, { value: readOnly(what) });
  return Object.freeze(out);
}

function readOnlyCalendar(cal: CourtCalendar): CourtCalendar {
  return Object.freeze({
    ...cal,
    workingDays: readOnlySet(cal.workingDays, "the calendar"),
    holidays: readOnlyMap(cal.holidays, "the calendar"),
    judgeLeave: readOnlySet(cal.judgeLeave, "the calendar"),
  });
}

/** A zeroed scorecard of the right shape, for runs that skip scoring (calibration). */
export function emptyScorecards(): Scorecards {
  return {
    readme: { utilisation: 0, reachRate: 0, substantiveness: 0, backlog4yHeardShare: 0, backlog4ySubstantiveShare: 0, predictabilityGapDays: 0 },
    caseStudy: {
      utilisation: 0,
      overrunDays: 0,
      idleMinutesShare: 0,
      heldAsScheduled: 0,
      heldAsScheduledAllDue: 0,
      substantiveness: 0,
      ageBandsStart: {},
      ageBandsEnd: {},
      nextDateExcessDays: 0,
      wastedRelistShare: 0,
    },
    siddarth: { throughputPerMonth: 0, judgeTimeUsed: 0, wastedListings: 0, heldOnPromisedDate: 0, oldestPendingAgeYears: 0, p95PendingAgeYears: 0, neverHeard: 0, loadBalanceCv: 0 },
    extra: { listedPerDay: 0, reachedPerDay: 0, substantivePerDay: 0, disposed: 0, disposed4yPlus: 0, tripsPerSubstantive: 0, wastedTripShare: 0, deskPerDay: 0, vacatedPerDay: 0 },
  };
}

export const simulate: Simulate = (opts: SimulateOptions): RunResult => {
  const { records, policy, worldSeed: seed, start, end } = opts;
  const cap = opts.capacityMinutes ?? DEFAULT_CAPACITY;
  // The world's own copies (it reads nothing a planner holds) and the planner's deep-frozen ones, made once
  // per run so planners may cache by identity
  const worldRef = structuredClone(opts.ref);
  const cal: CourtCalendar = structuredClone(opts.calendar);
  const plannerRef = deepFreeze(structuredClone(opts.plannerRef ?? opts.ref));
  const plannerCal = readOnlyCalendar(opts.calendar);
  const plannerConfig = deepFreeze(structuredClone(opts.config));
  const R: Resolved = resolveParams(opts.params, records, opts.noBehaviour ?? false);
  LEAK.today = start;
  const ids = records.map(caseIdOf);
  const world = buildWorld(records, ids, seed, start, R, opts.rosterId);
  const byId = new Map<string, WorldCase>(world.map((w) => [w.id, w]));
  if (byId.size !== world.length) throw new Error("simulate: case ids in the roster are not unique");
  // the roster summary never changes, so one frozen copy per case serves every day's view
  const summaries = new Map<string, ParsedSummary>(world.map((w) => [w.id, deepFreeze(structuredClone(w.rec.summary))]));
  const days = workingDays(start, end, cal);
  if (days.length === 0) throw new Error(`simulate: no working days between ${start} and ${end}`);

  const lag = R.latent.returnReportDelayDays;
  const viewOf = (w: WorldCase, today: string): CaseView => {
    // only what the court knows is out; nothing issued before the horizon carries a date (the roster has none)
    const p = w.process?.courtKnows ? w.process : null;
    const e = w.external?.courtKnows ? w.external : null;
    return Object.freeze({
      id: w.id,
      filingNumber: w.rec.filingNumber,
      filingDate: w.rec.filingDate,
      advocateId: w.rec.advocateId,
      partyId: w.rec.partyId,
      stage: w.stage,
      nextPurpose: w.nextPurpose,
      hearingCounts: Object.freeze({ ...w.hearingCounts }),
      hearingsAtPurpose: w.hearingCounts[w.nextPurpose],
      lastSummary: summaries.get(w.id)!,
      history: Object.freeze(w.history.slice()),
      // the court knows what it issued; it learns of a return only the working day after
      process: p ? Object.freeze({ kind: p.kind, issuedOn: p.issuedOn < start ? null : p.issuedOn, returnedKnownOn: knownOn(p.returnDay, today, cal, lag), round: p.round }) : null,
      externalPending: e ? Object.freeze({ since: e.since < start ? null : e.since, readyKnownOn: knownOn(e.readyDay, today, cal) }) : null,
      nextDate: w.nextDate,
      firstScheduledOn: w.firstScheduledOn,
      firstHeardOn: w.firstHeardOn,
      disposed: w.disposed,
      disposedOn: w.disposedOn,
    });
  };
  const makeCtx = (date: string, checkins: ReadonlyMap<string, { complainant: CheckinAnswer; accused: CheckinAnswer }>): PlanContext =>
    Object.freeze({
      date,
      capacityMinutes: cap,
      cases: Object.freeze(world.map((w) => viewOf(w, date))),
      ref: plannerRef,
      calendar: plannerCal,
      // the planner's copy; the world scores the day from its own map
      checkins: readOnlyMap(checkins, "the check-in map"),
      config: plannerConfig,
    });

  /** The court's own record shows process or a report still out for this case (what a desk matter needs). */
  const deskPending = (w: WorldCase, date: string): boolean => {
    const v = viewOf(w, date);
    return (!!v.process && (v.process.returnedKnownOn === null || v.process.returnedKnownOn > date)) || (!!v.externalPending && (v.externalPending.readyKnownOn === null || v.externalPending.readyKnownOn > date));
  };
  /** A side the hearing needs answered "not ready" at a check-in the policy ran. */
  const releasedAtCheckin = (w: WorldCase, ans: { complainant: CheckinAnswer; accused: CheckinAnswer } | undefined): boolean => {
    if (!policy.asksCheckin || !ans) return false;
    const need = requiredRoles(w.nextPurpose);
    return (need.some(isComplainantSide) && ans.complainant === "not_ready") || (need.some((r) => !isComplainantSide(r)) && ans.accused === "not_ready");
  };

  const checkDate = (nd: unknown, date: string, what: string, caseId: string): string => {
    if (typeof nd !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(nd)) throw new Error(`${policy.id}: ${what} for ${caseId} on ${date} is not an ISO date (${String(nd)})`);
    if (nd <= date) throw new Error(`${policy.id}: ${what} for ${caseId} on ${date} is ${nd}, not after the hearing date`);
    if (!isWorkingDay(nd, cal)) throw new Error(`${policy.id}: ${what} for ${caseId} on ${date} is ${nd}, not a working day`);
    return nd;
  };

  // Initial dates: every pending case must get one, on a working day from the start
  LEAK.today = days[0]!;
  {
    const ctx0 = makeCtx(days[0]!, new Map());
    const init = policy.initialDates(ctx0);
    const missing: string[] = [];
    for (const w of world) {
      const d = init.get(w.id);
      if (d === undefined) {
        missing.push(w.id);
        continue;
      }
      if (d < days[0]! || !isWorkingDay(d, cal)) throw new Error(`${policy.id}: initial date ${d} for ${w.id} is not a working day on or after ${days[0]}`);
      w.nextDate = d;
      w.firstScheduledOn = d;
    }
    if (missing.length > 0) throw new Error(`${policy.id}: no initial date for ${missing.length} cases (first: ${missing.slice(0, 5).join(", ")})`);
  }

  const hearings: HearingLog[] = [];
  const dayRows: RunResult["days"] = [];

  const record = (
    w: WorldCase,
    date: string,
    type: HearingType,
    outcome: Outcome,
    reason: FailureReason | null,
    minutes: number,
    attendance: Record<Role, boolean> | null,
    listedOrder: number,
    standby: boolean,
    promised: string | null,
    disposed: boolean,
    extra: Partial<Pick<HearingLog, "disposalRoute" | "movedBy" | "startMinute" | "callTime">> & { loggedAttendance?: Record<Role, boolean> } = {},
  ): HearingLog => {
    const obs: ObservedHearing = Object.freeze({ date, type, outcome, reason, minutes, attendance: attendance ? Object.freeze({ ...attendance }) : null });
    w.history.push(obs);
    const { loggedAttendance, ...rest } = extra;
    const row: HearingLog = { ...obs, caseId: w.id, listedOrder, standby, promised, disposed, nextDate: null, ...rest };
    // the evaluation may see who waited for an unreached hearing; the court's record (the view) does not
    if (loggedAttendance) row.attendance = { ...loggedAttendance };
    hearings.push(row);
    return row;
  };

  // Ask the policy for the next date once the outcome is applied (the view shows the new purpose)
  const promise = (w: WorldCase, ctx: PlanContext, outcome: Outcome, date: string, row: HearingLog): void => {
    if (w.disposed) return;
    const nd = checkDate(policy.nextDate(ctx, viewOf(w, date), outcome, date), date, "next date", w.id);
    w.nextDate = nd;
    row.nextDate = nd;
  };

  const issue = (w: WorldCase, kind: NonNullable<ReturnType<typeof transition>["issues"]>, date: string): void => {
    issueRound(seed, w, kind, processTarget(w.stage, w.nextPurpose), date, R);
  };

  /**
   * A desk re-issue: a fresh service attempt (the next round, keyed on it) replaces the one still out. If the
   * old one has in fact come back and the court has not been told yet, the round is spent but the return
   * stands.
   */
  const reissue = (w: WorldCase, date: string): void => {
    const p = w.process;
    if (!p || !p.courtKnows) return;
    if (p.returnDay !== null && p.returnDay < date) {
      p.round = ++w.rounds[processFamily(p.kind)];
      return;
    }
    issueRound(seed, w, p.kind, p.forType, date, R);
  };

  const dispose = (w: WorldCase, date: string): void => {
    w.disposed = true;
    w.disposedOn = date;
    w.nextDate = null;
    w.process = null;
    w.external = null;
  };

  /** The complainant's attendance at the case's last called hearing (the roster's record before any). */
  const complainantAbsentLastTime = (w: WorldCase): boolean => {
    for (let i = w.history.length - 1; i >= 0; i--) {
      const h = w.history[i]!;
      if (h.attendance && (h.outcome === "substantive" || h.outcome === "failed")) return !h.attendance.complainant;
    }
    return w.rec.summary.attendance.complainant === false;
  };
  const APPEARANCE_IDX = stageIndex("APPEARANCE");
  const PLEA_IDX = stageIndex("PLEA");

  /** Disposal routes a failed hearing can open (DisposalParams): the route, or null. */
  const disposalOnFailure = (w: WorldCase, type: HearingType, date: string, reason: FailureReason, att: Record<Role, boolean>, complainantSide: boolean | undefined): DisposalRoute | null => {
    if (w.postJudgment) return null;
    const D = R.disposal;
    const tags = w.rec.summary.tags;
    // s.279 BNSS: the complainant, already warned, stays away again after the accused was summoned
    if ((reason === "petitioner_absent" || reason === "both_absent") && !att.complainant && stageIndex(w.stage) >= APPEARANCE_IDX) {
      const warned = tags.includes("complainant_repeatedly_absent") || w.lastChanceFor !== null;
      if (warned && complainantAbsentLastTime(w) && u(seed, "acquitdefault", w.key, date) < D.acquittalOnDefault) return "acquitted_default";
    }
    // steps ordered and not taken, and the complainant's side lets the hearing fail again before trial
    const complainantFault = reason === "petitioner_absent" || ((reason === "not_ready" || reason === "sought_time") && complainantSide === true);
    if (complainantFault && stageIndex(w.stage) <= PLEA_IDX && (tags.includes("steps_not_taken") || tags.includes("take_steps"))) {
      if (u(seed, "dismisssteps", w.key, date) < D.dismissalForSteps) return "dismissed_steps";
    }
    // an absconding accused (a present fact the police report, not the future return day): the warrant keeps
    // coming back unexecuted, and the case is split up to the long-pending register
    if (reason === "awaiting_process" && type === "WARRANT" && w.process && processFamily(w.process.kind) === "warrant" && absconds(seed, w.key, R) && w.hearingCounts.WARRANT >= D.lpAfterWarrantHearings) {
      if (u(seed, "lpsplit", w.key, date) < D.lpSplit) return "lp_split";
    }
    return null;
  };

  for (const date of days) {
    LEAK.today = date;
    const due = world.filter((w) => !w.disposed && w.nextDate !== null && w.nextDate <= date);
    const dueIds = new Set(due.map((w) => w.id));
    // the world's own check-in record; the planner gets a read-only copy
    const checkins = new Map<string, { complainant: CheckinAnswer; accused: CheckinAnswer }>();
    if (policy.asksCheckin) for (const w of due) checkins.set(w.id, Object.freeze(checkinAnswers(seed, w, w.nextPurpose, date, R)));
    const ctx = makeCtx(date, checkins);
    const plan = policy.plan(ctx);
    validatePlan(policy.id, date, plan, due, byId);

    const promisedOf = new Map<string, string | null>();
    for (const w of world) if (!w.disposed) promisedOf.set(w.id, w.nextDate);
    const closed = u(seed, "closure", date) < R.closureProb;
    let minutesUsed = 0;
    let reached = 0;
    let substantive = 0;
    let vacated = 0;
    let clock = 0;

    // Deferred: the policy's own promise stands. The world decides what it was: vacated only when the policy
    // ran a check-in and a side the hearing needs said "not ready"; otherwise a broken promise
    for (const d of plan.deferred) {
      const w = byId.get(d.caseId)!;
      const to = checkDate(d.to, date, "deferred date", w.id);
      const vac = !closed && releasedAtCheckin(w, checkins.get(w.id));
      if (vac) vacated++;
      const row = record(w, date, w.nextPurpose, closed ? "court_not_sitting" : vac ? "vacated" : "deferred", null, 0, null, -1, false, promisedOf.get(w.id) ?? null, false);
      w.nextDate = to;
      row.nextDate = to;
    }

    // Desk: a desk matter only when the court's own record shows process or a report still out; else deferred
    let deskCount = 0;
    for (const d of plan.desk) {
      const w = byId.get(d.caseId)!;
      const outcome: Outcome = closed ? "court_not_sitting" : deskPending(w, date) ? "desk" : "deferred";
      if (outcome === "desk") deskCount++;
      // a re-issue acts only on process the court's record shows still out
      if (outcome === "desk" && d.action === "reissue") {
        const vp = viewOf(w, date).process;
        if (vp && (vp.returnedKnownOn === null || vp.returnedKnownOn > date)) reissue(w, date);
      }
      const row = record(w, date, w.nextPurpose, outcome, null, 0, null, -1, false, promisedOf.get(w.id) ?? null, false);
      promise(w, ctx, row.outcome, date, row);
    }

    const main = plan.listings.filter((l) => !l.standby).sort((a, b) => a.order - b.order);
    const standby = plan.listings.filter((l) => l.standby).sort((a, b) => a.order - b.order);
    for (const l of [...main, ...standby]) {
      const w = byId.get(l.caseId)!;
      const promised = promisedOf.get(w.id) ?? null;
      const type = w.nextPurpose;
      if (closed) {
        const row = record(w, date, type, "court_not_sitting", null, 0, null, l.order, l.standby, promised, false);
        promise(w, ctx, "court_not_sitting", date, row);
        continue;
      }
      const flags: CallFlags = { slot: l.callTime !== null, reminder: policy.asksCheckin && dueIds.has(w.id), standby: l.standby };
      if (clock >= cap) {
        // the parties came and went home unheard: a wasted trip for each party who turned up
        const att = drawAttendance(seed, w, type, date, flags, R);
        if (att.complainant) w.wastedTrips.complainant++;
        if (att.accused) w.wastedTrips.accused++;
        const row = record(w, date, type, "not_reached", null, 0, null, l.order, l.standby, promised, false, { loggedAttendance: att, callTime: l.callTime });
        promise(w, ctx, "not_reached", date, row);
        continue;
      }
      const startMinute = clock;
      const res = resolveHearing(seed, w, type, date, flags, R, worldRef);
      clock += res.minutes;
      minutesUsed += res.minutes;
      reached++;
      w.hearingCounts[type]++;
      w.firstHeardOn ??= date;
      let disposed = false;
      let outcome: Outcome = res.outcome;
      let reason: FailureReason | null = res.reason;
      let route: DisposalRoute | undefined;
      let movedBy: FailureReason | undefined;
      if (res.compounded) {
        substantive++;
        w.substantiveCount++;
        disposed = true;
        route = "compounded";
        dispose(w, date);
      } else if (res.outcome === "substantive") {
        substantive++;
        const k = w.substantiveCount++;
        const draws = [0, 1, 2].map((i) => u(seed, w.key, "transition", k, i));
        const tr = transition({ stage: w.stage, nextPurpose: w.nextPurpose, postJudgment: w.postJudgment }, draws, R.branch, R.settleOnReport);
        if (tr.disposed) {
          disposed = true;
          route = tr.route ?? "verdict";
          dispose(w, date);
        } else {
          w.stage = tr.stage;
          w.nextPurpose = tr.nextPurpose;
          // what was needed for the purpose just heard has been used
          if (w.process && w.process.forType === type) w.process = null;
          if (w.external && w.external.forType === type) w.external = null;
          if (tr.issues) issue(w, tr.issues, date);
          clearStale(w);
          onEnterPurpose(seed, w, date, R);
        }
      } else {
        const why = res.reason!;
        // the court learns that process (or a report) it had no record of is out when a hearing fails for it
        if (why === "awaiting_process" && w.process) w.process.courtKnows = true;
        if (why === "external_dependency" && w.external) w.external.courtKnows = true;
        const r = disposalOnFailure(w, type, date, why, res.attendance, res.complainantSide);
        if (r) {
          // the failure ended the case: it moved on (to disposal), so the row counts as substantive
          disposed = true;
          route = r;
          dispose(w, date);
        } else {
          for (const role of ["complainant", "accused"] as const) if (res.attendance[role]) w.wastedTrips[role]++;
          const p = w.process;
          const known = p ? { kind: p.kind, status: processOut(w, date) ? ("issued" as const) : ("served" as const), issuedOn: p.issuedOn } : null;
          const of = onFailure({ stage: w.stage, nextPurpose: w.nextPurpose, postJudgment: w.postJudgment, process: known }, why, res.attendance, {
            uWarrant: u(seed, "warrantbranch", w.key, w.hearingCounts.APPEARANCE),
            pWarrant: R.branch.pWarrant,
          });
          const moved = of.nextPurpose !== w.nextPurpose;
          if (moved) {
            w.nextPurpose = of.nextPurpose;
            if (isSequential(of.nextPurpose)) w.stage = of.nextPurpose;
          }
          if (of.issues) issue(w, of.issues, date);
          if (moved) {
            clearStale(w);
            onEnterPurpose(seed, w, date, R);
          }
          if (moved) movedBy = why;
        }
        if (disposed || movedBy) {
          // PUCAR's definition: substantive = the hearing moved the case to its next purpose
          movedBy = why;
          outcome = "substantive";
          reason = null;
          substantive++;
          w.substantiveCount++;
        }
      }
      const row = record(w, date, type, outcome, reason, res.minutes, res.attendance, l.order, l.standby, promised, disposed, {
        disposalRoute: route,
        movedBy,
        startMinute,
        callTime: l.callTime,
      });
      if (row.disposalRoute === undefined) delete row.disposalRoute;
      if (row.movedBy === undefined) delete row.movedBy;
      promise(w, ctx, outcome, date, row);
    }

    if (closed) deskCount = 0;
    dayRows.push({ date, minutesUsed, listed: plan.listings.length, reached, substantive, desk: deskCount, vacated, overran: clock > cap });
  }

  const cards =
    opts.scorecards === false
      ? emptyScorecards()
      : scorecards({
          hearings,
          days: dayRows,
          records,
          start,
          end,
          capacityMinutes: cap,
          asOf: end,
          minGapDays: Object.fromEntries(Object.values(worldRef).map((r) => [r.type, r.gapDays])),
        });
  return { policyId: policy.id, worldSeed: seed, rosterId: opts.rosterId, scorecards: cards, hearings, days: dayRows };
};

/** Every due case exactly once in listings, desk or deferred; listings only for live cases at their purpose. */
function validatePlan(policyId: string, date: string, plan: DayPlan, due: readonly WorldCase[], byId: ReadonlyMap<string, WorldCase>): void {
  const where = new Map<string, string>();
  const place = (id: string, bucket: string) => {
    const w = byId.get(id);
    if (!w) throw new Error(`${policyId} on ${date}: ${bucket} names unknown case ${id}`);
    if (w.disposed) throw new Error(`${policyId} on ${date}: ${bucket} names ${id}, which is already disposed`);
    const prev = where.get(id);
    if (prev) throw new Error(`${policyId} on ${date}: case ${id} appears in both ${prev} and ${bucket}`);
    where.set(id, bucket);
    return w;
  };
  if (plan.date !== date) throw new Error(`${policyId}: plan for ${date} is dated ${plan.date}`);
  for (const l of plan.listings) {
    const w = place(l.caseId, "listings");
    if (l.type !== w.nextPurpose) throw new Error(`${policyId} on ${date}: ${l.caseId} listed for ${l.type}, but its next purpose is ${w.nextPurpose}`);
  }
  for (const d of plan.desk) place(d.caseId, "desk");
  for (const d of plan.deferred) place(d.caseId, "deferred");
  const missing = due.filter((w) => !where.has(w.id)).map((w) => w.id);
  if (missing.length > 0) {
    throw new Error(`${policyId} on ${date}: ${missing.length} due cases are neither listed, on the desk nor deferred (first: ${missing.slice(0, 5).join(", ")})`);
  }
}
