// Engine -> web data contract (see web/DATA_CONTRACT.md). Every field a page reads is optional-safe.

export type OutcomeKind = "substantive" | "adjourned" | "not_reached" | "not_ready";

export type Outcome = {
  kind: OutcomeKind;
  reason: string | null;
  minutes: number;
  next_date: string | null;
  next_purpose: string | null;
  decided_by: string;
};

export type Listing = {
  case_id: string;
  slot: string;
  start: string;
  end: string;
  purpose: string;
  advocate: string;
  exp_min: number;
  p_ahead: number;
  p_sub: number;
  score: number;
  why: string[];
  outcome: Outcome | null;
};

export type Day = {
  date: string;
  capacity: number;
  minutes_used: number;
  expected: number;
  solver: string;
  new_filings: number;
  held_back_capacity: number;
  held_back: { case_id: string; reason: string }[];
  listings: Listing[];
};

export type FlagRow = {
  case_id: string;
  age_years: number;
  stage: string;
  purpose: string;
  adjournments_in_row: number;
  hearings_at_stage: number;
  advocate: string;
};

export type BacklogRow = {
  date: string;
  "<1y": number;
  "1-2y": number;
  "2-3y": number;
  "3-4y": number;
  "4-5y": number;
  "5y+": number;
  disposed_cum: number;
};

export type Stat = { mean: number; p10: number; p90: number; min: number; max: number };

export type CaseInfo = {
  filing_date: string;
  age_at_start: number;
  advocate: string;
  party: string;
  stage_start: string;
  purpose_start: string;
  stage_end: string;
  purpose_end: string;
  status_end: "pending" | "disposed";
  origin: "roster" | "world";
  hearings_total: number;
};

export type Run = {
  meta: {
    label: string;
    config: string;
    planner: string;
    roster_size: number;
    start: string;
    end: string;
    seed: number;
    behaviour: string;
    inflow: string | null;
    sitting_days: number;
    config_detail: Record<string, unknown>;
  };
  metrics: Record<string, number>;
  montecarlo?: Record<string, Stat>;
  backlog: BacklogRow[];
  flags: { ageing: FlagRow[]; repeat_adjournments: FlagRow[]; stuck_at_stage: FlagRow[] } & Record<string, FlagRow[]>;
  days: Day[];
  cases?: Record<string, CaseInfo>;
};

export type Scenario = { roster: string; config: string; file: string; metrics: Record<string, number> };
export type Index = { scenarios: Scenario[]; rosters: string[]; configs: string[] };

export type Roster = "100" | "3000";
