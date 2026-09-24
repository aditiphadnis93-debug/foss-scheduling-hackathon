// Every scorecard field on a tiny hand-built court: 10 cases, 3 sitting days plus one closure day, capacity
// 60 minutes. Each expected value is worked out by hand in the comments, from the rows below, so a change
// to a definition in src/eval/metrics.ts shows up here as a change to arithmetic someone can check.

import { describe, expect, test } from "bun:test";
import { SCORECARD_FIELDS, ageBands, benchMinuteOf, disposals, flattenScorecards, meanOfLargest, scorecards } from "../src/eval/metrics";
import { SIDE_BY_SIDE, renderMarkdown, summarise } from "../src/eval/report";
import type { CaseRecord, FailureReason, HearingLog, HearingType, Outcome, ParsedSummary, RefTables, Role, RunResult } from "../src/domain/types";
import { HEARING_TYPES } from "../src/domain/types";

const summary = (judgmentPronounced: ParsedSummary["judgmentPronounced"] = null): ParsedSummary => ({
  raw: "",
  attendance: { complainant: null, complainantAdvocate: null, accused: null, accusedAdvocate: null },
  notes: [],
  process: null,
  lastChance: false,
  mediation: false,
  forJudgment: false,
  judgmentPronounced,
  witnessToAttend: false,
  accusedToAppear: false,
  complainantToAppear: false,
  objectionsPending: false,
  tags: [],
});

const record = (id: string, filingDate: string, stage: HearingType, judgment: ParsedSummary["judgmentPronounced"] = null): CaseRecord => ({
  caseNumber: id,
  filingNumber: `F-${id}`,
  filingDate,
  advocateId: "ADV-1",
  partyId: `P-${id}`,
  currentStage: stage,
  nextPurpose: stage,
  hearingCounts: Object.fromEntries(HEARING_TYPES.map((t) => [t, 0])) as Record<HearingType, number>,
  totalHearings: 0,
  summary: summary(judgment),
});

// Ages at the start (2026-10-01), 365.25-day years:
// C1 6.75 (5+), C2 5.33 (5+), C3 4.58 (4-5), C4 4.17 (4-5), C5 3.75 (3-4), C6 2.75 (1-3), C7 1.75 (1-3),
// C8 0.75 (0-1), C9 0.33 (0-1), C10 1459 days = 3.9945 (3-4; it crosses 4 years during the horizon).
const RECORDS: CaseRecord[] = [
  record("C1", "2020-01-01", "ARGUMENTS"),
  record("C2", "2021-06-01", "EVIDENCE_COMPLAINANT"),
  record("C3", "2022-03-01", "JUDGEMENT"),
  record("C4", "2022-08-01", "WARRANT"),
  record("C5", "2023-01-01", "APPEARANCE"),
  record("C6", "2024-01-01", "PLEA"),
  record("C7", "2025-01-01", "ADMISSION"),
  record("C8", "2026-01-01", "ADMISSION"),
  record("C9", "2026-06-01", "ADMISSION"),
  record("C10", "2022-10-03", "ARGUMENTS"),
];

type Att = [boolean, boolean, boolean, boolean] | null;
const att = (a: Att): Record<Role, boolean> | null =>
  a && { complainant: a[0], complainantAdvocate: a[1], accused: a[2], accusedAdvocate: a[3] };
const ALL: Att = [true, true, true, true];

let seq = 0;
// The optional log fields (disposal route, start minute, call time) go on with Object.assign, so a test can
// also write a route the contract does not know.
type LogExtra = { disposalRoute?: string; startMinute?: number; callTime?: string | null };
const row = (
  date: string, caseId: string, type: HearingType, outcome: Outcome, minutes: number, a: Att,
  promised: string | null, nextDate: string | null,
  extra: { reason?: FailureReason; standby?: boolean; disposed?: boolean; order?: number } = {},
): HearingLog => ({
  date, caseId, type, outcome, minutes, attendance: att(a), promised, nextDate,
  reason: extra.reason ?? null,
  standby: extra.standby ?? false,
  listedOrder: extra.order ?? seq++,
  ...(extra.disposed !== undefined ? { disposed: extra.disposed } : {}),
});
const withLog = (h: HearingLog, x: LogExtra): HearingLog => Object.assign({ ...h }, x);

const D1 = "2026-10-01";
const D2 = "2026-10-05";
const D3 = "2026-10-06";
const D4 = "2026-10-07";

const HEARINGS: HearingLog[] = [
  // R0: before the horizon, ignored everywhere
  row("2026-09-30", "C1", "ARGUMENTS", "substantive", 10, ALL, "2026-09-30", D1),
  // D1: 57 reached minutes, C3 disposed, C5 and standby C6 not reached, C7 at the desk, C8 deferred
  row(D1, "C1", "ARGUMENTS", "substantive", 30, ALL, D1, "2026-11-30"), // R1
  row(D1, "C2", "EVIDENCE_COMPLAINANT", "failed", 2, [true, true, false, true], D1, D2, { reason: "respondent_absent" }), // R2
  row(D1, "C3", "JUDGEMENT", "substantive", 25, ALL, D1, null, { disposed: true }), // R3
  row(D1, "C5", "APPEARANCE", "not_reached", 0, null, D1, D3), // R4
  row(D1, "C6", "PLEA", "not_reached", 0, null, null, D2, { standby: true }), // R5
  row(D1, "C7", "ADMISSION", "desk", 0.5, null, D1, D3), // R6
  row(D1, "C8", "ADMISSION", "deferred", 0, null, D1, D2), // R7
  // D2: 62 reached minutes (overran by 2), C9 vacated at check-in
  row(D2, "C2", "EVIDENCE_COMPLAINANT", "failed", 2, ALL, D2, "2026-10-19", { reason: "not_ready" }), // R8
  row(D2, "C6", "PLEA", "failed", 2, [false, true, true, true], D2, D3, { reason: "petitioner_absent" }), // R9
  row(D2, "C8", "ADMISSION", "substantive", 58, [true, true, false, false], D2, "2026-10-12"), // R10
  row(D2, "C9", "ADMISSION", "vacated", 0, null, D2, "2026-10-20"), // R11
  // D3: 27 reached minutes; C9 pulled in early from its 20 Oct promise; C7 at the desk again
  row(D3, "C5", "APPEARANCE", "failed", 2, [true, true, false, true], D3, "2026-10-27", { reason: "awaiting_process" }), // R13
  row(D3, "C9", "ADMISSION", "substantive", 10, [true, true, false, false], "2026-10-20", "2026-10-13"), // R14
  row(D3, "C7", "ADMISSION", "desk", 0.5, null, D3, "2026-10-20"), // R15
  row(D3, "C6", "PLEA", "substantive", 15, ALL, D3, "2026-10-20"), // R16
  // D4: the court did not sit
  row(D4, "C10", "ARGUMENTS", "court_not_sitting", 0, null, D4, "2026-10-21"), // R17
];

// The day's minutes used include desk time (0.5 on D1 and D3), so judge time used differs from utilisation.
const DAYS: RunResult["days"] = [
  { date: D1, minutesUsed: 57.5, listed: 5, reached: 3, substantive: 2, desk: 1, vacated: 0, overran: false },
  { date: D2, minutesUsed: 62, listed: 3, reached: 3, substantive: 1, desk: 0, vacated: 1, overran: true },
  { date: D3, minutesUsed: 27.5, listed: 3, reached: 3, substantive: 2, desk: 1, vacated: 0, overran: false },
  { date: D4, minutesUsed: 0, listed: 1, reached: 0, substantive: 0, desk: 0, vacated: 0, overran: false },
];

// PUCAR's reference gaps for the types used
const MIN_GAP: Partial<Record<HearingType, number>> = { ARGUMENTS: 14, EVIDENCE_COMPLAINANT: 14, JUDGEMENT: 21, APPEARANCE: 21, PLEA: 14, ADMISSION: 5, COGNIZANCE: 30, EXAMINATION_UNDER_S351_BNSS: 21 };

const input = { hearings: HEARINGS, days: DAYS, records: RECORDS, start: D1, end: D4, capacityMinutes: 60, asOf: D4, minGapDays: MIN_GAP };
const S = scorecards(input);

// Tallies in the horizon (R1-R11, R13-R17; there is no R12): substantive R1 R3 R10 R14 R16 = 5; failed R2 R8 R9 R13 = 4; reached 9;
// not reached R4 R5 = 2; court not sitting R17 = 1; listed 12; vacated 1; desk 2; deferred 1.
// Sitting days D1 D2 D3 (D4 closed) = 3, available minutes 180.
// Reached minutes: D1 30+2+25 = 57, D2 2+2+58 = 62, D3 2+10+15 = 27, total 146.

describe("README scorecard", () => {
  test("utilisation = 146 / 180, uncapped", () => expect(S.readme.utilisation).toBeCloseTo(146 / 180, 10));
  test("reach rate = 9 reached / 12 listed", () => expect(S.readme.reachRate).toBeCloseTo(9 / 12, 10));
  test("substantiveness = 5 / 9", () => expect(S.readme.substantiveness).toBeCloseTo(5 / 9, 10));
  // 4y+ at start: C1 C2 C3 C4. Heard: C1 C2 C3 (C2 only failed). Substantive: C1 C3.
  test("4y+ heard at all = 3 / 4", () => expect(S.readme.backlog4yHeardShare).toBeCloseTo(0.75, 10));
  test("4y+ heard substantively = 2 / 4", () => expect(S.readme.backlog4ySubstantiveShare).toBeCloseTo(0.5, 10));
  // first row to first reached: C1 0, C2 0, C3 0, C5 D1 to D3 = 5, C6 D1 to D2 = 4, C8 D1 to D2 = 4,
  // C9 D2 to D3 = 1; C7 and C10 never heard. Mean 14 / 7 = 2.
  test("predictability gap = 14 / 7 days", () => expect(S.readme.predictabilityGapDays).toBeCloseTo(2, 10));
});

describe("case study scorecard", () => {
  // capped per day: 57 + min(60, 62) + 27 = 144
  test("utilisation within capacity = 144 / 180", () => expect(S.caseStudy.utilisation).toBeCloseTo(0.8, 10));
  test("overrun days = 1 (D2)", () => expect(S.caseStudy.overrunDays).toBe(1));
  // idle from minutes used: (60 - 57.5) + 0 + (60 - 27.5) = 35
  test("idle share = 35 / 180", () => expect(S.caseStudy.idleMinutesShare).toBeCloseTo(35 / 180, 10));
  // reached on the date listed for: all reached rows but R14 (promised 20 Oct, heard 6 Oct) = 8
  test("held as scheduled = 8 / (12 listed + 1 deferred)", () => expect(S.caseStudy.heldAsScheduled).toBeCloseTo(8 / 13, 10));
  test("held as scheduled, all due = 8 / (13 + 1 vacated + 2 desk)", () => expect(S.caseStudy.heldAsScheduledAllDue).toBeCloseTo(0.5, 10));
  test("substantiveness = 5 / 9", () => expect(S.caseStudy.substantiveness).toBeCloseTo(5 / 9, 10));
  test("age bands at the start", () =>
    expect(S.caseStudy.ageBandsStart).toEqual({ "0-1": 2, "1-3": 2, "3-4": 2, "4-5": 2, "5+": 2, "3+": 6, "4+": 4 }));
  // C3 disposed; C10 is 1465 days = 4.011 years on 7 Oct, so it moves from 3-4 to 4-5
  test("age bands at the end (pending only)", () =>
    expect(S.caseStudy.ageBandsEnd).toEqual({ "0-1": 2, "1-3": 2, "3-4": 1, "4-5": 2, "5+": 2, "3+": 5, "4+": 4 }));
  // reached, non-disposing: R1 60 - 14 = 46; R2 4 < 14: 0; R8 14 - 14 = 0; R9 1 < 14: 0; R10 7 - 5 = 2;
  // R13 21 - 21 = 0; R14 7 - 5 = 2; R16 14 - 14 = 0. Mean 50 / 8.
  test("next date excess = 50 / 8 days", () => expect(S.caseStudy.nextDateExcessDays).toBeCloseTo(6.25, 10));
  // relists revealing readiness: R8 (not ready), R13 (awaiting process), R9 (absent), R16, R10, R14; R15 is
  // C7's desk row straight after its desk row R6, a registry re-check, so it is left out
  test("wasted relists = 2 / 6, desk re-check left out", () => expect(S.caseStudy.wastedRelistShare).toBeCloseTo(2 / 6, 10));
});

describe("Siddarth's six", () => {
  // one disposal over 7 calendar days = 7 / 30.4375 months
  test("throughput = 1 / (7 / 30.4375) per month", () => expect(S.siddarth.throughputPerMonth).toBeCloseTo(30.4375 / 7, 10));
  test("judge time used = 147 / 180", () => expect(S.siddarth.judgeTimeUsed).toBeCloseTo(147 / 180, 10));
  test("wasted listings = (2 not reached + 1 not sitting + 4 failed) / 12", () => expect(S.siddarth.wastedListings).toBeCloseTo(7 / 12, 10));
  // reached on the promised date: 8 (R14 early); rows with a promise: 16 rows (R1-R11, R13-R17) minus standby R5 = 15
  test("held on the promised date = 8 / 15", () => expect(S.siddarth.heldOnPromisedDate).toBeCloseTo(8 / 15, 10));
  // C1 filed 2020-01-01, 2471 days to 7 Oct 2026
  test("oldest pending = 2471 days", () => expect(S.siddarth.oldestPendingAgeYears).toBeCloseTo(2471 / 365.25, 10));
  // pending ages in days: 128 279 644 1010 1375 1465 1528 1954 2471; p95 at rank 7.6 = 1954 + 0.6 x 517
  test("p95 pending age = 2264.2 days", () => expect(S.siddarth.p95PendingAgeYears).toBeCloseTo(2264.2 / 365.25, 10));
  test("never heard = C4, C7, C10", () => expect(S.siddarth.neverHeard).toBe(3));
  // minutes used 57.5, 62, 27.5: mean 49, population variance 703.5 / 3
  test("load balance CV", () => expect(S.siddarth.loadBalanceCv).toBeCloseTo(Math.sqrt(703.5 / 3) / 49, 10));
});

describe("extras", () => {
  test("per sitting day counts", () => {
    expect(S.extra.listedPerDay).toBeCloseTo(4, 10);
    expect(S.extra.reachedPerDay).toBeCloseTo(3, 10);
    expect(S.extra.substantivePerDay).toBeCloseTo(5 / 3, 10);
    expect(S.extra.deskPerDay).toBeCloseTo(2 / 3, 10);
    expect(S.extra.vacatedPerDay).toBeCloseTo(1 / 3, 10);
    expect(S.extra.deferredPerDay).toBeCloseTo(1 / 3, 10);
    expect(S.extra.sittingDays).toBe(3);
  });
  test("disposals", () => {
    expect(S.extra.disposed).toBe(1);
    expect(S.extra.disposed4yPlus).toBe(1);
    expect(S.extra.disposalsInferred).toBe(0);
  });
  // trips on listed rows: R1 4, R2 3, R3 4, R4 4 (unrecorded), R5 4, R8 4, R9 3, R10 2, R13 3, R14 2, R16 4,
  // R17 4 = 41; on substantive rows R1 R3 R10 R14 R16 = 16
  test("trips", () => {
    expect(S.extra.tripsPerSubstantive).toBeCloseTo(41 / 5, 10);
    expect(S.extra.wastedTripShare).toBeCloseTo(25 / 41, 10);
  });
  test("alternative readings", () => {
    expect(S.extra.overrunMinutes).toBeCloseTo(2, 10);
    expect(S.extra.reachRateExclStandby).toBeCloseTo(9 / 11, 10);
    expect(S.extra.reachRateSittingDays).toBeCloseTo(9 / 11, 10);
    // never-heard cases counted to the end: C7 D1 to D4 = 6, C10 0; (14 + 6 + 0) / 9
    expect(S.extra.predictabilityGapDaysCensored).toBeCloseTo(20 / 9, 10);
    expect(S.extra.casesScheduled).toBe(9);
    expect(S.extra.heldOnPromisedShareOfHeard).toBeCloseTo(8 / 9, 10);
    // gaps 60 4 14 1 7 21 7 14 = 128; two inside the minimum (R2, R9)
    expect(S.extra.nextDateGapDays).toBeCloseTo(16, 10);
    expect(S.extra.nextDateShortShare).toBeCloseTo(0.25, 10);
    // R8, R13 and absent R9 of the 6 relists (R15 left out as a desk re-check)
    expect(S.extra.wastedRelistShareInclAbsence).toBeCloseTo(3 / 6, 10);
    // the earlier reading keeps R15: R8, R13, R15 of 7
    expect(S.extra.wastedRelistShareInclDeskRechecks).toBeCloseTo(3 / 7, 10);
    expect(S.extra.neverHeard4yPlus).toBe(1);
    expect(S.extra.pending4yPlusEnd).toBe(4);
  });
});

describe("new readings on the scenario", () => {
  // substantive on the date listed for: R1 R3 R10 R16 (R14 early) = 4; all due = 12 listed + 1 deferred +
  // 1 vacated + 2 desk = 16
  test("substantive on the promised date, all due = 4 / 16", () => expect(S.extra.heldSubstantiveAllDue).toBeCloseTo(0.25, 10));
  // first rows due on their promise: C1 R1 kept, C2 R2 kept, C3 R3 kept, C5 R4 not reached, C7 R6 desk,
  // C8 R7 deferred, C9 R11 vacated, C10 R17 closure; C6's first row R5 carried no promise
  test("first promise kept = 3 / 8 cases", () => expect(S.extra.firstPromiseKept).toBeCloseTo(3 / 8, 10));
  // next purposes: R1 none seen, substantive ARGUMENTS gives JUDGEMENT (21), 60 - 21 = 39; R2 next row R8
  // EVIDENCE_COMPLAINANT (14), 0; R8 none seen, failed keeps EVIDENCE_COMPLAINANT, 14 - 14 = 0; R9 next row
  // R16 PLEA, 0; R10 none, ADMISSION gives COGNIZANCE (30, delay condonation skipped), 0; R13 none, failed
  // keeps APPEARANCE, 21 - 21 = 0; R14 none, COGNIZANCE, 0; R16 none, PLEA gives EXAMINATION (21), 0.
  test("next date excess against the next purpose = 39 / 8, 6 of 8 purposes inferred", () => {
    expect(S.extra.nextDateExcessNextPurposeDays).toBeCloseTo(39 / 8, 10);
    expect(S.extra.nextDateNextPurposeInferredShare).toBeCloseTo(6 / 8, 10);
  });
  // next dates after 7 Oct: R1 30 Nov, R8 19 Oct, R10 12 Oct, R13 27 Oct, R14 13 Oct, R16 20 Oct; R2 and R9 inside
  test("next dates beyond the horizon = 6 / 8", () => expect(S.extra.nextDatesBeyondHorizonShare).toBeCloseTo(0.75, 10));
  // from 1 Oct: C1 C2 C3 0, C5 5, C6 4, C8 4, C9 5; C4 C7 C10 never heard, 6 each; 36 over 10 cases
  test("gap from the horizon start, all cases, censored = 36 / 10", () => expect(S.extra.predictabilityGapFromStartDays).toBeCloseTo(3.6, 10));
  // fewer than 100 pending: the mean of all nine pending ages, 10854 days / 9 = 1206 days
  test("mean age of the 100 oldest pending = 1206 days", () => expect(S.extra.oldest100PendingMeanAgeYears).toBeCloseTo(1206 / 365.25, 10));
  test("4y+ acted on = 3 / 4 (no 4y+ desk rows here)", () => expect(S.extra.backlog4yActedOnShare).toBeCloseTo(0.75, 10));
  test("no start minutes in the log: minutes waited is n/a", () => {
    expect(Number.isNaN(S.extra.minutesWaited)).toBe(true);
    expect(Number.isNaN(S.extra.minutesWaitedInclNotReached)).toBe(true);
  });
  // R3 is flagged disposed with no route: a JUDGEMENT of a case not past judgment, so a verdict, flagged
  test("a disposal without a route falls back to inference and is flagged", () => {
    expect(S.extra.disposedVerdict).toBe(1);
    expect(S.extra.disposed).toBe(1);
    expect(S.extra.disposedAllRoutes).toBe(1);
    expect(S.extra.disposedRouteInferred).toBe(1);
    expect(S.extra.throughputPerMonthAllRoutes).toBeCloseTo(30.4375 / 7, 10);
  });
});

describe("minutes waited", () => {
  // Start minutes on four reached rows (bench minutes after 10:00): R1 at 0 with no call time (arrival
  // 10:30 = 30), waited 0 x 4 people; R2 at 30, called for 10:00 (0), waited 30 x 3 = 90; R3 at 32, no
  // call time, waited 2 x 4 = 8; R16 at 12, called for 10:00, waited 12 x 4 = 48. 146 over 15 people.
  // R4, not reached on D1, now records two people present, called for 10:00: the court rose at
  // max(60, 57) = 60, so 60 x 2 = 120; the wider reading is 266 over 17.
  const timed = HEARINGS.map((h, i) => {
    if (i === 1) return withLog(h, { startMinute: 0, callTime: null });
    if (i === 2) return withLog(h, { startMinute: 30, callTime: "10:00" });
    if (i === 3) return withLog(h, { startMinute: 32 });
    if (i === 4) return withLog({ ...h, attendance: att([true, true, false, false]) }, { callTime: "10:00" });
    if (i === 15) return withLog(h, { startMinute: 12, callTime: "10:00" });
    return h;
  });
  const s = scorecards({ ...input, hearings: timed });
  test("per person heard = 146 / 15", () => expect(s.extra.minutesWaited).toBeCloseTo(146 / 15, 10));
  test("counting matters not reached = 266 / 17", () => expect(s.extra.minutesWaitedInclNotReached).toBeCloseTo(266 / 17, 10));
  // R4's recorded attendance (2) replaces the assumed 4: trips 41 - 4 + 2 = 39
  test("attendance on a not-reached row is used for trips", () => expect(s.extra.tripsPerSubstantive).toBeCloseTo(39 / 5, 10));
  test("bench minutes skip lunch", () => {
    expect(benchMinuteOf("10:00")).toBe(0);
    expect(benchMinuteOf("10:30")).toBe(30);
    expect(benchMinuteOf("13:45")).toBe(210);
    expect(benchMinuteOf("14:00")).toBe(210);
    expect(benchMinuteOf("15:00")).toBe(270);
    expect(benchMinuteOf("09:30")).toBe(0);
  });
  test("mean of the largest n", () => {
    expect(meanOfLargest([1, 9, 3, 7, 5], 2)).toBeCloseTo(8, 10);
    expect(meanOfLargest([1, 9], 100)).toBeCloseTo(5, 10);
    expect(Number.isNaN(meanOfLargest([], 100))).toBe(true);
  });
});

describe("disposals by route", () => {
  // R3 a verdict; R16 (C6, 2.75 years) now disposed by compounding; three new rows: C11 (post-judgment,
  // filed 2019) closed on D2, C4 split to the long-pending register on D3, C12 (filed 2021, 5.75 years)
  // acquitted for the complainant's default on D3.
  const recs = [...RECORDS, record("C11", "2019-01-01", "APPLICATION_REVIEW", "convicted"), record("C12", "2021-01-01", "EVIDENCE_COMPLAINANT")];
  const routed = [
    ...HEARINGS.map((h, i) =>
      i === 3 ? withLog(h, { disposalRoute: "verdict" }) : i === 15 ? withLog({ ...h, disposed: true, nextDate: null }, { disposalRoute: "compounded" }) : h),
    withLog(row(D2, "C11", "APPLICATION_REVIEW", "substantive", 0, ALL, D2, null, { disposed: true }), { disposalRoute: "post_judgment" }),
    withLog(row(D3, "C4", "WARRANT", "failed", 0, [true, true, false, false], D3, null, { reason: "respondent_absent", disposed: true }), { disposalRoute: "lp_split" }),
    withLog(row(D3, "C12", "EVIDENCE_COMPLAINANT", "failed", 0, [false, false, true, true], D3, null, { reason: "petitioner_absent", disposed: true }), { disposalRoute: "acquitted_default" }),
  ];
  const s = scorecards({ ...input, hearings: routed, records: recs });
  test("each route counted", () => {
    expect([s.extra.disposedVerdict, s.extra.disposedCompounded, s.extra.disposedAcquittedDefault, s.extra.disposedPostJudgment, s.extra.disposedLpSplit]).toEqual([1, 1, 1, 1, 1]);
    expect([s.extra.disposedSettlement, s.extra.disposedDismissedSteps, s.extra.disposedRouteInferred]).toEqual([0, 0, 0]);
  });
  // headline: verdict C3, compounded C6, default acquittal C12 = 3; all routes 5
  test("headline = 3, all routes = 5", () => {
    expect(s.extra.disposed).toBe(3);
    expect(s.extra.disposedAllRoutes).toBe(5);
  });
  test("throughput on the headline, all routes as an extra", () => {
    expect(s.siddarth.throughputPerMonth).toBeCloseTo((3 * 30.4375) / 7, 10);
    expect(s.extra.throughputPerMonthAllRoutes).toBeCloseTo((5 * 30.4375) / 7, 10);
  });
  // 4y+ at the start among the headline: C3 (4.58) and C12 (5.75); C6 is 2.75
  test("4y+ headline disposals = 2", () => expect(s.extra.disposed4yPlus).toBe(2));
  // every route leaves the file: C3 C4 C6 C11 C12 are not pending, so 7 of 12 remain
  test("pending at the end excludes every route", () => {
    const e = s.caseStudy.ageBandsEnd;
    expect((e["0-1"] ?? 0) + (e["1-3"] ?? 0) + (e["3-4"] ?? 0) + (e["4-5"] ?? 0) + (e["5+"] ?? 0)).toBe(7);
  });
  test("pending 4y+ at the end: C1 C2 C10 (C3, C4, C11, C12 off the file)", () => expect(s.extra.pending4yPlusEnd).toBe(3));
  test("rows without a route: REPORTS is a settlement, a decided case a post-judgment closure, and an unknown route is inferred", () => {
    const rows = [
      row(D1, "C1", "REPORTS", "substantive", 5, ALL, D1, null, { disposed: true }),
      row(D1, "C11", "APPLICATION_REVIEW", "substantive", 5, ALL, D1, null, { disposed: true }),
      withLog(row(D2, "C2", "ARGUMENTS", "substantive", 5, ALL, D2, null, { disposed: true }), { disposalRoute: "something_new" }),
      withLog(row(D2, "C5", "APPEARANCE", "failed", 1, ALL, D2, null, { disposed: true }), { disposalRoute: "dismissed_steps" }),
    ];
    const d = disposals(rows, recs);
    expect(Object.fromEntries(d.route)).toEqual({ C1: "settlement", C11: "post_judgment", C2: "verdict", C5: "dismissed_steps" });
    expect([...d.routeInferred].sort()).toEqual(["C1", "C11", "C2"]);
  });
});

describe("edge cases", () => {
  test("never acted on: never heard and no desk action; a desk row counts as acting", () => {
    // base scenario: C4, C7 and C10 are never heard; C7 has desk rows (R6, R15), so only C4 and C10: 2.
    // a desk row for C4 makes it 1, while never heard stays 3
    expect(S.extra.neverActedOn).toBe(2);
    const s = scorecards({ ...input, hearings: [...HEARINGS, row(D2, "C4", "WARRANT", "desk", 0.5, null, D2, "2026-10-20")] });
    expect(s.extra.neverActedOn).toBe(1);
    expect(s.siddarth.neverHeard).toBe(3);
  });
  test("4y+ acted on counts a desk action on a case never heard", () => {
    // C4 (4.17 years) gets a desk row on D2: acted on 4 / 4, heard still 3 / 4
    const s = scorecards({ ...input, hearings: [...HEARINGS, row(D2, "C4", "WARRANT", "desk", 0.5, null, D2, "2026-10-20")] });
    expect(s.extra.backlog4yActedOnShare).toBeCloseTo(1, 10);
    expect(s.readme.backlog4yHeardShare).toBeCloseTo(0.75, 10);
  });
  test("a desk row after a hearing is a wasted relist; after a desk row it is a re-check", () => {
    // C5 gets a desk row on D4 after its failed hearing R13: it counts, 3 / 7; C7's R15 stays out
    const s = scorecards({ ...input, end: "2026-10-08", hearings: [...HEARINGS, row("2026-10-08", "C5", "APPEARANCE", "desk", 0.5, null, "2026-10-08", "2026-10-27")] });
    expect(s.caseStudy.wastedRelistShare).toBeCloseTo(3 / 7, 10);
    expect(s.extra.wastedRelistShareInclDeskRechecks).toBeCloseTo(4 / 8, 10);
  });
  test("without disposal flags, a substantive JUDGEMENT and a post-judgment matter are inferred", () => {
    const strip = HEARINGS.map(({ disposed: _d, ...h }) => h);
    const recs = [...RECORDS, record("C11", "2019-01-01", "APPLICATION_REVIEW", "convicted")];
    const post = { ...strip[1]!, caseId: "C11", type: "APPLICATION_REVIEW" as HearingType, date: D3 };
    const d = disposals([...strip, post], recs);
    expect(d.inferred).toBe(true);
    expect([...d.on.entries()].sort()).toEqual([["C11", D3], ["C3", D1]]);
    const s = scorecards({ ...input, hearings: strip });
    expect(s.extra.disposed).toBe(1);
    expect(s.extra.disposalsInferred).toBe(1);
  });
  test("next dates come from the next row's promise when the log has no nextDate", () => {
    const noNext = HEARINGS.map(({ nextDate: _n, ...h }) => h);
    // only next dates seen inside the horizon survive: R2 to D2 (4), R9 to D3 (1), R10 none, R14 none,
    // R1 none (30 Nov is beyond), R8 none, R13 none, R16 none
    const s = scorecards({ ...input, hearings: noNext });
    expect(s.extra.nextDateGapDays).toBeCloseTo(2.5, 10);
    expect(s.caseStudy.nextDateExcessDays).toBeCloseTo(0, 10);
  });
  test("desk and deferred rows on a closure day (listedOrder -1) are due but not listed", () => {
    const extraRow = row(D4, "C7", "ADMISSION", "court_not_sitting", 0, null, D4, "2026-10-21", { order: -1 });
    const s = scorecards({ ...input, hearings: [...HEARINGS, extraRow] });
    expect(s.readme.reachRate).toBeCloseTo(9 / 12, 10);
    expect(s.caseStudy.heldAsScheduledAllDue).toBeCloseTo(8 / 17, 10);
    expect(s.extra.tripsPerSubstantive).toBeCloseTo(41 / 5, 10);
  });
  test("reference tables stand in for minGapDays", () => {
    const ref = Object.fromEntries(Object.entries(MIN_GAP).map(([t, g]) => [t, { gapDays: g }])) as unknown as RefTables;
    const s = scorecards({ ...input, minGapDays: undefined, ref });
    expect(s.caseStudy.nextDateExcessDays).toBeCloseTo(6.25, 10);
  });
  test("no minimum gaps gives NaN excess, not a guess", () => {
    const s = scorecards({ ...input, minGapDays: undefined });
    expect(Number.isNaN(s.caseStudy.nextDateExcessDays)).toBe(true);
  });
  test("an empty run yields NaN shares and zero counts", () => {
    const s = scorecards({ ...input, hearings: [], days: [] });
    expect(Number.isNaN(s.readme.utilisation)).toBe(true);
    expect(s.siddarth.neverHeard).toBe(10);
    expect(s.extra.disposed).toBe(0);
  });
  test("age band boundaries are half-open", () => {
    expect(ageBands([0, 0.999, 1, 2.999, 3, 3.999, 4, 4.999, 5, 12])).toEqual({ "0-1": 2, "1-3": 2, "3-4": 2, "4-5": 2, "5+": 2, "3+": 6, "4+": 4 });
  });
});

describe("field catalogue", () => {
  test("every computed field has a definition and every definition a value", () => {
    const flat = flattenScorecards(S);
    const computed = Object.entries(flat).flatMap(([fam, o]) => Object.keys(o).map((k) => `${fam}.${k}`)).sort();
    const catalogued = SCORECARD_FIELDS.map((m) => `${m.family}.${m.key}`).sort();
    expect(catalogued).toEqual(computed);
  });
  test("definitions carry no em dashes, middle dots or arrows", () => {
    for (const m of SCORECARD_FIELDS) expect(/[—·→←]/.test(m.label + m.source)).toBe(false);
  });
});

describe("report", () => {
  // three seeds of the scenario as the baseline, and a policy that is the same court with 10 points more
  // utilisation on every seed: the paired difference is exactly +10 points and marked better
  const run = (policyId: string, worldSeed: number, bump: number): RunResult => ({
    policyId, worldSeed, rosterId: "tiny", hearings: [], days: DAYS,
    scorecards: { ...S, readme: { ...S.readme, utilisation: S.readme.utilisation + bump + worldSeed / 100 } },
  });
  const runs = [1, 2, 3].flatMap((k) => [run("status_quo_60", k, 0), run("better_policy", k, 0.1)]);
  const summary = summarise(runs, "status_quo_60", { start: D1, end: D4, capacityMinutes: 60 });

  test("cells carry every catalogued field with a mean across seeds", () => {
    const cell = summary.cells.find((c) => c.policyId === "status_quo_60")!;
    expect(cell.seeds).toEqual([1, 2, 3]);
    expect(cell.fields["readme.utilisation"]!.mean).toBeCloseTo(S.readme.utilisation + 0.02, 10);
    for (const m of SCORECARD_FIELDS) expect(cell.fields[`${m.family}.${m.key}`]).toBeDefined();
  });
  test("paired difference against the baseline", () => {
    const d = summary.paired.find((p) => p.policyId === "better_policy" && p.field === "readme.utilisation")!.diff;
    expect([d.mean, d.lo, d.hi, d.wins]).toEqual([expect.closeTo(0.1, 10), expect.closeTo(0.1, 10), expect.closeTo(0.1, 10), 3]);
  });
  test("markdown has a table per family, the paired section and the definitions, in house style", () => {
    const md = renderMarkdown(summary);
    for (const h of ["README scorecard", "Case study scorecard", "Siddarth's six", "Extra measures", "Paired differences against status_quo_60", "Definitions"]) expect(md).toContain(h);
    expect(md).toContain("+10.0 [+10.0, +10.0] better");
    expect(/[—·→←]/.test(md)).toBe(false);
  });
  test("every catalogued field has a row in its family table", () => {
    const md = renderMarkdown(summary);
    for (const m of SCORECARD_FIELDS) expect(md).toContain(`| ${m.label.replace(/\|/g, "/")} |`);
  });
  test("the held-as-scheduled readings always appear together, with the substantive one", () => {
    const md = renderMarkdown(summary);
    const i = md.indexOf("#### Held as scheduled, every reading");
    expect(i).toBeGreaterThan(0);
    const table = md.slice(i, md.indexOf("####", i + 5));
    for (const label of ["Held as scheduled (as listed)", "Held as scheduled (all due)", "Substantive on the promised date (all due)"]) expect(table).toContain(label);
    // 8 / 13, 8 / 16 and 4 / 16 on every seed
    expect(table).toContain("61.5 [61.5, 61.5]");
    expect(table).toContain("50.0 [50.0, 50.0]");
    expect(table).toContain("25.0 [25.0, 25.0]");
    expect(md).toContain("#### Held as scheduled, every reading, paired");
  });
  test("every side-by-side key is a catalogued field", () => {
    const known = new Set(SCORECARD_FIELDS.map((m) => `${m.family}.${m.key}`));
    for (const g of SIDE_BY_SIDE) for (const k of g.keys) expect(known.has(k)).toBe(true);
  });
  test("disposals with an inferred route are noted, and a field a run lacks shows as n/a", () => {
    const md = renderMarkdown(summary);
    expect(md).toContain("some disposing rows carried no route");
    const { heldSubstantiveAllDue: _h, ...lean } = S.extra;
    const old = summarise([{ policyId: "status_quo_60", worldSeed: 1, rosterId: "tiny", hearings: [], days: DAYS, scorecards: { ...S, extra: lean as typeof S.extra } }]);
    expect(renderMarkdown(old)).toContain("| Substantive on the promised date (all due) | % | n/a |");
  });
});

describe("dates honoured and dates broken", () => {
  test("a desk order on the promised date honours it; a case with no date in the horizon counts as broken", () => {
    const base = scorecards(input);
    const withDesk = scorecards({ ...input, hearings: [...HEARINGS, row(D2, "C4", "WARRANT", "desk", 0.5, null, D2, "2026-10-20")] });
    expect(withDesk.extra.promisesHonouredInclDesk).toBeGreaterThan(base.extra.promisesHonouredInclDesk as number);
    expect(base.extra.promisesHonouredInclDesk as number).toBeGreaterThanOrEqual(base.siddarth.heldOnPromisedDate);
    // C4 had no row at all before; giving it a honoured desk date removes one never-dated case and adds no broken date
    expect(withDesk.extra.promisesBroken).toBe((base.extra.promisesBroken as number) - 1);
  });
});
