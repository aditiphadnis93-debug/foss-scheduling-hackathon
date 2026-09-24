# Headline: the winner against today's way on the held-out seeds

Winner: **g237**, registered as `benchtime_final`. Today's way: status_quo_60 (every due case listed, a flat 60-day gap). 30 held-out world seeds (31-60) on PUCAR's seed-42 roster, the CLI arena path, synthetic data. Each line: the winner, today, the paired difference with its 95% interval (t, 29 degrees of freedom). Everything is advisory; a judge signs every order.

| # | Measure | Winner | Today | Difference [95% CI] | |
|---|---|---|---|---|---|
| 1 | Useful hearings a day | 18.2 [18.1, 18.3] | 17.1 [17.0, 17.2] | +1.08 [+0.98, +1.18] | better |
| 2 | Cases decided on the merits | 89.3 [86.7, 91.9] | 84.9 [81.8, 88.0] | +4.40 [+3.26, +5.54] | better |
| 3 | All headline disposals | 103 [100.0, 106] | 94.7 [91.3, 98.2] | +8.10 [+6.90, +9.30] | better |
| 4 | Dates honoured | 94.9% [94.5%, 95.4%] | 92.0% [91.3%, 92.7%] | +2.93 pts [+2.54 pts, +3.32 pts] | better |
| 5 | Dates broken or never given | 166 [151, 181] | 245 [225, 265] | -79.3 [-91.0, -67.6] | better |
| 6 | Cases never heard | 380 [368, 391] | 240 [221, 258] | +140 [+128, +151] | **worse** |
| 7 | Old cases moved on | 30.8% [30.4%, 31.3%] | 29.2% [28.8%, 29.7%] | +1.60 pts [+1.40 pts, +1.80 pts] | better |
| 8 | Trips per useful hearing | 10.5 [10.4, 10.6] | 11.7 [11.6, 11.8] | -1.22 [-1.28, -1.16] | better |
| 9 | Minutes waited | 141 [140, 142] | 155 [154, 157] | -14.5 [-15.6, -13.4] | better |
| 10 | Next-date overshoot (days) | 42.7 [42.6, 42.8] | 50.7 [50.6, 50.7] | -7.96 [-8.06, -7.85] | better |

1. Useful hearings a day: hearings that moved a case to its next stage, per sitting day. Winner 18.2, today 17.1 (difference +1.08 [+0.98, +1.18]).
2. Cases decided on the merits in the quarter: verdicts, settlements and compounding. Winner 89.3, today 84.9 (difference +4.40 [+3.26, +5.54]).
3. All headline disposals, adding acquittals for the complainant's default and dismissals for steps not taken. Winner 103, today 94.7 (difference +8.10 [+6.90, +9.30]).
4. Dates honoured: the share of promised dates on which the court heard the case or passed a desk order that day. Winner 94.9%, today 92.0% (difference +2.93 pts [+2.54 pts, +3.32 pts]).
5. Dates broken or never given: promised dates with no order passed, plus cases given no date inside the quarter. Winner 166, today 245 (difference -79.3 [-91.0, -67.6]).
6. Cases never heard: roster cases with no hearing reached in the quarter. Winner 380, today 240 (difference +140 [+128, +151]).
7. Old cases moved on: the share of 4+ year old cases that had at least one hearing that moved them forward. Winner 30.8%, today 29.2% (difference +1.60 pts [+1.40 pts, +1.80 pts]).
8. Trips per useful hearing: parties and advocates who came, per hearing that moved a case. Winner 10.5, today 11.7 (difference -1.22 [-1.28, -1.16]).
9. Minutes waited per person heard, from the call time given to the minute the hearing started. Winner 141, today 155 (difference -14.5 [-15.6, -13.4]).
10. Days a next date overshoots PUCAR's procedural gap for the purpose just heard. Winner 42.7, today 50.7 (difference -7.96 [-8.06, -7.85]).

Guardrails that fail on seeds 31-60 (pre-registered: reported, the pick stands): 1 of 19 under criteria.json, cases never heard (difference +140 [+128, +151], margin +150). A second, every 4y+ case heard at least once, is defined in criteria.json on the mean ("on": "mean"): the pick averages 0.00 against today's 0.53, so it passes; this script applied a paired t-bound instead, under which it fails (difference -0.53 [-1.62, +0.56], margin +0.5). Both readings are shown.

Reading notes (details in heldout.md):

- cases never heard: paired difference +140 [+128, +151], bound +151 against a margin of +150.
- every 4y+ case heard at least once (README score): the pick scores 0.00 on every one of the 30 seeds; today's way scores 0.00 to 16.0 (median 0.00). The pick is no worse than today on any seed, and the bound fails only through today's own seed-to-seed spread. Under criteria.json's own definition (compared on the mean) this guardrail passes; only the stricter t-bound reading fails it.
- frontier_1 (frontier: never heard at most today + 150; never heard at most today + 300; never heard at most today + 600; never heard at most today + 1000; promises broken at most today + 100; promises broken at most today + 300; promises broken at most today + 600 (g157)) fails fewer guardrails than the pick on these seeds (every 4y+ case heard at least once (README score)). Pre-registered: the pick does not change; the comparison is reported.
- The tournament script's t table (1.96 from 20 degrees of freedom) gives the same verdict on every guardrail as t = 2.045.
- Shared seeds pair the courts: correlation across seeds between the pick and today's way is 0.61 for substantive per sitting day, 0.94 for disposals on the merits (verdict + settlement + compounded), 0.82 for dates honoured (court or desk order), 0.81 for cases never heard.

## The judge's dial (operating points, not the pick)

The same engine at different settings, on the same 30 held-out seeds; mean [95% t interval]. The pick is g237; the others show what a judge trades by turning the dial. Guardrails failed counts the 19 pre-registered guardrails against today's way on these seeds.

| Measure | Today's way | g237 (the pick) | g237 + call times | focused (g1121) |
|---|---|---|---|---|
| Useful hearings a day | 17.1 [17.0, 17.2] | 18.2 [18.1, 18.3] | 18.7 [18.6, 18.8] | 23.1 [22.9, 23.2] |
| Cases decided on the merits | 84.9 [81.8, 88.0] | 89.3 [86.7, 91.9] | 96.4 [93.5, 99.3] | 120 [116, 123] |
| Dates honoured | 92.0% [91.3%, 92.7%] | 94.9% [94.5%, 95.4%] | 93.6% [93.1%, 94.0%] | 92.6% [90.5%, 94.6%] |
| Dates broken or never given | 245 [225, 265] | 166 [151, 181] | 211 [195, 226] | 1469 [1376, 1563] |
| Cases given a date inside the quarter | 3000 [3000, 3000] | 3000 [3000, 3000] | 3000 [3000, 3000] | 1810 [1810, 1810] |
| Cases never heard | 240 [221, 258] | 380 [368, 391] | 417 [405, 428] | 1211 [1206, 1217] |
| Old cases heard at all | 99.9% [99.8%, 100.1%] | 100.0% [100.0%, 100.0%] | 100.0% [100.0%, 100.0%] | 100.0% [100.0%, 100.0%] |
| Old cases moved on | 29.2% [28.8%, 29.7%] | 30.8% [30.4%, 31.3%] | 32.3% [31.9%, 32.7%] | 38.8% [38.2%, 39.4%] |
| Minutes waited | 155 [154, 157] | 141 [140, 142] | 23.4 [22.9, 24.0] | 20.1 [18.8, 21.4] |
| Trips per useful hearing | 11.7 [11.6, 11.8] | 10.5 [10.4, 10.6] | 10.7 [10.6, 10.8] | 9.58 [9.48, 9.68] |
| Guardrails failed |  | 2: cases never heard; every 4y+ case heard at least once (README score) | 3: cases never heard; every 4y+ case heard at least once (README score); days that ran late | 5: every case given a date inside the quarter; cases never acted on; cases never heard; every 4y+ case heard at least once (README score); days that ran late |

## Where we lose

Against today's way (every measure with a direction where the winner's mean is worse; bold = the paired interval excludes zero):

- Utilisation: winner 91.4%, today 91.5% (-0.17 pts [-0.48 pts, +0.13 pts]).
- **Gap from first scheduled to first heard**: winner 0.54, today 0.05 (+0.50 [+0.42, +0.57]).
- **Utilisation within capacity**: winner 90.0%, today 90.7% (-0.72 pts [-0.97 pts, -0.47 pts]).
- **Idle capacity**: winner 10.0%, today 9.3% (+0.72 pts [+0.47 pts, +0.97 pts]).
- **Held as scheduled (all due)**: winner 86.2%, today 92.0% (-5.74 pts [-6.15 pts, -5.33 pts]).
- Next dates the case was not ready for: winner 34.1%, today 33.8% (+0.28 pts [-2.46 pts, +3.01 pts]).
- Judge time used: winner 91.4%, today 91.5% (-0.17 pts [-0.48 pts, +0.13 pts]).
- **Held on the promised date**: winner 86.2%, today 92.0% (-5.74 pts [-6.15 pts, -5.33 pts]).
- **Cases never heard**: winner 380, today 240 (+140 [+128, +151]).
- **Load balance (CV of daily minutes)**: winner 0.14, today 0.13 (+0.01 [+0.01, +0.02]).
- Reached per sitting day: winner 55.2, today 55.2 (-0.03 [-0.28, +0.22]).
- **Deferred per sitting day**: winner 0.47, today 0.00 (+0.47 [+0.43, +0.52]).
- **Minutes past capacity**: winner 297, today 180 (+117 [+85.6, +148]).
- **Gap to first heard, never heard at the end**: winner 5.56, today 2.75 (+2.81 [+2.60, +3.02]).
- Next dates wasted, counting absences: winner 55.4%, today 55.4% (+0.06 pts [-2.99 pts, +3.11 pts]).
- Next dates not ready, counting desk re-checks: winner 34.2%, today 33.8% (+0.38 pts [-2.36 pts, +3.11 pts]).
- Substantive on the promised date (all due): winner 28.4%, today 28.5% (-0.07 pts [-0.22 pts, +0.09 pts]).
- **First promise kept, per case**: winner 86.2%, today 92.0% (-5.73 pts [-6.12 pts, -5.33 pts]).
- **Gap from the horizon start to first heard, all cases**: winner 43.4, today 40.6 (+2.81 [+2.60, +3.02]).

Against any rival (significant losses only, the paired interval excludes zero; the full list with non-significant ones is in heldout.md):

- Utilisation (winner 91.4%): status_quo_ref 100.5%, winner_calltimes 93.8%, focused 92.5%, frontier_1 92.7%.
- Reach rate (winner 95.2%): fifo_capped 99.4%, bin_packing 99.8%, sehgal 99.8%, joshi 96.4%, benchtime 99.9%.
- Substantiveness (readme) (winner 32.9%): bin_packing 37.5%, benchtime 42.2%, winner_calltimes 34.3%, focused 35.6%, adp 42.4%.
- 4y+ cases heard substantively (winner 30.8%): status_quo_ref 34.9%, winner_calltimes 32.3%, focused 38.8%, adp 39.3%.
- Gap from first scheduled to first heard (winner 0.54): oldest_first 0.00, dimakar 0.19, joshi 0.00, benchtime 0.33, focused 0.12, frontier_1 0.06.
- Utilisation within capacity (winner 90.0%): status_quo_ref 98.1%, winner_calltimes 92.1%, focused 91.2%, frontier_1 91.3%.
- Days that overran (winner 19.7): fifo_capped 2.30, bin_packing 1.57, oldest_first 9.60, sehgal 0.70, dimakar 11.3, joshi 9.70, benchtime 0.50.
- Idle capacity (winner 10.0%): status_quo_ref 1.9%, winner_calltimes 7.9%, focused 8.8%, frontier_1 8.7%.
- Held as scheduled (as listed) (winner 94.4%): dimakar 95.7%, joshi 96.4%, benchtime 97.3%.
- Held as scheduled (all due) (winner 86.2%): oldest_first 94.9%, dimakar 95.7%, joshi 96.4%, focused 92.6%, frontier_1 93.5%.
- Substantiveness (caseStudy) (winner 32.9%): bin_packing 37.5%, benchtime 42.2%, winner_calltimes 34.3%, focused 35.6%, adp 42.4%.
- Cases aged 5+ years at the end (winner 433): status_quo_ref 418, winner_calltimes 428, focused 382, adp 380.
- Cases aged 3+ years at the end (winner 1524): status_quo_ref 1493, winner_calltimes 1515, focused 1486, adp 1453.
- Cases aged 4+ years at the end (winner 952): status_quo_ref 927, winner_calltimes 945, focused 898, adp 887.
- Next date excess over the minimum (winner 42.7): status_quo_ref 20.4, sehgal 35.3, focused 18.3, adp 30.3.
- Next dates the case was not ready for (winner 34.1%): fifo_capped 32.4%, bin_packing 32.1%.
- Throughput (disposals per month) (winner 41.2): status_quo_ref 47.6, winner_calltimes 43.3, focused 53.6, adp 57.8.
- Judge time used (winner 91.4%): status_quo_ref 100.5%, winner_calltimes 93.8%, focused 92.5%, frontier_1 92.7%.
- Wasted listings (winner 68.7%): bin_packing 62.5%, sehgal 67.8%, benchtime 57.8%, winner_calltimes 67.8%, focused 66.3%, adp 59.9%.
- Held on the promised date (winner 86.2%): oldest_first 94.9%, dimakar 95.7%, joshi 96.4%, focused 92.6%, frontier_1 93.5%.
- 95th percentile pending age (winner 9.34): focused 9.28, adp 9.12.
- Cases never heard (winner 380): frontier_1 182.
- Load balance (CV of daily minutes) (winner 0.14): status_quo_ref 0.07, winner_calltimes 0.13, focused 0.13, frontier_1 0.13.
- Reached per sitting day (winner 55.2): status_quo_ref 60.4, focused 64.8, frontier_1 58.6.
- Substantive per sitting day (winner 18.2): winner_calltimes 18.7, focused 23.1, frontier_1 18.3, adp 21.0.
- Disposals (headline) (winner 103): status_quo_ref 119, winner_calltimes 108, focused 134, adp 144.
- Disposals of 4y+ cases (headline) (winner 73.3): status_quo_ref 89.1, winner_calltimes 78.0, focused 115, adp 120.
- Trips per substantive hearing (winner 10.5): bin_packing 8.73, benchtime 8.68, focused 9.58, adp 8.93.
- Wasted trips (winner 66.5%): bin_packing 59.9%, benchtime 56.8%, winner_calltimes 66.0%, focused 63.8%, adp 58.9%.
- Deferred per sitting day (winner 0.47): status_quo_ref 0.00, oldest_first 0.00, dimakar 0.00, joshi 0.00, frontier_1 0.11.
- Minutes past capacity (winner 297): fifo_capped 26.9, bin_packing 25.9, oldest_first 136, sehgal 10.9, dimakar 97.7, joshi 139, benchtime 6.30.
- Reach rate excluding uncalled standby (winner 98.6%): fifo_capped 99.4%, bin_packing 99.8%, sehgal 99.8%, benchtime 99.9%.
- Reach rate on sitting days (winner 95.3%): fifo_capped 99.5%, bin_packing 99.8%, sehgal 99.9%, joshi 96.5%, benchtime 99.9%.
- Gap to first heard, never heard at the end (winner 5.56): oldest_first 1.27, dimakar 0.97, joshi 1.01, focused 0.16, frontier_1 2.26.
- Dates honoured (court or desk order) (winner 94.9%): dimakar 95.7%, joshi 96.4%.
- Next dates wasted, counting absences (winner 55.4%): fifo_capped 51.8%, bin_packing 52.2%, sehgal 52.9%, winner_calltimes 53.8%, adp 47.5%.
- Next dates not ready, counting desk re-checks (winner 34.2%): fifo_capped 32.4%, bin_packing 32.1%.
- Pending 4y+ cases at the end (winner 952): status_quo_ref 927, winner_calltimes 945, focused 898, adp 887.
- Substantive on the promised date (all due) (winner 28.4%): dimakar 31.2%, winner_calltimes 29.2%, focused 33.0%, frontier_1 29.2%.
- First promise kept, per case (winner 86.2%): oldest_first 94.9%, dimakar 95.9%, joshi 96.4%, focused 95.3%, frontier_1 93.7%.
- Next date excess over the gap for the next purpose (winner 42.5): status_quo_ref 20.2, sehgal 35.0, focused 17.7, adp 29.4.
- Gap from the horizon start to first heard, all cases (winner 43.4): joshi 39.9, frontier_1 40.1.
- Minutes waited per person heard (winner 141): fifo_capped 105, bin_packing 98.3, oldest_first 122, sehgal 1.07, dimakar 137, joshi 127, benchtime 5.18, winner_calltimes 23.4, focused 20.1, adp 14.3.
- Minutes waited, counting matters not reached (winner 152): fifo_capped 106, bin_packing 98.8, oldest_first 137, sehgal 1.15, dimakar 147, joshi 138, benchtime 5.26, winner_calltimes 37.2, focused 28.6, adp 19.2.
- Mean age of the 100 oldest pending cases (winner 9.78): status_quo_ref 9.77, sehgal 9.78, winner_calltimes 9.77, focused 9.73, adp 9.69.
- Disposals on the merits (verdict + settlement + compounded) (winner 89.3): status_quo_ref 111, winner_calltimes 96.4, focused 120, adp 136.

