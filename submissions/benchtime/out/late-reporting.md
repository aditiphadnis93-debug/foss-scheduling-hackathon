# Process returns reported late (diagnostic)

The process desk only works if the court knows whether a summons, notice or warrant has come back. Here the court
learns of each return some days after it happens (`returnReportDelayDays` in the world). Only the reporting delay
changes; the planners are unchanged. Winner (`benchtime_final`) and today's way (`status_quo_60`), seeds 31-40, PUCAR's
seed-42 roster, synthetic data. Run with `bun run scripts/experiments/late-reporting.ts` (about one minute).

| Returns reported | Today: useful hearings a day | Winner | Winner minus today | Winner: dates honoured | Today: dates honoured | Winner: desk matters a day | Winner: cases never heard |
|---|---|---|---|---|---|---|---|
| The next day (as in every other result) | 17.26 | 18.27 | +1.01 | 95.5% | 92.3% | 5.5 | 361 |
| 3 days late | 17.26 | 18.17 | +0.91 | 95.4% | 92.3% | 5.8 | 369 |
| 7 days late | 17.26 | 18.12 | +0.86 | 95.4% | 92.3% | 6.3 | 365 |
| 21 days late | 17.26 | 17.50 | +0.24 | 95.3% | 92.3% | 8.0 | 443 |

Today's way does not look at process, so reporting delays do not change it. The winner keeps most of its gain
when returns reach the court within a week. At three weeks most of the gain is gone: cases whose summons has
already come back wait at the desk, and 443 cases go unheard. The difference between the first and last rows,
about 0.8 useful hearings a day, is what prompt process status (for example DRISTI's e-post tracking) is worth to
this planner. Dates honoured stay above today's in every row.
