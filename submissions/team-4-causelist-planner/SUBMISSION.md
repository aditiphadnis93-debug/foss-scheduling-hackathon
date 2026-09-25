# Submission: team-4-causelist-planner

## 1. Team

- **Team / solo name:** team-4-causelist-planner
- **Members:** Aravind
- **Complexity level claimed:** L1. The judge's overrides are costed live, which reaches toward L2. An L3 agent attempt with Laya is in the repo but not part of the app (see section 4).

## 2. One-line summary

A decision support desk. It drafts a 60-day causelist that never overbooks a day, puts older cases first, and shows the judge what each possible next date costs before they choose it.

## 3. The approach

**In plain language.** The tool doesn't decide the schedule. It drafts one, and the judge overrides it case by case:

1. At 7 PM the next sitting day's list is published from the draft. It is frozen from then on.
2. In court, the judge records each listed case's outcome, next purpose and next date.
3. For the next date, the desk offers three options: the **earliest** allowed, the **nearest date with room**, and the **model's best fit**. The judge can also propose any sitting day and see its impact first.
4. At the close of the day, any case not taken up goes to its nearest date with room, and the next list is published.

The advocate sees the same figures read-only, so a next date can be discussed with the judge using the same numbers.

**Inputs.** All six CSVs in `data/`, copied unedited into `provided/`:

- the 100-case roster
- the calendar
- the hearing-type reference
- substantiveness by hearing type
- the failure reasons
- the sample causelist

The Roster picker offers three rosters:

- **100:** the 100-case sample.
- **3,000:** the organisers' `generate_roster.generate(3000, 42)`, called in-process.
- **Synthetic:** our own generator, `planner/synth.py`. It simulates each case's lifecycle from `provided/` alone and gives about 2,500 distinct case shapes at 3,000 cases, where the resample has 100. It defaults to 225 cases, so some days have spare time.

**Core logic.** A greedy forecast (`planner/forecast.py`):

- Fixed bookings (published lists, judge-set dates) go first.
- Each sitting day is then filled in score order, up to **390 expected minutes**. The other 30 minutes of the 420-minute day are kept for ad-hoc work.
- Up to a third of the day goes first to short procedural matters (≤ 15 min).
- **Score** = 3 × age points (<1y 0, 1–3y 1, 3–4y 2, 4–5y 3, 5y+ 5) + purpose priority + 0.2 × days waiting + 1 if the case has had more hearings at its stage than the median. Every term is shown in the listing's "why".
- A listing books the case's follow-up no earlier than the usual gap for its purpose.

**Next-date options** (`planner/desk.py`):

- **Earliest:** hearing day + gap for the next purpose, on a sitting day.
- **Nearest with room:** the first day from the earliest that has enough free minutes without moving anyone.
- **Best fit:** the forecast is re-run with the case fixed on each candidate day (up to 12 of them) and the lowest-cost day is kept. Cost = Σ (1 + age points) × days late, for this case and every case it pushes later.
- **Impact of the judge's date:** whether the day has room, which cases move later and by how many days, and how many of those are 4 years old or more.

**Key decisions.**

- **Decision support over automation.** The judge has the final say on every next date. The value is in making the cost of each choice visible.
- **Booking cost = minutes × `p_heard`.** A listing books its expected time, not its full time. `p_heard` comes from the failure-reason mix. This gives about 28 listings in the 390 planned minutes, matching the case study's ~30 a day.
- **A 30-minute buffer** is kept for urgent and fresh matters, so the plan isn't full to the minute.
- **Greedy, not an optimiser.** It is fast enough to re-run on every decision (~0.2 s for 3,000 cases), and every placement is explainable.

**Assumptions.**

- **Purpose priority isn't in the data.** We assume Judgement 10, Bail and Arguments 9, then down the lifecycle, with side types in the middle.
- **`p_heard`:** prerequisite failures are set aside; absences, court issues and "unclear" count as not heard.
- **Repeat listings in the forecast hold the purpose,** because the outcome isn't known ahead.
- **Existing next dates are ignored,** as the brief allows.
- **Conviction-and-sentence cases are left out.** Rows whose summary records a conviction and sentence are excluded as awaiting disposal: 3 in the sample, 89 in the 3,000.
- **Pending process is flagged, not gated.** A summary mentioning pending process (warrant, summons, notice) is flagged on the desk but not blocked.
- **The horizon** is 60 calendar days, cut at the calendar's end.

The full list is in `docs/causelist-planner.md`.

## 4. Justify your complexity level

- **L1 (fixed behaviour):**
  - the score and its terms (`planner/forecast.py: score_terms`)
  - the 390-minute cap and procedural third
  - the gap rule
  - the date options (`planner/desk.py`)
  - Every listing carries its "why", and the walkthrough is the judge's day in section 3.
- **Toward L2:**
  - The booking cost uses the substantiveness and failure-reason distributions.
  - When the judge overrides a date or a hearing time, the desk re-runs the forecast and prices the override: cases displaced, days lost, 4y+ cases hit.
  - The synthetic roster models stage durations with negative binomials fitted to the reference table.
- **L3 (not in the app):**
  - `agents/` holds judge, advocate and litigant agents that act on an earlier build's causelist. Decisions come from Laya (an open, Jev-compatible model server in `laya/`), with a rule fallback.
  - It isn't wired into the planner, so we don't claim L3. See `docs/L3-agents-laya.md`.

## 5. Results

A 60-day draft from a clean start on Mon 28 Sep 2026 (41 sitting days):

| | 100-case sample | 3,000 roster |
| --- | --- | --- |
| Listings a day (min / mean / max) | 9 / 18.9 / 35 | 23 / 28.4 / 50 |
| Planned-minute use (of 390) | 39% (the docket runs out) | 99.8% |
| Overbooked days | 0 | 0 |
| Cases with a date in 60 days | 97 / 97 | 765 / 2,911 |
| 4y+ cases listed at least once | 100% | 70% |

- **Utilisation:** the forecast never books past 390 expected minutes. Only published lists and judge-set dates can overbook a day, and they are counted.
- **Backlog age:** age dominates the score, so the oldest cases list first. 70% of 4y+ cases get a date in 60 days on the 3,000 roster.
- **Predictability:** the next day's list is frozen at 7 PM, and judge-set dates hold. Only tentative dates move.
- **Substantiveness:** expected minutes use `p_heard`, and the desk shows each purpose's share of hearings that move the case on.
- **Next dates:** never earlier than the purpose's usual gap unless the judge chooses it. The desk warns about dates earlier than the gap or more than twice it.

**What the visualisation shows.** Each chart answers a question the judge can act on:

- **Availability heatmap:** which of the next 30 sitting days has room for this hearing.
- **Impact table:** who is pushed if I pick this date?
- **Stacked day-load chart:** how full is each day ahead, and with how old a mix of cases?
- **Hearings-by-type chart** and the advocate's other listings: a date that saves the advocate a trip.

**Against the baseline** (flat +60 days, everything listed is attempted):

- The next date follows the purpose's gap, not a flat 60 days.
- Days are packed to expected time, so there is no over-listing.
- Old cases come first.
- The judge sees the cost of each override before making it.

We haven't built a simulator of hearing outcomes for this planner, so reach rate and substantiveness aren't measured against the baseline. `sim/` does this for the earlier build on synthetic data.

`proposed_schedule.csv` is the 60-day draft for the 3,000 roster: case, purpose, date, expected minutes, score and why.

## 6. Specs for integration

- **Data schema.**
  - **Input:** the organisers' CSV shapes, unchanged: the roster columns of `roster_sample_100.csv`, `court_calendar.csv` and the reference tables. `planner/synth.py` writes the same roster columns.
  - **Output:** a causelist row per listing: case number, filing number, hearing type, date, status (`published` / `judge` / `tentative`), expected minutes, score, why and advocate.
  - **Desk state:** decisions and published lists live in DuckDB (`data/causelist.duckdb`; tables `desk`, `decision`, `published`).
- **Interfaces.**
  - The UI is a Streamlit web app.
  - The logic is plain Python with no UI dependency: `forecast(cases, DeskState) → Draft`, `desk.earliest / nearest / best_fit / impact`, and `DeskStore` for decide, close the day and replay.
  - This could sit behind an HTTP API for DRISTI.
- **Dependencies:** Python 3.12, DuckDB, pandas, Streamlit and Plotly, all OSI-licensed. Laya (Apache-2.0) is only for the optional agents. No hosted or closed services.
- **What's stubbed vs. real.**
  - **Real:** the forecast, the date options, decide / close the day / publish, and the advocate's read-only view.
  - **Stubbed:** purpose priority is assumed, and there is a single judge and courtroom with no sign-in beyond a role picker.
  - **Not part of the planner:** the older code (`scheduler/`, `sim/`, `datagen/`, `agents/`), which needs refactoring out.
- **What integration would take.**
  - Feed the roster and calendar from DRISTI instead of CSVs.
  - Write published lists and decisions back to DRISTI's hearing records.
  - Replace the role picker with DRISTI's authentication.
  - Move the forecast and desk functions behind a service.

## 7. How to run it

```bash
cd submissions/team-4-causelist-planner
docker compose up -d --build app            # http://localhost:8501; choose Judge or Advocate in the sidebar
docker compose --profile test build test && docker compose run --rm test   # tests
```

To regenerate the synthetic roster (optional):

```bash
docker compose exec -T app python -m planner.synth --num-cases 225 --seed 7 --out data/roster_synthetic.csv
```

## 8. What we'd build next

- **A hearing-outcome simulator for the planner,** so reach rate, substantiveness and predictability are measured against the +60-day baseline.
- **Refactoring:** remove the earlier build's code and trim the app to the Judge and Advocate roles.
- **Respect dates already fixed** by the court, as an option.
- **L2:** a CP-SAT pass for the best fit across all of the day's decisions together.
- **Advocate conflicts:** clashes across courtrooms.
