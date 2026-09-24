import { describe, expect, test } from "bun:test";
import { Rng } from "../src/domain/rng";
import { clusterByAdvocate, greedyKnapsack, solveKnapsack, type KnapsackItem } from "../src/planner/knapsack";

// ---------------------------------------------------------------------------------------------
// Knapsack: exact against brute force

function randomInstance(rng: Rng, n: number): { items: KnapsackItem[]; capacity: number } {
  const items: KnapsackItem[] = [];
  for (let i = 0; i < n; i++) {
    items.push({
      id: `c${i}`,
      minutes: rng.int(0, 40),
      // a few non-positive values, as a low-chance matter with trip costs can have
      value: rng.chance(0.1) ? -rng.uniform(0, 1) : rng.uniform(0, 10),
      old: rng.chance(0.35),
      advocate: `a${rng.int(0, 4)}`,
    });
  }
  return { items, capacity: rng.int(5, 120) };
}

/** every subset: the unconstrained optimum and the optimum subject to old minutes >= target */
function brute(items: KnapsackItem[], capacity: number, floorMinutes: number) {
  let best = 0;
  let bestFloor = -Infinity;
  let maxOld = 0;
  const n = items.length;
  for (let mask = 0; mask < 1 << n; mask++) {
    let m = 0;
    let v = 0;
    let old = 0;
    for (let i = 0; i < n; i++) {
      if (!(mask & (1 << i))) continue;
      const it = items[i]!;
      const w = Math.max(0, Math.round(it.minutes));
      m += w;
      v += it.value;
      if (it.old) old += w;
    }
    if (m > capacity) continue;
    if (v > best) best = v;
    if (old > maxOld) maxOld = old;
  }
  const target = Math.min(floorMinutes, maxOld);
  for (let mask = 0; mask < 1 << n; mask++) {
    let m = 0;
    let v = 0;
    let old = 0;
    for (let i = 0; i < n; i++) {
      if (!(mask & (1 << i))) continue;
      const it = items[i]!;
      const w = Math.max(0, Math.round(it.minutes));
      m += w;
      v += it.value;
      if (it.old) old += w;
    }
    if (m <= capacity && old >= target && v > bestFloor) bestFloor = v;
  }
  return { best, bestFloor, target, maxOld };
}

const oldMinutes = (items: KnapsackItem[], ids: string[]) =>
  ids.reduce((s, id) => {
    const it = items.find((x) => x.id === id)!;
    return s + (it.old ? Math.round(it.minutes) : 0);
  }, 0);

describe("knapsack", () => {
  test("exact DP equals brute force on 200 random small instances", () => {
    const rng = new Rng(20260924);
    for (let k = 0; k < 200; k++) {
      const { items, capacity } = randomInstance(rng, rng.int(1, 12));
      const exact = solveKnapsack(items, capacity);
      const b = brute(items, capacity, 0);
      expect(exact.value).toBeCloseTo(b.best, 9);
      expect(exact.minutes).toBeLessThanOrEqual(capacity);
      // the reported value is the sum over the reported choice
      const sum = exact.chosen.reduce((s, id) => s + items.find((x) => x.id === id)!.value, 0);
      expect(sum).toBeCloseTo(exact.value, 9);
    }
  });

  test("greedy never beats exact, with or without the floor", () => {
    const rng = new Rng(7);
    let strictlyWorse = 0;
    for (let k = 0; k < 200; k++) {
      const { items, capacity } = randomInstance(rng, rng.int(1, 12));
      const exact = solveKnapsack(items, capacity);
      const greedy = greedyKnapsack(items, capacity);
      expect(greedy.value).toBeLessThanOrEqual(exact.value + 1e-9);
      expect(greedy.minutes).toBeLessThanOrEqual(capacity);
      if (greedy.value < exact.value - 1e-9) strictlyWorse++;
      // with the floor, greedy is compared with the brute-force constrained optimum
      const b = brute(items, capacity, 0.3 * capacity);
      const gf = greedyKnapsack(items, capacity, { floorShare: 0.3 });
      if (oldMinutes(items, gf.chosen) >= b.target) expect(gf.value).toBeLessThanOrEqual(b.bestFloor + 1e-9);
    }
    // the instances are hard enough that exactness matters somewhere
    expect(strictlyWorse).toBeGreaterThan(0);
  });

  test("fairness floor holds whenever it is feasible, and never costs more than the true constrained optimum", () => {
    const rng = new Rng(42);
    for (let k = 0; k < 200; k++) {
      const { items, capacity } = randomInstance(rng, rng.int(1, 12));
      const share = rng.uniform(0.15, 0.6);
      const res = solveKnapsack(items, capacity, { floorShare: share });
      const b = brute(items, capacity, share * capacity);
      expect(res.minutes).toBeLessThanOrEqual(capacity);
      // floor met, or (when not reachable) as many old minutes as can fit
      expect(oldMinutes(items, res.chosen)).toBeGreaterThanOrEqual(b.target);
      // a feasible answer cannot beat the constrained optimum; the Lagrangian gap is small in practice
      expect(res.value).toBeLessThanOrEqual(b.bestFloor + 1e-9);
      expect(res.lambda).toBeGreaterThanOrEqual(0);
    }
  });

  test("a floor that already holds leaves the answer unchanged (lambda 0)", () => {
    const items: KnapsackItem[] = [
      { id: "a", minutes: 10, value: 5, old: true },
      { id: "b", minutes: 10, value: 4, old: false },
    ];
    const r = solveKnapsack(items, 20, { floorShare: 0.2 });
    expect(r.lambda).toBe(0);
    expect(r.chosen).toEqual(["a", "b"]);
  });

  test("the floor pulls an old matter in over a better young one", () => {
    const items: KnapsackItem[] = [
      { id: "young", minutes: 10, value: 10, old: false },
      { id: "old", minutes: 10, value: 3, old: true },
    ];
    expect(solveKnapsack(items, 10).chosen).toEqual(["young"]);
    const r = solveKnapsack(items, 10, { floorShare: 0.5 });
    expect(r.chosen).toEqual(["old"]);
    expect(r.lambda).toBeGreaterThan(0);
  });

  test("zero-minute and oversized items", () => {
    const items: KnapsackItem[] = [
      { id: "free", minutes: 0, value: 1, old: false },
      { id: "huge", minutes: 500, value: 100, old: false },
      { id: "neg", minutes: 1, value: -1, old: false },
    ];
    const r = solveKnapsack(items, 420);
    expect(r.chosen).toEqual(["free"]);
  });

  test("advocate clustering saves trips within the value budget and keeps capacity and the floor", () => {
    const items: KnapsackItem[] = [
      { id: "x1", minutes: 10, value: 5, old: false, advocate: "A" },
      { id: "x2", minutes: 10, value: 4.95, old: false, advocate: "B" },
      { id: "x3", minutes: 10, value: 4.9, old: true, advocate: "A" },
      { id: "x4", minutes: 10, value: 5.1, old: true, advocate: "C" },
    ];
    const base = solveKnapsack(items, 30, { floorShare: 0.3 });
    const c = clusterByAdvocate(items, base.chosen, 30, { floorShare: 0.3, epsilon: 0.02 });
    expect(c.advocatesAfter).toBeLessThanOrEqual(c.advocatesBefore);
    expect(c.minutes).toBeLessThanOrEqual(30);
    expect(c.value).toBeGreaterThanOrEqual(base.value * 0.98 - 1e-9);
    expect(oldMinutes(items, c.chosen)).toBeGreaterThanOrEqual(9);
    // determinism
    expect(clusterByAdvocate(items, base.chosen, 30, { floorShare: 0.3, epsilon: 0.02 })).toEqual(c);
  });

  test("a day-sized instance solves quickly", () => {
    const rng = new Rng(1);
    const items: KnapsackItem[] = [];
    for (let i = 0; i < 400; i++)
      items.push({ id: `c${i}`, minutes: rng.int(2, 30), value: rng.uniform(0, 3), old: rng.chance(0.2), advocate: `a${rng.int(0, 80)}` });
    const t0 = performance.now();
    const r = solveKnapsack(items, 400, { floorShare: 0.25 });
    expect(performance.now() - t0).toBeLessThan(2000);
    expect(r.minutes).toBeLessThanOrEqual(400);
    expect(greedyKnapsack(items, 400, { floorShare: 0.25 }).value).toBeLessThanOrEqual(r.value + 1e-9);
  });
});

// ---------------------------------------------------------------------------------------------
// Policies on a hand-built day

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { addDays, isWorkingDay, loadCalendar } from "../src/data/calendar";
import { loadRefTables } from "../src/data/reference";
import { loadRoster, caseIdOf } from "../src/data/roster";
import { initialState } from "../src/domain/lifecycle";
import type {
  CaseView,
  CheckinAnswer,
  DayPlan,
  HearingType,
  JudgeConfig,
  ObservedHearing,
  Outcome,
  ParsedSummary,
  PlanContext,
  Role,
  SequentialType,
} from "../src/domain/types";
import { HEARING_TYPES } from "../src/domain/types";
import { POLICIES, POLICY_IDS, defaultConfig } from "../src/planner/index";
import { predictSubstantive, populationStats } from "../src/planner/predict";
import type { BenchtimeDayPlan } from "../src/planner/benchtime";

const REF = loadRefTables();
const CAL = loadCalendar();
const DAY = "2026-10-06"; // a Tuesday
const PLANNER_DIR = join(import.meta.dir, "..", "src", "planner");

function summary(over: Partial<ParsedSummary> = {}): ParsedSummary {
  return {
    raw: "",
    attendance: { complainant: null, complainantAdvocate: null, accused: null, accusedAdvocate: null },
    notes: [],
    process: null,
    lastChance: false,
    mediation: false,
    forJudgment: false,
    judgmentPronounced: null,
    witnessToAttend: false,
    accusedToAppear: false,
    complainantToAppear: false,
    objectionsPending: false,
    tags: [],
    ...over,
  };
}

const zeroCounts = (): Record<HearingType, number> => Object.fromEntries(HEARING_TYPES.map((t) => [t, 0])) as Record<HearingType, number>;

function view(id: string, over: Partial<CaseView> = {}): CaseView {
  const purpose = (over.nextPurpose ?? "APPEARANCE") as HearingType;
  return {
    id,
    filingNumber: `F-${id}`,
    filingDate: "2023-05-01",
    advocateId: "ADV-1",
    partyId: `P-${id}`,
    stage: (over.stage ?? (purpose === "BAIL" || purpose === "REPORTS" || purpose === "APPLICATION_REVIEW" ? "APPEARANCE" : purpose)) as SequentialType,
    nextPurpose: purpose,
    hearingCounts: zeroCounts(),
    hearingsAtPurpose: 1,
    lastSummary: summary(),
    history: [],
    process: null,
    externalPending: null,
    nextDate: DAY,
    firstScheduledOn: null,
    firstHeardOn: null,
    disposed: false,
    disposedOn: null,
    ...over,
  };
}

const PURPOSES: HearingType[] = [
  "ADMISSION",
  "APPEARANCE",
  "WARRANT",
  "PLEA",
  "EXAMINATION_UNDER_S351_BNSS",
  "EVIDENCE_COMPLAINANT",
  "EVIDENCE_ACCUSED",
  "ARGUMENTS",
  "JUDGEMENT",
  "BAIL",
];

/** 80 due cases of every kind, plus process-pending, report-pending, post-judgment, disposed and not-due ones */
function syntheticCases(): CaseView[] {
  const rng = new Rng(138);
  const cases: CaseView[] = [];
  for (let i = 0; i < 80; i++) {
    const purpose = PURPOSES[i % PURPOSES.length]!;
    const year = 2016 + (i % 11);
    const present = rng.chance(0.7);
    cases.push(
      view(`ST/${i}/${year}`, {
        nextPurpose: purpose,
        filingDate: `${year}-0${1 + (i % 9)}-15`,
        advocateId: `ADV-${i % 17}`,
        hearingsAtPurpose: 1 + (i % 6),
        lastSummary: summary({
          attendance: { complainant: present, complainantAdvocate: true, accused: rng.chance(0.6), accusedAdvocate: rng.chance(0.8) },
          lastChance: i % 13 === 0,
        }),
      }),
    );
  }
  // warrant out and not known returned: must never be called by benchtime
  cases.push(view("PEND/1", { nextPurpose: "WARRANT", process: { kind: "warrant_nonbailable", issuedOn: "2026-09-20", returnedKnownOn: null } }));
  cases.push(view("PEND/2", { nextPurpose: "APPEARANCE", process: { kind: "summons", issuedOn: "2026-06-01", returnedKnownOn: null } }));
  // returned yesterday: listable
  cases.push(view("BACK/1", { nextPurpose: "APPEARANCE", process: { kind: "summons", issuedOn: "2026-09-10", returnedKnownOn: "2026-10-05" } }));
  // returned, but the court only learns tomorrow
  cases.push(view("PEND/3", { nextPurpose: "WARRANT", process: { kind: "warrant", issuedOn: "2026-09-01", returnedKnownOn: "2026-10-07" } }));
  // mediation report awaited
  cases.push(view("MED/1", { nextPurpose: "REPORTS", externalPending: { since: "2026-09-15", readyKnownOn: null } }));
  // post-judgment application
  cases.push(
    view("POST/1", { stage: "JUDGEMENT", nextPurpose: "APPLICATION_REVIEW", filingDate: "2017-02-01", lastSummary: summary({ judgmentPronounced: "convicted" }) }),
  );
  // check-in: accused says not ready for an appearance (required) and for an admission (not required)
  cases.push(view("CHK/1", { nextPurpose: "APPEARANCE" }));
  cases.push(view("CHK/2", { nextPurpose: "ADMISSION" }));
  // not due, disposed
  cases.push(view("LATER/1", { nextDate: "2026-11-02" }));
  cases.push(view("DONE/1", { disposed: true, disposedOn: "2026-10-01" }));
  return cases;
}

function ctxFor(policyId: string, cases = syntheticCases(), date = DAY, config?: Partial<JudgeConfig>): PlanContext {
  const checkins = new Map<string, { complainant: CheckinAnswer; accused: CheckinAnswer }>([
    ["CHK/1", { complainant: "ready", accused: "not_ready" }],
    ["CHK/2", { complainant: "ready", accused: "not_ready" }],
  ]);
  return { date, capacityMinutes: 420, cases, ref: REF, calendar: CAL, checkins, config: { ...defaultConfig(policyId), ...config } };
}

function checkPlan(ctx: PlanContext, plan: DayPlan): void {
  const due = ctx.cases.filter((c) => !c.disposed && c.nextDate !== null && c.nextDate <= ctx.date).map((c) => c.id);
  const seen = new Map<string, number>();
  for (const id of [...plan.listings.map((l) => l.caseId), ...plan.desk.map((d) => d.caseId), ...plan.deferred.map((d) => d.caseId)])
    seen.set(id, (seen.get(id) ?? 0) + 1);
  for (const id of due) expect({ id, n: seen.get(id) ?? 0 }).toEqual({ id, n: 1 });
  const live = new Set(ctx.cases.filter((c) => !c.disposed).map((c) => c.id));
  for (const id of seen.keys()) expect(live.has(id)).toBe(true);
  plan.listings.forEach((l, i) => expect(l.order).toBe(i));
  for (const d of plan.deferred) {
    expect(d.to > ctx.date).toBe(true);
    expect(isWorkingDay(d.to, ctx.calendar)).toBe(true);
  }
  expect(plan.date).toBe(ctx.date);
}

describe("planner never sees the world", () => {
  test("no file under src/planner imports src/world", () => {
    // recurse: sub-folders such as src/planner/zoo are planners too
    for (const f of (readdirSync(PLANNER_DIR, { recursive: true }) as string[]).filter((x) => x.endsWith(".ts"))) {
      const text = readFileSync(join(PLANNER_DIR, f), "utf8");
      expect({ f, hit: /from\s+["'][^"']*world[^"']*["']|import\(\s*["'][^"']*world/.test(text) }).toEqual({ f, hit: false });
    }
  });
});

describe("policies", () => {
  test("all nine policies are registered with configs", () => {
    expect(Object.keys(POLICIES).sort()).toEqual([...POLICY_IDS].sort());
    for (const id of POLICY_IDS) {
      expect(POLICIES[id]!().id).toBe(id);
      expect(defaultConfig(id).ageingFloor).toBeGreaterThanOrEqual(0.15);
    }
    // the floor cannot be lowered
    expect(defaultConfig("joshi").ageingFloor).toBe(0.15);
  });

  for (const id of POLICY_IDS) {
    test(`${id}: a valid plan covering every due case exactly once`, () => {
      const ctx = ctxFor(id);
      checkPlan(ctx, POLICIES[id]!().plan(ctx));
    });
  }

  test("every next date is a working day strictly after the hearing, for every outcome", () => {
    const outcomes: Outcome[] = ["substantive", "failed", "not_reached", "vacated", "desk", "deferred", "court_not_sitting"];
    for (const id of POLICY_IDS) {
      const policy = POLICIES[id]!();
      const ctx = ctxFor(id);
      policy.plan(ctx);
      for (const c of ctx.cases.filter((x) => !x.disposed))
        for (const o of outcomes)
          for (const date of [DAY, "2026-10-30", "2026-12-24"]) {
            const d = policy.nextDate({ ...ctx, date }, c, o, date);
            expect({ id, o, ok: d > date && isWorkingDay(d, CAL) }).toEqual({ id, o, ok: true });
          }
    }
  });

  test("initial dates: every live case gets a working day on or after the start", () => {
    const start = "2026-10-01";
    for (const id of POLICY_IDS) {
      const cases = syntheticCases().map((c) => ({ ...c, nextDate: null }));
      const ctx = ctxFor(id, cases, start);
      const m = POLICIES[id]!().initialDates(ctx);
      for (const c of cases.filter((x) => !x.disposed)) {
        const d = m.get(c.id);
        expect({ id, c: c.id, ok: !!d && d >= start && isWorkingDay(d, CAL) }).toEqual({ id, c: c.id, ok: true });
      }
    }
  });

  test("determinism: fresh instances give identical plans and next dates", () => {
    for (const id of POLICY_IDS) {
      const a = POLICIES[id]!().plan(ctxFor(id));
      const b = POLICIES[id]!().plan(ctxFor(id));
      expect(a).toEqual(b);
    }
  });

  test("status quo lists every due case; capped policies stay within capacity", () => {
    const ctx = ctxFor("status_quo_60");
    const due = ctx.cases.filter((c) => !c.disposed && c.nextDate !== null && c.nextDate <= DAY).length;
    expect(POLICIES.status_quo_60!().plan(ctx).listings.length).toBe(due);
    for (const id of ["fifo_capped", "bin_packing", "oldest_first", "joshi", "dimakar"]) {
      const p = POLICIES[id]!().plan(ctxFor(id));
      expect(p.expected.minutes).toBeLessThanOrEqual(420 + 30); // one matter may straddle the cap
    }
  });
});

describe("benchtime", () => {
  const ctx = ctxFor("benchtime");
  const plan = POLICIES.benchtime!().plan(ctx) as BenchtimeDayPlan;
  const listed = new Set(plan.listings.map((l) => l.caseId));

  test("never lists a case whose process is out and not known returned; puts it on the desk", () => {
    for (const c of ctx.cases) {
      if (c.process && (c.process.returnedKnownOn === null || c.process.returnedKnownOn > DAY)) {
        expect(listed.has(c.id)).toBe(false);
        if (c.nextDate! <= DAY) expect(plan.desk.some((d) => d.caseId === c.id)).toBe(true);
      }
    }
    expect(plan.desk.find((d) => d.caseId === "PEND/2")!.action).toBe("reissue"); // four months out
    expect(plan.desk.find((d) => d.caseId === "PEND/1")!.action).toBe("await_return");
    expect(plan.desk.find((d) => d.caseId === "MED/1")!.action).toBe("await_report");
    expect(listed.has("BACK/1") || plan.deferred.some((d) => d.caseId === "BACK/1")).toBe(true);
  });

  test("a not-ready answer releases the slot only when that side is required", () => {
    expect(plan.deferred.find((d) => d.caseId === "CHK/1")?.reason).toBe("released at check-in");
    expect(plan.deferred.find((d) => d.caseId === "CHK/2")?.reason).not.toBe("released at check-in");
  });

  test("the day is filled to the target, the floor holds, standby exists, times are given", () => {
    const main = plan.listings.filter((l) => !l.standby);
    const sum = main.reduce((s, l) => s + Math.round(l.expectedMinutes), 0);
    expect(sum).toBeLessThanOrEqual(Math.floor(0.95 * 420) + main.length); // rounding per item
    const oldMin = main.filter((l) => ctx.cases.find((c) => c.id === l.caseId)!.filingDate < "2022-10-06").reduce((s, l) => s + l.expectedMinutes, 0);
    expect(oldMin).toBeGreaterThanOrEqual(0.15 * 0.95 * 420 - main.length);
    expect(plan.listings.some((l) => l.standby)).toBe(true);
    for (const l of main) {
      expect(l.callTime).toMatch(/^\d\d:\d\d$/);
      expect(l.why.length).toBeGreaterThan(0);
    }
    // call times never go backwards
    const times = main.map((l) => l.callTime!);
    expect([...times].sort()).toEqual(times);
    expect(plan.optimiser!.exactValue).toBeGreaterThanOrEqual(plan.optimiser!.greedyValue - 1e-9);
  });

  test("P(substantive) moves with the court's records only", () => {
    const stats = populationStats(ctx.cases);
    const prior = REF.WARRANT.pSubstantive;
    const back = predictSubstantive(view("W1", { nextPurpose: "WARRANT", process: { kind: "warrant", issuedOn: "2026-09-01", returnedKnownOn: "2026-10-01" } }), REF, DAY, stats);
    const out = predictSubstantive(view("W2", { nextPurpose: "WARRANT", process: { kind: "warrant", issuedOn: "2026-09-01", returnedKnownOn: null } }), REF, DAY, stats);
    expect(back.p).toBeGreaterThan(prior);
    expect(out.p).toBeLessThan(prior);
    const absent: ObservedHearing[] = [1, 2, 3, 4].map((k) => ({
      date: `2026-09-0${k}`,
      type: "APPEARANCE" as HearingType,
      outcome: "failed" as Outcome,
      reason: "respondent_absent" as const,
      minutes: 2,
      attendance: { complainant: true, complainantAdvocate: true, accused: false, accusedAdvocate: true } as Record<Role, boolean>,
    }));
    const flaky = predictSubstantive(view("A1", { nextPurpose: "APPEARANCE", history: absent }), REF, DAY, stats);
    const plain = predictSubstantive(view("A2", { nextPurpose: "APPEARANCE" }), REF, DAY, stats);
    expect(flaky.p).toBeLessThan(plain.p);
    const lc = predictSubstantive(view("E1", { nextPurpose: "EVIDENCE_COMPLAINANT", lastSummary: summary({ lastChance: true }) }), REF, DAY, stats);
    const e = predictSubstantive(view("E2", { nextPurpose: "EVIDENCE_COMPLAINANT" }), REF, DAY, stats);
    expect(lc.p).toBeGreaterThan(e.p);
    expect(flaky.why.join(" ")).toContain("accused present at 0 of 4");
  });

  test("next dates respect the ledger and bundle with the advocate", () => {
    const policy = POLICIES.benchtime!();
    const c = ctx.cases[0]!;
    const d1 = policy.nextDate(ctx, c, "substantive", DAY);
    expect(d1 >= addDays(DAY, REF[c.nextPurpose].gapDays)).toBe(true);
    // a desk case comes back after its expected return, not before
    const pend = ctx.cases.find((x) => x.id === "PEND/1")!;
    expect(policy.nextDate(ctx, pend, "desk", DAY) > "2026-10-20").toBe(true);
    // flooding one day pushes later promises to other days
    const dates = new Map<string, number>();
    for (const x of ctx.cases.filter((v) => !v.disposed)) {
      const d = policy.nextDate(ctx, x, "not_reached", DAY);
      dates.set(d, (dates.get(d) ?? 0) + 1);
    }
    expect(dates.size).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------------------------
// The shared 3,000-case court: first day for every policy (views built the way the world does)

describe("seed-42 roster, first day", () => {
  const START = "2026-10-01";
  const records = loadRoster(join(import.meta.dir, "..", "data", "roster_3000_seed42.csv"));
  const views: CaseView[] = records.map((r) => {
    const s = initialState(r);
    return {
      id: caseIdOf(r),
      filingNumber: r.filingNumber,
      filingDate: r.filingDate,
      advocateId: r.advocateId,
      partyId: r.partyId,
      stage: s.stage,
      nextPurpose: s.nextPurpose,
      hearingCounts: r.hearingCounts,
      hearingsAtPurpose: r.hearingCounts[s.nextPurpose] ?? 0,
      lastSummary: r.summary,
      history: [],
      process: s.process && s.process.status === "issued" ? { kind: s.process.kind, issuedOn: addDays(START, -14), returnedKnownOn: null } : null,
      externalPending: r.summary.mediation ? { since: addDays(START, -20), readyKnownOn: null } : null,
      nextDate: null,
      firstScheduledOn: null,
      firstHeardOn: null,
      disposed: false,
      disposedOn: null,
    };
  });

  test("every policy: initial dates then a valid first-day plan, quickly", () => {
    const rows: string[] = [];
    for (const id of POLICY_IDS) {
      const policy = POLICIES[id]!();
      const t0 = performance.now();
      const init = policy.initialDates({ ...ctxFor(id, views, START), checkins: new Map() });
      const dated = views.map((v) => ({ ...v, nextDate: init.get(v.id)! }));
      const ctx = { ...ctxFor(id, dated, START), checkins: new Map() };
      const plan = policy.plan(ctx) as BenchtimeDayPlan;
      const ms = performance.now() - t0;
      checkPlan(ctx, plan);
      expect(ms).toBeLessThan(5000);
      const main = plan.listings.filter((l) => !l.standby);
      const lastDay = [...init.values()].sort().at(-1);
      rows.push(
        `${id.padEnd(15)} due ${String(dated.filter((v) => v.nextDate <= START).length).padStart(4)} listed ${String(main.length).padStart(3)} standby ${String(plan.listings.length - main.length).padStart(2)} desk ${String(plan.desk.length).padStart(3)} deferred ${String(plan.deferred.length).padStart(4)} exp.min ${String(Math.round(plan.expected.minutes)).padStart(4)} exp.subst ${plan.expected.substantive.toFixed(1).padStart(5)} overrun ${plan.expected.overrunRisk.toFixed(2)} last first-date ${lastDay} ${plan.optimiser ? `gap ${plan.optimiser.gap} lambda ${plan.optimiser.lambda.toFixed(3)} advocates ${plan.optimiser.advocatesBefore}->${plan.optimiser.advocatesAfter}` : ""} (${Math.round(ms)} ms)`,
      );
    }
    console.log(rows.join("\n"));
  });
});

// ---------------------------------------------------------------------------------------------
// The baselines' diaries: no day above the court's usual list, weekends and holidays not folded onto Monday

import { Diary, SQ60_LIST_SIZE, SQ_REF_LIST_SIZE, countDiary, spreadInitialDates, workingDaysFrom } from "../src/planner/baselines";
import { afterGap } from "../src/planner/nextdate";
import { runArena } from "../src/eval/arena";

describe("baseline diaries", () => {
  const HEARD = "2026-10-06"; // +60 days is Saturday 5 December: a flat gap folds it onto the Monday

  /** `n` cases all heard on HEARD, plus `promised` cases already carrying `on` as their date */
  function heardDay(n: number, promised: number, on: string): PlanContext {
    const cases: CaseView[] = [];
    for (let i = 0; i < n; i++) cases.push(view(`H/${i}`, { nextDate: HEARD, nextPurpose: "APPEARANCE" }));
    for (let i = 0; i < promised; i++) cases.push(view(`P/${i}`, { nextDate: on, nextPurpose: "APPEARANCE" }));
    return ctxFor("status_quo_60", cases, HEARD);
  }

  test("status_quo_60 keeps the 60-day date until it holds 60 matters, then the next working days with room", () => {
    const target = afterGap(HEARD, 60, CAL);
    const ctx = heardDay(150, 20, target);
    const policy = POLICIES.status_quo_60!();
    const perDay = new Map<string, number>([[target, 20]]);
    const given: string[] = [];
    for (const c of ctx.cases.filter((x) => x.id.startsWith("H/"))) {
      const d = policy.nextDate(ctx, c, "substantive", HEARD);
      given.push(d);
      perDay.set(d, (perDay.get(d) ?? 0) + 1);
    }
    const days = [...workingDaysFrom(target, CAL)].slice(0, 4);
    // 40 more fit on the target, then 60, then the remaining 50: in date order, every one a working day
    expect(days.map((d) => perDay.get(d) ?? 0)).toEqual([60, 60, 50, 0]);
    expect(given.every((d) => d >= target && isWorkingDay(d, CAL))).toBe(true);
    expect([...given].sort()).toEqual(given);
    expect(Math.max(...perDay.values())).toBeLessThanOrEqual(SQ60_LIST_SIZE);
  });

  test("status_quo_ref follows PUCAR's gap per type and caps a day at 90", () => {
    const ctx = heardDay(200, 0, HEARD);
    const policy = POLICIES.status_quo_ref!();
    const perDay = new Map<string, number>();
    for (const c of ctx.cases) {
      const d = policy.nextDate(ctx, c, "failed", HEARD);
      expect(d >= afterGap(HEARD, REF.APPEARANCE.gapDays, CAL)).toBe(true);
      perDay.set(d, (perDay.get(d) ?? 0) + 1);
    }
    expect(Math.max(...perDay.values())).toBe(SQ_REF_LIST_SIZE);
    expect([...perDay.values()].reduce((s, x) => s + x, 0)).toBe(200);
  });

  test("a diary counts the register once: a case given a new date today moves, it is not counted twice", () => {
    const ctx = heardDay(1, 0, HEARD);
    const diary = countDiary();
    const c = ctx.cases[0]!;
    diary.book(ctx, c, "2026-10-21");
    diary.book(ctx, c, "2026-10-22");
    expect(diary.loadOn(ctx, "2026-10-21")).toBe(0);
    expect(diary.loadOn(ctx, "2026-10-22")).toBe(1);
    // an empty day takes even an oversized matter (20 October is a holiday, so the 21st); then that day is full
    const minutes = new Diary(() => 500);
    expect(minutes.bookFirstWithRoom(ctx, c, workingDaysFrom("2026-10-20", CAL), 420)).toBe("2026-10-21");
    expect(minutes.bookFirstWithRoom(ctx, view("H/x", { nextDate: HEARD }), workingDaysFrom("2026-10-20", CAL), 420)).toBe("2026-10-22");
  });

  test("initial spread: no day above the cap, whatever the roster size", () => {
    for (const n of [59, 60, 61, 3000, 3010, 3059]) {
      const cases = Array.from({ length: n }, (_, i) => view(`S/${i}`, { nextDate: null }));
      const ctx = ctxFor("status_quo_60", cases, "2026-10-01");
      const counts = new Map<string, number>();
      for (const d of spreadInitialDates(ctx, SQ60_LIST_SIZE).values()) counts.set(d, (counts.get(d) ?? 0) + 1);
      expect({ n, ok: Math.max(...counts.values()) <= SQ60_LIST_SIZE }).toEqual({ n, ok: true });
      expect(counts.size).toBe(Math.ceil(n / SQ60_LIST_SIZE));
    }
  });

  test("seed-42 roster, seed 31: the status quo never lists above its court's usual size", () => {
    const runs = runArena({
      rosters: [{ id: "roster_3000_seed42", path: join(import.meta.dir, "..", "data", "roster_3000_seed42.csv") }],
      policies: ["status_quo_60", "status_quo_ref", "sehgal"],
      seeds: [31],
      start: "2026-10-01",
      end: "2026-12-15",
    });
    const max = (id: string) => Math.max(...runs.find((r) => r.policyId === id)!.days.map((d) => d.listed));
    expect(max("status_quo_60")).toBeLessThanOrEqual(SQ60_LIST_SIZE);
    expect(max("status_quo_ref")).toBeLessThanOrEqual(SQ_REF_LIST_SIZE);
    // Sehgal lists 1.3 days of expected minutes; before the diary his Mondays reached 100
    expect(max("sehgal")).toBeLessThan(80);
  }, 60000);
});
