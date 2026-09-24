# Vihitha API contract v3 (source of truth for backend + frontend)

This file resolves every open detail in `VIHITHA_BACKEND_SPEC_v3.md` Â§8. (The app is named **Vihitha**. "Vihitha" is the old name.)
Base URL: `${VITE_API_URL}/api/v1` (default `http://localhost:8000/api/v1`). All JSON uses snake_case.
Dates are `YYYY-MM-DD` and times are `HH:MM` (24h). Percentages are **0â€“100 numbers**. Probabilities (`p_substantive`, `prob_ends_by_horizon`) are **0â€“1**.
`case_id` = filing number (e.g. `KL-001922-2016`). URL-encode it in paths.

Errors: HTTP 404/409/422/500 with body `{"error": {"code": "NOT_FOUND"|"VALIDATION_FAILED"|"CONFLICT"|"INTERNAL", "message": str, "details": any}}`.

Nothing is simulated in the core schedule. Hearings and days live in SQLite. Only `/whatif` and forecasts use simulation.

---

## Enums

- HearingType (14): `ADMISSION, DELAY_CONDONATION_HEARING, COGNIZANCE, APPEARANCE, WARRANT, PLEA, EXAMINATION_UNDER_S351_BNSS, EVIDENCE_COMPLAINANT, EVIDENCE_ACCUSED, ARGUMENTS, JUDGEMENT, BAIL, REPORTS, APPLICATION_REVIEW`
- DayStatus: `DRAFT | PUBLISHED | CLOSED`
- HearingStatus: `DRAFT | PUBLISHED | DONE | CANCELLED`
- Result: `MOVED_FORWARD | ADJOURNED | NOT_REACHED | DISPOSED`
- ReasonGroup (for ADJOURNED): `ABSENCE | PREP | PROCESS | COURT | UNCLEAR`
- DisposalType (for DISPOSED): `CONVICTION | ACQUITTAL | JUDGEMENT | SETTLED | WITHDRAWN | DISMISSED` (`JUDGEMENT` = judgement delivered, set automatically when a JUDGEMENT hearing moves forward)
- AgeBucket: `"0-1" | "1-3" | "3-4" | "4-5" | "5+"`
- Likelihood: `LIKELY` (p â‰¥ 0.6) | `UNCERTAIN` (0.3â€“0.6) | `UNLIKELY` (< 0.3)
- Flags: `OLD_CASE` (4+ yrs), `VERY_OLD_CASE` (5+ yrs), `REPEAT_ADJOURNED`, `STUCK`, `PROCESS_PENDING`, `LAST_CHANCE`, `CARRIED_FORWARD`
- Case status: `PENDING | DISPOSED`
- Hearing origin: `PLANNER | JUDGE | NEXT_DATE | CARRY_FORWARD`

## Shared schemas

```ts
HearingEvent {
  hearing_id: number, case_id: string, case_number: string, title: string,   // "ST/48/2021 Â· Warrant"
  hearing_type: HearingType, stage: HearingType, age_years: number, age_bucket: AgeBucket, advocate_id: string,
  date: string, block_id: string, window_start: string, window_end: string, est_start: string, est_end: string,
  duration_min: number, expected_minutes: number,
  likelihood: Likelihood, p_substantive: number,
  reason: string,                     // "Suggested because ..." sentence
  status: HearingStatus, pinned: boolean, carried_forward: boolean, first_promised_date: string | null,
  origin: string,
  result: { result: Result, reason_group: ReasonGroup|null, disposal_type: DisposalType|null,
            actual_start: string|null, actual_end: string|null, note: string|null } | null,
  flags: string[]
}
Window { start, end, block_id, hearing_ids: number[], expected_minutes, capacity_minutes }
Block  { id, label, start, end, color_key }          // color_key: "short"|"evidence"|"old"|"carry"|"fresh"|"any"
DayTotals { date, listed, expected_minutes, capacity_minutes, load_pct, old_cases, unused_minutes,
            moved_forward: number|null, adjourned: number|null, not_reached: number|null }   // last three non-null only for CLOSED days
Kpi { key: "moved_forward"|"old_cases_heard"|"court_time_used"|"heard_on_promised",
      label, value: number, unit: "per week"|"%", compare_value: number|null, delta: number|null,
      better: boolean|null, is_forecast: boolean, detail: string|null }
Warning { field, requested, applied, message }
CaseSummary { case_id, case_number, stage, next_purpose, status, age_years, age_bucket, advocate_id,
              next_hearing: {hearing_id, date, window_start, window_end, status} | null,
              projected_end: {p10, p50, p90} | null, prob_ends_by_horizon: number|null,
              likely_to_finish: boolean|null,    // prob_ends_by_horizon >= 0.5 (horizon = 31 Dec)
              flags: string[] }
PlanSummary { from, to, days_planned, hearings_created, unscheduled_count, warnings: Warning[] }
NextDateSuggestion {
  hearing_id, case_id, next_purpose,
  suggested: {date, window_start, window_end, reason},
  alternatives: [{date, reason}],
  window: {min, target, max},
  vs_flat_default_days: number,
  heatmap: [{date, sitting: boolean, load_pct: number}]   // 42 days from the hearing date
}
DayView {
  date, status: DayStatus|null, sitting, holiday_name, leave: boolean, leave_note,
  day_start: "10:00", day_end: "17:30", lunch: ["13:30","14:00"],
  blocks: Block[], windows: Window[], hearings: HearingEvent[], totals: DayTotals,
  held_back: [{case_id, case_number, hearing_type, reason, eligible_from}],
  idle_reason: string | null,   // why part of a planned day is free (null when ~full)
  ruleset: {id, name} | null
}
RulesBody {
  name, preset: "optimal"|"sehgal"|"dimakar"|"joshi"|"baseline"|"custom",
  capacity_minutes: 420,
  day: {start, lunch_start, lunch_end, end},
  fill_target: number | null,            // 1.0 = 100%; null = no minutes cap (baseline)
  max_listed_per_day: number|null,
  window_minutes: number | null,         // slot window size; null = use the court setting (default 30)
  blocks: [{id, label, start, end, hearing_types: HearingType[]|null, min_age_years: number|null, carried_forward_only: boolean, color_key}],
  priority_weights: {age, p_substantive, waiting, near_disposal, fresh},   // 0..1
  clustering: {by_advocate: boolean, purpose_days: {MON?: HearingType[], TUE?:..., WED?, THU?, FRI?} | null},
  ageing_quota_pct: number, max_wait_days_4y: number,
  carry_forward_same_weekday: boolean, prerequisite_check: boolean,
  next_date_mode: "REFERENCE"|"FLAT_60", next_date_window_factor: number,
  slots: boolean, require_case_summary_4y: boolean, summary_prep_reduction: number,
  settlement_prob: number, duration_sigma: number, adjourn_call_minutes: number,
  learning: boolean,
  agents: {enabled, trait_sd, slot_bonus, notice_bonus, notice_min_days, cluster_bonus, fatigue_per_miss, fatigue_cap, last_chance_bonus}
}
Ruleset { id: number, name, preset, is_active: boolean, rules: RulesBody, created_at, updated_at }
```

---

## 8.1 Health and setup
| Method + path | Request | Response |
|---|---|---|
| `GET /health` | â€“ | `{status:"ok", db:"ok", today, roster_loaded, active_ruleset: {id,name}|null, court_name}` |
| `POST /setup/roster` | JSON `{source:"SAMPLE"|"GENERATE", n?, seed?, reset?}` or multipart form (`source=UPLOAD`, `file`, `reset`) | `{roster: RosterSummary, plan: PlanSummary}`; 409 if a roster exists and `reset` is not true |
| `GET /setup/roster/summary` | â€“ | `RosterSummary {cases, pending, disposed, advocates, pct_4y_plus, pct_5y_plus, by_stage:[{stage,count}], by_bucket:[{bucket,count}], source, seed}` (all zero / source null if none loaded) |
| `GET /setup/reference` | â€“ | `{hearing_types: [{type, label, duration_min, reference_gap_days, p_substantive, expected_hearings, min_h, max_h, mean_h, median_h, sources:{p_substantive:"real"|"estimated", failures:"real"|"estimated"}, failure_reasons: {label: count}, reason_groups: {group: share}}], reason_groups: [{group, label, columns:[str]}]}` |
| `GET /setup/calendar?from&to` | â€“ | `{days: [{date, weekday, sitting, holiday_name, leave, leave_note}]}` |
| `POST /setup/leave` | `{date, note?}` | `{date, hearings_moved, published_hearings_affected: [HearingEvent]}` |
| `DELETE /setup/leave/{date}` | â€“ | 204 |
| `GET /setup/settings` | â€“ | `{horizon_working_days, window_minutes, today}` |
| `PUT /setup/settings` | any subset of the same | same |
| `POST /setup/reset` | `{confirm: true}` | 204 (wipes DB, reloads the default roster (3,000 generated from the sample, seed 42), seeds presets, plans horizon) |

## 8.2 Rules
| Method + path | Request | Response |
|---|---|---|
| `GET /rules/presets` | â€“ | `{presets: [{id, name, description, rules: RulesBody, warnings: Warning[]}]}` |
| `GET /rulesets` | â€“ | `{items: [{id, name, preset, is_active, updated_at}]}` |
| `POST /rulesets` | `{name, rules: RulesBody}` | `{ruleset: Ruleset, warnings}` |
| `GET /rulesets/{id}` | â€“ | `{ruleset: Ruleset}` |
| `PUT /rulesets/{id}` | `{name?, rules}` | `{ruleset, warnings}` |
| `DELETE /rulesets/{id}` | â€“ | 204 (409 if active) |
| `PUT /rules/active` | `{ruleset_id, replan_from?}` | `{active: Ruleset, plan: PlanSummary, warnings}` |

## 8.3 Calendar and schedule
| Method + path | Request | Response |
|---|---|---|
| `GET /calendar/day/{date}` | â€“ | `DayView` |
| `GET /calendar/week?start=` | â€“ | `{start, days: [{date, weekday, status, sitting, holiday_name, leave, blocks:[{id,label,start,end,color_key,listed,load_pct}], totals: DayTotals}]}` (7 days Monâ€“Sun starting at the Monday on/before `start`) |
| `GET /calendar/month?month=YYYY-MM` | â€“ | `{month, days: [{date, weekday, sitting, holiday_name, leave, status, listed, load_pct, old_cases, moved_forward}]}` |
| `POST /schedule/plan` | `{from?, to?, force?}` (defaults: today â†’ horizon end) | `PlanSummary` |
| `POST /schedule/publish` | `{from, to}` | `{days_published, hearings_published}` |
| `POST /schedule/unpublish` | `{date}` | `{date, status}` (409 if outcomes exist) |
| `GET /schedule/unscheduled` | â€“ | `{items: [CaseSummary & {earliest, reason}]}` |

## 8.4 Hearings
| Method + path | Request | Response |
|---|---|---|
| `POST /hearings/preview` | `{change: {type:"ADD"|"MOVE"|"REMOVE"|"PIN", hearing_id?, case_id?, to_date?, to_window_start?, pinned?}}` | `{kpi_deltas: Kpi[], days: [{date, load_pct_before, load_pct_after}], warnings: Warning[], message}` |
| `POST /hearings` | `{case_id, date, window_start?}` | `{hearing: HearingEvent, day_totals: DayTotals}` |
| `PATCH /hearings/{id}` | `{to_date?, to_window_start?, pinned?, force?}` | `{hearing: HearingEvent, affected_days: DayTotals[]}` (409 if PUBLISHED and no `force`) |
| `DELETE /hearings/{id}?force=` | â€“ | `{case: CaseSummary, suggestion: NextDateSuggestion|null}` |
| `POST /hearings/{id}/outcome` | `{result, reason_group?, disposal_type?, actual_start?, actual_end?, note?}` | `{hearing, case: CaseSummary, next_date: NextDateSuggestion|null, day_totals}` |
| `GET /hearings/{id}/next-date` | â€“ | `NextDateSuggestion` |
| `POST /hearings/{id}/next-date` | `{date?, accept_suggestion?, window_start?}` | `{next_hearing: HearingEvent}` |
| `POST /calendar/day/{date}/close` | â€“ | `{carried_forward, plan: PlanSummary, today}` |
| `POST /calendar/day/{date}/auto-outcomes` | `{seed?, agents?}` | `DayView` (now CLOSED). **Demo only.** |

Closing the day that equals `today` moves `today` to the next sitting day.
Recording outcomes is allowed only on PUBLISHED days (409 otherwise). Auto-outcomes publishes the day first if it is DRAFT.

## 8.5 Cases
| Method + path | Request | Response |
|---|---|---|
| `GET /cases?stage&bucket&status&q&ends_before&flag&sort&page&size` | `sort`: `age_desc` (default) \| `age_asc` \| `end_asc` \| `end_desc` \| `next_date` \| `case_number`. `page` starts at 1, `size` default 50 (max 500). `q` matches case number, filing number or advocate. | `{items: CaseSummary[], total, page, size}` |
| `GET /cases/{id}` | â€“ | `CaseDetail` |
| `GET /cases/forecast/summary` | â€“ | `{horizon_end, median_days_to_end, pct_ending_by_horizon, ending_by_month: [{month, count}], by_stage: [{stage, cases, median_days_to_end}]}` |

```ts
CaseDetail = CaseSummary & {
  filing_date, party_id, last_hearing_summary,
  lifecycle: [{stage, index, state: "DONE"|"CURRENT"|"UPCOMING"|"SKIPPED", hearings_so_far}],
  hearing_counts: {[type]: number},
  history: HearingEvent[],     // DONE, newest first
  upcoming: HearingEvent[],
  forecast: { how_it_ends, remaining_stages: [{stage, expected_hearings, expected_days}],
              projected_end: {p10, p50, p90}, prob_ends_by_horizon, explanation } | null
}
```

## 8.6 What-if
| Method + path | Request | Response |
|---|---|---|
| `POST /whatif` | `{ruleset_id? , rules?: RulesBody, preset?: string, compare_to: "ACTIVE"|"BASELINE"|number, horizon_days: 30|60|90, focus_date?, agents: boolean, runs?: 1..5}` (exactly one of ruleset_id / rules / preset) | `WhatIfResult` |
| `POST /whatif/{id}/apply` | `{from_date?, name?}` | `{active_ruleset: Ruleset, plan: PlanSummary, warnings}` |

```ts
WhatIfResult {
  id, rules_applied: RulesBody, compare_label, warnings: Warning[],
  focus_day: DayView, focus_day_compare: DayTotals,
  month: [{date, sitting, listed, load_pct, expected_moved_forward, old_cases, compare_listed, compare_load_pct}],
  kpis: Kpi[4], cost_sentences: string[] (â‰¤3),
  agents_effect: {show_rate_without, show_rate_with, sentence} | null,
  advocate_trips: {candidate, compare, sentence} | null
}
```
What-if results expire after 30 minutes (404 on apply).

## 8.7 Metrics
| Method + path | Request | Response |
|---|---|---|
| `GET /metrics/summary?from&to` | defaults: from = first roster day, to = today + 30 days | `{from, to, today, kpis: Kpi[4], weekly: [{week_start, moved_forward, court_time_pct, heard_on_promised_pct, is_forecast}], backlog_by_age: [{week_start, buckets: {"0-1","1-3","3-4","4-5","5+"}, is_forecast}], needs_attention: [{code, label, count, top: (CaseSummary & {why, suggested_action})[]}], cases_ending: {this_month, next_month}}` |
| `GET /metrics/scoring?from&to&source=actual|simulated` | default source `simulated` | `{source, from, to, metrics: [{key, label, value, unit, baseline, delta, better, tooltip}]}` keys: `utilisation, reach_rate, substantiveness, backlog_age_impact, predictability_days, next_date_sanity` |

needs_attention codes: `REPEAT_ADJOURNED, STUCK, AGEING_RISK, OLD_NOT_HEARD, WAITING_ON_PROCESS`.

## 8.8 Public
`GET /public/slot?case_no=` (case number or filing number) â†’
`{case_number, date, court_name, court_address, window_start, window_end, status: "SCHEDULED"|"RUNNING_LATE"|"IN_PROGRESS"|"DONE"|"NOT_LISTED_TODAY"|"NOT_SCHEDULED", eta, delay_minutes, queue_position, what_to_bring: string[], message_en, message_ml}` (404 if the case does not exist). Reads PUBLISHED hearings only; never returns party IDs.

## 8.9 Export
- `GET /export/cause-list.csv?date=` â†’ text/csv
- `GET /export/proposed_schedule.csv?from&to` â†’ text/csv

---

## v3.1 changes (scheduling redesign) â€” these win over anything above

1. **Every pending case has a date.** The planner schedules all pending cases, not just 20 days.
   - `DayStatus` gains **`TENTATIVE`**: sitting days beyond the 20-sitting-day draft horizon that the planner filled. They change automatically as the court runs.
   - `DRAFT` still means "inside the draft horizon".
   - `POST /schedule/publish` also publishes TENTATIVE days in range.
2. **Firm vs soft listings.**
   - Firm: published, NEXT_DATE, JUDGE, CARRY_FORWARD, pinned.
   - Soft: origin PLANNER on DRAFT/TENTATIVE days. Soft listings are re-planned after **every** change (outcome, next date, add/move/remove, leave, rules, settings, close day). Firm ones always win.
   - Hearing ids for soft listings stay stable per case.
   - New field `HearingEvent.tentative: boolean` = soft listing on a TENTATIVE day.
   - `CaseSummary.next_hearing` gains `tentative: boolean`.
3. **One slot per hearing (no shared windows).**
   - Each hearing has its own sequential slot: `window_start` = its start time (queue order), `window_end` = the start of the next slot (its share of expected time).
   - `est_start` == `window_start`. `est_end` = `est_start` + full duration if it goes ahead.
   - New `HearingEvent.queue_position` (1..n in the day's calling order).
   - `DayView.windows` is now one entry per hearing. Frontend: draw each hearing as its own event from `window_start` to `window_end` (give tiny events a minimum height), in queue order.
4. **Blocks are optional.**
   - The default (Optimal) rules have a single `all` block ("Full day"), with ordering short matters â†’ trial â†’ final and no reserved times. Draw block bands only when `blocks.length > 1`.
   - Judge presets (Sehgal, Dimakar, Joshi) keep their blocks.
   - New `HearingEvent.group`: `"SHORT" | "TRIAL" | "FINAL"`, for colouring chips.
5. **Mixed days.** The planner shares each day's minutes across SHORT/TRIAL/FINAL in proportion to the backlog, so a day is not all judgements.
6. `PlanSummary` gains `tentative_days`, `last_date` (the last date any case is scheduled) and `firm_hearings`. `unscheduled_count` is normally 0 or small: only cases waiting on process beyond the last planned day.
7. The month and week views return TENTATIVE days with listed/load like other days.
