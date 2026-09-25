# Scheduling Justice: Simplified Rebuild Spec

A self-contained spec for rebuilding our hackathon entry from scratch on the organisers' real data. It carries over what the first build (v1 in this repo) proved worth keeping and drops the rest. Written 2026-09-24.

Detail behind the data sections is in `docs/provided-data-fit.md`. The v1 design this simplifies is in `docs/L1-scheduling-algorithm.md`.

## 1. The brief on one page

**Problem.** A High Court judge (Justice Sehgal) has a roster of 3,000 cases and about 2.5 months. On a typical day, **30 are listed, 10 heard and 5 effective**. Next dates default to +60 days. The judge has **7 hours (420 minutes) a day** for judicial work.

**Ask.** Help the judge decide what to hear, when to hear it and how to structure the day. There are seven goals; tackle one or more:

1. Minimise trips to court.
2. Build an optimal causelist, neither over- nor under-booked.
3. Give real appointment slots.
4. Raise substantive hearing rates.
5. Make the next date meaningful.
6. Make scheduling configurable for judges, with some goals locked.
7. Turn data into insight and what-ifs.

**Judging.**

1. *Scheduling performance*: utilisation, reach rate, substantiveness, backlog-age impact, predictability and next-date sanity (§7).
2. *Visualised insight*: judges see what their overrides cost.
3. *Complexity*: L1 fixed rules → L2 realistic distributions and trade-offs → L3 behavioural agents.

You must be able to walk through every key decision in the algorithm.

**Rules of the day.**

- Solo or team, any language. There is no SDK and no scoring script, so we print the metrics ourselves.
- Fork `aditiphadnis93-debug/foss-scheduling-hackathon`. Branch `team-<name>`, with everything under `submissions/<name>/` and `SUBMISSION.md` from the template.
- Don't edit their `data/`.
- No real case numbers, party names or advocate names.
- PR open by **5 PM** (the README also says 4:30, so aim for 4:30), then a 10-minute demo.
- The two winners go on to DRISTI 2.0 with the Court Master and Justice Sehgal.

**Simplifications the brief grants.**

- Treat the roster as the starting point and **ignore existing next hearing dates**.
- Anything not constrained is a design decision; make assumptions visible.

## 2. Scope of the rebuild

| Keep (proven in v1) | Drop (v1 extras) | Optional, only if time allows |
| --- | --- | --- |
| Pure pipeline stages: eligibility → score → capacity → assign → windows → next date | 23-table schema, Faker `datagen`, parquet export | L2: sampled durations and daily re-planning |
| Locked rules, clamped on load and tested | Multi-courtroom court, persona sign-in, advocate/litigant/Court Master pages | L3: rule-based advocate and litigant agents (no Laya) |
| A "why" trail on every listing | Saved schedules, compare, lineage storage | CP-SAT solver behind the same `plan_day` interface |
| YAML judge presets (Sehgal, Dimakar, Joshi) | Laya sidecar, .ics export, themes | |
| Forward simulator with a status-quo baseline | | |
| Streamlit + DuckDB + Plotly in Docker | | |

The rebuild should reach **a solid L1 that scores well on all five metrics**, with a clear L2 story. That beats a wide but shallow L3.

## 3. Inputs: the provided data

All of it is read-only, from the organisers' `data/`. DuckDB reads the CSVs directly (`read_csv_auto`); there is no persistent database to manage.

| File | Rows | Use |
| --- | --- | --- |
| `roster_sample_100.csv` | 100 | The docket. Scale it to 3,000 with their `scripts/generate_roster.py --num-cases 3000 --seed 42`, run into our own folder |
| `court_calendar.csv` | 122 (Sep–Dec 2026) | `is_working_day = Yes` gives the sitting days. There are 6 holidays and Sat/Sun off. Judge leave comes from the preset |
| `hearing_type_reference.csv` | 14 | Duration (min), gap to next hearing (days), hearings per case (min/max/mean/median) |
| `substantiveness_by_hearing_type.csv` | 14 | P(substantive) per type, with a `source` of real or estimated |
| `hearing_failure_reasons.csv` | 14 | Counts across 10 failure reasons per type |
| `sample_causelist_2026-09-22.csv` | 90 | A real day: validate our output's shape (size, type mix) |

**Roster columns:** `case_number, filing_number, filing_date, advocate_id, party_id, current_stage, last_hearing_summary, purpose_of_next_hearing`, 14 × `hearings_<type>`, `total_hearings_held`.

**Facts about the sample:**

- One advocate and one party per case. 42 advocates; the busiest has 6 cases.
- Ages run from 1 month to 9.9 years; 30% are 4y+.
- The median case has had 25 hearings.
- Every case is an `ST/…` summary trial, mostly NI Act s.138.
- The resampled 3,000 roster has only 100 distinct case shapes. Advocates are redrawn at random, about 2.4 cases each, so clustering has little to bite on. Say so in `SUBMISSION.md`.

**Quirks to handle, not fix:**

- 3 rows read "convicted… sentenced" but are still pending; exclude them as awaiting disposal entry.
- Stage and purpose use Title Case in the roster and `UPPER_SNAKE` in the other files; normalise to `UPPER_SNAKE`.
- One causelist row has no case number.
- The brief says the causelist includes attendance and order text, but the CSV doesn't.

## 4. Domain: stages and hearing types

```mermaid
flowchart LR
  AD[ADMISSION] --> CO[COGNIZANCE] --> AP[APPEARANCE] --> PL[PLEA] --> EX[EXAMINATION_S351] --> EC[EVIDENCE_COMPLAINANT] --> EA[EVIDENCE_ACCUSED] --> AR[ARGUMENTS] --> JU[JUDGEMENT]
  AD -.->|filed late| DC[DELAY_CONDONATION] -.-> CO
  AP -.->|accused absent| WA[WARRANT] -.-> PL
```

**Side types** can interrupt any stage and return to `current_stage` when done:

- `BAIL`: only before `EVIDENCE_COMPLAINANT`.
- `REPORTS`: mediation reports.
- `APPLICATION_REVIEW`: miscellaneous applications (CMPs).

**Transition rules for the simulator** (assumptions; state them):

| On a substantive hearing of | Case moves to |
| --- | --- |
| A mainline stage | The next mainline stage |
| `DELAY_CONDONATION` | `COGNIZANCE` |
| `WARRANT` | `PLEA` (the accused has been produced) |
| `APPEARANCE` | `PLEA` |
| `PLEA` | 10% guilty plea → `JUDGEMENT`; otherwise `EXAMINATION_S351` |
| `JUDGEMENT` | **Disposed** |
| A side type | Back to `current_stage`. `REPORTS` also carries a 30% chance of settlement → disposed |

On a non-substantive hearing:

| Hearing | What happens |
| --- | --- |
| `APPEARANCE` failed twice for accused absence | → `WARRANT` |
| Anything else | The purpose stays the same |

## 5. Reference parameters (derived from the provided data)

**How the failure reasons are grouped.** For each type, the substantive probability `s` comes from their table. Non-substantive hearings (1 − s) are split by the failure-reason counts into three groups, and each group lands somewhere different in our model:

| Group | Reasons it covers | Where it lands |
| --- | --- | --- |
| **Prerequisite** | Awaiting process/summons/warrant return; external dependency | The **eligibility gate**, not a probability |
| **Not heard** | Petitioner absent, respondent absent, both absent; court administrative issue; court holiday; unclear (conservatively counted here) | `p_heard` |
| **Heard, not effective** | Party sought time; evidence or filing not ready | `p_effective` |

**The formulas.** With `pp` = (1 − s) × prerequisite share and `pn` = (1 − s) × not-heard share:

```latex
p_{heard} = \frac{1 - pp - pn}{1 - pp} \qquad p_{effective} = \frac{s}{1 - pp - pn} \qquad s_{eligible} = \frac{s}{1 - pp}
```

**The gap and priority fields.**

- `ideal_gap` = their "time to next hearing".
- `min_gap` = max(3, ideal ÷ 2) (assumed).
- `priority` = position in the lifecycle (Judgement highest), with Bail high because liberty is at stake. Side types sit mid-table (assumed).

| Type | Min | Ideal gap | Min gap | s % | Prereq-blocked % of listings | p_heard | p_effective | s if prereq gated % | Mean hearings/case |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ADMISSION | 5 | 5 | 3 | 48.6 | 26 | 0.77 | 0.86 | 66 | 2.12 |
| COGNIZANCE | 10 | 14 | 7 | 90.0 | 7 | 0.96 | 1.00 | 96 | 1.14 |
| DELAY_CONDONATION_HEARING | 5 | 5 | 3 | 29.3 | 12 | 0.61 | 0.55 | 33 | 3.37 |
| APPEARANCE | 10 | 21 | 10 | 40.1 | 23 | 0.58 | 0.89 | 52 | 3.26 |
| WARRANT | 10 | 21 | 10 | 13.5 | 71 | 0.49 | 0.94 | 46 | 5.02 |
| PLEA | 15 | 14 | 7 | 90.0 | 0 | 0.92 | 0.98 | 90 | 1.57 |
| EXAMINATION_UNDER_S351_BNSS | 30 | 14 | 7 | 40.7 | 15 | 0.74 | 0.65 | 48 | 2.96 |
| EVIDENCE_COMPLAINANT | 30 | 14 | 7 | 29.4 | 4 | 0.54 | 0.57 | 31 | 6.78 |
| EVIDENCE_ACCUSED | 30 | 14 | 7 | 16.7 | 0 | 0.61 | 0.27 | 17 | 6.42 |
| ARGUMENTS | 30 | 14 | 7 | 13.0 | 0 | 0.65 | 0.20 | 13 | 3.69 |
| JUDGEMENT | 30 | 21 | 10 | 100.0* | 0 | 1.00 | 1.00 | 100 | 3.58 |
| BAIL | 15 | 14 | 7 | 31.3 | 0 | 0.44 | 0.72 | 31 | 2.53 |
| REPORTS | 10 | 45 | 22 | 8.3 | 68 | 0.32 | 0.83 | 26 | 4.26 |
| APPLICATION_REVIEW | 10 | 5 | 3 | 85.0* | 0 | 0.95 | 0.89 | 85 | 1.0 |

\* Estimated by the organisers. Cognizance, Plea, Judgement and Application Review rest on 3–5 failures each, so treat them as rough. Compute this table in code from the CSVs, not by hand, so it updates if they revise the data.

**Two checks that make the model credible:**

1. **The capacity model reproduces the case study.** Cost each listing at `minutes × p_heard`, over the roster's mix of next purposes. Then **about 30 listings fill 420 expected minutes**, which is exactly the case study's 30-a-day. Lead the walkthrough with this.
2. **The prerequisite gate is the biggest lever, and L1 is enough to pull it.** Not listing a case whose process hasn't returned lifts the substantive rate of what gets listed:
   - Warrant from 13.5% to about 46%
   - Reports from 8% to about 26%
   - Admission from 49% to about 66%
   - Appearance from 40% to about 52%

**Prerequisite state per case** (assumption):

- **Pending at the start** if `last_hearing_summary` matches process keywords: `await`, `return of warrant/summons`, `issue NBW/warrant/summons`, `take steps`, `notice`. 23 of the 100 match.
- **Otherwise pending** with probability = the type's prerequisite share.
- **Resolves** each day with probability 1 ÷ ideal gap, so process comes back after about one ideal gap on average.

## 6. The L1 algorithm

Every stage is a pure function `(state, config) → result + reasons`. Stages never read each other's internals.

1. **Eligibility (hard gates, each exclusion logged with its reason).**
   - A sitting day for this judge (calendar + leave).
   - The case isn't disposed.
   - Its prerequisite isn't pending.
   - At least `min_gap` days since it was last heard.
   - It isn't booked for another date.
2. **Score (transparent weighted sum; each term becomes a line of the why-trail).**
   ```
   score = w_age·age_points + w_purpose·priority + w_overdue·days_past_ideal_date
         + w_adj·hearings_at_current_stage + w_fresh·is_fresh + w_bail·is_bail
   ```
   `age_points`: <1y = 0, 1–3y = 1, 3–4y = 2, 4–5y = 3, 5y+ = 5.

   `hearings_at_current_stage` comes from the roster's `hearings_<stage>` column. It stands in for "stuck".
3. **Capacity.** The day is 420 minutes, split into blocks. `budget = block_minutes × listing_factor`, and each case costs `minutes × p_heard`. A daily cap backstops it.
4. **Assign (greedy).** Place cases in this order:
   1. Cases booked for today.
   2. Starvation guard: cases that were near-missed K days running, up to 20% of the day.
   3. Locked ageing quota: oldest 4y+ cases until they hold 30% of the day's budget.
   4. Fill each block in its own sort order (score, oldest or newest).
   5. With clustering on, pull up to 4 of the same advocate's other eligible matters into the same day and block.
   6. Record near-misses: the next N cases by score that weren't listed.
5. **Windows.** Within each block, group cases by advocate and put shorter ones first. Walk the expected minutes to give each case a published one-hour window on the half hour, for example 14:30–15:30.
6. **Next date (after each hearing).**
   - Target = hearing date + ideal gap for the new purpose. Move it to the first sitting day with budget left, preferring a day within ±3 days where the same advocate already has matters.
   - Under Sehgal's rollover, an unheard case goes to the same weekday next week.
   - Cases younger than 4y may book only 70% of a future block, which keeps the quota's room free.

**Locked rules.** These are constants, not config: the loader clamps presets to them, and tests enforce them.

| Rule | Value |
| --- | --- |
| Ageing quota | ≥ 30% of the daily budget for 4y+ cases |
| `w_age` floor | ≥ 3 |
| Starvation guard | K = 3 near-misses; forced cases take ≤ 20% of the day |
| Listing-factor ceiling | ≤ 1.3 |

**Presets.** These are re-cast for 14 types and 420 minutes. The blocks are 10:00–13:30 and 14:00–17:30, 210 minutes each (assumed).

| Preset | Rules |
| --- | --- |
| **Sehgal** (block scheduler) | Morning: procedural types (Admission, Delay Condonation, Cognizance, Appearance, Warrant, Plea, Bail, Reports, Application Review), sorted newest first. Afternoon: Examination, both Evidence types, Arguments and Judgement, sorted oldest first. Rollover on |
| **Dimakar** (clusterer) | Evidence, Arguments and Judgement days on Mon/Wed/Fri; procedural days on Tue/Thu. Clustering on; high `w_age` |
| **Joshi** (fresh first) | Asks for `w_age = 0` and `listing_factor = 1.6`. Both are clamped (to 3 and 1.3), which is the demo that locked rules hold |

## 7. Simulator, baseline and metrics

**Simulator.** Run over the calendar's sitting days from the start date for about 2.5 months (≈ 50 sitting days), with a seeded RNG. Each listing plays out in day order:

1. **Reached?** Only if the day's minutes remain.
2. **Attended?** With probability `p_heard`.
3. **Substantive?** With probability `p_effective`, provided the prerequisite is met.

| Outcome | Minutes it uses |
| --- | --- |
| Attended | The type's full duration |
| Reached, not attended | 2 minutes (a call-out) |
| Listed with a pending prerequisite (baseline only) | 2 minutes, never substantive |

After each outcome, apply the §4 transitions and the next-date rule, then resolve pending prerequisites.

**Status-quo baseline.** List 30 a day: booked cases first, then filing order. No gates. Attempt in order until time runs out. Next date is a flat +60 days, moved to the next sitting day.

A second baseline at 90 a day matches the sample causelist's size.

**Metrics.** Print these for every run, as L1 against the baseline:

| Metric | Definition |
| --- | --- |
| Utilisation | Minutes spent on reached hearings ÷ (420 × sitting days) |
| Reach rate | Reached ÷ listed |
| Substantiveness | Substantive ÷ reached |
| Backlog-age impact | Share of cases that were 4y+ at the start and were heard at least once in the run. Also the 4y+ and 5y+ pending trend |
| Predictability | Mean days from the date a case was first scheduled for its current purpose to the date it was actually heard |
| Next-date sanity | Mean \|actual gap − ideal gap\|, and the share of next dates within [min gap, 2 × ideal] |
| Extras (ours) | Disposals, matters per advocate trip, prerequisite-blocked listings avoided |

## 8. Upgrade path

| Seam | L1 | L2 | L3 |
| --- | --- | --- | --- |
| `duration(case)` | Table minutes | Sampled, e.g. a lognormal around the table value | Unprepared parties run longer |
| `p_heard(case)` | Per type (§5) | Adjusted by case history (repeat absences from `hearings_*` and the summary text) | Litigant and advocate agents decide |
| `plan_day` | Greedy | CP-SAT with the same objective and locks; re-plan daily | Judge agent reorders within the locks |
| `next_date` | Ideal gap | Gap from observed process-return time | Agents accept or ask for another date |
| Levers | Listing factor, clustering, presets | Reminders or cover pages raise `p_effective`; costs deter adjournment requests | Agents respond to them |

**Lessons from v1's L3 (Laya).**

- Zero-shot, Laya barely responded to levers.
- It took about 1.25 s per decision on CPU, and needed a cache and a sidecar.
- For the rebuild, simple rule agents are enough to *show* L3.
- Laya is worth revisiting only once it has a GPU and has been fine-tuned on attendance data.

## 9. The app (one Streamlit page, four tabs)

1. **Causelist.** Pick a preset and a day. Show each block's listings with window, case, purpose, advocate, age, score and why. Show the excluded cases counted by reason, which puts the prerequisite gate on screen. Show expected minutes against 420, and the 4y+ share against the quota.
2. **Insights.** Cases by age bucket and by stage. Cases stuck at one stage (most hearings at their current stage). Prerequisite-pending cases. Advocates with the most matters.
3. **Simulate / what-if.**
   - Sliders: listing factor, clustering on/off, rollover, weights. Overrides go through the clamping loader.
   - A metrics table of L1 vs baseline.
   - Charts: 4y+ backlog over time, and reach rate per day.
   - The cost of the override, as a metric delta against the preset's default.
4. **Rules.** The preset's YAML, clamp warnings, locked rules and the derived §5 table.

**Charts:** L1 is blue `#2a78d6`, baseline orange `#eb6834`, lines 2 px, with a legend. No dual axes.

## 10. Outputs

`proposed_schedule.csv`, one row per listing. It follows the sample causelist's shape, then adds ours:

`Case Number, Filing Number, Hearing Type, Hearing Date, block, window_start, window_end, score, why, advocate_id, age_years`.

Plus `metrics.csv` (L1 vs baseline) from the CLI.

## 11. Project layout and commands

```
submissions/<team>/
  SUBMISSION.md            # the 8-section template, filled in
  proposed_schedule.csv
  metrics.csv
  Dockerfile  docker-compose.yml  requirements.txt  pyproject.toml
  app.py                   # Streamlit
  scheduler/               # models, config (locks), reference (§5 derivation), roster (CSV → Case),
                           # eligibility, scoring, capacity, assign, slots, next_date
  sim/                     # simulate, baseline, metrics (DuckDB SQL)
  presets/                 # sehgal.yaml dimakar.yaml joshi.yaml
  cli.py                   # plan + simulate + write the CSVs
  tests/                   # locked rules, §5 derivation, loader, metric definitions
```

Mount the organisers' repo root read-only at `/org` (compose volume `../..:/org:ro`), so the code reads `/org/data/*.csv` and can run `/org/scripts/generate_roster.py`. Generated rosters go into our own folder (`./work`, mounted at `/work`).

```bash
docker compose up -d --build app                  # http://localhost:8501
docker compose run --rm app pytest -q
docker compose run --rm app python cli.py --preset sehgal --start 2026-10-01 --days 50 --out .
docker compose run --rm app python /org/scripts/generate_roster.py --num-cases 3000 --seed 42 \
        --base /org/data/roster_sample_100.csv --out /work/roster_3000.csv
```

- **Stack:** Python 3.12, DuckDB, pandas, Streamlit, Plotly, PyYAML, pytest. All OSI-licensed.
- Everything runs in Docker.

## 12. Lessons from v1

- **Starvation guard.** Counting every skip forces the whole backlog in. Count only near-misses: eligible cases ranked just below the cut.
- **Age weight vs block purpose.** The age weight swamps a block's intent (old cases took Sehgal's morning "fresh" block). Give each block its own sort order.
- **Honest trade-off.** The status quo lists the oldest files first and overbooks, so it can dispose of more final-stage cases even though most listings fail. Show this; tune the afternoon block and weights rather than hiding it.
- **Old cases keep growing.** A 2.5-month run always has cases ageing *into* 4y+. Report "4y+ heard at least once" (their metric) next to the trend.
- **Keep the story to one courtroom.** Cross-courtroom advocate clashes are invisible to one judge's scheduler. Keep it out of scope and say so.
- **DuckDB and Streamlit gotchas.**
  - Don't `CREATE TABLE x AS SELECT * FROM x` from a DataFrame named `x`; register DataFrames under distinct names.
  - Cast mixed-type columns to `str` before `st.dataframe` (Arrow).
- **Headless smoke test.** `streamlit.testing.v1.AppTest` renders every preset and catches exceptions without a browser.

## 13. Build order (timeboxed for the day)

| # | Step | Done when |
| --- | --- | --- |
| 1 | Scaffold, Docker, read CSVs via DuckDB; `reference.py` derives the §5 table | Test reproduces the §5 table and the ~30-listings check |
| 2 | `roster.py`: CSV → `Case` (normalise codes, prerequisite inference, quirks) | 100 and 3,000 rosters load; counts match §3 |
| 3 | Stages 1–6 + locks + 3 presets | Locked-rule tests pass for every preset |
| 4 | Simulator + both baselines + 6 metrics + `cli.py` | `metrics.csv` and `proposed_schedule.csv` written |
| 5 | Streamlit, 4 tabs | AppTest renders every preset with no exceptions |
| 6 | `SUBMISSION.md`, screenshots, fork, branch, PR | PR open by 4:30 |
| 7 | *(optional)* L2 sampled duration + daily re-plan; rule agents for L3 | Metrics show the delta |

## 14. Open questions for the organisers

- [ ] Is there a fuller sample causelist, with attendance and order text?
- [ ] Deadline: 4:30 PM or 5 PM?
- [ ] Horizon: 2.5 or 3 months?
- [ ] Is 420 minutes net judicial time, or the whole sitting day?
- [ ] The data is a magistrate court's NI Act summary trials, while the story is a High Court. Should anything High Court-specific stay out?
- [ ] Is court staff the same as the Court Master?
