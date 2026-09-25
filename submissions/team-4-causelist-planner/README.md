# Causelist Planner

A decision support tool for one High Court judge's causelist. It drafts the next 60 days of listings, and on each hearing day it helps the judge choose each case's next date. It shows the options, the room left on each day and the knock-on effect of a choice before anything is saved.

The judge makes the scheduling decisions. The tool drafts, measures and warns.

## Approach

### A simplified allocation algorithm

This is a proof of concept, so the allocation is kept simple on purpose. It is a greedy forecast, not an optimiser (`planner/forecast.py`):

1. **Fixed bookings go first.** These are published causelists (frozen once out) and dates the judge has set.
2. **Each sitting day is filled in score order** up to 390 expected minutes. The other 30 minutes of the 420-minute day are kept for ad-hoc work such as urgent mentions, fresh bail or a hearing that runs over. Up to a third of the day goes first to short procedural matters (≤ 15 min).
3. **Score** = 3 × age points + purpose priority + 0.2 × days waiting + 1 if the case has had more hearings at its stage than the median. Every term is shown in the listing's "why".
4. **A listing books the case's follow-up** no earlier than the usual gap for its purpose.

A listing costs its hearing minutes × the chance the hearing goes ahead. That chance is derived from the failure reasons in the data. At about 28 listings in the 390 planned minutes, this matches how a real day runs.

The forecast is never stored. It is re-derived from the roster plus the judge's decisions, so it updates after every decision. The full design, assumptions and figures are in [docs/causelist-planner.md](docs/causelist-planner.md).

### The judge decides, not the algorithm

We chose a decision support system over one where the algorithm fixes the schedule. The judge's day runs like this:

1. **7 PM:** the next sitting day's causelist is published from the forecast.
2. **Hearing day:** for each listed case, the judge records what happened (*heard, moved on*, *heard, same stage*, *adjourned*, *not reached* or *disposed*), the next purpose and the next date.
3. **Close the day:** any case not taken up moves to its nearest date with room, and the next day's list is published.

The model proposes dates, and the judge can accept one or pick any other sitting day.

## Decision support on the hearing-day desk

### Key indicators

- **The day:** cases listed, decided and still to decide, and the expected minutes booked against the 390-minute plan.
- **The case:** age (and age bucket), current stage, the purpose it is listed for, and hearings so far. Hearings at this stage are shown against the median for that stage. The desk also shows the share of hearings of this purpose that move a case on, and the usual reasons they don't.
- **Case history:** the last hearing summary, a bar chart of hearings held by type, and the advocate's other listings in the forecast. A date on one of those days saves the advocate a trip.
- **Flags:** a warning when the last summary mentions process that may still be out (warrant, summons or notice).

### Date options

| Option | What it is |
| --- | --- |
| **Earliest** | The hearing day plus the usual gap for the next purpose, moved to the next sitting day |
| **Nearest with room** | The first sitting day from the earliest that has enough free minutes without moving anyone |
| **Model's best fit** | The forecast is re-run with the case fixed on each candidate day, and the day with the lowest cost is kept. Cost = Σ (1 + age points) × days late, for this case and every case it pushes later |

The expected hearing time is filled in from the reference table, and the judge can overwrite it. The override feeds every figure above.

### The availability heatmap

A one-row heatmap covers the 30 sitting days around the best fit. Each day shows whether this hearing fits: **✕ full**, **! tight** (fits with under 30 minutes to spare) or **✓ room**. Marker rows show the best fit ★, nearest with room ◆ and earliest ▲. They also flag days before the usual gap ◀ and days more than twice the gap ▶. Each state has its own symbol, so none depends on colour alone.

Hovering a day shows what is booked there, the minutes free, whether this hearing fits, the distance from today against the usual gap, the model's cost if that day was tried, and whether the same advocate already has matters there.

### Information and warnings about the chosen date

When the judge proposes a date, the desk reports on it before the decision is confirmed:

- **Calendar:** only sitting days are offered. Weekends and holidays are refused, and the skipped holidays are named.
- **Gap:** a warning if the date is earlier than the usual gap for the purpose, or more than twice it.
- **Room:** "Fits", with the minutes free before and after, or "Not enough time", with a note that lower-priority listings will move.
- **Impact:** how many cases move later and by how many days in total, and how many of them are 4 years old or more. A table lists each moved case with its old and new date.
- It also notes the cases that move earlier into freed time, and how long this case waits past its earliest date.
- **Horizon:** a note when the date is beyond the 60-day forecast, so no impact can be worked out.
- **Calendar end:** an error when the court calendar ends before the earliest date for the purpose.

### Forecast charts for future dates

The **Forecast · next 60 days** tab shows:

- **Headline figures:** listings, cases with a date, cases with no date in 60 days, the share of 4-year-plus cases listed at least once, and overbooked days. Only fixed bookings can overbook a day. The forecast never does.
- **A stacked bar chart of expected minutes per sitting day,** by case age (darker = older). Published and judge-set bookings are hatched. Lines mark the 390-minute plan and the full 420-minute day, and the space between them is the ad-hoc buffer. A table view gives the same figures.
- **A day picker** that lists any day's draft causelist, with score, status and the "why" for each case.
- **A CSV download** of the draft causelist, and a comparison of the draft's purpose mix with a real causelist.

## The advocate's read-only view

When the demo sign-in is set to **Advocate**, the app shows the same desk, read-only, for one advocate's cases. Advocates see the earliest, nearest and best-fit dates, the availability heatmap and the impact of any date they suggest. They can then discuss a planned date with the judge using the same figures.

- **My cases** gives the status of each case: listed today (with the judge's decision once made), its next forecast date, no date in 60 days, or disposed.
- **Next purpose** is the only input, so the advocate can see the dates for the purpose they expect.
- **Forecast · my cases** lists their cases in the 60-day draft.
- Nothing the advocate does is saved. Outcomes, confirming and closing the day are left to the judge.

## Data

The planner runs only on the dataset in `provided/` (six CSVs and a roster generator). The **Roster** picker offers three rosters:

- **Sample:** 100 cases.
- **3,000:** 3,000 cases from the provided generator.
- **Synthetic:** 225 cases by default, simulated from `provided/` by `planner/synth.py`. Each case's lifecycle is simulated rather than copied from sample rows.

```bash
docker compose exec -T app python -m planner.synth --num-cases 225 --seed 7 --out data/roster_synthetic.csv
```

Decisions and published lists are kept per roster in `data/causelist.duckdb`. **Start over** resets a roster.

## Quick start

You need Docker with Compose. Nothing is installed on the host.

```bash
docker compose up -d --build app      # the app at http://localhost:8501
```

Choose **Judge** in the sidebar sign-in for the planner, or **Advocate** for the read-only view.

```bash
docker compose --profile test build test   # build the test image (rebuild after code changes)
docker compose run --rm test               # run the tests

docker compose --profile agents up -d --build laya app   # also start the Laya sidecar (optional)
docker compose down                                      # stop everything
```

On first start the app also builds `data/court.duckdb` for the older code described below, so the first load takes a little longer.

## Technical architecture

| Component | Role |
| --- | --- |
| **Docker / Docker Compose** | Builds and runs everything. The `app` service is the web app, `test` runs pytest, and `laya` is an optional sidecar under the `agents` profile. `./data` is mounted for state and caches |
| **Python 3.12** | All the code: the roster loader, the reference derivation, the forecast, the date options and the store (`planner/`) |
| **Streamlit** | The web UI (`app.py`, `views/planner.py`): the sign-in, the desk and the forecast tabs |
| **Plotly** | The charts: the availability heatmap, the day-load bars and the hearing-history bars (`views/charts.py`) |
| **DuckDB** | Reads the provided CSVs and stores the desk's state (`data/causelist.duckdb`) |
| **pandas** | Tables for the UI and the CSV export |
| **Laya** (Apache-2.0, CPU PyTorch) | An open decision-model server in its own container (`laya/Dockerfile`). The current planner doesn't use it. The container is built and started only with `--profile agents` |

All dependencies are open source. The app talks to Laya over plain HTTP with the standard library, so the app image has no ML dependencies.

```
provided/*.csv ──> planner/reference.py, roster.py ──> planner/forecast.py (greedy draft)
                                                      │
                  planner/store.py (decisions, ◀──────┤
                  published lists, close day)         ▼
                                              planner/desk.py (earliest, nearest,
                                              best fit, impact)
                                                      │
                                                      ▼
                                   views/planner.py + views/charts.py (Streamlit)
```

## Other code in the repository

The repository also holds code from earlier builds. It is not part of the planner, and it needs refactoring before the codebase matches the rebuild.

- **The initial build:** `scheduler/` (a staged pipeline of eligibility → scoring → capacity → assign → slots), `sim/` (simulation against a status-quo baseline), `datagen/` (a synthetic court dataset), `presets/` (judge styles) and the persona views in `views/` (calendar, decision lineage, .ics export). Its judge tabs and advocate page are hidden behind `SHOW_OLD_JUDGE_TABS` and `SHOW_OLD_ADVOCATE_PAGE` in `app.py`. The **Court Master** and **Litigant** roles in the sign-in still open its pages on the synthetic data.
- **The Laya integration:** `agents/` and `laya/`. Judge, advocate and litigant agents act on the causelist, with decisions from Laya for a Jev-like experience and a rule fallback when Laya is down. See [docs/L3-agents-laya.md](docs/L3-agents-laya.md).

Planned refactoring: remove or split out these modules and the synthetic dataset, and trim `app.py` and the sign-in to the planner's two roles (Judge and Advocate).
