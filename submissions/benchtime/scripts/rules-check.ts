// Apply each judge's rules on top of a zoo genome, plan every day of a short horizon on a few seeds, and
// check every plan and next date against the rules (src/planner/zoo/rules.ts ruleViolations).
//   bun run scripts/rules-check.ts [--genome out/tournament/winner.json] [--seeds 1,2] [--end 2026-10-30]

import { readFileSync } from "node:fs";
import { loadCalendar } from "../src/data/calendar";
import { loadRefTables } from "../src/data/reference";
import { loadRoster } from "../src/data/roster";
import type { Policy } from "../src/domain/types";
import { worldParams } from "../src/eval/arena";
import { zooPolicy } from "../src/planner/zoo";
import { genomeConfig, validate, type Genome } from "../src/planner/zoo/genome";
import { PRESETS } from "../src/planner/zoo/presets";
import { RULE_PRESETS, applyRules, nextDateViolations, ruleViolations, type Rules, type Violation } from "../src/planner/zoo/rules";
import { simulate } from "../src/world/simulate";

const arg = (k: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const genomePath = arg("genome");
const genome: Genome = validate(genomePath ? (JSON.parse(readFileSync(genomePath, "utf8")).genome as Genome) : PRESETS.g_index!);
const seeds = (arg("seeds") ?? "1,2").split(",").map(Number);
const end = arg("end") ?? "2026-10-30";

const ref = loadRefTables();
const calendar = loadCalendar();
const records = loadRoster(new URL("../data/roster_3000_seed42.csv", import.meta.url).pathname);
const params = worldParams(ref, records);

/** every rule at once (the "kitchen sink"): a random-looking but valid rule set */
const KITCHEN: Partial<Rules> = {
  maxListed: 40,
  halfDays: ["2026-10-07", "2026-10-21"],
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
const SETS: Record<string, Partial<Rules>> = {
  ...Object.fromEntries(Object.entries(RULE_PRESETS).map(([k, p]) => [k, p.rules])),
  kitchen_sink: KITCHEN,
};

const only = arg("only");
for (const [name, rules] of Object.entries(SETS)) {
  if (only && name !== only) continue;
  const config = applyRules(genomeConfig(genome), rules);
  const tally = new Map<string, number>();
  const examples = new Map<string, Violation>();
  let days = 0;
  let listings = 0;
  let nexts = 0;
  for (const seed of seeds) {
    const inner = zooPolicy(config, genome);
    const policy: Policy = {
      ...inner,
      plan(ctx) {
        const plan = inner.plan(ctx);
        days++;
        listings += plan.listings.length;
        for (const v of ruleViolations(config, ctx, plan)) {
          tally.set(v.rule, (tally.get(v.rule) ?? 0) + 1);
          if (!examples.has(v.rule)) examples.set(v.rule, v);
        }
        return plan;
      },
      nextDate(ctx, c, outcome, date) {
        const to = inner.nextDate(ctx, c, outcome, date);
        nexts++;
        for (const v of nextDateViolations(config, ctx, c, outcome, date, to)) {
          tally.set(v.rule, (tally.get(v.rule) ?? 0) + 1);
          if (!examples.has(v.rule)) examples.set(v.rule, v);
        }
        return to;
      },
    };
    simulate({ records, rosterId: "seed42", policy, config, ref, calendar, worldSeed: seed, start: "2026-10-01", end, params, capacityMinutes: 420, scorecards: false });
  }
  const total = [...tally.values()].reduce((s, n) => s + n, 0);
  console.log(`\n${name}: ${days} day plans, ${listings} listings, ${nexts} next dates, ${total} violations`);
  for (const [rule, n] of [...tally.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${rule}: ${n}  e.g. ${JSON.stringify(examples.get(rule))}`);
}
