// The zoo: one meta-policy whose every design choice is a gene (src/planner/zoo/genome.ts), so the ideas of
// the seven redesigns, the baselines and the three judges can be mixed and the mix chosen by evidence (the
// tournament, scripts/tournament.ts) rather than by hand. Each day it runs the same pipeline:
//   1. triage the due cases: the process desk, the day-before check-in (optionally robust to its noise),
//      short review calls for matters unseen too long, 2-minute mentions for never-heard old cases;
//   2. forced calls for the 4+ year rotation, if on;
//   3. the selection rule (exact knapsack, index, P per minute, oldest, youngest, first come, portfolio,
//      the simple rule, or list everything) with the fairness floor, inside the judge's blocks and themes;
//   4. the call order, call times, a standby list, the judge's cap on matters;
//   5. a next date for every case not heard today by the next-date rule, in the policy's own diary.
// Everything comes from PlanContext (rule 1); nothing here imports src/world.

import { addDays, daysBetween, nextWorkingDayAfter, nextWorkingDayOnOrAfter, toMinutes, fromMinutes, weekday } from "../data/calendar";
import { requiredRoles } from "../domain/lifecycle";
import type { CaseView, DayPlan, DeskAction, HearingType, JudgeConfig, Outcome, PlanContext, Policy, Role } from "../domain/types";
import { spreadInitialDates } from "./baselines";
import { benchClock, byFiling, dueCases, fillDays, liveCases, makePlan, windowOf, type Pick } from "./common";
import { PromiseBook, afterGap } from "./nextdate";
import { CALL_MINUTES, closeness, processGroup, processPending, reportPending, type PopulationStats } from "./predict";
import { addWorkingDays, findDay, nextAllowed, planFirstDates, Projection, type Placeable } from "./zoo/dates";
import { Estimator } from "./zoo/estimate";
import { floorOf, genomeConfig, validate, type Genome } from "./zoo/genome";
import { daysUnseen, greedyWithFloor, heardInHorizon, knapsackSelect, portfolioSelect, rankCands, score, type Cand } from "./zoo/select";
import { DEFAULT_GENOME } from "./zoo/presets";
import { HALF_DAY_MINUTES, effectiveGenome, isHalfDay, onLeave, type Block, type Rules } from "./zoo/rules";

const COMPLAINANT_SIDE: Role[] = ["complainant", "complainantAdvocate"];
const ACCUSED_SIDE: Role[] = ["accused", "accusedAdvocate"];
const UNHEARD = new Set<Outcome>(["not_reached", "vacated", "deferred", "court_not_sitting"]);

/** Sehgal's fresh-morning, old-afternoon blocks (as the case study describes them). */
export const SEHGAL_BLOCKS: JudgeConfig["blocks"] = [
  { id: "fresh", start: "11:00", end: "13:30", types: ["ADMISSION", "DELAY_CONDONATION_HEARING", "COGNIZANCE", "APPEARANCE", "WARRANT", "BAIL", "APPLICATION_REVIEW"] },
  { id: "oldest", start: "14:30", end: "16:30", types: "all", oldestFirst: true },
];
const EVIDENCE_PURPOSES = new Set<HearingType>(["EXAMINATION_UNDER_S351_BNSS", "EVIDENCE_COMPLAINANT", "EVIDENCE_ACCUSED", "ARGUMENTS", "JUDGEMENT"]);
/** Dimakar's purpose days: evidence and arguments Mon, Wed, Fri; appearances and process Tue, Thu. */
export const purposeWeekdays = (t: HearingType): number[] => (EVIDENCE_PURPOSES.has(t) ? [1, 3, 5] : [2, 4]);

/** true when a side the hearing needs said "not ready" the day before */
export function releasedAtCheckin(ctx: PlanContext, c: CaseView): boolean {
  const a = ctx.checkins.get(c.id);
  if (!a) return false;
  const need = requiredRoles(c.nextPurpose);
  return (need.some((r) => COMPLAINANT_SIDE.includes(r)) && a.complainant === "not_ready") || (need.some((r) => ACCUSED_SIDE.includes(r)) && a.accused === "not_ready");
}

export interface ZooDayPlan extends DayPlan {
  zoo?: { candidates: number; forced: number; mentions: number; reviews: number; desk: number; released: number };
}

/** The zoo policy for a genome. `own` is the judge's configuration (its rules win where it has them). */
export function zooPolicy(own: JudgeConfig, genome: Genome = DEFAULT_GENOME, id = "zoo", name = "Zoo"): Policy {
  // the judge's configuration wins over the genome where it speaks (desk, check-in, clustering, weights, next dates)
  const g = effectiveGenome(validate(genome), own);
  const est = new Estimator(g);
  const proj = new Projection();
  let start: string | null = null;
  const firstDeadline = new Map<string, string>();

  const conf = (ctx: PlanContext): Rules => (ctx.config ?? own) as Rules;
  const capacity = (ctx: PlanContext, date = ctx.date): number => (onLeave(conf(ctx), date) ? 0 : isHalfDay(conf(ctx), date) ? Math.min(HALF_DAY_MINUTES, ctx.capacityMinutes) : ctx.capacityMinutes);
  /** the earliest date a next date may take: the judge's minimum notice */
  const noticeFrom = (ctx: PlanContext, date: string): string => {
    const n = conf(ctx).minNoticeDays;
    return n && n > 0 ? addDays(date, n) : addDays(date, 1);
  };
  const later = (a: string, b: string) => (a > b ? a : b);
  const blocked = (c: CaseView, date: string) => g.desk && (processPending(c, date) || reportPending(c, date));

  // the diary: matters (a list-size diary) or expected minutes, rebuilt each day from the promised dates
  const book = new PromiseBook((v, ctx) => {
    if (g.countDiary) return 1;
    if (blocked(v, v.nextDate!)) return g.pendingHold * est.clearedMinutes(v, ctx);
    return est.estimate(v, ctx, v.nextDate!).minutes;
  });
  const promiseCap = (ctx: PlanContext) => (g.countDiary ? g.countCap : g.promiseFill * ctx.capacityMinutes);

  function blocksFor(ctx: PlanContext, date: string): Block[] {
    const c = conf(ctx);
    const byDay = c.blocksByWeekday?.[weekday(date)];
    const all: Block[] = byDay && byDay.length ? byDay : c.blocks.length ? c.blocks : g.blocks === "sehgal" ? SEHGAL_BLOCKS : [];
    if (!isHalfDay(c, date) || all.length === 0) return all;
    // a half day: the blocks are kept in order until 210 minutes of sitting, the last one cut short
    const out: Block[] = [];
    let left = HALF_DAY_MINUTES;
    for (const b of all) {
      if (left <= 0) break;
      const len = Math.max(0, toMinutes(b.end) - toMinutes(b.start));
      out.push(len <= left ? b : { ...b, end: fromMinutes(toMinutes(b.start) + left) });
      left -= len;
    }
    return out;
  }
  /** hard rule: a hearing type is listed only on days whose blocks admit it (weekday themes) */
  function typeAllowed(ctx: PlanContext, t: HearingType, date: string): boolean {
    const c = conf(ctx);
    const byDay = c.blocksByWeekday?.[weekday(date)];
    if (!byDay || byDay.length === 0) return true;
    return byDay.some((b) => b.types === "all" || b.types.includes(t));
  }
  const dateAllowed = (ctx: PlanContext, t: HearingType) => (d: string) =>
    !onLeave(conf(ctx), d) && typeAllowed(ctx, t, d) && (!g.purposeDays || purposeWeekdays(t).includes(weekday(d)));

  /** when the court can expect to be told a pending process or report is back, and whether it is overdue */
  function expectedBack(c: CaseView, ctx: PlanContext, stats: PopulationStats, date: string): { date: string; overdue: boolean } {
    if (processPending(c, date)) {
      const p = c.process!;
      const mean = stats.returnDays[processGroup(p.kind)];
      const span = Math.round(mean * g.returnMargin);
      const expected = p.issuedOn ? addDays(p.issuedOn, span + 1) : addDays(date, Math.round(span / 2));
      if (expected > date) return { date: expected, overdue: false };
      const late = p.issuedOn ? daysBetween(p.issuedOn, date) : 0;
      return { date: addDays(date, g.recheckDays), overdue: late > 2 * mean };
    }
    const since = c.externalPending?.since ?? null;
    const span = Math.round(ctx.ref.REPORTS.gapDays * g.returnMargin);
    const expected = since ? addDays(since, span + 1) : addDays(date, Math.round(span / 2));
    return expected > date ? { date: expected, overdue: false } : { date: addDays(date, g.recheckDays), overdue: true };
  }

  /** the date by which the rotation brings a case back (4+ year cases; every case with rotationAll) */
  function rotationDeadline(ctx: PlanContext, c: CaseView, from: string | null): string | null {
    if (g.coverage !== "rotation" || (!g.rotationAll && daysBetween(c.filingDate, ctx.date) < 4 * 365.25)) return null;
    if (from === null) return firstDeadline.get(c.id) ?? addWorkingDays(start ?? ctx.date, g.rotationDays, ctx.calendar);
    return addWorkingDays(from, g.rotationDays, ctx.calendar);
  }
  /** the last date the case was before the bench (with rotationAll, or acted on at the desk) */
  const lastBench = (c: CaseView): string | null => {
    for (let i = c.history.length - 1; i >= 0; i--) {
      const h = c.history[i]!;
      if (h.outcome === "substantive" || h.outcome === "failed" || (g.rotationAll && h.outcome === "desk")) return h.date;
    }
    return null;
  };
  const rotates = (x: Cand) => x.old || g.rotationAll;

  /** book a date in the diary (and its projected returns) */
  function promise(ctx: PlanContext, c: CaseView, date: string, minutes: number, p: number): string {
    book.promise(ctx, c, date, minutes);
    if (g.nextDate === "projected") proj.book(c.id, ctx.calendar, date, minutes, p, ctx.ref[c.nextPurpose].gapDays, g.relistDays, closeness(c) === 1);
    return date;
  }

  /** the next date for a case after `outcome` on `date` */
  function nextDateFor(ctx: PlanContext, c: CaseView, outcome: Outcome, date: string): string {
    const stats = est.stats(ctx);
    const ledger = book.get(ctx);
    const allowed = dateAllowed(ctx, c.nextPurpose);
    const e = est.estimate(c, ctx, date);
    const wUnit = (m: number) => (g.countDiary ? 1 : m);
    // Sehgal's carry-forward: an unheard matter returns the same weekday next week, never moved for room
    if (conf(ctx).carryForward && UNHEARD.has(outcome)) return promise(ctx, c, nextAllowed(later(addDays(date, 7), noticeFrom(ctx, date)), ctx.calendar, allowed), wUnit(e.minutes), e.p);
    const last = c.history[c.history.length - 1];
    const heard = g.gapOfHeard && last && last.date === date ? last.type : c.nextPurpose;
    const gap = ctx.ref[heard].gapDays;
    const smart = g.nextDate === "earliest" || g.nextDate === "projected";
    const cap = smart ? Math.max(promiseCap(ctx), g.countDiary ? g.countCap : g.relistCap * ctx.capacityMinutes) : promiseCap(ctx);
    const extra = g.nextDate === "projected" ? (d: string) => proj.get(d) : undefined;
    const bundle = g.cluster && g.nextDate !== "flat60" && g.nextDate !== "pucar" ? (g.selection === "index" ? 1 : 3) : 0;
    const minE = noticeFrom(ctx, date);
    const req = (earliest: string, minutes: number, maxDays: number) =>
      findDay(ledger, ctx.calendar, { after: date, earliest: later(earliest, minE), minutes: wUnit(minutes), cap, maxDays, extra, advocate: bundle ? c.advocateId : undefined, bundleDays: bundle, allowed });
    let to: string;
    let minutes = e.minutes;
    if (blocked(c, date)) {
      // not heard until the blocker is known cleared: dated at the expected return
      minutes = g.pendingHold * est.clearedMinutes(c, ctx);
      to = req(expectedBack(c, ctx, stats, date).date, minutes, 120);
    } else {
      const unheard = UNHEARD.has(outcome) && outcome !== "vacated";
      const failed = outcome === "failed" || outcome === "vacated";
      switch (g.nextDate) {
        case "flat60":
        case "pucar": {
          const base = g.nextDate === "flat60" ? 60 : gap;
          const earliest = g.quickRelist && unheard ? addDays(date, 1) : afterGap(date, base, ctx.calendar);
          to = req(earliest, minutes, 500);
          break;
        }
        case "window": {
          // the simple rule: unheard cases the next day with room; otherwise the first day with room
          // within W working days of PUCAR's gap, else the least loaded of them
          const earliest = g.quickRelist && unheard ? addDays(date, 1) : g.quickRelist && failed ? addDays(date, Math.min(gap, g.relistDays)) : afterGap(date, gap, ctx.calendar);
          to = req(earliest, minutes, g.quickRelist && unheard ? 120 : g.windowDays);
          break;
        }
        default: {
          let earliest: string;
          if (!g.quickRelist || outcome === "substantive") earliest = addDays(date, gap);
          else if (failed) earliest = addDays(date, Math.min(gap, g.relistDays));
          else earliest = addDays(date, 1);
          to = req(earliest, minutes, 120);
        }
      }
    }
    // the rotation: a 4+ year case is back before the bench by its deadline
    const deadline = rotationDeadline(ctx, c, outcome === "substantive" || outcome === "failed" || (g.rotationAll && blocked(c, date)) ? date : lastBench(c));
    const maxGap = conf(ctx).maxGapDays;
    const gapBy = maxGap !== undefined && maxGap > 0 ? addDays(date, maxGap) : null;
    const byDeadline = deadline && to > deadline ? (deadline > date ? nextWorkingDayOnOrAfter(deadline, ctx.calendar) : addWorkingDays(date, 3, ctx.calendar)) : null;
    // the judge's maximum gap, like the rotation, brings the date forward to the least loaded allowed day
    const by = byDeadline && gapBy ? (byDeadline < gapBy ? byDeadline : gapBy) : byDeadline ?? gapBy;
    if (by && to > by) {
      let best: string | null = null;
      for (let d = nextWorkingDayOnOrAfter(minE, ctx.calendar); d <= by; d = nextWorkingDayAfter(d, ctx.calendar)) if (allowed(d) && (best === null || ledger.load(d) < ledger.load(best))) best = d;
      if (best) to = best;
    }
    return promise(ctx, c, to, wUnit(minutes), e.p);
  }

  function initialDates(ctx: PlanContext): Map<string, string> {
    start = ctx.date;
    firstDeadline.clear();
    const stats = est.stats(ctx);
    const live = liveCases(ctx);
    const ledger = book.get(ctx);
    const pc = promiseCap(ctx);
    const allowedOn = (c: CaseView, day: string) => dateAllowed(ctx, c.nextPurpose)(day);
    const needAllowed = g.purposeDays || !!conf(ctx).blocksByWeekday || !!conf(ctx).leaveDays?.length;
    const out = new Map<string, string>();
    if (g.firstDates === "spread") {
      const s = spreadInitialDates(ctx, g.countDiary ? Math.min(g.countCap, 60) : 60);
      for (const [cid, d] of s) {
        const c = live.find((x) => x.id === cid);
        out.set(cid, c && needAllowed ? nextAllowed(d, ctx.calendar, (x) => allowedOn(c, x)) : d);
      }
      return out;
    }
    const before = addDays(ctx.date, -1);
    const ready: Cand[] = [];
    const blockedOld: CaseView[] = [];
    const rotationEnd = g.coverage === "rotation" || g.firstDates === "rotation" ? addWorkingDays(nextWorkingDayOnOrAfter(ctx.date, ctx.calendar), Math.max(0, g.rotationDays - 1), ctx.calendar) : null;
    for (const c of live) {
      if (blocked(c, ctx.date)) {
        const back = expectedBack(c, ctx, stats, ctx.date).date;
        if (g.firstDates === "rotation" && g.reviewDays > 0 && rotationEnd && back > rotationEnd && daysBetween(c.filingDate, ctx.date) >= 4 * 365.25) {
          blockedOld.push(c);
          continue;
        }
        const m = g.pendingHold * est.clearedMinutes(c, ctx);
        const d = findDay(ledger, ctx.calendar, { after: before, earliest: back, minutes: g.countDiary ? 1 : m, cap: pc, maxDays: 120, advocate: c.advocateId, bundleDays: 0, allowed: dateAllowed(ctx, c.nextPurpose) });
        ledger.add(d, g.countDiary ? 1 : m, c.advocateId);
        out.set(c.id, d);
        continue;
      }
      ready.push(score(c, est.estimate(c, ctx), ctx, g, stats));
    }
    const ranked = rankCands(g.selection, ready);
    const weightOf = (x: Cand) => (g.countDiary ? 1 : x.est.minutes);
    if (g.firstDates === "horizon") {
      const pl: Placeable[] = ranked.map((x, i) => ({ view: x.view, minutes: weightOf(x), p: x.est.p, density: ranked.length - i, disposes: closeness(x.view) === 1 }));
      for (const [cid, d] of planFirstDates(ctx, pl, g.initialFill * pc, g.firstOldShare, ledger, g.relistDays, needAllowed ? allowedOn : undefined)) out.set(cid, d);
    } else if (g.firstDates === "rotation") {
      // every 4+ year case within the first K working days (best first), the rest by rank, the first
      // five days full and later days to the initial share so returns have room
      const days: string[] = [];
      for (let d = nextWorkingDayOnOrAfter(ctx.date, ctx.calendar), k = 0; k < 500; k++, d = nextWorkingDayAfter(d, ctx.calendar)) days.push(d);
      const old = [...ranked.filter(rotates).map((x) => ({ view: x.view, m: weightOf(x) })), ...blockedOld.map((v) => ({ view: v, m: g.countDiary ? 1 : CALL_MINUTES }))];
      old.forEach((k, i) => {
        let d = days[Math.min(days.length - 1, Math.floor((i * g.rotationDays) / Math.max(1, old.length)))]!;
        if (needAllowed) d = nextAllowed(d, ctx.calendar, (x) => allowedOn(k.view, x));
        out.set(k.view.id, d);
        firstDeadline.set(k.view.id, d);
        ledger.add(d, k.m, k.view.advocateId);
      });
      const rest = ranked.filter((x) => !rotates(x));
      let i = 0;
      for (let di = 0; di < days.length && i < rest.length; di++) {
        const d = days[di]!;
        const cap = pc * (di < 5 ? 1 : g.initialFill);
        while (i < rest.length) {
          const x = rest[i]!;
          if (ledger.load(d) + weightOf(x) > cap && ledger.load(d) > 0) break;
          const day = needAllowed ? nextAllowed(d, ctx.calendar, (y) => allowedOn(x.view, y)) : d;
          out.set(x.view.id, day);
          ledger.add(day, weightOf(x), x.view.advocateId);
          i++;
        }
      }
      const lastDay = days[days.length - 1]!;
      for (const x of rest) if (!out.has(x.view.id)) out.set(x.view.id, lastDay);
    } else {
      // priority: fill each day in rank order, the old share first
      const filled = fillDays(
        ctx,
        ranked.map((x) => ({ view: x.view, minutes: weightOf(x) })),
        g.initialFill * pc,
        { floorShare: g.enforceFloor ? g.firstOldShare : 0, allowedOn: needAllowed ? allowedOn : undefined },
      );
      for (const [cid, d] of filled) out.set(cid, d);
    }
    // every case acted on within the first rotation: no first date later than its end (spread evenly)
    if (g.coverage === "rotation" && g.rotationAll && rotationEnd) {
      const late = [...out.entries()].filter(([, d]) => d > rotationEnd).map(([cid]) => cid);
      const days: string[] = [];
      for (let d = nextWorkingDayOnOrAfter(ctx.date, ctx.calendar); d <= rotationEnd; d = nextWorkingDayAfter(d, ctx.calendar)) days.push(d);
      late.forEach((cid, i) => {
        const d = days[Math.min(days.length - 1, Math.floor((i * days.length) / Math.max(1, late.length)))]!;
        out.set(cid, d);
        if (!firstDeadline.has(cid)) firstDeadline.set(cid, d);
      });
    }
    if (g.nextDate === "projected") {
      const byId = new Map(ready.map((x) => [x.view.id, x]));
      for (const [cid, d] of out) {
        const x = byId.get(cid);
        if (x) proj.book(cid, ctx.calendar, d, weightOf(x), x.est.p, ctx.ref[x.view.nextPurpose].gapDays, g.relistDays, closeness(x.view) === 1);
      }
    }
    return out;
  }

  function plan(ctx: PlanContext): ZooDayPlan {
    const c0 = conf(ctx);
    start ??= ctx.date;
    est.book.update(ctx);
    if (g.nextDate === "projected") proj.prune(ctx.cases);
    const stats = est.stats(ctx);
    const cap = capacity(ctx);
    const listCap = c0.fillTarget * cap;
    const floorShare = floorOf(g, c0);
    const desk: DeskAction[] = [];
    const deferred: DayPlan["deferred"] = [];
    const cands: Cand[] = [];
    const mentions: Pick[] = [];
    let released = 0;
    // a due case not called today: the next-date rule, or (the capped baselines) simply the next working day
    const deferTo = (c: CaseView, outcome: Outcome, reason: string) => {
      let to: string;
      if (outcome === "deferred" && !g.quickRelist && !c0.carryForward) {
        const e = est.estimate(c, ctx);
        to = promise(ctx, c, nextAllowed(later(nextWorkingDayAfter(ctx.date, ctx.calendar), noticeFrom(ctx, ctx.date)), ctx.calendar, dateAllowed(ctx, c.nextPurpose)), g.countDiary ? 1 : e.minutes, e.p);
      } else to = nextDateFor(ctx, c, outcome, ctx.date);
      deferred.push({ caseId: c.id, to, reason });
    };

    const blocks = blocksFor(ctx, ctx.date);
    /** in a day kept in blocks, a purpose no block admits is not listed today */
    const inBlocks = (t: HearingType) => blocks.length === 0 || blocks.some((b) => b.types === "all" || b.types.includes(t));
    if (onLeave(c0, ctx.date)) {
      for (const c of dueCases(ctx)) deferTo(c, "deferred", "the judge is on leave");
      return makePlan(ctx, [], [], deferred);
    }
    for (const c of dueCases(ctx)) {
      const old = daysBetween(c.filingDate, ctx.date) >= 4 * 365.25;
      // a weekday theme does not admit this purpose today: the next day it does
      if (!typeAllowed(ctx, c.nextPurpose, ctx.date)) {
        deferTo(c, "deferred", "not this weekday's theme");
        continue;
      }
      const review = g.reviewDays > 0 && daysUnseen(c, ctx.date) > g.reviewDays;
      const neverHeard = old && !heardInHorizon(c);
      if (blocked(c, ctx.date)) {
        const deskVisits = c.history.filter((h) => h.outcome === "desk").length;
        if (g.coverage === "mention" && neverHeard && deskVisits >= g.mentionAfter && inBlocks(c.nextPurpose)) {
          mentions.push({ view: c, p: 0.02, minutes: CALL_MINUTES, why: [`${(daysBetween(c.filingDate, ctx.date) / 365.25).toFixed(1)} years old and not yet before the judge in this horizon`, "a 2-minute mention on what holds it up"] });
          continue;
        }
        if (review) {
          cands.push(score(c, est.estimate(c, ctx), ctx, g, stats, "desk"));
          continue;
        }
        const back = expectedBack(c, ctx, stats, ctx.date);
        const proc = processPending(c, ctx.date);
        desk.push({
          caseId: c.id,
          action: !proc ? "await_report" : back.overdue ? "reissue" : "await_return",
          note: !proc ? "report not yet received: taken at the desk, nobody need attend" : back.overdue ? "process long overdue: re-issue and re-check at the desk" : "process not yet returned: taken at the desk, nobody need attend",
        });
        continue;
      }
      if (g.checkin && releasedAtCheckin(ctx, c)) {
        const last = c.history[c.history.length - 1];
        // noisy answers: released at most once in a row, then called with the answer discounted
        if (g.checkinRobust && last && last.outcome === "vacated") {
          const e = est.estimate(c, ctx);
          const p = e.p * 0.6;
          cands.push(score(c, { ...e, p, minutes: p * ctx.ref[c.nextPurpose].durationMin + (1 - p) * CALL_MINUTES, why: [...e.why, "released last time: called despite a second not-ready answer"] }, ctx, g, stats, "released"));
          continue;
        }
        if (g.coverage === "mention" && neverHeard && g.mentionAfter === 0 && inBlocks(c.nextPurpose)) {
          mentions.push({ view: c, p: 0.02, minutes: CALL_MINUTES, why: ["4+ years old and not yet before the judge in this horizon", "a side said it will not be ready: a 2-minute mention"] });
          continue;
        }
        if (review) {
          const e = est.estimate(c, ctx);
          const p = e.p * 0.3;
          cands.push(score(c, { ...e, p, minutes: p * ctx.ref[c.nextPurpose].durationMin + (1 - p) * CALL_MINUTES }, ctx, g, stats, "released"));
          continue;
        }
        released++;
        deferTo(c, "vacated", "released at check-in");
        continue;
      }
      cands.push(score(c, est.estimate(c, ctx), ctx, g, stats));
    }

    // (2) the rotation's forced calls, most overdue first, up to their share of the day
    const forced: Cand[] = [];
    let pool = cands;
    if (g.coverage === "rotation") {
      const due = cands
        .filter(rotates)
        .map((x) => ({ x, d: rotationDeadline(ctx, x.view, lastBench(x.view)) }))
        .filter((o) => o.d !== null && ctx.date >= o.d)
        .sort((a, b) => (a.d! < b.d! ? -1 : a.d! > b.d! ? 1 : byFiling(a.x.view, b.x.view)));
      let used = 0;
      for (const { x } of due) {
        if (used + x.est.minutes > g.rotationCap * listCap && used > 0) break;
        forced.push(x);
        used += x.est.minutes;
      }
      const f = new Set(forced.map((x) => x.view.id));
      pool = cands.filter((x) => !f.has(x.view.id));
    }
    const forcedMin = forced.reduce((s, x) => s + x.est.minutes, 0);
    const forcedOld = forced.reduce((s, x) => s + (x.old ? x.est.minutes : 0), 0);
    const selCap = Math.max(0, listCap - forcedMin - mentions.length * CALL_MINUTES);
    const floorLeft = selCap > 0 ? Math.min(1, Math.max(0, floorShare * listCap - forcedOld) / selCap) : 0;

    // (3) the selection, inside the day's blocks when the judge keeps them
    let ranked = rankCands(g.selection, pool);
    if (g.purposeDays) {
      const today = weekday(ctx.date);
      const match = (x: Cand) => purposeWeekdays(x.view.nextPurpose).includes(today);
      ranked = [...ranked.filter(match), ...ranked.filter((x) => !match(x))];
    }
    // the judge's priority purposes (bail, custody, warrants) are selected and called first
    const priority = new Set<HearingType>(c0.priorityTypes ?? []);
    const isPri = (x: Cand) => priority.has(x.view.nextPurpose);
    if (priority.size) ranked = [...ranked.filter(isPri), ...ranked.filter((x) => !isPri(x))];
    // Sehgal: a matter carried forward (not reached, or not listed for want of room) is promised priority on
    // next week's list, so it is selected first (the call order inside a block is unchanged)
    const carried = (x: Cand) => {
      const last = x.view.history[x.view.history.length - 1];
      return !!last && (last.outcome === "not_reached" || last.outcome === "deferred");
    };
    const carriedFirst = (xs: Cand[]) => (c0.carriedFirst ? [...xs.filter(carried), ...xs.filter((x) => !carried(x))] : xs);
    if (blocks.length === 0 && c0.carriedFirst) ranked = carriedFirst(ranked);
    const main: Pick[] = [];
    const chosenIds = new Set<string>();
    const toPick = (x: Cand, note: string): Pick => ({ view: x.view, p: x.est.p, minutes: x.est.minutes, why: [...x.why, note] });
    if (blocks.length > 0) {
      // each block gets the day's minutes in proportion to its length; call times inside the block
      const total = blocks.reduce((s, b) => s + Math.max(0, toMinutes(b.end) - toMinutes(b.start)), 0) || 1;
      // the rotation's calls go into the first block that admits them, ahead of the block's own choice
      const fits = (b: Block, x: Cand) => b.types === "all" || b.types.includes(x.view.nextPurpose);
      let forcedLeft = forced;
      let left = ranked;
      const newest = (x: Cand, y: Cand) => byFiling(y.view, x.view);
      for (const b of blocks) {
        const len = Math.max(0, toMinutes(b.end) - toMinutes(b.start));
        const bcap = ((selCap + forcedMin) * len) / total;
        const must = forcedLeft.filter((x) => fits(b, x));
        forcedLeft = forcedLeft.filter((x) => !fits(b, x));
        const mustMin = must.reduce((s2, x) => s2 + x.est.minutes, 0);
        let eligible = left.filter((x) => fits(b, x));
        if (b.oldestFirst) eligible = [...eligible].sort((x, y) => byFiling(x.view, y.view));
        else if (b.newestFirst) eligible = [...eligible].sort(newest);
        eligible = carriedFirst(eligible);
        if (priority.size) eligible = [...eligible.filter(isPri), ...eligible.filter((x) => !isPri(x))];
        // the fairness floor holds inside blocks too (it cannot be lowered)
        const { chosen: picked } = greedyWithFloor(eligible, Math.max(0, bcap - mustMin), mustMin > 0 ? 0 : floorLeft);
        let chosen = [...must, ...picked];
        // the call order inside a block: priority purposes first, then oldest or newest filing first when the
        // block says so; an advocate's matters called together (groups ordered by their first matter)
        const order = b.oldestFirst ? (x: Cand, y: Cand) => byFiling(x.view, y.view) : b.newestFirst ? newest : null;
        if (order) chosen = [...chosen].sort(order);
        if (priority.size) chosen = [...chosen.filter(isPri), ...chosen.filter((x) => !isPri(x))];
        if (c0.groupByAdvocate) {
          const groups = new Map<string, Cand[]>();
          for (const x of chosen) {
            const key = `${priority.size && isPri(x) ? 0 : 1}|${x.view.advocateId}`;
            const gr = groups.get(key);
            if (gr) gr.push(x);
            else groups.set(key, [x]);
          }
          chosen = [...groups.values()].flat();
        }
        let used = 0;
        for (const x of chosen) {
          const k = toPick(x, forced.includes(x) ? `4+ year case: rotation due (${g.rotationDays} working days)` : b.oldestFirst ? `${b.id} block: oldest matters` : b.newestFirst ? `${b.id} block: newest matters` : `${b.id} block`);
          if (g.callTimes || conf(ctx).blocks.length || g.blocks !== "none") {
            const t = toMinutes(b.start) + Math.round(((bcap > 0 ? used / bcap : 0) * len) / 5) * 5;
            k.callTime = fromMinutes(Math.min(t, toMinutes(b.end) - 5));
            k.window = `${b.start}-${b.end}`;
          }
          used += x.est.minutes;
          main.push(k);
          chosenIds.add(x.view.id);
        }
        const taken = new Set(chosen.map((x) => x.view.id));
        left = left.filter((x) => !taken.has(x.view.id));
      }
      // a rotation call no block admits waits for a day that does
      for (const x of forcedLeft) {
        chosenIds.delete(x.view.id);
        deferTo(x.view, "deferred", "no block for this purpose today");
      }
    } else {
      let chosen: Cand[];
      let floorPicks = new Set<string>();
      switch (g.selection) {
        case "listAll":
          chosen = ranked;
          break;
        case "knapsack":
          chosen = knapsackSelect(ranked, selCap, floorLeft, g.cluster);
          break;
        case "portfolio":
          chosen = portfolioSelect(ranked, selCap, floorLeft, g.portfolioOld, ctx.date);
          break;
        default: {
          const r = greedyWithFloor(ranked, selCap, floorLeft, g.selection === "youngest" ? (a, b) => byFiling(a.view, b.view) : undefined);
          chosen = r.chosen;
          floorPicks = r.floorPicks;
        }
      }
      // (4) call order
      let ordered: Cand[];
      const rank = new Map(ranked.map((x, i) => [x.view.id, i]));
      const inRank = [...chosen].sort((a, b) => rank.get(a.view.id)! - rank.get(b.view.id)!);
      switch (g.callOrder) {
        case "short":
          ordered = [...chosen].sort(
            (x, y) =>
              ctx.ref[x.view.nextPurpose].durationMin - ctx.ref[y.view.nextPurpose].durationMin ||
              (x.view.advocateId < y.view.advocateId ? -1 : x.view.advocateId > y.view.advocateId ? 1 : 0) ||
              x.est.p - y.est.p ||
              (x.view.id < y.view.id ? -1 : 1),
          );
          break;
        case "simple":
          ordered = rankCands("simple", chosen);
          break;
        case "cluster": {
          const groups = new Map<string, Cand[]>();
          for (const x of inRank) {
            const gr = groups.get(x.view.advocateId);
            if (gr) gr.push(x);
            else groups.set(x.view.advocateId, [x]);
          }
          ordered = [...groups.values()].flat();
          break;
        }
        default:
          // rank order; the youngest-first judge calls the fresh matters before the floor's old ones
          ordered = g.selection === "youngest" ? [...inRank.filter((x) => !floorPicks.has(x.view.id)), ...inRank.filter((x) => floorPicks.has(x.view.id))] : inRank;
      }
      if (priority.size) ordered = [...ordered.filter(isPri), ...ordered.filter((x) => !isPri(x))];
      for (const x of ordered) {
        main.push(toPick(x, x.kind !== "ready" ? "not before the judge for a while: a short review call" : floorPicks.has(x.view.id) ? "fairness floor: 4+ year case" : `selected by the ${g.selection} rule`));
        chosenIds.add(x.view.id);
      }
    }

    // mentions and the rotation's calls first (short, and they must be reached), then the day's list
    const blockTimes = blocks.length > 0;
    let dayList: Pick[] = blockTimes ? main : [...forced.map((x) => toPick(x, `4+ year case: rotation due (${g.rotationDays} working days)`)), ...main];
    if (!blockTimes) for (const x of forced) chosenIds.add(x.view.id);
    if (!blockTimes && (priority.size || c0.groupByAdvocate)) {
      // the judge's call order holds over the rotation's calls too: priority purposes, then advocate groups
      const pri = (k: Pick) => priority.has(k.view.nextPurpose);
      dayList = [...dayList.filter(pri), ...dayList.filter((k) => !pri(k))];
      if (c0.groupByAdvocate) {
        const groups = new Map<string, Pick[]>();
        for (const k of dayList) {
          const key = `${pri(k) ? 0 : 1}|${k.view.advocateId}`;
          const gr = groups.get(key);
          if (gr) gr.push(k);
          else groups.set(key, [k]);
        }
        dayList = [...groups.values()].flat();
      }
    }
    const listed: Pick[] = [...mentions.map((k) => ({ ...k, window: "mention" })), ...dayList];
    if (g.callTimes && !blockTimes) {
      let clock = mentions.length * CALL_MINUTES;
      for (const k of listed) {
        if (k.window === "mention") continue;
        const t = benchClock(clock);
        k.callTime = t;
        k.window = windowOf(t);
        clock += k.minutes;
      }
    } else if (!blockTimes) for (const k of listed) if (k.window !== "mention") k.window = null;

    // standby: the best of the rest, then everyone else gets a date
    const rest = rankCands(g.selection === "listAll" ? "knapsack" : g.selection, pool.filter((x) => !chosenIds.has(x.view.id)));
    const standbyCap = c0.standbyShare * cap;
    let sb = 0;
    const standby: Pick[] = [];
    for (const x of rest) {
      if (x.kind === "desk" || x.kind === "released" || sb >= standbyCap || standbyCap <= 0 || !inBlocks(x.view.nextPurpose)) {
        deferTo(x.view, x.kind === "released" ? "vacated" : "deferred", x.kind === "desk" ? "desk: blocker not cleared" : x.kind === "released" ? "released at check-in" : "no room today");
        continue;
      }
      sb += x.est.minutes;
      standby.push({ view: x.view, p: x.est.p, minutes: x.est.minutes, standby: true, callTime: null, window: "standby", why: [...x.why, "standby: called if time frees up"] });
    }
    let all = [...listed, ...standby];
    // the judge's cap per advocate: an advocate's matters past it get a date
    const perAdv = c0.maxPerAdvocate;
    if (perAdv !== undefined && perAdv >= 0) {
      const n = new Map<string, number>();
      all = all.filter((k) => {
        const m = (n.get(k.view.advocateId) ?? 0) + 1;
        n.set(k.view.advocateId, m);
        if (m <= perAdv) return true;
        deferTo(k.view, "deferred", `over the judge's cap of ${perAdv} matters per advocate`);
        return false;
      });
    }
    // the judge's cap on matters listed
    const maxListed = c0.maxListed;
    if (maxListed !== undefined && maxListed >= 0 && all.length > maxListed) {
      for (const k of all.slice(maxListed)) deferTo(k.view, "deferred", `over the judge's cap of ${maxListed} matters`);
      all = all.slice(0, maxListed);
    }
    for (const k of all) {
      const x = cands.find((y) => y.view.id === k.view.id);
      if (x) est.book.note(k.view.id, ctx.date, k.view.nextPurpose, x.est.pRaw);
    }
    const out: ZooDayPlan = makePlan(ctx, all, desk, deferred);
    out.zoo = { candidates: cands.length, forced: forced.length, mentions: mentions.length, reviews: cands.filter((x) => x.kind !== "ready" && chosenIds.has(x.view.id)).length, desk: desk.length, released };
    return out;
  }

  return {
    id,
    name,
    description: describeGenome(g),
    asksCheckin: g.checkin,
    initialDates,
    plan,
    nextDate: (ctx, c, outcome, date) => nextDateFor(ctx, c, outcome, date),
  };
}

const SELECTION_WORDS: Record<Genome["selection"], string> = {
  knapsack: "an exact knapsack on the value of moving each case",
  index: "one priority index per case (value of a hearing today plus the waiting cost it stops, less wasted trips, per minute)",
  ppm: "the best chance of a useful hearing per minute first",
  oldest: "the oldest filings first",
  youngest: "fresh matters first",
  fifo: "cases in the order they were promised",
  portfolio: "daily budgets for never-heard old cases, disposals and short early hearings, the rest by expected useful hearings",
  simple: "old cases and judgments first, then the likeliest to move",
  listAll: "every due case listed",
};
const NEXT_WORDS: Record<Genome["nextDate"], string> = {
  flat60: "a flat 60-day gap",
  pucar: "PUCAR's reference gap",
  window: "the first day with room within a few weeks of PUCAR's gap",
  earliest: "the earliest day with room after PUCAR's gap (failed or unheard matters sooner)",
  projected: "the earliest day with room once the returns already booked are counted",
};

/** One plain sentence per design choice, for the console and the tournament's report. */
export function describeGenome(g: Genome): string {
  const parts = [
    `Daily list: ${SELECTION_WORDS[g.selection]}, filled to ${Math.round(g.fillTarget * 100)}% of the day${g.standbyShare > 0 ? ` with a ${Math.round(g.standbyShare * 100)}% standby list` : ""}.`,
    `Next dates: ${NEXT_WORDS[g.nextDate]}.`,
    g.desk ? "Process desk: matters whose summons, notice or warrant is not back are handled at the desk." : "No process desk.",
    g.checkin ? `Day-before check-in${g.checkinRobust ? " (a case is released at most once in a row)" : ""}.` : "No check-in.",
    g.coverage === "rotation"
      ? `Every 4+ year case before the bench at least every ${g.rotationDays} working days.`
      : g.coverage === "mention"
        ? "Never-heard 4+ year cases get a 2-minute mention (a coverage device that can game the heard-at-all measure)."
        : `Fairness floor: ${Math.round((g.coverage === "none" ? 0.15 : g.ageingFloor) * 100)}% of minutes offered first to 4+ year cases.`,
    g.calibration !== "off" ? "Predictions recalibrated on the court's own record." : "",
  ];
  return parts.filter(Boolean).join(" ");
}

export { genomeConfig };
