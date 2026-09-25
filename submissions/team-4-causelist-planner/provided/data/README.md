# Data

Six files, calibrated to real, anonymised district-court observations (~500 hearings)
and scaled to match the case study's illustrative High Court roster. No real case
numbers, party names, or advocate names appear anywhere here.

| File | Rows | What it is |
|---|---|---|
| `roster_sample_100.csv` | 100 | The docket you schedule against — one row per case, with filing date, current stage, next-hearing purpose, and how many hearings it's had per stage |
| `court_calendar.csv` | 122 | Working days, weekly offs and holidays. Tells you which days are available; it is not itself an input to schedule against |
| `hearing_type_reference.csv` | 14 | Per hearing-type stats: hearings-per-case (min/max/mean/median), estimated duration, and days to next hearing |
| `hearing_failure_reasons.csv` | 14 | Per hearing-type breakdown of why a hearing didn't move the case forward (adjournment reason counts) |
| `substantiveness_by_hearing_type.csv` | 14 | Per hearing-type probability that a hearing of that type is substantive (moves the case forward) rather than adjourned for nothing |
| `sample_causelist_2026-09-22.csv` | 90 | A real day's causelist shape — case number, filing number, hearing type and date — for checking your schedule's output against what an actual cause list looks like |

`hearing_failure_reasons.csv` and `substantiveness_by_hearing_type.csv` carry a `source`
column marked `real` or `estimated`; where estimated, the same column explains the
reasoning (e.g. "modelled on Examination u/s.351 pattern; mostly accused/surety not
ready or absent").

## Scaling the roster

`roster_sample_100.csv` is 100 cases. To generate a bigger roster (up to 3,000), run
from `scripts/`:

```bash
python generate_roster.py --num-cases 3000 --seed 42 --out ../data/roster_3000.csv
```

This bootstrap-resamples whole rows from the 100-case sample (preserving the real
stage/purpose/hearing-count mix and the existing filing-date age spread, including
the 4+ year backlog cases already in the sample) and mints fresh case/filing/party
IDs so nothing collides. It's more of the same mix, not an independently simulated
roster — say so in your submission if you use it.
