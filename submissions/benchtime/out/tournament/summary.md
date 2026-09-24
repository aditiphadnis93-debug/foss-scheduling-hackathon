# Tournament of scheduling approaches (final rule)

Approaches tried: about 2587 distinct genomes of the zoo meta-policy over the whole tournament (random genomes across the whole space, every preset and its mutants, NSGA-II under the original rule, the 14:05 amendment and the final rule), plus the eight baselines, the original benchtime and the ADP planner run as coded. This final stage: 264 genomes run fresh on current code, 3 generations of NSGA-II under the final rule.

Criteria: final rule, 14:15 (after adversarial review). paired non-inferiority against status_quo_60 on the same seeds: a guardrail passes when the 95% t-bound of (candidate - today) clears -margin (higher-is-better) or +margin (lower-is-better). Absolute limits are compared on the mean. Nothing is relaxed automatically: if nothing passes, publish the frontier and the owner chooses.

Why: Replaces the original rule (maximise useful hearings/day behind 7 guardrails) and the 14:00 amendment. Four independent reviews (/tmp/review/judge.md, scorecards.md, gaming.md, statistics.md) found: (1) guardrails compared with bin_packing's best numbers instead of today's way; (2) a policy could keep promises by parking cases past 15 Dec, since a case with no date in the horizon produces no row; (3) held-on-promised and held-all-due are the same number; (4) a desk order on the fixed date was counted as a broken date, which a magistrate would not; (5) utilisation, reach, substantiveness, waiting and load balance were unguarded; (6) the coverage cap relaxed itself to whatever the search found; (7) tolerances sat inside seed noise. Decided on tuning seeds; validation seeds 21-30 were already used once under the original rule; only 31-60 are untouched and give the headline. Added 14:36 on tuning seeds: every 4y+ case heard at least once (extra.neverHeard4yPlus <= today + 0.5), because the leader left about 5 old cases unheard and the README prints 4y+ heard at all as a score.

Seeds: search 1-6; decide on fresh seeds 7-20; confirm on 21-30 (used once before, under the original rule); the headline must come only from seeds 31-60, which were never run here. The world keys every case's draws by roster id; every run here uses the CLI arena's roster id (roster_3000_seed42), so numbers match `bun run src/cli.ts arena` exactly. Earlier stages of this tournament ran on a court keyed "seed42" (an equally valid court, not the arena's); their numbers were used only to choose genomes to re-run.

## The pick

**g237** (archive g237). Daily list: one priority index per case (value of a hearing today plus the waiting cost it stops, less wasted trips, per minute), filled to 111% of the day with a 30% standby list. Next dates: the earliest day with room after PUCAR's gap (failed or unheard matters sooner). Process desk: matters whose summons, notice or warrant is not back are handled at the desk. No check-in. Every 4+ year case before the bench at least every 45 working days.

Genes: index / first spread / next earliest / coverage rotation / desk on / check-in off / calib off / fill 1.10 / standby 0.30.

It passes every guardrail on the decision seeds 7-20.

On the confirmation seeds 21-30 it fails 1: cases never heard.

No rival (the eight baselines, the original benchtime, ADP) is better than it on every guarded measure.

## Guardrails for the pick (paired against status_quo_60)

| Guardrail | Margin | Seeds 7-20: difference (bound) | Pass | Seeds 21-30: difference (bound) | Pass |
|---|---|---|---|---|---|
| every case given a date inside the quarter | >= 2985 | 3000.000 (3000.000) | yes | 3000.000 (3000.000) | yes |
| dates honoured (heard or desk order on the day) | -0.02 | 0.038 (0.030) | yes | 0.032 (0.023) | yes |
| cases never acted on | +100 | -145.571 (-123.961) | yes | -124.300 (-98.589) | yes |
| cases never heard | +150 | 105.357 (128.715) | yes | 131.600 (153.866) | no |
| 4y+ heard at all (README) | -0.01 | 0.001 (-0.001) | yes | 0.003 (-0.001) | yes |
| every 4y+ case heard at least once (README score) | +0.5 | -0.857 (-0.857) | yes | -2.500 (-2.500) | yes |
| 4y+ moved on | -0.01 | 0.013 (0.010) | yes | 0.013 (0.010) | yes |
| 4y+ still pending at the end | +5 | -6.929 (-5.183) | yes | -7.500 (-5.527) | yes |
| disposals on the merits (verdict + settlement + compounded) | -5 | 2.429 (0.498) | yes | 2.800 (-0.619) | yes |
| next-date excess over PUCAR's gap | +2 | -7.875 (-7.672) | yes | -7.946 (-7.778) | yes |
| days that ran late | +2 | -1.500 (0.113) | yes | -2.000 (-0.738) | yes |
| court time used | -0.05 | -0.006 (-0.011) | yes | -0.012 (-0.017) | yes |
| reach rate | -0.01 | 0.042 (0.034) | yes | 0.036 (0.028) | yes |
| substantiveness | -0.01 | 0.015 (0.013) | yes | 0.015 (0.011) | yes |
| trips per useful hearing | +0.25 | -1.202 (-1.102) | yes | -1.109 (-0.990) | yes |
| wasted listings | +0.01 | -0.027 (-0.025) | yes | -0.025 (-0.022) | yes |
| minutes waited | +5 | -13.406 (-12.072) | yes | -11.882 (-10.107) | yes |
| load balance across days | +0.05 | 0.008 (0.015) | yes | 0.016 (0.020) | yes |
| useful hearings a day at least today's | -0 | 1.021 (0.845) | yes | 0.858 (0.689) | yes |

## Finalists (decided on seeds 7-20, confirmed on 21-30)

| Rank 7-20 | Candidate | Origin | Failed 7-20 | Worst shortfall | Failed 21-30 | Useful/day | Merits disposals | Promises broken | Never heard | Never acted on | Honoured incl. desk | 4y+ moved | Trips/useful |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | g237 | archive g237 | 0 | 0.00 | 1 | 17.95 | 90.00 | 163 | 370 | 119 | 95.0% | 30.7% | 10.62 |
| 2 | g206 | archive g206 | 1 | 0.32 | 0 | 17.96 | 87.79 | 192 | 168 | 168 | 93.9% | 29.5% | 11.16 |
| 3 | g235 | archive g235 | 1 | 0.50 | 1 | 17.97 | 88.79 | 205 | 180 | 180 | 93.5% | 29.6% | 11.12 |
| 4 | g227 | archive g227 | 1 | 0.54 | 0 | 18.01 | 87.43 | 156 | 351 | 113 | 95.2% | 29.7% | 10.48 |
| 5 | g488 | archive g488 | 1 | 0.68 | 1 | 17.96 | 88.71 | 209 | 183 | 183 | 93.4% | 29.6% | 11.12 |
| 6 | g245 | nsga (final rule) gen 3 | 1 | 0.79 | 0 | 17.95 | 88.36 | 210 | 183 | 183 | 93.3% | 29.5% | 11.15 |
| 7 | g526 | archive g526 | 1 | 0.82 | 0 | 17.97 | 87.71 | 209 | 178 | 178 | 93.4% | 29.5% | 11.10 |
| 8 | g405 | archive g405 | 1 | 0.82 | 1 | 17.90 | 87.64 | 131 | 127 | 127 | 95.7% | 29.3% | 11.11 |
| 9 | g145 | g405 + desk | 1 | 0.82 | 2 | 17.61 | 85.93 | 94.50 | 354 | 91.93 | 96.9% | 29.3% | 10.30 |
| 10 | g542 | archive g542 | 1 | 1.04 | 0 | 18.10 | 87.50 | 210 | 177 | 177 | 93.4% | 29.6% | 11.21 |
| 11 | g141 | g542 + desk | 1 | 1.04 | 1 | 17.81 | 86.86 | 114 | 364 | 106 | 96.4% | 29.6% | 10.37 |
| 12 | g146 | g405 + call times and desk | 1 | 1.21 | 2 | 18.20 | 93.71 | 118 | 378 | 115 | 96.2% | 30.8% | 10.47 |
| 13 | g157 | nsga (final rule) gen 1 | 2 | 0.11 | 1 | 18.20 | 88.36 | 218 | 181 | 181 | 93.2% | 29.7% | 11.26 |
| 14 | adp | named finalist (ADP; tuned on seeds 13-20, so its 7-20 numbers are optimistic) | 5 | 12.51 | 5 | 21.01 | 135 | 1101 | 996 | 751 | 87.9% | 39.1% | 8.96 |

Frontier points carried to the finals (chosen on seeds 1-6):

- never heard at most today + 150: g157 (index / first spread / next earliest / coverage floor / desk off / check-in off / calib learned / fill 1.10 / standby 0.28)
- never heard at most today + 300: g157 (index / first spread / next earliest / coverage floor / desk off / check-in off / calib learned / fill 1.10 / standby 0.28)
- never heard at most today + 600: g157 (index / first spread / next earliest / coverage floor / desk off / check-in off / calib learned / fill 1.10 / standby 0.28)
- never heard at most today + 1000: g157 (index / first spread / next earliest / coverage floor / desk off / check-in off / calib learned / fill 1.10 / standby 0.28)
- promises broken at most today + 100: g157 (index / first spread / next earliest / coverage floor / desk off / check-in off / calib learned / fill 1.10 / standby 0.28)
- promises broken at most today + 300: g157 (index / first spread / next earliest / coverage floor / desk off / check-in off / calib learned / fill 1.10 / standby 0.28)
- promises broken at most today + 600: g157 (index / first spread / next earliest / coverage floor / desk off / check-in off / calib learned / fill 1.10 / standby 0.28)

## Every measure on the confirmation seeds 21-30 (means; the pick's 95% interval in brackets)

| Measure | g237 | status_quo_60 | status_quo_ref | fifo_capped | bin_packing | oldest_first | sehgal | dimakar | joshi | benchtime | adp | g_index | c_portfolio | b_horizon | d_simple | a_fillfair | f_lookahead | e_search | benchtime_v0 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| extra.casesScheduled | 3000 [±0.00] | 3000 | 3000 | 3000 | 3000 | 1909 | 3000 | 2304 | 2646 | 2041 | 2358 | 2051 | 2886 | 1569 | 3000 | 1830 | 2603 | 1148 | 2041 |
| extra.promisesHonouredInclDesk | 0.96 [±0.01] | 0.92 | 0.71 | 0.06 | 0.07 | 0.95 | 0.27 | 0.95 | 0.96 | 0.86 | 0.88 | 0.64 | 0.78 | 0.92 | 0.58 | 0.87 | 0.86 | 0.74 | 0.87 |
| Cases never acted on (no hearing reached, no desk action) | 95.20 [±26.76] | 220 | 757 | 1129 | 1018 | 1195 | 999 | 778 | 457 | 1236 | 762 | 1169 | 640 | 1438 | 1109 | 1219 | 766 | 1956 | 1285 |
| Cases never heard | 351 [±27.25] | 220 | 757 | 1129 | 1018 | 1195 | 999 | 778 | 457 | 1602 | 1008 | 1383 | 890 | 1615 | 1367 | 1428 | 985 | 1956 | 1510 |
| 4y+ cases heard at all | 100.0% [±0.0%] | 99.7% | 99.8% | 99.7% | 68.2% | 97.1% | 96.9% | 97.6% | 65.4% | 73.5% | 99.9% | 75.6% | 87.1% | 99.7% | 87.7% | 100.0% | 84.4% | 83.7% | 70.7% |
| extra.neverHeard4yPlus | 0.00 [±0.00] | 2.50 | 1.90 | 2.50 | 285 | 26.20 | 27.60 | 21.90 | 310 | 237 | 0.80 | 219 | 115 | 3.10 | 110 | 0.40 | 140 | 147 | 263 |
| 4y+ cases with a substantive hearing | 29.4% [±0.7%] | 28.2% | 34.2% | 28.2% | 24.8% | 27.5% | 29.2% | 30.8% | 14.8% | 26.3% | 38.5% | 39.2% | 36.7% | 45.0% | 35.9% | 42.8% | 32.4% | 33.5% | 26.9% |
| extra.pending4yPlusEnd | 958 [±5.65] | 966 | 930 | 966 | 969 | 968 | 967 | 952 | 1067 | 973 | 892 | 862 | 904 | 840 | 918 | 866 | 937 | 915 | 963 |
| derived.meritsDisposals | 85.30 [±4.37] | 82.50 | 106 | 78.00 | 78.90 | 79.80 | 68.10 | 78.80 | 41.80 | 80.60 | 132 | 155 | 124 | 161 | 116 | 146 | 106 | 109 | 84.90 |
| Next-date excess over the minimum (days) | 42.76 [±0.13] | 50.71 | 20.52 | 46.38 | 46.51 | 69.72 | 35.34 | 56.76 | 78.23 | 75.13 | 30.36 | 11.85 | 28.06 | 7.53 | 19.74 | 20.84 | 43.84 | 29.79 | 60.07 |
| Days that overran | 17.30 [±2.52] | 19.30 | 43.30 | 1.90 | 1.90 | 8.90 | 0.30 | 11.50 | 10.20 | 0.70 | 22.10 | 22.40 | 23.20 | 7.50 | 10.30 | 9.10 | 8.70 | 0.20 | 0.80 |
| caseStudy.utilisation | 88.5% [±1.5%] | 89.7% | 97.7% | 62.4% | 62.8% | 61.5% | 58.4% | 69.5% | 76.7% | 50.6% | 89.7% | 87.1% | 90.9% | 77.5% | 81.6% | 76.1% | 79.6% | 46.9% | 53.8% |
| readme.reachRate | 96.0% [±1.1%] | 92.4% | 71.0% | 99.0% | 99.1% | 94.5% | 99.3% | 95.4% | 96.1% | 99.0% | 94.6% | 93.4% | 92.5% | 98.3% | 96.8% | 97.7% | 97.6% | 99.2% | 99.0% |
| readme.substantiveness | 31.9% [±0.6%] | 30.5% | 27.0% | 27.5% | 37.5% | 29.7% | 31.9% | 32.5% | 27.5% | 42.4% | 42.1% | 40.5% | 39.6% | 37.9% | 40.0% | 37.2% | 41.3% | 33.4% | 42.4% |
| Trips per useful hearing | 10.73 [±0.17] | 11.84 | 17.23 | 12.95 | 8.82 | 12.61 | 10.90 | 10.73 | 12.44 | 8.71 | 8.99 | 9.39 | 9.79 | 9.80 | 9.57 | 10.11 | 9.01 | 11.18 | 8.55 |
| Wasted listings | 69.4% [±0.5%] | 71.8% | 80.8% | 72.7% | 62.9% | 71.9% | 68.3% | 69.0% | 73.6% | 58.0% | 60.2% | 62.1% | 63.4% | 62.8% | 61.2% | 63.7% | 59.6% | 66.9% | 58.0% |
| extra.minutesWaited | 140 [±2.78] | 152 | 167 | 100 | 98.33 | 122 | 1.09 | 139 | 129 | 5.29 | 14.14 | 13.30 | 28.80 | 7.47 | 3.17 | 11.83 | 13.77 | 18.29 | 9.58 |
| siddarth.loadBalanceCv | 0.16 [±0.01] | 0.14 | 0.08 | 0.29 | 0.28 | 0.48 | 0.27 | 0.43 | 0.27 | 0.40 | 0.16 | 0.23 | 0.14 | 0.21 | 0.19 | 0.25 | 0.22 | 0.37 | 0.38 |
| Useful (substantive) hearings per day | 17.85 [±0.23] | 16.99 | 16.38 | 10.34 | 14.95 | 10.57 | 13.49 | 16.22 | 13.80 | 11.72 | 21.03 | 21.37 | 19.21 | 16.36 | 16.48 | 15.73 | 18.02 | 8.67 | 13.14 |
| readme.utilisation | 89.6% [±1.6%] | 90.5% | 100.1% | 62.5% | 62.9% | 62.1% | 58.5% | 69.8% | 77.4% | 50.6% | 91.1% | 88.2% | 92.5% | 78.1% | 82.1% | 76.7% | 80.2% | 46.9% | 53.9% |
| readme.predictabilityGapDays | 0.52 [±0.13] | 0.15 | 0.81 | 0.83 | 0.77 | 0.00 | 0.66 | 0.23 | 0.00 | 0.36 | 2.99 | 4.83 | 4.12 | 4.51 | 3.10 | 4.14 | 3.27 | 2.18 | 3.24 |
| caseStudy.idleMinutesShare | 11.5% [±1.5%] | 10.3% | 2.3% | 37.6% | 37.2% | 38.5% | 41.6% | 30.5% | 23.3% | 49.4% | 10.3% | 12.9% | 9.1% | 22.5% | 18.4% | 23.9% | 20.4% | 53.1% | 46.2% |
| caseStudy.heldAsScheduled | 95.2% [±1.1%] | 92.4% | 71.0% | 6.0% | 7.2% | 94.5% | 27.6% | 95.4% | 96.1% | 96.5% | 93.2% | 67.4% | 87.4% | 97.7% | 67.5% | 97.5% | 95.1% | 89.7% | 92.1% |
| Held as scheduled (all due) | 86.9% [±1.0%] | 92.4% | 71.0% | 6.0% | 7.1% | 94.5% | 27.4% | 95.4% | 96.1% | 67.9% | 66.5% | 56.0% | 59.7% | 62.8% | 50.6% | 59.6% | 55.4% | 74.5% | 46.8% |
| caseStudy.substantiveness | 31.9% [±0.6%] | 30.5% | 27.0% | 27.5% | 37.5% | 29.7% | 31.9% | 32.5% | 27.5% | 42.4% | 42.1% | 40.5% | 39.6% | 37.9% | 40.0% | 37.2% | 41.3% | 33.4% | 42.4% |
| caseStudy.wastedRelistShare | 34.8% [±2.4%] | n/a | 38.3% | 31.2% | 31.2% | n/a | 39.8% | 41.8% | n/a | 55.6% | 40.3% | 38.5% | 44.0% | 37.3% | 45.2% | 44.7% | 56.3% | 49.7% | 58.0% |
| siddarth.throughputPerMonth | 40.29 [±1.52] | 37.89 | 46.10 | 33.08 | 35.28 | 34.60 | 30.36 | 34.52 | 20.51 | 33.28 | 56.95 | 64.68 | 52.30 | 66.80 | 47.50 | 60.63 | 44.78 | 43.89 | 36.00 |
| siddarth.judgeTimeUsed | 89.6% [±1.6%] | 90.5% | 100.1% | 62.5% | 62.9% | 62.1% | 58.5% | 69.8% | 77.4% | 50.6% | 91.1% | 88.2% | 92.5% | 78.1% | 82.1% | 76.7% | 80.2% | 46.9% | 53.9% |
| Held on the promised date | 86.9% [±1.0%] | 92.4% | 71.0% | 6.0% | 7.1% | 94.5% | 27.4% | 95.4% | 96.1% | 67.9% | 66.5% | 56.0% | 59.7% | 62.8% | 50.6% | 59.6% | 55.4% | 74.5% | 46.8% |
| siddarth.oldestPendingAgeYears | 10.10 [±0.00] | 10.10 | 10.10 | 10.10 | 10.10 | 10.10 | 10.10 | 10.10 | 10.10 | 10.10 | 10.10 | 10.10 | 10.10 | 10.10 | 10.10 | 10.10 | 10.10 | 10.10 | 10.10 |
| siddarth.p95PendingAgeYears | 9.34 [±0.00] | 9.34 | 9.34 | 9.34 | 9.34 | 9.34 | 9.34 | 9.34 | 9.34 | 9.34 | 9.10 | 8.90 | 9.10 | 9.07 | 9.33 | 9.12 | 9.34 | 9.18 | 9.34 |
| Headline disposals | 101 [±3.79] | 94.60 | 115 | 82.60 | 88.10 | 86.40 | 75.80 | 86.20 | 51.20 | 83.10 | 142 | 162 | 131 | 167 | 119 | 151 | 112 | 110 | 89.90 |
| extra.disposed4yPlus | 70.50 [±4.35] | 65.40 | 87.10 | 65.50 | 63.40 | 66.50 | 61.90 | 67.80 | 25.00 | 66.60 | 116 | 136 | 109 | 154 | 97.00 | 131 | 87.30 | 102 | 69.60 |
| extra.wastedTripShare | 67.2% [±0.5%] | 69.5% | 78.4% | 70.6% | 60.4% | 69.8% | 67.2% | 67.1% | 71.5% | 57.0% | 59.2% | 61.2% | 61.9% | 61.8% | 60.5% | 63.0% | 58.6% | 65.4% | 57.0% |
| extra.promisesBroken | 146 [±34.46] | 234 | 1255 | 29951 | 26380 | 1195 | 5667 | 817 | 457 | 1252 | 1109 | 2676 | 1025 | 1712 | 1717 | 1627 | 964 | 2303 | 1385 |
| caseStudy.ageBandsEnd.5+ | 437 [±5.75] | 442 | 421 | 442 | 443 | 444 | 436 | 430 | 498 | 442 | 381 | 344 | 380 | 340 | 410 | 366 | 417 | 393 | 436 |
| caseStudy.ageBandsEnd.4-5 | 522 [±4.32] | 524 | 509 | 524 | 526 | 524 | 531 | 522 | 570 | 530 | 511 | 518 | 523 | 500 | 508 | 500 | 520 | 522 | 526 |

Rivals and presets: guardrails failed under the final rule (seeds 7-20 / 21-30):

| Candidate | Failed 7-20 | Failed 21-30 | Worst shortfall 7-20 |
|---|---|---|---|
| status_quo_60 | 0 | 0 | 0.00 |
| status_quo_ref | 11 | 10 | 5.00 |
| fifo_capped | 9 | 10 | 16.91 |
| bin_packing | 10 | 11 | 140.04 |
| oldest_first | 14 | 14 | 21.52 |
| sehgal | 9 | 10 | 12.68 |
| dimakar | 10 | 10 | 13.62 |
| joshi | 15 | 15 | 151.82 |
| benchtime | 13 | 13 | 118.14 |
| adp | 5 | 5 | 12.51 |
| g_index | 8 | 8 | 104.68 |
| c_portfolio | 7 | 8 | 61.82 |
| b_horizon | 7 | 7 | 28.27 |
| d_simple | 8 | 8 | 54.61 |
| a_fillfair | 7 | 7 | 23.03 |
| f_lookahead | 8 | 8 | 75.36 |
| e_search | 9 | 9 | 71.75 |
| benchtime_v0 | 13 | 13 | 129.46 |

## The search under the final rule (seeds 1-6)

| Rank | Candidate | Origin | Failed | Worst shortfall | Useful/day | Never heard | Promises broken | Genes |
|---|---|---|---|---|---|---|---|---|
| 1 | g157 | nsga (final rule) gen 1 | 0 | 0.00 | 18.15 | 177 | 216 | index / first spread / next earliest / coverage floor / desk off / check-in off / calib learned / fill 1.10 / standby 0.28 |
| 2 | g542 | archive g542 | 0 | 0.00 | 18.04 | 174 | 212 | index / first spread / next earliest / coverage floor / desk off / check-in off / calib off / fill 1.10 / standby 0.27 |
| 3 | g488 | archive g488 | 0 | 0.00 | 18.00 | 185 | 210 | index / first spread / next earliest / coverage mention / desk off / check-in off / calib off / fill 1.10 / standby 0.28 |
| 4 | g227 | archive g227 | 0 | 0.00 | 17.99 | 343 | 151 | index / first spread / next earliest / coverage floor / desk on / check-in off / calib learned / fill 1.10 / standby 0.25 |
| 5 | g235 | archive g235 | 0 | 0.00 | 17.98 | 180 | 205 | index / first spread / next earliest / coverage mention / desk off / check-in off / calib off / fill 1.10 / standby 0.28 |
| 6 | g206 | archive g206 | 0 | 0.00 | 17.96 | 167 | 190 | index / first spread / next earliest / coverage mention / desk off / check-in off / calib off / fill 1.10 / standby 0.28 |
| 7 | g245 | nsga (final rule) gen 3 | 0 | 0.00 | 17.95 | 178 | 201 | index / first spread / next earliest / coverage none / desk off / check-in off / calib off / fill 1.10 / standby 0.28 |
| 8 | g526 | archive g526 | 0 | 0.00 | 17.92 | 169 | 196 | index / first spread / next earliest / coverage floor / desk off / check-in off / calib learned / fill 1.10 / standby 0.30 |
| 9 | g237 | archive g237 | 0 | 0.00 | 17.91 | 365 | 159 | index / first spread / next earliest / coverage rotation / desk on / check-in off / calib off / fill 1.10 / standby 0.30 |
| 10 | g405 | archive g405 | 0 | 0.00 | 17.88 | 111 | 117 | index / first spread / next earliest / coverage floor / desk off / check-in off / calib off / fill 1.10 / standby 0.28 |
| 11 | g122 | archive g122 | 0 | 0.00 | 17.84 | 225 | 273 | index / first spread / next earliest / coverage rotation / desk off / check-in off / calib off / fill 1.05 / standby 0.28 |
| 12 | g260 | archive g260 | 0 | 0.00 | 17.84 | 345 | 128 | index / first spread / next earliest / coverage mention / desk on / check-in off / calib learned / fill 1.10 / standby 0.28 |
| 13 | g168 | nsga (final rule) gen 1 | 0 | 0.00 | 17.82 | 147 | 158 | index / first spread / next flat60 / coverage floor / desk off / check-in off / calib off / fill 1.10 / standby 0.30 |
| 14 | g260 | nsga (final rule) gen 3 | 0 | 0.00 | 17.82 | 144 | 155 | index / first spread / next flat60 / coverage floor / desk off / check-in off / calib off / fill 1.10 / standby 0.30 |
| 15 | g265 | nsga (final rule) gen 3 | 0 | 0.00 | 17.81 | 347 | 127 | index / first spread / next earliest / coverage floor / desk on / check-in off / calib learned / fill 1.10 / standby 0.28 |
| 16 | g385 | archive g385 | 0 | 0.00 | 17.77 | 355 | 126 | index / first spread / next earliest / coverage floor / desk on / check-in off / calib off / fill 1.10 / standby 0.28 |
| 17 | g430 | archive g430 | 0 | 0.00 | 17.77 | 355 | 127 | index / first spread / next earliest / coverage floor / desk on / check-in off / calib off / fill 1.10 / standby 0.25 |
| 18 | g418 | archive g418 | 0 | 0.00 | 17.76 | 357 | 129 | index / first spread / next earliest / coverage floor / desk on / check-in off / calib off / fill 1.10 / standby 0.28 |
| 19 | g141 | g542 + desk | 0 | 0.00 | 17.75 | 354 | 110 | index / first spread / next earliest / coverage floor / desk on / check-in off / calib off / fill 1.10 / standby 0.27 |
| 20 | g224 | nsga (final rule) gen 2 | 0 | 0.00 | 17.72 | 366 | 136 | index / first spread / next earliest / coverage rotation / desk on / check-in off / calib off / fill 1.05 / standby 0.28 |
| 21 | g269 | nsga (final rule) gen 3 | 0 | 0.00 | 17.70 | 332 | 125 | knapsack / first spread / next earliest / coverage mention / desk on / check-in off / calib learned / fill 1.10 / standby 0.28 |
| 22 | g214 | nsga (final rule) gen 2 | 0 | 0.00 | 17.67 | 259 | 259 | knapsack / first spread / next earliest / coverage mention / desk on / check-in off / calib learned / fill 1.10 / standby 0.28 |
| 23 | g174 | archive g174 | 0 | 0.00 | 17.67 | 342 | 113 | index / first spread / next earliest / coverage floor / desk on / check-in off / calib off / fill 1.05 / standby 0.28 |
| 24 | g262 | nsga (final rule) gen 3 | 0 | 0.00 | 17.66 | 334 | 93.50 | index / first spread / next earliest / coverage mention / desk on / check-in off / calib off / fill 1.10 / standby 0.28 |
| 25 | g236 | nsga (final rule) gen 3 | 0 | 0.00 | 17.61 | 356 | 111 | index / first spread / next earliest / coverage none / desk on / check-in off / calib off / fill 1.10 / standby 0.28 |

Which guardrails bind: share of the 257 genomes run on seeds 1-6 that fail each one.

| Guardrail | Fails |
|---|---|
| every 4y+ case heard at least once (README score) | 70% |
| cases never heard | 62% |
| dates honoured (heard or desk order on the day) | 50% |
| days that ran late | 46% |
| cases never acted on | 40% |
| 4y+ heard at all (README) | 39% |
| reach rate | 18% |
| load balance across days | 18% |
| court time used | 16% |
| useful hearings a day at least today's | 12% |
| minutes waited | 12% |
| trips per useful hearing | 11% |
| 4y+ still pending at the end | 9% |
| 4y+ moved on | 9% |
| disposals on the merits (verdict + settlement + compounded) | 9% |
| wasted listings | 8% |
| every case given a date inside the quarter | 7% |
| next-date excess over PUCAR's gap | 7% |
| substantiveness | 5% |

## Which components win (top 30 on seeds 1-6 against everything run in this stage)

| Gene | Value | Share of the top set | Share of all evaluated |
|---|---|---|---|
| selection | fifo | 0% | 1% |
| selection | index | 93% | 73% |
| selection | knapsack | 7% | 9% |
| selection | oldest | 0% | 5% |
| selection | portfolio | 0% | 2% |
| selection | ppm | 0% | 2% |
| selection | simple | 0% | 7% |
| selection | youngest | 0% | 2% |
| firstDates | horizon | 0% | 1% |
| firstDates | priority | 0% | 6% |
| firstDates | rotation | 0% | 3% |
| firstDates | spread | 100% | 91% |
| nextDate | earliest | 90% | 83% |
| nextDate | flat60 | 10% | 11% |
| nextDate | projected | 0% | 2% |
| nextDate | pucar | 0% | 2% |
| nextDate | window | 0% | 2% |
| coverage | floor | 53% | 53% |
| coverage | mention | 30% | 17% |
| coverage | none | 7% | 9% |
| coverage | rotation | 10% | 21% |
| callOrder | cluster | 13% | 10% |
| callOrder | rank | 87% | 82% |
| callOrder | short | 0% | 5% |
| callOrder | simple | 0% | 2% |
| calibration | fail | 0% | 2% |
| calibration | learned | 27% | 17% |
| calibration | off | 73% | 76% |
| calibration | pscale | 0% | 5% |
| caseEstimate | false | 0% | 10% |
| caseEstimate | true | 100% | 90% |
| priorCheck | false | 10% | 15% |
| priorCheck | true | 90% | 85% |
| desk | false | 37% | 35% |
| desk | true | 63% | 65% |
| checkin | false | 100% | 87% |
| checkin | true | 0% | 13% |
| checkinRobust | false | 63% | 47% |
| checkinRobust | true | 37% | 53% |
| cluster | false | 80% | 75% |
| cluster | true | 20% | 25% |
| callTimes | false | 100% | 54% |
| callTimes | true | 0% | 46% |
| quickRelist | false | 13% | 17% |
| quickRelist | true | 87% | 83% |
| gapOfHeard | false | 30% | 32% |
| gapOfHeard | true | 70% | 68% |
| countDiary | false | 100% | 90% |
| countDiary | true | 0% | 10% |
| purposeDays | false | 100% | 91% |
| purposeDays | true | 0% | 9% |
| carryForward | false | 97% | 89% |
| carryForward | true | 3% | 11% |

| Dial | Mean in the top set | Mean of all evaluated |
|---|---|---|
| fillTarget | 1.09 | 1.11 |
| standbyShare | 0.28 | 0.27 |
| promiseFill | 1.19 | 1.18 |
| initialFill | 0.95 | 0.93 |
| firstOldShare | 0.20 | 0.21 |
| ageExponent | 1.02 | 0.84 |
| ageingFloor | 0.33 | 0.33 |
| relistDays | 11.13 | 10.99 |
| relistCap | 1.06 | 1.04 |
| pendingHold | 0.58 | 0.61 |
| weight throughput | 1.69 | 1.62 |
| weight disposal | 1.35 | 1.29 |
| weight fairness | 2.19 | 2.01 |
| weight trips | 1.32 | 1.46 |
| weight predictability | 2.71 | 2.67 |

The earlier stages (original rule, 14:05 amendment) are summarised in old-rule/summary.md; their pick is not the pick.


## Added after the finals: g237+callTimes (same rule, same seeds)

g237 with callTimes true, run fresh on seeds 7-20 and 21-30 and judged by the same paired guardrails. It does not qualify to replace g237 (it must pass all guardrails on 7-20 and fail nothing on 21-30 that g237 passes). g237 stays the pre-registered pick of the finals above.

- g237, seeds 7-20: failed 0 (none); useful/day 17.95, minutes waited 141, trips/useful 10.62, never heard 370, promises broken 163, merits disposals 90.00
- g237+callTimes, seeds 7-20: failed 2 (cases never heard, days that ran late); useful/day 18.54, minutes waited 23.08, trips/useful 10.80, never heard 410, promises broken 206, merits disposals 99.14
- g237, seeds 21-30: failed 1 (cases never heard); useful/day 17.85, minutes waited 140, trips/useful 10.73, never heard 351, promises broken 146, merits disposals 85.30
- g237+callTimes, seeds 21-30: failed 2 (cases never heard, days that ran late); useful/day 18.49, minutes waited 23.82, trips/useful 10.87, never heard 394, promises broken 196, merits disposals 94.20
