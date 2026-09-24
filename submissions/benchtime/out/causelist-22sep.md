# The real causelist of 22 September 2026, scored with PUCAR's own tables

90 matters listed. If every one were heard in full: 1460 minutes of work for a 420-minute day (3.5 times capacity).
Expected minutes once failures are counted (a failed matter takes 2 minutes to call and adjourn): 555.

## Choosing better from this list alone barely helps

| way of running the same list | matters called | expected substantive hearings | expected minutes used |
|---|---|---|---|
| as printed, until the day runs out | 72 | 23.2 | 422 |
| exact best subset of the same 90 | 74 | 23.7 | 415 |

A failed matter costs the bench about 2 minutes, so calling most of a 90-matter list captures most of its value. The bench is not where the waste is.

## The waste is people, and 32% of it is knowable the night before

Expected failed listings on this day: 62.3 of 90. Of those, 20.1 fail because a summons, notice or warrant has not come back or an outside report is not ready (PUCAR's failure shares per type).
People per listing, from who PUCAR's roster records as present at the last hearing: 1.6 (complainant 21%, complainant's advocate 72%, accused 16%, accused's advocate 56%).
Expected trips made for hearings that fail: 103. Trips made for hearings that fail for a reason known the night before: 33. Those are the ones a process desk removes without losing a single substantive hearing.

Hearing types on the list:

| hearing type | listed | minutes if heard | P(substantive) | share of failures that were knowable (process or outside report) |
|---|---|---|---|---|
| APPEARANCE | 35 | 10 | 40% | 38% |
| EVIDENCE_COMPLAINANT | 24 | 30 | 29% | 5% |
| WARRANT | 8 | 10 | 14% | 82% |
| DELAY_CONDONATION_HEARING | 6 | 5 | 29% | 17% |
| REPORTS | 6 | 10 | 8% | 75% |
| BAIL | 4 | 15 | 31% | 0% |
| ADMISSION | 2 | 5 | 49% | 51% |
| ARGUMENTS | 2 | 30 | 13% | 0% |
| EVIDENCE_ACCUSED | 2 | 30 | 17% | 0% |
| EXAMINATION_UNDER_S351_BNSS | 1 | 30 | 41% | 25% |

Expected values only; no simulation and no behavioural assumption beyond the 2-minute call. The exact best subset is
the ceiling of what choosing from this particular list can do; the full engine also chooses which cases to list at all,
and whether their people need to come.
