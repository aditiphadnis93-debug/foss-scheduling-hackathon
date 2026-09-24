"use client";

import type { Stat } from "./types";
import type { DayProfile } from "./dayprofile";

export const API_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/\/$/, "");

export type Overrides = {
  ageing_share?: number | "auto";
  fill_target?: number;
  overbook?: number;
  max_listed?: number;
  cluster?: number;
  fresh?: number;
  age?: number;
  carry_over?: "priority" | "same_weekday" | "none";
  next_date_policy?: "procedural" | "flat";
  use_readiness?: boolean;
  give_appointments?: boolean;
  use_horizon?: boolean;
  advocate_correlation?: boolean;
  advocate_daily_cap?: number;
  leave?: string[];
  // behaviour and court-side realism (engine design-02)
  reserve_minutes?: number;
  urgent_per_day?: number;
  judge_emergency_p?: number;
  gaming_share?: number;
  gaming_response?: boolean;
  agency_delay_mult?: number;
  absence_mult?: number;
  judge?: { background: string; years_on_bench: number; specialisations?: string[] } | null;
  learning?: boolean;
  day_profile?: DayProfile;
  risk_kappa?: number;
  horizon_days?: number;
};

export type CompareResult = { base: Record<string, Stat>; modified: Record<string, Stat> };

async function withTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctl.signal });
  } finally {
    clearTimeout(t);
  }
}

export async function apiHealthy(): Promise<boolean> {
  try {
    const r = await withTimeout(`${API_URL}/api/health`, {}, 2500);
    return r.ok;
  } catch {
    return false;
  }
}

export async function compare(body: {
  roster: string;
  config: string;
  overrides: Overrides;
  seed?: number;
  sitting_days?: number;
}, seeds = 3): Promise<CompareResult> {
  const r = await withTimeout(
    `${API_URL}/api/compare?seeds=${seeds}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
    600_000,
  );
  if (!r.ok) throw new Error(`engine answered ${r.status}`);
  return (await r.json()) as CompareResult;
}

export async function postAnnotation(a: unknown): Promise<boolean> {
  try {
    const r = await withTimeout(
      `${API_URL}/api/annotations`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(a) },
      2500,
    );
    return r.ok;
  } catch {
    return false;
  }
}
