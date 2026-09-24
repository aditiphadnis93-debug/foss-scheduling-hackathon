// The baselines: today's court (list everything due, flat or PUCAR gaps) and three capped orderings.
// They use only PUCAR's prior per hearing type, never case evidence, so they show what the evidence buys.
//
// Every policy keeps a diary. A real court gives a new date by looking at its diary: when the day the gap
// points to already carries the usual list, the matter goes to the next working day with room. A flat gap
// alone folds every weekend and holiday onto the next working day, so a 60-day gap listed 230 matters on
// Monday 7 December; no court prints a list like that (PUCAR's real 22 Sep causelist has 90 matters).

import type { CaseView, CourtCalendar, JudgeConfig, Outcome, PlanContext, Policy } from "../domain/types";
import { byFiling, dueCases, fillDays, fnv, horizonDays, isDue, liveCases, makePlan, naive, takeToCapacity, type Pick } from "./common";
import { afterGap } from "./nextdate";
import { nextWorkingDayAfter, nextWorkingDayOnOrAfter } from "../data/calendar";

/** The case study's court: about 60 matters listed a day (case study, section 5). status_quo_60's diary holds this many. */
export const SQ60_LIST_SIZE = 60;
/**
 * PUCAR's real causelist for 22 Sep 2026 (sample_causelist_2026-09-22.csv) has 90 matters: the list size of the
 * court whose reference gaps status_quo_ref follows. A cap is realistic because the diary clerk gives the next
 * date by looking at how full each day already is; without one the PUCAR gaps listed about 176 a day and
 * went past 90 on 45 of the 51 sitting days (up to 595 on one day), which no court does.
 */
export const SQ_REF_LIST_SIZE = 90;

/**
 * The court's diary: how much is already promised on each day, rebuilt each morning from the dates the
 * cases carry (the court's own register) plus the dates given so far today. `weightOf` is what a matter
 * costs the day: 1 for a list-size diary, expected minutes for a capped policy's diary.
 */
export class Diary {
  private day = "";
  private cases: readonly CaseView[] | null = null;
  private load = new Map<string, number>();
  private today = new Map<string, { date: string; w: number }>();

  constructor(private weightOf: (c: CaseView, ctx: PlanContext) => number) {}

  private sync(ctx: PlanContext): void {
    if (ctx.date === this.day && ctx.cases === this.cases) return;
    if (ctx.date !== this.day) this.today.clear();
    this.day = ctx.date;
    this.cases = ctx.cases;
    this.load.clear();
    for (const v of ctx.cases) {
      // a case given a date today counts once, on that date
      if (this.today.has(v.id) || v.disposed || v.nextDate === null || v.nextDate <= ctx.date) continue;
      this.add(v.nextDate, this.weightOf(v, ctx));
    }
    for (const e of this.today.values()) this.add(e.date, e.w);
  }

  private add(date: string, w: number): void {
    this.load.set(date, (this.load.get(date) ?? 0) + w);
  }

  loadOn(ctx: PlanContext, date: string): number {
    this.sync(ctx);
    return this.load.get(date) ?? 0;
  }

  /** enter a date given today (replacing any date given to the same case earlier today) */
  book(ctx: PlanContext, c: CaseView, date: string): string {
    this.sync(ctx);
    const old = this.today.get(c.id);
    if (old) this.add(old.date, -old.w);
    const w = this.weightOf(c, ctx);
    this.today.set(c.id, { date, w });
    this.add(date, w);
    return date;
  }

  /**
   * The first candidate day whose load leaves room for the case under `cap`, booked. When none of the
   * candidates has room (a diary full for a year) the least loaded one is used, so a date is always given.
   */
  bookFirstWithRoom(ctx: PlanContext, c: CaseView, candidates: Iterable<string>, cap: number): string {
    this.sync(ctx);
    const w = this.weightOf(c, ctx);
    let least: string | null = null;
    let leastLoad = Infinity;
    for (const d of candidates) {
      const load = this.load.get(d) ?? 0;
      // an empty day always takes the matter, even one longer than the cap
      if (load === 0 || load + w <= cap + 1e-9) return this.book(ctx, c, d);
      if (load < leastLoad) {
        leastLoad = load;
        least = d;
      }
    }
    return this.book(ctx, c, least ?? nextWorkingDayAfter(ctx.date, ctx.calendar));
  }
}

/** how far ahead a diary looks for a day with room: about two years of working days */
const DIARY_REACH = 500;

/** Working days from `from` on, at most DIARY_REACH of them, keeping only the allowed ones. */
export function* workingDaysFrom(from: string, cal: CourtCalendar, allowed?: (d: string) => boolean): Generator<string> {
  let d = nextWorkingDayOnOrAfter(from, cal);
  for (let k = 0; k < DIARY_REACH; k++, d = nextWorkingDayAfter(d, cal)) if (!allowed || allowed(d)) yield d;
}

/** a list-size diary (one per matter) */
export const countDiary = (): Diary => new Diary(() => 1);
/** a capped policy's diary, in the same PUCAR-prior expected minutes it lists by */
export const minutesDiary = (): Diary => new Diary((c, ctx) => naive(c, ctx.ref).minutes);

/**
 * Status quo spread: at most `perDay` cases a working day, in an order fixed by a hash of the case id. The
 * roster is spread evenly over as few days as the cap allows, so no day is above it.
 */
export function spreadInitialDates(ctx: PlanContext, perDay = SQ60_LIST_SIZE): Map<string, string> {
  const live = liveCases(ctx).sort((a, b) => fnv(a.id) - fnv(b.id) || (a.id < b.id ? -1 : 1));
  const nDays = Math.max(1, Math.ceil(live.length / perDay));
  const days = horizonDays(ctx.date, ctx.calendar, Math.max(500, Math.ceil(nDays * 1.6)));
  const out = new Map<string, string>();
  live.forEach((c, i) => out.set(c.id, days[Math.min(days.length - 1, Math.floor((i * nDays) / live.length))]!));
  return out;
}

/** PUCAR's reference gap for the case's purpose, as a working day after the hearing */
export const refGapDate = (ctx: PlanContext, c: CaseView, date: string): string => afterGap(date, ctx.ref[c.nextPurpose].gapDays, ctx.calendar);

/** the capped policies' diary limit: the expected minutes they list to (fill target times the bench day) */
export const dayMinutes = (ctx: PlanContext, cfg: JudgeConfig): number => (ctx.config ?? cfg).fillTarget * ctx.capacityMinutes;

/** PUCAR's gap, then the first working day on or after it with room in a minutes diary */
export const refGapWithRoom = (diary: Diary, ctx: PlanContext, c: CaseView, date: string, cap: number): string =>
  diary.bookFirstWithRoom(ctx, c, workingDaysFrom(refGapDate(ctx, c, date), ctx.calendar), cap);

const pick = (ctx: PlanContext, c: CaseView, why: string): Pick => ({ view: c, ...naive(c, ctx.ref), why: [why] });

function statusQuo(id: "status_quo_60" | "status_quo_ref"): Policy {
  const flat = id === "status_quo_60";
  const listSize = flat ? SQ60_LIST_SIZE : SQ_REF_LIST_SIZE;
  const diary = countDiary();
  return {
    id,
    name: flat ? "Status quo, 60-day gap" : "Status quo, PUCAR gaps",
    description: flat
      ? `The case study's default court: every due case is listed in roster order and the next date is 60 days on, whatever happened, moved to the next working day with room when that day already has ${SQ60_LIST_SIZE} matters.`
      : `Every due case is listed in roster order; the next date follows PUCAR's reference gap for the purpose, moved to the next working day with room when that day already has ${SQ_REF_LIST_SIZE} matters (PUCAR's real causelist size).`,
    asksCheckin: false,
    // both start from the case study's spread of 60 a day, so they differ only in how next dates are given
    initialDates: (ctx) => spreadInitialDates(ctx, SQ60_LIST_SIZE),
    plan(ctx) {
      return makePlan(ctx, dueCases(ctx).map((c) => pick(ctx, c, "due today")), [], []);
    },
    nextDate(ctx, c, _outcome: Outcome, date) {
      const target = flat ? afterGap(date, 60, ctx.calendar) : refGapDate(ctx, c, date);
      return diary.bookFirstWithRoom(ctx, c, workingDaysFrom(target, ctx.calendar), listSize);
    },
  };
}

/**
 * A capped policy: rank the due cases, list to capacity, put the rest on the next working day. Next dates
 * follow PUCAR's gap, moved on to the first working day whose promised expected minutes leave room.
 */
function capped(
  id: string,
  name: string,
  description: string,
  cfg: JudgeConfig,
  rank: (ctx: PlanContext, due: CaseView[]) => CaseView[],
  initial: (ctx: PlanContext) => Map<string, string>,
  reason: string,
): Policy {
  const diary = minutesDiary();
  return {
    id,
    name,
    description,
    asksCheckin: false,
    initialDates: initial,
    plan(ctx) {
      const conf = ctx.config ?? cfg;
      const ranked = rank(ctx, dueCases(ctx)).map((c) => pick(ctx, c, reason));
      const { taken, left } = takeToCapacity(ranked, conf.fillTarget * ctx.capacityMinutes);
      const to = nextWorkingDayAfter(ctx.date, ctx.calendar);
      for (const k of left) diary.book(ctx, k.view, to);
      return makePlan(ctx, taken, [], left.map((k) => ({ caseId: k.view.id, to, reason: "over capacity" })));
    },
    nextDate: (ctx, c, _o, date) => refGapWithRoom(diary, ctx, c, date, dayMinutes(ctx, cfg)),
  };
}

export function fifoCapped(cfg: JudgeConfig): Policy {
  return capped(
    "fifo_capped",
    "First come, capped",
    "Due cases in the order they were promised (oldest filing breaks ties) until expected minutes reach the capacity; the rest move to the next working day.",
    cfg,
    (_ctx, due) => due.sort((a, b) => (a.nextDate! < b.nextDate! ? -1 : a.nextDate! > b.nextDate! ? 1 : byFiling(a, b))),
    (ctx) => spreadInitialDates(ctx),
    "first come, first listed",
  );
}

export function binPacking(cfg: JudgeConfig): Policy {
  return capped(
    "bin_packing",
    "Bin packing",
    "Greedy by PUCAR's P(substantive) per expected minute until the day is full: the strawman that fills bins.",
    cfg,
    (ctx, due) =>
      due
        .map((c) => ({ c, d: naive(c, ctx.ref).p / naive(c, ctx.ref).minutes }))
        .sort((a, b) => b.d - a.d || byFiling(a.c, b.c))
        .map((x) => x.c),
    (ctx) => spreadInitialDates(ctx),
    "high chance per minute",
  );
}

export function oldestFirst(cfg: JudgeConfig): Policy {
  return capped(
    "oldest_first",
    "Oldest first",
    "Fairness first: the oldest filings until the day is full, from the first day of the horizon.",
    cfg,
    (_ctx, due) => due.sort(byFiling),
    (ctx) =>
      fillDays(
        ctx,
        liveCases(ctx)
          .sort(byFiling)
          .map((c) => ({ view: c, minutes: naive(c, ctx.ref).minutes })),
        cfg.fillTarget * ctx.capacityMinutes,
      ),
    "oldest pending",
  );
}

export const statusQuo60 = (): Policy => statusQuo("status_quo_60");
export const statusQuoRef = (): Policy => statusQuo("status_quo_ref");
export { isDue };
