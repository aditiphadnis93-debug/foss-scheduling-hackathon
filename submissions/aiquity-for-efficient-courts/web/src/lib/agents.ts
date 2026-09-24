"use client";

// People decided by AI agents: each party and advocate decides whether to come, be ready, or seek time,
// and says why. Reads outcome.rationale from run_100_agents.json, else the agent journeys export.
import type { Listing } from "./types";
import { API_URL } from "./api";

export type Journey = {
  day: string;
  case_id: string;
  rationale?: string;
  decision?: { appear?: boolean; ready?: boolean; seek_adjournment?: boolean; source?: string; p_absent?: number };
};

export function isAgent(l: Listing): boolean {
  const by = l.outcome?.decided_by ?? "";
  return by.startsWith("sarvam") || by.startsWith("agents");
}

let journeys: Promise<Map<string, Journey>> | null = null;
export function journeyMap(): Promise<Map<string, Journey>> {
  if (!journeys)
    journeys = fetch("/data/agents_100_sarvam.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { journeys?: Record<string, Journey[]> } | null) => {
        const m = new Map<string, Journey>();
        for (const list of Object.values(d?.journeys ?? {})) for (const j of list) if (j.rationale) m.set(`${j.day}|${j.case_id}`, j);
        return m;
      })
      .catch(() => new Map());
  return journeys;
}

export function rationaleOf(l: Listing, day: string, m: Map<string, Journey> | null): string | null {
  const own = (l.outcome as (Listing["outcome"] & { rationale?: string | null }) | null)?.rationale;
  if (own) return own;
  if (!isAgent(l)) return null;
  return m?.get(`${day}|${l.case_id}`)?.rationale ?? null;
}

/** A rationale in plain words: "ready: long case but ..." -> "Ready — long case but ..." */
export function tidy(r: string): string {
  const s = r.replace(/;\s*model's most likely outcome:[^;(]*/i, "").replace(/\s*\(P appear/i, " (chance of appearing").replace(/P seek/i, "chance of seeking time");
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/^(\w+):\s*/, "$1 — ");
}

export type AssistantAnswer = { answer: string; suggestions?: string[]; cited_cases?: string[]; source?: string };
export type Assistant = { questions: string[]; answers: Record<string, Record<string, AssistantAnswer>> };

export async function loadAssistant(): Promise<Assistant | null> {
  try {
    const r = await fetch("/data/assistant_100.json");
    return r.ok ? ((await r.json()) as Assistant) : null;
  } catch {
    return null;
  }
}

export async function ask(question: string, day: string, runFile = "run_100_agents.json"): Promise<AssistantAnswer | null> {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 60000);
    const r = await fetch(`${API_URL}/api/ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, day, run_file: runFile }),
      signal: ctl.signal,
    });
    clearTimeout(t);
    if (!r.ok) return null;
    return (await r.json()) as AssistantAnswer;
  } catch {
    return null;
  }
}

/** One real reasoning line from the agents' record, for the home page. */
export async function sampleRationale(): Promise<{ text: string; day: string; case_id: string } | null> {
  try {
    const r = await fetch("/data/run_100_agents.json");
    if (r.ok) {
      const run = (await r.json()) as { days?: { date: string; listings: Listing[] }[] };
      for (const d of run.days ?? [])
        for (const l of d.listings) {
          const t = (l.outcome as (Listing["outcome"] & { rationale?: string }) | null)?.rationale;
          if (t && /seek|time|absent|not ready/i.test(t)) return { text: tidy(t), day: d.date, case_id: l.case_id };
        }
    }
  } catch {}
  const m = await journeyMap();
  const all = [...m.values()];
  const pick = all.find((j) => j.decision?.seek_adjournment) ?? all.find((j) => (j.rationale ?? "").length > 60) ?? all[0];
  return pick?.rationale ? { text: tidy(pick.rationale), day: pick.day, case_id: pick.case_id } : null;
}

// ---------------------------------------------------------------------------------------------
// Proposals: the assistant explains a problem, proposes a change to the court setup, and tests it.
export type Proposal = {
  question: string;
  answer: string;
  cited_cases?: string[];
  proposal?: Record<string, number | string | boolean>;
  why?: string;
  effect?: Record<string, { now: number; with_change: number }>;
  source?: string;
  day?: string;
};

export async function loadProposals(): Promise<Proposal[]> {
  const a = (await loadAssistant()) as (Assistant & { proposals?: { items?: Proposal[] } }) | null;
  return a?.proposals?.items ?? [];
}

export async function askForProposal(question: string, day: string): Promise<Proposal | null> {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 120000);
    const r = await fetch(`${API_URL}/api/assistant`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, day, run_file: "run_100_agents.json", roster: "100", config: "optimal" }),
      signal: ctl.signal,
    });
    clearTimeout(t);
    if (!r.ok) return null;
    const j = (await r.json()) as Proposal;
    return { ...j, question: j.question ?? question };
  } catch {
    return null;
  }
}

export const LEVERS: Record<string, string> = {
  reserve_minutes: "Minutes kept for urgent matters",
  overbook: "How full to list the day",
  fill_target: "Share of the day filled with hearings",
  ageing_share: "Minimum time for old cases (never below 20%)",
  max_listed: "Most matters on one day's list",
  cluster: "Group each advocate's matters",
  fresh: "Give fresh matters priority",
  age: "Weight given to how long a case has waited",
  give_appointments: "Give every matter a time window",
  use_readiness: "Hold back matters that are not ready",
  urgent_per_day: "Urgent matters expected each day",
  carry_over: "How unreached matters return",
  next_date_policy: "How next dates are set",
  use_horizon: "Publish dates days ahead",
};

export function leverValue(k: string, v: number | string | boolean): string {
  if (typeof v === "boolean") return v ? "On" : "Off";
  if (typeof v === "string") return v === "auto" ? "Follow the roster" : v.replace(/_/g, " ");
  if (k === "overbook") return v >= 1 ? `List ${Math.round((v - 1) * 100)}% beyond the expected day` : `${Math.round(v * 100)}% of the day`;
  if (k === "ageing_share" || k === "fill_target") return `${Math.round(v * 100)}%`;
  if (k === "reserve_minutes") return `${v} min`;
  return String(Number.isInteger(v) ? v : v.toFixed(2));
}

export const PREFILL_KEY = "ocl.whatif.prefill";
