// Dates for the zoo: finding a day with room in the policy's diary, the projection of returns a booking
// will create (the horizon redesign's idea, kept alive for next dates too), and the joint first-date plan
// that books projected returns before first hearings.

import { addDays, nextWorkingDayAfter, nextWorkingDayOnOrAfter, weekday } from "../../data/calendar";
import type { CaseView, CourtCalendar, PlanContext } from "../../domain/types";
import { horizonDays, isOld } from "../common";
import { afterGap, type LoadLedger } from "../nextdate";

/** `k` working days after `date` */
export function addWorkingDays(date: string, k: number, cal: CourtCalendar): string {
  let d = date;
  for (let i = 0; i < k; i++) d = nextWorkingDayAfter(d, cal);
  return d;
}

export interface FindDayRequest {
  /** the answer is a working day strictly after this */
  after: string;
  /** and on or after this calendar date */
  earliest: string;
  minutes: number;
  cap: number;
  /** working days to search before settling for the least loaded one */
  maxDays: number;
  /** extra load per day the room check counts (projected returns) */
  extra?: (d: string) => number;
  advocate?: string;
  bundleDays?: number;
  allowed?: (d: string) => boolean;
}

/**
 * The first allowed working day with room (an empty day always has room, as in the court's diary); a day
 * the advocate already comes to within `bundleDays` wins; when none of `maxDays` days has room, the least
 * loaded of them.
 */
export function findDay(ledger: LoadLedger, cal: CourtCalendar, q: FindDayRequest): string {
  const floor = q.earliest > q.after ? q.earliest : addDays(q.after, 1);
  let d = nextWorkingDayOnOrAfter(floor, cal);
  if (d <= q.after) d = nextWorkingDayAfter(q.after, cal);
  const ok = (x: string) => !q.allowed || q.allowed(x);
  const load = (x: string) => ledger.load(x) + (q.extra ? q.extra(x) : 0);
  const room = (x: string) => {
    const l = load(x);
    return l <= 1e-9 || l + q.minutes <= q.cap + 1e-9;
  };
  let least: string | null = null;
  let leastLoad = Infinity;
  let seen = 0;
  for (let k = 0; k < q.maxDays * 7 && seen < q.maxDays; k++, d = nextWorkingDayAfter(d, cal)) {
    if (!ok(d)) continue;
    seen++;
    const l = load(d);
    if (l < leastLoad) {
      leastLoad = l;
      least = d;
    }
    if (!room(d)) continue;
    if (q.advocate && q.bundleDays && !ledger.advocateOn(q.advocate, d)) {
      let e = d;
      for (let j = 0, got = 0; j < q.bundleDays * 7 && got < q.bundleDays; j++) {
        e = nextWorkingDayAfter(e, cal);
        if (!ok(e)) continue;
        got++;
        if (room(e) && ledger.advocateOn(q.advocate, e)) return e;
      }
    }
    return d;
  }
  return least ?? nextWorkingDayAfter(q.after, cal);
}

/**
 * Expected returns per day from the bookings the policy has made: a case booked on d comes back, in
 * expectation, P x its minutes after PUCAR's gap and (1 - P) x its minutes after the short relisting. A
 * case's projection is replaced whenever it is booked again, so a return is never counted twice.
 */
export class Projection {
  private load = new Map<string, number>();
  private byCase = new Map<string, [string, number][]>();

  book(id: string, cal: CourtCalendar, day: string, minutes: number, p: number, gap: number, relist: number, disposes: boolean): void {
    this.drop(id);
    const parts: [string, number][] = [[afterGap(day, Math.min(gap, relist), cal), (1 - p) * minutes]];
    if (!disposes) parts.push([afterGap(day, gap, cal), p * minutes]);
    for (const [d, m] of parts) this.load.set(d, (this.load.get(d) ?? 0) + m);
    this.byCase.set(id, parts);
  }

  drop(id: string): void {
    const old = this.byCase.get(id);
    if (!old) return;
    for (const [d, m] of old) this.load.set(d, (this.load.get(d) ?? 0) - m);
    this.byCase.delete(id);
  }

  get(day: string): number {
    return Math.max(0, this.load.get(day) ?? 0);
  }

  /** forget disposed cases (their returns will not come) */
  prune(cases: readonly CaseView[]): void {
    for (const c of cases) if (c.disposed && this.byCase.has(c.id)) this.drop(c.id);
  }
}

export interface Placeable {
  view: CaseView;
  minutes: number;
  p: number;
  /** value per expected minute, the order within a class */
  density: number;
  disposes: boolean;
}

/**
 * The horizon redesign's joint first-date plan: each day is filled with first hearings only up to the room
 * its projected returns leave; 4+ year cases claim `oldShare` of each day first. Recursion of returns is
 * kept to six generations with weights below 5% dropped.
 */
export function planFirstDates(
  ctx: PlanContext,
  ready: Placeable[],
  dayCap: number,
  oldShare: number,
  ledger: LoadLedger,
  relist: number,
  allowedOn?: (c: CaseView, day: string) => boolean,
): Map<string, string> {
  const out = new Map<string, string>();
  const byDensity = (a: Placeable, b: Placeable) => b.density - a.density || (a.view.id < b.view.id ? -1 : 1);
  const isO = (k: Placeable) => isOld(k.view, ctx.date);
  let oldQ = ready.filter(isO).sort(byDensity);
  let rest = ready.filter((k) => !isO(k)).sort(byDensity);
  const days = horizonDays(ctx.date, ctx.calendar);
  const proj = new Map<string, number>();
  const addProj = (d: string, m: number) => proj.set(d, (proj.get(d) ?? 0) + m);
  const pending: { day: string; m: number; p: number; gap: number; disposes: boolean; weight: number; depth: number }[] = [];
  const spawn = (day: string, m: number, p: number, gap: number, disposes: boolean, weight: number, depth: number) => {
    if (weight < 0.05 || depth > 6) return;
    const failDay = afterGap(day, Math.min(gap, relist), ctx.calendar);
    addProj(failDay, weight * (1 - p) * m);
    pending.push({ day: failDay, m, p, gap, disposes, weight: weight * (1 - p), depth: depth + 1 });
    if (!disposes) {
      const okDay = afterGap(day, gap, ctx.calendar);
      addProj(okDay, weight * p * m);
      pending.push({ day: okDay, m, p, gap, disposes, weight: weight * p, depth: depth + 1 });
    }
  };
  let lastDay = days[0] ?? ctx.date;
  const place = (k: Placeable, day: string) => {
    out.set(k.view.id, day);
    ledger.add(day, k.minutes, k.view.advocateId);
    spawn(day, k.minutes, k.p, ctx.ref[k.view.nextPurpose].gapDays, k.disposes, 1, 0);
  };
  const fits = (k: Placeable, day: string) => !allowedOn || allowedOn(k.view, day);
  for (const day of days) {
    if (out.size >= ready.length) break;
    lastDay = day;
    for (let i = 0; i < pending.length; ) {
      const r = pending[i]!;
      if (r.day === day) {
        pending[i] = pending[pending.length - 1]!;
        pending.pop();
        spawn(day, r.m, r.p, r.gap, r.disposes, r.weight, r.depth);
      } else i++;
    }
    const budget = Math.max(0, dayCap - ledger.load(day) - (proj.get(day) ?? 0));
    let used = 0;
    const oldBudget = oldShare * dayCap;
    const nextOld: Placeable[] = [];
    for (const k of oldQ) {
      if (used + k.minutes <= oldBudget && fits(k, day)) {
        place(k, day);
        used += k.minutes;
      } else nextOld.push(k);
    }
    const pool = [...nextOld, ...rest].sort(byDensity);
    used = Math.min(used, budget);
    const left: Placeable[] = [];
    for (const k of pool) {
      if (used + k.minutes <= budget && fits(k, day)) {
        place(k, day);
        used += k.minutes;
      } else left.push(k);
    }
    oldQ = left.filter(isO);
    rest = left.filter((k) => !isO(k));
  }
  for (const k of ready) if (!out.has(k.view.id)) out.set(k.view.id, nextWorkingDayAfter(lastDay, ctx.calendar));
  return out;
}

/** The first working day on or after `from` that `allowed` accepts (within about a year). */
export function nextAllowed(from: string, cal: CourtCalendar, allowed?: (d: string) => boolean): string {
  let d = nextWorkingDayOnOrAfter(from, cal);
  if (!allowed) return d;
  for (let k = 0; k < 260 && !allowed(d); k++) d = nextWorkingDayAfter(d, cal);
  return d;
}

export { weekday };
