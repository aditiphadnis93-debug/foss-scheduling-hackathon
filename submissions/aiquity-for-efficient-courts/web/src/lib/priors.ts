// "What the court assumes" (run.priors) and "What this posting can close" (run.runway). Shapes per the engine export.
import type { Run } from "./types";

export type PriorValues = Partial<{
  minutes: number;
  minutes_mult: number;
  ideal_gap_days: number;
  p_substantive: number;
  p_prerequisite_unmet: number;
  p_absent_if_ready: number;
  p_seek_time_if_ready: number;
  p_court_side_if_ready: number;
  median_hearings_at_stage: number;
  source: string;
}>;
export type Learned = { n: number; prior_go_ahead: number; observed_go_ahead: number; posterior_go_ahead: number; lo90: number; hi90: number };
export type PriorRow = {
  hearing_type: string;
  organiser: PriorValues;
  court: PriorValues | null;
  judge_override: PriorValues | null;
  effective: PriorValues;
  learned: Learned | null;
};
export type Priors = { layers: string[]; editable: string[]; bounds: Record<string, [number, number]>; rows: PriorRow[] };

export function priorsOf(run: Run | null | undefined): Priors | null {
  const p = (run as (Run & { priors?: Priors }) | null | undefined)?.priors;
  return p && Array.isArray(p.rows) && p.rows.length ? p : null;
}

export type RunwayRow = {
  case_id: string;
  age_years: number;
  stage: string;
  stages_left: number;
  hearings_needed: number;
  typical_days_needed: number;
  fastest_days_needed: number;
  max_appearances: number;
  finishable: boolean;
  finishable_typical: boolean;
  appearances: number;
  stages_advanced: number;
  disposed: boolean;
};
export type Runway = {
  window_days: number;
  cases: number;
  finishable: number;
  finishable_typical: number;
  finishable_disposed: number;
  finishable_disposed_pct: number;
  disposed: number;
  never_called: number;
  mean_appearances: number;
  by_stage: Record<string, { cases: number; finishable: number; disposed: number; mean_appearances: number; mean_max_appearances: number }>;
  finishable_not_disposed: RunwayRow[];
  rows: RunwayRow[] | null;
};

export function runwayOf(run: Run | null | undefined): Runway | null {
  const r = (run as (Run & { runway?: Runway }) | null | undefined)?.runway;
  return r && typeof r.cases === "number" ? r : null;
}
