import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { db, plannerStateTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export type Rules = { name: string; preset: "balanced" | "block" | "advocate" | "new"; fullness: "light" | "balanced" | "packed"; oldCaseShare: number; groupAdvocates: boolean; order: "complex-first" | "short-first" };
export type Settings = { leaveDays: string[]; morningStart: string; morningEnd: string; afternoonStart: string; afternoonEnd: string };
export type Move = { caseId: string; date: string; order: number; note?: string };
export type Request = { period: "day" | "week" | "month"; start_date: string; rules: Rules };
export type Reason = { code: string; detail: string };
export type Case = { id: string; filingNumber: string; filingDate: string; advocateId: string; partyId: string; stage: string; purpose: string; lastHearing: string; totalHearings: number; ageYears: number; flags: string[]; waitingOn: string; history: string[]; reasons: Reason[] };
export type Slot = { caseId: string; date: string; start: string; end: string; window: string; block: string; likelihood: "High" | "Medium" | "Low"; duration: number; reasons: Reason[]; advocateId: string; purpose: string };
export type Day = { date: string; cases: Slot[]; held: { caseId: string; reason: Reason; readyDate: string }[]; fullness: number; overflow: string[] };
export type Row = Record<string, string>;

const dataDir = path.resolve(process.cwd(), "data");
const file = (prefix: string) => {
  const name = fs.readdirSync(dataDir).find(f => f.startsWith(prefix) && f.endsWith(".csv"));
  if (!name) throw new Error(`Missing court data: ${prefix}`);
  return fs.readFileSync(path.join(dataDir, name), "utf8");
};

export function parseCsv(csv: string): Row[] {
  const cells: string[][] = [];
  let row: string[] = [], value = "", quoted = false;
  for (let i = 0; i < csv.length; i++) {
    const c = csv[i];
    if (quoted) {
      if (c === '"' && csv[i + 1] === '"') { value += '"'; i++; }
      else if (c === '"') quoted = false;
      else value += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(value); value = ""; }
    else if (c === "\n") { row.push(value.replace(/\r$/, "")); cells.push(row); row = []; value = ""; }
    else value += c;
  }
  if (quoted) throw new Error("A quoted CSV value was not closed.");
  if (value || row.length) { row.push(value.replace(/\r$/, "")); cells.push(row); }
  const [header, ...records] = cells;
  if (!header) throw new Error("The file is empty.");
  const keys = header.map(s => s.trim().replace(/^\uFEFF/, ""));
  return records.filter(r => r.some(v => v.trim())).map((r, i) => {
    if (r.length !== keys.length) throw new Error(`Row ${i + 2} has ${r.length} columns; expected ${keys.length}.`);
    return Object.fromEntries(keys.map((key, j) => [key, r[j]]));
  });
}

const rosterColumns = ["case_number", "filing_number", "filing_date", "advocate_id", "party_id", "current_stage", "last_hearing_summary", "purpose_of_next_hearing", "total_hearings_held"];
const validPurposes = new Set(parseCsv(file("hearing_type_reference")).map(r => r["Hearing Purpose"].trim().toUpperCase().replace(/[ -]/g, "_")));
export function validateRoster(csv: string) {
  const rows = parseCsv(csv);
  const header = csv.slice(0, csv.indexOf("\n") >= 0 ? csv.indexOf("\n") : undefined);
  const missing = rosterColumns.filter(k => !header.split(",").map(s => s.trim().replace(/^\uFEFF/, "")).includes(k));
  if (missing.length) throw new Error(`Missing columns: ${missing.join(", ")}. Use the supplied roster format.`);
  if (!rows.length) throw new Error("The roster has no cases.");
  const seen = new Set<string>();
  rows.forEach((row, i) => {
    if (!row.case_number?.trim()) throw new Error(`Row ${i + 2} needs a case number.`);
    if (seen.has(row.case_number)) throw new Error(`Case ${row.case_number} appears more than once.`);
    seen.add(row.case_number);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.filing_date) || Number.isNaN(Date.parse(row.filing_date)) ||
        new Date(`${row.filing_date}T12:00:00Z`).toISOString().slice(0, 10) !== row.filing_date) throw new Error(`Row ${i + 2} has an invalid filing date.`);
    if (!Number.isFinite(Number(row.total_hearings_held)) || Number(row.total_hearings_held) < 0) throw new Error(`Row ${i + 2} has an invalid hearing count.`);
    const purpose = row.purpose_of_next_hearing?.trim().toUpperCase().replace(/[ -]/g, "_") || "";
    if (!validPurposes.has(purpose)) throw new Error(`Row ${i + 2} has an unknown hearing purpose: ${row.purpose_of_next_hearing || "(blank)"}.`);
    for (const [key, value] of Object.entries(row)) {
      if (key.startsWith("hearings_") && value && (!Number.isFinite(Number(value)) || Number(value) < 0))
        throw new Error(`Row ${i + 2} has an invalid count in ${key}.`);
    }
  });
  return rows;
}
const seedRoster = validateRoster(file("roster_sample_100"));
const calendarRows = parseCsv(file("court_calendar"));
export const defaults: Rules = { name: "Recommended (balanced)", preset: "balanced", fullness: "balanced", oldCaseShare: 25, groupAdvocates: true, order: "complex-first" };
const defaultSettings: Settings = { leaveDays: [], morningStart: "10:00", morningEnd: "13:30", afternoonStart: "14:00", afternoonEnd: "17:30" };

export async function getState<T>(key: string, fallback: T): Promise<T> {
  const [record] = await db.select().from(plannerStateTable).where(eq(plannerStateTable.key, key));
  return record ? record.value as T : fallback;
}
export async function setState<T>(key: string, value: T): Promise<T> {
  await db.insert(plannerStateTable).values({ key, value }).onConflictDoUpdate({ target: plannerStateTable.key, set: { value, updatedAt: new Date() } });
  return value;
}
export const getRoster = () => getState<Row[]>("roster", seedRoster);
export const getRules = () => getState<Rules>("rules", defaults);
export const getSettings = () => getState<Settings>("settings", defaultSettings);

const dayStr = (d: Date) => d.toISOString().slice(0, 10);
export const addDays = (date: string, n: number) => { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return dayStr(d); };
const weekday = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();
export function calendar(settings: Settings) {
  return calendarRows.map(r => ({ date: r.date, working: r.is_working_day === "Yes" && !settings.leaveDays.includes(r.date), holiday: settings.leaveDays.includes(r.date) ? "Personal leave" : r.holiday_name, weeklyOff: r.is_weekly_off === "Yes" }));
}
export function isWorking(date: string, settings: Settings) {
  if (settings.leaveDays.includes(date)) return false;
  const found = calendarRows.find(r => r.date === date);
  return found ? found.is_working_day === "Yes" : ![0, 6].includes(weekday(date));
}
export function nextWorking(date: string, settings: Settings) {
  let d = date;
  for (let i = 0; i < 400; i++) { if (isWorking(d, settings)) return d; d = addDays(d, 1); }
  throw new Error("No working day available.");
}
export const today = () => dayStr(new Date());
function ageYears(date: string, asOf: string) { return Math.max(0, (Date.parse(asOf) - Date.parse(date)) / 86400000 / 365.25); }
export function cases(rows: Row[], asOf = today()): Case[] {
  return rows.map(r => {
    const age = ageYears(r.filing_date, asOf);
    const summary = r.last_hearing_summary || "";
    const processPending = /warrant|summons|process/i.test(summary) && /await|pending|not served|return|issue/i.test(summary);
    const flags = [...(age >= 4 ? ["OLD_CASE"] : []), ...(processPending ? ["WAITING_WARRANT"] : [])];
    const reasons: Reason[] = age >= 4 ? [{ code: "OLD_CASE", detail: `${Math.floor(age)} years since filing` }] : [];
    if (/JUDG/i.test(r.purpose_of_next_hearing)) reasons.push({ code: "NEAR_DISPOSAL", detail: "Judgment is the next listed purpose" });
    if (processPending) reasons.push({ code: "WAITING_WARRANT", detail: "The last hearing mentions process; confirm service before listing" });
    return { id: r.case_number, filingNumber: r.filing_number, filingDate: r.filing_date, advocateId: r.advocate_id, partyId: r.party_id, stage: r.current_stage, purpose: r.purpose_of_next_hearing, lastHearing: summary, totalHearings: Number(r.total_hearings_held), ageYears: Math.round(age * 10) / 10, flags, waitingOn: processPending ? "Process status needs confirmation" : "", history: summary ? [summary] : [], reasons };
  });
}
export function summary(items: Case[]) {
  const counts = (f: (c: Case) => string, order?: string[]) => {
    const map = new Map<string, number>();
    for (const c of items) map.set(f(c), (map.get(f(c)) || 0) + 1);
    return [...map].map(([label, count]) => ({ label, count })).sort((a, b) => order ? order.indexOf(a.label) - order.indexOf(b.label) : b.count - a.count);
  };
  return { total: items.length, ready: items.filter(c => !c.waitingOn).length, waiting: items.filter(c => c.waitingOn).length, stages: counts(c => c.stage), ages: counts(c => c.ageYears < 1 ? "Under 1 year" : c.ageYears < 3 ? "1–3 years" : c.ageYears < 4 ? "3–4 years" : "4+ years", ["Under 1 year", "1–3 years", "3–4 years", "4+ years"]), errors: [] as string[] };
}

type Preview = { days: Day[]; recommendedCount: number; explanation: string; generatedAt: string };
type Metrics = { heard: number; forward: number; unheard: number; oldTouched: number; hours: number };
type Projection = { metrics: Metrics; daily: { date: string; old_pending: number }[] };

function engine<T>(action: "preview" | "project", request: Request, rows: Row[], settings: Settings, moves: Move[] = []): Promise<T> {
  return new Promise((resolve, reject) => {
    const worker = spawn("python3", [path.resolve(process.cwd(), "python/bridge.py")], { cwd: process.cwd() });
    const timeout = setTimeout(() => worker.kill("SIGKILL"), 45000);
    let output = "", errors = "";
    worker.stdout.setEncoding("utf8").on("data", chunk => {
      output += chunk;
      if (output.length > 25_000_000) worker.kill("SIGKILL");
    });
    worker.stderr.setEncoding("utf8").on("data", chunk => { errors = (errors + chunk).slice(-4000); });
    worker.on("error", error => { clearTimeout(timeout); reject(new Error(`Python engine could not start: ${error.message}`)); });
    worker.on("close", code => {
      clearTimeout(timeout);
      if (code !== 0) { reject(new Error(`Python engine failed: ${errors || `exit ${code}`}`)); return; }
      try { resolve(JSON.parse(output) as T); } catch { reject(new Error("Python engine returned an invalid result.")); }
    });
    worker.stdin.on("error", () => {});
    worker.stdin.end(JSON.stringify({
      action, request, rows, settings, moves,
      waiting: cases(rows, request.start_date).filter(c => c.waitingOn).map(c => ({ id: c.id, waitingOn: c.waitingOn })),
    }));
  });
}

export const makeSchedule = (request: Request, rows: Row[], settings: Settings, moves: Move[] = []) =>
  engine<Preview>("preview", request, rows, settings, moves);

export async function impact(request: Request, rows: Row[], settings: Settings, moves: Move[]) {
  const baselineRequest = { ...request, rules: defaults };
  const [recommended, choice, baselineProjection, choiceProjection] = await Promise.all([
    makeSchedule(baselineRequest, rows, settings),
    makeSchedule(request, rows, settings, moves),
    engine<Projection>("project", baselineRequest, rows, settings),
    engine<Projection>("project", request, rows, settings, moves),
  ]);
  const original = new Map(recommended.days.flatMap(d => d.cases.map(s => [s.caseId, d.date] as const)));
  const shifted = new Map(choice.days.flatMap(d => d.cases.map(s => [s.caseId, d.date] as const)));
  const affected = [...original].filter(([id, date]) => shifted.get(id) !== date)
    .map(([id, oldDate]) => ({ caseId: id, advocateId: rows.find(c => c.case_number === id)?.advocate_id || "", oldDate, newDate: shifted.get(id) || "Not yet listed" }));
  const oldAt = (daily: Projection["daily"], date: string, fallback: number) =>
    [...daily].reverse().find(d => d.date <= date)?.old_pending ?? fallback;
  const oldStart = cases(rows, request.start_date).filter(c => c.ageYears >= 4).length;
  const outlook = Array.from({ length: 12 }, (_, i) => {
    const date = addDays(request.start_date, (i + 1) * 7 - 1);
    return { week: `Week ${i + 1}`, recommended: oldAt(baselineProjection.daily, date, oldStart), choice: oldAt(choiceProjection.daily, date, oldStart) };
  });
  return { recommended: baselineProjection.metrics, choice: choiceProjection.metrics, outlook, affected, extraTrips: new Set(affected.map(c => c.advocateId)).size };
}