// The three scorecards (rule 3), computed from a run's hearing log and day totals only, so every policy is
// scored by the same code on the same evidence. Each field is defined as literally as its source allows;
// where a source is ambiguous the literal reading fills the field and the other reading goes into `extra`
// under a name that says what it is. SCORECARD_FIELDS carries the source text for every field, and the
// report prints it next to the numbers.

import { ageYears, daysBetween, toMinutes } from "../data/calendar";
import { caseIdOf } from "../data/roster";
import { isSequential, stageIndex } from "../domain/lifecycle";
import { SEQUENCE, type CaseRecord, type DisposalRoute, type FailureReason, type HearingLog, type HearingType, type Outcome, type RefTables, type RunResult, type Scorecards } from "../domain/types";
import { mean, percentile, sdPopulation } from "./stats";

// How a case left the file, one extra per route. The first five are disposals in the headline sense; a
// post-judgment matter closes a case already decided, and a long-pending split sends an absconding
// accused's case to the LP register, so both are reported separately. Typed on the contract's union, so a
// route added there without an entry here fails the type check.
const ROUTE_KEY: Record<DisposalRoute, string> = {
  verdict: "disposedVerdict",
  settlement: "disposedSettlement",
  compounded: "disposedCompounded",
  acquitted_default: "disposedAcquittedDefault",
  dismissed_steps: "disposedDismissedSteps",
  lp_split: "disposedLpSplit",
  post_judgment: "disposedPostJudgment",
};
export const DISPOSAL_ROUTES = Object.keys(ROUTE_KEY) as DisposalRoute[];
export const HEADLINE_ROUTES: ReadonlySet<DisposalRoute> = new Set(["verdict", "settlement", "compounded", "acquitted_default", "dismissed_steps"]);
const isRoute = (x: unknown): x is DisposalRoute => typeof x === "string" && (DISPOSAL_ROUTES as readonly string[]).includes(x);

// Bench clock, as the planners' benchClock counts it: 10:00 start, lunch 13:30 to 14:00 not counted.
// Parties with no call time are told to be there by 10:30.
const SITTING_START = toMinutes("10:00");
const LUNCH_START = toMinutes("13:30");
const LUNCH_MINUTES = 30;
const DEFAULT_ARRIVAL = "10:30";
/** "HH:MM" to bench minutes after the sitting starts (a time inside lunch counts as the lunch start). */
export function benchMinuteOf(hhmm: string): number {
  const t = toMinutes(hhmm);
  return Math.max(0, (t >= LUNCH_START + LUNCH_MINUTES ? t - LUNCH_MINUTES : Math.min(t, LUNCH_START)) - SITTING_START);
}

/** Mean of the n largest values (all of them when there are fewer); NaN for none. */
export function meanOfLargest(xs: readonly number[], n: number): number {
  return mean([...xs].sort((a, b) => b - a).slice(0, n));
}

export interface ScorecardInput {
  hearings: readonly HearingLog[];
  days: RunResult["days"];
  records: readonly CaseRecord[];
  /** horizon, inclusive: rates and counts only look at rows dated inside it */
  start: string;
  end: string;
  capacityMinutes: number;
  /** the date the end state is read on (pending cases, ages at end); the arena passes `end` */
  asOf: string;
  /** procedural minimum gap (calendar days) after a hearing of each type; the arena passes PUCAR's
   * reference gap. Without it the next-date excess is NaN rather than a guess. */
  minGapDays?: Partial<Record<HearingType, number>>;
  /** alternatively PUCAR's tables, from which the reference gaps are read when minGapDays is absent */
  ref?: RefTables;
}

// Called and taken up by the bench: the only rows that used hearing minutes.
const REACHED: ReadonlySet<Outcome> = new Set(["substantive", "failed"]);
// On the day's causelist. A closure day's listings count as listed and not reached; vacated matters were
// released the day before and desk matters never went to the bench, so neither is listed. On a closure
// day the simulator logs desk and deferred rows as court_not_sitting too, with listedOrder -1.
const isListed = (h: HearingLog): boolean =>
  h.outcome === "substantive" || h.outcome === "failed" || h.outcome === "not_reached" || (h.outcome === "court_not_sitting" && h.listedOrder >= 0);
// A next date the case was not ready for: its prerequisites (process, report, evidence) were not met.
const NOT_READY: ReadonlySet<FailureReason> = new Set(["awaiting_process", "external_dependency", "not_ready", "sought_time"]);
const ABSENCE: ReadonlySet<FailureReason> = new Set(["respondent_absent", "petitioner_absent", "both_absent"]);
// Trips cost when attendance was not recorded (listed, not called): all four parties and advocates came.
const UNRECORDED_TRIPS = 4;

// The 5+ band is also the cumulative 5+ line, so it appears once.
export const AGE_BANDS = ["0-1", "1-3", "3-4", "4-5", "5+", "3+", "4+"] as const;

/** Counts of cases per age band (years since filing), plus the cumulative 3+ and 4+ lines (5+ is a band). */
export function ageBands(ages: readonly number[]): Record<string, number> {
  const out: Record<string, number> = Object.fromEntries(AGE_BANDS.map((b) => [b, 0]));
  const bump = (k: string) => (out[k] = (out[k] ?? 0) + 1);
  for (const a of ages) {
    bump(a < 1 ? "0-1" : a < 3 ? "1-3" : a < 4 ? "3-4" : a < 5 ? "4-5" : "5+");
    if (a >= 3) bump("3+");
    if (a >= 4) bump("4+");
  }
  return out;
}

const ratio = (a: number, b: number): number => (b > 0 ? a / b : NaN);

export interface Disposals {
  /** case id to the date it left the file (any route) */
  on: Map<string, string>;
  /** true when the log carried no disposal flags and disposing rows were inferred */
  inferred: boolean;
  /** case id to its route */
  route: Map<string, DisposalRoute>;
  /** cases whose route the log did not carry, classified by inference */
  routeInferred: Set<string>;
}

/**
 * Which row disposed of each case, on what date and by which route. The simulator marks the row
 * (`disposed: true`) and its route; for a log written without the flag the fallback is what the log itself
 * shows: a substantive JUDGEMENT, or a substantive hearing of a case whose roster summary records the
 * judgment already pronounced. A disposing row without a route is classified as a post-judgment closure
 * for a case already decided, a settlement on a REPORTS hearing, and a verdict otherwise, and is flagged.
 */
export function disposals(hearings: readonly HearingLog[], records: readonly CaseRecord[]): Disposals {
  const flagged = hearings.some((h) => h.disposed !== undefined);
  const postJudgment = new Set(records.filter((r) => r.summary.judgmentPronounced !== null).map(caseIdOf));
  const on = new Map<string, string>();
  const route = new Map<string, DisposalRoute>();
  const routeInferred = new Set<string>();
  for (const h of hearings) {
    const disposes = flagged
      ? h.disposed === true
      : h.outcome === "substantive" && (h.type === "JUDGEMENT" || postJudgment.has(h.caseId));
    if (!disposes) continue;
    const prev = on.get(h.caseId);
    if (prev !== undefined && h.date >= prev) continue;
    on.set(h.caseId, h.date);
    if (isRoute(h.disposalRoute)) {
      route.set(h.caseId, h.disposalRoute);
      routeInferred.delete(h.caseId);
    } else {
      route.set(h.caseId, postJudgment.has(h.caseId) ? "post_judgment" : h.type === "REPORTS" ? "settlement" : "verdict");
      routeInferred.add(h.caseId);
    }
  }
  return { on, inferred: !flagged, route, routeInferred };
}

// The purpose a next date was given for, when the log does not show the case's next row (the date fell
// beyond the horizon): the same purpose after a failed hearing, the next compulsory stage after a
// substantive sequential one (delay condonation and warrant are optional and skipped), and the heard type
// after an interrupting one (its underlying stage is not in the row).
function inferredNextPurpose(h: HearingLog): HearingType {
  if (h.outcome !== "substantive" || !isSequential(h.type)) return h.type;
  let i = stageIndex(h.type) + 1;
  while (SEQUENCE[i] === "DELAY_CONDONATION_HEARING" || SEQUENCE[i] === "WARRANT") i++;
  return SEQUENCE[i] ?? h.type;
}

export function scorecards(input: ScorecardInput): Scorecards {
  const { start, end, asOf, capacityMinutes: cap } = input;
  const inHorizon = (d: string) => d >= start && d <= end;
  const rows = input.hearings.filter((h) => inHorizon(h.date));

  // Sitting days: working days in the horizon on which the court sat. A day whose listings were all
  // logged as court_not_sitting offered no minutes, so it is not available time.
  const closed = new Set(rows.filter((h) => h.outcome === "court_not_sitting").map((h) => h.date));
  const days = input.days.filter((d) => inHorizon(d.date) && !closed.has(d.date));
  const available = cap * days.length;

  const count = (pred: (h: HearingLog) => boolean) => rows.reduce((n, h) => n + (pred(h) ? 1 : 0), 0);
  const is = (o: Outcome) => (h: HearingLog) => h.outcome === o;
  const substantive = count(is("substantive"));
  const failed = count(is("failed"));
  const notReached = count(is("not_reached"));
  const notSitting = count((h) => h.outcome === "court_not_sitting" && h.listedOrder >= 0);
  const dueOnClosure = count((h) => h.outcome === "court_not_sitting" && h.listedOrder < 0);
  const vacated = count(is("vacated"));
  const desk = count(is("desk"));
  const deferred = count(is("deferred"));
  const reached = substantive + failed;
  const listed = substantive + failed + notReached + notSitting;
  const standbyUncalled = count((h) => h.standby && h.outcome === "not_reached");

  // Minutes on reached hearings, per day.
  const reachedMinutes = new Map<string, number>();
  let reachedMinutesTotal = 0;
  for (const h of rows) {
    if (!REACHED.has(h.outcome)) continue;
    reachedMinutes.set(h.date, (reachedMinutes.get(h.date) ?? 0) + h.minutes);
    reachedMinutesTotal += h.minutes;
  }
  let cappedMinutes = 0;
  let idleMinutes = 0;
  let overrunMinutes = 0;
  let usedMinutes = 0;
  let overrunDays = 0;
  for (const d of days) {
    cappedMinutes += Math.min(cap, reachedMinutes.get(d.date) ?? 0);
    idleMinutes += Math.max(0, cap - d.minutesUsed);
    overrunMinutes += Math.max(0, d.minutesUsed - cap);
    usedMinutes += d.minutesUsed;
    if (d.overran || d.minutesUsed > cap + 1e-9) overrunDays++;
  }

  // Per case: first scheduled (first row of any kind: its date came up), first heard (first reached row).
  const byCase = new Map<string, HearingLog[]>();
  for (const h of rows) {
    const list = byCase.get(h.caseId);
    if (list) list.push(h);
    else byCase.set(h.caseId, [h]);
  }
  for (const list of byCase.values()) list.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.listedOrder - b.listedOrder));
  const heard = new Set<string>();
  const heardSubstantively = new Set<string>();
  const actedOn = new Set<string>();
  const firstHeardOn = new Map<string, string>();
  const gaps: number[] = [];
  const gapsCensored: number[] = [];
  // Per case, the first row in the horizon when it was due on its promise: was that first promise kept?
  let firstPromiseDue = 0;
  let firstPromiseKept = 0;
  for (const [id, list] of byCase) {
    const first = list[0];
    if (!first) continue;
    const firstHeard = list.find((h) => REACHED.has(h.outcome));
    if (firstHeard) {
      heard.add(id);
      actedOn.add(id);
      firstHeardOn.set(id, firstHeard.date);
      gaps.push(daysBetween(first.date, firstHeard.date));
    }
    gapsCensored.push(daysBetween(first.date, firstHeard ? firstHeard.date : end));
    if (list.some((h) => h.outcome === "substantive")) heardSubstantively.add(id);
    if (list.some((h) => h.outcome === "desk")) actedOn.add(id);
    if (first.promised === first.date) {
      firstPromiseDue++;
      if (REACHED.has(first.outcome)) firstPromiseKept++;
    }
  }
  // Every roster case from the horizon start to its first reached hearing, or to the end when never heard.
  const gapsFromStart = input.records.map((r) => daysBetween(start, firstHeardOn.get(caseIdOf(r)) ?? end));

  // Ages and disposals. The headline counts decisions on the merits and their equivalents (verdict,
  // settlement, compounding, default acquittal, dismissal for steps not taken); a post-judgment closure or
  // a long-pending split also takes the case off the file, so it is not pending, but it is counted apart.
  const disp = disposals(input.hearings, input.records);
  const disposedOn = disp.on;
  const ageAtStart = new Map(input.records.map((r) => [caseIdOf(r), ageYears(r.filingDate, start)]));
  const old = input.records.filter((r) => (ageAtStart.get(caseIdOf(r)) ?? 0) >= 4).map(caseIdOf);
  const disposedAll = [...disposedOn].filter(([, d]) => inHorizon(d)).map(([id]) => id);
  const disposedInHorizon = disposedAll.filter((id) => HEADLINE_ROUTES.has(disp.route.get(id) ?? "verdict"));
  const byRoute = Object.fromEntries(DISPOSAL_ROUTES.map((r) => [ROUTE_KEY[r], 0])) as Record<string, number>;
  for (const id of disposedAll) {
    const k = ROUTE_KEY[disp.route.get(id) ?? "verdict"];
    byRoute[k] = (byRoute[k] ?? 0) + 1;
  }
  const pendingAtEnd = input.records.filter((r) => {
    const d = disposedOn.get(caseIdOf(r));
    return d === undefined || d > asOf;
  });
  const pendingAges = pendingAtEnd.map((r) => ageYears(r.filingDate, asOf));

  // Promises: a row is held as scheduled when reached on the date it was listed for (its promised date;
  // a row with no promise was listed for its own date).
  const onListed = (h: HearingLog) => (h.promised ?? h.date) === h.date;
  const heldOnListed = count((h) => REACHED.has(h.outcome) && onListed(h));
  const heldSubstantiveOnListed = count((h) => h.outcome === "substantive" && onListed(h));
  const heldOnPromised = count((h) => REACHED.has(h.outcome) && h.promised === h.date);
  const promisedRows = count((h) => h.promised !== null);
  // the magistrate's reading: a date is honoured when the court passes an order on it, heard in court or at the
  // desk (the world records a desk row only when the court's record shows process or a report still out)
  const honouredOnPromised = count((h) => (REACHED.has(h.outcome) || h.outcome === "desk") && h.promised === h.date);
  const allDue = listed + deferred + vacated + desk + dueOnClosure;

  // Next dates given at the end of a reached hearing that did not dispose of the case, scored two ways
  // against PUCAR's gap: for the purpose just heard, and for the purpose the next date was given for
  // (PUCAR's column is "time to next hearing given this is the purpose").
  const gapFor = (t: HearingType): number | undefined => (input.minGapDays ? input.minGapDays[t] : input.ref?.[t]?.gapDays);
  const excess: number[] = [];
  const excessNextPurpose: number[] = [];
  const nextGaps: number[] = [];
  let short = 0;
  let beyond = 0;
  let nextPurposeInferred = 0;
  for (const list of byCase.values()) {
    list.forEach((h, i) => {
      if (!REACHED.has(h.outcome) || h.disposed === true || disposedOn.get(h.caseId) === h.date) return;
      const later = list.slice(i + 1).find((x) => x.date > h.date);
      const next = h.nextDate ?? (later ? (later.promised ?? later.date) : null);
      if (next === null) return;
      const gap = daysBetween(h.date, next);
      nextGaps.push(gap);
      if (next > end) beyond++;
      const min = gapFor(h.type);
      if (min !== undefined) {
        excess.push(Math.max(0, gap - min));
        if (gap < min) short++;
      }
      const nextMin = gapFor(later ? later.type : inferredNextPurpose(h));
      if (nextMin !== undefined) {
        excessNextPurpose.push(Math.max(0, gap - nextMin));
        if (!later) nextPurposeInferred++;
      }
    });
  }

  // Relisted dates (every row after a case's first one in the horizon) on which readiness was revealed.
  // A desk row straight after another desk row is the registry re-checking a return with nobody called,
  // so the headline leaves it out; the old reading keeps it.
  let relists = 0;
  let relistNotReady = 0;
  let relistNotReadyOrAbsent = 0;
  let deskRechecks = 0;
  for (const list of byCase.values()) {
    list.forEach((h, i) => {
      if (i === 0) return;
      if (!(h.outcome === "substantive" || h.outcome === "failed" || h.outcome === "desk" || h.outcome === "vacated")) return;
      const notReady = h.outcome === "desk" || h.outcome === "vacated" || (h.outcome === "failed" && h.reason !== null && NOT_READY.has(h.reason));
      if (h.outcome === "desk" && list[i - 1]?.outcome === "desk") {
        deskRechecks++;
        return;
      }
      const absent = h.outcome === "failed" && h.reason !== null && ABSENCE.has(h.reason);
      relists++;
      if (notReady) relistNotReady++;
      if (notReady || absent) relistNotReadyOrAbsent++;
    });
  }

  // Trips: each party or advocate who came for a listed matter.
  let trips = 0;
  let wastedTrips = 0;
  for (const h of rows) {
    if (!isListed(h)) continue;
    const t = h.attendance ? Object.values(h.attendance).filter(Boolean).length : UNRECORDED_TRIPS;
    trips += t;
    if (h.outcome !== "substantive") wastedTrips += t;
  }

  // Minutes waited at court by each person present, from the call time given (10:30 when none) to the
  // bench minute the hearing started. Only a log that records start minutes can say; otherwise NaN. The
  // wider reading adds people at matters not reached, who waited until the court rose (the day's reached
  // minutes, or capacity if more).
  const hasStart = rows.some((h) => REACHED.has(h.outcome) && typeof h.startMinute === "number");
  let waitedHeard = 0;
  let peopleHeard = 0;
  let waitedUnheard = 0;
  let peopleUnheard = 0;
  if (hasStart) {
    for (const h of rows) {
      if (!h.attendance) continue;
      const people = Object.values(h.attendance).filter(Boolean).length;
      if (people === 0) continue;
      const arrival = benchMinuteOf(h.callTime ?? DEFAULT_ARRIVAL);
      if (REACHED.has(h.outcome) && typeof h.startMinute === "number") {
        waitedHeard += Math.max(0, h.startMinute - arrival) * people;
        peopleHeard += people;
      } else if (h.outcome === "not_reached") {
        const rose = Math.max(cap, reachedMinutes.get(h.date) ?? 0);
        waitedUnheard += Math.max(0, rose - arrival) * people;
        peopleUnheard += people;
      }
    }
  }

  const months = (daysBetween(start, end) + 1) / (365.25 / 12);
  const dailyUsed = days.map((d) => d.minutesUsed);
  const perDay = (n: number) => ratio(n, days.length);

  return {
    readme: {
      utilisation: ratio(reachedMinutesTotal, available),
      reachRate: ratio(reached, listed),
      substantiveness: ratio(substantive, reached),
      backlog4yHeardShare: ratio(old.filter((id) => heard.has(id)).length, old.length),
      backlog4ySubstantiveShare: ratio(old.filter((id) => heardSubstantively.has(id)).length, old.length),
      predictabilityGapDays: mean(gaps),
    },
    caseStudy: {
      utilisation: ratio(cappedMinutes, available),
      overrunDays,
      idleMinutesShare: ratio(idleMinutes, available),
      heldAsScheduled: ratio(heldOnListed, listed + deferred),
      heldAsScheduledAllDue: ratio(heldOnListed, allDue),
      substantiveness: ratio(substantive, reached),
      ageBandsStart: ageBands([...ageAtStart.values()]),
      ageBandsEnd: ageBands(pendingAges),
      nextDateExcessDays: mean(excess),
      wastedRelistShare: ratio(relistNotReady, relists),
    },
    siddarth: {
      throughputPerMonth: disposedInHorizon.length / months,
      judgeTimeUsed: ratio(usedMinutes, available),
      wastedListings: ratio(notReached + notSitting + failed, listed),
      heldOnPromisedDate: ratio(heldOnPromised, promisedRows),
      oldestPendingAgeYears: pendingAges.length ? Math.max(...pendingAges) : NaN,
      p95PendingAgeYears: percentile(pendingAges, 95),
      neverHeard: input.records.length - input.records.filter((r) => heard.has(caseIdOf(r))).length,
      loadBalanceCv: ratio(sdPopulation(dailyUsed), mean(dailyUsed)),
    },
    extra: {
      listedPerDay: perDay(listed),
      reachedPerDay: perDay(reached),
      substantivePerDay: perDay(substantive),
      disposed: disposedInHorizon.length,
      disposed4yPlus: disposedInHorizon.filter((id) => (ageAtStart.get(id) ?? 0) >= 4).length,
      tripsPerSubstantive: ratio(trips, substantive),
      wastedTripShare: ratio(wastedTrips, trips),
      deskPerDay: perDay(desk),
      vacatedPerDay: perDay(vacated),
      deferredPerDay: perDay(deferred),
      sittingDays: days.length,
      overrunMinutes,
      reachRateExclStandby: ratio(reached, listed - standbyUncalled),
      reachRateSittingDays: ratio(reached, listed - notSitting),
      predictabilityGapDaysCensored: mean(gapsCensored),
      casesScheduled: byCase.size,
      promisesHonouredInclDesk: ratio(honouredOnPromised, promisedRows),
      promisesBroken: promisedRows - honouredOnPromised + (input.records.length - byCase.size),
      heldOnPromisedShareOfHeard: ratio(heldOnPromised, reached),
      nextDateGapDays: mean(nextGaps),
      nextDateShortShare: excess.length ? short / excess.length : NaN,
      wastedRelistShareInclAbsence: ratio(relistNotReadyOrAbsent, relists),
      wastedRelistShareInclDeskRechecks: ratio(relistNotReady + deskRechecks, relists + deskRechecks),
      neverHeard4yPlus: old.filter((id) => !heard.has(id)).length,
      pending4yPlusEnd: pendingAges.filter((a) => a >= 4).length,
      disposalsInferred: disp.inferred ? 1 : 0,
      heldSubstantiveAllDue: ratio(heldSubstantiveOnListed, allDue),
      firstPromiseKept: ratio(firstPromiseKept, firstPromiseDue),
      nextDateExcessNextPurposeDays: mean(excessNextPurpose),
      nextDateNextPurposeInferredShare: excessNextPurpose.length ? nextPurposeInferred / excessNextPurpose.length : NaN,
      nextDatesBeyondHorizonShare: nextGaps.length ? beyond / nextGaps.length : NaN,
      predictabilityGapFromStartDays: mean(gapsFromStart),
      minutesWaited: ratio(waitedHeard, peopleHeard),
      minutesWaitedInclNotReached: ratio(waitedHeard + waitedUnheard, peopleHeard + peopleUnheard),
      oldest100PendingMeanAgeYears: meanOfLargest(pendingAges, 100),
      backlog4yActedOnShare: ratio(old.filter((id) => actedOn.has(id)).length, old.length),
      // Siddarth's "who is never heard?": a desk action (process re-issued, nobody travels) counts as the court acting on the case
      neverActedOn: input.records.filter((r) => !actedOn.has(caseIdOf(r))).length,
      ...byRoute,
      disposedAllRoutes: disposedAll.length,
      disposedRouteInferred: disposedAll.filter((id) => disp.routeInferred.has(id)).length,
      throughputPerMonthAllRoutes: disposedAll.length / months,
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Field catalogue: label, unit, which direction is better, and the definition with its source. The report
// renders every scorecard from this list, so a field missing here would be a field silently not reported;
// a test checks the catalogue against a computed scorecard.

export type Unit = "share" | "days" | "years" | "count" | "perDay" | "perMonth" | "ratio" | "minutes" | "trips";
export type Family = keyof Scorecards;
export interface FieldMeta {
  family: Family;
  key: string;
  label: string;
  unit: Unit;
  better: "higher" | "lower" | null;
  /** the source's own words, then how it is computed here */
  source: string;
}

const README = 'Repo README, "What you\'re scored on"';
const CASE = "Case study, section 6";
const SID = "Siddarth's slide 06";

const f = (family: Family, key: string, label: string, unit: Unit, better: FieldMeta["better"], source: string): FieldMeta => ({ family, key, label, unit, better, source });

const bandFields = (key: "ageBandsStart" | "ageBandsEnd", when: string): FieldMeta[] =>
  AGE_BANDS.map((b) =>
    f("caseStudy", `${key}.${b}`, `Cases aged ${b} years at ${when}`, "count", key === "ageBandsEnd" && b.endsWith("+") ? "lower" : null,
      `${CASE}: "does it reduce the number of cases sitting in the 5+ year buckets?" Pending cases by age band (365.25-day years since filing) at ${when}.`),
  );

export const SCORECARD_FIELDS: readonly FieldMeta[] = [
  f("readme", "utilisation", "Utilisation", "share", "higher",
    `${README}: "% of available court minutes actually spent on hearings that were reached". Minutes of substantive and failed hearings / (capacity x sitting days); not capped, so an overrun day can push it past 100%.`),
  f("readme", "reachRate", "Reach rate", "share", "higher",
    `${README}: "% of what you scheduled the court actually gets to before time runs out". Reached / listed, listed = substantive + failed + not reached + court not sitting (vacated and desk matters were never on the day's list).`),
  f("readme", "substantiveness", "Substantiveness", "share", "higher",
    `${README}: "% of reached hearings that move the case forward". Substantive / reached.`),
  f("readme", "backlog4yHeardShare", "4y+ cases heard at all", "share", "higher",
    `${README}: "% of the oldest cases (4+ years) that get heard at all". Cases aged 4+ years at the start with at least one reached hearing / all cases aged 4+ at the start.`),
  f("readme", "backlog4ySubstantiveShare", "4y+ cases heard substantively", "share", "higher",
    `DESIGN.md companion to the README backlog measure: cases aged 4+ at the start with at least one substantive hearing / all such cases.`),
  f("readme", "predictabilityGapDays", "Gap from first scheduled to first heard", "days", "lower",
    `${README}: "avg. gap, in days, between a case's first scheduled date and when it's actually heard". Mean over heard cases of (first reached date - first date the case came up in the horizon); never-heard cases are excluded here and counted in extra.predictabilityGapDaysCensored.`),

  f("caseStudy", "utilisation", "Utilisation within capacity", "share", "higher",
    `${CASE}: "Is the judge's day well packed, without being overbooked or leaving significant capacity unused?" Sum over sitting days of min(capacity, reached minutes) / (capacity x sitting days).`),
  f("caseStudy", "overrunDays", "Days that overran", "count", "lower",
    `${CASE}: "without being overbooked". Sitting days whose used minutes exceeded capacity (or that the simulator marked as overrun).`),
  f("caseStudy", "idleMinutesShare", "Idle capacity", "share", "lower",
    `${CASE}: "leaving significant capacity unused". Sum over sitting days of max(0, capacity - minutes used) / (capacity x sitting days).`),
  f("caseStudy", "heldAsScheduled", "Held as scheduled (as listed)", "share", "higher",
    `${CASE}: "Are cases actually heard when they are listed?" Rows reached on the date they were listed for (promised date, or the listing date when no promise) / (listed + deferred). Always shown next to the all-due and substantive readings.`),
  f("caseStudy", "heldAsScheduledAllDue", "Held as scheduled (all due)", "share", "higher",
    `${CASE}, reported both ways per DESIGN.md: same numerator / every row that fell due (listed + deferred + vacated + desk + due on a closure day), so matters kept off the bench count against the schedule.`),
  f("caseStudy", "substantiveness", "Substantiveness", "share", "higher",
    `${CASE}: "If a case is heard, does it meaningfully advance towards judgment or resolution?" Substantive / reached.`),
  ...bandFields("ageBandsStart", "the start"),
  ...bandFields("ageBandsEnd", "the end"),
  f("caseStudy", "nextDateExcessDays", "Next date excess over the minimum", "days", "lower",
    `${CASE}: "does the system recommend a sensible and efficient next date?"; ask 5: "Match the gap to the actual procedural minimum". Mean over reached, non-disposing hearings of max(0, days to the next date - PUCAR's reference gap for that hearing type).`),
  f("caseStudy", "wastedRelistShare", "Next dates the case was not ready for", "share", "lower",
    `DESIGN.md reading of ${CASE} next-date quality: "next dates on which the case was not ready". Among relisted dates that revealed readiness (substantive, failed, desk, vacated), the share handled at the desk, vacated, or failed for awaiting process, external dependency, not ready or sought time. A desk row whose previous row for the case was also a desk row is left out: the registry re-checking a return, with nobody called (extra.wastedRelistShareInclDeskRechecks keeps it).`),

  f("siddarth", "throughputPerMonth", "Throughput (disposals per month)", "perMonth", "higher",
    `${SID}: "Throughput = cases disposed per month". Headline disposals in the horizon (verdict, settlement, compounding, acquittal for the complainant's default, dismissal for steps not taken) / horizon length in months (calendar days / 30.44). Post-judgment closures and long-pending splits are in extra.throughputPerMonthAllRoutes.`),
  f("siddarth", "judgeTimeUsed", "Judge time used", "share", "higher",
    `${SID}: "Judge time used = minutes used / minutes available". Sum of the day's minutes used / (capacity x sitting days).`),
  f("siddarth", "wastedListings", "Wasted listings", "share", "lower",
    `${SID}: "Wasted listings = (not reached + adjourned) / listed". (Not reached + court not sitting + failed) / listed.`),
  f("siddarth", "heldOnPromisedDate", "Held on the promised date", "share", "higher",
    `${SID}: "Predictability = hearings held on the promised date". Rows reached on their promised date / rows that carried a promised date (every promise that fell due, however it ended).`),
  f("siddarth", "oldestPendingAgeYears", "Oldest pending case", "years", "lower",
    `${SID}: "Fairness = age of the oldest pending cases". Maximum age at the end among cases still pending.`),
  f("siddarth", "p95PendingAgeYears", "95th percentile pending age", "years", "lower",
    `${SID} fairness, DESIGN.md: p95 of age at the end among pending cases.`),
  f("siddarth", "neverHeard", "Cases never heard", "count", "lower",
    `${SID} fairness, DESIGN.md: "cases never heard". Roster cases with no reached hearing in the horizon.`),
  f("siddarth", "loadBalanceCv", "Load balance (CV of daily minutes)", "ratio", "lower",
    `${SID}: "Load balance = spread of minutes across judges"; with one judge, the coefficient of variation (population sd / mean) of minutes used per sitting day.`),

  f("extra", "listedPerDay", "Listed per sitting day", "perDay", null, "DESIGN.md extra: listings per day."),
  f("extra", "reachedPerDay", "Reached per sitting day", "perDay", "higher", "Substantive + failed per sitting day."),
  f("extra", "substantivePerDay", "Substantive per sitting day", "perDay", "higher", "Substantive hearings per sitting day."),
  f("extra", "disposed", "Disposals (headline)", "count", "higher",
    "DESIGN.md extra: cases disposed in the horizon by verdict, settlement, compounding, acquittal for the complainant's default, or dismissal for steps not taken. Post-judgment closures and long-pending splits are counted apart, below."),
  f("extra", "disposed4yPlus", "Disposals of 4y+ cases (headline)", "count", "higher", "DESIGN.md extra: headline disposals of cases aged 4+ at the start."),
  f("extra", "tripsPerSubstantive", "Trips per substantive hearing", "trips", "lower",
    "DESIGN.md extra, case study ask 1 (minimise trips): parties and advocates who came to listed matters (recorded attendance; all four when not called) / substantive hearings."),
  f("extra", "wastedTripShare", "Wasted trips", "share", "lower", "Trips to listed matters that were not substantive / all trips."),
  f("extra", "deskPerDay", "Desk matters per sitting day", "perDay", null, "Rows handled at the process desk per sitting day."),
  f("extra", "vacatedPerDay", "Vacated per sitting day", "perDay", null, "Rows vacated at the day-before check-in per sitting day."),
  f("extra", "deferredPerDay", "Deferred per sitting day", "perDay", "lower", "Due matters the policy neither listed nor sent to the desk (broken promises) per sitting day."),
  f("extra", "sittingDays", "Sitting days", "count", null, "Working days in the horizon on which the court sat."),
  f("extra", "overrunMinutes", "Minutes past capacity", "minutes", "lower", "Sum over sitting days of max(0, minutes used - capacity)."),
  f("extra", "reachRateExclStandby", "Reach rate excluding uncalled standby", "share", "higher", "Alternative reading of the README reach rate: uncalled standby matters removed from the denominator."),
  f("extra", "reachRateSittingDays", "Reach rate on sitting days", "share", "higher", "Alternative reading of the README reach rate: listings on closure days removed from the denominator."),
  f("extra", "predictabilityGapDaysCensored", "Gap to first heard, never heard at the end", "days", "lower",
    "Alternative reading of the README predictability: cases scheduled but never heard count with their gap to the horizon end."),
  f("extra", "casesScheduled", "Cases whose date came up", "count", null, "Distinct cases with any row in the horizon."),
  f("extra", "promisesHonouredInclDesk", "Dates honoured (court or desk order)", "share", "higher",
    `${SID} predictability, read as a magistrate reads it: rows reached on their promised date, or taken up at the desk that day with process or a report still out ("process not returned, issue fresh, call on X" honours the date), / rows that carried a promised date.`),
  f("extra", "promisesBroken", "Dates broken or never given", "count", "lower",
    "Promised dates on which the court passed no order (not reached, deferred, vacated, court not sitting), plus cases given no date inside the horizon at all, so parking a case past the horizon counts against the policy."),
  f("extra", "heldOnPromisedShareOfHeard", "Heard rows that were on the promised date", "share", "higher",
    "Alternative reading of Siddarth's predictability: rows reached on their promised date / all reached rows."),
  f("extra", "nextDateGapDays", "Mean next date gap", "days", null, "Mean calendar days from a reached, non-disposing hearing to the next date given."),
  f("extra", "nextDateShortShare", "Next dates inside the minimum", "share", null, "Share of next dates given sooner than PUCAR's reference gap for the hearing type."),
  f("extra", "wastedRelistShareInclAbsence", "Next dates wasted, counting absences", "share", "lower",
    "Alternative reading of wastedRelistShare that also counts failures for a party's absence (desk re-checks left out, as in the headline)."),
  f("extra", "wastedRelistShareInclDeskRechecks", "Next dates not ready, counting desk re-checks", "share", "lower",
    "The earlier reading of wastedRelistShare: every desk row after a case's first row counts as a wasted relist, including a desk row straight after another desk row."),
  f("extra", "neverHeard4yPlus", "4y+ cases never heard", "count", "lower", "Cases aged 4+ at the start with no reached hearing."),
  f("extra", "pending4yPlusEnd", "Pending 4y+ cases at the end", "count", "lower", "Pending cases aged 4+ at the end (same as ageBandsEnd 4+)."),
  f("extra", "disposalsInferred", "Disposals inferred from the log", "share", null,
    "1 when the simulator did not mark disposing rows and disposals were inferred (substantive JUDGEMENT, or a substantive hearing of a post-judgment case); settlements are then missed. Averaged across runs, the share of runs inferred."),
  f("extra", "heldSubstantiveAllDue", "Substantive on the promised date (all due)", "share", "higher",
    `The substantive reading of ${CASE} "Are cases actually heard when they are listed?": substantive rows on the date they were listed for / every row that fell due (the all-due denominator). A hearing that is called and adjourned does not count as held.`),
  f("extra", "firstPromiseKept", "First promise kept, per case", "share", "higher",
    `Per-case reading of ${SID} predictability: among cases whose first row in the horizon fell on its promised date, the share reached that day.`),
  f("extra", "nextDateExcessNextPurposeDays", "Next date excess over the gap for the next purpose", "days", "lower",
    `The case study's reading of ask 5: PUCAR's gap is "time to next hearing given this is the purpose", so the next date is scored against the gap for the purpose it was given for. Mean of max(0, days to the next date - that gap); the purpose is the case's next row, or when that falls beyond the horizon, the same purpose after a failed hearing and the next compulsory stage after a substantive one.`),
  f("extra", "nextDateNextPurposeInferredShare", "Next purposes inferred", "share", null,
    "Share of next dates in nextDateExcessNextPurposeDays whose purpose was inferred because the case's next row fell beyond the horizon."),
  f("extra", "nextDatesBeyondHorizonShare", "Next dates beyond the horizon end", "share", null,
    "Share of next dates given after reached, non-disposing hearings that fall after the horizon end; those hearings are not seen again inside the run."),
  f("extra", "predictabilityGapFromStartDays", "Gap from the horizon start to first heard, all cases", "days", "lower",
    "Alternative reading of the README predictability: every roster case, from the horizon start to its first reached hearing, or to the horizon end when never heard."),
  f("extra", "minutesWaited", "Minutes waited per person heard", "minutes", "lower",
    "Case study ask 1 (a court day that does not waste people's time): for each party or advocate present at a reached hearing, bench minutes from the call time given (10:30 when none) to the minute the hearing started. Needs start minutes in the log; n/a otherwise."),
  f("extra", "minutesWaitedInclNotReached", "Minutes waited, counting matters not reached", "minutes", "lower",
    "As minutesWaited, also counting people present at matters not reached, who waited until the court rose (the day's reached minutes, or capacity if more)."),
  f("extra", "oldest100PendingMeanAgeYears", "Mean age of the 100 oldest pending cases", "years", "lower",
    `${SID} fairness, "age of the oldest pending cases", read over the oldest hundred: the single oldest age barely moves between policies over a short horizon. Mean age at the end of the 100 oldest pending cases.`),
  f("extra", "neverActedOn", "Cases never acted on", "count", "lower", "Cases with neither a reached hearing nor a desk action in the horizon: the fairness gap without counting pointless calls or ignoring desk work. Siddarth's slide: who is never heard?"),
  f("extra", "backlog4yActedOnShare", "4y+ cases acted on", "share", "higher",
    "Cases aged 4+ at the start that were heard, or had a desk action taken on their process, / all such cases."),
  f("extra", "disposedVerdict", "Disposals by verdict", "count", null, "Cases disposed by judgment (conviction or acquittal on the merits); part of the headline."),
  f("extra", "disposedSettlement", "Disposals by settlement", "count", null, "Cases settled, typically on a mediation report; part of the headline."),
  f("extra", "disposedCompounded", "Disposals by compounding", "count", null, "Offences compounded (s.147 NI Act); part of the headline."),
  f("extra", "disposedAcquittedDefault", "Acquittals for the complainant's default", "count", null, "Accused acquitted because the complainant did not appear; part of the headline."),
  f("extra", "disposedDismissedSteps", "Dismissals for steps not taken", "count", null, "Complaints dismissed because the complainant did not take steps (process fee, address); part of the headline."),
  f("extra", "disposedPostJudgment", "Post-judgment closures", "count", null, "Cases already decided whose remaining matter was closed; off the file, but not in the headline."),
  f("extra", "disposedLpSplit", "Long-pending splits", "count", null, "Cases split off to the long-pending register (accused absconding); off the file, but not in the headline."),
  f("extra", "disposedAllRoutes", "Cases off the file, all routes", "count", null, "Headline disposals plus post-judgment closures and long-pending splits."),
  f("extra", "disposedRouteInferred", "Disposals with an inferred route", "count", null,
    "Disposals whose row carried no route, classified as a post-judgment closure for a case already decided, a settlement on a REPORTS hearing, and a verdict otherwise."),
  f("extra", "throughputPerMonthAllRoutes", "Throughput, all routes", "perMonth", null, "Cases off the file by any route / horizon length in months."),
];

/** Every scorecard value as a flat family -> key -> number map (age bands become `ageBandsEnd.4+`). */
export function flattenScorecards(s: Scorecards): Record<Family, Record<string, number>> {
  const flat = (o: Record<string, unknown>): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(o)) {
      if (typeof v === "number") out[k] = v;
      else if (v && typeof v === "object") for (const [b, n] of Object.entries(v as Record<string, number>)) out[`${k}.${b}`] = n;
    }
    return out;
  };
  return { readme: flat(s.readme), caseStudy: flat(s.caseStudy), siddarth: flat(s.siddarth), extra: flat(s.extra) };
}
