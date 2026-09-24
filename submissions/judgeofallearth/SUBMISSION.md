# Submission: judgeofallearth

## 1. Team

- **Team / solo name:** judgeofallearth
- **Members:** Akshit Tyagi (solo)
- **Complexity level claimed:** **L2**. It has a full rule-based planner (L1), plus an adaptive planner with a per-case prediction model, distributions, costs and constraints, knob sweeps and scheduling styles, and an app that forecasts the impact of any override before the Judge applies it. See §4.

## 2. One-line summary

A test bench and a scheduler. The scheduler lists only **ready** cases, **protects old cases**, **packs each day to an 80% chance of fitting in 420 minutes**, gives everyone a **1-hour slot** and an **outcome-based next date**. The bench scores it against today's court on identical simulated reality, with 95% confidence intervals.

## 3. The approach

**In plain language.** Three parts that never mix:

1. **Planner.** It runs a *strategy* and sees only what a real court would know before the day.
2. **Simulated court.** It plays each causelist out using the organisers' real odds. Outcomes are **pre-drawn per case and per appearance**, so every strategy faces the same reality (paired seeds).
3. **Scorecard.** The five brief metrics, each paired with a **counter-metric** so gaming shows up, plus case-life measures.

**Inputs.**
- `roster_sample_100.csv`, scaled to 3,000 by our port of the organisers' bootstrap generator (`src/courtsched/data.py::generate_roster`). There's also an optional **lopsided** advocate distribution (ours, labelled).
- `court_calendar.csv`: posting 1 Oct – 15 Dec 2026, 51 sitting days. Judge leave is a parameter.
- `hearing_type_reference.csv`: durations, gaps, hearings per case.
- `substantiveness_by_hearing_type.csv`: die 1.
- `hearing_failure_reasons.csv`: adjournment reasons, and the share of hearings lost to outstanding process.

**Core logic (the rule-based planner), each sitting day:**
1. **Carry-overs first.** Unreached cases from the last day lead, so nobody is bumped twice.
2. **Readiness gate.** A case whose summons or warrant hasn't returned is not listed. DRISTI already tracks e-post and police returns.
3. **Old-case guarantee.** 4+ year cases get at least 30% of minutes. A ready old case waiting more than 10 sitting days pre-empts, up to 60% of the day. Judges can raise these, never lower them.
4. **Cases due today.** These are dates we promised. Next dates are only promised on days with room left in a 35% "promised" budget, so promises are kept.
5. **Ranked fill.** Score = P(substantive | ready) ÷ minutes × (1 + 0.25 × age in years), a cμ-style index. There's a mild bonus for advocates already listed that day.
6. **Pack to the fill level.** Keep adding while `E[minutes] + z₀.₈·σ ≤ 420`. An adjournment takes about 2 minutes.
7. **Order and slot.** Priority order, each advocate's matters together, and a 1-hour slot per advocate group.
8. **Next date from what happened:**
   - moved on → the next type's gap;
   - same stage → the same gap;
   - absent or sought time → 7 days;
   - awaiting process → listed when it's back.

**The adaptive planner = the rule-based planner + a small per-case prediction model.** (This is what earns the L2 claim.)
- Real courts aren't uniform: some parties keep missing hearings. In the simulated court, each case has a hidden reliability offset on the log-odds, correlated with how adjournment-heavy its history is. That history is public: hearings so far vs typical for its stage.
- The planner never sees the hidden offset. It starts from the type's odds shifted by the case's history (the prior), then applies a one-step empirical-Bayes update on the log-odds after every appearance.
- It uses the estimate to size the day (expected minutes) and to space hearings: an absent party with low estimated odds gets 14 days, not 7.
- **Fairness guard:** by default the estimate does **not** rank cases, so an unreliable party is never pushed down the queue. Ranking by it is a switch, and its cost is shown (§5).

**Current practice (the yardstick):** about 30 listed per day in due order, a flat 60-day next date, no process knowledge.

**Key decisions:**
- **Two dice.** The organisers' substantive rate and their hearings-per-stage figures **don't agree** under the brief's definition. Evidence Complainant is 29% substantive, which implies about 3.4 hearings, but the table says 6.8. Judgement is 100% substantive, which implies 1, but the table says 3.6. We keep *substantive* as published (die 1, which is what's scored) and add *stage advance | substantive* (die 2). Die 2 is calibrated so that listing blindly reproduces the published mean hearings per stage exactly. This is tested in `test_stage_calibration_matches_table`.
- **Process is modelled separately from other failures.** For each type, P(substantive | ready) = p_sub ÷ (1 − share of hearings lost to process). So a court that lists blindly reproduces the published rate.
- **Everything is a named parameter** of a `Scenario` (the world) or a `Strategy` (the planner). An experiment is scenarios × strategies × seeds.

**Assumptions (explicit):**
- An adjournment takes 2 minutes.
- Process return delay is exponential with mean 21 days.
- **Preparation ramp:** listing sooner than the published gap scales P(substantive) from 0.2 up to 1.
- Durations are fixed at the table values by default, with lognormal CV 0.5 as a scenario.
- The court opens at 10:00 and reaches listings in order until 420 minutes are used.
- The data comes from a district magistrate s.138 court. We treat it as the brief's High Court scheduling problem.

## 4. Justify your complexity level

- **L1 (fixed behaviour):** the rules above (`src/courtsched/strategies.py::RulePlanner`), the app's "How it was built" page, and a sample causelist with a "why listed" column (`results/causelist_2026-10-01.csv`).
- **L2 (dynamic + realistic data):**
  - **Distributions.** Substantive, stage-advance, adjournment-reason, process-return and duration draws all come from the organisers' tables. Duration spread is a scenario (`duration_cv`).
  - **Costs, constraints and incentives.** The readiness gate, the old-case guarantee as a hard floor, the promised-date budget, the preparation-ramp cost of listing too soon, and advocate grouping.
  - **Judge overrides with visible impact.** Every rule is a knob. `results/index.html` (run `uv run courtsched`) sweeps them, and the app's Rules & options page forecasts any change before the Judge adopts it: fill level, old-case share, spacing, process tracking, grouping, and world assumptions. It also includes the brief's three judge styles as presets, side by side.
  - **A small prediction model in the scheduling logic.** L2's per-case odds (empirical Bayes). It's tested (`test_l2_learns_from_outcomes`) and evaluated in three worlds: identical cases, heterogeneous (default), and a strong history signal.
  - **The schedule changes with new information.** Carry-overs and outcome-driven next dates re-plan every day.
  - **L3 is not built.** See §8.

## 5. Results

3,000 cases, 51 sitting days, **10 paired seeds**, mean ± 95% CI (regenerate with `uv run courtsched`):

| Metric | Current practice | Rule-based | **Adaptive** |
|---|---|---|---|
| **Utilisation** | 70.2% ± 1.1 | 93.6% | **94.6% ± 0.4** |
| **Reach rate** | 99.9% | 99.2% | 99.4% ± 0.2 |
| **Substantiveness** | 44.5% ± 0.6 | 66.7% | **65.8% ± 0.7** |
| **Backlog-age: 4+ yr cases heard** | 51.4% ± 0.9 | 72.5% | **74.5% ± 2.2** |
| **Predictability** (days late vs first scheduled) | 0.00 | 0.08 | 0.07 ± 0.02 |
| Counter: substantive hearings / day | 13.4 | 20.1 | **20.3** |
| Counter: 4+ yr cases *advanced* a stage | 13.9% | 25.0% | **25.2%** |
| Case life: appearances per stage advance | 3.10 | 2.27 | 2.28 |
| Case life: projected days to disposal | 1,319 ± 95 | 729 | **739 ± 74** |
| Listings wasted on pending process / day | 0.98 | 0 | **0** |
| Slot kept (called within the 1-hour slot) | n/a | 78.0% | 76.9% |
| Idle minutes / day | 125 | 27 | **23** |
| Disposals in the posting | 51 | 110 | **111** |
| Fairness: adjournment-heavy cases heard | 50.6% | 40.6% | 41.2% |
| Fairness: adjournment-heavy cases **advanced** | 11.9% | 15.2% | **15.4%** |

**Scheduling styles modelled on the brief's three judges (§4), on the adaptive planner** (5 seeds):

| Style | Substantive | 4+ yr heard | 4+ yr advanced | App./advance | Trips/case | Proj. days |
|---|---|---|---|---|---|---|
| Current practice | 45% | 51% | 13% | 3.16 | 0.99 | 1,379 |
| **Balanced (ours)** | 65% | 76% | 25% | 2.29 | 0.87 | 731 |
| Quick wins first (Joshi) | **71%** | 33% | 18% | **2.02** | 0.80 | 828 |
| Oldest first (Sehgal) | 59% | **98%** | **30%** | 2.83 | 0.90 | **603** |
| Batch by advocate (Dimakar) | 64% | 77% | 26% | 2.43 | **0.77** | 651 |

There's no single winner. Easy-first (Joshi) tops "substantive" while old cases fall 40 points behind, which is Goodhart's law in action. Oldest-first clears the backlog but wastes appearances. Ours sits in the middle, and each style is one setting away.

**The per-case model (adaptive planner), in three worlds:**
- **Identical cases:** no gain, as expected. The model has nothing to learn.
- **Heterogeneous and strong-signal worlds:** small gains in old cases heard (+2 points) and in projected days (strong signal: 988 → 848).
- **Letting the model rank cases** buys the most efficiency (substantive 68.7%, 20.8 per day), but cuts adjournment-heavy cases heard from 40% to 24%. That's the fairness cost, made visible, and why it's off by default.

**A fairness finding we didn't expect.** Both our planners *list* adjournment-heavy cases less often than current practice (41% vs 51%), yet *advance* more of them (15% vs 12%). Current practice "hears" them by listing them while their warrant is still out. A general anti-starvation rule (any case waiting more than 20 sitting days) only lifted hearing to 42%, and cost about 1 substantive hearing a day. It's available as a setting, off by default.

**What the experiments show** (5 seeds each; charts in `results/index.html` after `uv run courtsched`):
- **Process tracking is the biggest single lever.** With it off, the same rule-based planner hears 43% of old cases instead of 74%, and wastes 3.2 listings a day.
- **Fill level** trades utilisation (97% at a 50% fill level) against reach and slot-keeping. 80% is a balanced default.
- **Old-case share.** 0–30% barely changes anything, because the age term in the ranking already favours old cases. At 45%, 90% of old cases are heard, at a cost of about 5 points of substantiveness.
- **Advocate grouping.** On a lopsided (realistic) caseload it cuts trips per case by 28% (0.63 → 0.45), but slot-keeping drops (68% → 57%). That's a real trade-off, left to the judge.
- **Spacing.** Stretching gaps ×2 spreads capacity across more cases: more old cases heard and more advances, but a longer projected time to disposal for each case. Halving them does the reverse.
- **Assumption sensitivity.** Reading "substantive = next stage" literally gives about 50% more stage advances. Our data fix matters, and we say so. Random durations (CV 0.5) cut slot-keeping to 58%, which is the next thing to fix (§8).
- **Honest caveat.** With the organisers' durations, today's 30 listings use only about 68% of 420 minutes, so the simulated baseline never runs out of time (reach 100%). The case study's "30 → 10" comes mostly from absence and unreadiness, which our model counts as reached but not substantive.

**What a judge can decide from the page:**
- how full to pack a day;
- how much time to guarantee old cases;
- whether to group advocates;
- the value of process tracking.

Each of these shows its cost next to its benefit.

## 6. Specs for integration

**Input schema:** the organisers' CSVs, unchanged (`data/`). The roster needs `case_number, filing_date, advocate_id, current_stage, purpose_of_next_hearing, total_hearings_held`. For live use, add a **process status** per case (outstanding / returned + date), which DRISTI already tracks through e-post and police integration.

**Outputs:**
- `proposed_schedule.csv`: every listing across the posting: `hearing_date, order, slot_start, case_number, advocate_id, hearing_purpose, age_4plus, why_listed, expected_minutes` plus simulated outcome columns (`sim_*`, `next_gap_days`) for evaluation.
- `causelist_<date>.csv`: one day's list, the shape a court master uses.
- `scorecard.csv` and `index.html` (every experiment, mean and CI) and `settings.json`, written by `uv run courtsched`.
- `model_story.json`: each rule's measured effect, one step at a time (`uv run courtsched-story`).

**Interfaces:**
- A Python package and CLI (`courtsched`, `courtsched-story`). The core call is `strategy.plan_day(day, ctx) -> [Listing]` and `strategy.after_day(day, outcomes, ctx) -> next gaps`.
- A REST API (FastAPI, `courtsched.app.api`): create a court (including from the judge's own **CSV roster**, validated row by row), today's list, approve (Judge), run the day, forecast options, apply changes (Judge, with a required reason), calendar and leave, rules, change journal, docket health, case view.
- A web app (Next.js, `web/`) for the Court Master (runs the day), the Judge (approves, changes, sets rules) and the Analyst. Roles come from a switcher, since identity belongs to DRISTI.

**The app, against brief §6.2:**
- *Move these 10 cases, overbook this day:* tick and move, add or overbook, then **Preview impact**: a day-by-day load chart against 420 minutes, **who is affected** (heard earlier, later, newly or no longer), and a 4-week effect table.
- *Next few weeks under this option:* Rules & options compares up to three options or styles over 2, 4 or 8 weeks. Forecasts never use the simulator's hidden truth; they re-imagine the future from what the court knows, paired across options.
- *Ageing risk, repeated adjournments, drift, 3+/4+/5+ backlog:* Docket health.
- *What changed, why, what happened:* **How it was built** walks from current practice to our planner one rule at a time, with the reason and measured effect of each. The **Changes** journal requires a reason for every change and later shows expected vs actual effect.
- Policy locks: the old-case guarantee can be tightened, never loosened.

**DRISTI mapping** (from the e-filing handover spec):
- Advocate readiness check-ins and "confirm appearance" requests → **pending tasks**.
- "Your date moved" (only allowed outside the 7-day frozen window) → the **notifications** master table.
- Judge rules → per-establishment config, the same pattern as `allocationLogic` and `registrationPoint`.

**Dependencies:** Python ≥ 3.12, numpy, FastAPI, SQLAlchemy (SQLite; one file per court). Node 20 for the web app (Next.js, Recharts). No external services, no LLM.

**Stubbed vs real:**
- Real: the planners, simulated court, scorecard, experiments, forecasts, the API and the web app (daily loop, changes with impact preview, leave, rules, journal, docket health, case view, CSV import), tests.
- Stubbed: no authentication (a role switcher); outcomes come from the simulated court (manual outcome entry not built); no L3 agents; no DRISTI connectors.

**What integration would take:**
1. Feed the roster and process status from DRISTI nightly.
2. Call `plan_day` for tomorrow.
3. Publish the causelist and slots through notifications.
4. Record hearing outcomes (reached, substantive, reason), which the court master already records in DRISTI.
5. Call `after_day` to set next dates.

Validate against real outcomes for a month in shadow mode before going live.

## 7. How to run it

```bash
cd submissions/judgeofallearth
uv sync                                  # or: pip install -e .
uv run pytest -q                         # behaviour checks
uv run courtsched --out results          # ~40 s: all experiments → results/index.html
uv run courtsched-story                  # each rule's effect → results/model_story.json
uv run python experiments/scheduling_styles.py   # others: rules_vs_adaptive.py, fairness.py

# the app
COURT_WORKSPACES=./workspaces uv run uvicorn courtsched.app.api:app --port 8765
cd web && npm install && npm run dev     # http://localhost:3000
```

## 8. What we'd build next

1. **Richer per-case model.** Use features beyond hearing history (advocate load, reason mix), and pair it with reminders for low-odds parties (L3).
2. **Robust slots under random durations.** Slot-keeping falls to 58% at CV 0.5, so buffer slots by quantile, not by mean.
3. **L3 agents.** Rule-based advocate and litigant agents that respond to reminders, adjournment costs (CPC Order XVII) and slot swaps (air-traffic-style compression and swap of freed slots). LLM agents only for advocates, and only once they reproduce today's failure mix.
4. **A Strategy Lab** in the app: compare any planners across worlds on the same rosters, with a trade-off map and robustness grid, and a registry of past runs.
5. **A CP-SAT planner** with lexicographic objectives, and an LLM-evolved priority function (FunSearch-style) scored on this bench.
6. **Raise the data inconsistency** (substantive rate vs hearings per stage) with the organisers.


---
**Checklist before you open your PR:**
- [x] No real case numbers, party names, or advocate names appear anywhere in this submission. Only the organisers' anonymised IDs and generated IDs are used.
- [x] Everything lives under `submissions/judgeofallearth/`.
- [x] This file is filled in, not left as a template.
- [x] Your code actually runs with the commands in section 7.
