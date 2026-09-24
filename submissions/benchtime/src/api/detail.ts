// One case as the court knows it on a date (web/API.md, CaseDetail), built only from the CaseView the planner
// receives and the roster record (rule 1: nothing from the world). The prediction is the planner's own
// (predictSubstantive from src/planner/index), and its reasons are an exact decomposition: the case's
// evidence is added to a blank view one piece at a time and each step's change in probability is recorded,
// so PUCAR's prior plus the effects is the planner's number, whatever the predictor does inside.

import type { CaseRecord, CaseView, HearingType, ParsedSummary, PlanContext, RefTables } from "../domain/types";
import { populationStats, predictSubstantive } from "../planner/index";
import {
  HORIZON,
  ROLES,
  ageBand,
  ageYears,
  crossesOn,
  daysBetween,
  getEnv,
  round,
  sentence,
  typeLabel,
  type AgeBand,
  type Role,
} from "./context";

type PopulationStats = ReturnType<typeof populationStats>;

export interface Reason {
  text: string;
  effect: number;
}

export interface CaseDetail {
  id: string;
  filingNumber: string;
  filingDate: string;
  ageYears: number;
  ageBand: AgeBand;
  crossesNext: { years: 3 | 4 | 5 | 10; on: string } | null;
  advocateId: string;
  partyId: string;
  stage: string;
  stageLabel: string;
  nextPurpose: HearingType;
  nextPurposeLabel: string;
  hearingsAtPurpose: number;
  pucarMedianAtPurpose: number;
  totalHearings: number;
  consecutiveNonSubstantive: number;
  lastSummary: { raw: string; notes: string[]; tags: string[] };
  attendance: { last: Record<Role, boolean | null>; record: Record<Role, { present: number; recorded: number }> };
  process: { kind: string; state: "out" | "returned" | "served"; issuedOn: string | null; daysOut: number | null; returnedKnownOn: string | null } | null;
  externalPending: { kind: "mediation_report"; since: string | null; readyKnownOn: string | null } | null;
  prediction: { pSubstantive: number; prior: number; reasons: Reason[] };
  nextDate: string | null;
  lastHeardOn: string | null;
}

/** true when the court has not been told the process is back */
export const processOut = (v: CaseView, date: string) => !!v.process && (v.process.returnedKnownOn === null || v.process.returnedKnownOn > date);
export const reportOut = (v: CaseView, date: string) => !!v.externalPending && (v.externalPending.readyKnownOn === null || v.externalPending.readyKnownOn > date);

const REACHED = new Set(["substantive", "failed"]);

/** The docket's pooled records, computed once per morning (the planner caches on the same array). */
export const statsOf = (ctx: PlanContext): PopulationStats => populationStats(ctx.cases);

/** P(substantive) exactly as the planner computes it. */
export function pOf(v: CaseView, ctx: PlanContext, stats = statsOf(ctx)): number {
  return predictSubstantive(v, ctx.ref, ctx.date, stats).p;
}

// the parts of a why[] line that are bookkeeping, not evidence
const BOOKKEEPING = /^(pucar prior|predicted )/i;

/** Prior plus signed effects, in the order the evidence is added, summing exactly to the prediction. */
export function explain(v: CaseView, ref: RefTables, date: string, stats: PopulationStats): { p: number; prior: number; reasons: Reason[] } {
  const prior = ref[v.nextPurpose].pSubstantive;
  const blankSummary: ParsedSummary = {
    ...v.lastSummary,
    attendance: { complainant: null, complainantAdvocate: null, accused: null, accusedAdvocate: null },
    lastChance: false,
  };
  // step 1 starts from a blank view that already carries the process and report record, so the first
  // effect reads as "what is outstanding" against PUCAR's prior rather than a detour through a blank case
  let cur: CaseView = { ...v, lastSummary: blankSummary, history: [], hearingsAtPurpose: 0 };
  let useStats: PopulationStats | undefined = undefined;
  let prev = predictSubstantive(cur, ref, date, undefined);
  const raw: Reason[] = [];
  const first = prev.why.filter((w) => !BOOKKEEPING.test(w));
  const nothing = !v.process && !v.externalPending ? "No summons, warrant or report outstanding on record" : "Process and report record";
  raw.push({ text: first.length ? first.map((w) => sentence(w)).join("; ") : nothing, effect: prev.p - prior });
  const steps: [string, () => void][] = [
    ["Attendance recorded across the docket and for this advocate", () => (useStats = stats)],
    ["Who attended the last hearing", () => (cur = { ...cur, lastSummary: { ...cur.lastSummary, attendance: v.lastSummary.attendance } })],
    ["Hearings the court has recorded since 1 October", () => (cur = { ...cur, history: v.history })],
    ["Last chance order at the last hearing", () => (cur = { ...cur, lastSummary: { ...cur.lastSummary, lastChance: v.lastSummary.lastChance } })],
    ["Hearings already held at this purpose", () => (cur = { ...cur, hearingsAtPurpose: v.hearingsAtPurpose })],
  ];
  for (const [fallback, apply] of steps) {
    apply();
    const next = predictSubstantive(cur, ref, date, useStats);
    const before = new Set(prev.why);
    const added = next.why.filter((w) => !before.has(w) && !BOOKKEEPING.test(w));
    raw.push({ text: added.length ? added.map((w) => sentence(w)).join("; ") : fallback, effect: next.p - prev.p });
    prev = next;
  }
  const p = round(prev.p, 3);
  // keep what moved the number, rounded; the residual of rounding goes to the largest effect
  const reasons = raw.filter((r) => Math.abs(r.effect) >= 0.0005).map((r) => ({ text: r.text, effect: round(r.effect, 3) }));
  const residual = round(p - round(prior, 3) - reasons.reduce((s, r) => s + r.effect, 0), 3);
  if (Math.abs(residual) > 0) {
    if (reasons.length === 0) reasons.push({ text: "Adjusted for this case's record", effect: residual });
    else {
      const big = reasons.reduce((a, b) => (Math.abs(b.effect) > Math.abs(a.effect) ? b : a));
      big.effect = round(big.effect + residual, 3);
    }
  }
  return { p, prior: round(prior, 3), reasons };
}

/** Hearings in a row that did not move the case: the court's own record, then the roster's count at the purpose. */
export function consecutiveNonSubstantive(v: CaseView, rec: CaseRecord | undefined): { count: number; recorded: string[] } {
  const recorded: string[] = [];
  let sawSubstantive = false;
  for (let i = v.history.length - 1; i >= 0; i--) {
    const h = v.history[i]!;
    if (h.outcome === "substantive") {
      sawSubstantive = true;
      break;
    }
    if (h.outcome === "failed") recorded.unshift(h.reason ?? "unclear");
  }
  // before the horizon the roster counts hearings at the purpose; none of them moved the case past it
  const fromRoster = sawSubstantive || !rec ? 0 : rec.hearingCounts[rec.nextPurpose] ?? 0;
  return { count: fromRoster + recorded.length, recorded };
}

export function caseDetail(v: CaseView, ctx: PlanContext, stats = statsOf(ctx)): CaseDetail {
  const env = getEnv();
  const date = ctx.date;
  const rec = env.byId.get(v.id);
  const age = ageYears(v.filingDate, date);
  let crossesNext: CaseDetail["crossesNext"] = null;
  for (const y of [3, 4, 5, 10] as const) {
    const on = crossesOn(v.filingDate, y);
    if (on > date && on <= HORIZON.end) {
      crossesNext = { years: y, on };
      break;
    }
  }
  const reached = v.history.filter((h) => REACHED.has(h.outcome));
  const lastWithAtt = [...v.history].reverse().find((h) => h.attendance !== null);
  const last: Record<Role, boolean | null> = lastWithAtt?.attendance ? { ...lastWithAtt.attendance } : { ...v.lastSummary.attendance };
  const record = Object.fromEntries(ROLES.map((r) => [r, { present: 0, recorded: 0 }])) as Record<Role, { present: number; recorded: number }>;
  for (const r of ROLES) {
    const a = v.lastSummary.attendance[r];
    if (a !== null && a !== undefined) {
      record[r].recorded++;
      if (a) record[r].present++;
    }
    for (const h of v.history) {
      if (!h.attendance) continue;
      record[r].recorded++;
      if (h.attendance[r]) record[r].present++;
    }
  }
  let process: CaseDetail["process"] = null;
  if (v.process) {
    const out = processOut(v, date);
    process = {
      kind: v.process.kind,
      state: out ? "out" : "returned",
      issuedOn: v.process.issuedOn ?? null,
      daysOut: v.process.issuedOn ? Math.max(0, daysBetween(v.process.issuedOn, date)) : null,
      returnedKnownOn: v.process.returnedKnownOn && v.process.returnedKnownOn <= date ? v.process.returnedKnownOn : null,
    };
  } else if (v.lastSummary.process && v.lastSummary.process.status !== "issued") {
    // the last order records it served or returned
    process = { kind: v.lastSummary.process.kind, state: v.lastSummary.process.status, issuedOn: v.lastSummary.process.issuedOn, daysOut: null, returnedKnownOn: null };
  }
  const ext = v.externalPending;
  const ex = explain(v, ctx.ref, date, stats);
  const cons = consecutiveNonSubstantive(v, rec);
  return {
    id: v.id,
    filingNumber: v.filingNumber,
    filingDate: v.filingDate,
    ageYears: round(age, 2),
    ageBand: ageBand(age),
    crossesNext,
    advocateId: v.advocateId,
    partyId: v.partyId,
    stage: v.stage,
    stageLabel: typeLabel(v.stage),
    nextPurpose: v.nextPurpose,
    nextPurposeLabel: typeLabel(v.nextPurpose),
    hearingsAtPurpose: v.hearingsAtPurpose,
    pucarMedianAtPurpose: ctx.ref[v.nextPurpose].hearingsPerCase.median,
    totalHearings: (rec?.totalHearings ?? 0) + reached.length,
    consecutiveNonSubstantive: cons.count,
    lastSummary: { raw: v.lastSummary.raw, notes: [...v.lastSummary.notes], tags: [...v.lastSummary.tags] },
    attendance: { last, record },
    process,
    externalPending: ext ? { kind: "mediation_report", since: ext.since ?? null, readyKnownOn: ext.readyKnownOn && ext.readyKnownOn <= date ? ext.readyKnownOn : null } : null,
    prediction: { pSubstantive: ex.p, prior: ex.prior, reasons: ex.reasons },
    nextDate: v.nextDate,
    lastHeardOn: reached.length ? reached[reached.length - 1]!.date : null,
  };
}

