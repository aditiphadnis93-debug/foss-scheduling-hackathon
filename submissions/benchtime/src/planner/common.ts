// Pieces every policy shares: who is due, the naive PUCAR-prior estimate the baselines use, the bench
// clock for call times, day plans, and filling the first days of the horizon in a priority order.

import { addDays, ageYears, fromMinutes, nextWorkingDayAfter, nextWorkingDayOnOrAfter, toMinutes, workingDays } from "../data/calendar";
import type { CaseView, CourtCalendar, DayPlan, HearingType, JudgeConfig, Listing, PlanContext, RefTables } from "../domain/types";
import { CALL_MINUTES } from "./predict";

/** due today: not disposed and promised on or before today */
export const isDue = (c: CaseView, date: string): boolean => !c.disposed && c.nextDate !== null && c.nextDate <= date;

export const dueCases = (ctx: PlanContext): CaseView[] => ctx.cases.filter((c) => isDue(c, ctx.date));

/** the baselines' estimate: PUCAR's prior for the type, nothing case-specific */
export function naive(c: CaseView, ref: RefTables): { p: number; minutes: number } {
  const r = ref[c.nextPurpose];
  return { p: r.pSubstantive, minutes: r.pSubstantive * r.durationMin + (1 - r.pSubstantive) * CALL_MINUTES };
}

export const isOld = (c: CaseView, date: string): boolean => ageYears(c.filingDate, date) >= 4;

// The bench day: 10:00 to 13:30 and 14:00 to 17:30, 420 minutes, matching court_calendar.csv's capacity.
const DAY_START = toMinutes("10:00");
const LUNCH_START = toMinutes("13:30");
const LUNCH_MINUTES = 30;

/** clock time after `offset` bench minutes */
export function benchClock(offset: number): string {
  let t = DAY_START + Math.max(0, Math.round(offset));
  if (t >= LUNCH_START) t += LUNCH_MINUTES;
  return fromMinutes(t);
}

/** a half-hour window around a call time, e.g. 10:30-11:00 */
export function windowOf(callTime: string): string {
  const t = toMinutes(callTime);
  const start = Math.floor(t / 30) * 30;
  return `${fromMinutes(start)}-${fromMinutes(start + 30)}`;
}

export interface Pick {
  view: CaseView;
  p: number;
  minutes: number;
  why: string[];
  standby?: boolean;
  callTime?: string | null;
  window?: string | null;
}

/** Listings in the given order (0-based), with the policy's times when it gives them. */
export function toListings(picks: Pick[]): Listing[] {
  return picks.map((k, i) => ({
    caseId: k.view.id,
    type: k.view.nextPurpose as HearingType,
    order: i,
    callTime: k.callTime ?? null,
    window: k.window ?? null,
    standby: !!k.standby,
    expectedMinutes: round2(k.minutes),
    pSubstantive: round2(k.p),
    why: k.why,
  }));
}

export const round2 = (x: number): number => Math.round(x * 100) / 100;

/** P(total minutes > capacity), normal approximation, durations lognormal with CV 0.5 (assumption) */
export function overrunRisk(picks: { p: number; minutes: number; duration: number }[], capacity: number): number {
  let mean = 0;
  let variance = 0;
  for (const k of picks) {
    const second = k.p * k.duration * k.duration * 1.25 + (1 - k.p) * CALL_MINUTES * CALL_MINUTES;
    mean += k.minutes;
    variance += Math.max(0, second - k.minutes * k.minutes);
  }
  if (variance <= 0) return mean > capacity ? 1 : 0;
  const z = (capacity - mean) / Math.sqrt(variance);
  return round2(1 - normalCdf(z));
}

function normalCdf(z: number): number {
  // Abramowitz and Stegun 7.1.26, ample for a console risk figure
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2);
  return z >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

export function makePlan(ctx: PlanContext, listed: Pick[], desk: DayPlan["desk"], deferred: DayPlan["deferred"]): DayPlan {
  const main = listed.filter((k) => !k.standby);
  return {
    date: ctx.date,
    listings: toListings(listed),
    desk,
    deferred,
    expected: {
      minutes: round2(main.reduce((s, k) => s + k.minutes, 0)),
      substantive: round2(main.reduce((s, k) => s + k.p, 0)),
      overrunRisk: overrunRisk(
        main.map((k) => ({ p: k.p, minutes: k.minutes, duration: ctx.ref[k.view.nextPurpose].durationMin })),
        ctx.capacityMinutes,
      ),
    },
  };
}

/** Take picks in order until expected minutes reach the cap (the first always goes in); the rest are left. */
export function takeToCapacity<T extends { minutes: number }>(ranked: T[], cap: number): { taken: T[]; left: T[] } {
  const taken: T[] = [];
  const left: T[] = [];
  let used = 0;
  for (const k of ranked) {
    if (taken.length === 0 || used + k.minutes <= cap + 1e-9) {
      taken.push(k);
      used += k.minutes;
    } else left.push(k);
  }
  return { taken, left };
}

/** working days from `start` far enough ahead to place any roster */
export function horizonDays(start: string, cal: CourtCalendar, days = 500): string[] {
  return workingDays(nextWorkingDayOnOrAfter(start, cal), addDays(start, days), cal);
}

/** A stateless 32-bit FNV-1a hash, for deterministic tie-breaks and the status quo's spread. */
export function fnv(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * First dates in a priority order: each working day from the start is filled to `cap` expected minutes,
 * the first `floorShare` of each day offered to 4+ year cases (oldest first) when the policy keeps a floor.
 */
export function fillDays(
  ctx: PlanContext,
  ranked: { view: CaseView; minutes: number }[],
  cap: number,
  opts: { floorShare?: number; allowedOn?: (c: CaseView, day: string) => boolean } = {},
): Map<string, string> {
  const out = new Map<string, string>();
  const days = horizonDays(ctx.date, ctx.calendar);
  const oldQ = opts.floorShare ? ranked.filter((k) => isOld(k.view, ctx.date)).sort((a, b) => (a.view.filingDate < b.view.filingDate ? -1 : a.view.filingDate > b.view.filingDate ? 1 : 0)) : [];
  let rest = ranked;
  let lastDay = days[0] ?? nextWorkingDayOnOrAfter(ctx.date, ctx.calendar);
  for (const day of days) {
    if (out.size >= ranked.length) break;
    lastDay = day;
    let used = 0;
    const place = (k: { view: CaseView; minutes: number }) => {
      out.set(k.view.id, day);
      used += k.minutes;
    };
    if (opts.floorShare) {
      for (const k of oldQ) {
        if (used >= opts.floorShare * cap) break;
        if (out.has(k.view.id) || (opts.allowedOn && !opts.allowedOn(k.view, day))) continue;
        if (used + k.minutes > cap && used > 0) continue;
        place(k);
      }
    }
    const next: typeof ranked = [];
    for (const k of rest) {
      if (out.has(k.view.id)) continue;
      if ((opts.allowedOn && !opts.allowedOn(k.view, day)) || (used + k.minutes > cap && used > 0)) next.push(k);
      else place(k);
    }
    rest = next;
  }
  // anything still unplaced (an absurdly small capacity) goes on the day after the last one used
  for (const k of ranked) if (!out.has(k.view.id)) out.set(k.view.id, nextWorkingDayAfter(lastDay, ctx.calendar));
  return out;
}

export const byFiling = (a: CaseView, b: CaseView): number =>
  a.filingDate < b.filingDate ? -1 : a.filingDate > b.filingDate ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

export const liveCases = (ctx: PlanContext): CaseView[] => ctx.cases.filter((c) => !c.disposed);

export type { JudgeConfig };
