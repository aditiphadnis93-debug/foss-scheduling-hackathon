// The case study's three judges, as they describe their own practice, applied to this court's data.
// Each keeps a diary like the baselines (see baselines.ts): after a hearing the date the judge's rule points
// to is kept unless that day already carries a full day's expected minutes, in which case the next day the
// rule allows with room is given, so weekends and holidays do not fold a week's returns onto one Monday.
// Matters a judge carries over from today (Sehgal's same weekday next week, Dimakar's next purpose day, the
// next working day) keep the judge's own rule; they are entered in the diary so later dates see them.

import { stageIndex } from "../domain/lifecycle";
import { addDays, fromMinutes, nextWorkingDayAfter, nextWorkingDayOnOrAfter, toMinutes, weekday } from "../data/calendar";
import type { CaseView, HearingType, JudgeConfig, PlanContext, Policy } from "../domain/types";
import { byFiling, dueCases, fillDays, isOld, liveCases, makePlan, naive, takeToCapacity, type Pick } from "./common";
import { dayMinutes, minutesDiary, refGapDate, refGapWithRoom, spreadInitialDates, workingDaysFrom, type Diary } from "./baselines";
import { nextOnWeekdays } from "./nextdate";

// ---------------------------------------------------------------------------------------------
// Sehgal: fresh and notice matters in the morning block, the oldest matters in the afternoon block;
// an unheard case comes back the same weekday next week; every listing gets a slot.

export const SEHGAL_FRESH: HearingType[] = [
  "ADMISSION",
  "DELAY_CONDONATION_HEARING",
  "COGNIZANCE",
  "APPEARANCE",
  "WARRANT",
  "BAIL",
  "APPLICATION_REVIEW",
];

/**
 * Sehgal's carry-forward: the same weekday next week, or the next working day after it when that day is a
 * holiday. It is never moved for room: he promises unheard matters priority on next week's list.
 */
const carryForward = (diary: Diary, ctx: PlanContext, c: CaseView, date: string): string =>
  diary.book(ctx, c, nextWorkingDayOnOrAfter(addDays(date, 7), ctx.calendar));

export function sehgal(cfg: JudgeConfig): Policy {
  const diary = minutesDiary();
  return {
    id: "sehgal",
    name: "Justice Sehgal",
    description:
      "Blocks by purpose: fresh and notice matters 11:00 to 13:30, the oldest matters 14:30 to 16:30, with slot times; an unheard case returns the same weekday next week.",
    asksCheckin: false,
    initialDates: (ctx) => spreadInitialDates(ctx),
    plan(ctx) {
      const conf = ctx.config ?? cfg;
      const blocks = conf.blocks.length > 0 ? conf.blocks : defaultSehgalBlocks();
      const total = blocks.reduce((s, b) => s + (toMinutes(b.end) - toMinutes(b.start)), 0) || 1;
      let pool = dueCases(ctx);
      const listed: Pick[] = [];
      // the court's 420 minutes are shared between the blocks in proportion to their lengths
      for (const b of blocks) {
        const len = toMinutes(b.end) - toMinutes(b.start);
        const cap = (conf.fillTarget * ctx.capacityMinutes * len) / total;
        const eligible = pool.filter((c) => b.types === "all" || b.types.includes(c.nextPurpose));
        const ranked = (b.oldestFirst ? eligible.sort(byFiling) : eligible.sort((a, b2) => (a.nextDate! < b2.nextDate! ? -1 : a.nextDate! > b2.nextDate! ? 1 : byFiling(a, b2))))
          .map((c) => ({ view: c, ...naive(c, ctx.ref), why: [b.oldestFirst ? `${b.id} block: oldest matters` : `${b.id} block`] }) as Pick);
        const { taken } = takeToCapacity(ranked, cap);
        let used = 0;
        for (const k of taken) {
          const t = toMinutes(b.start) + Math.round(((used / cap) * len) / 5) * 5;
          k.callTime = fromMinutes(Math.min(t, toMinutes(b.end) - 5));
          k.window = `${b.start}-${b.end}`;
          used += k.minutes;
          listed.push(k);
        }
        const chosen = new Set(taken.map((k) => k.view.id));
        pool = pool.filter((c) => !chosen.has(c.id));
      }
      const deferred = pool.map((c) => ({
        caseId: c.id,
        to: conf.carryForward ? carryForward(diary, ctx, c, ctx.date) : diary.book(ctx, c, nextWorkingDayAfter(ctx.date, ctx.calendar)),
        reason: conf.carryForward ? "carried to the same weekday next week" : "over capacity",
      }));
      return makePlan(ctx, listed, [], deferred);
    },
    nextDate(ctx, c, outcome, date) {
      const conf = ctx.config ?? cfg;
      const unheard = outcome === "not_reached" || outcome === "vacated" || outcome === "deferred" || outcome === "court_not_sitting";
      if (conf.carryForward && unheard) return carryForward(diary, ctx, c, date);
      return refGapWithRoom(diary, ctx, c, date, dayMinutes(ctx, cfg));
    },
  };
}

export function defaultSehgalBlocks(): JudgeConfig["blocks"] {
  return [
    { id: "fresh", start: "11:00", end: "13:30", types: [...SEHGAL_FRESH] },
    { id: "oldest", start: "14:30", end: "16:30", types: "all", oldestFirst: true },
  ];
}

// ---------------------------------------------------------------------------------------------
// Dimakar: purpose days (evidence and arguments Mon/Wed/Fri, appearances and process Tue/Thu),
// matters grouped by advocate, the oldest first within the day's capacity.

const EVIDENCE_DAYS = [1, 3, 5];
const APPEARANCE_DAYS = [2, 4];
const EVIDENCE_PURPOSES = new Set<HearingType>(["EXAMINATION_UNDER_S351_BNSS", "EVIDENCE_COMPLAINANT", "EVIDENCE_ACCUSED", "ARGUMENTS", "JUDGEMENT"]);
export const dimakarDays = (t: HearingType): number[] => (EVIDENCE_PURPOSES.has(t) ? EVIDENCE_DAYS : APPEARANCE_DAYS);

export function dimakar(cfg: JudgeConfig): Policy {
  const diary = minutesDiary();
  return {
    id: "dimakar",
    name: "Justice Dimakar",
    description:
      "Purpose days (evidence and arguments on Monday, Wednesday and Friday; appearances and process on Tuesday and Thursday), grouped by advocate, oldest first, capped at the day's capacity.",
    asksCheckin: false,
    initialDates(ctx) {
      const cap = cfg.fillTarget * ctx.capacityMinutes;
      return fillDays(
        ctx,
        liveCases(ctx)
          .sort(byFiling)
          .map((c) => ({ view: c, minutes: naive(c, ctx.ref).minutes })),
        cap,
        { allowedOn: (c, day) => dimakarDays(c.nextPurpose).includes(weekday(day)) },
      );
    },
    plan(ctx) {
      const conf = ctx.config ?? cfg;
      const today = weekday(ctx.date);
      const due = dueCases(ctx);
      const matches = (c: CaseView) => dimakarDays(c.nextPurpose).includes(today);
      // the day's purpose first, oldest first; other due matters only fill what is left
      const ranked = [...due.filter(matches).sort(byFiling), ...due.filter((c) => !matches(c)).sort(byFiling)].map(
        (c) => ({ view: c, ...naive(c, ctx.ref), why: [matches(c) ? "purpose day" : "fills spare time"] }) as Pick,
      );
      const { taken, left } = takeToCapacity(ranked, conf.fillTarget * ctx.capacityMinutes);
      const listed = conf.clusterByAdvocate ? clusterOrder(taken) : taken;
      const deferred = left.map((k) => ({
        caseId: k.view.id,
        to: diary.book(ctx, k.view, nextOnWeekdays(nextWorkingDayAfter(ctx.date, ctx.calendar), dimakarDays(k.view.nextPurpose), ctx.calendar)),
        reason: "over capacity: next purpose day",
      }));
      return makePlan(ctx, listed, [], deferred);
    },
    nextDate(ctx, c, outcome, date) {
      const quick = outcome === "not_reached" || outcome === "court_not_sitting" || outcome === "deferred";
      const from = quick ? nextWorkingDayAfter(date, ctx.calendar) : refGapDate(ctx, c, date);
      // the first purpose day on or after it with room in the diary
      const days = dimakarDays(c.nextPurpose);
      return diary.bookFirstWithRoom(ctx, c, workingDaysFrom(from, ctx.calendar, (d) => days.includes(weekday(d))), dayMinutes(ctx, cfg));
    },
  };
}

/** Keep each advocate's matters together, advocates in the order their first matter was ranked. */
export function clusterOrder(picks: Pick[]): Pick[] {
  const groups = new Map<string, Pick[]>();
  for (const k of picks) {
    const g = groups.get(k.view.advocateId);
    if (g) g.push(k);
    else groups.set(k.view.advocateId, [k]);
  }
  const out: Pick[] = [];
  for (const g of groups.values()) {
    if (g.length > 1) for (const k of g) k.why = [...k.why, `grouped with ${g.length - 1} other matter${g.length > 2 ? "s" : ""} of the same advocate`];
    out.push(...g);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Joshi: fresh matters first (early stages, youngest filings), the fairness floor kept at its minimum.

const joshiRank = (a: CaseView, b: CaseView): number =>
  stageIndex(a.stage) - stageIndex(b.stage) || (a.filingDate > b.filingDate ? -1 : a.filingDate < b.filingDate ? 1 : a.id < b.id ? -1 : 1);

export function joshi(cfg: JudgeConfig): Policy {
  const diary = minutesDiary();
  return {
    id: "joshi",
    name: "Justice Joshi",
    description: "Fresh matters first (early stages, youngest filings), capped at the day's capacity, with the minimum fairness floor for 4+ year cases.",
    asksCheckin: false,
    initialDates(ctx) {
      return fillDays(
        ctx,
        liveCases(ctx)
          .sort(joshiRank)
          .map((c) => ({ view: c, minutes: naive(c, ctx.ref).minutes })),
        cfg.fillTarget * ctx.capacityMinutes,
        { floorShare: Math.max(0.15, cfg.ageingFloor) },
      );
    },
    plan(ctx) {
      const conf = ctx.config ?? cfg;
      const cap = conf.fillTarget * ctx.capacityMinutes;
      const floor = Math.max(0.15, conf.ageingFloor) * cap;
      const due = dueCases(ctx);
      const listed: Pick[] = [];
      let used = 0;
      const chosen = new Set<string>();
      // the floor: the oldest due matters get the first share of the day
      for (const c of due.filter((x) => isOld(x, ctx.date)).sort(byFiling)) {
        if (used >= floor) break;
        const n = naive(c, ctx.ref);
        if (used + n.minutes > floor && used > 0) continue;
        listed.push({ view: c, ...n, why: ["fairness floor: 4+ year case"] });
        chosen.add(c.id);
        used += n.minutes;
      }
      const rest = due
        .filter((c) => !chosen.has(c.id))
        .sort(joshiRank)
        .map((c) => ({ view: c, ...naive(c, ctx.ref), why: ["fresh matters first"] }) as Pick);
      const { taken, left } = takeToCapacity(rest, Math.max(0, cap - used));
      // the old share was only offered first in selection; the fresh matters are called first
      const to = nextWorkingDayAfter(ctx.date, ctx.calendar);
      return makePlan(ctx, [...taken, ...listed], [], left.map((k) => ({ caseId: k.view.id, to: diary.book(ctx, k.view, to), reason: "over capacity" })));
    },
    nextDate: (ctx, c, _o, date) => refGapWithRoom(diary, ctx, c, date, dayMinutes(ctx, cfg)),
  };
}

