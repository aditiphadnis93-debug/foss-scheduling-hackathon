// A judge's saved rules on top of the zoo: the three judges' ways (presets) and every optional rule are kept
// by every plan and next date, the rules leave the tournament's genomes untouched when they only mirror the
// genome, and the API accepts, validates and previews every rule.

import { describe, expect, test } from "bun:test";
import { loadCalendar, weekday } from "../src/data/calendar";
import { loadRefTables } from "../src/data/reference";
import { loadRoster } from "../src/data/roster";
import { Rng } from "../src/domain/rng";
import type { DayPlan, PlanContext, Policy } from "../src/domain/types";
import { worldParams } from "../src/eval/arena";
import { cleanConfig } from "../src/api/context";
import { rulesPresetsHandler, rulesPreviewHandler } from "../src/api/rules";
import { zooPolicy } from "../src/planner/zoo";
import { genomeConfig, randomGenome, validate, type Genome } from "../src/planner/zoo/genome";
import { PRESETS } from "../src/planner/zoo/presets";
import { RULE_PRESETS, applyRules, effectiveGenome, nextDateViolations, ruleViolations, type Rules, type Violation } from "../src/planner/zoo/rules";
import { simulate } from "../src/world/simulate";

const ref = loadRefTables();
const calendar = loadCalendar();
const records = loadRoster(new URL("../data/roster_3000_seed42.csv", import.meta.url).pathname);
const params = worldParams(ref, records);

/** plan every day to `end` under the rules, collecting every violation of them */
function run(g: Genome, rules: Partial<Rules>, seed = 1, end = "2026-10-23"): { violations: Violation[]; plans: { ctx: PlanContext; plan: DayPlan }[] } {
  const config = applyRules(genomeConfig(g), rules);
  const inner = zooPolicy(config, g);
  const violations: Violation[] = [];
  const plans: { ctx: PlanContext; plan: DayPlan }[] = [];
  const policy: Policy = {
    ...inner,
    plan(ctx) {
      const plan = inner.plan(ctx);
      plans.push({ ctx, plan });
      violations.push(...ruleViolations(config, ctx, plan));
      return plan;
    },
    nextDate(ctx, c, outcome, date) {
      const to = inner.nextDate(ctx, c, outcome, date);
      violations.push(...nextDateViolations(config, ctx, c, outcome, date, to));
      return to;
    },
  };
  simulate({ records, rosterId: "seed42", policy, config, ref, calendar, worldSeed: seed, start: "2026-10-01", end, params, capacityMinutes: 420, scorecards: false });
  return { violations, plans };
}

const KITCHEN: Partial<Rules> = {
  maxListed: 40,
  halfDays: ["2026-10-07"],
  halfDayWeekdays: [5],
  leaveDays: ["2026-10-14", "2026-10-15"],
  priorityTypes: ["BAIL", "WARRANT"],
  minNoticeDays: 3,
  maxGapDays: 45,
  maxPerAdvocate: 6,
  groupByAdvocate: true,
  blocksByWeekday: {
    1: [{ id: "evidence", start: "10:30", end: "17:00", types: ["EVIDENCE_COMPLAINANT", "EVIDENCE_ACCUSED", "EXAMINATION_UNDER_S351_BNSS"] }],
    5: [{ id: "judgments", start: "10:30", end: "13:30", types: ["JUDGEMENT", "ARGUMENTS", "PLEA"] }],
  },
};

// the genomes the rules are checked on: the default (index), a rotation genome, the knapsack ancestor
const GENOMES = ["g_index", "a_fillfair", "benchtime_v0"] as const;

describe("the judges' ways on top of the zoo", () => {
  for (const id of Object.keys(RULE_PRESETS))
    test(
      `${id}: every plan keeps every rule`,
      () => {
        for (const gid of GENOMES) {
          const { violations } = run(PRESETS[gid]!, RULE_PRESETS[id]!.rules);
          expect({ id, gid, violations: violations.slice(0, 3), n: violations.length }).toEqual({ id, gid, violations: [], n: 0 });
        }
      },
      120_000,
    );
  test(
    "Sehgal: fresh purposes only in the morning block, times inside the blocks",
    () => {
      const { plans } = run(PRESETS.g_index!, RULE_PRESETS.sehgal_way!.rules);
      const fresh = RULE_PRESETS.sehgal_way!.rules.blocks![0]!;
      let morning = 0;
      for (const { plan } of plans)
        for (const l of plan.listings.filter((x) => x.window === "11:00-13:30")) {
          morning++;
          expect((fresh.types as string[]).includes(l.type)).toBe(true);
        }
      expect(morning).toBeGreaterThan(0);
    },
    60_000,
  );
  test(
    "Dimakar: evidence only Mon/Wed/Fri, appearances only Tue/Thu",
    () => {
      const { plans } = run(PRESETS.g_index!, RULE_PRESETS.dimakar_way!.rules);
      const ev = new Set(["EXAMINATION_UNDER_S351_BNSS", "EVIDENCE_COMPLAINANT", "EVIDENCE_ACCUSED", "ARGUMENTS", "JUDGEMENT"]);
      for (const { ctx, plan } of plans) for (const l of plan.listings) expect([1, 3, 5].includes(weekday(ctx.date))).toBe(ev.has(l.type));
    },
    60_000,
  );
});

describe("every optional rule", () => {
  test(
    "all rules at once on random genomes: no violation, leave days empty, half days short",
    () => {
      const r = new Rng(23);
      for (let i = 0; i < 3; i++) {
        const g = randomGenome(r);
        const { violations, plans } = run(g, KITCHEN, 2);
        expect({ i, violations: violations.slice(0, 3), n: violations.length }).toEqual({ i, violations: [], n: 0 });
        for (const { ctx, plan } of plans) {
          if (KITCHEN.leaveDays!.includes(ctx.date)) expect(plan.listings.length).toBe(0);
          expect(plan.listings.length).toBeLessThanOrEqual(40);
        }
      }
    },
    120_000,
  );
  test("the rules leave a genome untouched when they only mirror it (the tournament's numbers stand)", () => {
    const r = new Rng(5);
    const gs = [...Object.values(PRESETS), ...Array.from({ length: 30 }, () => randomGenome(r))];
    for (const g0 of gs) {
      const g = validate(g0);
      expect(effectiveGenome(g, genomeConfig(g))).toEqual(g);
    }
  });
  test("the configuration wins over the genome: desk, check-in, clustering, weights, next dates", () => {
    const g = validate(PRESETS.g_index!);
    const e = effectiveGenome(g, { ...genomeConfig(g), processDesk: false, checkin: false, clusterByAdvocate: false, smartNextDate: false, weights: { throughput: 2, substantiveness: 1, fairness: 0, predictability: 3, trips: 0 }, groupByAdvocate: true } as Rules);
    expect([e.desk, e.checkin, e.cluster, e.nextDate, e.callOrder, e.weights.fairness, e.weights.predictability]).toEqual([false, false, false, "pucar", "cluster", 0, 3]);
  });
  test("the floor for 4+ year cases cannot be lowered by a rule set", () => {
    expect(applyRules(genomeConfig(PRESETS.g_index!), { ageingFloor: 0 }).ageingFloor).toBe(0.15);
  });
});

describe("the API accepts, validates and previews every rule", () => {
  test("cleanConfig keeps every rule, clamps numbers and drops malformed values", () => {
    const c = cleanConfig({
      maxListed: 9999,
      minNoticeDays: -4,
      maxGapDays: 30.4,
      maxPerAdvocate: "5",
      halfDays: ["2026-10-07", "bad", 3],
      leaveDays: ["2026-10-14"],
      halfDayWeekdays: [5, 9],
      priorityTypes: ["BAIL", "NOT_A_TYPE"],
      groupByAdvocate: true,
      blocks: [{ id: "a", start: "14:00", end: "11:00", types: "all" }, { id: "b", start: "10:30", end: "13:00", types: ["ADMISSION"], newestFirst: true }],
      blocksByWeekday: { "1": [{ id: "ev", start: "10:30", end: "17:00", types: ["EVIDENCE_COMPLAINANT"] }], "9": [] },
    }) as Partial<Rules>;
    expect(c.maxListed).toBe(500);
    expect(c.minNoticeDays).toBe(0);
    expect(c.maxGapDays).toBe(30);
    expect(c.maxPerAdvocate).toBeUndefined();
    expect(c.halfDays).toEqual(["2026-10-07"]);
    expect(c.leaveDays).toEqual(["2026-10-14"]);
    expect(c.halfDayWeekdays).toEqual([5]);
    expect(c.priorityTypes).toEqual(["BAIL"]);
    expect(c.groupByAdvocate).toBe(true);
    expect(c.blocks as unknown).toEqual([{ id: "b", start: "10:30", end: "13:00", types: ["ADMISSION"], newestFirst: true }]);
    expect(Object.keys(c.blocksByWeekday!)).toEqual(["1"]);
  });
  test("the presets are rule sets a judge can start from", () => {
    const p = rulesPresetsHandler();
    expect(p.presets.map((x) => x.id)).toEqual(["sehgal_way", "dimakar_way", "joshi_way"]);
    // each preset survives the API's own cleaning unchanged
    for (const x of p.presets) expect(cleanConfig(JSON.parse(JSON.stringify(x.config)))).toEqual(JSON.parse(JSON.stringify(x.config)));
  });
  test(
    "the preview: a day's plan with and without the rules, whether it keeps them, every scorecard both ways",
    async () => {
      const r = await rulesPreviewHandler({ preset: "dimakar_way", config: { maxListed: 45 }, date: "2026-10-06", seeds: [31], weeks: 1 });
      expect(r.policy).toBe("zoo");
      expect(r.plan.keepsEveryRule).toBe(true);
      expect(r.plan.with.listed).toBeLessThanOrEqual(45);
      expect(r.config.maxListed).toBe(45);
      expect(typeof (r.scorecards.diff.readme as Record<string, { mean: number }>).utilisation!.mean).toBe("number");
      await expect(rulesPreviewHandler({ preset: "nobody" })).rejects.toThrow("unknown preset");
    },
    120_000,
  );
});

describe("the judge's aim", () => {
  test("an aim picks the tournament's genome for it, an unknown aim is dropped, and the judge's own rules still apply", async () => {
    const { AIMS, POLICIES } = await import("../src/planner/index");
    const { AIM_GENOMES } = await import("../src/planner/zoo/presets");
    const { cleanConfig } = await import("../src/api/context");
    expect(AIMS).toContain("balanced");
    expect(AIMS).toContain("focus_finish");
    expect(Object.keys(AIM_GENOMES).length).toBe(AIMS.length);
    expect((cleanConfig({ aim: "focus_finish" }) as { aim?: string }).aim).toBe("focus_finish");
    expect((cleanConfig({ aim: "nonsense" }) as { aim?: string }).aim).toBeUndefined();
    const p = POLICIES.zoo!({ aim: "focus_finish", maxListed: 30 } as never);
    expect(p.id).toBe("zoo");
  });
});

describe("the aim's own settings reach the daily config", () => {
  test("configFor starts the zoo from the aim's genome, and the judge's explicit fields still win", async () => {
    const { configFor } = await import("../src/eval/arena");
    const { AIM_GENOMES } = await import("../src/planner/zoo/presets");
    const { genomeConfig } = await import("../src/planner/zoo/genome");
    const aimFill = genomeConfig(AIM_GENOMES.focus_finish!).fillTarget;
    expect(configFor("zoo", { aim: "focus_finish" } as never).fillTarget).toBe(aimFill);
    expect(configFor("zoo", { aim: "focus_finish", fillTarget: 0.8 } as never).fillTarget).toBe(0.8);
  });
});
