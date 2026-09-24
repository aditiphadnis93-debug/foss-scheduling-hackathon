# Data contract (engine → web)

The web app is a **static site by default**: it reads precomputed JSON from `public/data/`.
When the local API is running (`PYTHONPATH=src uvicorn causelist.api:app --port 8000`), the
What-if page calls it live. The base URL comes from `NEXT_PUBLIC_API_URL` (default `http://localhost:8000`).
If the API isn't there, the page falls back to precomputed presets and says so.

## `public/data/index.json`
`{ scenarios: [{roster: "100"|"3000", config, file, metrics}], rosters, configs }`

## `public/data/run_<roster>_<config>.json` (also the response of `POST /api/run`)
```ts
type Run = {
  meta: { label: string; config: string; planner: "milp"|"greedy"|"baseline"; roster_size: number;
          start: string; end: string; seed: number; behaviour: string; inflow: string|null;
          sitting_days: number; config_detail: Record<string, unknown> };
  metrics: Record<string, number>;           // see "Metric keys" below
  montecarlo?: Record<string, {mean:number; p10:number; p90:number; min:number; max:number}>;
  backlog: { date: string; "<1y": number; "1-2y": number; "2-3y": number; "3-4y": number;
             "4-5y": number; "5y+": number; disposed_cum: number }[];
  flags: { ageing: FlagRow[]; repeat_adjournments: FlagRow[]; stuck_at_stage: FlagRow[] };
  days: { date: string; capacity: number; minutes_used: number; expected: number; solver: string;
          new_filings: number; held_back_capacity: number;
          held_back: { case_id: string; reason: string }[];      // non-capacity reasons (prerequisite pending…)
          listings: { case_id: string; slot: string; start: "HH:MM"; end: "HH:MM"; purpose: string;
                      advocate: string; exp_min: number; p_ahead: number; p_sub: number; score: number;
                      why: string[];
                      outcome: null | { kind: "substantive"|"adjourned"|"not_reached"|"not_ready";
                                        reason: string|null; minutes: number; next_date: string|null;
                                        next_purpose: string|null; decided_by: string } }[] }[];
  cases?: Record<string, { filing_date: string; age_at_start: number; advocate: string; party: string;
                           stage_start: string; purpose_start: string; stage_end: string; purpose_end: string;
                           status_end: "pending"|"disposed"; origin: "roster"|"world"; hearings_total: number }>;
};
type FlagRow = { case_id: string; age_years: number; stage: string; purpose: string;
                 adjournments_in_row: number; hearings_at_stage: number; advocate: string };
```
`cases` is included for the 100-case roster only (size). Case history = scan `days[].listings` for a case_id.

### Metric keys (the five scored dimensions first)
`utilisation_pct, reach_rate_pct, substantive_pct_of_heard, backlog_4y_heard_pct, predictability_gap_days,
heard_on_first_listing_pct, next_date_mean_gap_days, next_date_sane_pct, eju_pct,
justice_weighted_progress_per_hour, disposed, cases_5y_pending_start, cases_5y_pending_end,
substantive_total, heard_total, listed_total, listed_per_day, advocate_trips, hearings_per_advocate_trip,
idle_minutes_per_day, overrun_minutes_per_day, old_minutes_share_pct, sitting_days`.
Render unknown keys generically; never crash on a missing key. Higher is better except:
`predictability_gap_days, next_date_mean_gap_days, cases_5y_pending_end, advocate_trips, idle_minutes_per_day, overrun_minutes_per_day`.

## Live API
- `GET /api/presets` → `{presets: {name: config}, floors: {min_ageing_share}}`
- `POST /api/run` body `{roster, config, overrides, seed, sitting_days?, include_cases?}` → `Run`
- `POST /api/compare?seeds=3` same body → `{base: MC, modified: MC}` (mean/p10/p90 per metric)
- overrides: `ageing_share (number ≥ 0.2 or "auto"), fill_target, overbook, max_listed, cluster, fresh, age,
  carry_over ("priority"|"same_weekday"|"none"), next_date_policy ("procedural"|"flat"), use_readiness,
  give_appointments, use_horizon, advocate_correlation, leave: ISO dates[]`,
  and court operations: `reserve_minutes (int), urgent_per_day (number), judge_emergency_p (0..1), learning (bool),
  gaming_share (0..1), gaming_response (bool), agency_delay_mult (number, 1 = observed), absence_mult (number;
  passed to the behaviour model when it supports it, otherwise ignored), day_profile ({default|mon..fri:
  {sittings: [["HH:MM","HH:MM"]...], admin: [...]}}; guardrail violations -> HTTP 422 `{detail: {guardrail: string[]}}`),
  judge ({background, years_on_bench, specialisations})`

## Court operations (added by the court-ops build; all optional — render when present)
Extra fields on `Run`:
```ts
type RunCourtOps = {
  days: (Day & {
    reserve_minutes: number;          // held back from the planner for urgent matters
    reserve_used: number;             // minutes of it used by urgent matters (the rest went to standby)
    urgent: { case_id: string; type: "BAIL"|"APPLICATION_REVIEW"; start_min: number; minutes: number;
              from_reserve: boolean }[];                    // heard first, before the list
    judge_emergency: null | { lost_minutes: number; sitting_until_min: number; rolled: string[] };
    standby: Listing[];               // standby calls (same shape as listings)
    sitting_windows: ["HH:MM","HH:MM"][];   // hearing windows today (judge day profile); capacity = their sum
    admin_windows: ["HH:MM","HH:MM"][];     // administrative blocks today (never listed into)
  })[];
  // listings[].duration_mult: number   // duration_model multiplier used for exp_min (judge background /
  //                                    // experience, recency of the last hearing); 1 = reference minutes
  // meta.profile_report: { days: {weekday, sitting_minutes, admin_minutes, sittings, admin}[];
  //                        weekly_sitting_minutes; vs_norm_pct; guardrails: {min_weekly, min_day, max_day} }
  access: object;                    // causelist.access.summarise (visibility / possibility for litigants)
  // listings[].outcome gains:
  //   stakeholder: "petitioner_side"|"respondent_side"|"both_sides"|"state_agencies"|"court"|
  //                "judge_emergency"|"time_ran_out"|null            (null = substantive)
  //   phases: { name: "Call & appearance check"|"Submissions / evidence"|"Order dictation / judge deciding";
  //             seconds: number }[]        // sums to the outcome's minutes*60; [] when not reached
  audit: AuditEntry[];               // full log for rosters <= 500 (capped at 25,000), else rare decisions only
  audit_counts: Record<AuditAction, number>;
  audit_total: number; audit_truncated: boolean;
  attribution: { by_stakeholder: object; by_type: object; by_day: object[]; minutes_lost: object };
  profiles: object | null;           // advocate / party profiles from the learning build (null if absent)
};
type AuditAction = "listed"|"held_back"|"rolled_over"|"rescheduled"|"next_date"|"urgent_heard"|
                   "judge_emergency"|"last_chance"|"standby_called"|"withdrawn";
type AuditEntry = { day: string; case_id: string|null; action: AuditAction; rule: string; why: string;
                    before: unknown; after: unknown; actor: string|null;
                    score?: number; purpose?: string; next_purpose?: string|null;
                    evidence?: object; flagged_actor?: string; p_exceed?: number; recheck_on?: string };
```
Rules: next dates `procedural | absence-short | prerequisite | capacity-aware | flat | disposed |
gaming-firm-short | emergency-roll`; roll-overs `carry-next-day | carry-same-weekday | emergency-roll`;
hold-backs `checklist | checklist-cleared | prerequisite | capacity` (capacity = one aggregate entry per day,
`case_id: null`, `after` = count); reschedules `day-plan | horizon | checklist`; listings `planner:<solver>`.
Held-back reasons for unmet prerequisites read `checklist: <item> not met` (items from `config/checklists.yaml`).
With a day profile and no explicit slots, listings sit in slots `sitting_1`, `sitting_2`, … (one per sitting
window); appointment windows always fall inside a sitting. Listing `start`/`end` stay HH:MM wall-clock times.
A judge-emergency outcome has `kind: "not_reached"`, reason starting `Judge emergency`, stakeholder `judge_emergency`.

## Layer exports (added by the L3 / L4 builds)
- `public/data/agents_<scenario>.json` — from `causelist.agents.export.export_agents` (schema in that module's docstring)
- `public/data/world_<scenario>.json` — from `causelist.world.export.export_world` (schema in that module's docstring)
