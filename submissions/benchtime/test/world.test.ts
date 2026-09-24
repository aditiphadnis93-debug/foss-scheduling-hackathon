import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { addDays, loadCalendar, nextWorkingDayAfter, nextWorkingDayOnOrAfter, workingDays } from "../src/data/calendar";
import { DATA_DIR, loadRefTables } from "../src/data/reference";
import { caseIdOf, loadRoster } from "../src/data/roster";
import { parseSummary } from "../src/data/summary";
import { HEARING_TYPES } from "../src/domain/types";
import type { CaseRecord, CaseView, DayPlan, HearingType, Listing, PlanContext, Policy } from "../src/domain/types";
import type { WorldParams } from "../src/world/api";
import { CALIBRATION_CONFIG, calibrate, calibrationPolicy } from "../src/world/calibrate";
import { defaultParams, targetsFor } from "../src/world/defaults";
import { simulate } from "../src/world/simulate";
import { checkinAnswers, resolveHearing } from "../src/world/resolve";
import { absconds, buildWorld, drawProcess, resolveParams } from "../src/world/world";
import { requiredRoles } from "../src/domain/lifecycle";

const ref = loadRefTables(DATA_DIR);
const calendar = loadCalendar(DATA_DIR);
const START = "2026-10-01";
const END = "2026-10-30";
const sample = loadRoster(resolve(DATA_DIR, "roster_sample_100.csv"));

function record(id: string, purpose: HearingType, summary: string, filingDate = "2020-01-15"): CaseRecord {
  const hearingCounts = Object.fromEntries(HEARING_TYPES.map((t) => [t, 0])) as Record<HearingType, number>;
  return {
    caseNumber: id,
    filingNumber: `F-${id}`,
    filingDate,
    advocateId: `ADV-${id}`,
    partyId: `P-${id}`,
    currentStage: purpose,
    nextPurpose: purpose,
    hearingCounts,
    totalHearings: 0,
    summary: parseSummary(summary),
  };
}

const PRESENT_ALL = "Present: Complainant, Complainant's Advocate, Accused, Accused Advocate\nHeard.";

/** Parameters with every failure switched off: every called hearing is substantive. */
function frictionless(): WorldParams {
  const p = defaultParams(ref, sample, { useCalibrated: false });
  for (const t of HEARING_TYPES) p.perType[t] = { admin: 0, procP: 0, procScale: 1, extP: 0, extScale: 1, absA: 0, absC: 0, both: 0, notReady: 0, soughtTime: 0, unclear: 0 };
  p.closureProb = 0;
  return p;
}

/** A policy defined by a function of the day: lists what `pick` returns (in order), defers every other due case a day. */
function toyPolicy(id: string, pick: (ctx: PlanContext) => { id: string; callTime?: string }[], opts: { checkin?: boolean; firstDate?: (c: CaseView) => string } = {}): Policy {
  return {
    id,
    name: id,
    description: "test policy",
    asksCheckin: opts.checkin ?? false,
    initialDates(ctx) {
      return new Map(ctx.cases.map((c) => [c.id, opts.firstDate ? opts.firstDate(c) : ctx.date]));
    },
    plan(ctx): DayPlan {
      const chosen = pick(ctx);
      const byId = new Map(ctx.cases.map((c) => [c.id, c]));
      const listings: Listing[] = chosen.map((p, i) => ({
        caseId: p.id,
        type: byId.get(p.id)!.nextPurpose,
        order: i,
        callTime: p.callTime ?? null,
        window: null,
        standby: false,
        expectedMinutes: 10,
        pSubstantive: 0.5,
        why: [],
      }));
      const listed = new Set(chosen.map((p) => p.id));
      const to = nextWorkingDayAfter(ctx.date, ctx.calendar);
      const deferred = ctx.cases.filter((c) => !c.disposed && c.nextDate !== null && c.nextDate <= ctx.date && !listed.has(c.id)).map((c) => ({ caseId: c.id, to, reason: "not today" }));
      return { date: ctx.date, listings, desk: [], deferred, expected: { minutes: 0, substantive: 0, overrunRisk: 0 } };
    },
    nextDate: (ctx, _c, _o, date) => nextWorkingDayOnOrAfter(addDays(date, 7), ctx.calendar),
  };
}

const run = (policy: Policy, records: readonly CaseRecord[], params: WorldParams, seed = 7, end = END) =>
  simulate({ records, rosterId: "test", policy, config: CALIBRATION_CONFIG, ref, calendar, worldSeed: seed, start: START, end, params, scorecards: false });

// ---------------------------------------------------------------------------------------------

describe("common random numbers", () => {
  const cases = [record("ST/1/2020", "EVIDENCE_COMPLAINANT", PRESENT_ALL), record("ST/2/2020", "ARGUMENTS", PRESENT_ALL), record("ST/3/2020", "EVIDENCE_ACCUSED", PRESENT_ALL)];

  test("two policies calling the same case on the same day see the same duration", () => {
    const params = frictionless();
    const alone = run(toyPolicy("alone", (ctx) => (ctx.date === START ? [{ id: "ST/1/2020" }] : [])), cases, params);
    const crowd = run(toyPolicy("crowd", (ctx) => (ctx.date === START ? [{ id: "ST/3/2020" }, { id: "ST/2/2020" }, { id: "ST/1/2020" }] : [])), cases, params);
    const a = alone.hearings.find((h) => h.caseId === "ST/1/2020" && h.date === START)!;
    const b = crowd.hearings.find((h) => h.caseId === "ST/1/2020" && h.date === START)!;
    expect(a.outcome).toBe("substantive");
    expect(b.outcome).toBe("substantive");
    expect(a.minutes).toBe(b.minutes);
    expect(a.listedOrder).not.toBe(b.listedOrder);
  });

  test("attendance draws do not depend on who else is listed or in what order", () => {
    const params = defaultParams(ref, sample, { useCalibrated: false });
    for (const t of HEARING_TYPES) params.perType[t] = { ...params.perType[t], admin: 0, procP: 0, extP: 0, absA: 1, absC: 1 };
    const ids = sample.slice(0, 30).map(caseIdOf);
    const some = run(toyPolicy("first-ten", (ctx) => (ctx.date === START ? ids.slice(0, 10).map((id) => ({ id })) : [])), sample.slice(0, 30), params);
    const all = run(toyPolicy("reversed", (ctx) => (ctx.date === START ? [...ids].reverse().map((id) => ({ id })) : [])), sample.slice(0, 30), params);
    let compared = 0;
    for (const id of ids.slice(0, 10)) {
      const a = some.hearings.find((h) => h.caseId === id && h.date === START)!;
      const b = all.hearings.find((h) => h.caseId === id && h.date === START)!;
      if (a.attendance && b.attendance) {
        expect(a.attendance).toEqual(b.attendance);
        compared++;
      }
    }
    expect(compared).toBe(10);
  });

  test("a slot moves the threshold, never the draw: attendance can only improve with a call time", () => {
    const params = defaultParams(ref, sample, { useCalibrated: false });
    const ids = sample.slice(0, 40).map(caseIdOf);
    const bare = run(toyPolicy("bare", (ctx) => (ctx.date === START ? ids.map((id) => ({ id })) : [])), sample.slice(0, 40), params);
    const slotted = run(toyPolicy("slotted", (ctx) => (ctx.date === START ? ids.map((id) => ({ id, callTime: "11:00" })) : [])), sample.slice(0, 40), params);
    for (const id of ids) {
      const a = bare.hearings.find((h) => h.caseId === id && h.date === START)!;
      const b = slotted.hearings.find((h) => h.caseId === id && h.date === START)!;
      if (!a.attendance || !b.attendance) continue;
      for (const role of ["complainant", "complainantAdvocate", "accused", "accusedAdvocate"] as const) if (a.attendance[role]) expect(b.attendance[role]).toBe(true);
    }
  });
});

describe("views", () => {
  const records = [
    record("ST/10/2021", "APPEARANCE", "Present: Complainant's Advocate\nAbsent: Accused\nIssue summons to accused. For return of summons."),
    record("ST/11/2021", "REPORTS", "Present: Complainant, Accused\nReferred to mediation. For report."),
    ...sample.slice(0, 20),
  ];
  const seen: CaseView[] = [];
  const spy = toyPolicy("spy", (ctx) => {
    seen.push(...ctx.cases);
    return ctx.cases.filter((c) => !c.disposed && c.nextDate !== null && c.nextDate <= ctx.date).map((c) => ({ id: c.id }));
  });
  const params = defaultParams(ref, sample, { useCalibrated: false });
  params.perType.REPORTS = { ...params.perType.REPORTS, extP: 1 };
  params.perType.APPEARANCE = { ...params.perType.APPEARANCE, procP: 1 };
  run(spy, records, params);

  test("views are frozen, including history, counts, summary and process", () => {
    expect(seen.length).toBeGreaterThan(0);
    for (const v of seen.slice(0, 200)) {
      expect(Object.isFrozen(v)).toBe(true);
      expect(Object.isFrozen(v.history)).toBe(true);
      expect(Object.isFrozen(v.hearingCounts)).toBe(true);
      expect(Object.isFrozen(v.lastSummary)).toBe(true);
      expect(Object.isFrozen(v.lastSummary.attendance)).toBe(true);
      if (v.process) expect(Object.isFrozen(v.process)).toBe(true);
      for (const h of v.history) expect(Object.isFrozen(h)).toBe(true);
    }
    const v = seen[0]!;
    expect(() => {
      (v as { nextPurpose: string }).nextPurpose = "JUDGEMENT";
    }).toThrow();
  });

  test("views carry only planner-visible fields", () => {
    const allowed = new Set([
      "id", "filingNumber", "filingDate", "advocateId", "partyId", "stage", "nextPurpose", "hearingCounts", "hearingsAtPurpose",
      "lastSummary", "history", "process", "externalPending", "nextDate", "firstScheduledOn", "firstHeardOn", "disposed", "disposedOn",
    ]);
    for (const v of seen) {
      for (const k of Object.keys(v)) expect(allowed.has(k)).toBe(true);
      if (v.process) expect(Object.keys(v.process).sort()).toEqual(["issuedOn", "kind", "returnedKnownOn", "round"]);
      if (v.externalPending) expect(Object.keys(v.externalPending).sort()).toEqual(["readyKnownOn", "since"]);
      for (const h of v.history) expect(Object.keys(h).sort()).toEqual(["attendance", "date", "minutes", "outcome", "reason", "type"]);
    }
    const text = JSON.stringify(seen.slice(0, 50));
    for (const latent of ["propensity", "returnDay", "readyDay", "wastedTrips", "forType"]) expect(text).not.toContain(latent);
  });

  test("a process return is known only from the working day after its latent return day", () => {
    const R = resolveParams(params, records);
    const world = buildWorld(records, records.map(caseIdOf), 7, START, R, "test");
    const w = world.find((x) => x.id === "ST/10/2021")!;
    expect(w.process).not.toBeNull();
    const ret = w.process!.returnDay;
    // the roster process has a latent issue date before the start; the view shows no date (the roster has none)
    expect(w.process!.issuedOn < START).toBe(true);
    const views = seen.filter((v) => v.id === "ST/10/2021" && v.process !== null && v.process.issuedOn === null);
    expect(views.length).toBeGreaterThan(0);
    const days = workingDays(START, END, calendar);
    views.forEach((v, i) => {
      const today = days[i]!;
      if (ret === null || ret >= today) expect(v.process!.returnedKnownOn).toBeNull();
      else {
        expect(v.process!.returnedKnownOn).toBe(nextWorkingDayAfter(ret, calendar));
        expect(v.process!.returnedKnownOn! <= today).toBe(true);
      }
    });
  });
});

describe("the day's accounting", () => {
  const params = defaultParams(ref, sample, { useCalibrated: false });
  const plans = new Map<string, DayPlan>();
  const wrapped: Policy = {
    ...calibrationPolicy,
    id: "wrapped",
    plan(ctx) {
      const p = calibrationPolicy.plan(ctx);
      plans.set(ctx.date, p);
      return p;
    },
  };
  const result = run(wrapped, sample, params, 3, "2026-11-30");

  test("every listed, desk or deferred case gets exactly one outcome per day", () => {
    for (const [date, plan] of plans) {
      const rows = result.hearings.filter((h) => h.date === date);
      const expected = [...plan.listings.map((l) => l.caseId), ...plan.desk.map((d) => d.caseId), ...plan.deferred.map((d) => d.caseId)].sort();
      expect(rows.map((r) => r.caseId).sort()).toEqual(expected);
    }
  });

  test("capacity: a hearing starts only before 420 minutes, and the rest are not reached", () => {
    for (const day of result.days) {
      const rows = result.hearings.filter((h) => h.date === day.date && h.listedOrder >= 0).sort((a, b) => a.listedOrder - b.listedOrder);
      let clock = 0;
      for (const r of rows) {
        if (r.outcome === "not_reached") expect(clock).toBeGreaterThanOrEqual(420);
        else if (r.outcome === "substantive" || r.outcome === "failed") {
          expect(clock).toBeLessThan(420);
          clock += r.minutes;
        }
      }
      expect(day.minutesUsed).toBeCloseTo(clock, 6);
      expect(day.overran).toBe(clock > 420);
      expect(day.reached).toBe(rows.filter((r) => r.outcome === "substantive" || r.outcome === "failed").length);
    }
  });

  test("failed hearings take the call minutes; disposal rows carry no next date", () => {
    for (const h of result.hearings) {
      if (h.outcome === "failed") expect(h.minutes).toBe(params.callMinutes);
      if (h.disposed) expect(h.nextDate).toBeNull();
      if (!h.disposed && h.outcome !== "court_not_sitting") expect(typeof h.nextDate).toBe("string");
    }
  });

  test("determinism: the same seed gives the same run; another seed does not", () => {
    const again = run(wrapped, sample, params, 3, "2026-11-30");
    expect(JSON.stringify(again.hearings)).toBe(JSON.stringify(result.hearings));
    const other = run(wrapped, sample, params, 4, "2026-11-30");
    expect(JSON.stringify(other.hearings)).not.toBe(JSON.stringify(result.hearings));
  });

  test("a closure day leaves every listed case not sitting and uses no minutes", () => {
    const shut = { ...params, closureProb: 1 };
    const r = run(calibrationPolicy, sample.slice(0, 30), shut, 3, "2026-10-09");
    expect(r.hearings.length).toBeGreaterThan(0);
    for (const h of r.hearings) expect(h.outcome).toBe("court_not_sitting");
    for (const d of r.days) expect(d.minutesUsed).toBe(0);
  });
});

describe("plan validation", () => {
  const records = sample.slice(0, 10);
  const params = defaultParams(ref, sample, { useCalibrated: false });

  test("a due case left out of the plan is an error", () => {
    const lazy: Policy = { ...calibrationPolicy, id: "lazy", plan: (ctx) => ({ date: ctx.date, listings: [], desk: [], deferred: [], expected: { minutes: 0, substantive: 0, overrunRisk: 0 } }) };
    expect(() => run(lazy, records, params)).toThrow(/neither listed/);
  });

  test("listing a case twice is an error", () => {
    const twice: Policy = {
      ...calibrationPolicy,
      id: "twice",
      plan(ctx) {
        const p = calibrationPolicy.plan(ctx);
        if (p.listings[0]) p.listings.push({ ...p.listings[0], order: p.listings.length });
        return p;
      },
    };
    expect(() => run(twice, records, params)).toThrow(/appears in both/);
  });

  test("a next date that is not after the hearing is an error", () => {
    const stuck: Policy = { ...calibrationPolicy, id: "stuck", nextDate: (_ctx, _c, _o, date) => date };
    expect(() => run(stuck, records, params)).toThrow(/not after the hearing date/);
  });

  test("the world, not the policy's label, decides what a deferral was", () => {
    // releases every due case a side the hearing needs said "not ready" for, and one more with the same label
    const needSaidNo = (ctx: PlanContext, c: CaseView) => {
      const a = ctx.checkins.get(c.id);
      const need = requiredRoles(c.nextPurpose);
      return !!a && ((need.some((r) => r.startsWith("complainant")) && a.complainant === "not_ready") || (need.some((r) => r.startsWith("accused")) && a.accused === "not_ready"));
    };
    const labelled = new Map<string, boolean>();
    const releasing: Policy = {
      ...calibrationPolicy,
      id: "releasing",
      asksCheckin: true,
      plan(ctx) {
        const p = calibrationPolicy.plan(ctx);
        const byId = new Map(ctx.cases.map((c) => [c.id, c]));
        const to = nextWorkingDayAfter(ctx.date, ctx.calendar);
        const released = p.listings.filter((l) => needSaidNo(ctx, byId.get(l.caseId)!));
        const bluff = p.listings.find((l) => !needSaidNo(ctx, byId.get(l.caseId)!));
        for (const l of released) labelled.set(`${ctx.date}|${l.caseId}`, true);
        if (bluff) labelled.set(`${ctx.date}|${bluff.caseId}`, false);
        const out = new Set([...released, ...(bluff ? [bluff] : [])].map((l) => l.caseId));
        return { ...p, listings: p.listings.filter((l) => !out.has(l.caseId)), deferred: [...out].map((caseId) => ({ caseId, to, reason: "released at check-in" })) };
      },
    };
    const r = run(releasing, sample, params);
    let honest = 0;
    let bluffs = 0;
    for (const h of r.hearings) {
      const k = labelled.get(`${h.date}|${h.caseId}`);
      if (k === undefined || h.outcome === "court_not_sitting") continue;
      if (k) {
        expect(h.outcome).toBe("vacated");
        honest++;
      } else {
        expect(h.outcome).toBe("deferred");
        bluffs++;
      }
    }
    expect(honest).toBeGreaterThan(0);
    expect(bluffs).toBeGreaterThan(0);
    expect(r.days.reduce((s, d) => s + d.vacated, 0)).toBe(r.hearings.filter((h) => h.outcome === "vacated").length);
    // without a check-in nothing is vacated, whatever the label
    const noCheckin = run({ ...releasing, id: "no-checkin", asksCheckin: false }, sample, params);
    expect(noCheckin.hearings.filter((h) => h.outcome === "vacated").length).toBe(0);
  });

  test("a desk row with nothing known to be out is logged as deferred", () => {
    const desky: Policy = {
      ...calibrationPolicy,
      id: "desky",
      plan(ctx) {
        const p = calibrationPolicy.plan(ctx);
        return { ...p, listings: [], desk: p.listings.map((l) => ({ caseId: l.caseId, action: "await_return" as const, note: "" })) };
      },
    };
    const r = run(desky, records, params);
    const rows = r.hearings.filter((h) => h.outcome === "desk" || h.outcome === "deferred");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((h) => h.outcome === "deferred")).toBe(true);
    expect(r.days.reduce((s, d) => s + d.desk, 0)).toBe(r.hearings.filter((h) => h.outcome === "desk").length);
  });
});

describe("calibration", () => {
  test("a small fit lands within tolerance of PUCAR's tables", () => {
    const all = loadRoster(resolve(import.meta.dir, "../data/roster_3000_seed42.csv"));
    const records = all.filter((_, i) => i % 6 === 0);
    const { params, fit } = calibrate({ records, ref, calendar, seeds: [1, 2, 3], iterations: 5 });
    expect(fit.meanPSubError).toBeLessThan(0.03);
    for (const t of HEARING_TYPES) {
      const f = fit.perType[t];
      if (f.reached >= 400) expect(f.pSubError).toBeLessThan(0.05);
    }
    for (const t of HEARING_TYPES) for (const v of Object.values(params.perType[t]!)) expect(Number.isFinite(v)).toBe(true);
    // the JUDGEMENT conflict is reported, and the default follows the observed hearings per case
    expect(fit.notes.join(" ")).toContain("JUDGEMENT");
    expect(targetsFor(ref).JUDGEMENT.pSub).toBeCloseTo(1 / ref.JUDGEMENT.hearingsPerCase.mean, 6);
    expect(targetsFor(ref, "table").JUDGEMENT.pSub).toBe(1);
  }, 60000);
});

// ---------------------------------------------------------------------------------------------
// Review fixes: what the court knows, the check-in, the world's labels, keys, routes

describe("what the court knows at the start", () => {
  // no process recorded in the summary, but the court's residual share says process is out for appearance
  const recs = [record("ST/20/2021", "APPEARANCE", "Present: Complainant's Advocate\nAbsent: Accused\nFor appearance of the accused.")];
  const params = frictionless();
  params.perType.APPEARANCE = { ...params.perType.APPEARANCE, procP: 1, procScale: 20 };
  const views: CaseView[] = [];
  const spy = toyPolicy("spy", (ctx) => {
    views.push(ctx.cases[0]!);
    return ctx.cases.filter((c) => !c.disposed && c.nextDate !== null && c.nextDate <= ctx.date).map((c) => ({ id: c.id }));
  });
  const r = run(spy, recs, params);

  test("unrecorded start-of-horizon process is hidden until a hearing fails for it", () => {
    expect(views[0]!.process).toBeNull();
    const first = r.hearings.find((h) => h.outcome === "failed" && h.reason === "awaiting_process")!;
    expect(first).toBeDefined();
    for (const v of views) if (v.history.every((h) => h.reason !== "awaiting_process")) expect(v.process).toBeNull();
    const after = views.find((v) => v.history.some((h) => h.reason === "awaiting_process"))!;
    expect(after.process).not.toBeNull();
    // issued before the horizon: the roster does not date it
    expect(after.process!.issuedOn).toBeNull();
  });

  test("a recorded mediation referral is a known pending report with no date", () => {
    const med = [record("ST/21/2021", "EVIDENCE_COMPLAINANT", "Present: Complainant, Accused\nReferred for mediation. For the appearance of the parties.")];
    const seen: CaseView[] = [];
    run(toyPolicy("spy", (ctx) => (seen.push(ctx.cases[0]!), [])), med, frictionless(), 7, "2026-10-02");
    expect(seen[0]!.externalPending).not.toBeNull();
    expect(seen[0]!.externalPending!.since).toBeNull();
  });

  test("process the court issues in the horizon carries its date", () => {
    const p = frictionless();
    const c = [record("ST/22/2021", "COGNIZANCE", PRESENT_ALL)];
    const seen: CaseView[] = [];
    const res = run(toyPolicy("spy", (ctx) => (seen.push(ctx.cases[0]!), ctx.date === START ? [{ id: "ST/22/2021" }] : [])), c, p);
    expect(res.hearings[0]!.outcome).toBe("substantive");
    const later = seen.find((v) => v.process !== null)!;
    expect(later.process!.issuedOn).toBe(START);
  });
});

describe("the check-in is evidence, not an oracle", () => {
  test("some 'not ready' answers come from sides that would have gone ahead, and some failures were not foreseen", () => {
    const params = defaultParams(ref, sample);
    params.behaviour = { ...params.behaviour, checkinHonesty: 1 };
    params.latent = { ...params.latent!, checkinResponse: 1 };
    const R = resolveParams(params, sample);
    const world = buildWorld(sample, sample.map(caseIdOf), 11, START, R, "t");
    let falseAlarm = 0;
    let unforeseen = 0;
    let notReady = 0;
    for (const date of workingDays(START, "2026-11-30", calendar)) {
      for (const w of world) {
        const a = checkinAnswers(11, w, w.nextPurpose, date, R);
        const res = resolveHearing(11, w, w.nextPurpose, date, { slot: false, reminder: true, standby: false }, R, ref);
        const need = requiredRoles(w.nextPurpose);
        const said = (need.some((r) => r.startsWith("complainant")) && a.complainant === "not_ready") || (need.some((r) => r.startsWith("accused")) && a.accused === "not_ready");
        const sideFail = res.outcome === "failed" && ["respondent_absent", "petitioner_absent", "both_absent", "not_ready", "sought_time"].includes(res.reason!);
        if (said) notReady++;
        if (said && res.outcome === "substantive") falseAlarm++;
        if (!said && a.complainant === "ready" && a.accused === "ready" && sideFail) unforeseen++;
      }
    }
    expect(notReady).toBeGreaterThan(0);
    expect(falseAlarm).toBeGreaterThan(0);
    expect(unforeseen).toBeGreaterThan(0);
  });
});

describe("keys", () => {
  test("the abscond draw is a trait of the case: every warrant for an absconding accused stays out", () => {
    const params = defaultParams(ref, sample);
    params.abscondShare = 0.5;
    const R = resolveParams(params, sample);
    let seenAbscond = 0;
    for (let i = 0; i < 40; i++) {
      const key = `t|ST/${i}/2020`;
      const a = drawProcess(3, key, "warrant_nonbailable", "WARRANT", START, 0, R);
      const b = drawProcess(3, key, "warrant_nonbailable", "WARRANT", START, 5, R);
      expect(a.returnDay === null).toBe(b.returnDay === null);
      expect(a.returnDay === null).toBe(absconds(3, key, R));
      if (a.returnDay === null) seenAbscond++;
    }
    expect(seenAbscond).toBeGreaterThan(0);
  });

  test("the roster id is part of every case's key", () => {
    const params = defaultParams(ref, sample);
    const p = toyPolicy("all", (ctx) => ctx.cases.filter((c) => !c.disposed && c.nextDate !== null && c.nextDate <= ctx.date).map((c) => ({ id: c.id })));
    const a = simulate({ records: sample, rosterId: "A", policy: p, config: CALIBRATION_CONFIG, ref, calendar, worldSeed: 5, start: START, end: "2026-10-09", params, scorecards: false });
    const b = simulate({ records: sample, rosterId: "B", policy: p, config: CALIBRATION_CONFIG, ref, calendar, worldSeed: 5, start: START, end: "2026-10-09", params, scorecards: false });
    expect(JSON.stringify(a.hearings)).not.toBe(JSON.stringify(b.hearings));
  });
});

describe("outcomes the world classifies", () => {
  const listAll = (id: string) => toyPolicy(id, (ctx) => ctx.cases.filter((c) => !c.disposed && c.nextDate !== null && c.nextDate <= ctx.date).map((c) => ({ id: c.id })));

  test("an absence after service moving APPEARANCE to WARRANT counts as substantive", () => {
    const params = frictionless();
    params.perType.APPEARANCE = { ...params.perType.APPEARANCE, absA: 5 };
    params.pWarrantOnAbsence = 1;
    params.disposal = { acquittalOnDefault: 0, dismissalForSteps: 0, compoundingHazard: 0, lpSplit: 0, lpAfterWarrantHearings: 99 };
    const recs = Array.from({ length: 20 }, (_, i) => record(`ST/${30 + i}/2021`, "APPEARANCE", "Present: Complainant's Advocate\nAbsent: Accused\nSummons served on accused."));
    const r = run(listAll("all"), recs, params, 7, START);
    const moved = r.hearings.filter((h) => h.movedBy === "respondent_absent");
    expect(moved.length).toBeGreaterThan(0);
    for (const h of moved) {
      expect(h.outcome).toBe("substantive");
      expect(h.reason).toBeNull();
      expect(h.attendance!.accused).toBe(false);
    }
  });

  test("disposal routes: default acquittal, compounding, each switchable, each logged", () => {
    const warned = "Present: Complainant's Advocate, Accused\nAbsent: Complainant\nComplainant continuously absent. Last chance.";
    const recs = Array.from({ length: 20 }, (_, i) => record(`ST/${60 + i}/2021`, "EVIDENCE_COMPLAINANT", warned));
    const params = frictionless();
    params.perType.EVIDENCE_COMPLAINANT = { ...params.perType.EVIDENCE_COMPLAINANT, absC: 5 };
    params.disposal = { acquittalOnDefault: 1, dismissalForSteps: 0, compoundingHazard: 0, lpSplit: 0, lpAfterWarrantHearings: 99 };
    const on = run(listAll("on"), recs, params, 7, START);
    const acq = on.hearings.filter((h) => h.disposalRoute === "acquitted_default");
    expect(acq.length).toBeGreaterThan(0);
    for (const h of acq) expect(h).toMatchObject({ outcome: "substantive", disposed: true, movedBy: "petitioner_absent" });
    const off = run(listAll("off"), recs, { ...params, disposal: { ...params.disposal, acquittalOnDefault: 0 } }, 7, START);
    expect(off.hearings.some((h) => h.disposalRoute === "acquitted_default")).toBe(false);

    const both = frictionless();
    both.disposal = { acquittalOnDefault: 0, dismissalForSteps: 0, compoundingHazard: 1, lpSplit: 0, lpAfterWarrantHearings: 99 };
    const comp = run(listAll("comp"), [record("ST/90/2021", "ARGUMENTS", PRESENT_ALL)], both, 7, START);
    expect(comp.hearings[0]).toMatchObject({ outcome: "substantive", disposed: true, disposalRoute: "compounded" });
  });

  test("every disposing row names its route; reached rows carry their start minute; unreached rows log attendance", () => {
    const params = defaultParams(ref, sample, { useCalibrated: false });
    const r = run(calibrationPolicy, sample, params, 3, "2026-12-15");
    for (const h of r.hearings) if (h.disposed) expect(typeof h.disposalRoute).toBe("string");
    for (const d of r.days) {
      const rows = r.hearings.filter((h) => h.date === d.date && (h.outcome === "substantive" || h.outcome === "failed")).sort((a, b) => a.listedOrder - b.listedOrder);
      let clock = 0;
      for (const h of rows) {
        expect(h.startMinute).toBeCloseTo(clock, 6);
        clock += h.minutes;
      }
    }
    const crowded = run(toyPolicy("crowd", (ctx) => ctx.cases.filter((c) => !c.disposed && c.nextDate !== null && c.nextDate <= ctx.date).map((c) => ({ id: c.id }))), sample, frictionless(), 3, START);
    const unreached = crowded.hearings.filter((h) => h.outcome === "not_reached");
    for (const h of unreached) expect(h.attendance).not.toBeNull();
  });
});

describe("desk re-issue (DRISTI prepaid service rounds)", () => {
  // a warrant case whose warrant is out; the policy re-issues at the desk every day it is due
  const recs = Array.from({ length: 30 }, (_, i) => record(`ST/${100 + i}/2021`, "WARRANT", "Present: Complainant's Advocate\nAbsent: Accused\nIssue NBW to accused. For return of warrant."));
  const views = new Map<string, CaseView[]>();
  const reissuing: Policy = {
    id: "reissuing",
    name: "reissuing",
    description: "test",
    asksCheckin: false,
    initialDates: (ctx) => new Map(ctx.cases.map((c) => [c.id, ctx.date])),
    plan(ctx) {
      const due = ctx.cases.filter((c) => !c.disposed && c.nextDate !== null && c.nextDate <= ctx.date);
      for (const c of due) views.set(c.id, [...(views.get(c.id) ?? []), c]);
      const out = due.filter((c) => c.process && c.process.returnedKnownOn === null);
      const listed = due.filter((c) => !out.includes(c));
      return {
        date: ctx.date,
        listings: listed.map((c, i) => ({ caseId: c.id, type: c.nextPurpose, order: i, callTime: null, window: null, standby: false, expectedMinutes: 5, pSubstantive: 0.5, why: [] })),
        desk: out.map((c) => ({ caseId: c.id, action: "reissue" as const, note: "" })),
        deferred: [],
        expected: { minutes: 0, substantive: 0, overrunRisk: 0 },
      };
    },
    nextDate: (ctx, _c, _o, date) => nextWorkingDayOnOrAfter(addDays(date, 7), ctx.calendar),
  };
  const params = frictionless();
  params.abscondShare = 0.3;
  params.disposal = { acquittalOnDefault: 0, dismissalForSteps: 0, compoundingHazard: 0, lpSplit: 0, lpAfterWarrantHearings: 99 };

  test("each re-issue is a new round the court can see, and the run is reproducible", () => {
    const a = run(reissuing, recs, params, 9, "2026-12-15");
    views.clear();
    const b = run(reissuing, recs, params, 9, "2026-12-15");
    expect(JSON.stringify(b.hearings)).toBe(JSON.stringify(a.hearings));
    const rounds = [...views.values()].flatMap((vs) => vs.map((v) => v.process?.round ?? 0));
    expect(Math.max(...rounds)).toBeGreaterThan(1);
    for (const vs of views.values()) for (let i = 1; i < vs.length; i++) expect((vs[i]!.process?.round ?? 0) >= (vs[i - 1]!.process?.round ?? 0) || vs[i]!.process === null).toBe(true);
  });

  test("an absconding accused stays unexecutable whatever the rounds; others come back", () => {
    const R = resolveParams(params, recs);
    const world = buildWorld(recs, recs.map(caseIdOf), 9, START, R, "test");
    const heard = run(reissuing, recs, params, 9, "2026-12-15");
    let absconders = 0;
    for (const w of world) {
      const produced = heard.hearings.some((h) => h.caseId === w.id && h.outcome === "substantive");
      if (absconds(9, w.key, R)) {
        absconders++;
        expect(produced).toBe(false);
      }
    }
    expect(absconders).toBeGreaterThan(0);
    expect(heard.hearings.some((h) => h.outcome === "substantive")).toBe(true);
  });

  test("rounds beyond the prepaid ones wait for payment", () => {
    const R = resolveParams(params, recs);
    const prepaid = drawProcess(9, "k", "warrant_nonbailable", "PLEA", START, 5, R, false, true, 0);
    const unpaid = drawProcess(9, "k", "warrant_nonbailable", "PLEA", START, 5, R, false, true, R.latent.unpaidRoundDelayDays);
    expect(R.latent.prepaidRounds).toEqual({ summons: 4, notice: 1, warrant: 4 });
    expect(R.latent.unpaidRoundDelayDays).toBe(14);
    expect(addDays(prepaid.returnDay!, 14)).toBe(unpaid.returnDay!);
  });
});
