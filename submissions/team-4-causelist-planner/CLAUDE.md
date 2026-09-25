# CLAUDE.md

## Project

Entry for **Scheduling Justice**, a one-day PUCAR hackathon held during FOSS United Week. We are building a scheduler for one High Court judge's roster. It produces daily causelists with time windows and next-date recommendations, plus insights for the judge. Winning code is merged into the DRISTI 2.0 stack and released as open source.

Status: **L1 proof of concept built** (`scheduler/`, `sim/`, `app.py`) with **persona views** (`views/`): judge calendar, Court Master whole-court view, advocate and litigant pages behind a demo sign-in. **Decision lineage** per case in the Causelist tab. **L3 agents POC** (`agents/`): a judge agent lists cases, rules on adjournments and fixes next dates; advocates and litigants act on the causelist. Decisions come from Laya in a sidecar, with a rule fallback. All merged to `master` (the main branch; no git remote is configured yet).

**Causelist planner** (`planner/`, `views/planner.py`; the first Judge tab) is the simplified build from `docs/rebuild-plan/rebuild-base-plan.md`. It runs on the **organisers' dataset only** (`provided/`), never on the synthetic data. Its third roster (`planner/synth.py`) is also simulated from `provided/` alone. It has a greedy 60-day forecast and a hearing-day desk. For each case the desk shows the outcome, next purpose and next date, with the earliest date, the nearest date with room, the model's best fit, and the impact of the judge's proposed date. Close the day to publish the next day's list. The **Advocate** role shows the same desk read-only, for one advocate's cases (`render_advocate`). The advocate picks only the next purpose, and nothing is saved. The older synthetic-data advocate page is hidden behind `SHOW_OLD_ADVOCATE_PAGE`.

Workflow: **generate test data → the app loads it → plan schedules live → save several and compare.** `python -m datagen generate` writes `data/synthetic/*.parquet`; the app loads it into `data/court.duckdb` (built from `docs/scheduler-schema.sql`) and takes judges, courtrooms, presets, leave, advocates, parties, cases and history from there. Only the plan is computed live; saved schedules go into `scheduling_run` / `causelist` / `causelist_item` / `listing_decision`. The live plan starts every case with no fixed date (`store.cases` leaves `Case.next_date` unset), so a date the court fixed in the dataset (`court_case.next_hearing_date`, e.g. from the last order) is ignored and the case can be listed earlier. This is open: respecting it means loading that date into `next_date`.

## Key documents (read before planning or coding)

- `docs/Scheduling Justice Hackathon - FOSS United Week.pdf`: the official brief. It is the source of truth for goals and judging.
- `docs/PUCAR FOSS Hackathon — Understanding Document.md`: summary of the brief, judging criteria (L1/L2/L3), suggested FOSS tooling and open questions.
- `docs/L1-scheduling-algorithm.md`: the agreed L1 design, covering the pipeline stages, locked rules, judge presets, evaluation harness and extension seams.
- `docs/court-domain-model.md`: High Court domain model (courts, benches, judges, roles, case lifecycle, DRISTI mapping). Background for the scheduler's inputs and the per-role calendar views; it does not widen scope.
- `docs/court-schema.sql`: DuckDB DDL for that model (72 tables). Documentation only; the scheduler doesn't read it yet.
- `docs/scheduler-schema.sql`: the 23-table subset the scheduling tool needs, plus the `case_timeline` and `case_summary_facts` views (domain model §12). `datagen/` builds its test data from this file, so keep it valid DuckDB.
- `docs/L3-agents-laya.md`: the L3 agents: the daily loop, how locked rules still clamp the judge agent, the Laya sidecar and cache, and findings (speed, lever sensitivity).
- `docs/causelist-calendar.md`: the persona views (calendar, case timeline, summary, checklist, .ics). Covers what was built, findings and what's deferred.
- `docs/queries.md`: questions still open for the organisers. Add new ones here.
- `docs/causelist-planner.md`: the Causelist planner. Covers the judge's day, the date options, the forecast and its assumptions.
- `provided/`: the organisers' six CSVs, `scripts/generate_roster.py` and their MIT licence, copied unedited from `docs/updated-provided-docs/` (an untracked git clone that Docker can't see). Don't edit them; re-copy when the organisers revise the data.

## Constraints

- **FOSS only.** Every dependency must be OSI-licensed. Don't use closed APIs such as the Jev API or hosted LLMs; use open equivalents (see the tooling table in the Understanding Document).
- **Stack:** Python 3.12 + DuckDB + Streamlit (with Plotly) for L1. Later levels add OR-Tools CP-SAT (L2). L3 agents use Laya (Apache-2.0, torch CPU) as a separate `laya` service; the app talks to it over HTTP with the standard library, so the app image gains no ML dependencies. This could change if DRISTI 2.0's stack requires it; that question is still open.
- **Everything builds and runs in Docker.** Don't install packages on the host.
- **Datasets aren't released yet.** The schema and hearing-type values in the L1 doc are placeholders. Don't hard-code them.
- **Deadline:** code pushed to a branch and ready to merge by 4:30 PM on hackathon day, followed by a 10-minute demo.

## Commands

```bash
docker compose up -d --build app          # app at http://localhost:8501
docker compose --profile test build test  # rebuild test image after code changes
docker compose run --rm test              # pytest
docker compose exec -T app python -c "…"  # ad-hoc scripts against the running app image
docker compose exec -T app python -m datagen generate [--cases-per-judge N --seed S --db data/synthetic.duckdb]
                                          # synthetic data for every scheduler-schema table -> data/synthetic/*.parquet
docker compose exec -T app python -m datagen load --db data/x.duckdb   # schema from the DDL + load the parquets
docker compose exec -T app python -m datagen export --db data/court.duckdb --out data/export  # app DB (with saved schedules) -> parquet; stop the app first
docker compose exec -T app python -m planner.synth --num-cases 225 --seed 7 --out data/roster_synthetic.csv
                                          # the planner's Synthetic roster ($SYNTH_ROSTER); then Start over in the tab
docker compose --profile agents up -d --build laya app  # Laya sidecar for the L3 agents (model cached in data/models)
docker compose exec -T app python -m agents probe       # one Laya decision next to the rule fallback
docker compose exec -T app python -m agents warm --judge sehgal  # 10 days × 3 policies → data/laya_decisions.json (~600 decisions, ~13 min on CPU; replays in <1 s)
```

The app builds `data/court.duckdb` on first start (generating the dataset too if it's missing). A regenerated dataset is not picked up automatically, because that would discard saved schedules: use **Dataset → Reload** in the sidebar. The running app holds DuckDB's lock on `data/court.duckdb`. The Causelist planner keeps its own state in `data/causelist.duckdb` (`$CAUSELIST_DB`), with short-lived connections. Its **Start over** control resets one roster.

## Code map

- `scheduler/`: the pipeline. Stages: `eligibility` → `scoring` → `capacity` → `assign` → `slots`, with `next_date` run after each hearing. Also `config.py` (locked-rule constants + YAML loader), `data.py` (placeholder hearing-type table, calendar, the synthetic roster `datagen` builds on), `store.py` (the app's working DuckDB: dataset rows → `Case` / `JudgeConfig`, names, timeline, docket queries) and `runs.py` (save / load / delete schedule batches). The stages never read the store.
- `sim/`: `simulate.py` plays the L1 policy, the status-quo baseline and the `l3` judge-agent policy forward, under `fixed` per-purpose rates or `agents=` behaviour. `metrics.py` computes the judging metrics in DuckDB SQL.
- `planner/`: the Causelist planner on `provided/`. `reference.py` (the CSVs through DuckDB; 390 of the 420 daily minutes planned, 30 kept for ad-hoc work; `p_heard` derived from the failure reasons; booking cost = minutes × `p_heard`; assumed priority; calendar), `roster.py` (100 sample, the organisers' 3,000 via their `generate`, or the synthetic CSV), `synth.py` (simulated case lifecycles in the roster's CSV shape, calibrated on `provided/`; CLI), `forecast.py` (`DeskState` → `Draft`: fixed bookings, then greedy by score with a procedural third), `desk.py` (earliest, nearest fit, impact, best fit), `store.py` (`DeskStore`: decisions, published lists, close day). It doesn't use `scheduler/`.
- `views/`: persona views that consume the scheduler's output and never change it. `court.py` (one courtroom per judge in the dataset; live plan or a saved batch), `events.py` (causelist listings as calendar events, role filters, cross-court clashes), `history.py` (timeline and summary from the `case_timeline` / `case_summary_facts` views, checklist), `schedule.py` (generate, what-if, save, open, compare), `lineage.py` (a case's decision lineage in the Causelist tab: gates, score terms, rank, placement route, window, and each earlier day's fate), `ics.py`, `charts.py`, `pages.py` (Streamlit pages).
- `presets/*.yaml`: one preset per judge style, plus `courtroom:`, optional `cover_page_for:` and `style:` (the judge's way of working in prose, stored in `scheduling_preset.additional_details`; only the L3 judge agent reads it). They are input to `datagen`; the app reads presets from the dataset (`scheduling_preset`, `time_block`, `judge_leave`) through the same clamping loader.
- `datagen/`: Faker-based synthetic data for all 23 tables of `docs/scheduler-schema.sql`, one per preset courtroom, built on `generate_roster`. Rows are inserted into a DuckDB created from the DDL (so PK/FK/CHECK are enforced), then exported as Parquet in FK order (`schema.TABLE_ORDER`). Writes one draft "seed" schedule per courtroom in the same shape the app saves.
- `agents/`: L3 agents. `situation.py` (bucketed facts = cache key, questions, narrative; the key excludes the narrative text, so after rewording a narrative or question delete `data/laya_decisions.json` and re-warm), `decide.py` (`RuleDecider`, `LayaDecider` with disk memo, budget and fallback), `judge.py` (listing scorer plugged into `plan_day(scorer=)`, ruling and next-date situations), `outcomes.py` (`Levers`, `Agents`: a day's decisions, rulings, memory), `personas.py`. `laya/Dockerfile` builds the sidecar. `views/agents.py` is the Agents (L3) tab.
- `tests/test_locked_rules.py`: runs every locked rule against every preset. `tests/test_agents.py`: rule fallback, the Laya client (faked HTTP), locked rules under a contrarian judge agent, the simulator seam. `tests/test_lineage.py`: every eligible case has a recorded fate, gates agree with eligibility, lineage survives a save. `tests/test_imports.py`: every view module imports. `tests/test_datagen.py`: generated data reloads cleanly and its history is coherent. `tests/test_calendar.py`: the persona views. `tests/test_store.py` / `tests/test_runs.py`: dataset → scheduler input, and saved schedules read back exactly. `tests/test_planner.py`: the Causelist planner. Covers the reference derivation, the rosters (the 3,000 matches the organisers' script), forecast capacity and gaps, the desk's date options and displacement, decide/close/replay, and a headless `AppTest` render. `tests/conftest.py` builds a small dataset once per session.

## Design rules

- The scheduler is a pipeline of pure stages. Each stage is `(state, config) → result + reasons`, and no stage reads another stage's internals. This is what lets L2 and L3 swap stages in.
- Every listing carries a "why" trail, because the panel scores explainability. `plan_day` also records a lineage per case (`DayPlan.rank` / `how` / `skipped`, `Listing.window_why`), saved into `listing_decision`; keep it filled when changing a stage.
- **Locked rules** must never become configurable: the ageing quota, the `w_age` floor, the starvation guard and the listing-factor ceiling. The config loader clamps them, and tests enforce them.
- Judge styles live in presets (`sehgal`, `dimakar`, `joshi`: YAML → dataset rows), not in code. What-if overrides from the UI go through the same loader, so locked rules still clamp.
- Report metrics against the status-quo baseline: 60 cases listed per day, flat +60-day next date.


## UI testing
Do not use playwright or other UI testing tools unless explciitly asked.