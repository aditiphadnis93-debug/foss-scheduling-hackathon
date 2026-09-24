/**
 * Case file assembly: one case's journey from the town quarrel to the court's last word.
 * Joins the world export (origin, parties, same-simulation causelist), the run export
 * (listings with reasons, planner `why`, optional `audit` / `stakeholder` / `checklist`)
 * and the agents export (each party's own decisions). Every field is optional.
 */
import type { OutcomeKind } from "./world";

export const caseHref = (id: string) => `/case/${encodeURIComponent(id)}`;

export const STAGES = [
  "ADMISSION", "DELAY_CONDONATION_HEARING", "COGNIZANCE", "APPEARANCE", "WARRANT", "PLEA",
  "EXAMINATION_UNDER_S351_BNSS", "EVIDENCE_COMPLAINANT", "EVIDENCE_ACCUSED", "ARGUMENTS", "JUDGEMENT",
];

/** who a non-substantive outcome is on, when the export does not say */
export function inferStakeholder(kind: OutcomeKind | null, reason: string | null): string | null {
  if (!kind || kind === "substantive") return null;
  if (kind === "not_reached") return "Court (the day ran out)";
  const r = (reason ?? "").toLowerCase();
  if (r.includes("respondent")) return "Accused";
  if (r.includes("petitioner")) return "Complainant";
  if (r.includes("both parties")) return "Both parties";
  if (r.includes("sought time")) return "Party seeking time";
  if (r.includes("summons") || r.includes("process") || r.includes("warrant")) return "Process serving (police / court staff)";
  if (r.includes("evidence") || r.includes("filing")) return "Advocate (papers not ready)";
  if (r.includes("external")) return "Outside agency";
  if (r.includes("court") || r.includes("holiday")) return "Court";
  return kind === "not_ready" ? "Prerequisite owner" : "Unclear";
}

export type RawListing = {
  case_id: string; slot?: string; start?: string; end?: string; purpose?: string; advocate?: string; why?: string[];
  outcome?: { kind?: string; reason?: string | null; next_date?: string | null; next_purpose?: string | null; minutes?: number; stakeholder?: string | null; rule?: string | null } | null;
  stakeholder?: string | null; audit?: unknown;
};
export type RawRun = {
  meta?: Record<string, unknown>;
  days?: { date: string; listings?: RawListing[]; held_back?: { case_id: string; reason: string }[]; audit?: unknown[] }[];
  cases?: Record<string, Record<string, unknown>>;
  audit?: unknown;
};

export type AuditRow = { day: string | null; text: string };

/** collect audit rows mentioning this case from any of the shapes the engine may emit */
export function auditFor(run: RawRun | null, caseId: string): AuditRow[] {
  if (!run) return [];
  const out: AuditRow[] = [];
  const take = (x: unknown, day: string | null) => {
    if (!x || typeof x !== "object") return;
    const o = x as Record<string, unknown>;
    if (o.case_id != null && String(o.case_id) !== caseId) return;
    const text = [o.rule, o.text, o.reason, o.detail, o.message].filter((v) => typeof v === "string").join(" · ");
    if (text) out.push({ day: typeof o.day === "string" ? o.day : typeof o.date === "string" ? o.date : day, text });
  };
  const a = run.audit;
  if (Array.isArray(a)) a.forEach((x) => take(x, null));
  else if (a && typeof a === "object") {
    const byCase = (a as Record<string, unknown>)[caseId];
    if (Array.isArray(byCase)) byCase.forEach((x) => take({ ...(x as object), case_id: caseId }, null));
  }
  for (const d of run.days ?? []) {
    if (Array.isArray(d.audit)) d.audit.forEach((x) => take(x, d.date));
    for (const l of d.listings ?? []) if (l.case_id === caseId && l.audit) (Array.isArray(l.audit) ? l.audit : [l.audit]).forEach((x) => take(typeof x === "string" ? { text: x, case_id: caseId } : { ...(x as object), case_id: caseId }, d.date));
  }
  return out;
}

// ---------------------------------------------------------------- court hours
/** Court sittings for a day: from the export's `sitting_windows` when present,
 * else the court's published hours, 10:00-13:30 and 14:00-16:30. Times are shown as recorded. */
export const DEFAULT_SITTINGS: [string, string][] = [["10:00", "13:30"], ["14:00", "16:30"]];
export const clockMin = (t: string) => { const [h, m] = String(t).split(":").map(Number); return Number.isFinite(h) ? h * 60 + (m || 0) : NaN; };
export const clockText = (m: number) => { const r = Math.round(m); return `${String(Math.floor(r / 60)).padStart(2, "0")}:${String(r % 60).padStart(2, "0")}`; };
/** "HH:MM-HH:MM" -> [start, end] in minutes of the day */
export function parseWindow(w: string): [number, number] {
  const [a, b] = (w || "").split("-");
  const s = clockMin(a ?? ""), e = clockMin(b ?? a ?? "");
  return [Number.isFinite(s) ? s : 600, Number.isFinite(e) ? e : (Number.isFinite(s) ? s + 60 : 660)];
}
export function sittingsOf(raw: unknown): [number, number][] {
  const list = Array.isArray(raw) && raw.length ? (raw as unknown[]) : DEFAULT_SITTINGS;
  const out = list.map((x) => {
    if (Array.isArray(x)) return [clockMin(String(x[0])), clockMin(String(x[1]))] as [number, number];
    const o = x as { start?: string; end?: string };
    return [clockMin(String(o?.start)), clockMin(String(o?.end))] as [number, number];
  }).filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && b > a);
  return out.length ? out : DEFAULT_SITTINGS.map(([a, b]) => [clockMin(a), clockMin(b)] as [number, number]);
}

// ---------------------------------------------------------------- one world
/** the court run: the combined run (same days as the town and the agents) when present */
export async function fetchRun<T = RawRun>(): Promise<T | null> {
  for (const f of ["run_100_combined.json", "run_100_optimal.json"]) {
    try { const r = await fetch(`/data/${f}`); if (r.ok) return (await r.json()) as T; } catch { /* next */ }
  }
  return null;
}

export type TownEventDay = { label: string; extraAbsent: number };
/** days a town event (e.g. a transport strike) kept people from court, from the run's own meta */
export function townEventDays(meta: unknown): Map<string, TownEventDay> {
  const out = new Map<string, TownEventDay>();
  const c = (meta as { combined?: { events?: { start?: string; days?: number; label?: string; kind?: string }[]; town_kept_away?: Record<string, { extra_absent?: number }> } } | null)?.combined;
  if (!c) return out;
  for (const e of c.events ?? []) {
    if (!e.start) continue;
    const d0 = new Date(`${e.start}T00:00:00Z`);
    for (let k = 0; k < Math.max(1, Number(e.days) || 1); k++) {
      const d = new Date(d0.getTime() + k * 86400000).toISOString().slice(0, 10);
      out.set(d, { label: e.label || String(e.kind ?? "town event").replace(/_/g, " "), extraAbsent: Number(c.town_kept_away?.[d]?.extra_absent ?? 0) || 0 });
    }
  }
  return out;
}
export const isAiDecision = (source: string | null | undefined) => !!source && !["rules", "statistical", "mock", "agents", ""].includes(source);
