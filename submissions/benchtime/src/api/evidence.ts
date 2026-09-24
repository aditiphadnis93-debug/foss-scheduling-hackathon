// GET /api/evidence: the stored experiment outputs under out/, reshaped to web/API.md where their format is
// known, served as they are (never recomputed here). A section whose file is missing is null and listed in
// `notYetRun`; a file whose format this adapter does not recognise is listed in `unrecognised` with its top
// level keys, and passed through under `raw` so nothing an experiment reported is hidden.

import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { FailureReason, HearingType, Scorecards } from "../domain/types";
import { FAILURE_REASONS, HEARING_TYPES } from "../domain/types";
import { POLICY_IDS } from "../planner/index";
import { BASELINE, POLICY_KIND, RECOMMENDED, ROOT, ROSTER_ID, SEEDS, getEnv, makePolicy, round, typeLabel } from "./context";
import { fixed, tInterval, type Interval } from "./intervals";
import { diffSummary, summaryOf, type Summary } from "./simulate";

export const OUT_DIR = join(ROOT, "out");

const FILES = {
  arena: "arena.json",
  ablation: "ablation.json",
  sensitivity: "sensitivity.json",
  robustness: "robustness.json",
  optimality: "optimality.json",
  styles: "styles.json",
  tuning: "tuning.json",
  calibration: "calibration-fit.md",
  causelist: "causelist-22sep.md",
} as const;
type Source = keyof typeof FILES;
type Status = "loaded" | "not yet run" | "unrecognised format" | "unreadable";

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const isIv = (x: unknown): x is Interval => isObj(x) && (typeof x.mean === "number" || x.mean === null);

function readJson(file: string): { data: unknown; error?: string } | null {
  const p = join(OUT_DIR, file);
  if (!existsSync(p)) return null;
  try {
    return { data: JSON.parse(readFileSync(p, "utf8")) };
  } catch (e) {
    return { data: null, error: e instanceof Error ? e.message : String(e) };
  }
}

// ---------------------------------------------------------------------------------------------
// Arena: the report's Summary (src/eval/report.ts), or rows already in the console's shape

interface PerRun {
  policyId: string;
  rosterId: string;
  worldSeed: number;
  scorecards: Scorecards;
}

export function arenaRows(data: unknown): { rows: unknown[] } | null {
  if (!isObj(data)) return null;
  if (isObj(data.arena) && Array.isArray((data.arena as Record<string, unknown>).rows)) return data.arena as { rows: unknown[] };
  if (Array.isArray(data.rows) && data.rows.every((r) => isObj(r) && "summary" in r && "policyId" in r)) return { rows: data.rows };
  const perRun = Array.isArray(data.perRun) ? (data.perRun as PerRun[]) : null;
  if (!perRun || perRun.length === 0) return null;
  // the shared roster only (robustness rosters belong to their own study)
  const rosterId = perRun.some((r) => r.rosterId === ROSTER_ID) ? ROSTER_ID : perRun[0]!.rosterId;
  const runs = perRun.filter((r) => r.rosterId === rosterId);
  const ids = [...new Set(runs.map((r) => r.policyId))].sort((a, b) => order(a) - order(b));
  const base = new Map(runs.filter((r) => r.policyId === BASELINE).map((r) => [r.worldSeed, r.scorecards]));
  const rows = ids.map((id) => {
    const mine = runs.filter((r) => r.policyId === id).sort((a, b) => a.worldSeed - b.worldSeed);
    const paired = mine.filter((r) => base.has(r.worldSeed));
    return {
      policyId: id,
      policyName: nameOf(id),
      kind: POLICY_KIND[id] ?? "baseline",
      seeds: mine.map((r) => r.worldSeed),
      summary: summaryOf(mine.map((r) => r.scorecards)),
      vsBaseline: diffSummary(
        paired.map((r) => base.get(r.worldSeed)!),
        paired.map((r) => r.scorecards),
      ),
    };
  });
  return { rows };
}

const order = (id: string) => {
  const i = (POLICY_IDS as readonly string[]).indexOf(id);
  return i < 0 ? 99 : i;
};
function nameOf(id: string): string {
  try {
    return makePolicy(id).name;
  } catch {
    return id;
  }
}

// ---------------------------------------------------------------------------------------------
// Sections already in the console's shape (the experiment scripts may write them directly)

function shaped(data: unknown, key: string, test: (x: Record<string, unknown>) => boolean): unknown | null {
  if (!isObj(data)) return null;
  if (isObj(data[key]) && test(data[key] as Record<string, unknown>)) return data[key];
  if (isObj(data.evidence) && isObj((data.evidence as Record<string, unknown>)[key]) && test((data.evidence as Record<string, Record<string, unknown>>)[key]!)) return (data.evidence as Record<string, unknown>)[key];
  if (test(data)) return data;
  return null;
}

const ablationShape = (x: Record<string, unknown>) => Array.isArray(x.measures) && Array.isArray(x.rows) && (x.rows as unknown[]).every((r) => isObj(r) && isObj(r.removed));
const sensitivityShape = (x: Record<string, unknown>) => typeof x.measure === "string" && Array.isArray(x.rows) && (x.rows as unknown[]).every((r) => isObj(r) && isIv(r.atBase));
const robustnessShape = (x: Record<string, unknown>) => Array.isArray(x.scenarios) && Array.isArray(x.cells);
const exactShape = (x: Record<string, unknown>) => isIv(x.meanGap) && Array.isArray(x.byDay);
const fillShape = (x: Record<string, unknown>) => Array.isArray(x.levels) && (x.levels as unknown[]).every((l) => isObj(l) && typeof l.fill === "number");

/** Optimality output with per-day exact and greedy values, in whatever list it keeps them. */
function exactFromDays(data: unknown): unknown | null {
  const done = shaped(data, "exactVsGreedy", exactShape);
  if (done) return done;
  if (!isObj(data)) return null;
  const list = [data.byDay, data.days, data.perDay, data.rows].find((x) => Array.isArray(x) && x.length > 0 && x.every((d) => isObj(d) && typeof d.exact === "number" && typeof d.greedy === "number")) as
    | { date?: string; exact: number; greedy: number; gap?: number }[]
    | undefined;
  if (!list) return null;
  const byDay = list.map((d) => ({ date: d.date ?? "", exact: d.exact, greedy: d.greedy, gap: typeof d.gap === "number" ? d.gap : d.exact > 0 ? (d.exact - d.greedy) / d.exact : 0 }));
  const gaps = byDay.map((d) => d.gap);
  return {
    days: byDay.length,
    valueUnit: typeof data.valueUnit === "string" ? data.valueUnit : "expected value of the day's list",
    meanGap: tInterval(gaps),
    maxGap: Math.max(...gaps),
    daysExactBetter: byDay.filter((d) => d.exact > d.greedy + 1e-9).length,
    effect: isObj(data.effect) ? data.effect : {},
    byDay,
    note: typeof data.note === "string" ? data.note : "Exact dynamic programme against greedy by value per expected minute on the same candidates, fill target and fairness floor.",
  };
}

// ---------------------------------------------------------------------------------------------
// Calibration: the fit report written by src/world/calibrate.ts (Markdown tables)

const SHARE_COLS: FailureReason[] = ["court_admin", "respondent_absent", "petitioner_absent", "sought_time", "not_ready", "awaiting_process", "external_dependency", "both_absent", "unclear"];
const pctNum = (s: string) => Number(s.replace("%", "").trim()) / 100;
function binomial(p: number, n: number): Interval {
  if (!(n > 0)) return fixed(round(p, 3));
  const half = 1.96 * Math.sqrt((p * (1 - p)) / n);
  return { mean: round(p, 3), lo: round(Math.max(0, p - half), 3), hi: round(Math.min(1, p + half), 3) };
}

export function calibrationFromMarkdown(md: string) {
  const { ref } = getEnv();
  const lines = md.split("\n");
  const tableAfter = (heading: RegExp) => {
    const i = lines.findIndex((l) => heading.test(l));
    if (i < 0) return [];
    const out: string[][] = [];
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j]!.trim();
      if (l.startsWith("## ")) break;
      if (!l.startsWith("|") || /^\|\s*-/.test(l) || /\|\s*Type\s*\|/.test(l)) continue;
      out.push(l.replace(/^\||\|$/g, "").split("|").map((c) => c.trim()));
    }
    return out;
  };
  const pRows = tableAfter(/^## P\(substantive/);
  const sRows = new Map(tableAfter(/^## Failure shares/).map((r) => [r[0]!, r.slice(1)]));
  const rows = pRows
    .filter((r) => (HEARING_TYPES as string[]).includes(r[0]!))
    .map((r) => {
      const type = r[0] as HearingType;
      const called = Number(r[1]);
      const target = pctNum(r[2]!);
      const sim = pctNum(r[3]!);
      const shares = sRows.get(type) ?? [];
      const simShare = Object.fromEntries(FAILURE_REASONS.map((f) => [f, 0])) as Record<FailureReason, number>;
      shares.forEach((cell, k) => {
        const f = SHARE_COLS[k];
        const b = cell.split("/")[1];
        if (f && b !== undefined) simShare[f] = round(pctNum(b), 3);
      });
      return {
        type,
        label: typeLabel(type),
        source: ref[type].pSubstantiveSource,
        pucarNonSubstantive: ref[type].failureCount,
        calledHearings: called,
        pucar: { pSubstantive: round(target, 3), failureShare: Object.fromEntries(FAILURE_REASONS.map((f) => [f, round(ref[type].failureShare[f] ?? 0, 3)])) as Record<FailureReason, number> },
        // the fit report gives the pooled rate over every called hearing on the training seeds; its 95% interval
        // is the binomial one for that many hearings
        simulated: { pSubstantive: binomial(sim, called), failureShare: simShare },
        error: round(sim - target, 3),
      };
    });
  if (rows.length === 0) return null;
  // pooled shares at PUCAR's type mix (weighted by its failure counts), so the two columns compare like with like
  const pooled = (w: (r: (typeof rows)[number]) => number, share: (r: (typeof rows)[number]) => Record<FailureReason, number>) => {
    const out = Object.fromEntries(FAILURE_REASONS.map((f) => [f, 0])) as Record<FailureReason, number>;
    let tot = 0;
    for (const r of rows) {
      const k = w(r);
      tot += k;
      for (const f of FAILURE_REASONS) out[f] += k * share(r)[f];
    }
    for (const f of FAILURE_REASONS) out[f] = tot > 0 ? round(out[f] / tot, 3) : 0;
    return out;
  };
  const follows = lines.find((l) => /^Fitted /.test(l)) ?? "Per-type P(substantive | reached) and failure shares fitted to PUCAR's tables under the status quo.";
  const conflicts = lines.filter((l) => /^- /.test(l) && /JUDGEMENT|conflict|contradict/i.test(l)).map((l) => l.slice(2).trim());
  return {
    follows,
    rows,
    pooled: { pucar: pooled((r) => r.pucarNonSubstantive, (r) => r.pucar.failureShare), simulated: pooled((r) => r.pucarNonSubstantive, (r) => r.simulated.failureShare) },
    conflicts,
  };
}

// ---------------------------------------------------------------------------------------------

export function evidenceHandler() {
  const sources = {} as Record<Source, { file: string; status: Status; modified: string | null; keys?: string[] }>;
  const raw: Record<string, unknown> = {};
  const mark = (s: Source, status: Status, keys?: string[]) => {
    const p = join(OUT_DIR, FILES[s]);
    sources[s] = { file: `out/${FILES[s]}`, status, modified: existsSync(p) ? statSync(p).mtime.toISOString() : null, ...(keys ? { keys } : {}) };
  };
  const load = (s: Source) => {
    const r = readJson(FILES[s]);
    if (!r) mark(s, "not yet run");
    else if (r.error) mark(s, "unreadable");
    return r?.data ?? null;
  };
  const accept = <X>(s: Source, data: unknown, value: X | null): X | null => {
    if (data === null) return null;
    if (value === null) {
      if (!sources[s]) {
        mark(s, "unrecognised format", isObj(data) ? Object.keys(data).slice(0, 30) : []);
        raw[s] = data;
      }
      return null;
    }
    mark(s, "loaded");
    return value;
  };

  const arenaData = load("arena");
  const arena = accept("arena", arenaData, arenaRows(arenaData)) ?? { rows: [] };
  const ablationData = load("ablation");
  const ablation = accept("ablation", ablationData, shaped(ablationData, "ablation", ablationShape));
  const sensData = load("sensitivity");
  const sensitivity = accept("sensitivity", sensData, shaped(sensData, "sensitivity", sensitivityShape));
  const robData = load("robustness");
  const robustness = accept("robustness", robData, shaped(robData, "robustness", robustnessShape));
  const optData = load("optimality");
  const exactVsGreedy = accept("optimality", optData, exactFromDays(optData));
  const tuningData = load("tuning");
  const fillCurve = tuningData !== null ? shaped(tuningData, "fillCurve", fillShape) : null;
  if (tuningData !== null) {
    mark("tuning", "loaded");
    raw.tuning = tuningData;
  }
  const stylesData = load("styles");
  if (stylesData !== null) {
    mark("styles", "loaded");
    raw.styles = stylesData;
  }

  let calibration: ReturnType<typeof calibrationFromMarkdown> = null;
  const calPath = join(OUT_DIR, FILES.calibration);
  if (existsSync(calPath)) {
    calibration = calibrationFromMarkdown(readFileSync(calPath, "utf8"));
    mark("calibration", calibration ? "loaded" : "unrecognised format");
  } else mark("calibration", "not yet run");
  const clPath = join(OUT_DIR, FILES.causelist);
  let causelist: { markdown: string } | null = null;
  if (existsSync(clPath)) {
    causelist = { markdown: readFileSync(clPath, "utf8") };
    mark("causelist", "loaded");
  } else mark("causelist", "not yet run");

  const notYetRun = (Object.keys(sources) as Source[]).filter((s) => sources[s].status === "not yet run");
  const unrecognised = (Object.keys(sources) as Source[]).filter((s) => sources[s].status === "unrecognised format" || sources[s].status === "unreadable");
  const stamps = Object.values(sources).map((s) => s.modified).filter((x): x is string => x !== null).sort();
  return {
    generatedAt: stamps[stamps.length - 1] ?? null,
    rosterId: ROSTER_ID,
    seeds: { tuning: SEEDS.tuning, validation: SEEDS.validation, test: SEEDS.test },
    baseline: BASELINE,
    recommended: RECOMMENDED,
    arena,
    ablation,
    sensitivity,
    robustness,
    exactVsGreedy,
    calibration,
    fillCurve,
    causelist,
    sources,
    notYetRun,
    unrecognised,
    raw,
  };
}

export type { Summary };
