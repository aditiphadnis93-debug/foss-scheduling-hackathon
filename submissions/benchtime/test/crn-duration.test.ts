// Rule 2 regression (adopted from the seeds review): the duration draw is keyed on the case's k-th substantive
// hearing, so failed calls before it never re-roll it.
import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { addDays, loadCalendar, nextWorkingDayAfter, nextWorkingDayOnOrAfter } from "../src/data/calendar";
import { DATA_DIR, loadRefTables } from "../src/data/reference";
import { loadRoster } from "../src/data/roster";
import { parseSummary } from "../src/data/summary";
import { HEARING_TYPES } from "../src/domain/types";
import type { CaseRecord, DayPlan, HearingType, Policy } from "../src/domain/types";
import { CALIBRATION_CONFIG } from "../src/world/calibrate";
import { defaultParams } from "../src/world/defaults";
import { simulate } from "../src/world/simulate";

const ref = loadRefTables(DATA_DIR);
const calendar = loadCalendar(DATA_DIR);
const sample = loadRoster(resolve(DATA_DIR, "roster_sample_100.csv"));
const START = "2026-10-01";
const DAY2 = nextWorkingDayAfter(START, calendar);

function rec(id: string, purpose: HearingType): CaseRecord {
  const hearingCounts = Object.fromEntries(HEARING_TYPES.map((t) => [t, 0])) as Record<HearingType, number>;
  return { caseNumber: id, filingNumber: `F-${id}`, filingDate: "2020-01-15", advocateId: `A-${id}`, partyId: `P-${id}`, currentStage: purpose, nextPurpose: purpose, hearingCounts, totalHearings: 0,
    summary: parseSummary("Present: Complainant, Complainant's Advocate, Accused, Accused Advocate\nHeard.") };
}
// Lists the given cases on the given dates; defers every other due case to the next working day.
const policy = (id: string, on: (date: string) => string[]): Policy => ({
  id, name: id, description: "", asksCheckin: false,
  initialDates: (ctx) => new Map(ctx.cases.map((c) => [c.id, ctx.date])),
  plan(ctx): DayPlan {
    const ids = on(ctx.date);
    const due = ctx.cases.filter((c) => !c.disposed && c.nextDate !== null && c.nextDate <= ctx.date);
    const listings = due.filter((c) => ids.includes(c.id)).map((c, i) => ({ caseId: c.id, type: c.nextPurpose, order: i, callTime: null, window: null, standby: false, expectedMinutes: 10, pSubstantive: 0.5, why: [] }));
    const to = nextWorkingDayAfter(ctx.date, ctx.calendar);
    const deferred = due.filter((c) => !ids.includes(c.id)).map((c) => ({ caseId: c.id, to, reason: "not today" }));
    return { date: ctx.date, listings, desk: [], deferred, expected: { minutes: 0, substantive: 0, overrunRisk: 0 } };
  },
  nextDate: (ctx, _c, _o, date) => nextWorkingDayAfter(date, ctx.calendar),
});

test("the same case heard substantively on the same day draws the same duration whatever failed before", () => {
  const params = defaultParams(ref, sample, { useCalibrated: false });
  for (const t of HEARING_TYPES) params.perType[t] = { admin: 0, procP: 0, procScale: 1, extP: 0, extScale: 1, absA: 0, absC: 0, both: 0, notReady: 0, soughtTime: 0, unclear: 0.5 };
  params.closureProb = 0;
  const cases = Array.from({ length: 200 }, (_, i) => rec(`ST/${i + 1}/2020`, "EVIDENCE_COMPLAINANT"));
  const ids = cases.map((c) => c.caseNumber);
  // a long day so every listed case is reached: the property is about the draw, not the clock
  const run = (p: Policy) => simulate({ records: cases, rosterId: "t", policy: p, config: CALIBRATION_CONFIG, ref, calendar, worldSeed: 5, start: START, end: DAY2, params, scorecards: false, capacityMinutes: 100000 });
  const early = run(policy("early", (d) => (d === START || d === DAY2 ? ids : [])));
  const late = run(policy("late", (d) => (d === DAY2 ? ids : [])));
  let compared = 0, differ = 0;
  for (const id of ids) {
    const f = early.hearings.find((h) => h.caseId === id && h.date === START)!;
    const a = early.hearings.find((h) => h.caseId === id && h.date === DAY2 && h.outcome === "substantive");
    const b = late.hearings.find((h) => h.caseId === id && h.date === DAY2 && h.outcome === "substantive");
    if (f.outcome !== "failed" || !a || !b) continue; // failed on day 1 under "early", heard on day 2 under both
    compared++;
    if (a.minutes !== b.minutes) differ++;
  }
  console.log(`compared ${compared}, differ ${differ}`);
  expect(compared).toBeGreaterThan(5);
  expect(differ).toBe(0);
});
