# Judge styles on top of the winner (held-out seeds)

Generated 15:17 IST. Winner g237. Seeds 31-60 (30). Rules: RULE_PRESETS.sehgal_way, dimakar_way and joshi_way from the package's src/planner/zoo/rules.ts (the rules patch as applied to the package), laid over the winner's configuration (applyRules semantics: the preset wins field by field, weights merged, the 15% floor clamped). Each style is the winner with that judge's rules applied on top (the 15% floor holds), compared with the judge's plain policy as coded in the package, with the winner alone, and with today's way, on the same seeds.

Cross-check: scripts/rules-cost.ts (the rules patch's own cost script) gives the same direction on the winner; it keys the court differently, so its numbers are not comparable and are not published here.

## Rule compliance (scripts/rules-check.ts)

`bun run scripts/rules-check.ts --genome /Users/rohan/Downloads/pucar-hackathon/submission/submissions/benchtime/out/tournament/winner.json --seeds 31,32 --end 2026-12-15`: every day plan and every next date of the winner under each rule set checked against the rules (ruleViolations, nextDateViolations), full horizon, seeds 31 and 32, roster keyed "seed42" as that script does.

| Rule set | Day plans | Listings | Next dates | Violations |
|---|---|---|---|---|
| sehgal_way | 102 | 5482 | 5478 | 0 |
| dimakar_way | 102 | 6102 | 6062 | 0 |
| joshi_way | 102 | 6121 | 6138 | 0 |
| kitchen_sink | 102 | 3679 | 3873 | 0 |

Full output in styles-rules-check.txt.

| Style | How | Beats the plain style on (of measures with a direction, significant) | Loses on (significant) | Guardrails failed vs today |
|---|---|---|---|---|
| Sehgal's rules | Fresh and notice matters 11:00 to 13:30, the oldest matters 14:30 to 16:30, every matter given a time; a matter not reached returns the same weekday next week and is taken first; lists past the day (fill 130%). | 29 of 53 | 14: Reach rate; 4y+ cases heard at all; Gap from first scheduled to first heard; Days that overran; Next date excess over the minimum; Minutes past capacity; Reach rate excluding uncalled standby; Reach rate on sitting days; 4y+ cases never heard; First promise kept, per case; Next date excess over the gap for the next purpose; Minutes waited per person heard; Minutes waited, counting matters not reached; 4y+ cases acted on | 6: dates honoured (heard or desk order on the day); cases never heard; 4y+ heard at all (README); every 4y+ case heard at least once (README score); court time used; load balance across days |
| Dimakar's rules | Evidence, arguments and judgments on Monday, Wednesday and Friday; appearances and process on Tuesday and Thursday; oldest first; an advocate's matters called together; never past the day's capacity. | 34 of 53 | 13: Reach rate; Gap from first scheduled to first heard; Days that overran; Held as scheduled (as listed); Held as scheduled (all due); Held on the promised date; Deferred per sitting day; Minutes past capacity; Reach rate on sitting days; Gap to first heard, never heard at the end; Dates honoured (court or desk order); Substantive on the promised date (all due); First promise kept, per case | 5: dates honoured (heard or desk order on the day); cases never acted on; cases never heard; every 4y+ case heard at least once (README score); load balance across days |
| Joshi's rules | Fresh matters first: the youngest filings called first all day; old cases get the 15% floor and no more (fairness weight 0). | 30 of 53 | 15: Reach rate; Gap from first scheduled to first heard; Days that overran; Held as scheduled (as listed); Held as scheduled (all due); Held on the promised date; Deferred per sitting day; Minutes past capacity; Reach rate on sitting days; Gap to first heard, never heard at the end; Dates honoured (court or desk order); Dates broken or never given; Substantive on the promised date (all due); First promise kept, per case; Gap from the horizon start to first heard, all cases | 7: dates honoured (heard or desk order on the day); cases never heard; 4y+ heard at all (README); every 4y+ case heard at least once (README score); 4y+ moved on; days that ran late; reach rate |

## Key measures (mean [95% t interval])

| Measure | benchtime_final | style_sehgal | sehgal | style_dimakar | dimakar | style_joshi | joshi | status_quo_60 |
|---|---|---|---|---|---|---|---|---|
| Substantive per sitting day | 18.2 [18.1, 18.3] | 17.3 [17.2, 17.4] | 13.6 [13.5, 13.7] | 18.8 [18.7, 18.9] | 16.2 [16.0, 16.4] | 18.8 [18.7, 18.9] | 13.7 [13.5, 13.9] | 17.1 [17.0, 17.2] |
| Disposals on the merits (verdict + settlement + compounded) | 89.3 [86.7, 91.9] | 85.1 [82.5, 87.8] | 72.6 [69.8, 75.4] | 97.1 [94.5, 99.6] | 79.3 [76.4, 82.2] | 86.9 [84.1, 89.6] | 46.7 [43.7, 49.6] | 84.9 [81.8, 88.0] |
| Dates broken or never given | 166 [151, 181] | 1563 [1519, 1608] | 5646 [5629, 5663] | 553 [539, 567] | 810 [799, 822] | 712 [640, 783] | 449 [436, 461] | 245 [225, 265] |
| Cases never heard | 380 [368, 391] | 491 [482, 499] | 996 [994, 998] | 545 [534, 557] | 783 [773, 793] | 391 [378, 405] | 449 [436, 461] | 240 [221, 258] |
| Pending 4y+ cases at the end | 952 [949, 956] | 959 [955, 962] | 960 [957, 963] | 938 [935, 941] | 950 [946, 954] | 963 [960, 966] | 1065 [1062, 1068] | 960 [957, 964] |
| Trips per substantive hearing | 10.5 [10.4, 10.6] | 10.5 [10.4, 10.6] | 10.7 [10.6, 10.8] | 10.6 [10.6, 10.7] | 10.7 [10.6, 10.8] | 10.9 [10.8, 11.0] | 12.5 [12.3, 12.6] | 11.7 [11.6, 11.8] |
| Days that overran | 19.7 [18.8, 20.7] | 13.3 [12.2, 14.3] | 0.70 [0.36, 1.04] | 20.6 [19.6, 21.6] | 11.3 [10.4, 12.2] | 28.1 [27.1, 29.2] | 9.70 [8.87, 10.5] | 20.6 [19.7, 21.5] |
| Cases whose date came up | 3000 [3000, 3000] | 3000 [3000, 3000] | 3000 [3000, 3000] | 3000 [3000, 3000] | 2304 [2304, 2304] | 3000 [3000, 3000] | 2646 [2646, 2646] | 3000 [3000, 3000] |
| Dates honoured (court or desk order) | 94.9% [94.5%, 95.4%] | 65.4% [64.7%, 66.1%] | 27.5% [27.5%, 27.6%] | 85.1% [84.8%, 85.5%] | 95.7% [95.2%, 96.1%] | 81.2% [79.7%, 82.8%] | 96.4% [96.0%, 96.9%] | 92.0% [91.3%, 92.7%] |
| Cases never acted on | 125 [113, 136] | 254 [246, 262] | 996 [994, 998] | 393 [382, 403] | 783 [773, 793] | 154 [139, 169] | 449 [436, 461] | 240 [221, 258] |
| 4y+ cases heard at all | 100.0% [100.0%, 100.0%] | 96.4% [96.3%, 96.5%] | 97.1% [97.0%, 97.2%] | 100.0% [100.0%, 100.0%] | 98.1% [97.5%, 98.7%] | 91.7% [90.5%, 92.8%] | 65.9% [65.1%, 66.6%] | 99.9% [99.8%, 100.1%] |
| 4y+ cases never heard | 0.00 [0.00, 0.00] | 32.1 [31.1, 33.1] | 26.0 [25.5, 26.6] | 0.10 [-0.05, 0.25] | 17.1 [11.6, 22.6] | 74.6 [64.3, 84.8] | 306 [300, 313] | 0.53 [-0.56, 1.62] |
| 4y+ cases heard substantively | 30.8% [30.4%, 31.3%] | 30.0% [29.5%, 30.6%] | 30.4% [30.0%, 30.9%] | 33.5% [33.1%, 33.9%] | 30.9% [30.4%, 31.3%] | 28.2% [27.7%, 28.7%] | 14.9% [14.5%, 15.3%] | 29.2% [28.8%, 29.7%] |
| Next date excess over the minimum | 42.7 [42.6, 42.8] | 39.2 [39.0, 39.3] | 35.3 [35.2, 35.5] | 33.6 [33.5, 33.7] | 56.4 [56.0, 56.7] | 41.6 [41.5, 41.8] | 78.0 [77.9, 78.2] | 50.7 [50.6, 50.7] |
| Utilisation within capacity | 90.0% [89.6%, 90.3%] | 84.6% [83.9%, 85.4%] | 59.5% [58.9%, 60.2%] | 89.1% [88.7%, 89.6%] | 69.0% [68.2%, 69.7%] | 93.5% [93.2%, 93.8%] | 75.8% [75.2%, 76.5%] | 90.7% [90.3%, 91.0%] |
| Reach rate | 95.2% [94.8%, 95.7%] | 97.2% [96.9%, 97.6%] | 99.8% [99.7%, 100.0%] | 94.9% [94.5%, 95.4%] | 95.7% [95.2%, 96.1%] | 90.5% [89.8%, 91.1%] | 96.4% [96.0%, 96.9%] | 92.0% [91.3%, 92.7%] |
| Substantiveness (readme) | 32.9% [32.7%, 33.2%] | 33.1% [32.8%, 33.3%] | 32.3% [32.0%, 32.5%] | 33.2% [32.9%, 33.4%] | 32.6% [32.2%, 32.9%] | 34.7% [34.5%, 35.0%] | 27.4% [27.0%, 27.7%] | 30.9% [30.7%, 31.1%] |
| Wasted listings | 68.7% [68.5%, 68.8%] | 67.8% [67.6%, 68.1%] | 67.8% [67.5%, 68.0%] | 68.5% [68.4%, 68.7%] | 68.8% [68.6%, 69.1%] | 68.6% [68.4%, 68.8%] | 73.6% [73.3%, 73.9%] | 71.5% [71.3%, 71.8%] |
| Minutes waited per person heard | 141 [140, 142] | 49.8 [49.1, 50.6] | 1.07 [0.86, 1.28] | 45.7 [45.1, 46.4] | 137 [135, 138] | 39.1 [38.4, 39.8] | 127 [126, 129] | 155 [154, 157] |
| Load balance (CV of daily minutes) | 0.14 [0.14, 0.15] | 0.18 [0.17, 0.18] | 0.26 [0.25, 0.27] | 0.18 [0.18, 0.19] | 0.43 [0.42, 0.44] | 0.12 [0.11, 0.12] | 0.27 [0.27, 0.28] | 0.13 [0.13, 0.14] |

## Sehgal's rules: every measure, winner + rules minus the plain sehgal / minus the winner alone / minus today (paired, 95% t)

| Measure | minus sehgal | minus the winner | minus today |
|---|---|---|---|
| Utilisation | +25.9 pts [+25.0 pts, +26.8 pts] better | -5.85 pts [-6.65 pts, -5.06 pts] worse | -6.02 pts [-6.88 pts, -5.17 pts] worse |
| Reach rate | -2.64 pts [-2.95 pts, -2.33 pts] worse | +1.99 pts [+1.56 pts, +2.42 pts] better | +5.22 pts [+4.61 pts, +5.82 pts] better |
| Substantiveness (readme) | +0.83 pts [+0.53 pts, +1.13 pts] better | +0.17 pts [-0.13 pts, +0.47 pts] | +2.15 pts [+1.82 pts, +2.49 pts] better |
| 4y+ cases heard at all | -0.68 pts [-0.81 pts, -0.55 pts] worse | -3.58 pts [-3.69 pts, -3.47 pts] worse | -3.52 pts [-3.68 pts, -3.36 pts] worse |
| 4y+ cases heard substantively | -0.38 pts [-0.91 pts, +0.15 pts] | -0.80 pts [-1.30 pts, -0.31 pts] worse | +0.80 pts [+0.28 pts, +1.32 pts] better |
| Gap from first scheduled to first heard | +2.88 [+2.79, +2.96] worse | +2.97 [+2.89, +3.05] worse | +3.46 [+3.37, +3.56] worse |
| Utilisation within capacity | +25.1 pts [+24.2 pts, +25.9 pts] better | -5.35 pts [-6.10 pts, -4.59 pts] worse | -6.07 pts [-6.88 pts, -5.25 pts] worse |
| Days that overran | +12.6 [+11.4, +13.7] worse | -6.47 [-7.76, -5.17] better | -7.37 [-8.64, -6.10] better |
| Idle capacity | -25.1 pts [-25.9 pts, -24.2 pts] better | +5.35 pts [+4.59 pts, +6.10 pts] worse | +6.07 pts [+5.25 pts, +6.88 pts] worse |
| Held as scheduled (as listed) | +35.5 pts [+34.8 pts, +36.3 pts] better | -31.4 pts [-32.0 pts, -30.7 pts] worse | -28.9 pts [-29.7 pts, -28.1 pts] worse |
| Held as scheduled (all due) | +31.6 pts [+30.9 pts, +32.2 pts] better | -27.1 pts [-27.7 pts, -26.5 pts] worse | -32.9 pts [-33.6 pts, -32.1 pts] worse |
| Substantiveness (caseStudy) | +0.83 pts [+0.53 pts, +1.13 pts] better | +0.17 pts [-0.13 pts, +0.47 pts] | +2.15 pts [+1.82 pts, +2.49 pts] better |
| Cases aged 0-1 years at the start | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] |
| Cases aged 1-3 years at the start | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] |
| Cases aged 3-4 years at the start | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] |
| Cases aged 4-5 years at the start | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] |
| Cases aged 5+ years at the start | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] |
| Cases aged 3+ years at the start | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] |
| Cases aged 4+ years at the start | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] |
| Cases aged 0-1 years at the end | +0.20 [-0.01, +0.41] | -0.23 [-0.58, +0.12] | -2.23 [-2.81, -1.66] |
| Cases aged 1-3 years at the end | -4.37 [-5.47, -3.26] | -0.30 [-1.48, +0.88] | -0.33 [-1.68, +1.01] |
| Cases aged 3-4 years at the end | -24.0 [-25.5, -22.5] | +4.23 [+1.97, +6.49] | +2.87 [+0.49, +5.24] |
| Cases aged 4-5 years at the end | -3.97 [-6.05, -1.89] | +3.50 [+1.62, +5.38] | +1.83 [-0.06, +3.73] |
| Cases aged 5+ years at the end | +2.07 [-0.10, +4.23] | +2.63 [+0.05, +5.22] worse | -3.70 [-6.08, -1.32] better |
| Cases aged 3+ years at the end | -25.9 [-29.0, -22.8] better | +10.4 [+7.38, +13.4] worse | +1.00 [-2.59, +4.59] |
| Cases aged 4+ years at the end | -1.90 [-4.51, +0.71] | +6.13 [+3.58, +8.69] worse | -1.87 [-4.62, +0.88] |
| Next date excess over the minimum | +3.84 [+3.65, +4.03] worse | -3.55 [-3.66, -3.44] better | -11.5 [-11.6, -11.4] better |
| Next dates the case was not ready for | -7.29 pts [-8.63 pts, -5.96 pts] better | -0.69 pts [-1.68 pts, +0.31 pts] | -0.41 pts [-2.89 pts, +2.07 pts] |
| Throughput (disposals per month) | +7.44 [+6.44, +8.43] better | -1.78 [-2.78, -0.78] worse | +1.47 [+0.28, +2.66] better |
| Judge time used | +25.9 pts [+25.0 pts, +26.8 pts] better | -5.85 pts [-6.65 pts, -5.06 pts] worse | -6.02 pts [-6.88 pts, -5.17 pts] worse |
| Wasted listings | +0.05 pts [-0.25 pts, +0.35 pts] | -0.83 pts [-1.08 pts, -0.57 pts] better | -3.71 pts [-3.98 pts, -3.44 pts] better |
| Held on the promised date | +31.6 pts [+30.9 pts, +32.2 pts] better | -27.1 pts [-27.7 pts, -26.5 pts] worse | -32.9 pts [-33.6 pts, -32.1 pts] worse |
| Oldest pending case | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] |
| 95th percentile pending age | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] |
| Cases never heard | -505 [-514, -496] better | +111 [+99.9, +123] worse | +251 [+232, +270] worse |
| Load balance (CV of daily minutes) | -0.09 [-0.10, -0.08] better | +0.03 [+0.03, +0.04] worse | +0.04 [+0.04, +0.05] worse |
| Listed per sitting day | +11.6 [+11.5, +11.8] | -4.15 [-4.24, -4.06] | -6.21 [-6.31, -6.11] |
| Reached per sitting day | +10.2 [+10.0, +10.4] better | -2.87 [-3.12, -2.63] worse | -2.91 [-3.31, -2.50] worse |
| Substantive per sitting day | +3.73 [+3.58, +3.87] better | -0.86 [-0.99, -0.72] worse | +0.23 [+0.07, +0.39] better |
| Disposals (headline) | +18.6 [+16.1, +21.0] better | -4.43 [-6.93, -1.94] worse | +3.67 [+0.70, +6.63] better |
| Disposals of 4y+ cases (headline) | +2.80 [+0.60, +5.00] better | -3.10 [-5.37, -0.83] worse | +2.30 [+0.06, +4.54] better |
| Trips per substantive hearing | -0.26 [-0.35, -0.16] better | -0.02 [-0.10, +0.06] | -1.24 [-1.34, -1.15] better |
| Wasted trips | -0.79 pts [-1.11 pts, -0.47 pts] better | -0.68 pts [-0.94 pts, -0.42 pts] better | -3.34 pts [-3.62 pts, -3.06 pts] better |
| Desk matters per sitting day | +5.54 [+5.45, +5.63] | -0.01 [-0.02, +0.00] | +5.54 [+5.45, +5.63] |
| Vacated per sitting day | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] |
| Deferred per sitting day | -81.5 [-82.3, -80.8] better | +28.7 [+28.0, +29.4] worse | +29.2 [+28.4, +29.9] worse |
| Sitting days | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] |
| Minutes past capacity | +178 [+155, +201] worse | -108 [-143, -73.6] better | +8.69 [-16.8, +34.2] |
| Reach rate excluding uncalled standby | -0.10 pts [-0.16 pts, -0.04 pts] worse | +1.17 pts [+0.95 pts, +1.39 pts] better | +7.76 pts [+7.17 pts, +8.35 pts] better |
| Reach rate on sitting days | -2.64 pts [-2.95 pts, -2.33 pts] worse | +2.00 pts [+1.56 pts, +2.43 pts] better | +5.22 pts [+4.62 pts, +5.83 pts] better |
| Gap to first heard, never heard at the end | -4.73 [-4.84, -4.62] better | +1.60 [+1.47, +1.74] worse | +4.41 [+4.11, +4.72] worse |
| Cases whose date came up | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] |
| Dates honoured (court or desk order) | +37.8 pts [+37.2 pts, +38.5 pts] better | -29.5 pts [-30.2 pts, -28.9 pts] worse | -26.6 pts [-27.3 pts, -25.9 pts] worse |
| Dates broken or never given | -4083 [-4127, -4039] better | +1398 [+1358, +1437] worse | +1318 [+1278, +1359] worse |
| Heard rows that were on the promised date | 0.00 pts [0.00 pts, 0.00 pts] | 0.00 pts [0.00 pts, 0.00 pts] | 0.00 pts [0.00 pts, 0.00 pts] |
| Mean next date gap | +3.45 [+3.26, +3.64] | -3.45 [-3.56, -3.34] | -12.0 [-12.1, -11.9] |
| Next dates inside the minimum | +1.32 pts [+1.24 pts, +1.40 pts] | -0.03 pts [-0.11 pts, +0.05 pts] | +1.39 pts [+1.31 pts, +1.47 pts] |
| Next dates wasted, counting absences | +1.16 pts [-0.00 pts, +2.32 pts] | -1.36 pts [-2.42 pts, -0.30 pts] better | -1.29 pts [-4.13 pts, +1.54 pts] |
| Next dates not ready, counting desk re-checks | -7.29 pts [-8.62 pts, -5.95 pts] better | -0.78 pts [-1.76 pts, +0.20 pts] | -0.40 pts [-2.89 pts, +2.08 pts] |
| 4y+ cases never heard | +6.07 [+4.89, +7.24] worse | +32.1 [+31.1, +33.1] worse | +31.6 [+30.1, +33.0] worse |
| Pending 4y+ cases at the end | -1.90 [-4.51, +0.71] | +6.13 [+3.58, +8.69] worse | -1.87 [-4.62, +0.88] |
| Disposals inferred from the log | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] |
| Substantive on the promised date (all due) | +10.7 pts [+10.4 pts, +10.9 pts] better | -8.82 pts [-9.07 pts, -8.57 pts] worse | -8.89 pts [-9.15 pts, -8.63 pts] worse |
| First promise kept, per case | -7.70 pts [-8.29 pts, -7.12 pts] worse | -30.3 pts [-30.8 pts, -29.8 pts] worse | -36.0 pts [-36.6 pts, -35.4 pts] worse |
| Next date excess over the gap for the next purpose | +3.90 [+3.71, +4.09] worse | -3.56 [-3.67, -3.46] better | -11.6 [-11.7, -11.5] better |
| Next purposes inferred | +0.94 pts [+0.74 pts, +1.13 pts] | -0.26 pts [-0.39 pts, -0.13 pts] | -6.15 pts [-6.26 pts, -6.04 pts] |
| Next dates beyond the horizon end | +0.94 pts [+0.74 pts, +1.13 pts] | -0.26 pts [-0.39 pts, -0.13 pts] | -6.15 pts [-6.26 pts, -6.04 pts] |
| Gap from the horizon start to first heard, all cases | -4.73 [-4.84, -4.62] better | +1.60 [+1.47, +1.74] worse | +4.41 [+4.11, +4.72] worse |
| Minutes waited per person heard | +48.8 [+48.0, +49.6] worse | -91.1 [-92.4, -89.8] better | -106 [-107, -104] better |
| Minutes waited, counting matters not reached | +56.9 [+56.1, +57.6] worse | -94.4 [-95.8, -93.0] better | -114 [-115, -112] better |
| Mean age of the 100 oldest pending cases | +0.00 [-0.00, +0.01] | -0.00 [-0.01, +0.00] | -0.01 [-0.01, -0.00] better |
| Cases never acted on | -742 [-750, -734] better | +129 [+118, +141] worse | +14.5 [-3.54, +32.5] |
| 4y+ cases acted on | -0.68 pts [-0.81 pts, -0.55 pts] worse | -3.58 pts [-3.69 pts, -3.47 pts] worse | -3.52 pts [-3.68 pts, -3.36 pts] worse |
| Disposals by verdict | +8.87 [+6.76, +11.0] | -4.40 [-6.73, -2.07] | +0.93 [-1.42, +3.29] |
| Disposals by settlement | +0.17 [-0.35, +0.69] | -0.70 [-1.08, -0.32] | -1.30 [-1.85, -0.75] |
| Disposals by compounding | +3.50 [+2.42, +4.58] | +0.93 [-0.04, +1.91] | +0.60 [-0.32, +1.52] |
| Acquittals for the complainant's default | +5.77 [+4.84, +6.70] | -0.13 [-1.47, +1.20] | +1.80 [+0.52, +3.08] |
| Dismissals for steps not taken | +0.27 [-0.06, +0.59] | -0.13 [-0.53, +0.27] | +1.63 [+1.07, +2.19] |
| Post-judgment closures | +12.3 [+10.8, +13.8] | -5.73 [-7.61, -3.86] | -1.47 [-3.53, +0.60] |
| Long-pending splits | -0.80 [-1.13, -0.47] | +0.33 [+0.15, +0.51] | -0.63 [-0.92, -0.35] |
| Cases off the file, all routes | +30.1 [+26.9, +33.2] | -9.83 [-13.2, -6.50] | +1.57 [-2.44, +5.57] |
| Disposals with an inferred route | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] |
| Throughput, all routes | +12.0 [+10.8, +13.3] | -3.94 [-5.27, -2.60] | +0.63 [-0.98, +2.23] |
| Disposals on the merits (verdict + settlement + compounded) | +12.5 [+10.2, +14.9] better | -4.17 [-6.42, -1.91] worse | +0.23 [-2.32, +2.79] |

Guardrails against today's way:

| Guardrail | Measure | Margin | Candidate | Today | Paired difference [95% CI] | Bound | Pass | Pass with the tournament's t |
|---|---|---|---|---|---|---|---|---|
| every case given a date inside the quarter | extra.casesScheduled | >= 2985 | 3000 | 3000 | (absolute limit on the mean) | 3000 | yes | yes |
| dates honoured (heard or desk order on the day) | extra.promisesHonouredInclDesk | -0.02 | 65.4% | 92.0% | -26.6 pts [-27.3 pts, -25.9 pts] | -27.3 pts | **NO** | no |
| cases never acted on | extra.neverActedOn | +100 | 254 | 240 | +14.5 [-3.54, +32.5] | +32.5 | yes | yes |
| cases never heard | siddarth.neverHeard | +150 | 491 | 240 | +251 [+232, +270] | +270 | **NO** | no |
| 4y+ heard at all (README) | readme.backlog4yHeardShare | -0.01 | 96.4% | 99.9% | -3.52 pts [-3.68 pts, -3.36 pts] | -3.68 pts | **NO** | no |
| every 4y+ case heard at least once (README score) | extra.neverHeard4yPlus | +0.5 | 32.1 | 0.53 | +31.6 [+30.1, +33.0] | +33.0 | **NO** | no |
| 4y+ moved on | readme.backlog4ySubstantiveShare | -0.01 | 30.0% | 29.2% | +0.80 pts [+0.28 pts, +1.32 pts] | +0.28 pts | yes | yes |
| 4y+ still pending at the end | extra.pending4yPlusEnd | +5 | 959 | 960 | -1.87 [-4.62, +0.88] | +0.88 | yes | yes |
| disposals on the merits (verdict + settlement + compounded) | derived.meritsDisposals | -5 | 85.1 | 84.9 | +0.23 [-2.32, +2.79] | -2.32 | yes | yes |
| next-date excess over PUCAR's gap | caseStudy.nextDateExcessDays | +2 | 39.2 | 50.7 | -11.5 [-11.6, -11.4] | -11.4 | yes | yes |
| days that ran late | caseStudy.overrunDays | +2 | 13.3 | 20.6 | -7.37 [-8.64, -6.10] | -6.10 | yes | yes |
| court time used | caseStudy.utilisation | -0.05 | 84.6% | 90.7% | -6.07 pts [-6.88 pts, -5.25 pts] | -6.88 pts | **NO** | no |
| reach rate | readme.reachRate | -0.01 | 97.2% | 92.0% | +5.22 pts [+4.61 pts, +5.82 pts] | +4.61 pts | yes | yes |
| substantiveness | readme.substantiveness | -0.01 | 33.1% | 30.9% | +2.15 pts [+1.82 pts, +2.49 pts] | +1.82 pts | yes | yes |
| trips per useful hearing | extra.tripsPerSubstantive | +0.25 | 10.5 | 11.7 | -1.24 [-1.34, -1.15] | -1.15 | yes | yes |
| wasted listings | siddarth.wastedListings | +0.01 | 67.8% | 71.5% | -3.71 pts [-3.98 pts, -3.44 pts] | -3.44 pts | yes | yes |
| minutes waited | extra.minutesWaited | +5 | 49.8 | 155 | -106 [-107, -104] | -104 | yes | yes |
| load balance across days | siddarth.loadBalanceCv | +0.05 | 0.18 | 0.13 | +0.04 [+0.04, +0.05] | +0.05 | **NO** | no |
| useful hearings a day at least today's | extra.substantivePerDay | -0 | 17.3 | 17.1 | +0.23 [+0.07, +0.39] | +0.07 | yes | yes |

## Dimakar's rules: every measure, winner + rules minus the plain dimakar / minus the winner alone / minus today (paired, 95% t)

| Measure | minus dimakar | minus the winner | minus today |
|---|---|---|---|
| Utilisation | +20.9 pts [+19.9 pts, +21.8 pts] better | -1.10 pts [-1.71 pts, -0.48 pts] worse | -1.27 pts [-1.77 pts, -0.76 pts] worse |
| Reach rate | -0.78 pts [-1.35 pts, -0.21 pts] worse | -0.31 pts [-0.70 pts, +0.07 pts] | +2.91 pts [+2.38 pts, +3.45 pts] better |
| Substantiveness (readme) | +0.59 pts [+0.20 pts, +0.99 pts] better | +0.24 pts [-0.05 pts, +0.52 pts] | +2.22 pts [+1.96 pts, +2.48 pts] better |
| 4y+ cases heard at all | +1.90 pts [+1.29 pts, +2.50 pts] better | -0.01 pts [-0.03 pts, +0.01 pts] | +0.05 pts [-0.08 pts, +0.17 pts] |
| 4y+ cases heard substantively | +2.65 pts [+2.06 pts, +3.24 pts] better | +2.67 pts [+2.12 pts, +3.22 pts] better | +4.27 pts [+3.72 pts, +4.82 pts] better |
| Gap from first scheduled to first heard | +1.91 [+1.82, +2.00] worse | +1.56 [+1.48, +1.63] worse | +2.05 [+1.97, +2.13] worse |
| Utilisation within capacity | +20.2 pts [+19.3 pts, +21.1 pts] better | -0.83 pts [-1.33 pts, -0.32 pts] worse | -1.55 pts [-2.02 pts, -1.07 pts] worse |
| Days that overran | +9.33 [+8.04, +10.6] worse | +0.90 [-0.34, +2.14] | 0.00 [-1.20, +1.20] |
| Idle capacity | -20.2 pts [-21.1 pts, -19.3 pts] better | +0.83 pts [+0.32 pts, +1.33 pts] worse | +1.55 pts [+1.07 pts, +2.02 pts] worse |
| Held as scheduled (as listed) | -11.7 pts [-12.2 pts, -11.2 pts] worse | -10.5 pts [-10.9 pts, -10.0 pts] worse | -8.02 pts [-8.60 pts, -7.44 pts] worse |
| Held as scheduled (all due) | -17.9 pts [-18.4 pts, -17.4 pts] worse | -8.49 pts [-8.86 pts, -8.12 pts] worse | -14.2 pts [-14.8 pts, -13.7 pts] worse |
| Substantiveness (caseStudy) | +0.59 pts [+0.20 pts, +0.99 pts] better | +0.24 pts [-0.05 pts, +0.52 pts] | +2.22 pts [+1.96 pts, +2.48 pts] better |
| Cases aged 0-1 years at the start | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] |
| Cases aged 1-3 years at the start | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] |
| Cases aged 3-4 years at the start | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] |
| Cases aged 4-5 years at the start | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] |
| Cases aged 5+ years at the start | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] |
| Cases aged 3+ years at the start | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] |
| Cases aged 4+ years at the start | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] |
| Cases aged 0-1 years at the end | -2.37 [-3.58, -1.16] | -2.63 [-3.92, -1.35] | -4.63 [-5.95, -3.32] |
| Cases aged 1-3 years at the end | -2.70 [-4.17, -1.23] | +0.53 [-0.83, +1.90] | +0.50 [-0.94, +1.94] |
| Cases aged 3-4 years at the end | -15.5 [-17.7, -13.2] | -3.67 [-5.99, -1.35] | -5.03 [-7.44, -2.62] |
| Cases aged 4-5 years at the end | -6.10 [-8.76, -3.44] | -7.10 [-9.08, -5.12] | -8.77 [-10.8, -6.74] |
| Cases aged 5+ years at the end | -5.67 [-9.16, -2.17] better | -7.23 [-9.82, -4.65] better | -13.6 [-16.2, -10.9] better |
| Cases aged 3+ years at the end | -27.2 [-32.7, -21.8] better | -18.0 [-21.5, -14.5] better | -27.4 [-31.4, -23.4] better |
| Cases aged 4+ years at the end | -11.8 [-16.1, -7.42] better | -14.3 [-17.6, -11.1] better | -22.3 [-25.9, -18.8] better |
| Next date excess over the minimum | -22.8 [-23.1, -22.5] better | -9.14 [-9.26, -9.02] better | -17.1 [-17.2, -17.0] better |
| Next dates the case was not ready for | -1.91 pts [-2.88 pts, -0.95 pts] better | +5.90 pts [+4.91 pts, +6.89 pts] worse | +6.17 pts [+3.65 pts, +8.69 pts] worse |
| Throughput (disposals per month) | +9.09 [+7.30, +10.9] better | +3.48 [+2.24, +4.73] better | +6.73 [+5.35, +8.11] better |
| Judge time used | +20.9 pts [+19.9 pts, +21.8 pts] better | -1.10 pts [-1.71 pts, -0.48 pts] worse | -1.27 pts [-1.77 pts, -0.76 pts] worse |
| Wasted listings | -0.31 pts [-0.64 pts, +0.02 pts] | -0.12 pts [-0.32 pts, +0.09 pts] | -3.01 pts [-3.21 pts, -2.80 pts] better |
| Held on the promised date | -17.9 pts [-18.4 pts, -17.4 pts] worse | -8.49 pts [-8.86 pts, -8.12 pts] worse | -14.2 pts [-14.8 pts, -13.7 pts] worse |
| Oldest pending case | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] |
| 95th percentile pending age | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] |
| Cases never heard | -238 [-252, -224] better | +166 [+155, +176] worse | +306 [+288, +323] worse |
| Load balance (CV of daily minutes) | -0.25 [-0.26, -0.24] better | +0.04 [+0.03, +0.04] worse | +0.05 [+0.04, +0.06] worse |
| Listed per sitting day | +7.84 [+7.71, +7.98] | +1.86 [+1.72, +2.01] | -0.20 [-0.30, -0.11] |
| Reached per sitting day | +7.04 [+6.70, +7.37] better | +1.59 [+1.35, +1.82] better | +1.56 [+1.22, +1.90] better |
| Substantive per sitting day | +2.63 [+2.45, +2.81] better | +0.66 [+0.53, +0.78] better | +1.74 [+1.62, +1.87] better |
| Disposals (headline) | +22.7 [+18.2, +27.2] better | +8.70 [+5.59, +11.8] better | +16.8 [+13.3, +20.3] better |
| Disposals of 4y+ cases (headline) | +9.67 [+6.00, +13.3] better | +6.13 [+3.24, +9.03] better | +11.5 [+8.56, +14.5] better |
| Trips per substantive hearing | -0.04 [-0.15, +0.07] | +0.13 [+0.07, +0.20] worse | -1.09 [-1.17, -1.01] better |
| Wasted trips | -0.32 pts [-0.66 pts, +0.02 pts] | +0.15 pts [-0.08 pts, +0.37 pts] | -2.51 pts [-2.73 pts, -2.30 pts] better |
| Desk matters per sitting day | +5.40 [+5.31, +5.48] | -0.15 [-0.18, -0.13] | +5.40 [+5.31, +5.48] |
| Vacated per sitting day | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] |
| Deferred per sitting day | +7.79 [+7.69, +7.89] worse | +7.32 [+7.21, +7.43] worse | +7.79 [+7.69, +7.89] worse |
| Sitting days | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] |
| Minutes past capacity | +142 [+109, +174] worse | -57.7 [-99.2, -16.2] better | +59.4 [+22.8, +95.9] worse |
| Reach rate excluding uncalled standby | +3.56 pts [+3.10 pts, +4.02 pts] better | +0.65 pts [+0.45 pts, +0.86 pts] better | +7.25 pts [+6.70 pts, +7.80 pts] better |
| Reach rate on sitting days | -0.75 pts [-1.32 pts, -0.19 pts] worse | -0.32 pts [-0.70 pts, +0.07 pts] | +2.91 pts [+2.38 pts, +3.44 pts] better |
| Gap to first heard, never heard at the end | +6.49 [+6.31, +6.66] worse | +1.90 [+1.76, +2.05] worse | +4.71 [+4.47, +4.95] worse |
| Cases whose date came up | +696 [+696, +696] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] |
| Dates honoured (court or desk order) | -10.5 pts [-11.0 pts, -10.0 pts] worse | -9.77 pts [-10.2 pts, -9.38 pts] worse | -6.84 pts [-7.41 pts, -6.27 pts] worse |
| Dates broken or never given | -258 [-273, -242] better | +387 [+373, +401] worse | +308 [+290, +326] worse |
| Heard rows that were on the promised date | 0.00 pts [0.00 pts, 0.00 pts] | 0.00 pts [0.00 pts, 0.00 pts] | 0.00 pts [0.00 pts, 0.00 pts] |
| Mean next date gap | -26.1 [-26.4, -25.8] | -9.02 [-9.14, -8.91] | -17.6 [-17.7, -17.5] |
| Next dates inside the minimum | +9.20 pts [+9.07 pts, +9.33 pts] | +7.86 pts [+7.71 pts, +8.00 pts] | +9.27 pts [+9.14 pts, +9.40 pts] |
| Next dates wasted, counting absences | -2.75 pts [-3.85 pts, -1.65 pts] better | -0.87 pts [-2.12 pts, +0.39 pts] | -0.81 pts [-3.52 pts, +1.90 pts] |
| Next dates not ready, counting desk re-checks | -1.91 pts [-2.88 pts, -0.94 pts] better | +5.80 pts [+4.80 pts, +6.80 pts] worse | +6.18 pts [+3.66 pts, +8.70 pts] worse |
| 4y+ cases never heard | -17.0 [-22.5, -11.5] better | +0.10 [-0.05, +0.25] | -0.43 [-1.54, +0.67] |
| Pending 4y+ cases at the end | -11.8 [-16.1, -7.42] better | -14.3 [-17.6, -11.1] better | -22.3 [-25.9, -18.8] better |
| Disposals inferred from the log | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] |
| Substantive on the promised date (all due) | -5.37 pts [-5.68 pts, -5.07 pts] worse | -2.61 pts [-2.78 pts, -2.44 pts] worse | -2.68 pts [-2.88 pts, -2.48 pts] worse |
| First promise kept, per case | -19.7 pts [-20.3 pts, -19.2 pts] worse | -10.1 pts [-10.4 pts, -9.75 pts] worse | -15.8 pts [-16.4 pts, -15.2 pts] worse |
| Next date excess over the gap for the next purpose | -23.0 [-23.3, -22.7] better | -9.22 [-9.34, -9.10] better | -17.3 [-17.4, -17.2] better |
| Next purposes inferred | -4.14 pts [-4.43 pts, -3.85 pts] | -10.8 pts [-11.1 pts, -10.6 pts] | -16.7 pts [-17.0 pts, -16.5 pts] |
| Next dates beyond the horizon end | -4.14 pts [-4.43 pts, -3.85 pts] | -10.8 pts [-11.1 pts, -10.6 pts] | -16.7 pts [-17.0 pts, -16.5 pts] |
| Gap from the horizon start to first heard, all cases | -1.80 [-1.97, -1.64] better | +2.75 [+2.60, +2.89] worse | +5.55 [+5.32, +5.79] worse |
| Minutes waited per person heard | -91.0 [-92.5, -89.5] better | -95.2 [-96.5, -93.8] better | -110 [-111, -108] better |
| Minutes waited, counting matters not reached | -88.9 [-91.0, -86.8] better | -93.8 [-95.4, -92.2] better | -113 [-115, -112] better |
| Mean age of the 100 oldest pending cases | -0.01 [-0.02, -0.00] better | -0.01 [-0.02, -0.01] better | -0.02 [-0.02, -0.01] better |
| Cases never acted on | -391 [-403, -378] better | +268 [+257, +278] worse | +153 [+136, +170] worse |
| 4y+ cases acted on | +1.90 pts [+1.29 pts, +2.50 pts] better | -0.01 pts [-0.03 pts, +0.01 pts] | +0.05 pts [-0.08 pts, +0.17 pts] |
| Disposals by verdict | +16.8 [+13.4, +20.1] | +4.67 [+1.85, +7.48] | +10.0 [+7.04, +13.0] |
| Disposals by settlement | -1.70 [-2.79, -0.61] | +2.60 [+1.70, +3.50] | +2.00 [+1.13, +2.87] |
| Disposals by compounding | +2.67 [+1.47, +3.86] | +0.50 [-0.90, +1.90] | +0.17 [-1.16, +1.49] |
| Acquittals for the complainant's default | +3.30 [+2.37, +4.23] | -2.23 [-3.62, -0.85] | -0.30 [-1.68, +1.08] |
| Dismissals for steps not taken | +1.67 [+0.28, +3.05] | +3.17 [+2.00, +4.34] | +4.93 [+3.75, +6.11] |
| Post-judgment closures | +9.93 [+6.67, +13.2] | +10.5 [+7.42, +13.6] | +14.8 [+11.6, +18.0] |
| Long-pending splits | -0.33 [-0.72, +0.05] | +0.90 [+0.48, +1.32] | -0.07 [-0.47, +0.34] |
| Cases off the file, all routes | +32.3 [+26.9, +37.7] | +20.1 [+15.9, +24.3] | +31.5 [+26.9, +36.1] |
| Disposals with an inferred route | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] |
| Throughput, all routes | +12.9 [+10.8, +15.1] | +8.05 [+6.37, +9.73] | +12.6 [+10.8, +14.5] |
| Disposals on the merits (verdict + settlement + compounded) | +17.7 [+13.9, +21.5] better | +7.77 [+4.63, +10.9] better | +12.2 [+8.76, +15.6] better |

Guardrails against today's way:

| Guardrail | Measure | Margin | Candidate | Today | Paired difference [95% CI] | Bound | Pass | Pass with the tournament's t |
|---|---|---|---|---|---|---|---|---|
| every case given a date inside the quarter | extra.casesScheduled | >= 2985 | 3000 | 3000 | (absolute limit on the mean) | 3000 | yes | yes |
| dates honoured (heard or desk order on the day) | extra.promisesHonouredInclDesk | -0.02 | 85.1% | 92.0% | -6.84 pts [-7.41 pts, -6.27 pts] | -7.41 pts | **NO** | no |
| cases never acted on | extra.neverActedOn | +100 | 393 | 240 | +153 [+136, +170] | +170 | **NO** | no |
| cases never heard | siddarth.neverHeard | +150 | 545 | 240 | +306 [+288, +323] | +323 | **NO** | no |
| 4y+ heard at all (README) | readme.backlog4yHeardShare | -0.01 | 100.0% | 99.9% | +0.05 pts [-0.08 pts, +0.17 pts] | -0.08 pts | yes | yes |
| every 4y+ case heard at least once (README score) | extra.neverHeard4yPlus | +0.5 | 0.10 | 0.53 | -0.43 [-1.54, +0.67] | +0.67 | **NO** | no |
| 4y+ moved on | readme.backlog4ySubstantiveShare | -0.01 | 33.5% | 29.2% | +4.27 pts [+3.72 pts, +4.82 pts] | +3.72 pts | yes | yes |
| 4y+ still pending at the end | extra.pending4yPlusEnd | +5 | 938 | 960 | -22.3 [-25.9, -18.8] | -18.8 | yes | yes |
| disposals on the merits (verdict + settlement + compounded) | derived.meritsDisposals | -5 | 97.1 | 84.9 | +12.2 [+8.76, +15.6] | +8.76 | yes | yes |
| next-date excess over PUCAR's gap | caseStudy.nextDateExcessDays | +2 | 33.6 | 50.7 | -17.1 [-17.2, -17.0] | -17.0 | yes | yes |
| days that ran late | caseStudy.overrunDays | +2 | 20.6 | 20.6 | 0.00 [-1.20, +1.20] | +1.20 | yes | yes |
| court time used | caseStudy.utilisation | -0.05 | 89.1% | 90.7% | -1.55 pts [-2.02 pts, -1.07 pts] | -2.02 pts | yes | yes |
| reach rate | readme.reachRate | -0.01 | 94.9% | 92.0% | +2.91 pts [+2.38 pts, +3.45 pts] | +2.38 pts | yes | yes |
| substantiveness | readme.substantiveness | -0.01 | 33.2% | 30.9% | +2.22 pts [+1.96 pts, +2.48 pts] | +1.96 pts | yes | yes |
| trips per useful hearing | extra.tripsPerSubstantive | +0.25 | 10.6 | 11.7 | -1.09 [-1.17, -1.01] | -1.01 | yes | yes |
| wasted listings | siddarth.wastedListings | +0.01 | 68.5% | 71.5% | -3.01 pts [-3.21 pts, -2.80 pts] | -2.80 pts | yes | yes |
| minutes waited | extra.minutesWaited | +5 | 45.7 | 155 | -110 [-111, -108] | -108 | yes | yes |
| load balance across days | siddarth.loadBalanceCv | +0.05 | 0.18 | 0.13 | +0.05 [+0.04, +0.06] | +0.06 | **NO** | no |
| useful hearings a day at least today's | extra.substantivePerDay | -0 | 18.8 | 17.1 | +1.74 [+1.62, +1.87] | +1.62 | yes | yes |

## Joshi's rules: every measure, winner + rules minus the plain joshi / minus the winner alone / minus today (paired, 95% t)

| Measure | minus joshi | minus the winner | minus today |
|---|---|---|---|
| Utilisation | +18.8 pts [+17.9 pts, +19.6 pts] better | +3.90 pts [+3.54 pts, +4.27 pts] better | +3.73 pts [+3.41 pts, +4.05 pts] better |
| Reach rate | -5.96 pts [-6.71 pts, -5.21 pts] worse | -4.75 pts [-5.36 pts, -4.14 pts] worse | -1.52 pts [-2.16 pts, -0.88 pts] worse |
| Substantiveness (readme) | +7.36 pts [+6.99 pts, +7.72 pts] better | +1.79 pts [+1.55 pts, +2.03 pts] better | +3.78 pts [+3.58 pts, +3.97 pts] better |
| 4y+ cases heard at all | +25.8 pts [+24.4 pts, +27.3 pts] better | -8.31 pts [-9.46 pts, -7.17 pts] worse | -8.25 pts [-9.39 pts, -7.12 pts] worse |
| 4y+ cases heard substantively | +13.3 pts [+12.7 pts, +14.0 pts] better | -2.63 pts [-2.99 pts, -2.27 pts] worse | -1.03 pts [-1.41 pts, -0.65 pts] worse |
| Gap from first scheduled to first heard | +1.81 [+1.72, +1.91] worse | +1.27 [+1.17, +1.37] worse | +1.77 [+1.66, +1.88] worse |
| Utilisation within capacity | +17.7 pts [+16.9 pts, +18.4 pts] better | +3.56 pts [+3.26 pts, +3.87 pts] better | +2.84 pts [+2.53 pts, +3.16 pts] better |
| Days that overran | +18.4 [+17.3, +19.6] worse | +8.40 [+7.41, +9.39] worse | +7.50 [+6.49, +8.51] worse |
| Idle capacity | -17.7 pts [-18.4 pts, -16.9 pts] better | -3.56 pts [-3.87 pts, -3.26 pts] better | -2.84 pts [-3.16 pts, -2.53 pts] better |
| Held as scheduled (as listed) | -16.7 pts [-18.4 pts, -15.0 pts] worse | -14.7 pts [-16.2 pts, -13.2 pts] worse | -12.3 pts [-13.7 pts, -10.8 pts] worse |
| Held as scheduled (all due) | -22.7 pts [-24.2 pts, -21.2 pts] worse | -12.5 pts [-13.9 pts, -11.2 pts] worse | -18.3 pts [-19.5 pts, -17.0 pts] worse |
| Substantiveness (caseStudy) | +7.36 pts [+6.99 pts, +7.72 pts] better | +1.79 pts [+1.55 pts, +2.03 pts] better | +3.78 pts [+3.58 pts, +3.97 pts] better |
| Cases aged 0-1 years at the start | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] |
| Cases aged 1-3 years at the start | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] |
| Cases aged 3-4 years at the start | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] |
| Cases aged 4-5 years at the start | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] |
| Cases aged 5+ years at the start | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] |
| Cases aged 3+ years at the start | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] |
| Cases aged 4+ years at the start | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] |
| Cases aged 0-1 years at the end | -1.80 [-3.01, -0.59] | -0.03 [-0.35, +0.28] | -2.03 [-2.64, -1.43] |
| Cases aged 1-3 years at the end | +0.90 [-0.43, +2.23] | 0.00 [-0.88, +0.88] | -0.03 [-0.78, +0.71] |
| Cases aged 3-4 years at the end | -31.9 [-35.1, -28.7] | +6.67 [+5.02, +8.31] | +5.30 [+3.58, +7.02] |
| Cases aged 4-5 years at the end | -50.5 [-52.5, -48.5] | +0.93 [-0.14, +2.01] | -0.73 [-1.75, +0.28] |
| Cases aged 5+ years at the end | -51.3 [-55.4, -47.2] better | +9.70 [+7.79, +11.6] worse | +3.37 [+1.52, +5.21] worse |
| Cases aged 3+ years at the end | -134 [-140, -128] better | +17.3 [+14.6, +20.0] worse | +7.93 [+4.99, +10.9] worse |
| Cases aged 4+ years at the end | -102 [-106, -97.2] better | +10.6 [+8.28, +13.0] worse | +2.63 [+0.28, +4.99] worse |
| Next date excess over the minimum | -36.4 [-36.5, -36.2] better | -1.06 [-1.23, -0.89] better | -9.02 [-9.18, -8.85] better |
| Next dates the case was not ready for | n/a [n/a, n/a] | +0.84 pts [-0.51 pts, +2.19 pts] | +1.11 pts [-1.25 pts, +3.48 pts] |
| Throughput (disposals per month) | +16.5 [+14.8, +18.2] better | -2.16 [-2.96, -1.36] worse | +1.08 [+0.21, +1.96] better |
| Judge time used | +18.8 pts [+17.9 pts, +19.6 pts] better | +3.90 pts [+3.54 pts, +4.27 pts] better | +3.73 pts [+3.41 pts, +4.05 pts] better |
| Wasted listings | -5.02 pts [-5.34 pts, -4.70 pts] better | -0.06 pts [-0.21 pts, +0.10 pts] | -2.94 pts [-3.12 pts, -2.76 pts] better |
| Held on the promised date | -22.7 pts [-24.2 pts, -21.2 pts] worse | -12.5 pts [-13.9 pts, -11.2 pts] worse | -18.3 pts [-19.5 pts, -17.0 pts] worse |
| Oldest pending case | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] |
| 95th percentile pending age | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] |
| Cases never heard | -57.2 [-74.2, -40.2] better | +11.8 [-0.95, +24.6] | +152 [+136, +168] worse |
| Load balance (CV of daily minutes) | -0.15 [-0.16, -0.14] better | -0.02 [-0.03, -0.02] better | -0.01 [-0.02, -0.01] better |
| Listed per sitting day | +8.08 [+7.96, +8.20] | +2.02 [+1.90, +2.15] | -0.04 [-0.16, +0.07] |
| Reached per sitting day | +4.21 [+3.85, +4.57] better | -0.93 [-1.22, -0.63] worse | -0.96 [-1.30, -0.61] worse |
| Substantive per sitting day | +5.14 [+4.97, +5.31] better | +0.67 [+0.59, +0.75] better | +1.75 [+1.64, +1.86] better |
| Disposals (headline) | +41.3 [+37.1, +45.5] better | -5.40 [-7.40, -3.40] worse | +2.70 [+0.51, +4.89] better |
| Disposals of 4y+ cases (headline) | +38.9 [+35.7, +42.1] better | -5.47 [-7.30, -3.63] worse | -0.07 [-1.80, +1.67] |
| Trips per substantive hearing | -1.54 [-1.69, -1.39] better | +0.42 [+0.37, +0.48] worse | -0.80 [-0.87, -0.72] better |
| Wasted trips | -4.82 pts [-5.15 pts, -4.49 pts] better | +0.19 pts [+0.01 pts, +0.37 pts] worse | -2.47 pts [-2.66 pts, -2.28 pts] better |
| Desk matters per sitting day | +5.54 [+5.46, +5.63] | -0.01 [-0.02, +0.01] | +5.54 [+5.46, +5.63] |
| Vacated per sitting day | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] |
| Deferred per sitting day | +8.24 [+7.20, +9.27] worse | +7.76 [+6.74, +8.79] worse | +8.24 [+7.20, +9.27] worse |
| Sitting days | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] |
| Minutes past capacity | +231 [+189, +273] worse | +73.1 [+30.8, +115] worse | +190 [+160, +221] worse |
| Reach rate excluding uncalled standby | +0.58 pts [-0.02 pts, +1.19 pts] | -1.57 pts [-1.96 pts, -1.19 pts] worse | +5.02 pts [+4.41 pts, +5.63 pts] better |
| Reach rate on sitting days | -5.97 pts [-6.72 pts, -5.22 pts] worse | -4.75 pts [-5.36 pts, -4.14 pts] worse | -1.53 pts [-2.16 pts, -0.89 pts] worse |
| Gap to first heard, never heard at the end | +4.94 [+4.75, +5.13] worse | +0.40 [+0.24, +0.55] worse | +3.20 [+2.95, +3.46] worse |
| Cases whose date came up | +354 [+354, +354] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] |
| Dates honoured (court or desk order) | -15.2 pts [-16.8 pts, -13.6 pts] worse | -13.7 pts [-15.1 pts, -12.2 pts] worse | -10.8 pts [-12.1 pts, -9.39 pts] worse |
| Dates broken or never given | +263 [+191, +335] worse | +546 [+480, +612] worse | +466 [+403, +530] worse |
| Heard rows that were on the promised date | 0.00 pts [0.00 pts, 0.00 pts] | 0.00 pts [0.00 pts, 0.00 pts] | 0.00 pts [0.00 pts, 0.00 pts] |
| Mean next date gap | -36.0 [-36.1, -35.8] | -1.16 [-1.33, -0.99] | -9.72 [-9.88, -9.55] |
| Next dates inside the minimum | +1.46 pts [+1.38 pts, +1.53 pts] | +0.04 pts [-0.04 pts, +0.12 pts] | +1.46 pts [+1.38 pts, +1.53 pts] |
| Next dates wasted, counting absences | n/a [n/a, n/a] | -3.25 pts [-4.67 pts, -1.82 pts] better | -3.19 pts [-5.95 pts, -0.43 pts] better |
| Next dates not ready, counting desk re-checks | n/a [n/a, n/a] | +0.76 pts [-0.58 pts, +2.10 pts] | +1.14 pts [-1.23 pts, +3.51 pts] |
| 4y+ cases never heard | -232 [-245, -219] better | +74.6 [+64.3, +84.8] worse | +74.0 [+63.9, +84.2] worse |
| Pending 4y+ cases at the end | -102 [-106, -97.2] better | +10.6 [+8.28, +13.0] worse | +2.63 [+0.28, +4.99] worse |
| Disposals inferred from the log | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] |
| Substantive on the promised date (all due) | -0.80 pts [-1.31 pts, -0.30 pts] worse | -2.82 pts [-3.20 pts, -2.44 pts] worse | -2.88 pts [-3.23 pts, -2.54 pts] worse |
| First promise kept, per case | -16.4 pts [-17.2 pts, -15.7 pts] worse | -6.24 pts [-6.79 pts, -5.70 pts] worse | -12.0 pts [-12.5 pts, -11.4 pts] worse |
| Next date excess over the gap for the next purpose | -36.4 [-36.5, -36.2] better | -1.05 [-1.22, -0.88] better | -9.09 [-9.25, -8.92] better |
| Next purposes inferred | -8.26 pts [-8.43 pts, -8.09 pts] | -0.08 pts [-0.23 pts, +0.07 pts] | -5.97 pts [-6.17 pts, -5.77 pts] |
| Next dates beyond the horizon end | -8.26 pts [-8.43 pts, -8.09 pts] | -0.08 pts [-0.23 pts, +0.07 pts] | -5.97 pts [-6.17 pts, -5.77 pts] |
| Gap from the horizon start to first heard, all cases | +3.83 [+3.65, +4.01] worse | +0.40 [+0.24, +0.55] worse | +3.20 [+2.95, +3.46] worse |
| Minutes waited per person heard | -88.1 [-89.8, -86.3] better | -102 [-103, -101] better | -116 [-118, -115] better |
| Minutes waited, counting matters not reached | -75.2 [-77.9, -72.6] better | -89.9 [-91.8, -88.0] better | -109 [-111, -107] better |
| Mean age of the 100 oldest pending cases | +0.00 [-0.01, +0.01] | +0.01 [+0.00, +0.01] worse | +0.00 [-0.00, +0.01] |
| Cases never acted on | -295 [-313, -276] better | +29.3 [+16.5, +42.2] worse | -85.5 [-101, -69.8] better |
| 4y+ cases acted on | +25.8 pts [+24.4 pts, +27.3 pts] better | -8.31 pts [-9.46 pts, -7.17 pts] worse | -8.25 pts [-9.39 pts, -7.12 pts] worse |
| Disposals by verdict | +39.1 [+36.3, +41.8] | -3.50 [-5.15, -1.85] | +1.83 [+0.31, +3.36] |
| Disposals by settlement | -0.10 [-0.95, +0.75] | 0.00 [-0.44, +0.44] | -0.60 [-1.15, -0.05] |
| Disposals by compounding | +1.23 [-0.83, +3.30] | +1.07 [+0.03, +2.10] | +0.73 [-0.32, +1.79] |
| Acquittals for the complainant's default | -0.23 [-1.58, +1.11] | -2.40 [-3.09, -1.71] | -0.47 [-1.00, +0.07] |
| Dismissals for steps not taken | +1.30 [+0.29, +2.31] | -0.57 [-0.84, -0.29] | +1.20 [+0.69, +1.71] |
| Post-judgment closures | +94.4 [+90.3, +98.5] | -12.1 [-14.3, -9.88] | -7.83 [-10.2, -5.47] |
| Long-pending splits | -1.07 [-1.53, -0.61] | +0.23 [+0.05, +0.42] | -0.73 [-1.01, -0.46] |
| Cases off the file, all routes | +135 [+128, +141] | -17.3 [-20.0, -14.5] | -5.87 [-9.02, -2.72] |
| Disposals with an inferred route | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] |
| Throughput, all routes | +53.9 [+51.4, +56.4] | -6.92 [-8.02, -5.81] | -2.35 [-3.61, -1.09] |
| Disposals on the merits (verdict + settlement + compounded) | +40.2 [+36.5, +43.9] better | -2.43 [-4.39, -0.48] worse | +1.97 [-0.11, +4.04] |

Guardrails against today's way:

| Guardrail | Measure | Margin | Candidate | Today | Paired difference [95% CI] | Bound | Pass | Pass with the tournament's t |
|---|---|---|---|---|---|---|---|---|
| every case given a date inside the quarter | extra.casesScheduled | >= 2985 | 3000 | 3000 | (absolute limit on the mean) | 3000 | yes | yes |
| dates honoured (heard or desk order on the day) | extra.promisesHonouredInclDesk | -0.02 | 81.2% | 92.0% | -10.8 pts [-12.1 pts, -9.39 pts] | -12.1 pts | **NO** | no |
| cases never acted on | extra.neverActedOn | +100 | 154 | 240 | -85.5 [-101, -69.8] | -69.8 | yes | yes |
| cases never heard | siddarth.neverHeard | +150 | 391 | 240 | +152 [+136, +168] | +168 | **NO** | no |
| 4y+ heard at all (README) | readme.backlog4yHeardShare | -0.01 | 91.7% | 99.9% | -8.25 pts [-9.39 pts, -7.12 pts] | -9.39 pts | **NO** | no |
| every 4y+ case heard at least once (README score) | extra.neverHeard4yPlus | +0.5 | 74.6 | 0.53 | +74.0 [+63.9, +84.2] | +84.2 | **NO** | no |
| 4y+ moved on | readme.backlog4ySubstantiveShare | -0.01 | 28.2% | 29.2% | -1.03 pts [-1.41 pts, -0.65 pts] | -1.41 pts | **NO** | no |
| 4y+ still pending at the end | extra.pending4yPlusEnd | +5 | 963 | 960 | +2.63 [+0.28, +4.99] | +4.99 | yes | yes |
| disposals on the merits (verdict + settlement + compounded) | derived.meritsDisposals | -5 | 86.9 | 84.9 | +1.97 [-0.11, +4.04] | -0.11 | yes | yes |
| next-date excess over PUCAR's gap | caseStudy.nextDateExcessDays | +2 | 41.6 | 50.7 | -9.02 [-9.18, -8.85] | -8.85 | yes | yes |
| days that ran late | caseStudy.overrunDays | +2 | 28.1 | 20.6 | +7.50 [+6.49, +8.51] | +8.51 | **NO** | no |
| court time used | caseStudy.utilisation | -0.05 | 93.5% | 90.7% | +2.84 pts [+2.53 pts, +3.16 pts] | +2.53 pts | yes | yes |
| reach rate | readme.reachRate | -0.01 | 90.5% | 92.0% | -1.52 pts [-2.16 pts, -0.88 pts] | -2.16 pts | **NO** | no |
| substantiveness | readme.substantiveness | -0.01 | 34.7% | 30.9% | +3.78 pts [+3.58 pts, +3.97 pts] | +3.58 pts | yes | yes |
| trips per useful hearing | extra.tripsPerSubstantive | +0.25 | 10.9 | 11.7 | -0.80 [-0.87, -0.72] | -0.72 | yes | yes |
| wasted listings | siddarth.wastedListings | +0.01 | 68.6% | 71.5% | -2.94 pts [-3.12 pts, -2.76 pts] | -2.76 pts | yes | yes |
| minutes waited | extra.minutesWaited | +5 | 39.1 | 155 | -116 [-118, -115] | -115 | yes | yes |
| load balance across days | siddarth.loadBalanceCv | +0.05 | 0.12 | 0.13 | -0.01 [-0.02, -0.01] | -0.01 | yes | yes |
| useful hearings a day at least today's | extra.substantivePerDay | -0 | 18.8 | 17.1 | +1.75 [+1.64, +1.86] | +1.64 | yes | yes |

