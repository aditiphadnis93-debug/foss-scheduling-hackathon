/**
 * Agent journey data: types + defensive loader for `agents_<scenario>.json`
 * (causelist.agents.export.export_agents, schema_version 1; or the demo mock).
 */
import type { OutcomeKind } from "./world";

export type RawWindow = string | { slot?: string; start?: string; end?: string; start_min?: number; end_min?: number };
export type RawDecision = {
  appear?: boolean; ready?: boolean; seek_adjournment?: boolean;
  p_absent?: number; p_seek?: number; p_ready?: number; p_appear?: number;
  p_absent_statistical?: number; p_seek_statistical?: number;
  confirmed_in_advance?: boolean; source?: string; minutes_if_heard?: number | null; model_choice?: string | null;
};
export type RawStep = {
  day: string; case_id?: string; purpose?: string; side?: string; listed_window?: RawWindow;
  decision?: RawDecision | null; rationale?: string;
  outcome?: { kind?: string; reason?: string | null; next_date?: string | null } | string | null;
  trip_made?: boolean; trip_wasted?: boolean; minutes_waited?: number; travel_minutes?: number;
  wages_lost?: number; travel_cost?: number;
};
export type RawAgent = {
  id: string; role?: string; name?: string; occupation?: string;
  traits?: Record<string, number>; persona?: { traits?: Record<string, number>; summary?: string };
  case_ids?: string[]; totals?: Record<string, number>;
  journey?: RawStep[]; propensity?: { day: string; p_appear?: number; value?: number }[];
};
export type AgentsFile = {
  schema_version?: number;
  meta?: Record<string, unknown>;
  agents?: RawAgent[];
  journeys?: Record<string, RawStep[]>;
  drift?: Record<string, { day: string; value: number }[]>;
  comparison?: { statistical?: Record<string, number>; agents?: Record<string, number>; delta?: Record<string, number>; agent_summary?: Record<string, unknown> };
  aggregate?: { statistical?: Record<string, number>; agents?: Record<string, number>; labels?: Record<string, string>; lower_is_better?: string[] };
};

export type Step = {
  day: string;
  dayIdx: number;
  caseId: string;
  purpose: string;
  window: string;
  called: boolean; // decision present
  appear: boolean;
  ready: boolean;
  seek: boolean;
  pAppear: number | null;
  pAppearStat: number | null;
  confirmed: boolean;
  source: string;
  rationale: string;
  outcome: OutcomeKind;
  reason: string | null;
  tripMade: boolean;
  tripWasted: boolean;
  minutesWaited: number;
  wagesLost: number;
  travelCost: number;
};

export type Agent = {
  id: string;
  role: "advocate" | "litigant";
  name: string;
  traits: [string, number, number][]; // key, raw value, normalised 0..1
  caseIds: string[];
  steps: Step[];
  drift: { dayIdx: number; value: number }[];
  totals: { listings: number; trips: number; wasted: number; minutes: number; wages: number; travel: number };
};

export type Hearing = { caseId: string; purpose: string; window: string; outcome: OutcomeKind; reason: string | null; parties: { agent: Agent; step: Step }[] };

export type AgentsData = {
  scenario: string;
  engine: string;
  model: string | null;
  recorded: boolean;
  mock: boolean;
  days: string[];
  agents: Agent[];
  byDay: Hearing[][];
  comparison: { key: string; label: string; stat: number; agent: number; lowerBetter: boolean }[];
  summary: Record<string, unknown>;
  driftMeasure: Record<string, string>;
};

const num = (v: unknown, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const OUTCOMES: OutcomeKind[] = ["substantive", "adjourned", "not_reached", "not_ready"];

// how to scale a raw trait to a 0..1 bar
const TRAIT_SCALE: Record<string, (v: number) => number> = {
  travel_km: (v) => Math.min(1, v / 20),
  daily_wage_loss: (v) => Math.min(1, v / 1500),
};
export const TRAIT_LABEL: Record<string, string> = {
  diligence: "Diligence", caseload_pressure: "Caseload pressure", reliability: "Reliability",
  responds_to_appointment: "Responds to a time slot", cost_sensitivity: "Cost sensitivity",
  travel_km: "Distance to court", daily_wage_loss: "Wage lost per day", trust_in_court: "Trust in court",
  patience: "Patience", means: "Means", preparedness: "Preparedness", caseload: "Caseload",
};
export const traitValue = (k: string, v: number) =>
  k === "travel_km" ? `${v.toFixed(1)} km` : k === "daily_wage_loss" ? `Rs ${Math.round(v)}` : `${Math.round(v * 100)}`;

export const METRIC_LABEL: Record<string, string> = {
  utilisation_pct: "Court time used (%)", reach_rate_pct: "Listed cases reached (%)",
  substantive_pct_of_heard: "Heard hearings that moved (%)", heard_on_first_listing_pct: "Heard on first listing (%)",
  heard_total: "Hearings heard", substantive_total: "Hearings that moved", disposed: "Cases disposed",
  advocate_trips: "Advocate trips", hearings_per_advocate_trip: "Hearings per advocate trip",
  predictability_gap_days: "Predictability gap (days)", eju_pct: "Effective judicial use (%)",
  backlog_4y_heard_pct: "4y+ cases heard (%)", listed_total: "Listings",
  appearance_rate_pct: "Sides that turn up (%)", substantive_pct: "Hearings that move (%)",
  adjourned_pct: "Adjourned (%)", not_reached_pct: "Not reached (%)", not_ready_pct: "Not ready (%)",
  trips_wasted: "Wasted trips", mean_minutes_waited: "Mean minutes waited", wages_lost_total: "Wages lost (Rs)",
};
const LOWER_BETTER = new Set(["predictability_gap_days", "next_date_mean_gap_days", "cases_5y_pending_end", "advocate_trips",
  "idle_minutes_per_day", "overrun_minutes_per_day", "adjourned_pct", "not_reached_pct", "not_ready_pct", "trips_wasted",
  "mean_minutes_waited", "wages_lost_total"]);
const PREFERRED = ["substantive_pct_of_heard", "heard_on_first_listing_pct", "reach_rate_pct", "utilisation_pct", "disposed",
  "heard_total", "substantive_total", "advocate_trips", "hearings_per_advocate_trip", "eju_pct",
  "appearance_rate_pct", "substantive_pct", "adjourned_pct", "not_reached_pct", "not_ready_pct", "trips_wasted", "mean_minutes_waited", "wages_lost_total"];

function windowText(w: RawWindow | undefined) {
  if (!w) return "";
  if (typeof w === "string") return w;
  return w.start && w.end ? `${w.start}-${w.end}` : String(w.slot ?? "");
}

export function normaliseAgents(raw: AgentsFile, scenario: string): AgentsData {
  const meta = (raw.meta ?? {}) as Record<string, unknown>;
  const rawDays = (meta.sitting_days ?? meta.days) as unknown;
  const daySet = new Set<string>(Array.isArray(rawDays) ? rawDays.map(String) : []);
  const rawAgents = (Array.isArray(raw.agents) ? raw.agents : []).filter((a) => a && a.id != null);
  const stepsOf = (a: RawAgent): RawStep[] => (raw.journeys?.[a.id] ?? a.journey ?? []).filter((s) => s && s.day);
  for (const a of rawAgents) for (const s of stepsOf(a)) daySet.add(s.day);
  const days = [...daySet].sort();
  const dayIdx = new Map(days.map((d, i) => [d, i]));

  const agents: Agent[] = rawAgents.map((a) => {
    const traitsRaw = a.traits ?? a.persona?.traits ?? {};
    const traits = Object.entries(traitsRaw)
      .filter(([, v]) => typeof v === "number")
      .map(([k, v]) => [k, v, Math.max(0, Math.min(1, (TRAIT_SCALE[k] ?? ((x: number) => x))(v)))] as [string, number, number]);
    const steps: Step[] = stepsOf(a).map((s) => {
      const d = s.decision ?? null;
      const o = typeof s.outcome === "string" ? { kind: s.outcome, reason: null } : s.outcome ?? {};
      const kind = OUTCOMES.includes(o.kind as OutcomeKind) ? (o.kind as OutcomeKind) : "adjourned";
      const pAppear = d ? (typeof d.p_appear === "number" ? d.p_appear : typeof d.p_absent === "number" ? 1 - d.p_absent : null) : null;
      return {
        day: s.day, dayIdx: dayIdx.get(s.day) ?? 0, caseId: String(s.case_id ?? ""), purpose: String(s.purpose ?? ""),
        window: windowText(s.listed_window), called: !!d,
        appear: d ? !!d.appear : !!s.trip_made, ready: d ? !!d.ready : false, seek: d ? !!d.seek_adjournment : false,
        pAppear, pAppearStat: d && typeof d.p_absent_statistical === "number" ? 1 - d.p_absent_statistical : null,
        confirmed: !!d?.confirmed_in_advance, source: String(d?.source ?? meta.engine ?? ""),
        rationale: String(s.rationale ?? ""), outcome: kind, reason: o.reason ?? null,
        tripMade: s.trip_made ?? (d ? !!d.appear : false), tripWasted: !!s.trip_wasted,
        minutesWaited: num(s.minutes_waited), wagesLost: num(s.wages_lost), travelCost: num(s.travel_cost),
      };
    }).sort((x, y) => x.day.localeCompare(y.day));
    const driftRaw = raw.drift?.[a.id] ?? (a.propensity ?? []).map((p) => ({ day: p.day, value: num(p.value, num(p.p_appear)) }));
    const drift = driftRaw.map((p) => ({ dayIdx: dayIdx.get(p.day) ?? 0, value: num(p.value) }));
    const t = a.totals ?? {};
    const totals = {
      listings: num(t.listings, steps.length),
      trips: num(t.trips, steps.filter((s) => s.tripMade).length),
      wasted: num(t.wasted_trips, steps.filter((s) => s.tripWasted).length),
      minutes: num(t.minutes_waited, steps.reduce((x, s) => x + s.minutesWaited, 0)),
      wages: num(t.wages_lost, steps.reduce((x, s) => x + s.wagesLost, 0)),
      travel: num(t.travel_cost, steps.reduce((x, s) => x + s.travelCost, 0)),
    };
    const role = a.role === "advocate" ? "advocate" : "litigant";
    return { id: String(a.id), role, name: String(a.name ?? a.id), traits, caseIds: (a.case_ids ?? []).map(String), steps, drift, totals };
  });

  // inside the court: hearings per day, parties joined by case id
  const byDay: Hearing[][] = days.map(() => []);
  const idx = new Map<string, Hearing>();
  for (const ag of agents) for (const s of ag.steps) {
    const key = `${s.dayIdx}|${s.caseId}`;
    let h = idx.get(key);
    if (!h) {
      h = { caseId: s.caseId, purpose: s.purpose, window: s.window, outcome: s.outcome, reason: s.reason, parties: [] };
      idx.set(key, h);
      byDay[s.dayIdx]?.push(h);
    }
    h.parties.push({ agent: ag, step: s });
  }
  for (const list of byDay) {
    list.sort((x, y) => x.window.localeCompare(y.window) || x.caseId.localeCompare(y.caseId));
    for (const h of list) h.parties.sort((x, y) => (x.agent.role === y.agent.role ? 0 : x.agent.role === "advocate" ? -1 : 1));
  }

  const cmp = raw.comparison ?? raw.aggregate ?? {};
  const stat = cmp.statistical ?? {}, agentM = cmp.agents ?? {};
  const extraLower = new Set((raw.aggregate?.lower_is_better ?? []) as string[]);
  const keys = Object.keys(stat).filter((k) => typeof stat[k] === "number" && typeof agentM[k] === "number");
  keys.sort((x, y) => (PREFERRED.indexOf(x) + 1 || 999) - (PREFERRED.indexOf(y) + 1 || 999));
  const comparison = keys.map((k) => ({
    key: k, label: raw.aggregate?.labels?.[k] ?? METRIC_LABEL[k] ?? k.replace(/_/g, " "),
    stat: stat[k], agent: agentM[k], lowerBetter: LOWER_BETTER.has(k) || extraLower.has(k),
  }));

  return {
    scenario,
    engine: String(meta.engine ?? (meta.source === "mock" ? "mock" : "agents")),
    model: meta.model ? String(meta.model) : null,
    recorded: meta.recorded === true || (typeof meta.model === "string" && !!meta.model),
    mock: meta.source === "mock",
    days, agents, byDay, comparison,
    summary: ((raw.comparison?.agent_summary ?? {}) as Record<string, unknown>),
    driftMeasure: (meta.drift_measure ?? {}) as Record<string, string>,
  };
}

export type AgentsScenario = { id: string; label: string; note?: string };

/** available runs: `agents_index.json` manifest, else the demo mock */
export async function listAgentScenarios(): Promise<AgentsScenario[]> {
  try {
    const r = await fetch("/data/agents_index.json");
    if (r.ok) {
      const j = (await r.json()) as { scenarios?: AgentsScenario[] };
      if (Array.isArray(j.scenarios) && j.scenarios.length) {
        // keep only runs whose file is actually there
        const ok = await Promise.all(j.scenarios.map((s) => fetch(`/data/agents_${encodeURIComponent(s.id)}.json`, { method: "HEAD" }).then((x) => x.ok).catch(() => false)));
        const list = j.scenarios.filter((_, i) => ok[i]);
        if (list.length) return list;
      }
    }
  } catch { /* fall through */ }
  return [{ id: "demo", label: "Sample" }];
}

export async function loadAgents(scenario: string): Promise<AgentsData> {
  const get = async (s: string) => {
    const r = await fetch(`/data/agents_${encodeURIComponent(s)}.json`);
    if (!r.ok) throw new Error(`agents_${s}.json: ${r.status}`);
    return normaliseAgents((await r.json()) as AgentsFile, s);
  };
  try { return await get(scenario); } catch (e) { if (scenario === "demo") throw e; return get("demo"); }
}
