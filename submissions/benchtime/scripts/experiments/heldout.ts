// Held-out experiments on the tournament winner (seeds 31-60, roster seed 42, the CLI arena path).
//
//   bun run scripts/experiments/heldout.ts [--workers 6] [--seeds 31-60] [--ablation-seeds 31-60]
//        [--parts arena,robustness,styles,settlement,ablation] [--report-only] [--dry]
//
// Parts (each writes out/<part>.json and out/<part>.md; the arena part writes out/heldout.* and HEADLINE.md):
//   arena       the winner (benchtime_final) against every baseline, the judges, the overnight benchtime, the
//               frontier points and ADP when winner.json names them; every measure with a 95% interval,
//               paired differences against status_quo_60 and against the best baseline, and the 18
//               guardrails of out/tournament/criteria.json by paired non-inferiority;
//   ablation    each gene of the winner switched off (or to today's rule), and each added to today's way;
//   robustness  behaviour off, duration CV 0.25 and 1.0, process 1.5x slower, check-in false alarms doubled,
//               planner P(substantive) biased +/-30%, rosters seed 1-5;
//   styles      the winner with Sehgal's, Dimakar's and Joshi's rules on top;
//   settlement  the winner with settlement days (daily tail, Friday reports), in a temp copy.
// --dry runs every part on seed 1 with the zoo's default genome and writes to out/dryrun/.
// Rule 1 holds (planners see only PlanContext), rule 2 (every cell on the same seeds and roster), rule 3
// (every measure). Seeds 31-60 are the held-out test seeds; nothing here tunes anything.

import { execSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RunResult, Scorecards } from "../../src/domain/types";
import { DATA_DIR } from "../../src/data/reference";
import { parseSeeds } from "../../src/eval/arena";
import { SCORECARD_FIELDS } from "../../src/eval/metrics";
import { renderMarkdown, summarise } from "../../src/eval/report";
import { POLICIES } from "../../src/planner/index";
import { describeGenome, SEHGAL_BLOCKS } from "../../src/planner/zoo";
import { genomeKey, validate, type Genome } from "../../src/planner/zoo/genome";
import { DEFAULT_GENOME, PRESETS } from "../../src/planner/zoo/presets";
import {
  CACHE_DIR,
  codeHash,
  evalGuardrails,
  flat,
  fmtDiff,
  fmtNum,
  jobKey,
  loadCriteria,
  nowHHMM,
  OUT,
  pairedT,
  ROOT,
  runJobs,
  runsOf,
  tInterval,
  tq,
  type Criteria,
  type Flat,
  type GuardResult,
  type Job,
} from "./lib";
import type { CellSpec } from "./worker";

// ---------------------------------------------------------------------------------------------
// Arguments

const argv = process.argv.slice(2);
const opt = (k: string, d: string): string => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1]!.startsWith("--") ? argv[i + 1]! : d;
};
const has = (k: string) => argv.includes(`--${k}`);
const DRY = has("dry");
const WORKERS = Number(opt("workers", DRY ? "1" : "6"));
const SEEDS = parseSeeds(opt("seeds", DRY ? "1" : "31-60"));
const ABL_SEEDS = parseSeeds(opt("ablation-seeds", DRY ? "1" : "31-60"));
const PARTS = new Set(opt("parts", "arena,robustness,styles,settlement,ablation").split(","));
const REPORT_ONLY = has("report-only");
const OUTDIR = DRY ? join(OUT, "dryrun") : OUT;
if (!DRY) for (const s of [...SEEDS, ...ABL_SEEDS]) if (s < 31) throw new Error("headline experiments use held-out seeds 31-60 only (use --dry for a smoke run)");

const RIVALS = ["status_quo_60", "status_quo_ref", "fifo_capped", "bin_packing", "oldest_first", "sehgal", "dimakar", "joshi", "benchtime"];
const BASELINES = RIVALS.slice(0, 8);
const TODAY = "status_quo_60";

// ---------------------------------------------------------------------------------------------
// The winner

interface WinnerInfo {
  name: string;
  origin: string;
  genome: Genome;
  raw: Record<string, unknown> | null;
  failedDecide: number | null;
  failedConfirm: number | null;
  nothingPassed: boolean;
  frontier: { level: string; name: string; genome: Genome }[];
  adpReferenced: boolean;
  overallPick: unknown;
}

function loadWinner(): WinnerInfo {
  if (DRY) return { name: "zoo default (g_index)", origin: "dry run", genome: validate(DEFAULT_GENOME), raw: null, failedDecide: null, failedConfirm: null, nothingPassed: false, frontier: [], adpReferenced: true, overallPick: null };
  const path = join(OUT, "tournament", "winner.json");
  if (!existsSync(path)) throw new Error("out/tournament/winner.json is not there yet");
  const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, any>;
  const genome = validate(raw.genome as Genome);
  const failedDecide = typeof raw.failedDecide === "number" ? raw.failedDecide : Array.isArray(raw.guardrailsBroken) ? raw.guardrailsBroken.length : null;
  const failedConfirm = typeof raw.failedConfirm === "number" ? raw.failedConfirm : null;
  // frontier points: winner.json's own list, else final-state.json keys looked up in runs.json
  const frontier: WinnerInfo["frontier"] = [];
  if (Array.isArray(raw.frontier))
    for (const f of raw.frontier) if (f?.genome) frontier.push({ level: String(f.level ?? f.name), name: String(f.name ?? f.key ?? "frontier"), genome: validate(f.genome) });
  const statePath = join(OUT, "tournament", "final-state.json");
  const runsPath = join(OUT, "tournament", "runs.json");
  if (frontier.length === 0 && existsSync(statePath) && existsSync(runsPath)) {
    try {
      const st = JSON.parse(readFileSync(statePath, "utf8")) as { frontier?: { level: string; key: string }[] };
      const runs = JSON.parse(readFileSync(runsPath, "utf8")) as { cands: { key: string; name: string; genome?: Genome }[] };
      const byKey = new Map(runs.cands.map((c) => [c.key, c]));
      for (const f of st.frontier ?? []) {
        const c = byKey.get(f.key);
        if (c?.genome) frontier.push({ level: f.level, name: c.name, genome: validate(c.genome) });
      }
    } catch (e) {
      console.error(`could not read the frontier: ${e}`);
    }
  }
  // one cell per distinct genome: a frontier point equal to the pick (or to another point) is merged
  const wk = genomeKey(genome);
  const merged: WinnerInfo["frontier"] = [];
  for (const f of frontier) {
    const k = genomeKey(f.genome);
    if (k === wk) continue;
    const prev = merged.find((x) => genomeKey(x.genome) === k);
    if (prev) prev.level += `; ${f.level}`;
    else merged.push({ ...f });
  }
  const pickIsFrontier = frontier.filter((f) => genomeKey(f.genome) === wk).map((f) => f.level);
  frontier.length = 0;
  frontier.push(...merged);
  if (pickIsFrontier.length) notes.arena!.push(`The pick itself is the frontier point for: ${pickIsFrontier.join("; ")}.`);
  const text = JSON.stringify({ ...raw, srcHashes: undefined });
  return {
    name: String(raw.name),
    origin: String(raw.origin ?? ""),
    genome,
    raw,
    failedDecide,
    failedConfirm,
    nothingPassed: (failedDecide ?? 0) > 0,
    frontier,
    // ADP: named in winner.json, or a finalist in the tournament's summary (so the pick was chosen against it)
    adpReferenced: /\badp\b/i.test(text) || (existsSync(join(OUT, "tournament", "summary.md")) && /\| adp \|/.test(readFileSync(join(OUT, "tournament", "summary.md"), "utf8"))),
    overallPick: raw.overallPick ?? null,
  };
}

// ---------------------------------------------------------------------------------------------
// Temp copies for patches (never applied to the package)

function prepareRoot(name: string, apply: (root: string) => string | null): { root: string | null; note: string } {
  const root = `/tmp/heldout-${name}${DRY ? "-dry" : ""}`;
  try {
    execSync(`rm -rf ${root} && mkdir -p ${root} && rsync -a --exclude node_modules --exclude out --exclude web --exclude web-concepts ${ROOT}/ ${root}/`);
    // PUCAR's reference tables live in the shared data folder above the package; a temp copy carries them locally
    for (const f of ["hearing_type_reference.csv", "court_calendar.csv", "hearing_failure_reasons.csv", "substantiveness_by_hearing_type.csv"]) if (existsSync(join(DATA_DIR, f))) copyFileSync(join(DATA_DIR, f), join(root, "data", f));
    const err = apply(root);
    if (err) return { root: null, note: err };
    mkdirSync(join(root, "scripts/experiments"), { recursive: true });
    for (const f of ["worker.ts", "lib.ts"]) copyFileSync(join(ROOT, "scripts/experiments", f), join(root, "scripts/experiments", f));
    return { root, note: "applied cleanly in a temp copy" };
  } catch (e) {
    return { root: null, note: `failed: ${String(e).slice(0, 300)}` };
  }
}
const patchApply = (patch: string) => (root: string): string | null => {
  if (!existsSync(patch)) return `${patch} not found`;
  const dry = spawnSync("patch", ["-p1", "--dry-run", "-i", patch], { cwd: root, encoding: "utf8" });
  if (dry.status !== 0) return `does not apply cleanly: ${(dry.stdout + dry.stderr).split("\n").filter((l) => /fail|reject|error/i.test(l)).join("; ").slice(0, 300)}`;
  const r = spawnSync("patch", ["-p1", "-i", patch], { cwd: root, encoding: "utf8" });
  return r.status === 0 ? null : `patch failed: ${r.stderr.slice(0, 300)}`;
};
/** the settlement diff's index.ts hunks target an older registry; only its new module is needed */
const settlementApply = (root: string): string | null => {
  const diff = "/tmp/variants/settlement/settlement-component.diff";
  if (!existsSync(diff)) return `${diff} not found`;
  const lines = readFileSync(diff, "utf8").split("\n");
  const i = lines.findIndex((l) => l.startsWith("+++ b/src/planner/settlement.ts"));
  if (i < 0) return "settlement.ts not in the diff";
  const body: string[] = [];
  for (let k = i + 1; k < lines.length; k++) {
    const l = lines[k]!;
    if (l.startsWith("diff ")) break;
    if (l.startsWith("@@")) continue;
    if (l.startsWith("+")) body.push(l.slice(1));
  }
  writeFileSync(join(root, "src/planner/settlement.ts"), body.join("\n") + "\n");
  const tc = spawnSync("bun", ["build", "--target=bun", "--outdir", "/tmp/heldout-settle-build", join(root, "src/planner/settlement.ts")], { cwd: root, encoding: "utf8" });
  return tc.status === 0 ? null : `settlement.ts does not build: ${tc.stderr.slice(0, 300)}`;
};

// ---------------------------------------------------------------------------------------------
// Cells

const notes: Record<string, string[]> = { arena: [], ablation: [], robustness: [], styles: [], settlement: [] };
const W = loadWinner();
const crit: Criteria = loadCriteria();
const registered = !DRY && "benchtime_final" in POLICIES;
const winnerCell: CellSpec = registered ? { id: "benchtime_final", label: `benchtime_final (${W.name})`, policy: "benchtime_final" } : { id: "benchtime_final", label: `benchtime_final (${W.name})`, genome: W.genome };
const pol = (id: string, label = id): CellSpec => ({ id, label, policy: id });
const gen = (id: string, label: string, genome: Genome, extra: Partial<CellSpec> = {}): CellSpec => ({ id, label, genome: validate(genome), ...extra });
const today = pol(TODAY, "status_quo_60 (today's way)");


// arena
const arenaCells: CellSpec[] = [winnerCell, ...RIVALS.map((id) => pol(id, id === "benchtime" ? "benchtime (our overnight build)" : id))];
// context requested by the coordinator: the winner with fixed call times (fails 2 guardrails in the tournament)
if (!W.genome.callTimes) arenaCells.push(gen("winner_calltimes", `${W.name} + fixed call times (context: failed 2 guardrails on 7-20 and 21-30)`, { ...W.genome, callTimes: true }));
// "focused" (g1121): an operating point on the judge's dial, not the pick (the first g1121 after the final rule began)
function loadFocused(): Genome | null {
  const path = join(OUT, "tournament", "candidates.jsonl");
  if (DRY || !existsSync(path)) return null;
  let started = false;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    if (line.includes('"final-rule-start"')) {
      started = true;
      continue;
    }
    if (started && line.includes('"name":"g1121"')) {
      const r = JSON.parse(line) as { genome?: Genome };
      if (r.genome) return validate(r.genome);
    }
  }
  return null;
}
const focusedGenome = loadFocused();
if (focusedGenome) arenaCells.push(gen("focused", "focused (g1121): an operating point on the judge's dial, not the pick", focusedGenome));
else if (!DRY) notes.arena!.push("focused (g1121) was not found in candidates.jsonl after the final rule began, so it was not run.");
W.frontier.forEach((f, i) => arenaCells.push(gen(`frontier_${i + 1}`, `frontier: ${f.level} (${f.name})`, f.genome)));
let adpRoot: string | null = null;
if (W.adpReferenced && PARTS.has("arena")) {
  const r = REPORT_ONLY ? { root: existsSync(`/tmp/heldout-adp${DRY ? "-dry" : ""}`) ? `/tmp/heldout-adp${DRY ? "-dry" : ""}` : null, note: "report only" } : prepareRoot("adp", patchApply("/tmp/variants/adp/adp.patch"));
  adpRoot = r.root;
  notes.arena!.push(adpRoot ? `ADP: /tmp/variants/adp/adp.patch ${r.note} (${adpRoot}); status_quo_60 re-run there on the first two seeds to check the court is identical.` : `ADP skipped: the patch ${r.note}.`);
  if (adpRoot) arenaCells.push({ id: "adp", label: "adp (learned value, temp copy)", policy: "adp", root: adpRoot });
} else if (PARTS.has("arena")) notes.arena!.push("ADP: winner.json does not reference it, so it was not run.");
const identityCells: { a: CellSpec; b: CellSpec; seeds: number[]; what: string }[] = [];
if (registered) identityCells.push({ a: winnerCell, b: gen("winner_genome", "winner as a zoo genome", W.genome), seeds: SEEDS.slice(0, 2), what: "benchtime_final (registered) equals the winner's genome run as a zoo cell" });
if (adpRoot) identityCells.push({ a: today, b: { ...today, id: "sq_adp_root", root: adpRoot }, seeds: SEEDS.slice(0, 2), what: "status_quo_60 in the ADP temp copy equals the package's" });

// ablation: each gene of the winner switched off (or to today's rule); each added to today's way
const g0 = W.genome;
const abl: CellSpec[] = [];
const ablMeta: Record<string, { kind: "off" | "on" | "add" | "diagnostic"; gene: string; from: string; to: string; note?: string }> = {};
function ablate(gene: string, change: Partial<Genome>, label: string, kind: "off" | "on" | "diagnostic" = "off", note?: string) {
  const id = `abl_${gene}_${kind}`;
  const g = validate({ ...g0, ...change, weights: { ...g0.weights, ...(change.weights ?? {}) } });
  const from = Object.keys(change).map((k) => `${k}=${JSON.stringify((g0 as any)[k])}`).join(", ");
  const to = Object.keys(change).map((k) => `${k}=${JSON.stringify((g as any)[k])}`).join(", ");
  abl.push(gen(id, label, g));
  ablMeta[id] = { kind, gene, from, to, note };
}
function toggle(gene: keyof Genome, offVal: unknown, onVal: unknown, name: string, extraOn: Partial<Genome> = {}) {
  const cur = (g0 as any)[gene];
  if (JSON.stringify(cur) !== JSON.stringify(offVal)) ablate(String(gene), { [gene]: offVal } as Partial<Genome>, `${name} off`);
  else ablate(String(gene), { [gene]: onVal, ...extraOn } as Partial<Genome>, `${name} on (off in the winner)`, "on");
}
toggle("desk", false, true, "process desk");
toggle("checkin", false, true, "day-before check-in");
if (g0.checkin) toggle("checkinRobust", false, true, "robust check-in (release once)");
else ablate("checkinRobust", { checkin: true, checkinRobust: true }, "check-in with release-once robustness on (both off in the winner)", "on");
toggle("calibration", "off", "pscale", "calibration");
toggle("caseEstimate", false, true, "per-case estimate (the prior only when off)");
toggle("priorCheck", false, true, "prior check (PUCAR's P against its hearing counts)");
toggle("cluster", false, true, "advocate clustering");
toggle("callTimes", false, true, "fixed call times");
if (g0.coverage !== "none") ablate("coverage", { coverage: "none" }, `coverage mechanism (${g0.coverage}) off: the 15% floor only`);
else ablate("coverage", { coverage: "rotation", rotationDays: 40 }, "coverage rotation on, 40 working days (none in the winner)", "on");
if (g0.firstDates !== "spread") ablate("firstDates", { firstDates: "spread" }, `first dates by today's spread (winner: ${g0.firstDates})`);
else ablate("firstDates", { firstDates: "priority" }, "first dates by priority (winner: today's spread)", "on");
if (g0.nextDate !== "pucar") ablate("nextDate", { nextDate: "pucar" }, `next dates by PUCAR's gap (winner: ${g0.nextDate})`);
else ablate("nextDate", { nextDate: "earliest" }, "next dates earliest with room (winner: PUCAR's gap)", "on");
if (g0.selection !== "fifo") ablate("selection", { selection: "fifo" }, `selection first come first served (winner: ${g0.selection})`);
else ablate("selection", { selection: "knapsack" }, "selection by knapsack (winner: fifo)", "on");
if (g0.fillTarget !== 1) ablate("fillTarget", { fillTarget: 1 }, `fill target 100% (winner: ${Math.round(g0.fillTarget * 100)}%)`);
if (g0.standbyShare > 0) ablate("standby", { standbyShare: 0 }, `standby list off (winner: ${Math.round(g0.standbyShare * 100)}%)`);
else ablate("standby", { standbyShare: 0.1 }, "standby list 10% (none in the winner)", "on");
if (g0.quickRelist) ablate("quickRelist", { quickRelist: false }, "quick relisting of failed and unheard matters off");
if (g0.coverage !== "none" && g0.ageingFloor > 0.15) ablate("ageingFloor", { ageingFloor: 0.15 }, `ageing floor at the 15% minimum (winner: ${Math.round(g0.ageingFloor * 100)}%)`);
ablate("floor0", { enforceFloor: false }, "DIAGNOSTIC ONLY: no 15% ageing floor (not a permitted configuration)", "diagnostic", "the brief makes the 15% floor unchangeable; this row only prices it");
// additions to today's way, through the zoo's own status_quo_60 preset
const sqz = validate(PRESETS.status_quo_60!);
const zooToday = gen("add_base", "today's way as a zoo genome (reference for the additions)", sqz);
const adds: CellSpec[] = [zooToday];
const addMeta: Record<string, { gene: string; change: string; note?: string }> = {};
function add(gene: string, change: Partial<Genome>, label: string, note?: string) {
  const id = `add_${gene}`;
  adds.push(gen(id, label, { ...sqz, ...change, weights: { ...sqz.weights, ...(change.weights ?? {}) } }));
  addMeta[id] = { gene, change: JSON.stringify(change), note };
}
add("desk", { desk: true }, "today's way + process desk");
add("checkin", { checkin: true, checkinRobust: g0.checkinRobust }, `today's way + day-before check-in${g0.checkinRobust ? " (robust)" : ""}`);
add("callTimes", { callTimes: true }, "today's way + fixed call times");
add("coverage", { coverage: g0.coverage === "none" ? "rotation" : g0.coverage, rotationDays: g0.rotationDays, rotationCap: g0.rotationCap, rotationAll: g0.rotationAll, ageingFloor: g0.ageingFloor, enforceFloor: true }, `today's way + the winner's coverage (${g0.coverage === "none" ? "rotation" : g0.coverage}) with the 15% floor`);
add("nextDate", { nextDate: g0.nextDate, windowDays: g0.windowDays, relistDays: g0.relistDays, relistCap: g0.relistCap, quickRelist: g0.quickRelist, gapOfHeard: g0.gapOfHeard, countDiary: false, promiseFill: g0.promiseFill }, `today's way + the winner's next-date rule (${g0.nextDate}, minutes diary)`);
add("firstDates", { firstDates: g0.firstDates === "spread" ? "priority" : g0.firstDates, initialFill: g0.initialFill, firstOldShare: g0.firstOldShare, countDiary: false, promiseFill: g0.promiseFill }, `today's way + the winner's first dates (${g0.firstDates === "spread" ? "priority" : g0.firstDates})`);
add("selection", { selection: g0.selection === "listAll" ? "knapsack" : g0.selection, fillTarget: g0.fillTarget, standbyShare: g0.standbyShare, caseEstimate: g0.caseEstimate, calibration: g0.calibration, priorCheck: g0.priorCheck, enforceFloor: true }, `today's way + the winner's daily selection (${g0.selection}, fill ${Math.round(g0.fillTarget * 100)}%, its estimates, the 15% floor)`, "estimates, calibration and the prior check only matter once there is a selection, so they come with it");
notes.ablation!.push("Not added to today's way on their own: calibration, per-case estimates and the prior check (today's way lists every due case, so estimates change nothing until there is a selection; they ride with the selection row), and clustering (it bundles next dates only under a smart next-date rule and swaps only inside the knapsack).");

// robustness: each condition runs the winner and today's way on the same seeds
interface Cond { id: string; label: string; spec: Partial<CellSpec>; todayToo: boolean }
const conds: Cond[] = [
  { id: "nobehaviour", label: "behaviour responses off (--no-behaviour)", spec: { noBehaviour: true }, todayToo: true },
  { id: "cv025", label: "duration CV 0.25", spec: { world: { durationCv: 0.25 } }, todayToo: true },
  { id: "cv100", label: "duration CV 1.0", spec: { world: { durationCv: 1.0 } }, todayToo: true },
  { id: "process15", label: "process returns 1.5x slower", spec: { world: { processScale: 1.5 } }, todayToo: true },
  { id: "falsealarm2", label: "check-in false alarms doubled (0.05 to 0.10)", spec: { world: { falseAlarmScale: 2 } }, todayToo: true },
  { id: "pbias_up", label: "planner shown P(substantive) +30%", spec: { plannerBias: 0.3 }, todayToo: true },
  { id: "pbias_down", label: "planner shown P(substantive) -30%", spec: { plannerBias: -0.3 }, todayToo: true },
];
for (const r of [1, 2, 3, 4, 5]) if (existsSync(join(ROOT, "data", `roster_3000_seed${r}.csv`))) conds.push({ id: `roster${r}`, label: `roster seed ${r}`, spec: { roster: `roster_3000_seed${r}` }, todayToo: true });
const robCells: { cond: Cond; w: CellSpec; t: CellSpec }[] = conds.map((c) => ({
  cond: c,
  w: { ...winnerCell, ...c.spec, id: `rob_${c.id}_winner`, label: `winner, ${c.label}` } as CellSpec,
  t: { ...today, ...c.spec, id: `rob_${c.id}_today`, label: `today's way, ${c.label}` } as CellSpec,
}));
if (!g0.checkin) notes.robustness!.push("The winner does not run the day-before check-in, so doubling false alarms can only move it through the world's other draws (it should not move at all); today's way does not ask either.");

// styles
let rulesRoot: string | null = null;
let rulesNote = "";
const styleCells: { style: string; plain: string; cell: CellSpec; how: string }[] = [];
let winnerInRules: CellSpec | null = null;
let todayInRules: CellSpec | null = null;
async function buildStyles(): Promise<void> {
  const patch = "/tmp/variants/rules/rules.patch";
  // the rules patch applied to the package itself (the coordinator's route): presets from its own rules.ts
  const own = join(ROOT, "src/planner/zoo/rules.ts");
  if (existsSync(own)) {
    try {
      const mod = (await import(own)) as { RULE_PRESETS: Record<string, { rules: Record<string, unknown>; description: string }> };
      const map: [string, string, string][] = [["sehgal", "sehgal_way", "Sehgal's rules"], ["dimakar", "dimakar_way", "Dimakar's rules"], ["joshi", "joshi_way", "Joshi's rules"]];
      for (const [plain, key, label] of map) {
        const p = mod.RULE_PRESETS[key];
        if (!p) continue;
        styleCells.push({ style: label, plain, how: p.description, cell: { ...(registered ? { policy: "benchtime_final" } : { genome: W.genome }), id: `style_${plain}`, label: `winner + ${label}`, config: JSON.parse(JSON.stringify(p.rules)) } as CellSpec });
      }
      rulesNote = "RULE_PRESETS.sehgal_way, dimakar_way and joshi_way from the package's src/planner/zoo/rules.ts (the rules patch as applied to the package), laid over the winner's configuration (applyRules semantics: the preset wins field by field, weights merged, the 15% floor clamped)";
      if (styleCells.length === 3) return;
      rulesNote += "; a preset was missing, so the zoo fields fill in";
    } catch (e) {
      rulesNote = `could not load the package's RULE_PRESETS (${String(e).slice(0, 120)})`;
      styleCells.length = 0;
    }
  } else if (existsSync(patch)) {
    const r = REPORT_ONLY ? { root: existsSync(`/tmp/heldout-rules${DRY ? "-dry" : ""}`) ? `/tmp/heldout-rules${DRY ? "-dry" : ""}` : null, note: "report only" } : prepareRoot("rules", patchApply(patch));
    rulesRoot = r.root;
    rulesNote = rulesRoot ? `the judges' rules from ${patch}, ${r.note} (${rulesRoot})` : `${patch} exists but ${r.note}; fell back to the zoo's existing rule fields`;
  } else rulesNote = `${patch} did not exist when this ran; the zoo's existing rule fields approximate each style`;
  if (rulesRoot && styleCells.length === 0) {
    try {
      const mod = (await import(join(rulesRoot, "src/planner/zoo/rules.ts"))) as { RULE_PRESETS: Record<string, { rules: Record<string, unknown>; description: string }> };
      const P = mod.RULE_PRESETS;
      const map: [string, string, string][] = [["sehgal", "sehgal_way", "Sehgal's rules"], ["dimakar", "dimakar_way", "Dimakar's rules"], ["joshi", "joshi_way", "Joshi's rules"]];
      for (const [plain, key, label] of map) {
        const p = P[key];
        if (!p) continue;
        styleCells.push({ style: label, plain, how: p.description, cell: { ...(registered ? { policy: "benchtime_final" } : { genome: W.genome }), id: `style_${plain}`, label: `winner + ${label}`, config: JSON.parse(JSON.stringify(p.rules)), root: rulesRoot } as CellSpec });
      }
      winnerInRules = { ...winnerCell, id: "winner_rules_root", root: rulesRoot };
      todayInRules = { ...today, id: "today_rules_root", root: rulesRoot };
      if ((styleCells.length as number) === 3) return;
      rulesNote += "; RULE_PRESETS lacked a judge, so the missing ones use the zoo fields";
    } catch (e) {
      rulesNote += `; could not load its RULE_PRESETS (${String(e).slice(0, 120)}), so the zoo fields are used`;
      rulesRoot = null;
      winnerInRules = todayInRules = null;
      styleCells.length = 0;
    }
  }
  const have = new Set(styleCells.map((s) => s.plain));
  if (!have.has("sehgal"))
    styleCells.push({ style: "Sehgal's rules", plain: "sehgal", how: "fresh and notice matters 11:00-13:30 and the oldest 14:30-16:30 (config.blocks), a matter not reached returns the same weekday next week (carryForward), lists to 130% of the day (fillTarget 1.3). Not expressible without the rules patch: carried matters taken first.", cell: gen("style_sehgal", "winner + Sehgal's rules (zoo fields)", g0, { config: { blocks: SEHGAL_BLOCKS, carryForward: true, fillTarget: 1.3 } }) });
  if (!have.has("dimakar")) {
    const EVID = ["EXAMINATION_UNDER_S351_BNSS", "EVIDENCE_COMPLAINANT", "EVIDENCE_ACCUSED", "ARGUMENTS", "JUDGEMENT"];
    const APPR = ["ADMISSION", "DELAY_CONDONATION_HEARING", "COGNIZANCE", "APPEARANCE", "WARRANT", "PLEA", "BAIL", "REPORTS", "APPLICATION_REVIEW"];
    const byDay: Record<number, unknown[]> = {};
    for (const d of [1, 3, 5]) byDay[d] = [{ id: "evidence", start: "10:30", end: "17:00", types: EVID, oldestFirst: true }];
    for (const d of [2, 4]) byDay[d] = [{ id: "appearance", start: "10:30", end: "17:00", types: APPR, oldestFirst: true }];
    styleCells.push({ style: "Dimakar's rules", plain: "dimakar", how: "evidence, arguments and judgments Monday, Wednesday, Friday; appearances and process Tuesday, Thursday (config.blocksByWeekday, oldest first inside the day); an advocate's dates bundled and matters called together (cluster, callOrder cluster); never past the day (fillTarget 1).", cell: gen("style_dimakar", "winner + Dimakar's rules (zoo fields)", { ...g0, cluster: true, callOrder: "cluster" }, { config: { blocksByWeekday: byDay, clusterByAdvocate: true, fillTarget: 1 } }) });
  }
  if (!have.has("joshi"))
    styleCells.push({ style: "Joshi's rules", plain: "joshi", how: "fresh matters first (selection youngest), fairness weight 0; the 15% floor for 4+ year cases still holds. Not expressible without the rules patch: a newest-first block that keeps the winner's own selection.", cell: gen("style_joshi", "winner + Joshi's rules (zoo fields)", { ...g0, selection: "youngest", weights: { ...g0.weights, fairness: 0 } }, { config: { weights: { throughput: g0.weights.throughput, substantiveness: 1, fairness: 0, predictability: g0.weights.predictability, trips: g0.weights.trips } } }) });
}

// settlement
let settleRoot: string | null = null;
let settleNote = "";
const settleCells: CellSpec[] = [];
function buildSettlement(): void {
  const r = REPORT_ONLY ? { root: existsSync(`/tmp/heldout-settle${DRY ? "-dry" : ""}`) ? `/tmp/heldout-settle${DRY ? "-dry" : ""}` : null, note: "report only" } : prepareRoot("settle", settlementApply);
  settleRoot = r.root;
  settleNote = settleRoot ? `src/planner/settlement.ts taken from /tmp/variants/settlement/settlement-component.diff into a temp copy (${settleRoot}); its index.ts hunks target an older registry and were not used; the winner is wrapped with withSettlementDays in the worker` : `settlement skipped: ${r.note}`;
  if (!settleRoot) return;
  settleCells.push(gen("settle_plain", "winner (in the settlement temp copy)", g0, { root: settleRoot }));
  settleCells.push(gen("settle_daily", "winner + settlement_daily (daily tail)", g0, { root: settleRoot, settlement: "daily_tail" }));
  settleCells.push(gen("settle_friday_reports", "winner + friday_reports", g0, { root: settleRoot, settlement: "friday_reports" }));
}

// ---------------------------------------------------------------------------------------------
// Reading results

const flatsOf = (cell: CellSpec, seeds: number[]): (Flat | null)[] => runsOf(cell, seeds).map((r) => (r ? flat(r.scorecards) : null));
const complete = (cell: CellSpec, seeds: number[]): boolean => runsOf(cell, seeds).every(Boolean);

const DIRECTION = new Map<string, "higher" | "lower" | null>(SCORECARD_FIELDS.map((m) => [`${m.family}.${m.key}`, m.better]));
DIRECTION.set("derived.meritsDisposals", "higher");
DIRECTION.set("extra.meritsDisposals", "higher");
const LABEL = new Map<string, string>(SCORECARD_FIELDS.map((m) => [`${m.family}.${m.key}`, m.label]));
LABEL.set("derived.meritsDisposals", "Disposals on the merits (verdict + settlement + compounded)");
LABEL.set("extra.meritsDisposals", "Disposals on the merits (verdict + settlement + compounded; same as derived)");
// labels shared by two families (substantiveness, utilisation) carry the family
const dupLabels = new Set([...LABEL.values()].filter((v, i, a) => a.indexOf(v) !== i));
const lab = (m: string) => {
  const l = LABEL.get(m) ?? m;
  return dupLabels.has(l) ? `${l} (${m.split(".")[0]})` : l;
};
const CATALOGUE = [...SCORECARD_FIELDS.map((m) => `${m.family}.${m.key}`), "derived.meritsDisposals"];
function measureKeys(input: (Flat | null | (Flat | null)[])[]): string[] {
  const present = new Set<string>();
  const flats = input.flatMap((x) => (Array.isArray(x) ? x : [x]));
  for (const f of flats) if (f) for (const k of Object.keys(f)) present.add(k);
  const ordered = CATALOGUE.filter((k) => present.has(k));
  return [...ordered, ...[...present].filter((k) => !CATALOGUE.includes(k) && k !== "extra.meritsDisposals").sort()];
}
/** "better" / "worse" when the paired interval excludes 0 on a measure with a direction */
function verdict(m: string, lo: number, hi: number): "better" | "worse" | "" {
  const d = DIRECTION.get(m);
  if (!d || !Number.isFinite(lo) || !Number.isFinite(hi)) return "";
  if (lo > 0) return d === "higher" ? "better" : "worse";
  if (hi < 0) return d === "higher" ? "worse" : "better";
  return "";
}
const ci = (m: string, x: { mean: number; lo: number; hi: number }) => `${fmtNum(x.mean, m)} [${fmtNum(x.lo, m)}, ${fmtNum(x.hi, m)}]`;
const dci = (m: string, x: { mean: number; lo: number; hi: number }) => `${fmtDiff(x.mean, m)} [${fmtDiff(x.lo, m)}, ${fmtDiff(x.hi, m)}]`;
const col = (xs: (Flat | null)[], m: string) => xs.map((f) => f?.[m]);

function asRunResults(cells: CellSpec[], seeds: number[], idOf = (c: CellSpec) => c.id, rosterOf = (c: CellSpec) => c.roster ?? "roster_3000_seed42"): RunResult[] {
  const out: RunResult[] = [];
  for (const c of cells)
    runsOf(c, seeds).forEach((r, i) => {
      if (r) out.push({ policyId: idOf(c), worldSeed: seeds[i]!, rosterId: rosterOf(c), scorecards: r.scorecards as Scorecards, hearings: [], days: [] });
    });
  return out;
}
const writeJson = (p: string, d: unknown) => {
  mkdirSync(OUTDIR, { recursive: true });
  writeFileSync(p, JSON.stringify(d, (_k, v) => (typeof v === "number" && !Number.isFinite(v) ? null : v), 1) + "\n");
};
const writeMd = (p: string, lines: string[]) => {
  mkdirSync(OUTDIR, { recursive: true });
  writeFileSync(p, lines.join("\n") + "\n");
};
const guardTable = (g: GuardResult[]): string[] => [
  "| Guardrail | Measure | Margin | Candidate | Today | Paired difference [95% CI] | Bound | Pass | Pass with the tournament's t |",
  "|---|---|---|---|---|---|---|---|---|",
  ...g.map((x) => `| ${x.label} | ${x.measure} | ${x.margin} | ${fmtNum(x.candMean, x.measure)} | ${fmtNum(x.todayMean, x.measure)} | ${x.vs === "absolute" ? "(absolute limit on the mean)" : dci(x.measure, { mean: x.diff, lo: x.lo, hi: x.hi })} | ${x.vs === "absolute" ? fmtNum(x.bound, x.measure) : fmtDiff(x.bound, x.measure)} | ${x.pass ? "yes" : "**NO**"} | ${x.passTournamentT ? "yes" : "no"} |`),
];

// ---------------------------------------------------------------------------------------------
// Reports

const HEADLINE_MEASURES: [string, string, string][] = [
  ["extra.substantivePerDay", "Useful hearings a day", "Useful hearings a day: hearings that moved a case to its next stage, per sitting day."],
  ["derived.meritsDisposals", "Cases decided on the merits", "Cases decided on the merits in the quarter: verdicts, settlements and compounding."],
  ["extra.disposed", "All headline disposals", "All headline disposals, adding acquittals for the complainant's default and dismissals for steps not taken."],
  ["extra.promisesHonouredInclDesk", "Dates honoured", "Dates honoured: the share of promised dates on which the court heard the case or passed a desk order that day."],
  ["extra.promisesBroken", "Dates broken or never given", "Dates broken or never given: promised dates with no order passed, plus cases given no date inside the quarter."],
  ["siddarth.neverHeard", "Cases never heard", "Cases never heard: roster cases with no hearing reached in the quarter."],
  ["readme.backlog4ySubstantiveShare", "Old cases moved on", "Old cases moved on: the share of 4+ year old cases that had at least one hearing that moved them forward."],
  ["extra.tripsPerSubstantive", "Trips per useful hearing", "Trips per useful hearing: parties and advocates who came, per hearing that moved a case."],
  ["extra.minutesWaited", "Minutes waited", "Minutes waited per person heard, from the call time given to the minute the hearing started."],
  ["caseStudy.nextDateExcessDays", "Next-date overshoot (days)", "Days a next date overshoots PUCAR's procedural gap for the purpose just heard."],
];

function arenaReport(): { md: string[]; json: unknown; headline: string[] } | null {
  const seeds = SEEDS;
  const cells = arenaCells.filter((c) => complete(c, seeds));
  if (!cells.find((c) => c.id === winnerCell.id) || !cells.find((c) => c.id === TODAY)) return null;
  const F = new Map(cells.map((c) => [c.id, flatsOf(c, seeds)]));
  const wf = F.get(winnerCell.id)!;
  const tf = F.get(TODAY)!;
  const keys = measureKeys([...F.values()].flat());
  // per cell: every measure, t interval; paired vs today
  const perCell = cells.map((c) => {
    const fl = F.get(c.id)!;
    const measures: Record<string, unknown> = {};
    const paired: Record<string, unknown> = {};
    for (const m of keys) {
      measures[m] = tInterval(col(fl, m).filter((x): x is number => typeof x === "number"));
      if (c.id !== TODAY) paired[m] = pairedT(col(fl, m), col(tf, m));
    }
    return { id: c.id, label: c.label, spec: { ...c, genome: c.genome ? "(genome below)" : undefined }, measures, pairedVsToday: paired, guardrails: c.id === TODAY ? null : evalGuardrails(fl, tf, crit) };
  });
  // the winner against the best baseline on each measure
  const vsBest: Record<string, unknown> = {};
  for (const m of keys) {
    const d = DIRECTION.get(m);
    if (!d) continue;
    const bs = BASELINES.filter((b) => F.has(b)).map((b) => ({ b, mean: tInterval(col(F.get(b)!, m).filter((x): x is number => typeof x === "number")).mean })).filter((x) => Number.isFinite(x.mean));
    if (!bs.length) continue;
    bs.sort((x, y) => (d === "higher" ? y.mean - x.mean : x.mean - y.mean));
    const best = bs[0]!.b;
    vsBest[m] = { best, ...pairedT(col(wf, m), col(F.get(best)!, m)) };
  }
  const wg = evalGuardrails(wf, tf, crit);
  // dominance and every rival that beats the winner on a measure
  const guarded = crit.guardrails.map((g) => ({ m: g.measure, better: g.op === ">=" ? 1 : -1 }));
  const meanOf = (id: string, m: string) => tInterval(col(F.get(id)!, m).filter((x): x is number => typeof x === "number")).mean;
  const rivalsHere = cells.filter((c) => c.id !== winnerCell.id).map((c) => c.id);
  const dominators = rivalsHere.filter((r) => guarded.every((g) => (meanOf(r, g.m) - meanOf(winnerCell.id, g.m)) * g.better > 1e-9));
  const losses: { measure: string; rival: string; winner: number; rivalMean: number; diff: ReturnType<typeof pairedT>; significant: boolean }[] = [];
  for (const m of keys) {
    const d = DIRECTION.get(m);
    if (!d) continue;
    for (const r of rivalsHere) {
      const p = pairedT(col(wf, m), col(F.get(r)!, m));
      const worse = d === "higher" ? p.mean < -1e-9 : p.mean > 1e-9;
      if (worse) losses.push({ measure: m, rival: r, winner: meanOf(winnerCell.id, m), rivalMean: meanOf(r, m), diff: p, significant: verdict(m, p.lo, p.hi) === "worse" });
    }
  }
  const identity = identityCells.map((x) => {
    const a = runsOf(x.a, x.seeds);
    const b = runsOf(x.b, x.seeds);
    const same = a.every((r, i) => r && b[i] && JSON.stringify(flat(r.scorecards)) === JSON.stringify(flat(b[i]!.scorecards)));
    return { check: x.what, seeds: x.seeds, identical: a.every(Boolean) && b.every(Boolean) ? same : null };
  });
  // --- markdown
  const L: string[] = [];
  L.push(`# Held-out test: the tournament winner against every rival (seeds ${seeds[0]}-${seeds[seeds.length - 1]})`, "");
  L.push(`Generated ${new Date().toISOString()} (${nowHHMM()} IST). Roster roster_3000_seed42, horizon 2026-10-01 to 2026-12-15, world seeds ${seeds[0]}-${seeds[seeds.length - 1]} (${seeds.length}), every run through the CLI arena path (runArena, world roster id roster_3000_seed42). All numbers are on synthetic data (PUCAR's generated roster and a simulated court calibrated to PUCAR's tables).`, "");
  L.push(`**The pick: ${W.name}** (${W.origin}), registered as \`benchtime_final\`. ${describeGenome(W.genome)}`, "");
  if (W.raw) L.push(`Tournament record: failed ${W.failedDecide ?? "?"} guardrails on the decision seeds 7-20 and ${W.failedConfirm ?? "?"} on the confirmation seeds 21-30.${W.nothingPassed ? " Nothing passed every guardrail in the tournament, so this is the candidate winner.json names." : ""}`, "");
  L.push(`Pre-registered: a guardrail failure on 31-60 is reported here and the pick does not change. Guardrails follow ${crit.name}: paired non-inferiority against status_quo_60, passing when the 95% t bound of (candidate minus today) clears the margin; t uses ${seeds.length - 1} degrees of freedom (t = ${seeds.length > 1 ? tq(seeds.length - 1).toFixed(3) : "n/a"}); the tournament script's table uses 1.96 from 20 degrees of freedom, shown in the last column.`, "");
  for (const n of notes.arena!) L.push(`- ${n}`);
  for (const x of identity) L.push(`- Identity check: ${x.check} on seeds ${x.seeds.join(", ")}: ${x.identical === null ? "not run" : x.identical ? "identical, every measure" : "**DIFFERENT**"}.`);
  L.push("");
  const failed = wg.filter((g) => !g.pass);
  L.push(`## The ${crit.guardrails.length} guardrails on the held-out seeds`, "");
  L.push(failed.length === 0 ? `**Every guardrail holds on seeds ${seeds[0]}-${seeds[seeds.length - 1]}.**` : `**${failed.length} of ${crit.guardrails.length} guardrails fail on seeds ${seeds[0]}-${seeds[seeds.length - 1]}: ${failed.map((g) => g.label).join("; ")}.** Reported as pre-registered; the pick does not change.`, "");
  L.push(...guardTable(wg), "");
  L.push(dominators.length ? `Rivals better than the pick on every guarded measure (means): ${dominators.join(", ")}.` : "No rival is better than the pick on every guarded measure (means over these seeds).", "");
  // reading notes: how each failure arises, rivals failing fewer, the t table, and how well the seeds pair
  const readNotes: string[] = [];
  for (const g of failed) {
    if (g.vs === "absolute") continue;
    const a = col(wf, g.measure).filter((x): x is number => typeof x === "number");
    const b = col(tf, g.measure).filter((x): x is number => typeof x === "number");
    const constant = a.length > 0 && a.every((x) => x === a[0]);
    const mid = [...b].sort((x, y) => x - y)[Math.floor(b.length / 2)];
    readNotes.push(constant
      ? `${g.label}: the pick scores ${fmtNum(a[0], g.measure)} on every one of the ${a.length} seeds; today's way scores ${fmtNum(Math.min(...b), g.measure)} to ${fmtNum(Math.max(...b), g.measure)} (median ${fmtNum(mid, g.measure)}). The pick is no worse than today on any seed, and the bound fails only through today's own seed-to-seed spread. By the pre-registered rule this is still a failure.`
      : `${g.label}: paired difference ${dci(g.measure, { mean: g.diff, lo: g.lo, hi: g.hi })}, bound ${fmtDiff(g.bound, g.measure)} against a margin of ${g.margin}.`);
  }
  const fewer = perCell.filter((p) => p.guardrails && p.id !== winnerCell.id && (p.guardrails as GuardResult[]).filter((x) => !x.pass).length < failed.length);
  for (const p of fewer) readNotes.push(`${p.id} (${p.label}) fails fewer guardrails than the pick on these seeds (${(p.guardrails as GuardResult[]).filter((x) => !x.pass).map((x) => x.label).join("; ") || "none"}). Pre-registered: the pick does not change; the comparison is reported.`);
  const tDiff = wg.filter((g) => g.pass !== g.passTournamentT);
  readNotes.push(tDiff.length ? `The tournament's t table (1.96) would change: ${tDiff.map((g) => g.label).join("; ")}.` : `The tournament script's t table (1.96 from 20 degrees of freedom) gives the same verdict on every guardrail as t = ${tq(seeds.length - 1).toFixed(3)}.`);
  const pairKeys = ["extra.substantivePerDay", "derived.meritsDisposals", "extra.promisesHonouredInclDesk", "siddarth.neverHeard"];
  readNotes.push(`Shared seeds pair the courts: correlation across seeds between the pick and today's way is ${pairKeys.map((m) => `${fmtNum(pairedT(col(wf, m), col(tf, m)).corr, "x")} for ${lab(m).toLowerCase()}`).join(", ")}.`);
  L.push("### Reading notes", "", ...readNotes.map((n) => `- ${n}`), "");
  L.push("## Key measures, every policy (mean [95% t interval])", "");
  const key10 = [...new Set([...HEADLINE_MEASURES.map((h) => h[0]), ...crit.guardrails.map((g) => g.measure), "siddarth.heldOnPromisedDate", "caseStudy.heldAsScheduled", "caseStudy.heldAsScheduledAllDue", "extra.heldSubstantiveAllDue", "extra.firstPromiseKept"])].filter((m) => keys.includes(m));
  L.push(`| Measure | ${cells.map((c) => c.id).join(" | ")} |`, `|---|${cells.map(() => "---").join("|")}|`);
  for (const m of key10) L.push(`| ${lab(m)} | ${cells.map((c) => ci(m, tInterval(col(F.get(c.id)!, m).filter((x): x is number => typeof x === "number")))).join(" | ")} |`);
  L.push("");
  L.push("## Paired differences against status_quo_60, every measure (candidate minus today, 95% t interval)", "");
  const others = cells.filter((c) => c.id !== TODAY);
  L.push(`| Measure | ${others.map((c) => c.id).join(" | ")} |`, `|---|${others.map(() => "---").join("|")}|`);
  for (const m of keys) L.push(`| ${lab(m)} | ${others.map((c) => { const p = pairedT(col(F.get(c.id)!, m), col(tf, m)); const v = verdict(m, p.lo, p.hi); return `${dci(m, p)}${v ? ` ${v}` : ""}`; }).join(" | ")} |`);
  L.push("");
  L.push("## The winner against the best baseline on each measure (paired, 95% t interval)", "");
  L.push("| Measure | Best baseline | Its mean | Winner minus best |", "|---|---|---|---|");
  for (const [m, v] of Object.entries(vsBest) as [string, any][]) L.push(`| ${lab(m)} | ${v.best} | ${fmtNum(meanOf(v.best, m), m)} | ${dci(m, v)}${verdict(m, v.lo, v.hi) ? ` ${verdict(m, v.lo, v.hi)}` : ""} |`);
  L.push("");
  L.push("## Guardrails for every rival (paired against status_quo_60, same rule)", "");
  L.push(`| Policy | Failed | Which |`, "|---|---|---|");
  for (const p of perCell) if (p.guardrails) L.push(`| ${p.id} | ${(p.guardrails as GuardResult[]).filter((g) => !g.pass).length} | ${(p.guardrails as GuardResult[]).filter((g) => !g.pass).map((g) => g.label).join("; ") || "none"} |`);
  L.push("");
  L.push("## Every measure where the winner loses to a rival (mean worse; bold where the paired 95% interval excludes zero)", "");
  L.push("| Measure | Rival | Winner | Rival | Winner minus rival [95% CI] |", "|---|---|---|---|---|");
  for (const x of losses) L.push(`| ${x.significant ? "**" : ""}${lab(x.measure)}${x.significant ? "**" : ""} | ${x.rival} | ${fmtNum(x.winner, x.measure)} | ${fmtNum(x.rivalMean, x.measure)} | ${dci(x.measure, x.diff)} |`);
  L.push("");
  L.push("## The full arena report (report.ts: every scorecard field, bootstrap intervals, paired against status_quo_60)", "");
  const summary = summarise(asRunResults(cells, seeds), TODAY, { start: "2026-10-01", end: "2026-12-15", capacityMinutes: 420, note: "extra.meritsDisposals = verdict + settlement + compounded (criteria.json's derived.meritsDisposals), added by the experiment script." });
  L.push(renderMarkdown(summary, { title: "Arena on the held-out seeds" }).replace(/^# /gm, "### ").replace(/^## /gm, "#### "));
  // --- headline
  const H: string[] = [];
  H.push("# Headline: the winner against today's way on the held-out seeds", "");
  H.push(`Winner: **${W.name}**, registered as \`benchtime_final\`. Today's way: status_quo_60 (every due case listed, a flat 60-day gap). ${seeds.length} held-out world seeds (${seeds[0]}-${seeds[seeds.length - 1]}) on PUCAR's seed-42 roster, the CLI arena path, synthetic data. Each line: the winner, today, the paired difference with its 95% interval (t, ${seeds.length - 1} degrees of freedom). Everything is advisory; a judge signs every order.`, "");
  H.push("| # | Measure | Winner | Today | Difference [95% CI] | |", "|---|---|---|---|---|---|");
  HEADLINE_MEASURES.forEach(([m, name], i) => {
    const a = tInterval(col(wf, m).filter((x): x is number => typeof x === "number"));
    const b = tInterval(col(tf, m).filter((x): x is number => typeof x === "number"));
    const p = pairedT(col(wf, m), col(tf, m));
    const v = verdict(m, p.lo, p.hi);
    H.push(`| ${i + 1} | ${name} | ${ci(m, a)} | ${ci(m, b)} | ${dci(m, p)} | ${v === "better" ? "better" : v === "worse" ? "**worse**" : "no clear difference"} |`);
  });
  H.push("");
  HEADLINE_MEASURES.forEach(([m, , s], i) => {
    const a = tInterval(col(wf, m).filter((x): x is number => typeof x === "number"));
    const b = tInterval(col(tf, m).filter((x): x is number => typeof x === "number"));
    const p = pairedT(col(wf, m), col(tf, m));
    H.push(`${i + 1}. ${s} Winner ${fmtNum(a.mean, m)}, today ${fmtNum(b.mean, m)} (difference ${dci(m, p)}).`);
  });
  H.push("");
  H.push(failed.length === 0 ? `All ${crit.guardrails.length} pre-registered guardrails hold on seeds ${seeds[0]}-${seeds[seeds.length - 1]}.` : `Guardrails that fail on seeds ${seeds[0]}-${seeds[seeds.length - 1]} (${failed.length} of ${crit.guardrails.length}; pre-registered: reported, the pick stands): ${failed.map((g) => `${g.label} (difference ${g.vs === "absolute" ? fmtNum(g.diff, g.measure) : dci(g.measure, { mean: g.diff, lo: g.lo, hi: g.hi })}, margin ${g.margin})`).join("; ")}.`, "");
  H.push("Reading notes (details in heldout.md):", "", ...readNotes.map((n) => `- ${n}`), "");
  // the judge's dial: operating points, not the pick
  const dial = [TODAY, winnerCell.id, "winner_calltimes", "focused"].filter((id) => F.has(id));
  if (dial.length > 2) {
    const dialName: Record<string, string> = { [TODAY]: "Today's way", [winnerCell.id]: `${W.name} (the pick)`, winner_calltimes: `${W.name} + call times`, focused: "focused (g1121)" };
    const DM: [string, string][] = [
      ["extra.substantivePerDay", "Useful hearings a day"],
      ["derived.meritsDisposals", "Cases decided on the merits"],
      ["extra.promisesHonouredInclDesk", "Dates honoured"],
      ["extra.promisesBroken", "Dates broken or never given"],
      ["extra.casesScheduled", "Cases given a date inside the quarter"],
      ["siddarth.neverHeard", "Cases never heard"],
      ["readme.backlog4yHeardShare", "Old cases heard at all"],
      ["readme.backlog4ySubstantiveShare", "Old cases moved on"],
      ["extra.minutesWaited", "Minutes waited"],
      ["extra.tripsPerSubstantive", "Trips per useful hearing"],
    ];
    H.push("## The judge's dial (operating points, not the pick)", "");
    H.push(`The same engine at different settings, on the same ${seeds.length} held-out seeds; mean [95% t interval]. The pick is ${W.name}; the others show what a judge trades by turning the dial. Guardrails failed counts the ${crit.guardrails.length} pre-registered guardrails against today's way on these seeds.`, "");
    H.push(`| Measure | ${dial.map((id) => dialName[id]).join(" | ")} |`, `|---|${dial.map(() => "---").join("|")}|`);
    for (const [m, name] of DM) H.push(`| ${name} | ${dial.map((id) => ci(m, tInterval(col(F.get(id)!, m).filter((x): x is number => typeof x === "number")))).join(" | ")} |`);
    H.push(`| Guardrails failed | ${dial.map((id) => (id === TODAY ? "" : `${evalGuardrails(F.get(id)!, tf, crit).filter((g) => !g.pass).length}: ${evalGuardrails(F.get(id)!, tf, crit).filter((g) => !g.pass).map((g) => g.label).join("; ") || "none"}`)).join(" | ")} |`);
    H.push("");
  }
  H.push("## Where we lose", "");
  const vsToday = losses.filter((x) => x.rival === TODAY);
  H.push("Against today's way (every measure with a direction where the winner's mean is worse; bold = the paired interval excludes zero):", "");
  for (const x of vsToday) H.push(`- ${x.significant ? "**" : ""}${lab(x.measure)}${x.significant ? "**" : ""}: winner ${fmtNum(x.winner, x.measure)}, today ${fmtNum(x.rivalMean, x.measure)} (${dci(x.measure, x.diff)}).`);
  if (!vsToday.length) H.push("- none");
  H.push("", "Against any rival (significant losses only, the paired interval excludes zero; the full list with non-significant ones is in heldout.md):", "");
  const sig = losses.filter((x) => x.significant && x.rival !== TODAY);
  const byMeasure = new Map<string, typeof sig>();
  for (const x of sig) byMeasure.set(x.measure, [...(byMeasure.get(x.measure) ?? []), x]);
  for (const [m, xs] of byMeasure) H.push(`- ${lab(m)} (winner ${fmtNum(xs[0]!.winner, m)}): ${xs.map((x) => `${x.rival} ${fmtNum(x.rivalMean, m)}`).join(", ")}.`);
  if (!byMeasure.size) H.push("- none");
  H.push("");
  const json = {
    meta: { generated: new Date().toISOString(), seeds, roster: "roster_3000_seed42", horizon: ["2026-10-01", "2026-12-15"], path: "runArena (CLI arena)", codeHash: codeHash(ROOT), criteria: crit.name, tNote: "guardrails use t(0.975, n-1); passTournamentT uses the tournament script's table (1.96 from df 20)", notes: notes.arena, identity },
    winner: { name: W.name, origin: W.origin, registeredAs: "benchtime_final", genome: W.genome, description: describeGenome(W.genome), failedDecide: W.failedDecide, failedConfirm: W.failedConfirm, overallPick: W.overallPick, frontier: W.frontier.map((f, i) => ({ id: `frontier_${i + 1}`, level: f.level, name: f.name, genome: f.genome })) },
    guardrails: wg,
    guardrailsFailed: failed.map((g) => g.label),
    dominatedBy: dominators,
    policies: perCell,
    winnerVsBestBaseline: vsBest,
    lossesToRivals: losses.map((x) => ({ measure: x.measure, rival: x.rival, winner: x.winner, rival_mean: x.rivalMean, diff: x.diff, significant: x.significant })),
    perRun: cells.flatMap((c) => runsOf(c, seeds).map((r, i) => ({ policy: c.id, seed: seeds[i], measures: r ? flat(r.scorecards) : null }))),
    reportSummary: summary,
  };
  return { md: L, json, headline: H };
}

/** rows = measures, columns = variants: paired difference against a reference cell */
function diffMatrix(ref: CellSpec, cols: CellSpec[], seeds: number[], only?: string[]): string[] {
  const rf = flatsOf(ref, seeds);
  const F = cols.map((c) => flatsOf(c, seeds));
  const keys = only ?? measureKeys([rf, ...F].flat());
  const L = [`| Measure | ${cols.map((c) => c.id).join(" | ")} |`, `|---|${cols.map(() => "---").join("|")}|`];
  for (const m of keys) L.push(`| ${lab(m)} | ${F.map((f) => { const p = pairedT(col(f, m), col(rf, m)); const v = verdict(m, p.lo, p.hi); return `${dci(m, p)}${v ? ` ${v}` : ""}`; }).join(" | ")} |`);
  return L;
}
const KEY_ABL = () => [...new Set([crit.primary, ...crit.objectives.map((o) => o.measure), ...crit.guardrails.map((g) => g.measure)])];

function ablationReport(): { md: string[]; json: unknown } | null {
  const seeds = ABL_SEEDS;
  if (!complete(winnerCell, seeds) || !complete(today, seeds)) return null;
  const offs = abl.filter((c) => complete(c, seeds));
  const addsDone = adds.filter((c) => complete(c, seeds));
  const wf = flatsOf(winnerCell, seeds);
  const tf = flatsOf(today, seeds);
  const zf = complete(zooToday, seeds) ? flatsOf(zooToday, seeds) : null;
  const keys = measureKeys([wf, tf]);
  const L: string[] = [];
  L.push("# Ablation of the winner (held-out seeds)", "");
  L.push(`Generated ${nowHHMM()} IST. Winner ${W.name}: ${describeGenome(W.genome)} Seeds ${seeds[0]}-${seeds[seeds.length - 1]} (${seeds.length})${seeds.length < 30 ? ", fewer than the 30 held-out seeds because of the compute budget" : ""}; roster seed 42; CLI arena path. Each row changes one gene of the winner's genome (zoo genome API) and is compared with the winner on the same seeds (paired, 95% t interval). Positive differences mean the variant is higher; "better"/"worse" mark intervals that exclude zero, read in the measure's direction. So a component helps where switching it off is "worse".`, "");
  for (const n of notes.ablation!) L.push(`- ${n}`);
  L.push("");
  const kk = KEY_ABL().filter((m) => keys.includes(m));
  L.push("## Switching each component off (variant minus winner)", "");
  L.push("| Variant | Change | Guardrails failed vs today | " + kk.map(lab).join(" | ") + " |", "|---|---|---|" + kk.map(() => "---").join("|") + "|");
  const offRows: unknown[] = [];
  for (const c of offs) {
    const f = flatsOf(c, seeds);
    const g = evalGuardrails(f, tf, crit);
    const meta = ablMeta[c.id]!;
    const cells = kk.map((m) => { const p = pairedT(col(f, m), col(wf, m)); const v = verdict(m, p.lo, p.hi); return `${dci(m, p)}${v ? ` ${v}` : ""}`; });
    L.push(`| ${c.label} | ${meta.from} to ${meta.to} | ${g.filter((x) => !x.pass).length} | ${cells.join(" | ")} |`);
    offRows.push({ id: c.id, label: c.label, ...meta, guardrails: g, measures: Object.fromEntries(keys.map((m) => [m, tInterval(col(f, m).filter((x): x is number => typeof x === "number"))])), pairedVsWinner: Object.fromEntries(keys.map((m) => [m, pairedT(col(f, m), col(wf, m))])) });
  }
  const wg = evalGuardrails(wf, tf, crit);
  L.push(`| (the winner itself) | | ${wg.filter((x) => !x.pass).length} | ${kk.map(() => "").join(" | ")} |`, "");
  L.push("## Adding each component to today's way (variant minus today's way as a zoo genome, and minus status_quo_60)", "");
  if (zf) {
    const zp = kk.map((m) => pairedT(col(zf, m), col(tf, m)));
    L.push(`Today's way as a zoo genome against the package's status_quo_60 on the same seeds (should be near zero): ${kk.slice(0, 4).map((m, i) => `${lab(m)} ${dci(m, zp[i]!)}`).join("; ")}.`, "");
  }
  L.push("| Variant | Guardrails failed vs today | " + kk.map(lab).join(" | ") + " |", "|---|---|" + kk.map(() => "---").join("|") + "|");
  const addRows: unknown[] = [];
  for (const c of addsDone.filter((c) => c.id !== zooToday.id)) {
    const f = flatsOf(c, seeds);
    const base = zf ?? tf;
    const g = evalGuardrails(f, tf, crit);
    const cells = kk.map((m) => { const p = pairedT(col(f, m), col(base, m)); const v = verdict(m, p.lo, p.hi); return `${dci(m, p)}${v ? ` ${v}` : ""}`; });
    L.push(`| ${c.label} | ${g.filter((x) => !x.pass).length} | ${cells.join(" | ")} |`);
    addRows.push({ id: c.id, label: c.label, ...addMeta[c.id], guardrails: g, measures: Object.fromEntries(keys.map((m) => [m, tInterval(col(f, m).filter((x): x is number => typeof x === "number"))])), pairedVsZooToday: zf ? Object.fromEntries(keys.map((m) => [m, pairedT(col(f, m), col(zf, m))])) : null, pairedVsToday: Object.fromEntries(keys.map((m) => [m, pairedT(col(f, m), col(tf, m))])) });
  }
  L.push("");
  L.push("## Every measure: each switch-off minus the winner", "");
  L.push(...diffMatrix(winnerCell, offs, seeds), "");
  L.push("## Every measure: each addition minus today's way as a zoo genome", "");
  if (zf) L.push(...diffMatrix(zooToday, addsDone.filter((c) => c.id !== zooToday.id), seeds), "");
  return { md: L, json: { meta: { generated: new Date().toISOString(), seeds, winner: W.name, genome: W.genome, notes: notes.ablation }, switchedOff: offRows, addedToToday: addRows } };
}

function robustnessReport(): { md: string[]; json: unknown } | null {
  const seeds = SEEDS;
  const rows = robCells.filter((r) => complete(r.w, seeds) && (complete(r.t, seeds) || !r.cond.todayToo));
  if (!rows.length) return null;
  const L: string[] = [];
  const KEY3 = ["extra.substantivePerDay", "derived.meritsDisposals", "extra.promisesHonouredInclDesk"];
  L.push("# Robustness of the winner (held-out seeds)", "");
  L.push(`Generated ${nowHHMM()} IST. Winner ${W.name}. Seeds ${seeds[0]}-${seeds[seeds.length - 1]} (${seeds.length}). In every condition the winner and today's way (status_quo_60) face the same changed court on the same seeds; the guardrails are re-evaluated against today's way under that condition. Planner bias changes only what the planner is shown (the world runs on PUCAR's true tables).`, "");
  for (const n of notes.robustness!) L.push(`- ${n}`);
  L.push("");
  L.push("| Condition | Useful hearings a day: winner minus today | Merits disposals | Dates honoured (incl. desk) | Still beats today on all three? | Guardrails failed | Which |", "|---|---|---|---|---|---|---|");
  const wf0 = flatsOf(winnerCell, seeds);
  const tf0 = flatsOf(today, seeds);
  const out: unknown[] = [];
  const baseRow = { id: "baseline", label: "as calibrated (the arena)", wf: wf0, tf: tf0 };
  const all = [...(complete(winnerCell, seeds) && complete(today, seeds) ? [baseRow] : []), ...rows.map((r) => ({ id: r.cond.id, label: r.cond.label, wf: flatsOf(r.w, seeds), tf: flatsOf(r.t, seeds) }))];
  for (const r of all) {
    const ps = KEY3.map((m) => pairedT(col(r.wf, m), col(r.tf, m)));
    const beats = ps.map((p, i) => verdict(KEY3[i]!, p.lo, p.hi));
    const g = evalGuardrails(r.wf, r.tf, crit);
    const f = g.filter((x) => !x.pass);
    L.push(`| ${r.label} | ${ps.map((p, i) => `${dci(KEY3[i]!, p)}${beats[i] ? ` ${beats[i]}` : ""}`).join(" | ")} | ${beats.every((b) => b === "better") ? "yes" : beats.some((b) => b === "worse") ? "**no (worse on " + KEY3.filter((_, i) => beats[i] === "worse").map(lab).join(", ") + ")**" : "not clearly"} | ${f.length} | ${f.map((x) => x.label).join("; ") || "none"} |`);
    out.push({ id: r.id, label: r.label, key: Object.fromEntries(KEY3.map((m, i) => [m, ps[i]])), guardrails: g, winner: Object.fromEntries(measureKeys(r.wf).map((m) => [m, tInterval(col(r.wf, m).filter((x): x is number => typeof x === "number"))])), today: Object.fromEntries(measureKeys(r.tf).map((m) => [m, tInterval(col(r.tf, m).filter((x): x is number => typeof x === "number"))])), pairedVsToday: Object.fromEntries(measureKeys(r.wf).map((m) => [m, pairedT(col(r.wf, m), col(r.tf, m))])) });
  }
  L.push("");
  L.push("## Every measure: winner minus today's way, per condition (paired, 95% t interval)", "");
  const keys = measureKeys(all.flatMap((r) => r.wf));
  L.push(`| Measure | ${all.map((r) => r.id).join(" | ")} |`, `|---|${all.map(() => "---").join("|")}|`);
  for (const m of keys) L.push(`| ${lab(m)} | ${all.map((r) => { const p = pairedT(col(r.wf, m), col(r.tf, m)); const v = verdict(m, p.lo, p.hi); return `${dci(m, p)}${v ? ` ${v}` : ""}`; }).join(" | ")} |`);
  L.push("");
  L.push("## The winner's own level per condition (mean [95% t interval])", "");
  const k2 = [...new Set([...KEY3, ...KEY_ABL()])].filter((m) => keys.includes(m));
  L.push(`| Measure | ${all.map((r) => r.id).join(" | ")} |`, `|---|${all.map(() => "---").join("|")}|`);
  for (const m of k2) L.push(`| ${lab(m)} | ${all.map((r) => ci(m, tInterval(col(r.wf, m).filter((x): x is number => typeof x === "number")))).join(" | ")} |`);
  L.push("");
  L.push("## Guardrails per condition", "");
  for (const r of all) {
    L.push(`### ${r.label}`, "");
    L.push(...guardTable(evalGuardrails(r.wf, r.tf, crit)), "");
  }
  return { md: L, json: { meta: { generated: new Date().toISOString(), seeds, winner: W.name, notes: notes.robustness }, conditions: out } };
}

function stylesReport(): { md: string[]; json: unknown } | null {
  const seeds = SEEDS;
  const done = styleCells.filter((s) => complete(s.cell, seeds) && complete(pol(s.plain), seeds));
  if (!done.length || !complete(winnerCell, seeds) || !complete(today, seeds)) return null;
  const wRef = winnerInRules && complete(winnerInRules, seeds) ? winnerInRules : winnerCell;
  const tRef = todayInRules && complete(todayInRules, seeds) ? todayInRules : today;
  const L: string[] = [];
  L.push("# Judge styles on top of the winner (held-out seeds)", "");
  L.push(`Generated ${nowHHMM()} IST. Winner ${W.name}. Seeds ${seeds[0]}-${seeds[seeds.length - 1]} (${seeds.length}). Rules: ${rulesNote}. Each style is the winner with that judge's rules applied on top (the 15% floor holds), compared with the judge's plain policy as coded in the package, with the winner alone, and with today's way, on the same seeds.`, "");
  if (winnerInRules) {
    const a = runsOf(winnerInRules, seeds.slice(0, 5));
    const b = runsOf(winnerCell, seeds.slice(0, 5));
    const same = a.every((r, i) => r && b[i] && JSON.stringify(flat(r.scorecards)) === JSON.stringify(flat(b[i]!.scorecards)));
    L.push(`Identity check: the winner in the rules temp copy with no rules ${same ? "equals" : "**differs from**"} the package's winner on seeds ${seeds.slice(0, 5).join(", ")}.`, "");
  }
  if (existsSync(join(OUTDIR, "styles-rules-cost.md"))) L.push("Cross-check: scripts/rules-cost.ts (the rules patch's own cost script) on the winner, seeds 31-36, in styles-rules-cost.md (it keys the court \"seed42\", so its numbers differ from these; read it for direction only).", "");
  if (rulesCheck.command || rulesCheck.output) {
    L.push("## Rule compliance (scripts/rules-check.ts)", "");
    L.push(`\`${rulesCheck.command || "(not run)"}\`: every day plan and every next date of the winner under each rule set checked against the rules (ruleViolations, nextDateViolations), full horizon, seeds ${DRY ? "1" : "31 and 32"}, roster keyed "seed42" as that script does.`, "");
    if (rulesCheck.sets.length) {
      L.push("| Rule set | Day plans | Listings | Next dates | Violations |", "|---|---|---|---|---|");
      for (const x of rulesCheck.sets) L.push(`| ${x.name} | ${x.dayPlans} | ${x.listings} | ${x.nextDates} | ${x.violations === 0 ? "0" : `**${x.violations}**`} |`);
      L.push("", "Full output in styles-rules-check.txt.", "");
    } else L.push(rulesCheck.output.slice(0, 500), "");
  }
  const kk = KEY_ABL();
  const out: unknown[] = [];
  L.push("| Style | How | Beats the plain style on (of measures with a direction, significant) | Loses on (significant) | Guardrails failed vs today |", "|---|---|---|---|---|");
  for (const s of done) {
    const f = flatsOf(s.cell, seeds);
    const pf = flatsOf(pol(s.plain), seeds);
    const keys = measureKeys([f, pf]).filter((m) => DIRECTION.get(m));
    let win = 0;
    let lose = 0;
    const loseList: string[] = [];
    for (const m of keys) {
      const p = pairedT(col(f, m), col(pf, m));
      const v = verdict(m, p.lo, p.hi);
      if (v === "better") win++;
      if (v === "worse") {
        lose++;
        loseList.push(lab(m));
      }
    }
    const g = evalGuardrails(f, flatsOf(tRef, seeds), crit);
    L.push(`| ${s.style} | ${s.how} | ${win} of ${keys.length} | ${lose}${loseList.length ? `: ${loseList.join("; ")}` : ""} | ${g.filter((x) => !x.pass).length}: ${g.filter((x) => !x.pass).map((x) => x.label).join("; ") || "none"} |`);
    out.push({ style: s.style, plain: s.plain, how: s.how, cell: s.cell.id, config: s.cell.config ?? null, beatsPlainOn: win, losesToPlainOn: lose, of: keys.length, guardrails: g, measures: Object.fromEntries(measureKeys([f]).map((m) => [m, tInterval(col(f, m).filter((x): x is number => typeof x === "number"))])), pairedVsPlain: Object.fromEntries(measureKeys([f]).map((m) => [m, pairedT(col(f, m), col(pf, m))])), pairedVsWinner: Object.fromEntries(measureKeys([f]).map((m) => [m, pairedT(col(f, m), col(flatsOf(wRef, seeds), m))])), pairedVsToday: Object.fromEntries(measureKeys([f]).map((m) => [m, pairedT(col(f, m), col(flatsOf(tRef, seeds), m))])) });
  }
  L.push("");
  L.push("## Key measures (mean [95% t interval])", "");
  const cols: CellSpec[] = [wRef, ...done.flatMap((s) => [s.cell, pol(s.plain)]), tRef];
  L.push(`| Measure | ${cols.map((c) => c.id).join(" | ")} |`, `|---|${cols.map(() => "---").join("|")}|`);
  for (const m of kk) L.push(`| ${lab(m)} | ${cols.map((c) => ci(m, tInterval(col(flatsOf(c, seeds), m).filter((x): x is number => typeof x === "number")))).join(" | ")} |`);
  L.push("");
  for (const s of done) {
    L.push(`## ${s.style}: every measure, winner + rules minus the plain ${s.plain} / minus the winner alone / minus today (paired, 95% t)`, "");
    const f = flatsOf(s.cell, seeds);
    const refs: [string, (Flat | null)[]][] = [[`minus ${s.plain}`, flatsOf(pol(s.plain), seeds)], ["minus the winner", flatsOf(wRef, seeds)], ["minus today", flatsOf(tRef, seeds)]];
    L.push(`| Measure | ${refs.map((r) => r[0]).join(" | ")} |`, "|---|---|---|---|");
    for (const m of measureKeys([f])) L.push(`| ${lab(m)} | ${refs.map(([, rf]) => { const p = pairedT(col(f, m), col(rf, m)); const v = verdict(m, p.lo, p.hi); return `${dci(m, p)}${v ? ` ${v}` : ""}`; }).join(" | ")} |`);
    L.push("");
    L.push("Guardrails against today's way:", "", ...guardTable(evalGuardrails(f, flatsOf(tRef, seeds), crit)), "");
  }
  return { md: L, json: { meta: { generated: new Date().toISOString(), seeds, winner: W.name, rules: rulesNote }, rulesCheck: { ...rulesCheck, output: undefined }, styles: out } };
}

function settlementReport(): { md: string[]; json: unknown } | null {
  const seeds = SEEDS;
  const done = settleCells.filter((c) => c.id !== "settle_plain" && complete(c, seeds));
  const plain = settleCells.find((c) => c.id === "settle_plain");
  if (!plain || !done.length || !complete(winnerCell, seeds) || !complete(today, seeds)) return null;
  // the set-ups are paired with the package's own winner and today's way (the temp copy's winner is checked identical)
  const pf = flatsOf(winnerCell, seeds);
  const tf = flatsOf(today, seeds);
  const L: string[] = [];
  L.push("# Settlement days on top of the winner (held-out seeds)", "");
  L.push(`Generated ${nowHHMM()} IST. ${settleNote}. Seeds ${seeds[0]}-${seeds[seeds.length - 1]} (${seeds.length}). The world's compounding and settlement hazards do not respond to a settlement sitting (the add-on's own caveat), so any gain comes from who is called and when.`, "");
  const a = runsOf(plain, seeds.slice(0, 5));
  const b = runsOf(winnerCell, seeds.slice(0, 5));
  if (a.every(Boolean) && b.every(Boolean)) L.push(`Identity check: the winner in the temp copy ${a.every((r, i) => JSON.stringify(flat(r!.scorecards)) === JSON.stringify(flat(b[i]!.scorecards))) ? "equals" : "**differs from**"} the package's winner on seeds ${seeds.slice(0, 5).join(", ")}.`, "");
  const vs = done;
  L.push("## Every measure: each set-up minus the winner alone (paired, 95% t)", "");
  L.push(...diffMatrix(winnerCell, vs, seeds), "");
  L.push("## Guardrails against today's way", "");
  const out: unknown[] = [];
  for (const c of vs) {
    const f = flatsOf(c, seeds);
    const g = evalGuardrails(f, tf, crit);
    L.push(`### ${c.label}`, "", ...guardTable(g), "");
    out.push({ id: c.id, label: c.label, guardrails: g, measures: Object.fromEntries(measureKeys([f]).map((m) => [m, tInterval(col(f, m).filter((x): x is number => typeof x === "number"))])), pairedVsWinner: Object.fromEntries(measureKeys([f]).map((m) => [m, pairedT(col(f, m), col(pf, m))])) });
  }
  return { md: L, json: { meta: { generated: new Date().toISOString(), seeds, winner: W.name, note: settleNote }, setups: out } };
}

/** rule compliance of the winner under each judge's rules (scripts/rules-check.ts from the rules patch) */
let rulesCheck: { ran: boolean; command: string; sets: { name: string; dayPlans: number; listings: number; nextDates: number; violations: number }[]; output: string } = { ran: false, command: "", sets: [], output: "" };
function runRulesCheck(): void {
  const script = join(ROOT, "scripts/rules-check.ts");
  if (!existsSync(script)) {
    rulesCheck = { ran: false, command: "", sets: [], output: "scripts/rules-check.ts is not in the package (the rules patch was not applied)" };
    return;
  }
  const args = ["run", script, ...(DRY ? [] : ["--genome", join(OUT, "tournament", "winner.json")]), "--seeds", DRY ? "1" : "31,32", "--end", "2026-12-15"];
  const r = spawnSync("bun", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const output = (r.stdout ?? "") + (r.stderr ? `\n${r.stderr}` : "");
  const sets: typeof rulesCheck.sets = [];
  for (const m of output.matchAll(/^(\w+): (\d+) day plans, (\d+) listings, (\d+) next dates, (\d+) violations/gm)) sets.push({ name: m[1]!, dayPlans: Number(m[2]), listings: Number(m[3]), nextDates: Number(m[4]), violations: Number(m[5]) });
  rulesCheck = { ran: r.status === 0, command: `bun ${args.join(" ")}`.replace(ROOT + "/", ""), sets, output };
  writeFileSync(join(OUTDIR, "styles-rules-check.txt"), `$ ${rulesCheck.command}\n${output}`);
}

/** cross-check with the rules patch's own cost script (it keys the court "seed42", as the tournament once did, and uses t for 6 seeds) */
function runRulesCost(): void {
  const script = join(ROOT, "scripts/rules-cost.ts");
  if (!existsSync(script)) return;
  const outJson = join(OUTDIR, "styles-rules-cost.json");
  const args = ["run", script, ...(DRY ? [] : ["--genome", join(OUT, "tournament", "winner.json")]), "--seeds", DRY ? "1,2" : "31,32,33,34,35,36", "--out", outJson];
  const r = spawnSync("bun", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  writeFileSync(join(OUTDIR, "styles-rules-cost.md"), `# scripts/rules-cost.ts on the winner (cross-check)\n\n\`bun ${args.join(" ").replace(ROOT + "/", "")}\`\n\nThis script keys the court "seed42" (the CLI arena keys it roster_3000_seed42), runs seeds 31-36 only and uses the t value for six seeds; styles.md is the headline, this is a cross-check of direction.\n\n${r.stdout ?? ""}\n${r.status === 0 ? "" : `exit ${r.status}: ${r.stderr}`}\n`);
}

function writeReports(): void {
  if (PARTS.has("arena")) {
    const r = arenaReport();
    if (r) {
      writeMd(join(OUTDIR, "heldout.md"), r.md);
      writeJson(join(OUTDIR, "heldout.json"), r.json);
      writeMd(join(OUTDIR, "HEADLINE.md"), r.headline);
      console.log(`[${nowHHMM()}] wrote heldout.md, heldout.json, HEADLINE.md`);
    }
  }
  const parts: [string, () => { md: string[]; json: unknown } | null][] = [["ablation", ablationReport], ["robustness", robustnessReport], ["styles", stylesReport], ["settlement", settlementReport]];
  for (const [name, fn] of parts) {
    if (!PARTS.has(name)) continue;
    const r = fn();
    if (!r) continue;
    writeMd(join(OUTDIR, `${name}.md`), r.md);
    writeJson(join(OUTDIR, `${name}.json`), r.json);
    console.log(`[${nowHHMM()}] wrote ${name}.md and ${name}.json`);
  }
}

// ---------------------------------------------------------------------------------------------
// Main

async function main(): Promise<void> {
  console.log(`[${nowHHMM()}] winner ${W.name}${registered ? " (registered as benchtime_final)" : " (genome cell)"}; seeds ${SEEDS[0]}-${SEEDS[SEEDS.length - 1]}; ablation seeds ${ABL_SEEDS[0]}-${ABL_SEEDS[ABL_SEEDS.length - 1]}; code ${codeHash(ROOT)}; out ${OUTDIR}`);
  if (PARTS.has("styles")) await buildStyles();
  if (PARTS.has("settlement")) buildSettlement();
  const jobs: Job[] = [];
  const push = (cells: CellSpec[], seeds: number[]) => {
    for (const c of cells) for (const s of seeds) jobs.push({ cell: c, seed: s, key: jobKey(c, s) });
  };
  // priority order: the arena, identity checks, robustness, styles, settlement, ablation (first half of seeds first)
  push([winnerCell, today], SEEDS);
  if (PARTS.has("arena")) {
    push(arenaCells, SEEDS);
    for (const x of identityCells) push([x.a, x.b], x.seeds);
  }
  if (PARTS.has("robustness")) push(robCells.flatMap((r) => (r.cond.todayToo ? [r.w, r.t] : [r.w])), SEEDS);
  if (PARTS.has("styles")) {
    push([...styleCells.map((s) => s.cell), ...styleCells.map((s) => pol(s.plain))], SEEDS);
    if (winnerInRules) push([winnerInRules, todayInRules!], SEEDS);
  }
  if (PARTS.has("settlement")) {
    push(settleCells.filter((c) => c.id !== "settle_plain"), SEEDS);
    push(settleCells.filter((c) => c.id === "settle_plain"), SEEDS.slice(0, 5));
  }
  if (PARTS.has("ablation")) {
    const half = Math.ceil(ABL_SEEDS.length / 2);
    push([winnerCell, today], ABL_SEEDS);
    push([...abl, ...adds], ABL_SEEDS.slice(0, half));
    push([...abl, ...adds], ABL_SEEDS.slice(half));
  }
  writeFileSync(join(CACHE_DIR, `plan${DRY ? "-dry" : ""}.json`), JSON.stringify({ at: new Date().toISOString(), codeHash: codeHash(ROOT), jobs: jobs.length, cells: [...new Set(jobs.map((j) => j.cell.id))] }, null, 1));
  if (!REPORT_ONLY) {
    const t0 = performance.now();
    let lastReport = performance.now();
    await runJobs(jobs, WORKERS, (r, done, total) => {
      if (done % 20 === 0 || done === total) {
        const el = (performance.now() - t0) / 1000;
        console.log(`[${nowHHMM()}] ${done}/${total} runs, ${el.toFixed(0)} s, ${((el / done) * 1000).toFixed(0)} ms per run wall, ETA ${(((total - done) * el) / done / 60).toFixed(1)} min (last: ${r.cellId} seed ${r.seed}, ${r.ms} ms)`);
      }
      if (performance.now() - lastReport > 90_000) {
        lastReport = performance.now();
        try {
          writeReports();
        } catch (e) {
          console.error(`report failed: ${e}`);
        }
      }
    });
    console.log(`[${nowHHMM()}] runs done in ${((performance.now() - t0) / 60000).toFixed(1)} min`);
  }
  if (PARTS.has("styles") && !REPORT_ONLY) {
    runRulesCost();
    runRulesCheck();
    console.log(`[${nowHHMM()}] rules check: ${rulesCheck.sets.map((x) => `${x.name} ${x.violations}`).join(", ") || rulesCheck.output.slice(0, 200)}`);
  } else if (existsSync(join(OUTDIR, "styles-rules-check.txt"))) {
    const text = readFileSync(join(OUTDIR, "styles-rules-check.txt"), "utf8");
    const sets: typeof rulesCheck.sets = [];
    for (const m of text.matchAll(/^(\w+): (\d+) day plans, (\d+) listings, (\d+) next dates, (\d+) violations/gm)) sets.push({ name: m[1]!, dayPlans: Number(m[2]), listings: Number(m[3]), nextDates: Number(m[4]), violations: Number(m[5]) });
    rulesCheck = { ran: true, command: text.split("\n")[0]!.replace(/^\$ /, ""), sets, output: text };
  }
  writeReports();
}

mkdirSync(CACHE_DIR, { recursive: true });
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
