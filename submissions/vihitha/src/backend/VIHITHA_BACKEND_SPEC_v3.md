# Vihitha: Backend Build Spec v3 (real schedule first, what-if second)

Keep `VIHITHA_BACKEND_SPEC.md` (v2) in the repo for the engine maths it defines. **This file wins on any conflict.** Tell Claude Code:

> Read `VIHITHA_BACKEND_SPEC_v3.md` (primary) and the v2 sections it references. Build milestone by milestone (section 11). Keep the layering rules. Nothing outside `submissions/<team-name>/`.

Items marked **[ASSUMPTION]** are configurable defaults and must be listed in `SUBMISSION.md`.

---

## 0. Why v3 (expert feedback at checkpoint 1)

| Feedback | v2 problem | v3 answer |
|---|---|---|
| "The whole thing feels like a simulation; I want my actual day." | Every API hung off `/simulate/{run_id}`. There was no persistent schedule, no publish, and no way to record what happened. | The **real schedule** (cases, hearings, days) is the core resource, stored in SQLite. Simulation is only used for what-if and forecasts. |
| "Google Calendar style day view." | Only lists and blocks. | Day/week/month calendar APIs return time-boxed events with real start and end times (section 3). |
| "One simulation screen." | Run, compare, preview and playback were separate. | One `POST /whatif` returns the chosen day, the next month and 4 KPIs vs current rules (section 8.6). |
| "Only useful metrics, on one page." | Six scores + extras + ranges. | 4 judge KPIs on one page; the official six stay in a separate scoring endpoint and the CLI (section 7.8). |
| "When does a case end?" | Not visible. | Every case carries a projected end date range and how it will end (section 4). |

What carries over from v2 unchanged: data loading (v2 Â§2), outcome maths (v2 Â§5.1, 5.4â€“5.6), rules/presets/guardrails (v2 Â§6.1â€“6.3), priority (v2 Â§6.4), next-date cost function (v2 Â§6.6), agents and learning (v2 Â§6.7â€“6.8), baseline (v2 Â§6.11), CLI and scoring metrics (v2 Â§7, Â§11).

---

## 1. Product model

```
Roster â”€â”€> Cases â”€â”€> PLAN (rules) â”€â”€> DRAFT days â”€â”€> PUBLISH â”€â”€> PUBLISHED days â”€â”€> RECORD OUTCOMES â”€â”€> CLOSED days
                                          â–²                                               â”‚
                                          â””â”€â”€â”€â”€ next dates, carry-forward, re-plan â—„â”€â”€â”€â”€â”€â”€â”˜
What-if: copy current state â†’ simulate with other rules â†’ show day + month + KPIs â†’ optionally APPLY
```

- **Case**: one roster row, living through the 11 stages until it ends.
- **Hearing**: one case listed on one date, in a time window, with a status.
- **Day**: a sitting date with status `DRAFT` (planner may change it), `PUBLISHED` (promised to parties; only explicit edits change it) or `CLOSED` (outcomes recorded).
- **Planning horizon**: the planner keeps the next **20 working days** planned (about a month; configurable). Anything beyond that is a forecast, not a schedule.
- **Today**: `DEMO_TODAY` (default `2026-09-24`). The demo can move "today" forward by closing days.

Hearing statuses: `DRAFT â†’ PUBLISHED â†’ DONE` (with a result), or `CANCELLED` (unlisted or moved).
Results: `MOVED_FORWARD`, `ADJOURNED` (+ reason group), `NOT_REACHED`, `DISPOSED` (+ disposal type).

---

## 2. What the data gives us, and where each part is used

There are **no clock times** in the data (no hearing start or end timestamps). What the data does give is how long each hearing type takes, how long until the next hearing, how many hearings each stage usually needs, and how likely each hearing is to move the case forward. From these we compute end times, next dates and case end dates.

| Hearing type | Minutes per hearing | Days to next hearing | Chance it moves forward | Expected hearings to clear stage (1 Ã· chance) | Median hearings per case (observed) |
|---|---|---|---|---|---|
| ADMISSION | 5 | 5 | 48.6% | 2.1 | 1 |
| DELAY_CONDONATION_HEARING | 5 | 5 | 29.3% | 3.4 | 3 |
| COGNIZANCE | 10 | 14 | 90.0% | 1.1 | 1 |
| APPEARANCE | 10 | 21 | 40.1% | 2.5 | 3 |
| WARRANT | 10 | 21 | 13.5% | 7.4 | 3 |
| PLEA | 15 | 14 | 90.0% | 1.1 | 1 |
| EXAMINATION_UNDER_S351_BNSS | 30 | 14 | 40.7% | 2.5 | 2 |
| EVIDENCE_COMPLAINANT | 30 | 14 | 29.4% | 3.4 | 5 |
| EVIDENCE_ACCUSED | 30 | 14 | 16.7% | 6.0 | 4 |
| ARGUMENTS | 30 | 14 | 13.0% | 7.7 | 3 |
| JUDGEMENT | 30 | 21 | 100% | 1.0 | 2 |
| BAIL | 15 | 14 | 31.3% | 3.2 | 2 |
| REPORTS | 10 | 45 | 8.3% | 12.0 | 3 |
| APPLICATION_REVIEW | 10 | 5 | 85.0% | 1.2 | 1 |

| Data | Used for |
|---|---|
| Minutes per hearing | **Event end times** on the calendar (`est_end = est_start + minutes`), window sizing, the 420-minute day budget |
| Days to next hearing | Next-date target; forecast of when each stage (and the case) ends; next-date sanity |
| Chance it moves forward | "Likely / Uncertain / Unlikely" hint on each event; expected minutes for packing; forecasts; what-if |
| Failure reasons | Adjournment reason choices in the outcome form; prerequisite holds (awaiting warrant/summons); what-if |
| Min/median/max hearings per case | "Stuck at stage" flags (more hearings at a stage than 2 Ã— median, or â‰¥ max); forecast sanity check |
| Roster hearing counts per type | How long a case has already been at its current stage; progress bar |
| Court calendar + leave | Sitting days only |

---

## 3. Time model (how the calendar gets real times)

- Court day **10:00â€“17:30**, lunch **13:30â€“14:00** = 420 minutes **[ASSUMPTION]**.
- **Blocks** come from the active rules (v2 Â§6.1), e.g. Optimal: 10:00â€“11:00 short matters, 11:00â€“13:30 evidence and plea, 14:00â€“17:30 arguments/judgement and 4+ year cases.
- **Slot windows**: each block is cut into windows of `window_minutes` (default **30**) **[ASSUMPTION]**. A window is the appointment given to parties ("be here 11:30â€“12:00").
- **Packing**: hearings go into windows in priority order. A window is full when the sum of **expected minutes** (v2 Â§5.4) reaches its length. This is how we "overbook" safely: likely adjournments are short, so a window can hold several.
- **Each hearing gets**:
  - `window_start`, `window_end`: the appointment shown to parties
  - `est_start`: running clock inside the window, using expected minutes of the hearings before it
  - `est_end = est_start + reference minutes` (the full hearing length if it goes ahead)
  - `expected_minutes`: used for day load
- **Calendar events**: the day view returns both **windows** (the Google-Calendar-style blocks, e.g. "11:30â€“12:00 Â· 4 hearings") and the **hearings** inside them. The frontend shows windows as events and expands them to show the hearings.
- **Actual times**: when an outcome is recorded, `actual_start`/`actual_end` are stored (entered, or taken from the demo auto-run).

---

## 4. When does a case end (forecast)

### 4.1 How a case ends
- **Judgement**: conviction or acquittal, after a JUDGEMENT hearing that goes ahead.
- **Settlement or withdrawal**: parties settle; chance per reached hearing = `settlement_prob` (default 2%) **[ASSUMPTION]**.
- **Dismissal**: complainant fails to take steps (recorded by the Court Master; not simulated by default).
Once any of these is recorded, the case is `DISPOSED` and gets no more hearings.

### 4.2 Projected end date
For each pending case, run **200 Monte Carlo paths** from its current stage (engine `forecast.py`):
- remaining stages = the sequence from the current stage to JUDGEMENT; skip DELAY_CONDONATION_HEARING and WARRANT unless the case is currently in them
- per stage: hearings needed ~ Geometric(chance it moves forward); days = hearings Ã— days-to-next-hearing
- settlement can end a path early
- start from the case's next scheduled date if it has one, else today
Output: `p10`, `p50` (most likely), `p90` end dates; `prob_ends_by_horizon`; and per remaining stage `{stage, expected_hearings, expected_days}`.
Cache per case; recompute when the case's stage or next date changes.

### 4.3 What this shows for the sample roster
Using only the organisers' tables, the typical case needs **about 7.5 months** to finish (median ~231 days from its current stage). Only **about 1 in 5** is likely to finish by 31 Dec. Low forward-movement rates for Arguments (13%) and Accused Evidence (17%) are the main drag. Say this to judges: it explains why "cases moved forward" matters more than "cases disposed" within a 3-month roster, and it points at where preparedness (case summaries) helps most.

---

## 5. Architecture and storage

Layering as in v2 Â§3: `api/routers` (HTTP only) â†’ `api/services` (orchestration) â†’ `vihitha/` engine (pure) + `api/repositories` (DB). Request/response models live only in `api/schemas`.

**Storage: SQLite via SQLAlchemy 2.0** (`state/vihitha.db`). v2 dropped the DB because everything was a simulation run; v3 has real, persistent schedule state, so the DB comes back. Create tables with `create_all()` on start; `POST /setup/reset` wipes and reseeds for demos. What-if results stay in memory (TTL 30 min).

New engine modules (in addition to v2's):
```
vihitha/windows.py     slot windows + packing into windows (section 3)
vihitha/forecast.py    case end forecast (section 4)
vihitha/kpis.py        the 4 judge KPIs (section 7.8)
vihitha/state.py       convert DB state <-> engine state (for planning and what-if)
```
New services: `schedule_service`, `hearing_service`, `case_service`, `whatif_service`, `metrics_service`, `setup_service`, `rules_service`, `public_service`, `export_service`.

---

## 6. Data model (tables)

**cases**: `id` (= filing_number), `case_number`, `filing_date`, `advocate_id`, `party_id`, `stage`, `next_purpose`, `status` (PENDING | DISPOSED), `disposal_type`, `disposed_on`, `hearing_counts_json`, `hearings_at_stage`, `consecutive_adjourned`, `pending_until`, `last_chance`, `accused_seen`, `show_alpha`, `show_beta`, `last_hearing_summary`, `forecast_json`, `forecast_at`

**hearings**: `id`, `case_id`, `date`, `hearing_type`, `block_id`, `window_start`, `window_end`, `est_start`, `est_end`, `duration_min`, `expected_minutes`, `p_substantive`, `reason`, `status` (DRAFT | PUBLISHED | DONE | CANCELLED), `result`, `reason_group`, `disposal_type`, `actual_start`, `actual_end`, `first_promised_date`, `pinned`, `carried_forward`, `origin` (PLANNER | JUDGE | NEXT_DATE | CARRY_FORWARD), `created_at`, `note`

**days**: `date` PK, `status` (DRAFT | PUBLISHED | CLOSED), `ruleset_id`, `published_at`, `closed_at`

**rulesets**: `id`, `name`, `preset`, `body_json`, `is_active`, `created_at`, `updated_at`

**leave**: `date` PK, `note`

**settings**: `key` PK, `value_json` (roster source/seed, horizon_working_days, window_minutes, today)

Invariants:
- A pending case has **at most one** future hearing with status DRAFT or PUBLISHED.
- PUBLISHED hearings are only changed by an explicit edit with `force=true`.
- Nothing is ever placed on a non-sitting day.

---

## 7. Core logic (services; no HTTP here)

### 7.1 Load roster (`setup_service.load_roster`)
Normalise and parse as in v2 Â§2 and Â§5.3; insert cases. If a schedule exists and `reset` is not true â†’ `Conflict`. Then run `plan_range(today, today + horizon)`.

### 7.2 Plan (`schedule_service.plan_range(from, to, force=False)`)
1. Load active rules; validate guardrails (v2 Â§6.3).
2. For each sitting day in range with status DRAFT: cancel its non-pinned DRAFT hearings (their cases return to the pool). PUBLISHED and CLOSED days are untouched unless `force`.
3. Pool = pending cases with no future DRAFT/PUBLISHED hearing. For each, `earliest` = max(today, pending_until if prerequisite_check, last hearing date + reference gap).
4. Sort the pool by priority (v2 Â§6.4). For each case, pick a date with the next-date cost function (v2 Â§6.6) restricted to the range; if no day fits, leave it unscheduled (it appears in "Not yet scheduled").
5. For each day: pack into blocks and windows (section 3), set times, reasons and `first_promised_date` (= the date, for new listings).
6. Return `PlanSummary {days_planned, hearings_created, unscheduled_count, warnings}`.
Deterministic (tie-break on case id).

### 7.3 Publish / unpublish
`publish(from, to)`: DRAFT â†’ PUBLISHED for days and their hearings; return counts. `unpublish(date)`: only if no hearing on that date has an outcome.

### 7.4 Edit with impact preview (`hearing_service`)
Changes: `ADD {case_id, date, window_start?}`, `MOVE {hearing_id, to_date?, to_window_start?}`, `REMOVE {hearing_id}`, `PIN {hearing_id, pinned}`.
- `preview(change)`: copy state, apply, re-pack affected days, run a 30-day what-if with the same seed for both versions, and return the 4 KPI changes, affected-day load before/after, guardrail warnings and a sentence (e.g. "Day load 104% â†’ 96%; 1 case over 4 years pushed past its 30-day limit").
- `apply(change, force)`: persist; re-pack affected days; REMOVE sends the case back to the pool with a suggested date. Editing a PUBLISHED hearing needs `force=true`.

### 7.5 Record outcome (`hearing_service.record_outcome`)
Input: result, reason group or disposal type, optional actual times.
- MOVED_FORWARD â†’ advance the stage (v2 Â§5.6), reset counters
- ADJOURNED â†’ counters +1; PROCESS reason sets `pending_until` (v2 Â§5.6)
- NOT_REACHED â†’ handled at day close (carry-forward)
- DISPOSED â†’ case DISPOSED; cancel future hearings
- update the show-up estimate (v2 Â§6.8), hearing counts, and the case forecast
- return the next-date suggestion (v2 Â§6.6) unless disposed or not reached

`confirm_next_date(hearing_id, date?)` creates the case's next hearing (origin NEXT_DATE) on a sitting day, packs it into a window, and re-packs that day. If the day is PUBLISHED, the hearing is published too.

### 7.6 Close day and demo auto-run
`close_day(date)`: every hearing without a result becomes NOT_REACHED and is carried forward (Sehgal: same weekday next week; others: earliest day with room plus a priority boost; `first_promised_date` is kept). Day â†’ CLOSED. Then `plan_range` tops up the horizon.

`auto_outcomes(date, seed, agents)` (**demo only**, labelled in the UI): walk the day's hearings in time order with the engine's day runner (v2 Â§6.10), write results and actual times, auto-confirm next dates, then close the day. This lets the demo move a week forward in seconds.

### 7.7 What-if (`whatif_service.run`)
Input: rules (ruleset id or inline body), `compare_to` (ACTIVE | BASELINE | ruleset id), `horizon_days` (30 | 60 | 90), `focus_date`, `agents`, `runs` (default 3).
1. Snapshot the current DB state (cases, published and closed hearings are fixed facts).
2. For each rule set (candidate and comparison): re-plan the DRAFT part with those rules, then simulate forward over the horizon with the engine (same seeds for both).
3. Return: the planned **focus day** (same shape as the day view), a **month strip** (per sitting day: listed, load %, expected moved-forward, 4+ year cases), the **4 KPIs** with comparison values and deltas, up to 3 plain-English cost sentences, guardrail warnings, and the agents effect if agents are on.
`apply(whatif_id, from_date)`: save the rules as a ruleset if inline, make it active, and `plan_range(from_date, horizon, force=False)`.

### 7.8 KPIs (`vihitha/kpis.py`)
The judge sees **4**:

| KPI | Definition | Official metric it covers |
|---|---|---|
| **Cases moved forward** | Hearings that moved the case forward, per week (and Ã· hearings reached) | Substantiveness |
| **Old cases heard** | % of cases 4+ years old heard at least once in the period (+ count) | Backlog-age impact |
| **Court time used** | Minutes of hearings Ã· 420 per sitting day (good band 85â€“100%) | Utilisation |
| **Heard on promised date** | % of hearings reached on their first promised date | Predictability |

For past days they use recorded outcomes; for future days, simulated values (marked "forecast"). The official six (adding reach rate and next-date sanity) are served by `/metrics/scoring` and printed by the CLI (v2 Â§7).

### 7.9 Insights ("Needs attention", top 5 each with a count)
- **Repeat adjournments**: 3+ in a row
- **Stuck at stage**: more hearings at the stage than 2 Ã— median, or â‰¥ max
- **Ageing risk**: crosses into 4+ or 5+ years within 30 days and isn't scheduled before then
- **Old case not heard in 30 days**: guardrail breach risk
- **Waiting on process**: `pending_until` passed but not yet re-listed
Each item has the case, a reason and a suggested action (v2 Â§8).

---

## 8. API contracts (request/response only; logic is in section 7)

Base `/api/v1`. Dates `YYYY-MM-DD`, times `HH:MM`. `case_id` = filing_number (URL-encoded). Errors use v2's `ErrorBody` (404, 409, 422). Each endpoint names the service function its router calls.

### 8.0 Shared schemas
```
HearingEvent {
  hearing_id, case_id, case_number, title,                 # "ST/48/2021 Â· Warrant"
  hearing_type, stage, age_years, age_bucket, advocate_id,
  date, block_id, window_start, window_end, est_start, est_end,
  duration_min, expected_minutes,
  likelihood: "LIKELY"|"UNCERTAIN"|"UNLIKELY", p_substantive,   # â‰¥0.6 / 0.3â€“0.6 / <0.3
  reason, status, pinned, carried_forward, first_promised_date,
  result: {result, reason_group, disposal_type, actual_start, actual_end} | null,
  flags: ["OLD_CASE", "REPEAT_ADJOURNED", "STUCK", "PROCESS_PENDING", ...]
}
Window { start, end, block_id, hearing_ids: [int], expected_minutes, capacity_minutes }
Block  { id, label, start, end, color_key }
DayTotals { listed, expected_minutes, capacity_minutes, load_pct, old_cases,
            moved_forward, adjourned, not_reached }            # last three only for CLOSED days
Kpi { key, label, value, unit, compare_value, delta, better: bool, is_forecast: bool }
Warning { field, requested, applied, message }
CaseSummary { case_id, case_number, stage, next_purpose, status, age_years, age_bucket,
              advocate_id, next_hearing: {date, window_start, window_end} | null,
              projected_end: {p10, p50, p90} | null, flags }
```

### 8.1 Health and setup
| Method + path | Request | Response | Service |
|---|---|---|---|
| `GET /health` | â€“ | `{status, db, today, roster_loaded, active_ruleset}` | inline |
| `POST /setup/roster` | multipart or JSON `{source: SAMPLE|GENERATE|UPLOAD, n?, seed?, file?, reset?: bool}` | `{roster: RosterSummary, plan: PlanSummary}` | `setup_service.load_roster` |
| `GET /setup/roster/summary` | â€“ | `RosterSummary {cases, advocates, pct_4y_plus, pct_5y_plus, by_stage, by_bucket, source, seed}` | `setup_service.roster_summary` |
| `GET /setup/reference` | â€“ | the table in section 2 plus failure reasons and "real/estimated" source tags | `setup_service.reference` |
| `GET /setup/calendar?from&to` | â€“ | `{days: [{date, weekday, sitting, holiday_name, leave, leave_note}]}` | `setup_service.calendar` |
| `POST /setup/leave` | `{date, note?}` | `{date, hearings_moved, published_hearings_affected}` | `setup_service.add_leave` (re-plans draft days; published ones listed for review) |
| `DELETE /setup/leave/{date}` | â€“ | 204 | `setup_service.remove_leave` |
| `GET /setup/settings` / `PUT /setup/settings` | `{horizon_working_days, window_minutes, today}` | same | `setup_service.settings` |
| `POST /setup/reset` | `{confirm: true}` | 204 | `setup_service.reset` |

### 8.2 Rules
| Method + path | Request | Response | Service |
|---|---|---|---|
| `GET /rules/presets` | â€“ | `{presets: [{id, name, description, rules, warnings}]}` | `rules_service.presets` |
| `GET /rulesets` | â€“ | `{items: [{id, name, preset, is_active, updated_at}]}` | `rules_service.list` |
| `POST /rulesets` | `{name, rules}` | `{ruleset, warnings}` | `rules_service.create` |
| `GET /rulesets/{id}` | â€“ | `{ruleset}` | `rules_service.get` |
| `PUT /rulesets/{id}` | `{name?, rules}` | `{ruleset, warnings}` | `rules_service.update` |
| `DELETE /rulesets/{id}` | â€“ | 204 (409 if active) | `rules_service.delete` |
| `PUT /rules/active` | `{ruleset_id, replan_from?: date}` | `{active, plan: PlanSummary, warnings}` | `rules_service.activate` |

### 8.3 Calendar and schedule
| Method + path | Request | Response | Service |
|---|---|---|---|
| `GET /calendar/day/{date}` | â€“ | `DayView {date, status, sitting, holiday_name, leave, day_start, day_end, lunch: [start, end], blocks: [Block], windows: [Window], hearings: [HearingEvent], totals: DayTotals, held_back: [{case_id, case_number, hearing_type, reason, eligible_from}]}` | `schedule_service.day` |
| `GET /calendar/week?start=` | â€“ | `{days: [{date, status, sitting, holiday_name, leave, blocks: [{id, label, start, end, listed, load_pct}], totals: DayTotals}]}` | `schedule_service.week` |
| `GET /calendar/month?month=YYYY-MM` | â€“ | `{days: [{date, sitting, holiday_name, leave, status, listed, load_pct, old_cases, moved_forward?}]}` | `schedule_service.month` |
| `POST /schedule/plan` | `{from, to, force?: bool}` | `PlanSummary` | `schedule_service.plan_range` |
| `POST /schedule/publish` | `{from, to}` | `{days_published, hearings_published}` | `schedule_service.publish` |
| `POST /schedule/unpublish` | `{date}` | `{date, status}` (409 if outcomes exist) | `schedule_service.unpublish` |
| `GET /schedule/unscheduled` | â€“ | `{items: [CaseSummary + {earliest, reason}]}` | `schedule_service.unscheduled` |

### 8.4 Hearings
| Method + path | Request | Response | Service |
|---|---|---|---|
| `POST /hearings/preview` | `{change: {type: ADD|MOVE|REMOVE|PIN, hearing_id?, case_id?, to_date?, to_window_start?, pinned?}}` | `{kpi_deltas: [Kpi], days: [{date, load_pct_before, load_pct_after}], warnings, message}` | `hearing_service.preview` |
| `POST /hearings` | `{case_id, date, window_start?}` | `{hearing: HearingEvent, day_totals}` | `hearing_service.add` |
| `PATCH /hearings/{id}` | `{to_date?, to_window_start?, pinned?, force?}` | `{hearing, affected_days: [DayTotals]}` | `hearing_service.move` |
| `DELETE /hearings/{id}?force=` | â€“ | `{case: CaseSummary, suggestion: NextDateSuggestion}` | `hearing_service.remove` |
| `POST /hearings/{id}/outcome` | `{result, reason_group?, disposal_type?, actual_start?, actual_end?, note?}` | `{hearing, case: CaseSummary, next_date: NextDateSuggestion | null, day_totals}` | `hearing_service.record_outcome` |
| `GET /hearings/{id}/next-date` | â€“ | `NextDateSuggestion` | `hearing_service.suggest_next_date` |
| `POST /hearings/{id}/next-date` | `{date?: date, accept_suggestion?: bool, window_start?}` | `{next_hearing: HearingEvent}` | `hearing_service.confirm_next_date` |
| `POST /calendar/day/{date}/close` | â€“ | `{carried_forward: int, plan: PlanSummary}` | `schedule_service.close_day` |
| `POST /calendar/day/{date}/auto-outcomes` | `{seed?, agents?: bool}` | `DayView` (CLOSED) | `schedule_service.auto_outcomes` (**demo**) |

`NextDateSuggestion = {suggested: {date, window_start, window_end, reason}, alternatives: [{date, reason}], window: {min, target, max}, vs_flat_default_days, heatmap: [{date, sitting, load_pct}] (42 days)}`

### 8.5 Cases
| Method + path | Request | Response | Service |
|---|---|---|---|
| `GET /cases?stage&bucket&status&q&ends_before&flag&sort&page&size` | â€“ | `{items: [CaseSummary], total}` | `case_service.list` |
| `GET /cases/{id}` | â€“ | `CaseDetail` (below) | `case_service.detail` |
| `GET /cases/forecast/summary` | â€“ | `{median_days_to_end, pct_ending_by_horizon, ending_by_month: [{month, count}], by_stage: [{stage, median_days_to_end}]}` | `case_service.forecast_summary` |

```
CaseDetail = CaseSummary + {
  filing_date, party_id, last_hearing_summary,
  lifecycle: [{stage, index, state: "DONE"|"CURRENT"|"UPCOMING"|"SKIPPED", hearings_so_far}],
  hearing_counts: {type: int},
  history: [HearingEvent (DONE)], upcoming: [HearingEvent],
  forecast: {
    how_it_ends: "Judgement after Arguments, or earlier settlement/withdrawal",
    remaining_stages: [{stage, expected_hearings, expected_days}],
    projected_end: {p10, p50, p90}, prob_ends_by_horizon, explanation
  }
}
```

### 8.6 What-if (the single simulation screen)
| Method + path | Request | Response | Service |
|---|---|---|---|
| `POST /whatif` | `{ruleset_id? | rules?, compare_to: "ACTIVE"|"BASELINE"|<ruleset_id>, horizon_days: 30|60|90, focus_date, agents: bool, runs?: 1..5}` | `WhatIfResult` (below) | `whatif_service.run` |
| `POST /whatif/{id}/apply` | `{from_date?, name?}` | `{active_ruleset, plan: PlanSummary, warnings}` | `whatif_service.apply` |

```
WhatIfResult {
  id, rules_applied, warnings: [Warning],
  focus_day: DayView,                                   # planned under the candidate rules
  focus_day_compare: DayTotals,                         # same day under compare_to
  month: [{date, sitting, listed, load_pct, expected_moved_forward, old_cases,
           compare_listed, compare_load_pct}],
  kpis: [Kpi x4], cost_sentences: [str] (max 3),
  agents_effect: {show_rate_without, show_rate_with, sentence} | null
}
```

### 8.7 Metrics (the single metrics page)
| Method + path | Request | Response | Service |
|---|---|---|---|
| `GET /metrics/summary?from&to` | â€“ | `{kpis: [Kpi x4], weekly: [{week_start, moved_forward, court_time_pct, heard_on_promised_pct, is_forecast}], backlog_by_age: [{week_start, buckets: {"0-1","1-3","3-4","4-5","5+"}, is_forecast}], needs_attention: [{code, label, count, top: [CaseSummary + {why, suggested_action}] (5)}], cases_ending: {this_month, next_month}}` | `metrics_service.summary` |
| `GET /metrics/scoring?from&to&source=actual|simulated` | â€“ | the six official metrics with baseline values (v2 Â§7) | `metrics_service.scoring` |

### 8.8 Public (contract unchanged; now reads the real schedule)
`GET /public/slot?case_no=` â†’ `{case_number, date, court_name, court_address, window_start, window_end, status: "SCHEDULED"|"RUNNING_LATE"|"IN_PROGRESS"|"DONE"|"NOT_LISTED_TODAY", eta, delay_minutes, queue_position, what_to_bring, message_en, message_ml}` â†’ `public_service.slot`
Reads **PUBLISHED hearings only**. With no published hearing: "Your next date will be announced". ETA comes from `est_start` (or from actual times if the day is running).

### 8.9 Export
| Method + path | Response | Service |
|---|---|---|
| `GET /export/cause-list.csv?date=` | one day, sorted by window: `Case Number, Filing Number, Hearing Type, Hearing Date, window_start, window_end, est_start, est_end, advocate_id, case_age_years, reason, status` | `export_service.cause_list` |
| `GET /export/proposed_schedule.csv?from&to` | all hearings in range, same columns (the submission file) | `export_service.proposed_schedule` |

---

## 9. Frontend changes (for the frontend prompt)

Navigation shrinks to **5 screens + public page**:

1. **Calendar (home)**: Google-Calendar-style **Day / Week / Month** toggle.
   - Day: time axis 10:00â€“17:30, lunch band, block colours as background bands, **windows as events** ("11:30â€“12:00 Â· 4 hearings"). Expand a window to see hearing chips (case number, type, age chip, likelihood dot). Drag a chip to another window or day â†’ impact preview banner â†’ Apply. Top bar: day status (Draft/Published/Closed), **Publish**, **Export**. Right panel: "Held back" and "Not yet scheduled".
   - Court Master mode on a day: each chip gets outcome buttons (Moved forward / Adjourned â–¸ reason / Not reached / Disposed â–¸ type), which then open the next-date panel. Buttons "Close day" and "Auto-run day (demo)".
   - Week: columns per day with block bands and counts. Month: grid with load % colour, counts, holidays and leave.
   - APIs: 8.3, 8.4
2. **What-If** (one screen): left = preset/ruleset picker + 5 key controls (fill %, ageing quota, advocate clustering, carry-forward, prerequisite check), horizon (30/60/90), agents toggle, compare-to. Right = the focus day as a mini day calendar, a month strip below it, the 4 KPI cards with deltas, and cost sentences. One button: **Apply these rules**. API 8.6
3. **Cases**: searchable list with a "Likely to finish" column and a filter; the case drawer shows the lifecycle bar, history, the next hearing and the **"How and when this case ends"** card (p10â€“p90 range + remaining stages). API 8.5
4. **Metrics**: one page: 4 KPI cards, weekly trend (actual solid, forecast dashed), backlog-by-age chart, "Needs attention" lists, cases ending this and next month. The official scoring numbers sit in a collapsed "Hackathon scoring" section. API 8.7
5. **Settings**: roster, calendar and leave, rulesets (full rule editor lives here), reference data, reset demo. APIs 8.1, 8.2
6. **Public slot**: unchanged. API 8.8

Remove as separate screens: Dashboard, Compare Scenarios, Day Playback, Docket Health, Advocates. Their useful parts moved: comparison â†’ What-If; playback â†’ "Auto-run day" on the calendar; docket health â†’ Needs attention; advocate trips â†’ one KPI sentence on What-If when clustering changes.

---

## 10. CLI (unchanged role)
Keep v2 Â§4 and Â§11 commands (`generate-roster`, `run`, `compare`). The CLI runs the engine without the DB and prints the six official metrics. Add `Vihitha plan --roster ... --from ... --days 20 --out cause_list.csv` that uses the same planner as the API.

---

## 11. Milestones
| # | Milestone | Done when |
|---|---|---|
| M1 | DB models, repositories, setup APIs (roster, calendar, leave, reference, settings, reset) | Sample roster loads; calendar returns sitting days |
| M2 | Windows + planner (`plan_range`), rules/rulesets/presets/activate | `POST /schedule/plan` fills 20 working days; guardrails hold |
| M3 | Calendar day/week/month, publish/unpublish, export | Frontend calendar shows real events with start/end times |
| M4 | Hearing edits with preview, outcomes, next date, close day, auto-outcomes | A demo week can be run forward from the calendar |
| M5 | Forecast + cases APIs | Every case shows "ends between X and Y" |
| M6 | What-if + apply | One screen compares rules and applies them |
| M7 | Metrics summary + scoring, public slot on published data | Metrics page and public page work |
| M8 | CLI parity check, `SUBMISSION.md`, final `proposed_schedule.csv` | Fresh clone runs; numbers match between CLI and API for the same seed |

Minimum demo path if time is short: M1 â†’ M2 â†’ M3 â†’ M4 (auto-outcomes) â†’ M6.

---

## 12. Tests
- Planner: nothing on non-sitting days; one future hearing per pending case; day expected minutes â‰¤ 420 Ã— fill target (except guardrail escalations); deterministic.
- Windows: every hearing sits inside its window; `est_end = est_start + duration`; windows never cross lunch.
- Publish: planning never changes PUBLISHED hearings without `force`.
- Outcomes: MOVED_FORWARD advances the stage; DISPOSED cancels future hearings; NOT_REACHED is carried forward at close with `first_promised_date` kept.
- Forecast: a case at JUDGEMENT has p50 â‰¤ its next date + a few days; an earlier stage gives a later p50; results are reproducible with a seed.
- What-if: the DB is unchanged after `POST /whatif`; `apply` changes only DRAFT days.
- Public: returns only PUBLISHED hearings; never returns party IDs.
- API smoke: load â†’ plan â†’ day â†’ publish â†’ outcome â†’ next date â†’ close â†’ what-if â†’ metrics â†’ export, all 2xx.
