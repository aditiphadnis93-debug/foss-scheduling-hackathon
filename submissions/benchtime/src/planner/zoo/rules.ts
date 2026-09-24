// A judge's saved rules: JudgeConfig plus the optional rules a judge sets in the console (weekday themes, a
// cap on matters, half days, leave, what is called first, notice and gap limits, a cap per advocate). The
// zoo honours every one on top of whatever genome the tournament picked; `ruleViolations` checks a plan
// against them (tests, the API's preview, scripts/rules-check.ts). The three judges of the case study are
// presets a judge can start from and edit: they are rules, not the baseline policies.

import { addDays, daysBetween, isWorkingDay, toMinutes, weekday } from "../../data/calendar";
import type { CaseView, DayPlan, HearingType, JudgeConfig, Outcome, PlanContext } from "../../domain/types";
import type { Genome } from "./genome";

export type Block = JudgeConfig["blocks"][number] & { newestFirst?: boolean };

export interface Rules extends JudgeConfig {
  /** weekday themes: blocks for a given weekday (0 Sunday .. 6 Saturday), replacing `blocks` that day */
  blocksByWeekday?: Partial<Record<number, Block[]>>;
  /** never more than this many matters listed (standby included) */
  maxListed?: number;
  /** half-day sittings: 210 minutes */
  halfDays?: string[];
  /** a weekday that is always a half day (for example Friday afternoons kept for dictating judgments) */
  halfDayWeekdays?: number[];
  /** the judge's leave: nothing listed and no date given on these days */
  leaveDays?: string[];
  /** these purposes are selected and called first (bail, custody, warrants) */
  priorityTypes?: HearingType[];
  /** a next date at least this many days after the day it is given */
  minNoticeDays?: number;
  /** no next date more than this many days after the day it is given */
  maxGapDays?: number;
  /** at most this many matters of one advocate on a day */
  maxPerAdvocate?: number;
  /** an advocate's matters called one after another (Dimakar); clusterByAdvocate bundles their dates */
  groupByAdvocate?: boolean;
  /** matters carried from an earlier list (not reached, or not listed for want of room) are selected first (Sehgal) */
  carriedFirst?: boolean;
}

export const HALF_DAY_MINUTES = 210;
export const EVIDENCE_TYPES: HearingType[] = ["EXAMINATION_UNDER_S351_BNSS", "EVIDENCE_COMPLAINANT", "EVIDENCE_ACCUSED", "ARGUMENTS", "JUDGEMENT"];
export const APPEARANCE_TYPES: HearingType[] = ["ADMISSION", "DELAY_CONDONATION_HEARING", "COGNIZANCE", "APPEARANCE", "WARRANT", "PLEA", "BAIL", "REPORTS", "APPLICATION_REVIEW"];
const SEHGAL_FRESH: HearingType[] = ["ADMISSION", "DELAY_CONDONATION_HEARING", "COGNIZANCE", "APPEARANCE", "WARRANT", "BAIL", "APPLICATION_REVIEW"];

export interface RulePreset {
  id: string;
  name: string;
  description: string;
  rules: Partial<Rules>;
}

/** The case study's judges as rule sets over our planner (edit any field; the 15% floor still holds). */
export const RULE_PRESETS: Record<string, RulePreset> = {
  sehgal_way: {
    id: "sehgal_way",
    name: "Sehgal's way",
    description: "Fresh and notice matters 11:00 to 13:30, the oldest matters 14:30 to 16:30, every matter given a time; a matter not reached returns the same weekday next week and is taken first; lists past the day (fill 130%).",
    rules: {
      blocks: [
        { id: "fresh", start: "11:00", end: "13:30", types: [...SEHGAL_FRESH] },
        { id: "oldest", start: "14:30", end: "16:30", types: "all", oldestFirst: true },
      ],
      carryForward: true,
      carriedFirst: true,
      fillTarget: 1.3,
    },
  },
  dimakar_way: {
    id: "dimakar_way",
    name: "Dimakar's way",
    description: "Evidence, arguments and judgments on Monday, Wednesday and Friday; appearances and process on Tuesday and Thursday; oldest first; an advocate's matters called together; never past the day's capacity.",
    rules: {
      blocksByWeekday: Object.fromEntries([
        ...[1, 3, 5].map((d) => [d, [{ id: "evidence", start: "10:30", end: "17:00", types: [...EVIDENCE_TYPES], oldestFirst: true }]]),
        ...[2, 4].map((d) => [d, [{ id: "appearance", start: "10:30", end: "17:00", types: [...APPEARANCE_TYPES], oldestFirst: true }]]),
      ]),
      clusterByAdvocate: true,
      groupByAdvocate: true,
      fillTarget: 1,
    },
  },
  joshi_way: {
    id: "joshi_way",
    name: "Joshi's way",
    description: "Fresh matters first: the youngest filings called first all day; old cases get the 15% floor and no more (fairness weight 0).",
    rules: {
      blocks: [{ id: "fresh first", start: "10:30", end: "17:00", types: "all", newestFirst: true } as Block],
      weights: { throughput: 1, substantiveness: 1, fairness: 0, predictability: 1, trips: 1 },
      ageingFloor: 0.15,
    },
  },
};

/** A rule set on top of a base configuration (the preset or the judge's edits win; the floor is clamped). */
export function applyRules(base: JudgeConfig, rules?: Partial<Rules>): Rules {
  const m: Rules = { ...base, ...(rules ?? {}), weights: { ...base.weights, ...(rules?.weights ?? {}) } } as Rules;
  m.ageingFloor = Math.max(0.15, m.ageingFloor);
  return m;
}

const smart = (n: Genome["nextDate"]) => n !== "flat60" && n !== "pucar";

/**
 * The genome the zoo runs once the judge's configuration is laid over it: desk, check-in, clustering,
 * weights and smart next dates follow the configuration. Identity when the configuration is genomeConfig(g).
 */
export function effectiveGenome(g: Genome, c: JudgeConfig): Genome {
  const out: Genome = { ...g, weights: { ...g.weights } };
  out.desk = c.processDesk;
  out.checkin = c.checkin;
  out.cluster = c.clusterByAdvocate;
  if ((c as Rules).groupByAdvocate) out.callOrder = "cluster";
  out.weights.throughput = c.weights.throughput;
  out.weights.fairness = c.weights.fairness;
  out.weights.trips = c.weights.trips;
  out.weights.predictability = c.weights.predictability;
  if (c.smartNextDate !== smart(g.nextDate)) out.nextDate = c.smartNextDate ? "earliest" : "pucar";
  // time slots imply times: a judge who sets blocks gets call times, so every listing sits inside its slot
  const byDay = Object.values((c as Rules).blocksByWeekday ?? {});
  if (c.blocks.length > 0 || byDay.some((b) => (b?.length ?? 0) > 0)) out.callTimes = true;
  return out;
}

// ---------------------------------------------------------------------------------------------
// Checking a plan against the rules

export const isHalfDay = (r: Rules, date: string) => !!r.halfDays?.includes(date) || !!r.halfDayWeekdays?.includes(weekday(date));
export const onLeave = (r: Rules, date: string) => !!r.leaveDays?.includes(date);

/** the blocks in force on a date (weekday themes first) */
export function blocksOn(r: Rules, date: string): Block[] {
  const byDay = r.blocksByWeekday?.[weekday(date)];
  if (byDay && byDay.length) return byDay;
  return r.blocks as Block[];
}

/** whether the rules admit a purpose on a date (weekday themes and leave) */
export function admits(r: Rules, t: HearingType, date: string): boolean {
  if (onLeave(r, date)) return false;
  const byDay = r.blocksByWeekday?.[weekday(date)];
  if (!byDay || byDay.length === 0) return true;
  return byDay.some((b) => b.types === "all" || b.types.includes(t));
}

export interface Violation {
  date: string;
  rule: string;
  caseId?: string;
  detail: string;
}

const UNHEARD = new Set<Outcome>(["not_reached", "vacated", "deferred", "court_not_sitting"]);

/** Every way a day's plan breaks the judge's rules (empty when it keeps them all). */
export function ruleViolations(r: Rules, ctx: PlanContext, plan: DayPlan, capacity = 420): Violation[] {
  const out: Violation[] = [];
  const date = ctx.date;
  const byId = new Map(ctx.cases.map((c) => [c.id, c]));
  const v = (rule: string, detail: string, caseId?: string) => out.push({ date, rule, detail, ...(caseId ? { caseId } : {}) });
  if (onLeave(r, date) && plan.listings.length > 0) v("leave", `${plan.listings.length} matters listed on a leave day`);
  if (r.maxListed !== undefined && plan.listings.length > r.maxListed) v("maxListed", `${plan.listings.length} listed, cap ${r.maxListed}`);
  const cap = isHalfDay(r, date) ? Math.min(HALF_DAY_MINUTES, capacity) : capacity;
  const main = plan.listings.filter((l) => !l.standby);
  const mins = main.reduce((s, l) => s + l.expectedMinutes, 0);
  // the fill target is honoured up to one matter past it (the selection admits a first matter that overflows)
  const biggest = main.reduce((m, l) => Math.max(m, l.expectedMinutes), 0);
  if (mins > r.fillTarget * cap + biggest + 1e-6) v("fillTarget", `${mins.toFixed(0)} expected minutes, target ${(r.fillTarget * cap).toFixed(0)}${cap < capacity ? " (half day)" : ""}`);
  const blocks = blocksOn(r, date);
  const dayEnd = isHalfDay(r, date) && blocks.length ? toMinutes(blocks[0]!.start) + HALF_DAY_MINUTES + 60 : Infinity;
  for (const l of plan.listings) {
    if (!admits(r, l.type, date)) v("weekdayTheme", `${l.type} is not in ${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][weekday(date)]}'s theme`, l.caseId);
    if (blocks.length && !blocks.some((b) => b.types === "all" || b.types.includes(l.type))) v("blockTypes", `${l.type} is in none of the day's blocks`, l.caseId);
    if (blocks.length && !l.standby && l.window !== "mention") {
      const b = blocks.find((x) => `${x.start}-${x.end}` === l.window);
      if (!b) v("blockTime", `listed outside the blocks (window ${l.window})`, l.caseId);
      else {
        if (!(b.types === "all" || b.types.includes(l.type))) v("blockTypes", `${l.type} in the ${b.id} block`, l.caseId);
        const t = l.callTime ? toMinutes(l.callTime) : NaN;
        if (!(t >= toMinutes(b.start) && t < toMinutes(b.end))) v("blockTime", `call time ${l.callTime} outside ${b.start}-${b.end}`, l.caseId);
        if (t > dayEnd) v("halfDay", `call time ${l.callTime} on a half day`, l.caseId);
      }
    }
  }
  // order inside a block: oldest (or newest) filing first
  // (with advocate groups the groups are ordered by their first matter, so the check is skipped)
  for (const b of r.groupByAdvocate ? [] : blocks) {
    if (!b.oldestFirst && !b.newestFirst) continue;
    const inB = main.filter((l) => l.window === `${b.start}-${b.end}`).map((l) => byId.get(l.caseId)!);
    for (let i = 1; i < inB.length; i++) {
      const a = inB[i - 1]!.filingDate;
      const c = inB[i]!.filingDate;
      if (b.oldestFirst && c < a) v("oldestFirst", `${inB[i]!.id} (${c}) called after ${inB[i - 1]!.id} (${a}) in the ${b.id} block`, inB[i]!.id);
      if (b.newestFirst && c > a) v("newestFirst", `${inB[i]!.id} (${c}) called after ${inB[i - 1]!.id} (${a}) in the ${b.id} block`, inB[i]!.id);
    }
  }
  if (r.priorityTypes?.length) {
    const pri = (l: { type: HearingType }) => r.priorityTypes!.includes(l.type);
    let seenOther = false;
    for (const l of main) {
      if (l.window === "mention") continue;
      if (!pri(l)) seenOther = true;
      else if (seenOther && !blocks.length) v("priorityTypes", `${l.type} called after other matters`, l.caseId);
    }
  }
  if (r.maxPerAdvocate !== undefined) {
    const n = new Map<string, number>();
    for (const l of plan.listings) {
      const a = byId.get(l.caseId)!.advocateId;
      n.set(a, (n.get(a) ?? 0) + 1);
    }
    for (const [a, k] of n) if (k > r.maxPerAdvocate) v("maxPerAdvocate", `${a} has ${k} matters, cap ${r.maxPerAdvocate}`);
  }
  if (r.groupByAdvocate) {
    // each advocate's matters called together inside a block (or the day)
    const groups = blocks.length ? blocks.map((b) => main.filter((l) => l.window === `${b.start}-${b.end}`)) : [main.filter((l) => l.window !== "mention")];
    for (const gr of groups) {
      const seen = new Set<string>();
      let prev = "";
      for (const l of gr) {
        // priority purposes are called first, so an advocate may have one group there and one after
        const a = `${r.priorityTypes?.includes(l.type) ? "p" : ""}${byId.get(l.caseId)!.advocateId}`;
        if (a !== prev && seen.has(a)) v("groupByAdvocate", `${a}'s matters split in the call order`, l.caseId);
        seen.add(a);
        prev = a;
      }
    }
  }
  for (const d of plan.deferred) {
    const c = byId.get(d.caseId);
    if (c) out.push(...nextDateViolations(r, ctx, c, "deferred", date, d.to));
  }
  return out;
}

/** Every way a next date breaks the rules (weekday themes, leave, carry-forward, notice, gap). */
export function nextDateViolations(r: Rules, ctx: PlanContext, c: CaseView, outcome: Outcome, date: string, to: string): Violation[] {
  const out: Violation[] = [];
  const v = (rule: string, detail: string) => out.push({ date, rule, caseId: c.id, detail });
  if (!(to > date)) v("nextDate", `next date ${to} not after ${date}`);
  if (!isWorkingDay(to, ctx.calendar)) v("nextDate", `${to} is not a working day`);
  if (onLeave(r, to)) v("leave", `next date ${to} is a leave day`);
  if (!admits(r, c.nextPurpose, to)) v("weekdayTheme", `${c.nextPurpose} dated on ${to}, outside its weekday theme`);
  if (r.carryForward && UNHEARD.has(outcome)) {
    // the same weekday next week, or the next day the rules allow after it
    let d = addDays(date, 7);
    for (let k = 0; k < 60 && !(isWorkingDay(d, ctx.calendar) && admits(r, c.nextPurpose, d)); k++) d = addDays(d, 1);
    const minN = r.minNoticeDays ?? 0;
    if (to !== d && minN <= 7) v("carryForward", `unheard on ${date}: ${to}, not ${d}`);
  }
  if (r.minNoticeDays !== undefined && daysBetween(date, to) < r.minNoticeDays) v("minNoticeDays", `${to} is ${daysBetween(date, to)} days after ${date}`);
  if (r.maxGapDays !== undefined && daysBetween(date, to) > r.maxGapDays + 7) v("maxGapDays", `${to} is ${daysBetween(date, to)} days after ${date}`);
  return out;
}
