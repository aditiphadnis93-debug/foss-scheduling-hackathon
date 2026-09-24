# Submission: vihitha

## 1. Team

- **Team / solo name:** vihitha
- **Members:** Pooja HP <poojahprabhu18@gmail.com>
- **Complexity level claimed:** L3

## 2. One-line summary

Vihitha gives every pending case a date **and a time slot**, sized by how likely that hearing is to actually go ahead, so the court reaches almost everything it lists instead of listing 60 and reaching 20.

## 3. The approach

**In plain language.** The court's problem isn't that it lists too few cases — it's that it lists cases that were never going to be heard, and gives everyone the same 10:30 start. Vihitha scores every pending case, fills each day to 92% of *expected* minutes rather than 100% of optimistic ones, and gives each hearing its own start time. Because an Arguments hearing goes ahead only 13% of the time, it is booked for ~7 minutes, not 30; a Judgement, which almost always is delivered, gets its full ~30. The day is therefore overbooked by count and honest by expectation.

### Inputs

All five reference files in `data/` are used, none are modified:

| File | How it's used |
|---|---|
| `roster_sample_100.csv` | The docket. Filing date → age and priority. Stage + next purpose → hearing type and length. Per-type hearing counts → "stuck at stage". `last_hearing_summary` is parsed for attendance, pending summons/warrant, mediation, "last chance". |
| `court_calendar.csv` | Nothing is ever listed on a non-sitting day; judge's leave sits on top. |
| `hearing_type_reference.csv` | Minutes per hearing → slot length and day load. Days-to-next-hearing → the next-date target. Median/max hearings per case → the "stuck at stage" flag. |
| `substantiveness_by_hearing_type.csv` | The P(goes ahead) in the expected-minutes formula, the confidence dot in the UI, the case-end forecast, and the simulator. |
| `hearing_failure_reasons.csv` | The adjournment reasons offered in the outcome form; the absence share gives a show-up rate; "awaiting process" holds a case until its summons/warrant is due back; the simulator samples reasons from this distribution. |
| `sample_causelist_2026-09-22.csv` | The output shape — our exports open with the same first four columns. |

**Generated data:** the 100-case sample is scaled to 3,000 using the organisers' `generate_roster.py` logic, seed 42, re-implemented in `src/backend/vihitha/roster.py` (we did not modify the script in `scripts/`). Regenerate with `python -m vihitha.cli generate-roster --n 3000 --seed 42 --out ../data/roster_3000.csv`. The result is committed at `src/data/roster_3000.csv`.

### Core logic

1. **Rank.** Priority = age 35% + P(hearing moves the case forward) 30% + days waiting 20% + closeness to disposal 15%. A 4+ year case nearing its 30-day limit gets a large guardrail boost.
2. **Mix.** 4+ year cases go first; within each age tier the three groups (short / trial / final) take turns in proportion to the court time each group needs, so a day is never "all judgements".
3. **Size the slot.** This is the core idea:
   ```
   expected minutes = P(goes ahead) × full length + (1 − P(goes ahead)) × 3 min adjournment call
   slot length      = expected minutes ÷ 0.92
   ```
   Arguments: 0.13 × 30 + 0.87 × 3 = **6.5 min**. Judgement: **29.7 min**.
4. **Place.** Each case goes on the **earliest** sitting day with room, because a free minute today is lost for good. Days fill to 92% of the 420 minutes.
5. **Order and slot the day.** Short matters first so parties can leave, then trial stages, then arguments and judgements; hearings run back to back on one continuous clock, each getting a 30-minute appointment window.
6. **Re-plan on every change.** Court orders (next dates, carry-forwards) and judge edits are *firm*; the planner's own listings are *soft* and are re-placed around the firm ones. ~1–2 s for 3,000 cases.
7. **Next date.** Target = the hearing type's reference gap; Vihitha searches from the gap to 1.5× the gap for a day with room, preferring days the case's advocate is already in court.

The method is a greedy, weighted, capacity-constrained packer with guardrail clamps — deliberately not a black-box solver, because every listing has to carry a reason a judge can read and overrule.

### Key decisions (not obvious from the data)

- **Plan to 92%, not 100%.** The 8% buffer is what turns the reach rate from ~86% to ~96%. Utilisation looks *worse* than the baseline because of it; we think reach rate is the honest metric and utilisation alone rewards over-listing.
- **Slot length = expected, not full, minutes.** The data gives duration and substantiveness separately; combining them is what lets a day hold 27–35 hearings without lying to anyone.
- **Earliest-day-first rather than levelling load** — an unused minute is not recoverable.
- **Court orders outrank the algorithm.** A next date given in open court is never moved by the planner.
- **Guardrails that can't be switched off:** ≥25% of each day for 4+ year cases, age weight ≥0.2, every 4+ year case listed within 30 days. A judge can tune the rules but not starve the backlog.

### Assumptions made

**Court day and planning**
- 10:00–17:30 with lunch 13:30–14:00 = 420 minutes; slot windows 30 min; draft horizon 20 sitting days.
- An adjourned hearing consumes 3 minutes of court time.
- Lists are published ~5 sitting days ahead.
- Days after the organisers' calendar (after 31 Dec 2026) are treated as Mon–Fri sitting days.

**Outcome model**
- Settlement or withdrawal: 2% per reached hearing.
- Substantive durations are lognormal (sigma 0.35) around the reference minutes.
- A required case summary removes 30% of "not ready" failures.
- Learned show-up prior has strength 10; two consecutive absences at Appearance move the case to Warrant.
- Delay condonation is skipped unless the case already had such hearings.
- A summons pending at roster start returns at a uniform random point within the reference gap.

**Forecast:** 200 Monte Carlo paths per case, horizon 31 Dec 2026.

All of the above are settings, editable in the UI or a rules JSON — none are hard-coded constants.

## 4. Justify your complexity level

**L3 — behavioural / agent-based.** `src/backend/vihitha/agents.py`.

- **The agents.** Every case has a **Litigant** (`party_id`) and an **Advocate** (`advocate_id`, shared across that advocate's matters). Each draws a reliability trait once from the seed, so the same party behaves consistently across all its hearings.
- **What they decide.** The Litigant decides whether to show up; the Advocate decides whether the matter is prepared. Neither is a fixed probability — both respond to how the schedule treated them:
  - being given a **real time slot** rather than "10:30, court no. 4" raises show-up,
  - **notice days** above the threshold raises it,
  - a **"last chance"** warning raises it,
  - each time the party attended and was **not reached**, show-up falls (fatigue, capped),
  - an advocate with **2+ matters clustered in one block** is better prepared.
- **The feedback loop.** A no-show becomes an adjournment → the adjournment consumes 3 minutes and produces a new next date → that next date changes the notice the party gets and the clustering the advocate sees → which changes the next decision. The schedule shapes behaviour and behaviour reshapes the schedule.
- **Measured effect** (same roster, same seed, `--agents` vs `--no-agents`): substantiveness rises **33.8% → 36.4%** and reach rate falls **95.9% → 91.5%**. Slots earn better attendance; fatigue and trait variance cost reach. Both directions are the model disagreeing with us, not confirming us.

L2 is also fully met: the distributions are taken from the organisers' files rather than invented (substantiveness per type, failure reasons per type, hearings-per-case spread), adjournment carries a real 3-minute cost, the 30-day backlog rule is a hard constraint, and when a judge overrides a rule the whole horizon re-plans around the override — the What-If screen shows the day load, the four KPIs and any 4+ year case pushed past its limit *before* anything is applied.

## 5. Results

3,000 cases, 24 Sep – 31 Dec 2026, 68 sitting days, `--preset optimal`, seed 42:

| Official metric | Vihitha | Baseline (60/day, flat 60-day next date) |
|---|---|---|
| Utilisation | 92.0% | 99.5% |
| Reach rate | **95.9%** | 71.6% |
| Substantiveness | 33.8% | 33.9% |
| Backlog-age impact (4+ yrs heard) | **98.3%** | 69.8% |
| Predictability (days late vs first promised date) | **0.3** | 4.7 |
| Next-date sanity (within the legal range) | **100%** | 7.8% |

With behavioural agents on: utilisation 93.5%, reach 91.5%, substantiveness **36.4%**, backlog 94.0%, predictability 0.7, next-date 100%.

**Reading the utilisation row honestly:** the baseline "uses" more minutes only because it lists 60 a day and runs until closing — 28% of the people who came are sent home unheard. Vihitha spends slightly fewer minutes and reaches 96% of the parties it summoned.

**vs. the case study's baseline, in one line each:**
- 60-day flat gap → the hearing type's own gap (5–45 days); 7.8% → 100% of next dates land in a sane range.
- "whatever gets listed gets attempted" → what gets listed is what fits; reach 71.6% → 95.9%.
- Oldest cases drift → 98.3% of 4+ year cases are heard in the window, against 69.8%.
- No time → every party has a 30-minute appointment window and a public page showing if the court is running late.

**The visualisation** (`Vihitha-screens.pdf`; live at `/metrics`, `/calendar`, `/whatif`):
- **Month / week / day calendar** — day load against the 420-minute line, so an overloaded day is visible before it happens.
- **Day screen** — the slotted cause list with each hearing's expected length, confidence dot and reason for being listed.
- **Metrics** — the six official metrics plus four judge KPIs, and the case-end forecast distribution.
- **What-If** — any rule set applied to a copy of the real schedule, side by side with the current one.

**The decision a judge can actually make:** open What-If, switch the priority weights or a purpose-of-the-day rule, see the next month's KPIs and which 4+ year cases would breach their 30-day limit, then apply or discard. And on any given day, see before 10:00 that the day is packed to 104% and move two matters rather than discover it at 16:30.

## 6. Specs for integration

### Data schema

**Input** — the roster CSV exactly as `data/roster_sample_100.csv` defines it: `case_number`, `filing_number`, `filing_date`, `advocate_id`, `party_id`, `current_stage`, `last_hearing_summary`, `purpose_of_next_hearing`, the twelve `hearings_*` counters, `total_hearings_held`. **No columns were added or renamed**; `src/backend/vihitha/loaders.py` rejects a roster missing any of them. The four reference CSVs are read in their published form.

**Output** — `proposed_schedule.csv`, whose first four columns match `sample_causelist_2026-09-22.csv`:

| Column | Meaning |
|---|---|
| `Case Number`, `Filing Number`, `Hearing Type`, `Hearing Date` | as in the sample causelist |
| `window_start`, `window_end` | the party's 30-minute appointment window |
| `est_start`, `est_end` | estimated start and end if the matter goes ahead in full |
| `advocate_id`, `case_age_years` | for clustering and backlog reporting |
| `reason` | why this case is on this day, in plain language, for the judge |
| `status` | simulated outcome: `MOVED_FORWARD` / `ADJOURNED` / `NOT_REACHED` / `DISPOSED` |

`cause-list.csv` is the same shape for a single day.

### Interfaces

Three, over one engine:
- **CLI** — `python -m vihitha.cli {generate-roster, run, compare, plan}`, no database, prints the six metrics. This is what produced `proposed_schedule.csv`.
- **REST API** — FastAPI at `/api/v1` (OpenAPI at `/docs`): `/schedule`, `/hearings`, `/cases`, `/rules`, `/whatif`, `/metrics/scoring`, `/public/slot`, `/export/*.csv`. Another engine calls these directly; `/metrics/scoring?source=simulated` runs the identical engine as the CLI for the same seed (a test asserts this).
- **Web app** — React + Vite: calendar, cases, metrics, what-if, settings, plus a public slot-lookup page for parties.

Layering is strict: `api/routers` (HTTP only) → `api/services` → `vihitha/` (pure functions, no I/O) + `api/repositories` (SQLite).

### Dependencies

Python ≥3.10 — numpy, pandas, fastapi, uvicorn, pydantic, sqlalchemy (pytest + httpx for tests). Frontend — React 18, Vite 5, TanStack Query, Tailwind. **No external services, no hosted models, no API keys.** It runs offline on a laptop.

### What's stubbed vs. real

| Real | Stubbed / simulated |
|---|---|
| The planner, priority scoring, slot sizing, packing, next-date search, re-planning, guardrails | Outcomes in the CLI run and What-If are **sampled** from the organisers' distributions — no real court fed us outcomes |
| Persistent schedule state in SQLite; judge edits, pinning, publishing, day-close, carry-forward | Authentication and roles — there are none; anyone reaching the API is the judge |
| The six official metrics and the four judge KPIs, computed from state | The public slot page shows a simulated "running N minutes late" |
| CSV export of cause list and schedule | No DRISTI/e-Courts adapter — CSV in, CSV/JSON out |

The 3,000-case roster is synthetic by construction — the organisers supplied 100.

### What integration would take

Three things. **One,** an adapter mapping the court's case master to the roster columns above — mostly a field-mapping exercise, since we deliberately did not extend the schema. **Two,** replace the sampled outcome with the Court Master's real disposal entry: one `POST /hearings/{id}/outcome` call per hearing at the end of the day, which is already the API the UI uses. **Three,** auth and audit — every listing change is already recorded against a hearing, but it records no user. The reference tables (durations, gaps, substantiveness) should then be recomputed per court from its own history rather than the Kollam pilot averages; that is a query, not new code.

## 7. How to run it

```bash
# from the repo root, after cloning
cd submissions/vihitha/src/backend
py -3.12 -m venv .venv && .venv\Scripts\activate    # macOS/Linux: python3 -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"

# 1. Reproduce the submitted schedule and print the six metrics (~8 s)
python -m vihitha.cli run --roster ../data/roster_3000.csv --preset optimal --out ../../proposed_schedule.csv

# 2. The same run with behavioural agents on (the L3 numbers)
python -m vihitha.cli run --roster ../data/roster_3000.csv --preset optimal --agents

# 3. Compare all five rule sets
python -m vihitha.cli compare --roster ../data/roster_3000.csv --presets baseline,optimal,sehgal,dimakar,joshi

# 4. Tests (10 tests: engine + API smoke)
pytest -q

# 5. The full app
uvicorn api.main:app --reload --port 8000     # first start builds the 3,000 cases and plans 20 days
cd ../frontend && npm install && npm run dev  # http://localhost:5173
```

The roster is regenerated with `python -m vihitha.cli generate-roster --n 3000 --seed 42 --out ../data/roster_3000.csv`. The reference data is read from this repo's `data/` folder automatically; override with `VIHITHA_DATA_DIR`.

## 8. What we'd build next

1. **Learn the reference table instead of reading it.** Duration and substantiveness per hearing type are court-wide averages; they should be per judge, per stage, per advocate, updated nightly from real outcomes. The plumbing for a learned prior already exists for show-up.
2. **Replace the greedy packer with a solver for the hard days.** Greedy is right for 3,000 cases in 1 second, but a day with clustering, purpose rules and a dozen pinned matters is a small CP-SAT problem.
3. **Advocate-side conflicts.** We cluster an advocate's matters; we don't yet know they're before another judge at 11:00.
4. **Tell parties.** A slot is worthless if nobody sees it — SMS/WhatsApp with the window, and a "running late" push.
5. **Measure the counterfactual honestly.** Run the baseline and Vihitha against the same real court for a month and report the difference, rather than against our own simulator.

---
