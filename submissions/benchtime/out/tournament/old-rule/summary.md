# Tournament of scheduling approaches

Approaches tried: 1063 distinct genomes of the zoo meta-policy (src/planner/zoo.ts): 16 named presets (every baseline, judge and redesign), 420 random genomes, mutants of the presets and 15 generations of NSGA-II. Plus 9 reference policies run as coded. 6714 simulations of the corrected world (roster seed 42, 2026-10-01 to 2026-12-15), 1.34 s each, 30 minutes of wall time on 5 workers.

Seeds: tuning 1-4 (stage 1), 1-6 (stage 2, NSGA-II), 1-20 (stage 3), validation 21-30 (stage 4). The held-out test seeds 31-60 were never used. Every candidate ran on the same world seeds (common random numbers).

Guardrails (the merge brief's pre-registered selection, with noise tolerances): not worse than status_quo_60 on 4y+ heard (0.5 points), 4y+ substantive share (0.5 points), headline disposals (2), next-date excess (1 day) and overrun days (1); not worse than the best baseline on trips per useful hearing (0.1) and wasted listings (0.5 points). Then the most useful hearings per day, then the most measures best or tied.

## The winner

**g921** (nsga gen 12). Daily list: the best chance of a useful hearing per minute first, filled to 101% of the day with a 17% standby list. Next dates: the first day with room within a few weeks of PUCAR's gap. Process desk: matters whose summons, notice or warrant is not back are handled at the desk. No check-in. Every 4+ year case before the bench at least every 48 working days. Predictions recalibrated on the court's own record.

Genes: ppm / first rotation / next window / coverage rotation / desk on / check-in off / calib pscale / fill 1.01 / standby 0.17.

Every guardrail holds on the validation seeds.

## Validation (seeds 21-30): the winner against every baseline, preset and the current benchtime

Means over ten seeds; the winner's 95% interval in brackets.

| Measure | g921 | status_quo_60 | status_quo_ref | fifo_capped | bin_packing | oldest_first | sehgal | dimakar | joshi | benchtime | status_quo_60 | status_quo_ref | fifo_capped | bin_packing | oldest_first | sehgal | dimakar | joshi | g_index | c_portfolio | b_horizon | d_simple | a_fillfair | f_lookahead | e_search | benchtime_v0 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| readme.utilisation | 91.7% [±0.7%] | 91.7% | 100.2% | 63.9% | 62.9% | 61.1% | 59.1% | 68.4% | 77.0% | 50.7% | 91.7% | 100.2% | 63.9% | 62.9% | 61.1% | 59.1% | 68.4% | 77.0% | 87.8% | 93.2% | 78.1% | 82.4% | 77.5% | 79.5% | 47.5% | 53.8% |
| readme.reachRate | 94.1% [±0.9%] | 90.7% | 69.8% | 99.0% | 99.1% | 94.0% | 99.3% | 94.8% | 95.9% | 99.2% | 90.7% | 69.8% | 99.0% | 99.1% | 94.0% | 99.3% | 94.8% | 95.9% | 92.7% | 92.5% | 98.0% | 96.9% | 97.9% | 97.4% | 99.3% | 99.0% |
| readme.substantiveness | 44.3% [±0.8%] | 31.3% | 27.8% | 28.4% | 37.8% | 29.4% | 32.5% | 32.5% | 27.6% | 42.0% | 31.3% | 27.8% | 28.4% | 37.8% | 29.4% | 32.5% | 32.5% | 27.6% | 40.0% | 40.5% | 37.9% | 40.9% | 37.5% | 41.2% | 33.9% | 42.1% |
| 4y+ cases heard at all | 100.0% [±0.0%] | 99.7% | 99.8% | 99.7% | 68.5% | 97.7% | 96.8% | 97.8% | 65.6% | 74.2% | 99.7% | 99.8% | 99.7% | 68.5% | 97.7% | 96.8% | 97.8% | 65.4% | 75.4% | 86.0% | 99.6% | 87.0% | 100.0% | 83.2% | 84.0% | 71.5% |
| 4y+ cases with a substantive hearing | 36.3% [±0.9%] | 29.7% | 35.4% | 29.7% | 25.6% | 27.2% | 30.6% | 30.3% | 14.7% | 26.2% | 29.7% | 35.4% | 29.7% | 25.6% | 27.2% | 30.6% | 30.3% | 14.8% | 38.9% | 36.4% | 45.0% | 36.9% | 43.7% | 31.5% | 33.7% | 26.9% |
| readme.predictabilityGapDays | 3.03 [±0.19] | 0.02 | 0.92 | 0.81 | 0.77 | 0.00 | 0.64 | 0.23 | 0.00 | 0.33 | 0.02 | 0.92 | 0.81 | 0.77 | 0.00 | 0.64 | 0.23 | 0.00 | 4.87 | 4.29 | 4.60 | 2.97 | 4.27 | 3.14 | 2.17 | 3.02 |
| caseStudy.utilisation | 90.5% [±0.6%] | 90.8% | 97.8% | 63.7% | 62.8% | 60.5% | 59.1% | 68.0% | 76.3% | 50.7% | 90.8% | 97.8% | 63.7% | 62.8% | 60.5% | 59.1% | 68.0% | 76.3% | 86.6% | 91.7% | 77.4% | 81.9% | 76.8% | 78.8% | 47.5% | 53.8% |
| Days that overran | 22.00 [±1.39] | 22.20 | 43.20 | 2.20 | 1.20 | 9.90 | 0.20 | 11.60 | 10.40 | 0.20 | 22.20 | 43.20 | 2.20 | 1.20 | 9.90 | 0.20 | 11.60 | 10.40 | 21.50 | 23.90 | 8.50 | 9.30 | 9.40 | 9.60 | 0.00 | 0.50 |
| caseStudy.idleMinutesShare | 9.5% [±0.6%] | 9.2% | 2.2% | 36.3% | 37.2% | 39.5% | 40.9% | 32.0% | 23.7% | 49.3% | 9.2% | 2.2% | 36.3% | 37.2% | 39.5% | 40.9% | 32.0% | 23.7% | 13.4% | 8.3% | 22.6% | 18.1% | 23.2% | 21.2% | 52.5% | 46.2% |
| caseStudy.heldAsScheduled | 82.8% [±0.9%] | 90.7% | 69.8% | 6.0% | 7.2% | 94.0% | 27.5% | 94.8% | 95.9% | 96.8% | 90.7% | 69.8% | 6.0% | 7.2% | 94.0% | 27.5% | 94.8% | 95.9% | 67.4% | 87.7% | 97.5% | 66.9% | 97.8% | 95.3% | 89.8% | 92.2% |
| Held as scheduled (all due) | 66.4% [±0.8%] | 90.7% | 69.8% | 6.0% | 7.1% | 94.0% | 27.4% | 94.8% | 95.9% | 68.3% | 90.7% | 69.8% | 6.0% | 7.1% | 94.0% | 27.4% | 94.8% | 95.9% | 55.7% | 59.5% | 62.6% | 50.3% | 59.5% | 55.0% | 74.5% | 47.4% |
| caseStudy.substantiveness | 44.3% [±0.8%] | 31.3% | 27.8% | 28.4% | 37.8% | 29.4% | 32.5% | 32.5% | 27.6% | 42.0% | 31.3% | 27.8% | 28.4% | 37.8% | 29.4% | 32.5% | 32.5% | 27.6% | 40.0% | 40.5% | 37.9% | 40.9% | 37.5% | 41.2% | 33.9% | 42.1% |
| Next-date excess over the minimum (days) | 7.60 [±0.38] | 50.59 | 20.18 | 46.42 | 46.45 | 69.90 | 35.40 | 56.75 | 78.26 | 74.79 | 50.59 | 20.18 | 46.42 | 46.45 | 69.90 | 35.40 | 56.75 | 78.29 | 10.95 | 29.50 | 7.52 | 19.68 | 20.59 | 44.62 | 29.66 | 59.65 |
| caseStudy.wastedRelistShare | 28.8% [±0.7%] | n/a | 38.1% | 32.4% | 32.2% | n/a | 40.6% | 42.8% | n/a | 54.9% | n/a | 38.1% | 32.4% | 32.2% | n/a | 40.6% | 42.8% | n/a | 38.8% | 44.1% | 37.3% | 44.5% | 45.2% | 55.7% | 50.4% | 58.0% |
| siddarth.throughputPerMonth | 49.70 [±2.31] | 39.85 | 49.98 | 35.40 | 36.32 | 34.32 | 33.52 | 34.48 | 22.03 | 33.76 | 39.85 | 49.98 | 35.40 | 36.32 | 34.32 | 33.52 | 34.48 | 22.03 | 64.08 | 51.38 | 66.64 | 50.02 | 61.56 | 42.69 | 44.57 | 37.41 |
| siddarth.judgeTimeUsed | 91.7% [±0.7%] | 91.7% | 100.2% | 63.9% | 62.9% | 61.1% | 59.1% | 68.4% | 77.0% | 50.7% | 91.7% | 100.2% | 63.9% | 62.9% | 61.1% | 59.1% | 68.4% | 77.0% | 87.8% | 93.2% | 78.1% | 82.4% | 77.5% | 79.5% | 47.5% | 53.8% |
| Wasted listings | 58.3% [±0.9%] | 71.6% | 80.6% | 71.9% | 62.5% | 72.3% | 67.7% | 69.2% | 73.6% | 58.3% | 71.6% | 80.6% | 71.9% | 62.5% | 72.3% | 67.7% | 69.2% | 73.6% | 62.9% | 62.5% | 62.9% | 60.4% | 63.3% | 59.8% | 66.4% | 58.3% |
| Held on the promised date | 66.4% [±0.8%] | 90.7% | 69.8% | 6.0% | 7.1% | 94.0% | 27.4% | 94.8% | 95.9% | 68.3% | 90.7% | 69.8% | 6.0% | 7.1% | 94.0% | 27.4% | 94.8% | 95.9% | 55.7% | 59.5% | 62.6% | 50.3% | 59.5% | 55.0% | 74.5% | 47.4% |
| siddarth.oldestPendingAgeYears | 10.10 [±0.00] | 10.10 | 10.10 | 10.10 | 10.10 | 10.10 | 10.10 | 10.10 | 10.10 | 10.10 | 10.10 | 10.10 | 10.10 | 10.10 | 10.10 | 10.10 | 10.10 | 10.10 | 10.10 | 10.10 | 10.10 | 10.10 | 10.10 | 10.10 | 10.10 | 10.10 |
| siddarth.p95PendingAgeYears | 9.28 [±0.08] | 9.34 | 9.34 | 9.34 | 9.34 | 9.34 | 9.34 | 9.34 | 9.34 | 9.34 | 9.34 | 9.34 | 9.34 | 9.34 | 9.34 | 9.34 | 9.34 | 9.34 | 9.07 | 9.13 | 9.07 | 9.29 | 9.10 | 9.34 | 9.18 | 9.34 |
| Cases never heard | 1144 [±7.91] | 276 | 786 | 1127 | 1016 | 1205 | 1000 | 788 | 461 | 1592 | 276 | 786 | 1127 | 1016 | 1205 | 1000 | 788 | 463 | 1395 | 896 | 1617 | 1383 | 1415 | 993 | 1951 | 1504 |
| siddarth.loadBalanceCv | 0.14 [±0.01] | 0.13 | 0.08 | 0.29 | 0.26 | 0.50 | 0.25 | 0.46 | 0.27 | 0.39 | 0.13 | 0.08 | 0.29 | 0.26 | 0.50 | 0.25 | 0.46 | 0.27 | 0.23 | 0.13 | 0.22 | 0.18 | 0.25 | 0.23 | 0.37 | 0.37 |
| Useful (substantive) hearings per day | 25.92 [±0.40] | 17.13 | 16.56 | 10.68 | 15.09 | 10.42 | 13.71 | 16.14 | 13.80 | 11.71 | 17.13 | 16.56 | 10.68 | 15.09 | 10.42 | 13.71 | 16.14 | 13.80 | 21.22 | 19.38 | 16.36 | 16.62 | 15.92 | 17.85 | 8.81 | 13.10 |
| Headline disposals | 124 [±5.76] | 99.50 | 125 | 88.40 | 90.70 | 85.70 | 83.70 | 86.10 | 55.00 | 84.30 | 99.50 | 125 | 88.40 | 90.70 | 85.70 | 83.70 | 86.10 | 55.00 | 160 | 128 | 166 | 125 | 154 | 107 | 111 | 93.40 |
| extra.disposed4yPlus | 101 [±5.36] | 71.70 | 94.00 | 71.70 | 68.10 | 66.50 | 70.20 | 66.90 | 27.20 | 68.20 | 71.70 | 94.00 | 71.70 | 68.10 | 66.50 | 70.20 | 66.90 | 27.20 | 138 | 107 | 155 | 102 | 137 | 82.60 | 103 | 73.00 |
| Trips per useful hearing | 7.88 [±0.16] | 11.80 | 17.11 | 12.57 | 8.77 | 12.83 | 10.74 | 10.81 | 12.45 | 8.78 | 11.80 | 17.11 | 12.57 | 8.77 | 12.83 | 10.74 | 10.81 | 12.45 | 9.60 | 9.58 | 9.84 | 9.38 | 10.01 | 9.06 | 11.00 | 8.63 |
| extra.wastedTripShare | 56.5% [±0.9%] | 69.2% | 78.2% | 69.7% | 60.0% | 70.3% | 66.5% | 67.4% | 71.4% | 57.3% | 69.2% | 78.2% | 69.7% | 60.0% | 70.3% | 66.5% | 67.4% | 71.4% | 62.0% | 61.0% | 62.0% | 59.5% | 62.5% | 59.0% | 64.8% | 57.3% |

### Stage 4 ranking (pre-registered selection on validation seeds)

| Rank | Candidate | Guardrails broken | Useful/day | 4y+ substantive | Disposals | Trips/useful | Held on promise | Overrun days |
|---|---|---|---|---|---|---|---|---|
| 1 | g921 (nsga gen 12) | none | 25.92 | 36.3% | 124 | 7.88 | 66.4% | 22.00 |
| 2 | g1071 (nsga gen 15) | none | 25.38 | 34.8% | 114 | 7.51 | 49.0% | 18.60 |
| 3 | g981 (nsga gen 13) | none | 24.23 | 35.3% | 123 | 7.51 | 68.2% | 15.60 |
| 4 | g1011 (nsga gen 14) | none | 23.34 | 35.8% | 119 | 7.77 | 37.5% | 18.20 |
| 5 | g855 (nsga gen 10) | none | 23.27 | 39.7% | 141 | 8.03 | 64.5% | 18.90 |
| 6 | g934 (nsga gen 12) | none | 21.82 | 38.5% | 124 | 8.24 | 28.8% | 13.20 |
| 7 | g848 (nsga gen 10) | none | 21.30 | 39.8% | 127 | 8.28 | 70.5% | 13.40 |
| 8 | g817 (nsga gen 9) | none | 21.28 | 38.2% | 115 | 7.97 | 53.0% | 12.00 |

Presets and baselines on the validation seeds, with the guardrails they break:

| Candidate | Guardrails broken | Useful/day | 4y+ substantive |
|---|---|---|---|
| status_quo_60 | trips per useful hearing, wasted listings | 17.13 | 29.7% |
| status_quo_ref | overrun days, trips per useful hearing, wasted listings | 16.56 | 35.4% |
| fifo_capped | disposals, trips per useful hearing, wasted listings | 10.68 | 29.7% |
| bin_packing | 4y+ heard, 4y+ substantive, disposals | 15.09 | 25.6% |
| oldest_first | 4y+ heard, 4y+ substantive, disposals, next-date excess, trips per useful hearing, wasted listings | 10.42 | 27.2% |
| sehgal | 4y+ heard, disposals, trips per useful hearing, wasted listings | 13.71 | 30.6% |
| dimakar | 4y+ heard, disposals, next-date excess, trips per useful hearing, wasted listings | 16.14 | 30.3% |
| joshi | 4y+ heard, 4y+ substantive, disposals, next-date excess, trips per useful hearing, wasted listings | 13.80 | 14.7% |
| benchtime | 4y+ heard, 4y+ substantive, disposals, next-date excess | 11.71 | 26.2% |
| status_quo_60 | trips per useful hearing, wasted listings | 17.13 | 29.7% |
| status_quo_ref | overrun days, trips per useful hearing, wasted listings | 16.56 | 35.4% |
| fifo_capped | disposals, trips per useful hearing, wasted listings | 10.68 | 29.7% |
| bin_packing | 4y+ heard, 4y+ substantive, disposals | 15.09 | 25.6% |
| oldest_first | 4y+ heard, 4y+ substantive, disposals, next-date excess, trips per useful hearing, wasted listings | 10.42 | 27.2% |
| sehgal | 4y+ heard, disposals, trips per useful hearing, wasted listings | 13.71 | 30.6% |
| dimakar | 4y+ heard, disposals, next-date excess, trips per useful hearing, wasted listings | 16.14 | 30.3% |
| joshi | 4y+ heard, 4y+ substantive, disposals, next-date excess, trips per useful hearing, wasted listings | 13.80 | 14.8% |
| g_index | 4y+ heard, trips per useful hearing | 21.22 | 38.9% |
| c_portfolio | 4y+ heard, overrun days, trips per useful hearing | 19.38 | 36.4% |
| b_horizon | trips per useful hearing | 16.36 | 45.0% |
| d_simple | 4y+ heard, trips per useful hearing | 16.62 | 36.9% |
| a_fillfair | trips per useful hearing, wasted listings | 15.92 | 43.7% |
| f_lookahead | 4y+ heard, trips per useful hearing | 17.85 | 31.5% |
| e_search | 4y+ heard, trips per useful hearing, wasted listings | 8.81 | 33.7% |
| benchtime_v0 | 4y+ heard, 4y+ substantive, disposals, next-date excess | 13.10 | 26.9% |

## Pareto front (stage 3, seeds 1-20)

Constrained non-dominated sorting on the six objectives (useful hearings per day, 4y+ substantive share, headline disposals, trips per useful hearing, held on the promised date, overrun days).

| Front | Candidate | Origin | Guardrails broken | Useful/day | 4y+ subst. | 4y+ heard | Disposals | Trips/useful | Held | Overrun | Excess | Wasted | Genes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | g1015 | nsga gen 14 | none | 20.36 | 38.6% | 100.0% | 116 | 8.60 | 47.4% | 18.15 | 33.38 | 59.3% | ppm / first horizon / next flat60 / coverage rotation / desk on / check-in robust / calib pscale / fill 0.84 / standby 0.10 |
| 1 | g705 | nsga gen 6 | none | 20.35 | 39.0% | 99.9% | 116 | 8.57 | 46.8% | 19.15 | 33.45 | 59.1% | ppm / first horizon / next flat60 / coverage rotation / desk on / check-in on / calib pscale / fill 0.84 / standby 0.10 |
| 1 | g822 | nsga gen 9 | none | 20.74 | 40.0% | 99.9% | 128 | 8.73 | 16.6% | 18.40 | 18.73 | 59.6% | ppm / first rotation / next window / coverage rotation / desk on / check-in on / calib learned / fill 1.05 / standby 0.17 |
| 1 | g555 | nsga gen 3 | none | 19.56 | 39.9% | 100.0% | 125 | 8.44 | 16.2% | 10.75 | 18.89 | 59.9% | ppm / first rotation / next window / coverage rotation / desk on / check-in on / calib learned / fill 0.99 / standby 0.10 |
| 1 | g1071 | nsga gen 15 | none | 25.29 | 34.1% | 100.0% | 112 | 7.53 | 50.0% | 17.85 | 6.02 | 60.1% | ppm / first rotation / next window / coverage rotation / desk on / check-in off / calib pscale / fill 1.03 / standby 0.16 |
| 1 | g921 | nsga gen 12 | none | 25.91 | 35.4% | 100.0% | 118 | 7.86 | 66.7% | 22.35 | 7.39 | 58.3% | ppm / first rotation / next window / coverage rotation / desk on / check-in off / calib pscale / fill 1.01 / standby 0.17 |
| 1 | g981 | nsga gen 13 | none | 24.23 | 34.8% | 100.0% | 117 | 7.50 | 68.7% | 14.55 | 6.39 | 59.7% | ppm / first rotation / next window / coverage rotation / desk on / check-in off / calib pscale / fill 1.00 / standby 0.16 |
| 1 | g934 | nsga gen 12 | none | 21.82 | 37.6% | 100.0% | 117 | 8.23 | 29.3% | 13.35 | 14.06 | 57.6% | ppm / first rotation / next window / coverage rotation / desk on / check-in robust / calib learned / fill 1.05 / standby 0.10 |
| 1 | g817 | nsga gen 9 | none | 21.37 | 38.1% | 100.0% | 116 | 7.85 | 53.5% | 12.60 | 23.07 | 55.6% | ppm / first rotation / next window / coverage rotation / desk on / check-in on / calib learned / fill 1.01 / standby 0.17 |
| 1 | g845 | nsga gen 10 | none | 19.54 | 38.2% | 100.0% | 123 | 8.69 | 77.5% | 8.35 | 21.35 | 61.9% | ppm / first rotation / next window / coverage rotation / desk on / check-in robust / calib pscale / fill 1.05 / standby 0.16 |
| 1 | g848 | nsga gen 10 | none | 21.33 | 39.7% | 100.0% | 132 | 8.24 | 71.1% | 12.05 | 25.25 | 58.9% | ppm / first rotation / next pucar / coverage rotation / desk on / check-in off / calib fail / fill 1.01 / standby 0.17 |
| 1 | g744 | nsga gen 7 | none | 19.36 | 43.0% | 100.0% | 150 | 8.61 | 58.7% | 9.10 | 23.87 | 58.9% | ppm / first rotation / next pucar / coverage rotation / desk on / check-in on / calib fail / fill 0.87 / standby 0.10 |
| 1 | g919 | nsga gen 12 | none | 16.48 | 35.4% | 100.0% | 108 | 8.39 | 63.8% | 1.75 | 32.88 | 62.1% | ppm / first rotation / next flat60 / coverage rotation / desk on / check-in off / calib pscale / fill 1.10 / standby 0.17 |
| 1 | g1011 | nsga gen 14 | none | 23.12 | 37.6% | 100.0% | 137 | 7.79 | 37.7% | 18.45 | 6.90 | 61.2% | ppm / first rotation / next window / coverage rotation / desk on / check-in off / calib fail / fill 1.02 / standby 0.10 |
| 1 | g979 | nsga gen 13 | none | 17.13 | 36.3% | 100.0% | 114 | 8.50 | 98.4% | 5.05 | 36.05 | 62.6% | index / first rotation / next earliest / coverage rotation / desk off / check-in off / calib learned / fill 1.01 / standby 0.17 |
| 1 | g841 | nsga gen 10 | none | 17.49 | 39.6% | 100.0% | 128 | 8.50 | 57.7% | 6.55 | 34.93 | 58.8% | ppm / first rotation / next pucar / coverage rotation / desk on / check-in robust / calib fail / fill 1.05 / standby 0.17 |
| 1 | g867 | nsga gen 10 | none | 20.58 | 44.9% | 100.0% | 157 | 8.46 | 60.0% | 19.95 | 7.60 | 58.2% | index / first rotation / next window / coverage rotation / desk on / check-in robust / calib fail / fill 1.02 / standby 0.17 |
| 1 | g784 | nsga gen 8 | none | 18.07 | 40.7% | 100.0% | 124 | 8.86 | 83.8% | 8.10 | 28.20 | 59.4% | ppm / first rotation / next earliest / coverage rotation / desk off / check-in robust / calib fail / fill 1.18 / standby 0.17 |
| 1 | g974 | nsga gen 13 | none | 17.20 | 33.4% | 100.0% | 106 | 8.67 | 76.1% | 4.30 | 36.02 | 61.3% | ppm / first rotation / next earliest / coverage rotation / desk on / check-in off / calib fail / fill 1.01 / standby 0.17 |
| 1 | g967 | nsga gen 13 | none | 16.39 | 35.7% | 100.0% | 102 | 7.79 | 61.4% | 2.40 | 41.04 | 54.3% | ppm / first rotation / next flat60 / coverage rotation / desk on / check-in robust / calib pscale / fill 1.01 / standby 0.17 |
| 1 | g951 | nsga gen 12 | none | 15.29 | 34.2% | 100.0% | 104 | 8.51 | 93.4% | 2.75 | 36.86 | 62.5% | index / first rotation / next earliest / coverage rotation / desk off / check-in off / calib fail / fill 1.01 / standby 0.17 |
| 1 | g949 | nsga gen 12 | none | 15.86 | 38.4% | 100.0% | 119 | 8.71 | 42.9% | 4.90 | 34.12 | 59.6% | ppm / first rotation / next flat60 / coverage rotation / desk on / check-in robust / calib fail / fill 1.00 / standby 0.17 |
| 1 | g855 | nsga gen 10 | none | 23.09 | 39.4% | 100.0% | 141 | 8.05 | 64.9% | 18.55 | 5.98 | 59.2% | ppm / first rotation / next window / coverage rotation / desk on / check-in off / calib fail / fill 1.01 / standby 0.11 |
| 1 | g880 | nsga gen 11 | none | 17.69 | 37.1% | 99.9% | 117 | 7.73 | 37.1% | 4.85 | 10.72 | 58.9% | index / first rotation / next window / coverage rotation / desk on / check-in off / calib fail / fill 1.05 / standby 0.17 |
| 1 | g846 | nsga gen 10 | none | 17.08 | 37.8% | 100.0% | 130 | 7.64 | 35.5% | 5.60 | 10.21 | 57.9% | index / first rotation / next window / coverage rotation / desk on / check-in off / calib fail / fill 1.05 / standby 0.17 |
| 1 | g793 | nsga gen 9 | none | 18.11 | 38.5% | 99.6% | 122 | 7.88 | 15.6% | 7.20 | 7.91 | 57.6% | index / first rotation / next window / coverage rotation / desk on / check-in off / calib fail / fill 1.01 / standby 0.17 |
| 1 | g770 | nsga gen 8 | none | 17.10 | 41.4% | 100.0% | 130 | 8.65 | 59.7% | 10.80 | 16.89 | 59.0% | ppm / first horizon / next pucar / coverage rotation / desk on / check-in robust / calib pscale / fill 1.09 / standby 0.15 |
| 1 | g983 | nsga gen 13 | none | 16.69 | 38.1% | 100.0% | 128 | 7.80 | 40.3% | 4.70 | 12.21 | 58.9% | index / first rotation / next window / coverage rotation / desk on / check-in off / calib fail / fill 1.05 / standby 0.17 |
| 2 | g603 | nsga gen 4 | overrun days | 24.26 | 40.8% | 100.0% | 157 | 8.21 | 62.7% | 22.55 | 4.97 | 60.0% | ppm / first rotation / next window / coverage rotation / desk on / check-in off / calib fail / fill 1.01 / standby 0.17 |
| 3 | g774 | nsga gen 8 | overrun days | 22.32 | 43.9% | 100.0% | 147 | 8.61 | 54.8% | 24.25 | 7.87 | 59.9% | ppm / first rotation / next window / coverage rotation / desk on / check-in robust / calib fail / fill 1.05 / standby 0.17 |

Reference policies on seeds 1-20:

| Policy | Useful/day | 4y+ subst. | 4y+ heard | Disposals | Trips/useful | Held | Overrun | Excess | Wasted |
|---|---|---|---|---|---|---|---|---|---|
| status_quo_60 | 17.07 | 29.3% | 99.9% | 99.00 | 11.75 | 91.4% | 21.40 | 50.62 | 71.6% |
| status_quo_ref | 16.53 | 34.8% | 99.9% | 123 | 17.01 | 70.8% | 44.35 | 20.33 | 80.5% |
| fifo_capped | 10.54 | 29.3% | 99.9% | 87.55 | 12.66 | 6.0% | 2.65 | 46.49 | 72.1% |
| bin_packing | 14.95 | 25.2% | 68.7% | 89.90 | 8.77 | 7.2% | 1.65 | 46.38 | 62.7% |
| oldest_first | 10.61 | 27.4% | 98.0% | 82.90 | 12.50 | 94.7% | 9.95 | 70.04 | 71.7% |
| sehgal | 13.51 | 30.5% | 97.1% | 79.90 | 10.82 | 27.5% | 1.00 | 35.19 | 68.0% |
| dimakar | 16.28 | 30.9% | 97.6% | 87.05 | 10.61 | 95.1% | 11.15 | 56.23 | 68.7% |
| joshi | 13.83 | 15.3% | 65.5% | 58.40 | 12.34 | 96.0% | 10.40 | 78.11 | 73.4% |
| benchtime | 11.78 | 26.7% | 73.8% | 86.40 | 8.64 | 68.5% | 0.45 | 75.08 | 57.6% |

## Pareto front on six axes (seeds 1-20)

Useful hearings per day, 4y+ cases moved (a substantive hearing), headline disposals, trips per useful hearing, held as scheduled (all due) and cases never heard; non-dominated among the top 30, every preset and every reference policy.

| Candidate | Origin | Useful/day | 4y+ moved | Disposals | Trips/useful | Held all-due | Never heard |
|---|---|---|---|---|---|---|---|
| g921 | nsga gen 12 | 25.91 | 35.4% | 118 | 7.86 | 66.7% | 1142 |
| g1071 | nsga gen 15 | 25.29 | 34.1% | 112 | 7.53 | 50.0% | 1125 |
| g603 | nsga gen 4 | 24.26 | 40.8% | 157 | 8.21 | 62.7% | 1409 |
| g981 | nsga gen 13 | 24.23 | 34.8% | 117 | 7.50 | 68.7% | 1164 |
| g1011 | nsga gen 14 | 23.12 | 37.6% | 137 | 7.79 | 37.7% | 1317 |
| g855 | nsga gen 10 | 23.09 | 39.4% | 141 | 8.05 | 64.9% | 1449 |
| g774 | nsga gen 8 | 22.32 | 43.9% | 147 | 8.61 | 54.8% | 1416 |
| g934 | nsga gen 12 | 21.82 | 37.6% | 117 | 8.23 | 29.3% | 1172 |
| g817 | nsga gen 9 | 21.37 | 38.1% | 116 | 7.85 | 53.5% | 1190 |
| g_index | preset | 21.34 | 38.6% | 160 | 9.51 | 56.6% | 1373 |
| g848 | nsga gen 10 | 21.33 | 39.7% | 132 | 8.24 | 71.1% | 1264 |
| g822 | nsga gen 9 | 20.74 | 40.0% | 128 | 8.73 | 16.6% | 1081 |
| g867 | nsga gen 10 | 20.58 | 44.9% | 157 | 8.46 | 60.0% | 1386 |
| g1015 | nsga gen 14 | 20.36 | 38.6% | 116 | 8.60 | 47.4% | 1043 |
| g705 | nsga gen 6 | 20.35 | 39.0% | 116 | 8.57 | 46.8% | 1053 |
| g555 | nsga gen 3 | 19.56 | 39.9% | 125 | 8.44 | 16.2% | 1112 |
| g845 | nsga gen 10 | 19.54 | 38.2% | 123 | 8.69 | 77.5% | 1241 |
| g744 | nsga gen 7 | 19.36 | 43.0% | 150 | 8.61 | 58.7% | 1266 |
| c_portfolio | preset | 19.33 | 35.9% | 125 | 9.64 | 60.0% | 886 |
| f_lookahead | preset | 18.13 | 31.8% | 106 | 9.04 | 55.6% | 966 |
| g793 | nsga gen 9 | 18.11 | 38.5% | 122 | 7.88 | 15.6% | 1551 |
| g784 | nsga gen 8 | 18.07 | 40.7% | 124 | 8.86 | 83.8% | 1389 |
| g880 | nsga gen 11 | 17.69 | 37.1% | 117 | 7.73 | 37.1% | 1540 |
| g974 | nsga gen 13 | 17.20 | 33.4% | 106 | 8.67 | 76.1% | 1391 |
| g979 | nsga gen 13 | 17.13 | 36.3% | 114 | 8.50 | 98.4% | 1359 |
| g846 | nsga gen 10 | 17.08 | 37.8% | 130 | 7.64 | 35.5% | 1551 |
| status_quo_60 | preset | 17.07 | 29.3% | 99.00 | 11.75 | 91.4% | 257 |
| status_quo_60 | policy | 17.07 | 29.3% | 99.00 | 11.75 | 91.4% | 257 |
| g983 | nsga gen 13 | 16.69 | 38.1% | 128 | 7.80 | 40.3% | 1576 |
| b_horizon | preset | 16.57 | 45.9% | 173 | 9.67 | 63.2% | 1619 |
| status_quo_ref | preset | 16.53 | 34.8% | 123 | 17.01 | 70.8% | 758 |
| status_quo_ref | policy | 16.53 | 34.8% | 123 | 17.01 | 70.8% | 758 |
| g967 | nsga gen 13 | 16.39 | 35.7% | 102 | 7.79 | 61.4% | 1412 |
| dimakar | preset | 16.28 | 30.9% | 87.05 | 10.61 | 95.1% | 791 |
| dimakar | policy | 16.28 | 30.9% | 87.05 | 10.61 | 95.1% | 791 |
| bin_packing | preset | 14.95 | 25.2% | 89.90 | 8.77 | 7.2% | 1010 |
| bin_packing | policy | 14.95 | 25.2% | 89.90 | 8.77 | 7.2% | 1010 |
| joshi | policy | 13.83 | 15.3% | 58.40 | 12.34 | 96.0% | 461 |

## Held as scheduled and never heard: closable or a trade-off?

Status quo 60 on seeds 1-6: held as scheduled (all due) 91.3%, never heard 262, useful/day 17.25. "Keeps the gains" = more useful hearings per day than the status quo, 4y+ moved and disposals not worse, trips per useful hearing not higher.

| Tolerance on held all-due / never heard | Genomes that close both | Of those, keeping the gains | Best useful/day among them |
|---|---|---|---|
| 0 points / 0 cases | 0 | 0 | n/a |
| 5 points / 100 cases | 0 | 0 | n/a |
| 10 points / 250 cases | 1 | 1 | 18.61 |
| 20 points / 500 cases | 10 | 4 | 18.61 |

The frontier: the most useful hearings per day found at each level of held as scheduled (all due), among genomes that keep the other gains (seeds 1-6).

| Held all-due at least | Best useful/day | Its never heard | Genes |
|---|---|---|---|
| 50% | 25.97 | 1562 | ppm / first horizon / next projected / coverage mention / desk on / check-in off / calib pscale / fill 1.50 / standby 0.23 |
| 60% | 25.97 | 1562 | ppm / first horizon / next projected / coverage mention / desk on / check-in off / calib pscale / fill 1.50 / standby 0.23 |
| 70% | 24.94 | 1004 | ppm / first rotation / next window / coverage rotation / desk off / check-in robust / calib off / fill 1.18 / standby 0.11 |
| 75% | 24.94 | 1004 | ppm / first rotation / next window / coverage rotation / desk off / check-in robust / calib off / fill 1.18 / standby 0.11 |
| 80% | 21.07 | 1203 | ppm / first rotation / next window / coverage rotation / desk on / check-in off / calib learned / fill 1.05 / standby 0.17 |
| 85% | 19.41 | 1520 | ppm / first rotation / next window / coverage floor / desk off / check-in off / calib fail / fill 0.84 / standby 0.17 |
| 90% | 19.41 | 1520 | ppm / first rotation / next window / coverage floor / desk off / check-in off / calib fail / fill 0.84 / standby 0.17 |

## Fidelity: redesign presets against their source planners (corrected court, seeds 1-20)

Baselines and judges reproduce their coded policies exactly on seed 1 (test/zoo.test.ts checks seeds 1-3). The redesigns are re-implemented from their components, so they match in kind, not to the decimal.

| Candidate | Useful (substantive) hearings per day | 4y+ cases heard at all | 4y+ cases with a substantive hearing | Headline disposals | Trips per useful hearing | Wasted listings | Next-date excess over the minimum (days) | Held as scheduled (all due) | Cases never heard |
|---|---|---|---|---|---|---|---|---|---|
| g_index (zoo) | 21.34 | 76.2% | 38.6% | 160 | 9.51 | 62.6% | 11.08 | 56.6% | 1373 |
| index (source planner) | 21.33 | 77.3% | 38.6% | 154 | 9.48 | 62.4% | 14.36 | 59.9% | 1360 |
| c_portfolio (zoo) | 19.33 | 87.1% | 35.9% | 125 | 9.64 | 62.8% | 29.11 | 60.0% | 886 |
| portfolio (source planner) | 20.37 | 100.0% | 40.5% | 138 | 9.02 | 60.6% | 19.99 | 56.0% | 1209 |
| b_horizon (zoo) | 16.57 | 99.5% | 45.9% | 173 | 9.67 | 62.2% | 7.41 | 63.2% | 1619 |
| horizon (source planner) | 16.95 | 99.1% | 45.4% | 170 | 9.62 | 62.2% | 7.00 | 62.9% | 1604 |
| a_fillfair (zoo) | 15.85 | 100.0% | 43.7% | 154 | 10.04 | 63.4% | 20.55 | 59.7% | 1420 |
| fill-fair (source planner) | 15.68 | 100.0% | 41.3% | 156 | 9.92 | 63.1% | 19.80 | 62.7% | 1399 |
| f_lookahead (zoo) | 18.13 | 84.6% | 31.8% | 106 | 9.04 | 59.8% | 43.62 | 55.6% | 966 |
| lookahead (source planner) | 17.31 | 85.8% | 30.6% | 101 | 9.35 | 61.0% | 46.52 | 66.3% | 941 |
| e_search (zoo) | 8.90 | 83.9% | 34.3% | 116 | 10.90 | 66.1% | 30.10 | 76.0% | 1939 |
| search (source planner) | 11.31 | 94.6% | 40.3% | 97.25 | 10.29 | 64.6% | 1.20 | 50.8% | 1809 |

## Which components win

Top set = the 30 candidates re-scored in stage 3 (chosen by constrained non-dominated sorting on seeds 1-6). 99 of 640 genomes evaluated on seeds 1-6 met every guardrail.

| Gene | Value | Share of the top set | Share of all evaluated |
|---|---|---|---|
| selection | fifo | 0% | 5% |
| selection | index | 23% | 12% |
| selection | knapsack | 0% | 9% |
| selection | oldest | 0% | 7% |
| selection | portfolio | 0% | 8% |
| selection | ppm | 77% | 43% |
| selection | simple | 0% | 8% |
| selection | youngest | 0% | 8% |
| firstDates | horizon | 10% | 25% |
| firstDates | priority | 0% | 18% |
| firstDates | rotation | 90% | 45% |
| firstDates | spread | 0% | 12% |
| nextDate | earliest | 13% | 20% |
| nextDate | flat60 | 17% | 21% |
| nextDate | projected | 0% | 13% |
| nextDate | pucar | 13% | 15% |
| nextDate | window | 57% | 31% |
| coverage | floor | 0% | 11% |
| coverage | mention | 0% | 20% |
| coverage | none | 0% | 17% |
| coverage | rotation | 100% | 52% |
| callOrder | cluster | 30% | 22% |
| callOrder | rank | 50% | 40% |
| callOrder | short | 20% | 24% |
| callOrder | simple | 0% | 14% |
| calibration | fail | 53% | 34% |
| calibration | learned | 17% | 25% |
| calibration | off | 0% | 16% |
| calibration | pscale | 30% | 25% |
| caseEstimate | false | 40% | 23% |
| caseEstimate | true | 60% | 77% |
| priorCheck | false | 50% | 42% |
| priorCheck | true | 50% | 58% |
| desk | false | 10% | 21% |
| desk | true | 90% | 79% |
| checkin | false | 50% | 32% |
| checkin | true | 50% | 68% |
| checkinRobust | false | 47% | 52% |
| checkinRobust | true | 53% | 48% |
| cluster | false | 30% | 46% |
| cluster | true | 70% | 54% |
| callTimes | false | 37% | 26% |
| callTimes | true | 63% | 74% |
| quickRelist | false | 50% | 37% |
| quickRelist | true | 50% | 63% |
| gapOfHeard | false | 60% | 45% |
| gapOfHeard | true | 40% | 55% |
| countDiary | false | 90% | 81% |
| countDiary | true | 10% | 19% |
| purposeDays | false | 93% | 86% |
| purposeDays | true | 7% | 14% |
| carryForward | false | 87% | 86% |
| carryForward | true | 13% | 14% |

| Dial | Mean in the top set | Mean of all evaluated |
|---|---|---|
| fillTarget | 1.02 | 1.09 |
| standbyShare | 0.15 | 0.15 |
| promiseFill | 0.94 | 1.07 |
| initialFill | 0.71 | 0.73 |
| firstOldShare | 0.56 | 0.47 |
| ageExponent | 1.88 | 1.72 |
| ageingFloor | 0.27 | 0.30 |
| relistDays | 11.37 | 9.81 |
| relistCap | 0.91 | 1.00 |
| pendingHold | 0.65 | 0.53 |
| weight throughput | 1.67 | 1.48 |
| weight disposal | 1.72 | 1.49 |
| weight fairness | 0.63 | 1.10 |
| weight trips | 2.69 | 1.95 |
| weight predictability | 1.22 | 1.36 |

### Stage 1 by family (seeds 1-4): mean useful hearings per day and share meeting every guardrail

| selection | n | Useful/day | 4y+ subst. | Trips/useful | Meets guardrails |
|---|---|---|---|---|---|
| fifo | 44 | 13.58 | 36.2% | 12.17 | 0% |
| index | 55 | 17.05 | 34.8% | 10.41 | 0% |
| knapsack | 73 | 15.83 | 35.3% | 10.21 | 0% |
| oldest | 57 | 13.92 | 38.3% | 12.60 | 0% |
| portfolio | 56 | 16.39 | 36.2% | 10.35 | 0% |
| ppm | 49 | 19.79 | 31.6% | 8.72 | 2% |
| simple | 58 | 14.68 | 38.6% | 11.14 | 0% |
| youngest | 64 | 18.66 | 26.2% | 9.91 | 0% |

| firstDates | n | Useful/day | 4y+ subst. | Trips/useful | Meets guardrails |
|---|---|---|---|---|---|
| horizon | 111 | 14.74 | 36.7% | 10.63 | 0% |
| priority | 135 | 16.03 | 34.2% | 10.65 | 0% |
| rotation | 107 | 16.53 | 35.9% | 10.93 | 1% |
| spread | 103 | 17.95 | 31.2% | 10.40 | 0% |

| nextDate | n | Useful/day | 4y+ subst. | Trips/useful | Meets guardrails |
|---|---|---|---|---|---|
| earliest | 116 | 16.75 | 35.2% | 10.64 | 0% |
| flat60 | 87 | 14.79 | 31.6% | 10.57 | 0% |
| projected | 91 | 16.02 | 34.4% | 10.50 | 0% |
| pucar | 75 | 16.24 | 34.6% | 10.75 | 0% |
| window | 87 | 17.38 | 36.7% | 10.83 | 1% |

| coverage | n | Useful/day | 4y+ subst. | Trips/useful | Meets guardrails |
|---|---|---|---|---|---|
| floor | 95 | 16.11 | 32.5% | 10.19 | 0% |
| mention | 126 | 15.95 | 33.6% | 10.67 | 0% |
| none | 131 | 16.84 | 32.7% | 10.27 | 0% |
| rotation | 104 | 16.07 | 39.9% | 11.55 | 1% |

| calibration | n | Useful/day | 4y+ subst. | Trips/useful | Meets guardrails |
|---|---|---|---|---|---|
| fail | 110 | 17.01 | 34.6% | 10.34 | 1% |
| learned | 120 | 15.90 | 34.9% | 10.75 | 0% |
| off | 123 | 15.91 | 33.1% | 10.54 | 0% |
| pscale | 103 | 16.33 | 35.8% | 11.02 | 0% |

| desk | n | Useful/day | 4y+ subst. | Trips/useful | Meets guardrails |
|---|---|---|---|---|---|
| false | 120 | 15.01 | 34.9% | 11.71 | 0% |
| true | 336 | 16.71 | 34.4% | 10.28 | 0% |

| checkin | n | Useful/day | 4y+ subst. | Trips/useful | Meets guardrails |
|---|---|---|---|---|---|
| false | 100 | 16.50 | 33.8% | 11.07 | 0% |
| true | 356 | 16.20 | 34.8% | 10.54 | 0% |

