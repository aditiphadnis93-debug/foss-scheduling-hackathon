# Causelist Planner (Provided Data Only)

The simplified build from `docs/rebuild-plan/rebuild-base-plan.md`. It is the **Causelist planner** tab, the first tab in the Judge view. It runs on the organisers' six CSVs alone, copied unedited into `provided/`, and never reads the synthetic court dataset (`datagen/`). Its third roster, **Synthetic**, is simulated from `provided/` too (see below).

## The judge's day

1. **7 PM:** the next sitting day's causelist is published, taken from the forecast. It is frozen, and nothing can displace it.
2. **Hearing day:** the judge takes each listed case and records:
   - what happened: *heard, moved on*, *heard, same stage*, *adjourned*, *not reached* or *disposed*
   - the next purpose, with a default from the lifecycle
   - the next date
3. **Close the day:** any case not taken up goes to its nearest date with room, and the next day's list is published.

State (the hearing day, decisions and published lists, per roster) lives in `data/causelist.duckdb` (`$CAUSELIST_DB`). The forecast itself is never stored. It is re-derived from the roster plus that state.

## Decision support for a next date

| Shown | How |
| --- | --- |
| **Earliest** | Hearing day + `Time to next hearing given this is the purpose (days)`, moved to the next sitting day |
| **Nearest with room** | The first sitting day from the earliest with enough free expected minutes, without moving anyone |
| **Model's best fit** | Re-runs the forecast with the case fixed on each candidate day, from the earliest to max(2 × gap, 14) days on (at most 12 days), and keeps the lowest-cost day |
| **Judge's proposal** | Any sitting day after today. The desk warns if it is earlier than the gap and refuses a holiday or weekend. It then says whether the day has room and, if not, which cases move later and by how many days |

**Hearing time.** A box is filled with the table's minutes for the next purpose, and the judge can overwrite it. The judge's figure replaces the table's in the booking cost (minutes × `p_heard`). That cost drives the nearest date, best fit, impact and free-minutes figures. The override is stored with the decision (`decision.minutes`) and carried onto the published list (`published.minutes`). Only that one hearing uses it; later repeat listings go back to the table's time.

**Cost** = Σ (1 + age points) × days late. This counts the case's own days past its earliest date, and every day it pushes another case later. Cases that move earlier are reported but not credited.

## The advocate's view (read-only)

When the demo sign-in is set to **Advocate**, the app shows the same desk, read-only and limited to one advocate's cases. Lawyers don't decide. They use the same figures to discuss next dates with the judge. The plan is in `docs/rebuild-plan/lawyer-view-plan.md`.

- **Sidebar:** the roster, then the advocate (`advocate_id` from the roster). Advocates with a case on the hearing day's list come first.
- **My cases:** every one of the advocate's cases, with its status: listed today (and the judge's decision, once made), its next forecast date, no date in 60 days, or disposed.
- **A case listed today** opens the judge's facts panel. Next to it:
  - Once the judge has decided the case, the decision is shown.
  - Until then, a **Next purpose** picker is the only input. It defaults to the lifecycle step after the listed purpose.
  - It is followed by the same earliest, nearest-with-room and best-fit dates, the availability strip, "Propose another date" and its impact.
- **Forecast · my cases:** the advocate's listings in the 60-day draft.
- **Hidden:**
  - the outcome and hearing-time inputs
  - notes, Confirm, Change this decision, Close the day and Start over
  - the court-wide forecast charts
  - every download, and the older synthetic-data advocate page (calendar, clashes, .ics). `SHOW_OLD_ADVOCATE_PAGE` in `app.py` brings that page back.
- **Nothing is written** to `data/causelist.duckdb`. The only exception is on a fresh file: the first visit sets up the desk, exactly as the judge's first visit would.

## The forecast (greedy, `planner/forecast.py`)

- **Fixed bookings are placed first:** published lists and dates set by the judge. They may overbook a day; the forecast itself never does.
- **Each sitting day is then filled in score order, up to 390 expected minutes.** Of the 420-minute day, 30 minutes are never planned: they are kept for ad-hoc work (urgent mentions, fresh bail, a hearing that runs over). `PLAN_MINUTES` / `BUFFER_MINUTES` in `planner/reference.py`. The forecast, close-day moves and the desk's "room" all use 390. A day past 390 counts as overbooked (only fixed bookings can do that).
  - Up to a third of the day goes first to short procedural matters (≤ 15 min).
  - Score = 3 × age points (<1y 0, 1–3y 1, 3–4y 2, 4–5y 3, 5y+ 5) + purpose priority + 0.2 × days waiting + 1 if the case has had more hearings at its stage than the type's median.
  - Every term appears in the listing's "why".
- **A listing books the case's follow-up** no earlier than day + gap, with the same purpose.

## Assumptions (state them in `SUBMISSION.md`)

- **Booking cost** = est. minutes × `p_heard`.
  - `p_heard` comes from the failure-reason mix (rebuild-spec §5): prerequisite failures are set aside, and absences, court issues and "unclear" count as not heard.
  - This reproduces the case study's ~30 listings in 420 minutes (about 28 in the 390 we plan).
- **Purpose priority** isn't in the data. We assume Judgement 10, Bail and Arguments 9, then down the lifecycle, with side types in the middle.
- **Repeat listings hold the purpose,** because the outcome isn't known ahead.
- **Existing next dates are ignored** (the brief allows it). Every case is available from the first hearing day.
- **Rows whose summary records a conviction and sentence are excluded,** as awaiting a disposal entry. There are 3 in the sample and 89 in the 3,000 roster.
- **A summary that mentions pending process** (warrant, summons, notice) is flagged on the desk but not gated.
- **The 3,000 roster** is the organisers' `generate_roster.generate(3000, 42, …)`, called in-process.
  - It has only 100 distinct case shapes.
  - Advocates are redrawn at random.
- **The synthetic roster** is simulated, not resampled (next section). 2 of its 225 rows are excluded as awaiting disposal.
- **The horizon** is 60 calendar days, cut at the calendar's end (31 Dec 2026).

## Numbers (start Fri 25 Sep 2026)

Planning 390 of 420 minutes a day.

| | 100-case sample | 3,000 roster | Synthetic 225 (seed 7) |
| --- | --- | --- | --- |
| Listings a day | 0–37, with gaps once the docket is booked | 23–50; every day full | 0–48; ~60% of days full, the rest with an hour or more spare |
| Forecast run | ~0.1 s | ~0.2 s | ~0.01 s |
| Best fit (12 candidates) | ~0.1 s | ~2.5 s, cached per decision | ~0.1 s |

The forecast chart stacks each day by case age (darker = older; oldest at the bottom), with published and judge-set bookings hatched. Its table view gives the same minutes by day and age.

**Why 3,000 fills every day.** One listing of each of the ~2,900 cases costs ~40,000 expected minutes, which is about 100 planned days against 39 sitting days in the horizon. Room only appears when the docket is small enough for every case to be listed and come back within its gap. That happens at about 300 cases or fewer. The spare time comes in waves (cases booked together return together, 14 or 21 days on), not at random.

## Synthetic roster

The third choice in the Roster picker. `planner/synth.py` simulates each case's lifecycle instead of copying sample rows. It defaults to **225 cases**, so the forecast has buffer hours on some days. At 3,000 it gives about 2,500 distinct shapes, where the organisers' resample has 100. It writes the same columns as `roster_sample_100.csv`. It is calibrated on `provided/` only:

| Column(s) | How |
| --- | --- |
| `current_stage` | The sample's stage mix, plus a pseudo-count of 2 per stage so thin stages (Plea, Cognizance) appear |
| `hearings_<stage>` | Each passed mainline stage: min + negative binomial, fitted to `hearing_type_reference.csv` (mean matched, dispersion picked for the median, clipped to max). The current stage is part-way through its draw. Stages after it are 0 |
| Branches | Delay Condonation taken by 60% of cases, Warrant by 80% (the sample has both on nearly every advanced case) |
| Side types | Past Appearance: Bail 8%, Reports 12%, Application Review 6% have a history |
| `filing_date` | Walked back from the calendar's first day: intake lag (~120 days) + mainline hearings × `gap_days` × a per-case pace (lognormal, median 2.5). The stage→age medians match the sample's |
| `purpose_of_next_hearing` | The sample's stage × purpose counts, plus 0.5 per plausible purpose (stay, move on, side type) |
| `last_hearing_summary` | A Present/Absent line (15% all absent) + a body in the sample's wording for the stage. 10% of Judgement-stage cases record a conviction and sentence, so they are excluded as awaiting disposal |
| `advocate_id` | A pool of n / 2.4 advocates, drawn Zipf-skewed (s = 0.6): the busiest has ~70 cases, the median 2. Clash clustering has something to work on |
| IDs | `ST/<n within year>/<year>`, `KL-<n>-<year>`, `PARTY-<n>`, all unique |

```bash
docker compose exec -T app python -m planner.synth --num-cases 225 --seed 7 --out data/roster_synthetic.csv
```

The app reads `$SYNTH_ROSTER` (default `data/roster_synthetic.csv`). If the file is missing, it writes one with these defaults on first use. A regenerated file is picked up on the next rerun, because the caches are keyed on its mtime. Use **Start over** after regenerating, because decisions are kept by case number. The knobs are constants at the top of `planner/synth.py`.
