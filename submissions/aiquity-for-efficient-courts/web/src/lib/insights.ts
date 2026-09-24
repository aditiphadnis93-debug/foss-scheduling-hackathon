// Delay attribution, advocate/party profiles and the audit log.
// The engine export adds `attribution`, `profiles` and `audit` blocks to a run; until a run carries them,
// each is derived here from the day records (listings, outcomes, held-back reasons), which are real.
import type { Day, Listing, Run } from "./types";

export const STAKEHOLDERS = [
  "petitioner_side",
  "respondent_side",
  "both_sides",
  "state_agencies",
  "court",
  "judge_emergency",
  "time_ran_out",
] as const;
export type Stakeholder = (typeof STAKEHOLDERS)[number];

export const STAKEHOLDER_LABEL: Record<string, string> = {
  petitioner_side: "Petitioner side",
  respondent_side: "Respondent side",
  both_sides: "Both sides / time sought",
  state_agencies: "State agencies",
  court: "Court side",
  judge_emergency: "Judge emergency",
  time_ran_out: "Day ran out",
};

export const STAKEHOLDER_COLOUR: Record<string, string> = {
  petitioner_side: "var(--age-2)",
  respondent_side: "var(--age-4)",
  both_sides: "var(--c-adjourned)",
  state_agencies: "var(--c-not-ready)",
  court: "var(--c-baseline)",
  judge_emergency: "var(--c-danger)",
  time_ran_out: "var(--c-not-reached)",
};

// Mirrors causelist.attribution (the mapping there is final).
const MAP: Record<string, Stakeholder> = {
  "Petitioner Absence / Non-Compliance": "petitioner_side",
  "Respondent Absence / Non-Compliance": "respondent_side",
  "Both Parties Unready / Absent": "both_sides",
  "Party Sought Time / Adjournment": "both_sides",
  "Evidence / Filing Not Ready": "both_sides",
  "Awaiting Process / Summons / Warrant Return": "state_agencies",
  "External Dependency": "state_agencies",
  "Court Administrative Issue": "court",
  "Court Holiday / No Sitting": "court",
  Unclear: "court",
};

export function stakeholderFor(kind: string, reason: string | null | undefined): Stakeholder | null {
  if (kind === "substantive") return null;
  if (kind === "not_reached") return "time_ran_out";
  if (reason && reason.startsWith("Judge emergency")) return "judge_emergency";
  return MAP[reason ?? ""] ?? "court";
}

export function outcomeStakeholder(l: Listing): Stakeholder | null {
  const o = l.outcome as (Listing["outcome"] & { stakeholder?: string | null }) | null;
  if (!o) return null;
  if (o.stakeholder !== undefined) return (o.stakeholder as Stakeholder) ?? null;
  return stakeholderFor(o.kind, o.reason);
}

// ---------------------------------------------------------------------------------------------
export type Attribution = {
  by_stakeholder: Record<string, { count: number; minutes: number }>;
  by_type: Record<string, Record<string, number>>;
  by_day: ({ date: string } & Record<string, number | string>)[];
  minutes_lost: Record<string, number>;
  derived?: boolean;
};

function nonEmpty(o: unknown): boolean {
  return !!o && typeof o === "object" && Object.keys(o as object).length > 0;
}

export function attributionOf(run: Run): Attribution {
  const a = (run as Run & { attribution?: Attribution }).attribution;
  if (a && nonEmpty(a.by_stakeholder)) return a;
  const by_stakeholder: Attribution["by_stakeholder"] = {};
  const by_type: Attribution["by_type"] = {};
  const minutes_lost: Record<string, number> = {};
  const by_day: Attribution["by_day"] = [];
  for (const d of run.days) {
    const row: Record<string, number | string> = { date: d.date };
    for (const l of d.listings) {
      const s = outcomeStakeholder(l);
      if (!s) continue;
      const m = l.outcome?.minutes ?? 0;
      by_stakeholder[s] = by_stakeholder[s] ?? { count: 0, minutes: 0 };
      by_stakeholder[s].count += 1;
      by_stakeholder[s].minutes += m;
      minutes_lost[s] = (minutes_lost[s] ?? 0) + m;
      by_type[l.purpose] = by_type[l.purpose] ?? {};
      by_type[l.purpose][s] = (by_type[l.purpose][s] ?? 0) + 1;
      row[s] = ((row[s] as number) ?? 0) + 1;
    }
    by_day.push(row as Attribution["by_day"][number]);
  }
  return { by_stakeholder, by_type, by_day, minutes_lost, derived: true };
}

/** Group by_day into ISO-ish weeks (Monday start) for a readable chart. */
export function byWeek(rows: Attribution["by_day"]): ({ week: string } & Record<string, number | string>)[] {
  const out = new Map<string, Record<string, number | string>>();
  for (const r of rows) {
    const [y, m, d] = r.date.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    const dow = (dt.getUTCDay() + 6) % 7;
    dt.setUTCDate(dt.getUTCDate() - dow);
    const key = dt.toISOString().slice(0, 10);
    const acc = out.get(key) ?? { week: key };
    for (const s of STAKEHOLDERS) acc[s] = ((acc[s] as number) ?? 0) + (Number(r[s]) || 0);
    out.set(key, acc);
  }
  return [...out.values()] as ({ week: string } & Record<string, number | string>)[];
}

// ---------------------------------------------------------------------------------------------
export type Posterior = { mean: number; lo90: number; hi90: number; n: number };
export type Profile = {
  id: string;
  hearings: number;
  appearance_rate: number;
  readiness_rate: number;
  seek_ratio: number;
  p_exceed?: number;
  posterior?: Posterior;
  expected_appearance?: number;
  adjournments_by_reason: Record<string, number>;
  trips: number;
  gaming_flag: boolean;
  evidence?: Record<string, unknown> | string | null;
  case_ids: string[];
  delay_minutes: number;
};
export type Profiles = { advocates: Profile[]; parties: Profile[]; derived?: boolean };

const ABSENT = new Set([
  "Petitioner Absence / Non-Compliance",
  "Respondent Absence / Non-Compliance",
  "Both Parties Unready / Absent",
]);
const SEEK = "Party Sought Time / Adjournment";

/** Beta(1 + successes, 1 + failures) mean and a normal-approximation 90% band. */
export function betaBand(successes: number, n: number): Posterior {
  const a = 1 + successes;
  const b = 1 + (n - successes);
  const mean = a / (a + b);
  const sd = Math.sqrt((a * b) / ((a + b) ** 2 * (a + b + 1)));
  return { mean, lo90: Math.max(0, mean - 1.645 * sd), hi90: Math.min(1, mean + 1.645 * sd), n };
}

export function profilesOf(run: Run): Profiles {
  const p = (run as Run & { profiles?: Profiles }).profiles;
  if (p && Array.isArray(p.advocates) && p.advocates.length) {
    return p.parties?.length || !run.cases ? p : { ...p, parties: derive(run, (l) => run.cases?.[l.case_id]?.party ?? null) };
  }
  const parties = run.cases ? derive(run, (l) => run.cases?.[l.case_id]?.party ?? null) : [];
  return { advocates: derive(run, (l) => l.advocate), parties, derived: true };
}

function derive(run: Run, keyOf: (l: Listing) => string | null): Profile[] {
  type Acc = { called: number; appeared: number; ready: number; seek: number; days: Set<string>; cases: Set<string>; reasons: Record<string, number>; minutes: number };
  const acc = new Map<string, Acc>();
  let calledAll = 0;
  let appearedAll = 0;
  for (const d of run.days) {
    for (const l of d.listings) {
      const o = l.outcome;
      const key = keyOf(l);
      if (!o || !key) continue;
      const a = acc.get(key) ?? { called: 0, appeared: 0, ready: 0, seek: 0, days: new Set<string>(), cases: new Set<string>(), reasons: {}, minutes: 0 };
      a.days.add(d.date);
      a.cases.add(l.case_id);
      if (o.kind !== "not_reached" && o.kind !== "not_ready") {
        a.called += 1;
        calledAll += 1;
        const absent = !!o.reason && ABSENT.has(o.reason);
        if (!absent) {
          a.appeared += 1;
          appearedAll += 1;
        }
        if (o.kind === "substantive") a.ready += 1;
        if (o.reason === SEEK) a.seek += 1;
      }
      if (o.kind !== "substantive" && o.reason) {
        a.reasons[o.reason] = (a.reasons[o.reason] ?? 0) + 1;
        a.minutes += o.minutes;
      }
      acc.set(key, a);
    }
  }
  const expected = calledAll ? appearedAll / calledAll : 0;
  return [...acc.entries()]
    .map(([id, a]) => ({
      id,
      hearings: a.called,
      appearance_rate: a.called ? a.appeared / a.called : 0,
      readiness_rate: a.called ? a.ready / a.called : 0,
      seek_ratio: a.called ? a.seek / a.called : 0,
      posterior: betaBand(a.appeared, a.called),
      expected_appearance: expected,
      adjournments_by_reason: a.reasons,
      trips: a.days.size,
      gaming_flag: false,
      evidence: null,
      case_ids: [...a.cases].sort(),
      delay_minutes: a.minutes,
    }))
    .sort((x, y) => y.hearings - x.hearings);
}

// ---------------------------------------------------------------------------------------------
export type AuditRow = {
  day: string;
  case_id: string;
  action: string;
  rule: string;
  why: string;
  before?: unknown;
  after?: unknown;
  stakeholder?: string | null;
};

function ruleForNextDate(l: Listing, run: Run): { rule: string; why: string } {
  const o = l.outcome!;
  const policy = String(run.meta.config_detail?.next_date_policy ?? "procedural");
  if (!o.next_date) return { rule: "disposal", why: "Final stage heard; the case is disposed." };
  if (policy === "flat") return { rule: "flat gap", why: "Today's practice: a flat gap regardless of the next step." };
  if (o.kind === "not_reached") return { rule: "carry over", why: "Not reached today; returns on the next sitting with higher priority." };
  if (o.kind === "not_ready") return { rule: "prerequisite date", why: "Returns when the pending prerequisite is expected to be met." };
  if (o.reason && (ABSENT.has(o.reason) || o.reason === SEEK))
    return { rule: "short firm date", why: "Absence or time sought: a short, firm return date (at most 14 days)." };
  return { rule: "procedural gap", why: `Gap set by what the next step needs${o.next_purpose ? ` (${o.next_purpose.toLowerCase().replace(/_/g, " ")})` : ""}.` };
}

export function auditOf(run: Run): { rows: AuditRow[]; derived: boolean } {
  const a = (run as Run & { audit?: AuditRow[] }).audit;
  if (Array.isArray(a) && a.length) return { rows: a, derived: false };
  const rows: AuditRow[] = [];
  for (const d of run.days) {
    for (const l of d.listings) {
      rows.push({ day: d.date, case_id: l.case_id, action: "listed", rule: l.slot === "day" ? "value per expected minute" : `slot: ${l.slot}`, why: l.why.join("; "), after: `${l.start}-${l.end}` });
      if (l.outcome) {
        const s = outcomeStakeholder(l);
        rows.push({
          day: d.date,
          case_id: l.case_id,
          action: l.outcome.kind === "substantive" ? "heard" : l.outcome.kind.replace("_", " "),
          rule: "simulated outcome",
          why: l.outcome.reason ?? (l.outcome.kind === "substantive" ? "Moved to the next step." : ""),
          stakeholder: s,
        });
        const nd = ruleForNextDate(l, run);
        rows.push({ day: d.date, case_id: l.case_id, action: "next date", rule: nd.rule, why: nd.why, before: d.date, after: l.outcome.next_date });
      }
    }
    for (const h of d.held_back) {
      rows.push({ day: d.date, case_id: h.case_id, action: "held back", rule: h.reason.startsWith("prerequisite") ? "readiness check" : "capacity", why: h.reason });
    }
  }
  return { rows, derived: true };
}

/** Rows for one case on one day, falling back to the derived rule when the engine gave none. */
export function recommendationFor(run: Run, day: Day, l: Listing): { rule: string; why: string } | null {
  const a = (run as Run & { audit?: AuditRow[] }).audit;
  const hit = Array.isArray(a) ? a.find((r) => r.day === day.date && r.case_id === l.case_id && /next/i.test(r.action)) : undefined;
  if (hit) return { rule: hit.rule, why: hit.why };
  return l.outcome ? ruleForNextDate(l, run) : null;
}

/** Delay history for one case: count of non-substantive outcomes by stakeholder across the run. */
export function caseDelayHistory(run: Run, caseId: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of run.days)
    for (const l of d.listings)
      if (l.case_id === caseId) {
        const s = outcomeStakeholder(l);
        if (s) out[s] = (out[s] ?? 0) + 1;
      }
  return out;
}

// Mirrors config/checklists.yaml (default template); the engine names unmet items in hold-back reasons.
export const CHECKLISTS: Record<string, string[]> = {
  APPEARANCE: ["summons served on the accused"],
  WARRANT: ["warrant executed or returned by police"],
  PLEA: ["accused produced or present"],
  EVIDENCE_COMPLAINANT: ["witness list filed, witnesses summoned"],
  EVIDENCE_ACCUSED: ["defence witness list filed"],
  ARGUMENTS: ["written arguments / case summary (front page) filed by both sides"],
  JUDGEMENT: ["arguments closed, judgment reserved"],
  REPORTS: ["report received from mediator / agency"],
};

export type ChecklistItem = { item: string; met: boolean | null };

export function checklistFor(l: Listing): ChecklistItem[] {
  const own = (l as Listing & { checklist?: unknown }).checklist;
  if (Array.isArray(own)) return own.map((x) => (typeof x === "string" ? { item: x, met: true } : { item: String((x as { item?: string }).item ?? ""), met: Boolean((x as { met?: boolean }).met) }));
  if (own && typeof own === "object") return Object.entries(own as Record<string, boolean>).map(([item, met]) => ({ item, met }));
  // A listed matter passed the readiness check for the visible prerequisites.
  return (CHECKLISTS[l.purpose] ?? []).map((item) => ({ item, met: l.outcome?.kind === "not_ready" ? false : true }));
}

export type Phase = { name: string; minutes: number };
export function phasesOf(l: Listing): Phase[] {
  const ph = (l.outcome as (Listing["outcome"] & { phases?: unknown }) | null)?.phases;
  if (Array.isArray(ph)) return ph.map((p) => { const q = p as { name?: string; minutes?: number; seconds?: number }; return { name: String(q.name ?? ""), minutes: q.minutes !== undefined ? Number(q.minutes) : Number(q.seconds ?? 0) / 60 }; }).filter((p) => p.minutes > 0);
  if (ph && typeof ph === "object") return Object.entries(ph as Record<string, number>).map(([name, minutes]) => ({ name, minutes: Number(minutes) })).filter((p) => p.minutes > 0);
  return [];
}

export type DayFlags = { reserve_used?: number; urgent?: number | unknown[]; judge_emergency?: boolean | number | Record<string, unknown> | null };
export function dayFlags(d: Day): { reserveUsed: number; urgent: number; emergency: boolean } {
  const x = d as Day & DayFlags;
  const urgent = Array.isArray(x.urgent) ? x.urgent.length : Number(x.urgent ?? 0) || 0;
  return { reserveUsed: Number(x.reserve_used ?? 0) || 0, urgent, emergency: !!x.judge_emergency };
}

/** Gaming flag for an advocate from engine profiles (never derived: the data here cannot support an accusation). */
export function gamingFor(run: Run, advocate: string): Profile | null {
  const p = (run as Run & { profiles?: Profiles }).profiles;
  const hit = p?.advocates?.find((a) => a.id === advocate);
  return hit && hit.gaming_flag ? hit : null;
}
