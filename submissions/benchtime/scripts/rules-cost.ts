// What each judge's way costs or gains: the plain genome against the genome with each rule preset on top,
// full horizon, paired on shared seeds, every measure.
//   bun run scripts/rules-cost.ts [--genome out/tournament/winner.json] [--seeds 1,2,3,4,5,6] [--out out/rules-cost.json]

import { readFileSync, writeFileSync } from "node:fs";
import type { JudgeConfig } from "../src/domain/types";
import { minGapDays } from "../src/eval/arena";
import { scorecards } from "../src/eval/metrics";
import { zooPolicy } from "../src/planner/zoo";
import { genomeConfig, validate, type Genome } from "../src/planner/zoo/genome";
import { PRESETS } from "../src/planner/zoo/presets";
import { RULE_PRESETS, applyRules } from "../src/planner/zoo/rules";
import { simulate } from "../src/world/simulate";
import { END, START, flatten, loadCourt } from "./tournament-worker";

const arg = (k: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const genomePath = arg("genome");
const genome: Genome = validate(genomePath ? (JSON.parse(readFileSync(genomePath, "utf8")).genome as Genome) : PRESETS.g_index!);
const seeds = (arg("seeds") ?? "1,2,3,4,5,6").split(",").map(Number);
const c = loadCourt();

function run(config: JudgeConfig, seed: number): Record<string, number> {
  const r = simulate({ records: c.records, rosterId: "seed42", policy: zooPolicy(config, genome), config, ref: c.ref, calendar: c.calendar, worldSeed: seed, start: START, end: END, params: c.params, capacityMinutes: 420, scorecards: false });
  return flatten(scorecards({ hearings: r.hearings, days: r.days, records: c.records, start: START, end: END, capacityMinutes: 420, asOf: END, minGapDays: minGapDays(c.ref) }));
}

const base = genomeConfig(genome);
const sets: Record<string, JudgeConfig> = { plain: base, ...Object.fromEntries(Object.entries(RULE_PRESETS).map(([k, p]) => [k, applyRules(base, p.rules)])) };
const results: Record<string, Record<string, number>[]> = {};
for (const [k, cfg] of Object.entries(sets)) {
  results[k] = seeds.map((s) => run(cfg, s));
  process.stderr.write(`${k} done\n`);
}
const KEYS = [
  "extra.substantivePerDay",
  "extra.disposed",
  "extra.disposed4yPlus",
  "readme.utilisation",
  "readme.reachRate",
  "readme.substantiveness",
  "readme.backlog4yHeardShare",
  "readme.backlog4ySubstantiveShare",
  "readme.predictabilityGapDays",
  "caseStudy.heldAsScheduled",
  "caseStudy.overrunDays",
  "caseStudy.idleMinutesShare",
  "caseStudy.nextDateExcessDays",
  "caseStudy.wastedRelistShare",
  "siddarth.throughputPerMonth",
  "siddarth.wastedListings",
  "siddarth.heldOnPromisedDate",
  "siddarth.oldestPendingAgeYears",
  "siddarth.neverHeard",
  "siddarth.loadBalanceCv",
  "extra.listedPerDay",
  "extra.tripsPerSubstantive",
  "extra.wastedTripShare",
];
const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
const sd = (xs: number[]) => {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, xs.length - 1));
};
const table: Record<string, Record<string, { mean: number; diff?: number; ci95?: number }>> = {};
const lines = [`| measure | plain | ${Object.keys(RULE_PRESETS).map((k) => `${k} (diff, 95% CI)`).join(" | ")} |`, `|---|---|${Object.keys(RULE_PRESETS).map(() => "---").join("|")}|`];
for (const key of KEYS) {
  const p = results.plain!.map((r) => r[key] ?? NaN);
  table[key] = { plain: { mean: mean(p) } };
  const cells = [key, mean(p).toFixed(3)];
  for (const k of Object.keys(RULE_PRESETS)) {
    const x = results[k]!.map((r) => r[key] ?? NaN);
    const d = x.map((v, i) => v - p[i]!);
    const ci = (2.571 * sd(d)) / Math.sqrt(d.length);
    table[key]![k] = { mean: mean(x), diff: mean(d), ci95: ci };
    cells.push(`${mean(x).toFixed(3)} (${mean(d) >= 0 ? "+" : ""}${mean(d).toFixed(3)} ± ${ci.toFixed(3)})`);
  }
  lines.push(`| ${cells.join(" | ")} |`);
}
const out = arg("out") ?? "out/rules-cost.json";
writeFileSync(out, JSON.stringify({ genome: genomePath ?? "g_index", seeds, table }, null, 2));
console.log(lines.join("\n"));
