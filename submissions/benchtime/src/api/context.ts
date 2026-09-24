// What every endpoint shares: the seed-42 roster, PUCAR's tables, the calendar and the calibrated world,
// loaded once per process, plus the horizon, the weeks the console charts, labels and small helpers.
// The API reaches the engine only through its public modules (src/data, src/planner/index,
// src/world/simulate and defaults, src/eval), so a new benchtime planner drops in without changes here.

import { resolve } from "node:path";
import { addDays, ageYears, daysBetween, isWorkingDay, nextWorkingDayAfter, nextWorkingDayOnOrAfter, weekday, workingDays } from "../data/calendar";
import { loadCalendar, toMinutes } from "../data/calendar";
import { loadRefTables } from "../data/reference";
import { caseIdOf, loadRoster } from "../data/roster";
import type { CaseRecord, CourtCalendar, FailureReason, HearingType, JudgeConfig, Policy, ProcessKind, RefTables, SequentialType } from "../domain/types";
import { CAPACITY_MINUTES, configFor, minGapDays, worldParams } from "../eval/arena";
import { AIMS, POLICIES, POLICY_IDS } from "../planner/index";
import type { Block, Rules } from "../planner/zoo/rules";
import type { WorldParams } from "../world/api";

export const ROOT = resolve(import.meta.dir, "../..");
export const ROSTER_PATH = resolve(ROOT, "data/roster_3000_seed42.csv");
export const ROSTER_ID = "roster_3000_seed42";
export const HORIZON = { start: "2026-10-01", end: "2026-12-15" } as const;
export const CAPACITY = CAPACITY_MINUTES;
/** the world seed the console's day-by-day views run on (the shared court) */
export const PLAN_SEED = 42;
export const SEEDS = { tuning: [1, 20], validation: [21, 30], test: [31, 60], interactiveDefault: [31, 40] } as const;
export const DEFAULT_SEEDS = range(31, 40);
export const QUICK_SEEDS = range(31, 35);
export const SITTING = { start: "10:00", end: "17:30", breaks: [{ start: "13:30", end: "14:00" }] };
// the tournament winner (out/tournament/winner.json), the zoo at its default genome
export const RECOMMENDED = "zoo";
export const BASELINE = "status_quo_60";

export const AGE_BANDS = ["0-1", "1-3", "3-4", "4-5", "5+"] as const;
export type AgeBand = (typeof AGE_BANDS)[number];
export type Role = "complainant" | "complainantAdvocate" | "accused" | "accusedAdvocate";
export const ROLES: Role[] = ["complainant", "complainantAdvocate", "accused", "accusedAdvocate"];

export function range(a: number, b: number): number[] {
  const out: number[] = [];
  for (let i = a; i <= b; i++) out.push(i);
  return out;
}

export interface Env {
  records: CaseRecord[];
  byId: Map<string, CaseRecord>;
  ref: RefTables;
  calendar: CourtCalendar;
  params: WorldParams;
  gaps: Partial<Record<HearingType, number>>;
  /** working days of the horizon */
  days: string[];
}

let env: Env | null = null;

/** The shared court, loaded on first use (about 100 ms). */
export function getEnv(): Env {
  if (env) return env;
  const records = loadRoster(ROSTER_PATH);
  const ref = loadRefTables();
  const calendar = loadCalendar();
  env = {
    records,
    byId: new Map(records.map((r) => [caseIdOf(r), r])),
    ref,
    calendar,
    params: worldParams(ref, records),
    gaps: minGapDays(ref),
    days: workingDays(HORIZON.start, HORIZON.end, calendar),
  };
  return env;
}

// ---------------------------------------------------------------------------------------------
// Policies and configuration

export const POLICY_KIND: Record<string, "baseline" | "judge" | "ours"> = {
  status_quo_60: "baseline",
  status_quo_ref: "baseline",
  fifo_capped: "baseline",
  bin_packing: "baseline",
  oldest_first: "baseline",
  sehgal: "judge",
  dimakar: "judge",
  joshi: "judge",
  benchtime: "ours",
};

export class HttpError extends Error {
  constructor(public status: number, message: string, public detail?: string) {
    super(message);
  }
}

export function checkPolicy(id: unknown): string {
  const p = id === undefined || id === null || id === "" ? RECOMMENDED : id;
  if (typeof p !== "string" || !(p in POLICIES)) throw new HttpError(400, "unknown policy", `${String(p)}; known: ${POLICY_IDS.join(", ")}`);
  return p;
}

const num = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/**
 * A request's Partial<JudgeConfig>, checked field by field: unknown fields and wrong types are dropped so a
 * stale browser setting cannot break a plan; numbers are clamped to the console's own limits.
 */
export function cleanConfig(raw: unknown): Partial<JudgeConfig> | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "object" || Array.isArray(raw)) throw new HttpError(400, "config must be an object");
  const c = raw as Record<string, unknown>;
  const out: Partial<JudgeConfig> = {};
  // the judge's aim picks the tournament's best genome for it (src/planner/zoo/presets.ts AIM_GENOMES)
  if (typeof c.aim === "string" && AIMS.includes(c.aim)) (out as { aim?: string }).aim = c.aim;
  if (c.weights && typeof c.weights === "object") {
    const w: Partial<JudgeConfig["weights"]> = {};
    for (const k of ["throughput", "substantiveness", "fairness", "predictability", "trips"] as const) {
      const v = (c.weights as Record<string, unknown>)[k];
      if (num(v)) w[k] = clamp(v, 0, 10);
    }
    out.weights = w as JudgeConfig["weights"];
  }
  if (num(c.fillTarget)) out.fillTarget = clamp(c.fillTarget, 0.3, 2);
  if (num(c.ageingFloor)) out.ageingFloor = clamp(c.ageingFloor, 0, 1);
  if (num(c.standbyShare)) out.standbyShare = clamp(c.standbyShare, 0, 0.5);
  for (const k of ["clusterByAdvocate", "carryForward", "processDesk", "checkin", "smartNextDate"] as const) if (typeof c[k] === "boolean") out[k] = c[k] as boolean;
  if (Array.isArray(c.blocks)) out.blocks = cleanBlocks(c.blocks);
  // the judge's saved rules (src/planner/zoo/rules.ts): weekday themes, caps, half days, leave, call order
  const r = out as Partial<Rules>;
  if (c.blocksByWeekday && typeof c.blocksByWeekday === "object" && !Array.isArray(c.blocksByWeekday)) {
    const by: Partial<Record<number, Block[]>> = {};
    for (const [k, v] of Object.entries(c.blocksByWeekday as Record<string, unknown>)) {
      const d = Number(k);
      if (Number.isInteger(d) && d >= 0 && d <= 6 && Array.isArray(v)) by[d] = cleanBlocks(v);
    }
    r.blocksByWeekday = by;
  }
  const int = (x: unknown, lo: number, hi: number): number | undefined => (num(x) ? Math.round(clamp(x, lo, hi)) : undefined);
  const setInt = (k: "maxListed" | "minNoticeDays" | "maxGapDays" | "maxPerAdvocate", lo: number, hi: number) => {
    const v = int(c[k], lo, hi);
    if (v !== undefined) r[k] = v;
  };
  setInt("maxListed", 1, 500);
  setInt("minNoticeDays", 0, 90);
  setInt("maxGapDays", 1, 365);
  setInt("maxPerAdvocate", 1, 200);
  const dates = (x: unknown): string[] | undefined => (Array.isArray(x) ? [...new Set(x.filter((d): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d))))].sort().slice(0, 400) : undefined);
  const hd = dates(c.halfDays);
  if (hd) r.halfDays = hd;
  const lv = dates(c.leaveDays);
  if (lv) r.leaveDays = lv;
  if (Array.isArray(c.halfDayWeekdays)) r.halfDayWeekdays = [...new Set(c.halfDayWeekdays.filter((d): d is number => Number.isInteger(d) && (d as number) >= 0 && (d as number) <= 6))];
  if (Array.isArray(c.priorityTypes)) r.priorityTypes = c.priorityTypes.filter((t): t is HearingType => typeof t === "string" && t in getEnv().ref);
  if (typeof c.groupByAdvocate === "boolean") r.groupByAdvocate = c.groupByAdvocate;
  if (typeof c.carriedFirst === "boolean") r.carriedFirst = c.carriedFirst;
  return out;
}

/** Blocks from a request: well-formed times (start before end), known purposes, oldest or newest first. */
function cleanBlocks(raw: unknown[]): Block[] {
  const blocks: Block[] = [];
  for (const b of raw as Record<string, unknown>[]) {
    if (!b || typeof b.id !== "string" || typeof b.start !== "string" || typeof b.end !== "string") continue;
    if (!/^\d{1,2}:\d{2}$/.test(b.start) || !/^\d{1,2}:\d{2}$/.test(b.end)) continue;
    if (toMinutes(b.start) >= toMinutes(b.end)) continue;
    const types = b.types === "all" ? "all" : Array.isArray(b.types) ? (b.types.filter((t) => typeof t === "string" && t in getEnv().ref) as HearingType[]) : "all";
    blocks.push({ id: b.id, start: b.start, end: b.end, types, ...(b.oldestFirst === true ? { oldestFirst: true } : b.newestFirst === true ? { newestFirst: true } : {}) });
  }
  return blocks;
}

/** The effective configuration: the policy's own, the request layered on, the 15% floor enforced. */
export const effectiveConfig = (policyId: string, partial?: Partial<JudgeConfig>): JudgeConfig => configFor(policyId, partial);

/** A fresh policy instance (policies may keep ledgers, so never share one between runs). */
export function makePolicy(policyId: string, partial?: Partial<JudgeConfig>): Policy {
  const f = POLICIES[policyId];
  if (!f) throw new HttpError(400, "unknown policy", policyId);
  return f(partial);
}

/** Stable JSON with sorted keys, for cache keys. */
export function canonical(x: unknown): string {
  if (x === undefined) return "null";
  if (x === null || typeof x !== "object") return JSON.stringify(x);
  if (Array.isArray(x)) return `[${x.map(canonical).join(",")}]`;
  const o = x as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
    .join(",")}}`;
}

// ---------------------------------------------------------------------------------------------
// Weeks: Monday to Sunday, clipped to the horizon; week 1 starts on the first day

export interface Week {
  week: number;
  start: string;
  end: string;
  sittingDays: number;
}

export function horizonWeeks(end: string = HORIZON.end): Week[] {
  const { calendar } = getEnv();
  const out: Week[] = [];
  let s: string = HORIZON.start;
  let n = 1;
  while (s <= end) {
    const toSunday = (7 - weekday(s)) % 7;
    const e0 = addDays(s, toSunday);
    const e = e0 < end ? e0 : end;
    out.push({ week: n++, start: s, end: e, sittingDays: workingDays(s, e, calendar).length });
    s = addDays(e, 1);
  }
  return out;
}

/** The last day of the first `weeks` weeks (the whole horizon when absent). */
export function endOfWeeks(weeks?: number): string {
  const all = horizonWeeks();
  if (weeks === undefined || weeks >= all.length) return HORIZON.end;
  return all[Math.max(0, weeks - 1)]!.end;
}

// ---------------------------------------------------------------------------------------------
// Dates, ages, labels

export const inHorizon = (d: string) => d >= HORIZON.start && d <= HORIZON.end;
export { addDays, ageYears, daysBetween, isWorkingDay, nextWorkingDayAfter, nextWorkingDayOnOrAfter };

export function ageBand(age: number): AgeBand {
  return age < 1 ? "0-1" : age < 3 ? "1-3" : age < 4 ? "3-4" : age < 5 ? "4-5" : "5+";
}

/** The first date on which a case filed on `filing` is `years` old (365.25-day years, as the scorecards count). */
export function crossesOn(filing: string, years: number): string {
  return addDays(filing, Math.ceil(years * 365.25 - 1e-9));
}

export const round = (x: number, d = 2): number => {
  if (!Number.isFinite(x)) return x;
  const k = 10 ** d;
  return Math.round(x * k) / k;
};

export const TYPE_LABEL: Record<HearingType, string> = {
  ADMISSION: "Admission",
  DELAY_CONDONATION_HEARING: "Delay condonation",
  COGNIZANCE: "Cognizance",
  APPEARANCE: "Appearance",
  WARRANT: "Warrant",
  PLEA: "Plea",
  EXAMINATION_UNDER_S351_BNSS: "Examination u/s 351",
  EVIDENCE_COMPLAINANT: "Complainant evidence",
  EVIDENCE_ACCUSED: "Defence evidence",
  ARGUMENTS: "Arguments",
  JUDGEMENT: "Judgement",
  BAIL: "Bail",
  REPORTS: "Reports",
  APPLICATION_REVIEW: "Application review",
};

export const REASON_LABEL: Record<FailureReason, string> = {
  court_admin: "Court administrative issue",
  court_holiday: "Court holiday or no sitting",
  respondent_absent: "Accused absent or not complying",
  petitioner_absent: "Complainant absent or not complying",
  sought_time: "Party sought time",
  not_ready: "Evidence or filing not ready",
  awaiting_process: "Summons, notice or warrant not returned",
  external_dependency: "Outside report not ready",
  both_absent: "Both parties absent or unready",
  unclear: "Unclear",
};

export const KIND_LABEL: Record<ProcessKind, string> = {
  summons: "Summons",
  notice: "Notice",
  warrant: "Warrant",
  warrant_bailable: "Bailable warrant",
  warrant_nonbailable: "Non-bailable warrant",
};

export const typeLabel = (t: HearingType | SequentialType): string => TYPE_LABEL[t] ?? t;
/** "summons not yet returned" -> "Summons not yet returned." */
export function sentence(s: string, stop = false): string {
  const t = s.trim().replace(/\s+/g, " ");
  if (!t) return t;
  const u = t.charAt(0).toUpperCase() + t.slice(1);
  return stop && !/[.!?]$/.test(u) ? `${u}.` : u;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
/** "2026-10-01" -> "Thursday 1 October" */
export function longDate(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return `${WEEKDAYS[weekday(iso)]} ${d} ${MONTHS[(m ?? 1) - 1]}`;
}

/** The working day a date's picture is read on: the date itself, or the next working day inside the horizon. */
export function stateDate(date: string): string {
  const { calendar } = getEnv();
  const d = date < HORIZON.start ? HORIZON.start : date;
  const w = nextWorkingDayOnOrAfter(d, calendar);
  const last = getEnv().days[getEnv().days.length - 1]!;
  return w > last ? last : w;
}

export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
export function checkDate(d: unknown, what = "date"): string {
  if (typeof d !== "string" || !ISO_DATE.test(d) || Number.isNaN(Date.parse(`${d}T00:00:00Z`))) throw new HttpError(400, `${what} is required as YYYY-MM-DD`);
  return d;
}
