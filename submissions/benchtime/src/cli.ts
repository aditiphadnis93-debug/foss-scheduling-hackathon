// benchtime command line.
//
//   bun run src/cli.ts arena [--roster data/roster_3000_seed42.csv[,more.csv]] [--seeds 31-60]
//                            [--policies all|a,b] [--start 2026-10-01] [--end 2026-12-15]
//                            [--out out/arena.json] [--no-behaviour] [--config '{"benchtime":{"fillTarget":0.9}}']
//       Every policy against the same simulated court on every seed. Writes the summary and each run's
//       scorecards as JSON (--out) and the markdown report next to it (out/arena.md): every scorecard
//       field as a mean with a 95% interval, and paired differences against status_quo_60.
//       Seeds 1-20 are for tuning, 21-30 for validation, 31-60 (the default) are the held-out test seeds.
//
//   bun run src/cli.ts day --date 2026-10-05 [--policy benchtime] [--roster ...] [--seed 42]
//                          [--start 2026-10-01] [--out out/proposed_schedule.csv]
//       Runs the simulated court from --start up to --date on world seed 42 and writes the policy's plan
//       for that day in PUCAR's causelist columns (Case Number, Filing Number, Hearing Type, Hearing Date)
//       plus Call Time, Window, Standby, Expected Minutes, P(substantive) and Why. The process desk and
//       the deferred list are printed.
//
//   bun run src/cli.ts calibrate [args]    fits the world to PUCAR's tables (src/world/calibrate.ts)
//   bun run src/cli.ts profile             prints the data profile (scripts/profile-data.ts)

import { resolve } from "node:path";
import { isWorkingDay, loadCalendar, nextWorkingDayOnOrAfter } from "./data/calendar";
import { loadRefTables } from "./data/reference";
import { caseIdOf, loadRoster } from "./data/roster";
import type { DayPlan, JudgeConfig, Policy } from "./domain/types";
import { CAPACITY_MINUTES, configFor, parseSeeds, resolvePolicies, runArena, worldParams } from "./eval/arena";
import { DEFAULT_BASELINE, renderMarkdown, summarise, writeJson, writeText } from "./eval/report";
import { POLICIES } from "./planner/index";
import { simulate } from "./world/simulate";

const ROOT = resolve(import.meta.dir, "..");
const DEFAULT_ROSTER = "data/roster_3000_seed42.csv";
const DEFAULT_START = "2026-10-01";
const DEFAULT_END = "2026-12-15";

type Args = { _: string[]; [flag: string]: string | boolean | string[] };

function parseArgs(argv: string[]): Args {
  const out: Args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith("--")) {
      out._.push(a);
      continue;
    }
    const eq = a.indexOf("=");
    if (eq > 0) out[a.slice(2, eq)] = a.slice(eq + 1);
    else if (i + 1 < argv.length && !argv[i + 1]!.startsWith("--")) out[a.slice(2)] = argv[++i]!;
    else out[a.slice(2)] = true;
  }
  return out;
}

const str = (args: Args, k: string, d: string): string => (typeof args[k] === "string" ? (args[k] as string) : d);
const abs = (p: string) => resolve(ROOT, p);
// "data/roster_3000_seed42.csv" -> "roster_3000_seed42"
const rosterId = (p: string) => p.replace(/^.*\//, "").replace(/\.csv$/i, "");

function arena(args: Args): void {
  const rosters = str(args, "roster", DEFAULT_ROSTER).split(",").map((p) => ({ id: rosterId(p.trim()), path: abs(p.trim()) }));
  const seeds = parseSeeds(str(args, "seeds", "31-60"));
  const policies = resolvePolicies(str(args, "policies", "all").split(",").map((s) => s.trim()));
  const start = str(args, "start", DEFAULT_START);
  const end = str(args, "end", DEFAULT_END);
  const out = abs(str(args, "out", "out/arena.json"));
  const configOverrides = typeof args.config === "string" ? (JSON.parse(args.config) as Record<string, Partial<JudgeConfig>>) : undefined;
  const noBehaviour = args["no-behaviour"] === true;

  const total = rosters.length * policies.length * seeds.length;
  console.log(`Arena: ${policies.length} policies x ${seeds.length} seeds x ${rosters.length} roster(s) = ${total} runs, ${start} to ${end}`);
  const t0 = performance.now();
  const runs = runArena({
    rosters, policies, seeds, start, end, configOverrides, noBehaviour,
    onRun: (r, done, n) => {
      const s = r.scorecards;
      const pct = (x: number) => (Number.isFinite(x) ? `${(x * 100).toFixed(1)}%` : "n/a");
      console.log(`  [${done}/${n}] ${r.rosterId} ${r.policyId} seed ${r.worldSeed}: utilisation ${pct(s.readme.utilisation)}, reach ${pct(s.readme.reachRate)}, substantive ${pct(s.readme.substantiveness)}, disposed ${s.extra.disposed}`);
    },
  });
  const summary = summarise(runs, DEFAULT_BASELINE, {
    start, end, capacityMinutes: CAPACITY_MINUTES,
    note: noBehaviour ? "Behaviour responses were switched off for this run (--no-behaviour)." : undefined,
  });
  writeJson(out, summary);
  const md = out.replace(/\.json$/i, "") + ".md";
  writeText(md, renderMarkdown(summary));
  console.log(`Done in ${((performance.now() - t0) / 1000).toFixed(1)} s. Wrote ${out} and ${md}`);
}

// One CSV cell (RFC 4180): quote when it holds a comma, quote or newline.
const cell = (v: string | number | boolean | null): string => {
  const s = v === null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function day(args: Args): void {
  const date = str(args, "date", "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("day needs --date yyyy-mm-dd");
  const policyId = str(args, "policy", "benchtime");
  resolvePolicies([policyId]);
  const rosterPath = abs(str(args, "roster", DEFAULT_ROSTER));
  const worldSeed = Number(str(args, "seed", "42"));
  const out = abs(str(args, "out", "out/proposed_schedule.csv"));
  const calendar = loadCalendar();
  if (!isWorkingDay(date, calendar)) throw new Error(`${date} is not a working day; the next one is ${nextWorkingDayOnOrAfter(date, calendar)}`);
  const start = [str(args, "start", DEFAULT_START), date].sort()[0]!;

  const records = loadRoster(rosterPath);
  const ref = loadRefTables();
  const inner = POLICIES[policyId]!();
  // Capture the plan the policy makes for the requested day; everything else passes straight through.
  let captured: DayPlan | null = null;
  const policy: Policy = {
    id: inner.id,
    name: inner.name,
    description: inner.description,
    asksCheckin: inner.asksCheckin,
    initialDates: (ctx) => inner.initialDates(ctx),
    nextDate: (ctx, c, outcome, d) => inner.nextDate(ctx, c, outcome, d),
    plan: (ctx) => {
      const p = inner.plan(ctx);
      if (ctx.date === date) captured = p;
      return p;
    },
  };
  simulate({
    records, rosterId: rosterId(rosterPath), policy, config: configFor(policyId), ref, calendar, worldSeed,
    start, end: date, params: worldParams(ref, records), capacityMinutes: CAPACITY_MINUTES, scorecards: false,
  });
  const plan = captured as DayPlan | null;
  if (!plan) throw new Error(`The simulator made no plan for ${date}`);

  const byId = new Map(records.map((r) => [caseIdOf(r), r]));
  const header = ["Case Number", "Filing Number", "Hearing Type", "Hearing Date", "Call Time", "Window", "Standby", "Expected Minutes", "P(substantive)", "Why"];
  const lines = [header.join(",")];
  for (const l of [...plan.listings].sort((a, b) => Number(a.standby) - Number(b.standby) || a.order - b.order)) {
    const r = byId.get(l.caseId);
    lines.push([
      r?.caseNumber ?? l.caseId, r?.filingNumber ?? "", l.type, date, l.callTime, l.window, l.standby ? "yes" : "no",
      Math.round(l.expectedMinutes * 10) / 10, Math.round(l.pSubstantive * 1000) / 1000, l.why.join("; "),
    ].map(cell).join(","));
  }
  writeText(out, lines.join("\n") + "\n");

  const main = plan.listings.filter((l) => !l.standby).length;
  console.log(`${policyId} on ${date} (world seed ${worldSeed}, simulated from ${start}): ${main} listed, ${plan.listings.length - main} on standby, ${plan.desk.length} at the process desk, ${plan.deferred.length} deferred.`);
  console.log(`Expected ${plan.expected.minutes.toFixed(0)} of ${CAPACITY_MINUTES} minutes, ${plan.expected.substantive.toFixed(1)} substantive hearings, overrun risk ${(plan.expected.overrunRisk * 100).toFixed(0)}%.`);
  if (plan.desk.length) {
    console.log("Process desk:");
    for (const d of plan.desk.slice(0, 20)) console.log(`  ${byId.get(d.caseId)?.caseNumber ?? d.caseId}: ${d.action.replace(/_/g, " ")}, ${d.note}`);
    if (plan.desk.length > 20) console.log(`  and ${plan.desk.length - 20} more`);
  }
  if (plan.deferred.length) {
    console.log("Deferred:");
    for (const d of plan.deferred.slice(0, 20)) console.log(`  ${byId.get(d.caseId)?.caseNumber ?? d.caseId} to ${d.to}: ${d.reason}`);
    if (plan.deferred.length > 20) console.log(`  and ${plan.deferred.length - 20} more`);
  }
  console.log(`Wrote ${out}`);
}

// calibrate and profile run as their own scripts so each keeps its own entry point and output.
function delegate(script: string, rest: string[]): void {
  const p = Bun.spawnSync(["bun", "run", abs(script), ...rest], { stdout: "inherit", stderr: "inherit", cwd: ROOT });
  process.exitCode = p.exitCode ?? 1;
}

function usage(): void {
  console.log(`Usage: bun run src/cli.ts <command> [options]
  arena      --roster <csv[,csv]> --seeds 31-60 --policies all|a,b --start 2026-10-01 --end 2026-12-15 --out out/arena.json [--no-behaviour] [--config <json>]
  day        --date <yyyy-mm-dd> --policy benchtime [--seed 42] [--roster <csv>] [--start 2026-10-01] [--out out/proposed_schedule.csv]
  calibrate  fits the world to PUCAR's tables
  profile    prints the data profile`);
}

if (import.meta.main) {
  const [cmd, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  try {
    if (cmd === "arena") arena(args);
    else if (cmd === "day") day(args);
    else if (cmd === "calibrate") delegate("src/world/calibrate.ts", rest);
    else if (cmd === "profile") delegate("scripts/profile-data.ts", rest);
    else {
      usage();
      if (cmd !== undefined && cmd !== "help" && cmd !== "--help") process.exitCode = 1;
    }
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  }
}
