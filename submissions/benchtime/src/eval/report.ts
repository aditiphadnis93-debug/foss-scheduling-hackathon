// Turning arena runs into the report (rule 3): every scorecard field for every policy and roster as a mean
// with a 95% interval across world seeds, paired differences against the status quo on the same seeds, and
// the definition of each field next to its numbers. Never one headline number.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { RunResult, Scorecards } from "../domain/types";
import { SCORECARD_FIELDS, flattenScorecards, type Family, type FieldMeta } from "./metrics";
import { bootstrapCI, pairedDiff, type Interval, type PairedInterval } from "./stats";

export const DEFAULT_BASELINE = "status_quo_60";

export interface CellSummary {
  policyId: string;
  rosterId: string;
  seeds: number[];
  /** "family.key" (for example "readme.utilisation", "caseStudy.ageBandsEnd.4+") to mean and interval */
  fields: Record<string, Interval>;
}

export interface PairedRow {
  rosterId: string;
  policyId: string;
  baselineId: string;
  field: string;
  diff: PairedInterval;
}

export interface SummaryMeta {
  start?: string;
  end?: string;
  capacityMinutes?: number;
  note?: string;
}

export interface Summary {
  meta: SummaryMeta;
  policies: string[];
  rosters: string[];
  seeds: number[];
  baselineId: string;
  cells: CellSummary[];
  paired: PairedRow[];
  /** every run's scorecards, so any number in the tables can be traced to its seeds */
  perRun: { policyId: string; rosterId: string; worldSeed: number; scorecards: Scorecards }[];
}

const FAMILIES: Family[] = ["readme", "caseStudy", "siddarth", "extra"];
const FAMILY_TITLE: Record<Family, string> = {
  readme: "README scorecard (PUCAR's printed scores)",
  caseStudy: "Case study scorecard (section 6)",
  siddarth: "Siddarth's six (slide 06)",
  extra: "Extra measures and alternative readings",
};

// Readings of one idea that must be read together: each is printed as its own table next to the family
// tables, so no single reading can be quoted alone. Every key is shown, as n/a when a run lacks it.
export const SIDE_BY_SIDE: readonly { title: string; note: string; keys: readonly string[] }[] = [
  {
    title: "Held as scheduled, every reading",
    note: "As listed counts reached rows over listed and deferred matters; all due also counts matters vacated, sent to the desk or due on a closure day; the substantive reading counts only hearings that moved the case.",
    keys: ["caseStudy.heldAsScheduled", "caseStudy.heldAsScheduledAllDue", "extra.heldSubstantiveAllDue", "siddarth.heldOnPromisedDate", "extra.heldOnPromisedShareOfHeard", "extra.firstPromiseKept"],
  },
  {
    title: "Disposals by route",
    note: "The headline counts verdicts, settlements, compounding, acquittals for the complainant's default and dismissals for steps not taken. Post-judgment closures and long-pending splits take a case off the file but are counted apart.",
    keys: ["extra.disposed", "extra.disposedVerdict", "extra.disposedSettlement", "extra.disposedCompounded", "extra.disposedAcquittedDefault", "extra.disposedDismissedSteps", "extra.disposedPostJudgment", "extra.disposedLpSplit", "extra.disposedAllRoutes", "extra.disposedRouteInferred", "siddarth.throughputPerMonth", "extra.throughputPerMonthAllRoutes"],
  },
  {
    title: "Predictability gap, every reading",
    note: "From each case's first date in the horizon over heard cases; the same with never-heard cases counted to the end; and from the horizon start over every roster case.",
    keys: ["readme.predictabilityGapDays", "extra.predictabilityGapDaysCensored", "extra.predictabilityGapFromStartDays"],
  },
  {
    title: "Next dates, every reading",
    note: "Excess over PUCAR's gap for the purpose just heard, and for the purpose the next date was given for, with the raw gap and the share falling beyond the horizon.",
    keys: ["caseStudy.nextDateExcessDays", "extra.nextDateExcessNextPurposeDays", "extra.nextDateNextPurposeInferredShare", "extra.nextDateGapDays", "extra.nextDateShortShare", "extra.nextDatesBeyondHorizonShare", "caseStudy.wastedRelistShare", "extra.wastedRelistShareInclDeskRechecks", "extra.wastedRelistShareInclAbsence"],
  },
  {
    title: "Fairness and waiting, every reading",
    note: "The oldest pending age alone barely moves between policies over a short horizon, so the mean of the oldest hundred and the 4y+ cohort readings are shown with it.",
    keys: ["siddarth.oldestPendingAgeYears", "extra.oldest100PendingMeanAgeYears", "siddarth.p95PendingAgeYears", "readme.backlog4yHeardShare", "readme.backlog4ySubstantiveShare", "extra.backlog4yActedOnShare", "extra.minutesWaited", "extra.minutesWaitedInclNotReached"],
  },
];

const flatRun = (r: RunResult): Record<string, number> => {
  const out: Record<string, number> = {};
  const flat = flattenScorecards(r.scorecards);
  for (const fam of FAMILIES) for (const [k, v] of Object.entries(flat[fam])) out[`${fam}.${k}`] = v;
  return out;
};

const uniq = <T>(xs: T[]): T[] => [...new Set(xs)];
// Seeds are paired by value, so every policy's list is sorted the same way.
const bySeed = (a: RunResult, b: RunResult) => a.worldSeed - b.worldSeed;

/** Mean and 95% interval across seeds for every field, per policy x roster, plus paired differences. */
export function summarise(runs: readonly RunResult[], baselineId = DEFAULT_BASELINE, meta: SummaryMeta = {}): Summary {
  const policies = uniq(runs.map((r) => r.policyId));
  const rosters = uniq(runs.map((r) => r.rosterId));
  const cells: CellSummary[] = [];
  for (const rosterId of rosters) {
    for (const policyId of policies) {
      const mine = runs.filter((r) => r.rosterId === rosterId && r.policyId === policyId).sort(bySeed);
      if (mine.length === 0) continue;
      const flats = mine.map(flatRun);
      const keys = uniq(flats.flatMap((f) => Object.keys(f)));
      const fields: Record<string, Interval> = {};
      for (const k of keys) fields[k] = bootstrapCI(flats.map((f) => f[k] ?? NaN));
      cells.push({ policyId, rosterId, seeds: mine.map((r) => r.worldSeed), fields });
    }
  }
  return {
    meta,
    policies,
    rosters,
    seeds: uniq(runs.map((r) => r.worldSeed)).sort((a, b) => a - b),
    baselineId,
    cells,
    paired: policies.includes(baselineId) ? pairedVs(runs, baselineId) : [],
    perRun: runs.map((r) => ({ policyId: r.policyId, rosterId: r.rosterId, worldSeed: r.worldSeed, scorecards: r.scorecards })),
  };
}

/** Policy minus baseline for every field, matched on roster and world seed (the same court). */
export function pairedVs(runs: readonly RunResult[], baselineId: string): PairedRow[] {
  const out: PairedRow[] = [];
  for (const rosterId of uniq(runs.map((r) => r.rosterId))) {
    const base = new Map(runs.filter((r) => r.rosterId === rosterId && r.policyId === baselineId).map((r) => [r.worldSeed, flatRun(r)]));
    if (base.size === 0) continue;
    for (const policyId of uniq(runs.map((r) => r.policyId))) {
      if (policyId === baselineId) continue;
      const mine = runs.filter((r) => r.rosterId === rosterId && r.policyId === policyId && base.has(r.worldSeed)).sort(bySeed);
      if (mine.length === 0) continue;
      const flats = mine.map(flatRun);
      const bases = mine.map((r) => base.get(r.worldSeed) ?? {});
      for (const field of uniq(flats.flatMap((f) => Object.keys(f)))) {
        const diff = pairedDiff(flats.map((f) => f[field] ?? NaN), bases.map((b) => b[field] ?? NaN));
        out.push({ rosterId, policyId, baselineId, field, diff });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Markdown

const META = new Map(SCORECARD_FIELDS.map((m) => [`${m.family}.${m.key}`, m]));

function fmt(x: number, m: FieldMeta | undefined, signed = false): string {
  if (!Number.isFinite(x)) return "n/a";
  const unit = m?.unit ?? "ratio";
  const v = unit === "share" ? x * 100 : x;
  const digits = unit === "ratio" ? 3 : unit === "years" || unit === "trips" ? 2 : unit === "minutes" ? 0 : 1;
  const s = v.toFixed(digits).replace(/^-(0\.?0*)$/, "$1"); // no "-0.0"
  return signed && Number(s) > 0 ? `+${s}` : s;
}

const unitNote = (m: FieldMeta | undefined): string => {
  switch (m?.unit) {
    case "share": return "%";
    case "days": return "days";
    case "years": return "years";
    case "perDay": return "per day";
    case "perMonth": return "per month";
    case "minutes": return "min";
    default: return "";
  }
};

const cellText = (iv: Interval | undefined, m: FieldMeta | undefined): string =>
  iv ? (iv.n > 1 ? `${fmt(iv.mean, m)} [${fmt(iv.lo, m)}, ${fmt(iv.hi, m)}]` : fmt(iv.mean, m)) : "n/a";

function verdict(d: PairedInterval, m: FieldMeta | undefined): string {
  if (!m?.better || d.n < 2 || !(d.lo > 0 || d.hi < 0)) return "";
  const up = d.lo > 0;
  return (up === (m.better === "higher")) ? " better" : " worse";
}

const row = (cells: string[]) => `| ${cells.join(" | ")} |`;
const escapeCell = (s: string) => s.replace(/\|/g, "/");

/** One table per scorecard family (policies as columns) per roster, paired differences, and definitions. */
export function renderMarkdown(summary: Summary, opts: { title?: string } = {}): string {
  const L: string[] = [];
  const { meta } = summary;
  L.push(`# ${opts.title ?? "Arena results"}`, "");
  const horizon = meta.start && meta.end ? `Horizon ${meta.start} to ${meta.end}. ` : "";
  const cap = meta.capacityMinutes ? `Capacity ${meta.capacityMinutes} minutes per sitting day. ` : "";
  L.push(`${horizon}${cap}World seeds ${seedText(summary.seeds)} (${summary.seeds.length}). Every cell is the mean across seeds with a 95% bootstrap interval in brackets. Shares are percentages.`);
  if (meta.note) L.push("", meta.note);
  const inferred = summary.perRun.filter((r) => (r.scorecards.extra.disposalsInferred ?? 0) > 0).length;
  if (inferred > 0)
    L.push("", `Note: in ${inferred} of ${summary.perRun.length} runs the simulator did not mark disposing hearings, so disposals were inferred from the log (a substantive JUDGEMENT hearing, or a substantive hearing of a case already past judgment). Settlements on a mediation report are not counted in those runs.`);
  const unrouted = summary.perRun.filter((r) => (r.scorecards.extra.disposedRouteInferred ?? 0) > 0).length;
  if (unrouted > 0)
    L.push("", `Note: in ${unrouted} of ${summary.perRun.length} runs some disposing rows carried no route, so the route was inferred (a post-judgment closure for a case already decided, a settlement on a REPORTS hearing, a verdict otherwise). Default acquittals, dismissals, compounding and long-pending splits cannot be told apart in those rows.`);
  L.push("");

  for (const rosterId of summary.rosters) {
    const cells = summary.cells.filter((c) => c.rosterId === rosterId);
    const pols = summary.policies.filter((p) => cells.some((c) => c.policyId === p));
    L.push(`## Roster ${rosterId}`, "");
    for (const fam of FAMILIES) {
      L.push(`### ${FAMILY_TITLE[fam]}`, "");
      L.push(row(["Measure", "Unit", ...pols]), row(["---", "---", ...pols.map(() => "---:")]));
      for (const key of fieldKeys(fam, cells)) {
        const m = META.get(key);
        const label = m?.label ?? key;
        L.push(row([escapeCell(label), unitNote(m), ...pols.map((p) => cellText(cells.find((c) => c.policyId === p)?.fields[key], m))]));
      }
      L.push("");
    }

    L.push("### Readings side by side", "");
    for (const g of SIDE_BY_SIDE) {
      L.push(`#### ${g.title}`, "", g.note, "");
      L.push(row(["Measure", "Unit", ...pols]), row(["---", "---", ...pols.map(() => "---:")]));
      for (const key of g.keys) {
        const m = META.get(key);
        L.push(row([escapeCell(m?.label ?? key), unitNote(m), ...pols.map((p) => cellText(cells.find((c) => c.policyId === p)?.fields[key], m))]));
      }
      L.push("");
    }

    const paired = summary.paired.filter((p) => p.rosterId === rosterId);
    if (paired.length) {
      const others = pols.filter((p) => p !== summary.baselineId);
      L.push(`### Paired differences against ${summary.baselineId}`, "");
      L.push(`Policy minus ${summary.baselineId} on the same world seeds, with a 95% bootstrap interval. "better" or "worse" marks an interval that excludes zero on a measure with a direction. Shares are in percentage points.`, "");
      for (const fam of FAMILIES) {
        L.push(`#### ${FAMILY_TITLE[fam]}`, "");
        L.push(row(["Measure", ...others]), row(["---", ...others.map(() => "---:")]));
        for (const key of fieldKeys(fam, cells)) {
          const m = META.get(key);
          const text = others.map((p) => {
            const d = paired.find((x) => x.policyId === p && x.field === key)?.diff;
            return d ? `${fmt(d.mean, m, true)} [${fmt(d.lo, m, true)}, ${fmt(d.hi, m, true)}]${verdict(d, m)}` : "n/a";
          });
          L.push(row([escapeCell(m?.label ?? key), ...text]));
        }
        L.push("");
      }
      for (const g of SIDE_BY_SIDE) {
        L.push(`#### ${g.title}, paired`, "");
        L.push(row(["Measure", ...others]), row(["---", ...others.map(() => "---:")]));
        for (const key of g.keys) {
          const m = META.get(key);
          const text = others.map((p) => {
            const d = paired.find((x) => x.policyId === p && x.field === key)?.diff;
            return d ? `${fmt(d.mean, m, true)} [${fmt(d.lo, m, true)}, ${fmt(d.hi, m, true)}]${verdict(d, m)}` : "n/a";
          });
          L.push(row([escapeCell(m?.label ?? key), ...text]));
        }
        L.push("");
      }
    }
  }

  L.push("## Definitions", "");
  L.push(row(["Field", "Measure", "Better", "Source and computation"]), row(["---", "---", "---", "---"]));
  for (const m of SCORECARD_FIELDS) L.push(row([`${m.family}.${m.key}`, escapeCell(m.label), m.better ?? "", escapeCell(m.source)]));
  L.push("");
  return L.join("\n");
}

// Every catalogued field in catalogue order (n/a where a run lacks it, so a missing measure is visible),
// then anything a run reported that the catalogue does not know (never dropped).
function fieldKeys(fam: Family, cells: CellSummary[]): string[] {
  const present = new Set(cells.flatMap((c) => Object.keys(c.fields)).filter((k) => k.startsWith(`${fam}.`)));
  const ordered = SCORECARD_FIELDS.filter((m) => m.family === fam).map((m) => `${m.family}.${m.key}`);
  return [...ordered, ...[...present].filter((k) => !META.has(k)).sort()];
}

function seedText(seeds: number[]): string {
  if (seeds.length === 0) return "none";
  const parts: string[] = [];
  let a = seeds[0] ?? 0;
  let b = a;
  for (const s of seeds.slice(1)) {
    if (s === b + 1) b = s;
    else {
      parts.push(a === b ? `${a}` : `${a}-${b}`);
      a = b = s;
    }
  }
  parts.push(a === b ? `${a}` : `${a}-${b}`);
  return parts.join(", ");
}

/** Pretty JSON, creating the folder; NaN and infinities become null (JSON has no NaN). */
export function writeJson(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, (_k, v) => (typeof v === "number" && !Number.isFinite(v) ? null : v), 2) + "\n");
}

export function writeText(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}
