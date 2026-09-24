// Freeze the tournament's pick as data: writes src/planner/zoo/final.ts from out/tournament/winner.json
// (the genome, validated, plus where it came from), so the package runs benchtime_final without out/.
// src/planner/index.ts registers it under the id "benchtime_final"; test/benchtime-final.test.ts checks
// the frozen genome still matches winner.json.
//   bun run scripts/experiments/freeze-winner.ts [--winner out/tournament/winner.json]

import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { validate, type Genome } from "../../src/planner/zoo/genome";

const ROOT = resolve(import.meta.dir, "../..");
const i = process.argv.indexOf("--winner");
const path = i >= 0 ? resolve(process.argv[i + 1]!) : join(ROOT, "out/tournament/winner.json");
const w = JSON.parse(readFileSync(path, "utf8")) as { name: string; origin?: string; key?: string; criteria?: string; genome: Genome; failedDecide?: number; failedConfirm?: number };
const g = validate(w.genome);
const source = { name: w.name, origin: w.origin ?? "", criteria: w.criteria ?? "", failedDecide: w.failedDecide ?? null, failedConfirm: w.failedConfirm ?? null, frozenFrom: "out/tournament/winner.json", frozenAt: new Date().toISOString() };
const text = `// The tournament's pick, frozen as data (written by scripts/experiments/freeze-winner.ts from
// out/tournament/winner.json; test/benchtime-final.test.ts checks they still match). Registered as the
// policy "benchtime_final" in src/planner/index.ts; "benchtime" stays the overnight build.

import type { Genome } from "./genome";

export const BENCHTIME_FINAL_SOURCE = ${JSON.stringify(source, null, 2)} as const;

export const BENCHTIME_FINAL_GENOME: Genome = ${JSON.stringify(g, null, 2)};
`;
writeFileSync(join(ROOT, "src/planner/zoo/final.ts"), text);
console.log(`wrote src/planner/zoo/final.ts: ${w.name} (${w.origin ?? ""})`);
