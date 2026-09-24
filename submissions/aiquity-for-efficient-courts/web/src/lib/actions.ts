"use client";

// Court actions against the local engine: rosters, the daily causelist, and the next best date.
import { API_URL, type Overrides } from "./api";
import type { Listing } from "./types";

export type RosterInfo = { key: string; label: string; source?: string };
export type RosterSummary = { key?: string; cases: number; advocates: number; by_stage: Record<string, number>; by_age: Record<string, number>; dispute_kinds: Record<string, number> };
export type CauselistOut = {
  date: string;
  roster: string;
  config: string;
  sitting_windows?: [string, string][];
  listings: Listing[];
  held_back: { case_id: string; reason: string }[];
  held_back_capacity?: number;
  expected_minutes?: number;
  capacity?: number;
  csv: string;
};
export type NextDateOut = {
  case_id: string;
  disposed: boolean;
  explanation?: string;
  today?: string;
  purpose_today?: string;
  next_purpose?: string;
  suggested?: string;
  days_away?: number;
  rule?: string;
  rule_in_words?: string;
  procedural_gap_days?: number | null;
  alternatives?: { date: string; days_away: number; note: string }[];
  rule_date?: string;
  preferences_applied?: string;
};

async function call<T>(path: string, body?: unknown, timeout = 120000): Promise<T> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(`${API_URL}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctl.signal,
    });
    if (!r.ok) {
      let msg = `the engine answered ${r.status}`;
      try {
        const j = await r.json();
        if (j?.detail) msg = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail);
      } catch {}
      throw new Error(msg);
    }
    return (await r.json()) as T;
  } finally {
    clearTimeout(t);
  }
}

export const listRosters = () => call<{ rosters: RosterInfo[] }>("/api/rosters").then((r) => r.rosters);
export const uploadRoster = (name: string, csv: string) => call<RosterSummary>("/api/roster/upload", { name, csv });
export const generateRoster = (num_cases: number, seed: number, name?: string) => call<RosterSummary>("/api/roster/generate", { num_cases, seed, name });
export const makeCauselist = (roster: string, config: string, date: string, overrides: Overrides) =>
  call<CauselistOut>("/api/causelist", { roster, config, date, overrides }, 180000);
export const nextDate = (roster: string, case_id: string, today: string, outcome: string, preferences?: unknown) =>
  call<NextDateOut>("/api/next-date", { roster, case_id, today, outcome, ...(preferences ? { preferences } : {}) });
