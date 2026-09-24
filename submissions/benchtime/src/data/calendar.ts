// The court calendar and the date arithmetic every module shares. Dates are ISO strings throughout and
// all arithmetic is on UTC day numbers, so the local time zone (IST on the judge's machine, UTC in CI)
// can never shift a hearing by a day.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { CourtCalendar } from "../domain/types";
import { parseCsv } from "./csv";
import { DATA_DIR } from "./reference";

const DAY_MS = 86_400_000;
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** True for a real calendar date written yyyy-mm-dd. */
export function isIsoDate(s: string): boolean {
  const m = ISO_RE.exec(s);
  if (!m) return false;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return new Date(t).toISOString().slice(0, 10) === s; // rejects 2026-02-30, which Date.UTC rolls over
}

/** Days since 1970-01-01 for an ISO date. Throws on anything else so a bad date fails loudly. */
export function dayNumber(iso: string): number {
  const m = ISO_RE.exec(iso);
  if (!m) throw new Error(`Not an ISO date: "${iso}"`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / DAY_MS;
}

export function fromDayNumber(n: number): string {
  return new Date(n * DAY_MS).toISOString().slice(0, 10);
}

export function addDays(iso: string, n: number): string {
  return fromDayNumber(dayNumber(iso) + n);
}

/** b minus a, in calendar days (negative when b is earlier). */
export function daysBetween(a: string, b: string): number {
  return dayNumber(b) - dayNumber(a);
}

/** 0 = Sunday ... 6 = Saturday. 1970-01-01 was a Thursday. */
export function weekday(iso: string): number {
  return (((dayNumber(iso) + 4) % 7) + 7) % 7;
}

/**
 * Whether the court sits on a date. Inside the published calendar this is the calendar (minus the judge's
 * leave). Beyond it (a next date promised past 31 December) no holiday list exists, so Monday to Friday
 * counts, still minus any known holiday or leave: a promise must land somewhere, and a weekday is the
 * registry's own default.
 */
export function isWorkingDay(iso: string, cal: CourtCalendar): boolean {
  if (iso >= cal.first && iso <= cal.last) return cal.workingDays.has(iso);
  const w = weekday(iso);
  return w !== 0 && w !== 6 && !cal.holidays.has(iso) && !cal.judgeLeave.has(iso);
}

// a year of consecutive closures would mean a broken calendar, not a long vacation
const MAX_SCAN = 366;

export function nextWorkingDayOnOrAfter(iso: string, cal: CourtCalendar): string {
  let d = dayNumber(iso);
  for (let i = 0; i < MAX_SCAN; i++, d++) {
    const s = fromDayNumber(d);
    if (isWorkingDay(s, cal)) return s;
  }
  throw new Error(`No working day within a year of ${iso}`);
}

export function nextWorkingDayAfter(iso: string, cal: CourtCalendar): string {
  return nextWorkingDayOnOrAfter(addDays(iso, 1), cal);
}

/** Working days from start to end, both inclusive (empty when end is before start). */
export function workingDays(start: string, end: string, cal: CourtCalendar): string[] {
  const out: string[] = [];
  const last = dayNumber(end);
  for (let d = dayNumber(start); d <= last; d++) {
    const s = fromDayNumber(d);
    if (isWorkingDay(s, cal)) out.push(s);
  }
  return out;
}

/**
 * Working days after a up to and including b: the next working day after a is 1 away. Signed, so a date
 * before a gives a negative count (how many sittings early), and a == b gives 0.
 */
export function workingDaysBetween(a: string, b: string, cal: CourtCalendar): number {
  if (b === a) return 0;
  if (b > a) return workingDays(addDays(a, 1), b, cal).length;
  return -workingDays(addDays(b, 1), a, cal).length;
}

/** Age in years (365.25-day years) of a case filed on filingDate, as of asOf. */
export function ageYears(filingDate: string, asOf: string): number {
  return daysBetween(filingDate, asOf) / 365.25;
}

/** "HH:MM" to minutes after midnight. */
export function toMinutes(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m || Number(m[2]) > 59) throw new Error(`Not a time of day: "${hhmm}"`);
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Minutes after midnight to zero-padded "HH:MM" (fractions are floored to the minute). */
export function fromMinutes(n: number): string {
  const t = Math.floor(n);
  if (!Number.isFinite(t) || t < 0) throw new Error(`Not a minute count: ${n}`);
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

/** Build the calendar from court_calendar.csv text. Exported so tests can feed a small calendar. */
export function parseCalendar(text: string, judgeLeave: string[] = []): CourtCalendar {
  const rows = parseCsv(text);
  if (rows.length === 0) throw new Error("court_calendar.csv: no rows");
  const yes = (v: string | undefined, what: string): boolean => {
    const s = (v ?? "").trim().toLowerCase();
    if (s === "yes") return true;
    if (s === "no") return false;
    throw new Error(`court_calendar.csv ${what}: expected Yes or No, found "${v ?? ""}"`);
  };
  const leave = new Set<string>();
  for (const d of judgeLeave) {
    if (!isIsoDate(d)) throw new Error(`Judge leave date is not an ISO date: "${d}"`);
    leave.add(d);
  }
  const working = new Set<string>();
  const holidays = new Map<string, string>();
  const seen = new Set<string>();
  let first = "";
  let last = "";
  for (const r of rows) {
    const date = (r["date"] ?? "").trim();
    if (!isIsoDate(date)) throw new Error(`court_calendar.csv: bad date "${date}"`);
    if (seen.has(date)) throw new Error(`court_calendar.csv: ${date} appears twice`);
    seen.add(date);
    const dow = (r["day_of_week"] ?? "").trim();
    if (dow && dow !== WEEKDAYS[weekday(date)]) throw new Error(`court_calendar.csv: ${date} is a ${WEEKDAYS[weekday(date)]}, not ${dow}`);
    const off = yes(r["is_weekly_off"], `${date} is_weekly_off`);
    const hol = yes(r["is_holiday"], `${date} is_holiday`);
    const work = yes(r["is_working_day"], `${date} is_working_day`);
    // the file states working days outright; check it agrees with its own off and holiday columns
    if (work === (off || hol)) throw new Error(`court_calendar.csv: ${date} working-day flag contradicts its off and holiday flags`);
    if (hol) holidays.set(date, (r["holiday_name"] ?? "").trim() || "Holiday");
    if (work && !leave.has(date)) working.add(date);
    if (!first || date < first) first = date;
    if (!last || date > last) last = date;
  }
  // the calendar must be a contiguous run of days, or "not in workingDays" would be ambiguous
  if (daysBetween(first, last) + 1 !== seen.size) throw new Error(`court_calendar.csv: dates from ${first} to ${last} have gaps`);
  return { workingDays: working, holidays, judgeLeave: leave, first, last };
}

/** Load court_calendar.csv; the judge's leave days are removed from the working days. */
export function loadCalendar(dataDir: string = DATA_DIR, judgeLeave: string[] = []): CourtCalendar {
  return parseCalendar(readFileSync(join(dataDir, "court_calendar.csv"), "utf8"), judgeLeave);
}
