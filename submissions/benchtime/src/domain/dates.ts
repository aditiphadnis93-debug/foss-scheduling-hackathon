// Dates as courts and court registries write them. One module for both jobs that need it:
// reading a date cell in a roster export (adapters/pucar.ts) and finding dates inside the text of an
// order (orders.ts). Everything is calendar arithmetic on ISO strings in UTC; nothing here touches the
// local time zone, which is what shifted "12 Nov 2019" to 11 Nov under `new Date(s)` in IST.

export type DayMonthOrder = "dmy" | "mdy";

export const MONTHS: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

const MONTH_RE = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";

export function isValidDate(y: number, m: number, d: number): boolean {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return false;
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1) return false;
  const days = [31, (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]!;
  return d <= days;
}

export function isoOf(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Two-digit years: 00..49 are 20xx, 50..99 are 19xx (the oldest pending High Court matters date from the 1980s). */
export function expandYear(y: number): number {
  if (y >= 100) return y;
  return y < 50 ? 2000 + y : 1900 + y;
}

function isoOrNull(y: number, m: number, d: number): string | null {
  return isValidDate(y, m, d) ? isoOf(y, m, d) : null;
}

/** Days since 1970-01-01. A fractional part is the time of day, so it is dropped, never rounded up. */
function isoFromEpochDays(days: number): string {
  return new Date(Math.floor(days) * 86400000).toISOString().slice(0, 10);
}

/**
 * Indian courts sit on IST (UTC+05:30, no daylight saving). An epoch value or an ISO timestamp with a zone
 * is a moment, not a date; its calendar day is the day on the court's clock. DRISTI stores filing_date as
 * the epoch ms of a moment, and a date picked in an IST browser is 18:30 UTC the day before, so reading it
 * on the UTC clock loses a day. Moments stored at UTC midnight still land on the same day (05:30 IST).
 */
export const COURT_UTC_OFFSET_MINUTES = 330;

function courtDayOfMoment(ms: number): string {
  return new Date(ms + COURT_UTC_OFFSET_MINUTES * 60000).toISOString().slice(0, 10);
}

/** "12/11/2019" style: the three numbers, before any day/month decision. Null for anything else. */
export function numericParts(s: string): { a: number; b: number; y: number } | null {
  const m = s.trim().match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4}|\d{2})$/);
  if (!m) return null;
  return { a: Number(m[1]), b: Number(m[2]), y: expandYear(Number(m[3])) };
}

export interface ParseDateOptions {
  /** order of the two small numbers in "12/11/2019"; Indian registries write day first */
  order?: DayMonthOrder;
  /** accept spreadsheet serial numbers and epoch seconds / milliseconds (table cells, never order text) */
  allowNumeric?: boolean;
}

/**
 * Parse a date written on its own, as in a table cell. Returns ISO yyyy-mm-dd, or null when the
 * value is not a real calendar date. Accepts ISO (with or without a time part), yyyy/mm/dd,
 * dd.mm.yyyy / dd/mm/yyyy / dd-mm-yyyy and two-digit years, "12 Nov 2019", "12-Nov-2019",
 * "12th November, 2019", "12th day of November, 2019", "November 12, 2019", and with `allowNumeric`
 * spreadsheet serials (days since 1899-12-30) and epoch seconds or milliseconds (DRISTI stores epoch ms).
 */
export function parseDate(raw: string | number, opts: ParseDateOptions = {}): string | null {
  const order = opts.order ?? "dmy";
  if (typeof raw === "number") return opts.allowNumeric ? parseNumericDate(raw) : null;
  const s = raw.trim().replace(/\s+/g, " ");
  if (!s) return null;

  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ][\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?$/i);
  if (m) {
    const written = isoOrNull(Number(m[1]), Number(m[2]), Number(m[3]));
    // with a zone it is a moment (JSON.stringify of a Date gives "2019-11-11T18:30:00.000Z" for 12 Nov IST)
    const t = written ? s.match(/[T ](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|([+-])(\d{2}):?(\d{2}))$/i) : null;
    if (!written || !t) return written;
    const offsetMin = t[4]!.toUpperCase() === "Z" ? 0 : (t[5] === "-" ? -1 : 1) * (Number(t[6]) * 60 + Number(t[7]));
    const utcMs = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(t[1]), Number(t[2]), Number(t[3] ?? 0)) - offsetMin * 60000;
    return courtDayOfMoment(utcMs);
  }
  m = s.match(/^(\d{4})[./](\d{1,2})[./](\d{1,2})$/);
  if (m) return isoOrNull(Number(m[1]), Number(m[2]), Number(m[3]));

  const n = numericParts(s);
  if (n) return order === "dmy" ? isoOrNull(n.y, n.b, n.a) : isoOrNull(n.y, n.a, n.b);

  const words = parseWordDate(s);
  if (words !== undefined) return words;

  if (/^\d+(\.\d+)?$/.test(s) && opts.allowNumeric) return parseNumericDate(Number(s));
  return null;
}

function parseNumericDate(v: number): string | null {
  if (!Number.isFinite(v) || v <= 0) return null;
  // spreadsheet serial: 1950..2150
  if (v >= 18264 && v <= 91311) return isoFromEpochDays(v - 25569);
  // epoch seconds: 1970..2100 (a moment: read on the court's clock)
  if (v >= 1e8 && v < 4.2e9) return courtDayOfMoment(Math.round(v) * 1000);
  // epoch milliseconds
  if (v >= 1e11 && v < 4.2e12) return courtDayOfMoment(Math.round(v));
  return null;
}

/** undefined: not a word date at all; null: looked like one but is not a real date */
function parseWordDate(s: string): string | null | undefined {
  const dmy = new RegExp(`^(\\d{1,2})(?:st|nd|rd|th)?(?:\\s+day)?(?:\\s+of)?[\\s-]+${MONTH_RE}\\.?,?[\\s-]+(\\d{4}|\\d{2})$`, "i");
  let m = s.match(dmy);
  if (m) return isoOrNull(expandYear(Number(m[3])), MONTHS[m[2]!.toLowerCase()]!, Number(m[1]));
  const mdy = new RegExp(`^${MONTH_RE}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})$`, "i");
  m = s.match(mdy);
  if (m) return isoOrNull(Number(m[3]), MONTHS[m[1]!.toLowerCase()]!, Number(m[2]));
  return undefined;
}

export interface FoundDate {
  iso: string;
  index: number;
  length: number;
  raw: string;
}

const TEXT_DATE_RE = new RegExp(
  [
    // 12.11.2026, 12/11/2026, 12-11-2026, 12.11.26 (orders are always day first)
    "\\b(\\d{1,2})[./-](\\d{1,2})[./-](\\d{4}|\\d{2})\\b",
    // 12th November, 2026 / 12 Nov 2026 / 12th day of November, 2026 / 12-Nov-2026
    `\\b(\\d{1,2})(?:st|nd|rd|th)?(?:\\s+day)?(?:\\s+of)?[\\s-]+${MONTH_RE}\\.?,?[\\s-]+(\\d{4})\\b`,
    // November 12, 2026
    `\\b${MONTH_RE}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`,
    // 2026-11-12
    "\\b(\\d{4})-(\\d{2})-(\\d{2})\\b",
  ].join("|"),
  "gi",
);

/** Every real calendar date written inside running text, in order of appearance. */
export function findDates(text: string): FoundDate[] {
  const out: FoundDate[] = [];
  for (const m of text.matchAll(TEXT_DATE_RE)) {
    let iso: string | null = null;
    if (m[1] !== undefined) iso = isoOrNull(expandYear(Number(m[3])), Number(m[2]), Number(m[1]));
    else if (m[4] !== undefined) iso = isoOrNull(Number(m[6]), MONTHS[m[5]!.toLowerCase()]!, Number(m[4]));
    else if (m[7] !== undefined) iso = isoOrNull(Number(m[9]), MONTHS[m[7]!.toLowerCase()]!, Number(m[8]));
    else if (m[10] !== undefined) iso = isoOrNull(Number(m[10]), Number(m[11]), Number(m[12]));
    if (iso) out.push({ iso, index: m.index!, length: m[0].length, raw: m[0] });
  }
  return out;
}

/** dd.mm.yyyy, the form Indian orders and cause lists print. */
export function formatIndian(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}
