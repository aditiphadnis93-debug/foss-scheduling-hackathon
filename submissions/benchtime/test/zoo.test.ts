// The zoo meta-policy: presets reproduce their sources, every genome yields a valid plan, and the judges'
// rules (blocks, weekday themes, carry-forward, the cap on matters, half days, the 15% floor) hold.

import { describe, expect, test } from "bun:test";
import { isWorkingDay, loadCalendar, nextWorkingDayOnOrAfter, weekday } from "../src/data/calendar";
import { loadRefTables } from "../src/data/reference";
import { loadRoster } from "../src/data/roster";
import { Rng } from "../src/domain/rng";
import type { CaseView, DayPlan, JudgeConfig, Outcome, PlanContext, Policy } from "../src/domain/types";
import { worldParams } from "../src/eval/arena";
import { POLICIES } from "../src/planner/index";
import { SEHGAL_BLOCKS, purposeWeekdays, zooPolicy } from "../src/planner/zoo";
import { crossover, floorOf, genomeConfig, genomeKey, mutate, randomGenome, validate, type Genome } from "../src/planner/zoo/genome";
import { CANDIDATE_PRESETS, PRESETS } from "../src/planner/zoo/presets";
import { simulate } from "../src/world/simulate";
import { evaluate } from "../scripts/tournament-worker";

const ROSTER = new URL("../data/roster_3000_seed42.csv", import.meta.url).pathname;
const ref = loadRefTables();
const calendar = loadCalendar();
const records = loadRoster(ROSTER);
const params = worldParams(ref, records);

const KEYS = ["extra.substantivePerDay", "readme.backlog4yHeardShare", "readme.backlog4ySubstantiveShare", "extra.disposed", "extra.tripsPerSubstantive", "siddarth.heldOnPromisedDate", "caseStudy.nextDateExcessDays"];

describe("presets reproduce their sources", () => {
  // the baselines and judges are in the package: the zoo must match them run for run on seeds 1-3
  for (const id of ["status_quo_60", "status_quo_ref", "fifo_capped", "bin_packing", "oldest_first", "sehgal", "dimakar", "joshi"]) {
    test(
      id,
      () => {
        for (const seed of [1, 2, 3]) {
          const z = evaluate({ key: id, seed, genome: PRESETS[id]! });
          const o = evaluate({ key: id, seed, policy: id });
          for (const k of KEYS) {
            const a = z[k]!;
            const b = o[k]!;
            // within noise: 2% relative or 0.02 absolute (Joshi's floor differs by a case or two)
            expect({ id, seed, k, close: Math.abs(a - b) <= Math.max(0.02, 0.02 * Math.abs(b)) }).toEqual({ id, seed, k, close: true });
          }
        }
      },
      120_000,
    );
  }

  // the redesigns' planners live outside the package; their numbers on the corrected court (seeds 1-20,
  // re-benched by the orchestrator) are the reference, and seeds 1-3 must land within noise of them
  const SOURCE: Record<string, { useful: number; sub4y: number }> = {
    g_index: { useful: 21.33, sub4y: 0.386 },
    c_portfolio: { useful: 20.37, sub4y: 0.405 },
    b_horizon: { useful: 16.95, sub4y: 0.454 },
    a_fillfair: { useful: 15.68, sub4y: 0.413 },
  };
  for (const [id, src] of Object.entries(SOURCE)) {
    test(
      id,
      () => {
        const runs = [1, 2, 3].map((seed) => evaluate({ key: id, seed, genome: PRESETS[id]! }));
        const useful = runs.reduce((s, r) => s + r["extra.substantivePerDay"]!, 0) / runs.length;
        const sub4y = runs.reduce((s, r) => s + r["readme.backlog4ySubstantiveShare"]!, 0) / runs.length;
        expect(Math.abs(useful - src.useful) / src.useful).toBeLessThan(0.12);
        expect(Math.abs(sub4y - src.sub4y)).toBeLessThan(0.08);
      },
      120_000,
    );
  }
});

/** Run a policy over a short horizon, checking every plan and next date against the rules as it goes. */
function checkedRun(g: Genome, config: JudgeConfig, seed: number, end = "2026-10-23"): { plans: { ctx: PlanContext; plan: DayPlan }[]; nexts: { ctx: PlanContext; c: CaseView; outcome: Outcome; date: string; to: string }[] } {
  const inner = zooPolicy(config, g);
  const plans: { ctx: PlanContext; plan: DayPlan }[] = [];
  const nexts: { ctx: PlanContext; c: CaseView; outcome: Outcome; date: string; to: string }[] = [];
  const policy: Policy = {
    ...inner,
    plan(ctx) {
      const plan = inner.plan(ctx);
      plans.push({ ctx, plan });
      return plan;
    },
    nextDate(ctx, c, outcome, date) {
      const to = inner.nextDate(ctx, c, outcome, date);
      nexts.push({ ctx, c, outcome, date, to });
      return to;
    },
  };
  simulate({ records, rosterId: "seed42", policy, config, ref, calendar, worldSeed: seed, start: "2026-10-01", end, params, capacityMinutes: 420, scorecards: false });
  return { plans, nexts };
}

function expectValid(run: ReturnType<typeof checkedRun>, label: string): void {
  for (const { ctx, plan } of run.plans) {
    const due = ctx.cases.filter((c) => !c.disposed && c.nextDate !== null && c.nextDate <= ctx.date).map((c) => c.id);
    const seen = [...plan.listings.map((l) => l.caseId), ...plan.desk.map((d) => d.caseId), ...plan.deferred.map((d) => d.caseId)];
    // every due case exactly once: listed, on the desk, or deferred with a new date
    expect({ label, date: ctx.date, dup: seen.length - new Set(seen).size }).toEqual({ label, date: ctx.date, dup: 0 });
    expect({ label, date: ctx.date, missing: due.filter((id) => !seen.includes(id)).length }).toEqual({ label, date: ctx.date, missing: 0 });
    plan.listings.forEach((l, i) => expect(l.order).toBe(i));
    for (const d of plan.deferred) {
      expect(d.to > ctx.date).toBe(true);
      expect(isWorkingDay(d.to, calendar)).toBe(true);
    }
  }
  for (const n of run.nexts) {
    expect(n.to > n.date).toBe(true);
    expect(isWorkingDay(n.to, calendar)).toBe(true);
  }
}

describe("every genome yields a valid plan", () => {
  test(
    "every preset",
    () => {
      for (const [name, g] of Object.entries(PRESETS)) expectValid(checkedRun(g, genomeConfig(g), 1), name);
    },
    120_000,
  );
  test(
    "random, mutated and crossed genomes",
    () => {
      const r = new Rng(7);
      const gs: Genome[] = [];
      for (let i = 0; i < 12; i++) gs.push(randomGenome(r));
      gs.push(mutate(PRESETS.g_index!, r, 0.5), crossover(PRESETS.c_portfolio!, PRESETS.b_horizon!, r));
      for (const [i, g] of gs.entries()) {
        expect(validate(g)).toEqual(g);
        expect(floorOf(g)).toBeGreaterThanOrEqual(0.15);
        expectValid(checkedRun(g, genomeConfig(g), 2), `genome ${i}`);
      }
    },
    180_000,
  );
  test("validate clamps any genome into its bounds and keeps the 15% floor", () => {
    const wild = { ...PRESETS.g_index!, fillTarget: 9, standbyShare: -1, ageingFloor: 0.01, windowDays: 1000, weights: { throughput: -5, disposal: 99, fairness: NaN, trips: 1, predictability: 1 } } as Genome;
    const v = validate(wild);
    expect(v.fillTarget).toBe(1.5);
    expect(v.standbyShare).toBe(0);
    expect(v.ageingFloor).toBe(0.15);
    expect(v.windowDays).toBe(40);
    expect(v.weights.throughput).toBe(0);
    expect(v.weights.disposal).toBe(3);
    expect(genomeKey(v)).toBe(genomeKey(validate(v)));
    for (const k of CANDIDATE_PRESETS) expect(floorOf(PRESETS[k]!)).toBeGreaterThanOrEqual(0.15);
  });
});

describe("the judges' rules hold in the zoo", () => {
  test(
    "Sehgal: block types and times, and carry-forward to the same weekday next week",
    () => {
      const g = PRESETS.sehgal!;
      const run = checkedRun(g, genomeConfig(g), 1);
      const fresh = SEHGAL_BLOCKS[0]!;
      for (const { plan } of run.plans)
        for (const l of plan.listings) {
          expect(l.callTime).not.toBeNull();
          if (l.window === `${fresh.start}-${fresh.end}`) expect((fresh.types as string[]).includes(l.type)).toBe(true);
        }
      for (const n of run.nexts)
        if (n.outcome === "not_reached" || n.outcome === "deferred") expect(n.to).toBe(nextWorkingDayOnOrAfter(new Date(Date.parse(n.date) + 7 * 864e5).toISOString().slice(0, 10), calendar));
      for (const { ctx, plan } of run.plans)
        for (const d of plan.deferred) expect(d.to).toBe(nextWorkingDayOnOrAfter(new Date(Date.parse(ctx.date) + 7 * 864e5).toISOString().slice(0, 10), calendar));
    },
    60_000,
  );
  test(
    "Dimakar: next dates only on the purpose's days",
    () => {
      const g = PRESETS.dimakar!;
      const run = checkedRun(g, genomeConfig(g), 1);
      for (const n of run.nexts) {
        // the view the simulator passes carries the purpose the case moved to
        expect(purposeWeekdays(n.c.nextPurpose).includes(weekday(n.to))).toBe(true);
      }
    },
    60_000,
  );
  test(
    "a random valid config never breaks a rule: weekday themes, the cap on matters, half days, the floor",
    () => {
      const r = new Rng(11);
      for (let i = 0; i < 4; i++) {
        const g = randomGenome(r);
        const halfDay = "2026-10-07";
        const config = {
          ...genomeConfig(g),
          maxListed: 25 + i * 5,
          halfDays: [halfDay],
          // evidence on Mondays, judgments and arguments on Fridays
          blocksByWeekday: {
            1: [{ id: "evidence", start: "10:00", end: "17:30", types: ["EVIDENCE_COMPLAINANT", "EVIDENCE_ACCUSED", "EXAMINATION_UNDER_S351_BNSS"] }],
            5: [{ id: "judgments", start: "10:00", end: "17:30", types: ["JUDGEMENT", "ARGUMENTS"] }],
          },
        } as JudgeConfig;
        const run = checkedRun(g, config, 3);
        expectValid(run, `config ${i}`);
        for (const { ctx, plan } of run.plans) {
          expect(plan.listings.length).toBeLessThanOrEqual(25 + i * 5);
          const wd = weekday(ctx.date);
          for (const l of plan.listings) {
            if (wd === 1) expect(["EVIDENCE_COMPLAINANT", "EVIDENCE_ACCUSED", "EXAMINATION_UNDER_S351_BNSS"].includes(l.type)).toBe(true);
            if (wd === 5) expect(["JUDGEMENT", "ARGUMENTS"].includes(l.type)).toBe(true);
          }
          const main = plan.listings.filter((l) => !l.standby).reduce((s, l) => s + l.expectedMinutes, 0);
          if (ctx.date === halfDay) expect(main).toBeLessThanOrEqual(g.fillTarget * 210 + 60);
        }
        expect(floorOf(g, config)).toBeGreaterThanOrEqual(0.15);
      }
    },
    120_000,
  );
});

describe("registration", () => {
  test("the zoo is registered and builds from its default genome", () => {
    const f = POLICIES.zoo;
    expect(f).toBeDefined();
    expect(f!().id).toBe("zoo");
  });
});
