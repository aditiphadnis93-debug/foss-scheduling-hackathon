# Provided Data: How It Fits Our Model

How the organisers' repo (`docs/updated-provided-docs/`: the updated brief, six CSVs, a roster generator and the submission rules) maps onto our scheduler, schema and synthetic data. Nothing here has been changed in code yet.

## 1. Summary

The pipeline, the locked rules, the presets and the persona views all survive. The **vocabulary and the numbers underneath them don't**. Our model was built for High Court civil/writ work with 5 made-up hearing purposes. The real data describes a **criminal summary-trial court** (every case is `ST/…`, mostly NI Act s.138 cheque cases) with **11 fixed stages plus 3 side hearing types** and real per-type rates.

What that means in practice:

1. **Replace the placeholder reference table.** Our 5 purposes become their 14 hearing types, each with a real substantive rate, a failure-reason mix, an estimated duration and a gap to the next hearing. `hearing_type` and `adjournment_reason` in `scheduler-schema.sql` already have the right shape.
2. **Load the roster from their CSV** instead of `generate_roster`. It gives filing date, stage, next purpose, advocate, party, per-type hearing counts and the last hearing's summary text. Scale it to 3,000 with their `generate_roster.py`.
3. **Change day capacity to 420 minutes.** Their scoring assumes a 7-hour day; our presets sit 270 minutes.
4. **Adopt their metric definitions.** Their *predictability* and *backlog-age impact* differ from ours (§6).
5. **Package as a PR** into `submissions/<team>/` on a fork of their repo (§8). The deadline is now **5 PM**.

The single biggest finding: **in their data, "awaiting process / summons / warrant return" drives most failures of the commonest hearing types.** It accounts for 82% of failed Warrant hearings, 75% of Reports and 51% of Admission. Our Stage 1 eligibility gate (don't list a case whose prerequisite isn't met) is aimed squarely at that. It is now the strongest, data-backed pitch for L1 (§4.3).

## 2. What changed in the brief

The PDF is the same brief with Section 5 rewritten and a few numbers changed.

| Topic | Before | Now |
| --- | --- | --- |
| Case-study day | 60 listed → 20 heard → 10 effective | **30 listed → 10 heard → 5 effective** |
| Judge's day | Not stated | **7 hours of judicial work** (the README scores against 420 minutes/day) |
| Planning horizon | 3 months | **2.5 months** in §5; "3 months" still appears in §5-E |
| Existing next dates | Not addressed | **"Don't worry about preserving the existing next hearing dates"**: treat the roster as a clean start |
| Deadline | 4:30 PM | **5 PM** in the PDF and CONTRIBUTING. The README still says 4:30 PM, so aim for 4:30 |
| Submission | "A branch ready for merge" | PR from a fork, everything under `submissions/<team>/`, with a structured `SUBMISSION.md` |
| Winners | Work with "real users" | Work with **the Court Master and Justice Sehgal** on DRISTI 2.0 |
| Data framing (§5 A–F) | Datasets "available tomorrow" | 11-stage lifecycle, what each dataset means, and an explicit invitation to sample durations, model attendance as behaviour and vary the levers |

**This resolves an open item in `CLAUDE.md`.** The live plan ignores `court_case.next_hearing_date`, and the brief now says that is fine. Keep it that way, and say so in `SUBMISSION.md`.

## 3. The datasets, file by file

| Provided file | What it holds | Where it goes in our model | Fit |
| --- | --- | --- | --- |
| `roster_sample_100.csv` | 100 cases: `case_number, filing_number, filing_date, advocate_id, party_id, current_stage, last_hearing_summary, purpose_of_next_hearing`, 14 `hearings_<type>` counts, `total_hearings_held` | `court_case` (+ `party`, `advocate`, `advocate_mapping`); `Case` via `store.cases` | **Good.** One advocate and one party per case. No case type, urgency, custody or prerequisite flag; derive those (§5) |
| `court_calendar.csv` | Sep–Dec 2026, daily: weekly off, holiday name, `is_working_day` | `court_calendar` + `is_sitting_day` | **Good.** Our table stores exceptions only (`day_type = 'holiday'`); load the 6 holidays and treat Sat/Sun as off. Replace the hard-coded `holidays()` list in `scheduler/data.py` |
| `hearing_type_reference.csv` | 14 types: min/max/mean/median hearings per case, est. minutes, days to next hearing | `hearing_type` (`est_minutes`, `ideal_gap_days`); hearings-per-case → `additional_details` | **Good, but** no priority, `min_gap_days` or `p_heard`. Derive them (§4) |
| `substantiveness_by_hearing_type.csv` | P(substantive) per type, real or estimated | `hearing_type.p_effective` (after splitting, §4.2) | **Good.** Keep the `source` note in `additional_details` so estimated values stay visible |
| `hearing_failure_reasons.csv` | Counts per type across 10 failure reasons | `adjournment_reason` (10 rows) + per-type weights; split into not heard / heard not effective / prerequisite | **Good.** Our table already has `failure_kind` and `attributable_to` |
| `sample_causelist_2026-09-22.csv` | 90 listings: case no., filing no., hearing type, date | Validation only: compare our causelist's size and type mix | **Partial.** The brief says it includes attendance and order text, but the CSV has only 4 columns. It lists 90 in a day, against the case study's 30 |
| `scripts/generate_roster.py` | Scales 100 → N rows by bootstrap resampling, re-minting IDs and redrawing advocates | Replaces `generate_roster` as the roster source. `datagen` still builds history, parties' names and the other 3 courtrooms around it | **Good**, with limits: only 100 distinct case shapes, and advocates are redrawn at random (§5) |

## 4. Hearing types: 5 placeholders → 14 real types

### 4.1 Lifecycle

```mermaid
flowchart LR
  A[Admission] --> D[Delay condonation<br/>only if filed late] --> C[Cognizance] --> AP[Appearance] --> W[Warrant<br/>if accused absent]
  W --> P[Plea] --> X[Examination<br/>u/s 351 BNSS] --> EC[Evidence<br/>complainant] --> EA[Evidence<br/>accused] --> AR[Arguments] --> J[Judgement]
```

Delay condonation and Warrant are conditional steps. Our flat `NEXT_PURPOSE` map needs two changes:

- **Branches.** Admission → Cognizance when there is no delay, and Appearance → Plea when the accused turns up.
- **Side types** that return to the current stage: **Bail** (only before Evidence Complainant), **Reports** (mediation reports, any stage) and **Application Review** (CMPs, any stage). The roster already separates them: `current_stage` is where the case is, and `purpose_of_next_hearing` can be a side type (9 cases are listed for Application Review).

### 4.2 Parameters per type

"Sub." = the substantive probability they give. The failure columns are shares of *non-substantive* hearings, grouped by what our scheduler can do about them.

| Type | Est. min | Gap (days) | Sub. % | Absent % | Prerequisite % | Court % | Not ready / time sought % | Unclear % |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Admission | 5 | 5 | 48.6 | 14 | 51 | 4 | 16 | 16 |
| Cognizance | 10 | 14 | 90.0 | 0 | 67 | 33 | 0 | 0 |
| Delay condonation | 5 | 5 | 29.3 | 34 | 17 | 0 | 34 | 14 |
| Appearance | 10 | 21 | 40.1 | 35 | 38 | 1 | 8 | 17 |
| Warrant | 10 | 21 | 13.5 | 2 | 82 | 2 | 1 | 13 |
| Plea | 15 | 14 | 90.0 | 60 | 0 | 0 | 20 | 20 |
| Examination u/s 351 | 30 | 14 | 40.7 | 25 | 25 | 0 | 38 | 12 |
| Evidence complainant | 30 | 14 | 29.4 | 47 | 5 | 1 | 32 | 16 |
| Evidence accused | 30 | 14 | 16.7 | 33 | 0 | 0 | 53 | 13 |
| Arguments | 30 | 14 | 13.0 | 8 | 0 | 24 | 60 | 8 |
| Judgement | 30 | 21 | 100.0 | 0 | 25 | 50 | 0 | 25 |
| Bail | 15 | 14 | 31.3 | 42 | 0 | 2 | 18 | 38 |
| Reports | 10 | 45 | 8.3 | 13 | 75 | 0 | 2 | 11 |
| Application review | 10 | 5 | 85.0 | 0 | 0 | 0 | 67 | 33 |

Column groups: Absent = petitioner, respondent or both absent. Prerequisite = awaiting process/summons/warrant, plus external dependency. Court = administrative issue or holiday. Not ready = party sought time, or evidence/filing not ready. Counts behind the Cognizance, Plea, Judgement and Application review rows are 3–5 hearings, so treat those percentages as rough.

**How to fill our fields** (a proposal; each assumption goes into `SUBMISSION.md`):

- `est_minutes` and `ideal_gap_days` are taken as given. §5-B invites sampling duration from a distribution at L2.
- `p_heard` = 1 − (1 − sub) × (absent + court shares). A hearing fails to be *heard* when someone is absent or the court can't sit.
- `p_effective` = sub ÷ `p_heard`, the chance a heard hearing moves the case on.
- **Prerequisite failures don't go into either probability.** They become the Stage 1 gate (§4.3). "Unclear" is spread proportionally.
- `min_gap_days` isn't given. Default to about half the gap, with a floor of 3 days.
- `priority` isn't given. Proposal: later stages first (Judgement highest), because a closer-to-disposal case is worth more court time. Side types sit mid-table. Bail goes high because liberty is at stake.
- The substantive rate and 1 ÷ mean hearings per case roughly agree for most types (Admission 48.6% vs 47.2%). They diverge for Judgement (100% vs 28%), Evidence complainant (29% vs 15%) and Arguments (13% vs 27%). Use the substantive rate for outcomes, and use hearings per case only as a sanity check on how long a case stays at a stage in the simulator.

### 4.3 Why the prerequisite gate matters now

For a Warrant hearing, 86.5% of listings fail, and 82% of those failures are the warrant not having come back. If the scheduler lists a Warrant case only once its process has returned, the substantive rate of what it lists rises from about **13.5% to about 46%** (13.5 ÷ (100 − 86.5 × 0.82)). Reports rise from 8% to about 27%, and Admission from 49% to about 66%. These are the court's own numbers, not ours, and they need only L1 fixed rules.

The catch is that **the roster has no "prerequisite met" flag.** It has to be inferred from `last_hearing_summary`. In the sample, 23 of 100 summaries mention a pending warrant, summons or notice ("Issue NBW… For return of warrant", "Await warrant"). In L1, one of these rules:

- A keyword rule on the summary text: pending until a set number of days have passed, or a simulated "process returned" event fires.
- A per-case draw from the type's prerequisite share.

State whichever we pick as an assumption.

## 5. Roster fields → `Case` and `court_case`

| Roster column | Our field | Notes |
| --- | --- | --- |
| `case_number` (e.g. `ST/819/2023`) | `court_case_number`; `Case.id` | Year in the number ≠ filing year for some rows; keep as display only |
| `filing_number` | `filing_number` (unique) | |
| `filing_date` | `filing_date` | Ages run from 1 month to 9.9 years. By bucket: 14 under 1y, 33 at 1–3y, 23 at 3–4y, 15 at 4–5y, 15 at 5y+. That is **30% at 4y+**, against the 1 in 6 our generator assumed |
| `advocate_id` | `advocate_mapping` → `Case.advocate_ids` | One advocate per case; 42 advocates for 100 cases (top: 6 cases). Their generator **redraws advocates at random**, so a 3,000 roster has about 1,260 advocates with about 2.4 cases each. Clustering has much less to work with than in our synthetic data |
| `party_id` | `party` → `Case.parties` | One party per case, no role and no name. `datagen` can keep minting names and the accused/State |
| `current_stage` | `stage_code` | 11 stage values in title case; normalise to the `UPPER_SNAKE` codes used in the other files |
| `purpose_of_next_hearing` | `next_purpose_code` → `Case.purpose` | 14 values, including side types |
| `last_hearing_summary` | `court_order` text / `case_timeline`; signals for prerequisites, attendance, "last chance" | Parse into flags. In the sample, 40 of 100 show complainant, accused and accused's advocate all absent; 8 say "last chance"; 6 mention mediation or settlement |
| `hearings_<type>` × 14, `total_hearings_held` | `case_stage_history` / `hearing` counts; `adjournment_count` proxy | Median is 25 hearings per case. A proxy: `adjournment_count` = hearings at the current stage − 1 |
| — (not provided) | `case_type`, `nature`, `is_urgent`, `is_in_custody`, `is_on_hold`, `last_heard_date` | All cases are criminal summary trials. Leave the flags false, or derive urgency from Bail / custody, and say so |

**Data quirks to handle, not fix** (we may not edit `data/`):

- 3 rows read "Accused found guilty and convicted… Sentenced…" but are still pending with a next purpose. Treat them as awaiting a formal disposal entry, or exclude them. Either way, state it.
- Several filing numbers in the sample causelist carry a year earlier than their case number.
- One causelist row has no case number.

## 6. Scoring: their definitions vs ours

| Their metric | Their definition (README) | Our `sim/metrics.py` | Change |
| --- | --- | --- | --- |
| Utilisation | % of available minutes (420/day) spent on hearings that were reached | `used_minutes ÷ sitting_minutes` over our blocks (270/day) | Make the day 420 minutes |
| Reach rate | % of scheduled hearings reached before time runs out | `1 − not_reached_rate` | Rename and report |
| Substantiveness | % of reached hearings that move the case forward | `effective ÷ heard` | Same idea. Note "reached" in theirs vs our "heard" (reached and attended) |
| Backlog-age impact | **% of 4+ year cases heard at all** in the run | Count of 4y+ / 5y+ pending at start vs end | **Add** their metric; keep ours as the trend |
| Predictability | **Average days between a case's first scheduled date and when it's actually heard** | `heard ÷ listed` | **Add** theirs. It needs a "first scheduled date" per case in the simulator, which we track through `next_date` |
| Next-date sanity | Not defined in the README, but named | `mean_gap_error_days` against `ideal_gap_days` | Keep. It now compares against their real gap column |

No scoring script is provided ("No SDK, no API"), so we print these five ourselves, from both the app and a CLI entry point.

## 7. Where our model already goes further

Keep these. The brief's §5-F lists them as the levers to test:

| Brief's example lever | Where it already lives |
| --- | --- |
| Change how cases are prioritised | Scoring weights, presets, what-if overrides |
| Change how much of the day you fill | `listing_factor` (capped by the locked ceiling), `max_cases_per_day` |
| Cluster by advocate | `clustering` + stage 5 grouping (weaker on the resampled roster, §5) |
| Gap based on the work required | Stage 6 next-date rule with the ideal gap per type |
| Sample duration instead of fixing it | `capacity.duration()` is the L2 swap point |
| Parties and advocates behave differently | L3 agents (`agents/`) with Laya decisions |
| Re-plan when a hearing overruns or a party doesn't show | The simulator's day loop; daily re-planning is the L2 step |

The persona views, lineage and saved-schedule comparison go beyond what the brief asks, and they answer §6's "visualise insight" directly.

## 8. Submission packaging

- **Fork `aditiphadnis93-debug/foss-scheduling-hackathon`.** Branch `team-<name>`, with everything under `submissions/<name>/`: code, `SUBMISSION.md` (the 8-section template), and `proposed_schedule.csv` or equivalent. Don't touch their `data/`; read it from there.
- **Our repo becomes that folder.** Paths the code resolves (`data/`, `presets/`, `docs/`) must work from `submissions/<name>/`. The Docker setup travels with it.
- **`docs/updated-provided-docs/` is a git clone inside our repo** (it has its own `.git`). Don't `git add` it as-is, or it becomes an embedded repo. Either add it to `.gitignore`, or copy only `data/` into a `data/provided/` folder.
- **No real case numbers, party names or advocate names.** Their data is already anonymised, and our Faker names are synthetic. Check that nothing real leaks into screenshots.
- `SUBMISSION.md` section 6 ("Specs for integration") maps almost one-to-one onto `docs/scheduler-schema.sql` and the store/runs split. It is worth drafting from those.

## 9. Suggested order of work

1. **Loader.** `datagen` reads `roster_sample_100.csv` (or the 3,000-row output of their script) and `court_calendar.csv` instead of `generate_roster` and `holidays()`. Everything else in `datagen` builds around those cases.
2. **Reference tables.** Put the 14 types, the derived `p_heard` / `p_effective` / `priority` / `min_gap_days`, and the 10 failure reasons into `hearing_type` and `adjournment_reason`. Replace `HEARING_TYPES`, `NEXT_PURPOSE` (branches plus side types), `ADJOURNMENT_REASONS` and `PURPOSE_CHECKLIST` in `scheduler/data.py`, and move them to data where possible.
3. **Presets.** Block purposes switch to the new codes. Blocks cover 420 minutes.
   - Sehgal: fresh work (Admission, Appearance, Warrant) in the morning; oldest Evidence, Arguments and Judgement after lunch.
   - Dimakar: his arbitration-only filter no longer matches anything. Re-cast him as purpose-by-day plus advocate clustering, without the case-type filter.
   - Joshi: unchanged.
4. **Prerequisite inference** from `last_hearing_summary`, feeding Stage 1 (§4.3).
5. **Metrics.** Add their predictability and backlog-age definitions, plus a CLI that prints all five against the status-quo baseline.
6. **Validate** against the sample causelist: day size (30 vs 90), type mix and the 30 / 10 / 5 funnel.
7. **Package** into `submissions/<name>/` and write `SUBMISSION.md`.

## 10. Open questions this raises

Answered by the new material:

- Party IDs, and stage vs purpose, are both provided.
- Failure reasons come as 10 codes per hearing type.
- Prerequisites come only as an overall share per type, plus summary text; there is no per-case flag.
- Existing next dates can be ignored.

Still open:

- [ ] The brief says the sample causelist "includes attendance and order text", but the CSV has 4 columns. Is there a fuller file?
- [ ] Deadline: 4:30 PM (README) or 5 PM (PDF, CONTRIBUTING)?
- [ ] The brief frames the case study as a High Court roster, but the data is a magistrate court's NI Act summary trials. Should High Court concepts (benches, writ sections) stay out of the submission?
- [ ] Horizon: 2.5 or 3 months? The calendar covers Sep–Dec 2026.
- [ ] Is 420 minutes the whole sitting day, or judicial time net of breaks?
