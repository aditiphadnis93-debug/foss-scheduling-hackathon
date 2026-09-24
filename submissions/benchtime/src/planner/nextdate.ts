// Next dates: the earliest working day after the procedural minimum that still has room in the day's
// promised load, preferring a day on which the same advocate is already coming (one trip, several
// matters). The ledger is rebuilt from the views' promised dates each day (so it can never drift from
// what the court has actually promised) plus the promises made so far today.

import { addDays, isWorkingDay, nextWorkingDayAfter, nextWorkingDayOnOrAfter, weekday } from "../data/calendar";
import type { CaseView, CourtCalendar, PlanContext } from "../domain/types";

/** Promised expected minutes per day, and which advocates are already expected on which days. */
export class LoadLedger {
  private byDate = new Map<string, number>();
  private advDates = new Map<string, Map<string, number>>();

  add(date: string, minutes: number, advocate?: string): void {
    this.byDate.set(date, (this.byDate.get(date) ?? 0) + minutes);
    if (advocate) {
      let m = this.advDates.get(advocate);
      if (!m) this.advDates.set(advocate, (m = new Map()));
      m.set(date, (m.get(date) ?? 0) + 1);
    }
  }
  remove(date: string, minutes: number, advocate?: string): void {
    this.byDate.set(date, (this.byDate.get(date) ?? 0) - minutes);
    const m = advocate ? this.advDates.get(advocate) : undefined;
    if (m) {
      const n = (m.get(date) ?? 0) - 1;
      if (n > 0) m.set(date, n);
      else m.delete(date);
    }
  }
  load(date: string): number {
    return this.byDate.get(date) ?? 0;
  }
  advocateOn(advocate: string, date: string): boolean {
    return (this.advDates.get(advocate)?.get(date) ?? 0) > 0;
  }
}

export interface NextDateRequest {
  /** the day the decision is made; the answer is a working day strictly after it */
  date: string;
  /** procedural minimum (calendar date); the answer is on or after it */
  earliest: string;
  /** expected minutes the case will take on the new date */
  minutes: number;
  /** expected minutes a day may be promised */
  capacity: number;
  advocate?: string;
  /** working days past the first day with room within which a day with the advocate's other matters wins */
  bundleDays?: number;
  /** allowed weekdays (0 = Sunday), for purpose days */
  weekdays?: number[];
  /** working days to search before settling for the least-loaded day */
  maxDays?: number;
}

export interface NextDateAdvice {
  date: string;
  why: string[];
}

/** Earliest working day on or after the procedural minimum with room, bundled with the advocate's matters. */
export function recommendNextDate(req: NextDateRequest, cal: CourtCalendar, ledger: LoadLedger): NextDateAdvice {
  const floor = req.earliest > req.date ? req.earliest : addDays(req.date, 1);
  let d = nextWorkingDayOnOrAfter(floor, cal);
  if (d <= req.date) d = nextWorkingDayAfter(req.date, cal);
  const allowed = (x: string): boolean => !req.weekdays || req.weekdays.includes(weekday(x));
  const maxDays = req.maxDays ?? 120;
  const bundle = req.bundleDays ?? 3;
  let first: string | null = null;
  let least: string | null = null;
  let leastLoad = Infinity;
  let seen = 0;
  for (let k = 0; k < maxDays * 3 && seen < maxDays; k++, d = nextWorkingDayAfter(d, cal)) {
    if (!allowed(d)) continue;
    seen++;
    const load = ledger.load(d);
    if (load < leastLoad) {
      leastLoad = load;
      least = d;
    }
    const room = load + req.minutes <= req.capacity + 1e-9;
    if (!room) continue;
    if (!first) {
      first = d;
      if (!req.advocate || ledger.advocateOn(req.advocate, d)) break;
      // look a few working days on for a day the advocate is already coming
      let e = d;
      for (let j = 0, got = 0; j < bundle * 3 && got < bundle; j++) {
        e = nextWorkingDayAfter(e, cal);
        if (!allowed(e)) continue;
        got++;
        if (ledger.load(e) + req.minutes <= req.capacity + 1e-9 && ledger.advocateOn(req.advocate, e)) {
          return { date: e, why: [`joins the advocate's other matters on ${e} (earliest with room was ${first})`] };
        }
      }
      break;
    }
  }
  if (first) {
    const why = [first === nextWorkingDayOnOrAfter(floor, cal) ? `earliest working day after the procedural minimum` : `earliest day with room after the procedural minimum`];
    if (req.advocate && ledger.advocateOn(req.advocate, first)) why.push("the advocate has other matters that day");
    return { date: first, why };
  }
  return { date: least ?? nextWorkingDayAfter(req.date, cal), why: ["no day with room in range: least loaded day"] };
}

/**
 * A policy's promise book: the ledger for the current day, rebuilt from the views' promised dates and the
 * promises made since. `minutesOf` gives the expected minutes a promised case will take.
 */
export class PromiseBook {
  private day = "";
  private cases: readonly CaseView[] | null = null;
  private ledger = new LoadLedger();
  private contrib = new Map<string, { date: string; minutes: number; advocate: string }>();
  private today = new Map<string, { date: string; minutes: number; advocate: string }>();

  constructor(private minutesOf: (v: CaseView, ctx: PlanContext) => number) {}

  get(ctx: PlanContext): LoadLedger {
    if (ctx.date !== this.day) this.today.clear();
    if (ctx.date !== this.day || ctx.cases !== this.cases) {
      this.day = ctx.date;
      this.cases = ctx.cases;
      this.ledger = new LoadLedger();
      this.contrib.clear();
      for (const v of ctx.cases) {
        const t = this.today.get(v.id);
        if (t) this.put(v.id, t);
        else if (!v.disposed && v.nextDate !== null && v.nextDate > ctx.date)
          this.put(v.id, { date: v.nextDate, minutes: this.minutesOf(v, ctx), advocate: v.advocateId });
      }
    }
    return this.ledger;
  }

  promise(ctx: PlanContext, v: CaseView, date: string, minutes: number): void {
    this.get(ctx);
    const e = { date, minutes, advocate: v.advocateId };
    this.today.set(v.id, e);
    this.put(v.id, e);
  }

  private put(id: string, e: { date: string; minutes: number; advocate: string }): void {
    const old = this.contrib.get(id);
    if (old) this.ledger.remove(old.date, old.minutes, old.advocate);
    this.ledger.add(e.date, e.minutes, e.advocate);
    this.contrib.set(id, e);
  }
}

/** A working day strictly after `date`, at least `gapDays` calendar days on. */
export function afterGap(date: string, gapDays: number, cal: CourtCalendar): string {
  const d = nextWorkingDayOnOrAfter(addDays(date, Math.max(1, Math.round(gapDays))), cal);
  return d > date ? d : nextWorkingDayAfter(date, cal);
}

/** The first working day on or after `from` falling on one of `weekdays`. */
export function nextOnWeekdays(from: string, weekdays: number[], cal: CourtCalendar): string {
  let d = nextWorkingDayOnOrAfter(from, cal);
  for (let k = 0; k < 60 && !weekdays.includes(weekday(d)); k++) d = nextWorkingDayAfter(d, cal);
  return d;
}

export { isWorkingDay };
