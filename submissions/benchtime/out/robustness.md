# Robustness of the winner (held-out seeds)

Generated 15:17 IST. Winner g237. Seeds 31-60 (30). In every condition the winner and today's way (status_quo_60) face the same changed court on the same seeds; the guardrails are re-evaluated against today's way under that condition. Planner bias changes only what the planner is shown (the world runs on PUCAR's true tables).

- The winner does not run the day-before check-in, so doubling false alarms can only move it through the world's other draws (it should not move at all); today's way does not ask either.

| Condition | Useful hearings a day: winner minus today | Merits disposals | Dates honoured (incl. desk) | Still beats today on all three? | Guardrails failed | Which |
|---|---|---|---|---|---|---|
| as calibrated (the arena) | +1.08 [+0.98, +1.18] better | +4.40 [+3.26, +5.54] better | +2.93 pts [+2.54 pts, +3.32 pts] better | yes | 2 | cases never heard; every 4y+ case heard at least once (README score) |
| behaviour responses off (--no-behaviour) | +1.41 [+1.32, +1.49] better | +4.43 [+3.17, +5.70] better | +2.59 pts [+2.24 pts, +2.95 pts] better | yes | 3 | cases never heard; every 4y+ case heard at least once (README score); days that ran late |
| duration CV 0.25 | +1.00 [+0.91, +1.09] better | +4.17 [+3.04, +5.29] better | +2.83 pts [+2.52 pts, +3.15 pts] better | yes | 2 | cases never heard; every 4y+ case heard at least once (README score) |
| duration CV 1.0 | +1.27 [+1.15, +1.39] better | +4.80 [+3.49, +6.11] better | +3.34 pts [+2.90 pts, +3.78 pts] better | yes | 0 | none |
| process returns 1.5x slower | +0.87 [+0.77, +0.97] better | +3.63 [+2.43, +4.83] better | +2.66 pts [+2.27 pts, +3.05 pts] better | yes | 2 | cases never heard; every 4y+ case heard at least once (README score) |
| check-in false alarms doubled (0.05 to 0.10) | +1.08 [+0.98, +1.18] better | +4.40 [+3.26, +5.54] better | +2.93 pts [+2.54 pts, +3.32 pts] better | yes | 2 | cases never heard; every 4y+ case heard at least once (README score) |
| planner shown P(substantive) +30% | +0.70 [+0.60, +0.80] better | +2.57 [+1.42, +3.72] better | +3.10 pts [+2.68 pts, +3.53 pts] better | yes | 2 | cases never heard; every 4y+ case heard at least once (README score) |
| planner shown P(substantive) -30% | +1.96 [+1.87, +2.05] better | +6.57 [+5.42, +7.72] better | -0.31 pts [-0.75 pts, +0.13 pts] | not clearly | 3 | cases never heard; every 4y+ case heard at least once (README score); days that ran late |
| roster seed 1 | +1.21 [+1.11, +1.30] better | +5.23 [+4.05, +6.42] better | +4.06 pts [+3.68 pts, +4.44 pts] better | yes | 1 | every 4y+ case heard at least once (README score) |
| roster seed 2 | +1.21 [+1.09, +1.32] better | +5.60 [+4.35, +6.85] better | +3.71 pts [+3.22 pts, +4.20 pts] better | yes | 1 | every 4y+ case heard at least once (README score) |
| roster seed 3 | +1.18 [+1.04, +1.31] better | +4.20 [+2.92, +5.48] better | +3.49 pts [+3.01 pts, +3.97 pts] better | yes | 1 | every 4y+ case heard at least once (README score) |
| roster seed 4 | +1.17 [+1.07, +1.27] better | +3.63 [+2.50, +4.76] better | +3.17 pts [+2.84 pts, +3.51 pts] better | yes | 1 | every 4y+ case heard at least once (README score) |
| roster seed 5 | +1.31 [+1.20, +1.43] better | +4.50 [+3.16, +5.84] better | +3.63 pts [+3.18 pts, +4.08 pts] better | yes | 1 | every 4y+ case heard at least once (README score) |

## Every measure: winner minus today's way, per condition (paired, 95% t interval)

| Measure | baseline | nobehaviour | cv025 | cv100 | process15 | falsealarm2 | pbias_up | pbias_down | roster1 | roster2 | roster3 | roster4 | roster5 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Utilisation | -0.17 pts [-0.48 pts, +0.13 pts] | +1.92 pts [+1.64 pts, +2.19 pts] better | -0.41 pts [-0.73 pts, -0.09 pts] worse | +0.15 pts [-0.25 pts, +0.56 pts] | -0.55 pts [-0.87 pts, -0.23 pts] worse | -0.17 pts [-0.48 pts, +0.13 pts] | -2.62 pts [-3.03 pts, -2.21 pts] worse | +3.63 pts [+3.35 pts, +3.91 pts] better | -0.60 pts [-0.85 pts, -0.34 pts] worse | +0.31 pts [-0.03 pts, +0.65 pts] | -0.36 pts [-0.75 pts, +0.04 pts] | +0.11 pts [-0.26 pts, +0.49 pts] | -0.24 pts [-0.61 pts, +0.13 pts] |
| Reach rate | +3.23 pts [+2.84 pts, +3.61 pts] better | +2.88 pts [+2.52 pts, +3.24 pts] better | +3.19 pts [+2.86 pts, +3.51 pts] better | +3.54 pts [+3.10 pts, +3.98 pts] better | +3.17 pts [+2.77 pts, +3.57 pts] better | +3.23 pts [+2.84 pts, +3.61 pts] better | +4.48 pts [+4.07 pts, +4.90 pts] better | +0.67 pts [+0.23 pts, +1.11 pts] better | +4.23 pts [+3.88 pts, +4.57 pts] better | +3.85 pts [+3.36 pts, +4.33 pts] better | +3.81 pts [+3.34 pts, +4.28 pts] better | +3.47 pts [+3.15 pts, +3.80 pts] better | +4.12 pts [+3.69 pts, +4.56 pts] better |
| Substantiveness (readme) | +1.98 pts [+1.84 pts, +2.13 pts] better | +2.70 pts [+2.59 pts, +2.80 pts] better | +1.85 pts [+1.69 pts, +2.02 pts] better | +2.09 pts [+1.93 pts, +2.24 pts] better | +2.45 pts [+2.26 pts, +2.63 pts] better | +1.98 pts [+1.84 pts, +2.13 pts] better | +1.62 pts [+1.45 pts, +1.78 pts] better | +2.24 pts [+2.11 pts, +2.37 pts] better | +1.80 pts [+1.62 pts, +1.97 pts] better | +1.73 pts [+1.55 pts, +1.90 pts] better | +1.75 pts [+1.59 pts, +1.91 pts] better | +1.72 pts [+1.55 pts, +1.89 pts] better | +1.77 pts [+1.62 pts, +1.92 pts] better |
| 4y+ cases heard at all | +0.06 pts [-0.06 pts, +0.18 pts] | +0.06 pts [-0.06 pts, +0.18 pts] | +0.06 pts [-0.06 pts, +0.18 pts] | +0.17 pts [-0.01 pts, +0.35 pts] | +0.06 pts [-0.06 pts, +0.18 pts] | +0.06 pts [-0.06 pts, +0.18 pts] | +0.06 pts [-0.06 pts, +0.18 pts] | +0.06 pts [-0.06 pts, +0.18 pts] | +0.07 pts [-0.07 pts, +0.22 pts] | +0.07 pts [-0.08 pts, +0.23 pts] | +0.08 pts [-0.08 pts, +0.23 pts] | +0.09 pts [-0.09 pts, +0.26 pts] | +0.09 pts [-0.08 pts, +0.26 pts] |
| 4y+ cases heard substantively | +1.60 pts [+1.40 pts, +1.80 pts] better | +1.65 pts [+1.47 pts, +1.84 pts] better | +1.55 pts [+1.37 pts, +1.73 pts] better | +1.65 pts [+1.42 pts, +1.89 pts] better | +1.36 pts [+1.19 pts, +1.53 pts] better | +1.60 pts [+1.40 pts, +1.80 pts] better | +1.57 pts [+1.39 pts, +1.75 pts] better | +1.75 pts [+1.56 pts, +1.93 pts] better | +1.86 pts [+1.71 pts, +2.02 pts] better | +1.85 pts [+1.66 pts, +2.04 pts] better | +1.79 pts [+1.65 pts, +1.93 pts] better | +1.96 pts [+1.77 pts, +2.14 pts] better | +1.64 pts [+1.45 pts, +1.83 pts] better |
| Gap from first scheduled to first heard | +0.50 [+0.42, +0.57] worse | +0.50 [+0.42, +0.58] worse | +0.48 [+0.42, +0.55] worse | +0.58 [+0.49, +0.68] worse | +0.49 [+0.42, +0.57] worse | +0.50 [+0.42, +0.57] worse | +0.43 [+0.38, +0.49] worse | +0.95 [+0.86, +1.04] worse | +0.37 [+0.31, +0.43] worse | +0.29 [+0.20, +0.38] worse | +0.43 [+0.37, +0.49] worse | +0.42 [+0.35, +0.49] worse | +0.65 [+0.58, +0.73] worse |
| Utilisation within capacity | -0.72 pts [-0.97 pts, -0.47 pts] worse | +1.03 pts [+0.76 pts, +1.30 pts] better | -0.74 pts [-1.02 pts, -0.46 pts] worse | -0.61 pts [-0.93 pts, -0.30 pts] worse | -0.97 pts [-1.24 pts, -0.69 pts] worse | -0.72 pts [-0.97 pts, -0.47 pts] worse | -2.86 pts [-3.22 pts, -2.49 pts] worse | +2.58 pts [+2.33 pts, +2.82 pts] better | -1.10 pts [-1.31 pts, -0.89 pts] worse | -0.27 pts [-0.56 pts, +0.03 pts] | -0.82 pts [-1.10 pts, -0.54 pts] worse | -0.39 pts [-0.72 pts, -0.07 pts] worse | -0.69 pts [-0.98 pts, -0.40 pts] worse |
| Days that overran | -0.90 [-1.64, -0.16] better | +2.60 [+1.83, +3.37] worse | -1.20 [-2.05, -0.35] better | -0.73 [-1.46, -0.01] better | -1.30 [-2.27, -0.33] better | -0.90 [-1.64, -0.16] better | -4.47 [-5.39, -3.54] better | +5.97 [+4.82, +7.11] worse | -1.90 [-2.77, -1.03] better | -1.27 [-2.38, -0.15] better | -2.23 [-3.43, -1.04] better | -1.23 [-2.14, -0.33] better | -1.73 [-2.77, -0.70] better |
| Idle capacity | +0.72 pts [+0.47 pts, +0.97 pts] worse | -1.03 pts [-1.30 pts, -0.76 pts] better | +0.74 pts [+0.46 pts, +1.02 pts] worse | +0.61 pts [+0.30 pts, +0.93 pts] worse | +0.97 pts [+0.69 pts, +1.24 pts] worse | +0.72 pts [+0.47 pts, +0.97 pts] worse | +2.86 pts [+2.49 pts, +3.22 pts] worse | -2.58 pts [-2.82 pts, -2.33 pts] better | +1.10 pts [+0.89 pts, +1.31 pts] worse | +0.27 pts [-0.03 pts, +0.56 pts] | +0.82 pts [+0.54 pts, +1.10 pts] worse | +0.39 pts [+0.07 pts, +0.72 pts] worse | +0.69 pts [+0.40 pts, +0.98 pts] worse |
| Held as scheduled (as listed) | +2.46 pts [+2.07 pts, +2.84 pts] better | +2.09 pts [+1.74 pts, +2.44 pts] better | +2.43 pts [+2.11 pts, +2.75 pts] better | +2.73 pts [+2.30 pts, +3.16 pts] better | +2.08 pts [+1.69 pts, +2.47 pts] better | +2.46 pts [+2.07 pts, +2.84 pts] better | +2.64 pts [+2.21 pts, +3.06 pts] better | -1.03 pts [-1.47 pts, -0.59 pts] worse | +3.60 pts [+3.24 pts, +3.97 pts] better | +3.25 pts [+2.76 pts, +3.74 pts] better | +3.05 pts [+2.58 pts, +3.52 pts] better | +2.74 pts [+2.41 pts, +3.07 pts] better | +3.15 pts [+2.71 pts, +3.59 pts] better |
| Held as scheduled (all due) | -5.74 pts [-6.15 pts, -5.33 pts] worse | -6.08 pts [-6.47 pts, -5.70 pts] worse | -5.84 pts [-6.20 pts, -5.49 pts] worse | -5.29 pts [-5.75 pts, -4.82 pts] worse | -8.46 pts [-8.89 pts, -8.03 pts] worse | -5.74 pts [-6.15 pts, -5.33 pts] worse | -5.74 pts [-6.19 pts, -5.29 pts] worse | -8.33 pts [-8.81 pts, -7.85 pts] worse | -4.07 pts [-4.44 pts, -3.69 pts] worse | -4.62 pts [-5.15 pts, -4.09 pts] worse | -4.44 pts [-4.92 pts, -3.95 pts] worse | -5.04 pts [-5.42 pts, -4.66 pts] worse | -4.50 pts [-4.95 pts, -4.06 pts] worse |
| Substantiveness (caseStudy) | +1.98 pts [+1.84 pts, +2.13 pts] better | +2.70 pts [+2.59 pts, +2.80 pts] better | +1.85 pts [+1.69 pts, +2.02 pts] better | +2.09 pts [+1.93 pts, +2.24 pts] better | +2.45 pts [+2.26 pts, +2.63 pts] better | +1.98 pts [+1.84 pts, +2.13 pts] better | +1.62 pts [+1.45 pts, +1.78 pts] better | +2.24 pts [+2.11 pts, +2.37 pts] better | +1.80 pts [+1.62 pts, +1.97 pts] better | +1.73 pts [+1.55 pts, +1.90 pts] better | +1.75 pts [+1.59 pts, +1.91 pts] better | +1.72 pts [+1.55 pts, +1.89 pts] better | +1.77 pts [+1.62 pts, +1.92 pts] better |
| Cases aged 0-1 years at the start | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] |
| Cases aged 1-3 years at the start | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] |
| Cases aged 3-4 years at the start | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] |
| Cases aged 4-5 years at the start | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] |
| Cases aged 5+ years at the start | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] |
| Cases aged 3+ years at the start | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] |
| Cases aged 4+ years at the start | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] |
| Cases aged 0-1 years at the end | -2.00 [-2.61, -1.39] | -2.00 [-2.61, -1.39] | -2.07 [-2.64, -1.50] | -2.10 [-2.73, -1.47] | -1.50 [-2.01, -0.99] | -2.00 [-2.61, -1.39] | -2.13 [-2.87, -1.39] | -2.70 [-3.37, -2.03] | -2.20 [-2.74, -1.66] | -1.90 [-2.40, -1.40] | -2.20 [-2.78, -1.62] | -1.67 [-2.21, -1.13] | -1.57 [-2.07, -1.06] |
| Cases aged 1-3 years at the end | -0.03 [-0.92, +0.86] | +1.60 [+0.99, +2.21] | +0.07 [-0.76, +0.89] | -0.47 [-1.42, +0.48] | +0.50 [-0.34, +1.34] | -0.03 [-0.92, +0.86] | +0.13 [-0.80, +1.07] | +0.80 [-0.22, +1.82] | +0.27 [-0.61, +1.14] | +0.67 [-0.24, +1.58] | +0.17 [-0.51, +0.85] | +0.97 [+0.20, +1.73] | -0.57 [-1.40, +0.27] |
| Cases aged 3-4 years at the end | -1.37 [-2.20, -0.53] | -1.17 [-1.99, -0.34] | -1.27 [-2.12, -0.41] | -2.90 [-4.11, -1.69] | -1.67 [-2.48, -0.86] | -1.37 [-2.20, -0.53] | -0.90 [-1.66, -0.14] | -5.47 [-6.36, -4.57] | +0.83 [+0.17, +1.50] | -0.57 [-1.30, +0.16] | -1.07 [-2.17, +0.03] | -0.43 [-1.26, +0.40] | -1.57 [-2.51, -0.63] |
| Cases aged 4-5 years at the end | -1.67 [-2.25, -1.08] | -1.67 [-2.23, -1.10] | -1.77 [-2.29, -1.24] | -1.97 [-2.84, -1.10] | -1.50 [-2.14, -0.86] | -1.67 [-2.25, -1.08] | -2.33 [-3.01, -1.66] | -3.00 [-3.77, -2.23] | -4.40 [-5.17, -3.63] | -3.70 [-4.31, -3.09] | -3.83 [-4.39, -3.28] | -3.77 [-4.52, -3.01] | -4.13 [-4.82, -3.45] |
| Cases aged 5+ years at the end | -6.33 [-7.33, -5.34] better | -6.17 [-7.30, -5.04] better | -5.83 [-6.93, -4.74] better | -6.17 [-7.14, -5.19] better | -5.10 [-5.97, -4.23] better | -6.33 [-7.33, -5.34] better | -4.80 [-5.56, -4.04] better | -7.17 [-8.31, -6.02] better | -7.07 [-7.98, -6.16] better | -6.80 [-7.77, -5.83] better | -4.40 [-5.18, -3.62] better | -6.00 [-6.88, -5.12] better | -5.20 [-6.41, -3.99] better |
| Cases aged 3+ years at the end | -9.37 [-10.8, -7.94] better | -9.00 [-10.5, -7.55] better | -8.87 [-10.3, -7.43] better | -11.0 [-12.7, -9.36] better | -8.27 [-9.45, -7.09] better | -9.37 [-10.8, -7.94] better | -8.03 [-9.40, -6.67] better | -15.6 [-17.1, -14.2] better | -10.6 [-11.8, -9.47] better | -11.1 [-12.5, -9.62] better | -9.30 [-10.8, -7.84] better | -10.2 [-11.8, -8.56] better | -10.9 [-12.3, -9.54] better |
| Cases aged 4+ years at the end | -8.00 [-9.17, -6.83] better | -7.83 [-9.19, -6.48] better | -7.60 [-8.75, -6.45] better | -8.13 [-9.43, -6.84] better | -6.60 [-7.60, -5.60] better | -8.00 [-9.17, -6.83] better | -7.13 [-8.29, -5.98] better | -10.2 [-11.3, -9.07] better | -11.5 [-12.5, -10.4] better | -10.5 [-11.6, -9.35] better | -8.23 [-9.11, -7.36] better | -9.77 [-11.0, -8.58] better | -9.33 [-10.8, -7.91] better |
| Next date excess over the minimum | -7.96 [-8.06, -7.85] better | -8.00 [-8.10, -7.89] better | -7.94 [-8.04, -7.84] better | -7.99 [-8.08, -7.89] better | -8.86 [-8.96, -8.76] better | -7.96 [-8.06, -7.85] better | -5.14 [-5.23, -5.05] better | -14.3 [-14.4, -14.1] better | -7.16 [-7.26, -7.07] better | -8.11 [-8.24, -7.98] better | -7.65 [-7.74, -7.55] better | -8.02 [-8.14, -7.90] better | -7.33 [-7.43, -7.24] better |
| Next dates the case was not ready for | +0.28 pts [-2.46 pts, +3.01 pts] | +0.94 pts [-1.62 pts, +3.51 pts] | +0.16 pts [-2.63 pts, +2.94 pts] | +0.66 pts [-1.88 pts, +3.21 pts] | -0.93 pts [-3.70 pts, +1.84 pts] | +0.28 pts [-2.46 pts, +3.01 pts] | +0.62 pts [-2.03 pts, +3.28 pts] | -0.71 pts [-3.20 pts, +1.78 pts] | +2.77 pts [+0.33 pts, +5.21 pts] worse | +0.75 pts [-1.11 pts, +2.62 pts] | -1.71 pts [-4.07 pts, +0.65 pts] | +0.36 pts [-2.12 pts, +2.85 pts] | -0.27 pts [-2.37 pts, +1.84 pts] |
| Throughput (disposals per month) | +3.24 [+2.76, +3.73] better | +2.42 [+1.89, +2.94] better | +3.19 [+2.72, +3.67] better | +3.51 [+2.97, +4.05] better | +2.64 [+2.16, +3.13] better | +3.24 [+2.76, +3.73] better | +3.04 [+2.41, +3.68] better | +4.03 [+3.48, +4.58] better | +3.82 [+3.16, +4.48] better | +3.75 [+3.13, +4.37] better | +2.98 [+2.38, +3.57] better | +2.63 [+2.05, +3.21] better | +3.42 [+2.78, +4.06] better |
| Judge time used | -0.17 pts [-0.48 pts, +0.13 pts] | +1.92 pts [+1.64 pts, +2.19 pts] better | -0.41 pts [-0.73 pts, -0.09 pts] worse | +0.15 pts [-0.25 pts, +0.56 pts] | -0.55 pts [-0.87 pts, -0.23 pts] worse | -0.17 pts [-0.48 pts, +0.13 pts] | -2.62 pts [-3.03 pts, -2.21 pts] worse | +3.63 pts [+3.35 pts, +3.91 pts] better | -0.60 pts [-0.85 pts, -0.34 pts] worse | +0.31 pts [-0.03 pts, +0.65 pts] | -0.36 pts [-0.75 pts, +0.04 pts] | +0.11 pts [-0.26 pts, +0.49 pts] | -0.24 pts [-0.61 pts, +0.13 pts] |
| Wasted listings | -2.89 pts [-3.04 pts, -2.73 pts] better | -3.45 pts [-3.57 pts, -3.32 pts] better | -2.76 pts [-2.90 pts, -2.63 pts] better | -3.05 pts [-3.23 pts, -2.87 pts] better | -3.28 pts [-3.44 pts, -3.12 pts] better | -2.89 pts [-3.04 pts, -2.73 pts] better | -2.95 pts [-3.11 pts, -2.79 pts] better | -2.28 pts [-2.42 pts, -2.15 pts] better | -3.06 pts [-3.23 pts, -2.89 pts] better | -2.85 pts [-3.02 pts, -2.67 pts] better | -2.83 pts [-3.05 pts, -2.61 pts] better | -2.75 pts [-2.90 pts, -2.60 pts] better | -3.01 pts [-3.19 pts, -2.82 pts] better |
| Held on the promised date | -5.74 pts [-6.15 pts, -5.33 pts] worse | -6.08 pts [-6.47 pts, -5.70 pts] worse | -5.84 pts [-6.20 pts, -5.49 pts] worse | -5.29 pts [-5.75 pts, -4.82 pts] worse | -8.46 pts [-8.89 pts, -8.03 pts] worse | -5.74 pts [-6.15 pts, -5.33 pts] worse | -5.74 pts [-6.19 pts, -5.29 pts] worse | -8.33 pts [-8.81 pts, -7.85 pts] worse | -4.07 pts [-4.44 pts, -3.69 pts] worse | -4.62 pts [-5.15 pts, -4.09 pts] worse | -4.44 pts [-4.92 pts, -3.95 pts] worse | -5.04 pts [-5.42 pts, -4.66 pts] worse | -4.50 pts [-4.95 pts, -4.06 pts] worse |
| Oldest pending case | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] |
| 95th percentile pending age | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | -0.00 [-0.00, +0.00] | -0.01 [-0.04, +0.02] | 0.00 [0.00, 0.00] | -0.03 [-0.07, -0.00] better | 0.00 [0.00, 0.00] |
| Cases never heard | +140 [+128, +151] worse | +149 [+138, +160] worse | +144 [+134, +154] worse | +116 [+102, +130] worse | +220 [+207, +233] worse | +140 [+128, +151] worse | +155 [+141, +168] worse | +157 [+141, +172] worse | +103 [+92.7, +114] worse | +125 [+109, +141] worse | +108 [+93.1, +122] worse | +128 [+118, +139] worse | +96.6 [+83.9, +109] worse |
| Load balance (CV of daily minutes) | +0.01 [+0.01, +0.02] worse | +0.00 [-0.00, +0.01] | +0.01 [+0.01, +0.01] worse | +0.01 [+0.01, +0.02] worse | +0.01 [+0.01, +0.02] worse | +0.01 [+0.01, +0.02] worse | +0.02 [+0.02, +0.03] worse | -0.01 [-0.01, -0.00] better | +0.01 [+0.01, +0.02] worse | +0.01 [+0.00, +0.01] worse | +0.01 [+0.01, +0.01] worse | +0.01 [+0.00, +0.01] worse | +0.01 [+0.01, +0.01] worse |
| Listed per sitting day | -2.07 [-2.17, -1.96] | -2.07 [-2.18, -1.97] | -2.10 [-2.20, -2.00] | -1.81 [-1.95, -1.68] | -3.58 [-3.66, -3.50] | -2.07 [-2.17, -1.96] | -3.41 [-3.48, -3.33] | +1.92 [+1.77, +2.08] | -1.96 [-2.06, -1.86] | -1.60 [-1.70, -1.51] | -1.70 [-1.79, -1.62] | -1.50 [-1.58, -1.42] | -1.54 [-1.64, -1.43] |
| Reached per sitting day | -0.03 [-0.28, +0.22] | -0.24 [-0.48, -0.00] worse | -0.10 [-0.32, +0.12] | +0.43 [+0.13, +0.72] better | -1.52 [-1.79, -1.26] worse | -0.03 [-0.28, +0.22] | -0.59 [-0.87, -0.32] worse | +2.18 [+1.88, +2.48] better | +0.68 [+0.46, +0.90] better | +0.79 [+0.47, +1.10] better | +0.67 [+0.38, +0.96] better | +0.65 [+0.44, +0.87] better | +1.02 [+0.74, +1.29] better |
| Substantive per sitting day | +1.08 [+0.98, +1.18] better | +1.41 [+1.32, +1.49] better | +1.00 [+0.91, +1.09] better | +1.27 [+1.15, +1.39] better | +0.87 [+0.77, +0.97] better | +1.08 [+0.98, +1.18] better | +0.70 [+0.60, +0.80] better | +1.96 [+1.87, +2.05] better | +1.21 [+1.11, +1.30] better | +1.21 [+1.09, +1.32] better | +1.18 [+1.04, +1.31] better | +1.17 [+1.07, +1.27] better | +1.31 [+1.20, +1.43] better |
| Disposals (headline) | +8.10 [+6.90, +9.30] better | +6.03 [+4.72, +7.34] better | +7.97 [+6.78, +9.15] better | +8.77 [+7.43, +10.1] better | +6.60 [+5.38, +7.82] better | +8.10 [+6.90, +9.30] better | +7.60 [+6.02, +9.18] better | +10.1 [+8.69, +11.4] better | +9.53 [+7.89, +11.2] better | +9.37 [+7.82, +10.9] better | +7.43 [+5.95, +8.92] better | +6.57 [+5.13, +8.01] better | +8.53 [+6.93, +10.1] better |
| Disposals of 4y+ cases (headline) | +5.40 [+4.41, +6.39] better | +5.13 [+4.01, +6.25] better | +5.20 [+4.22, +6.18] better | +5.43 [+4.30, +6.56] better | +4.80 [+3.85, +5.75] better | +5.40 [+4.41, +6.39] better | +4.80 [+3.90, +5.70] better | +6.03 [+5.11, +6.96] better | +7.93 [+6.99, +8.88] better | +6.80 [+5.96, +7.64] better | +5.40 [+4.54, +6.26] better | +5.20 [+4.41, +5.99] better | +5.03 [+3.93, +6.14] better |
| Trips per substantive hearing | -1.22 [-1.28, -1.16] better | -1.20 [-1.25, -1.14] better | -1.16 [-1.21, -1.12] better | -1.34 [-1.41, -1.26] better | -1.38 [-1.45, -1.31] better | -1.22 [-1.28, -1.16] better | -1.31 [-1.37, -1.25] better | -1.00 [-1.05, -0.94] better | -1.25 [-1.32, -1.19] better | -1.20 [-1.26, -1.13] better | -1.26 [-1.35, -1.17] better | -1.13 [-1.18, -1.07] better | -1.23 [-1.29, -1.16] better |
| Wasted trips | -2.66 pts [-2.80 pts, -2.52 pts] better | -2.81 pts [-2.93 pts, -2.70 pts] better | -2.56 pts [-2.68 pts, -2.43 pts] better | -2.84 pts [-2.99 pts, -2.68 pts] better | -3.00 pts [-3.16 pts, -2.83 pts] better | -2.66 pts [-2.80 pts, -2.52 pts] better | -2.83 pts [-2.99 pts, -2.67 pts] better | -1.85 pts [-1.97 pts, -1.73 pts] better | -2.82 pts [-2.99 pts, -2.65 pts] better | -2.56 pts [-2.71 pts, -2.41 pts] better | -2.52 pts [-2.72 pts, -2.32 pts] better | -2.53 pts [-2.67 pts, -2.39 pts] better | -2.70 pts [-2.88 pts, -2.52 pts] better |
| Desk matters per sitting day | +5.55 [+5.46, +5.63] | +5.55 [+5.47, +5.64] | +5.55 [+5.46, +5.63] | +5.55 [+5.46, +5.63] | +7.15 [+7.08, +7.21] | +5.55 [+5.46, +5.63] | +5.60 [+5.51, +5.69] | +5.50 [+5.42, +5.59] | +5.17 [+5.09, +5.25] | +5.34 [+5.26, +5.43] | +5.06 [+5.00, +5.13] | +5.28 [+5.21, +5.34] | +5.23 [+5.15, +5.32] |
| Vacated per sitting day | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] |
| Deferred per sitting day | +0.47 [+0.43, +0.52] worse | +0.49 [+0.45, +0.53] worse | +0.46 [+0.42, +0.51] worse | +0.51 [+0.46, +0.56] worse | +0.65 [+0.62, +0.68] worse | +0.47 [+0.43, +0.52] worse | +1.11 [+1.05, +1.16] worse | +1.16 [+1.11, +1.21] worse | +0.38 [+0.34, +0.43] worse | +0.37 [+0.33, +0.41] worse | +0.47 [+0.44, +0.50] worse | +0.45 [+0.43, +0.48] worse | +0.60 [+0.57, +0.64] worse |
| Sitting days | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] |
| Minutes past capacity | +117 [+85.6, +148] worse | +190 [+162, +217] worse | +71.5 [+52.4, +90.6] worse | +165 [+109, +220] worse | +89.0 [+61.2, +117] worse | +117 [+85.6, +148] worse | +51.1 [+22.6, +79.6] worse | +225 [+190, +261] worse | +108 [+71.0, +146] worse | +123 [+86.3, +160] worse | +100 [+66.9, +133] worse | +108 [+82.0, +135] worse | +96.7 [+61.2, +132] worse |
| Reach rate excluding uncalled standby | +6.59 pts [+6.12 pts, +7.06 pts] better | +6.57 pts [+6.12 pts, +7.03 pts] better | +6.28 pts [+5.88 pts, +6.67 pts] better | +7.15 pts [+6.63 pts, +7.66 pts] better | +5.84 pts [+5.41 pts, +6.28 pts] better | +6.59 pts [+6.12 pts, +7.06 pts] better | +7.38 pts [+6.85 pts, +7.91 pts] better | +4.49 pts [+4.07 pts, +4.90 pts] better | +8.10 pts [+7.59 pts, +8.62 pts] better | +7.57 pts [+7.03 pts, +8.11 pts] better | +7.35 pts [+6.73 pts, +7.97 pts] better | +6.99 pts [+6.54 pts, +7.45 pts] better | +7.87 pts [+7.31 pts, +8.43 pts] better |
| Reach rate on sitting days | +3.23 pts [+2.84 pts, +3.61 pts] better | +2.88 pts [+2.52 pts, +3.24 pts] better | +3.19 pts [+2.86 pts, +3.51 pts] better | +3.54 pts [+3.10 pts, +3.98 pts] better | +3.17 pts [+2.77 pts, +3.57 pts] better | +3.23 pts [+2.84 pts, +3.61 pts] better | +4.49 pts [+4.07 pts, +4.90 pts] better | +0.66 pts [+0.23 pts, +1.10 pts] better | +4.23 pts [+3.88 pts, +4.57 pts] better | +3.84 pts [+3.36 pts, +4.33 pts] better | +3.81 pts [+3.34 pts, +4.28 pts] better | +3.47 pts [+3.15 pts, +3.80 pts] better | +4.12 pts [+3.69 pts, +4.55 pts] better |
| Gap to first heard, never heard at the end | +2.81 [+2.60, +3.02] worse | +2.88 [+2.68, +3.09] worse | +2.88 [+2.71, +3.05] worse | +2.51 [+2.27, +2.75] worse | +3.82 [+3.60, +4.05] worse | +2.81 [+2.60, +3.02] worse | +2.88 [+2.67, +3.10] worse | +2.97 [+2.71, +3.22] worse | +2.11 [+1.92, +2.29] worse | +2.20 [+2.01, +2.39] worse | +2.23 [+2.05, +2.41] worse | +2.27 [+2.14, +2.40] worse | +1.90 [+1.73, +2.07] worse |
| Cases whose date came up | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] |
| Dates honoured (court or desk order) | +2.93 pts [+2.54 pts, +3.32 pts] better | +2.59 pts [+2.24 pts, +2.95 pts] better | +2.83 pts [+2.52 pts, +3.15 pts] better | +3.34 pts [+2.90 pts, +3.78 pts] better | +2.66 pts [+2.27 pts, +3.05 pts] better | +2.93 pts [+2.54 pts, +3.32 pts] better | +3.10 pts [+2.68 pts, +3.53 pts] better | -0.31 pts [-0.75 pts, +0.13 pts] | +4.06 pts [+3.68 pts, +4.44 pts] better | +3.71 pts [+3.22 pts, +4.20 pts] better | +3.49 pts [+3.01 pts, +3.97 pts] better | +3.17 pts [+2.84 pts, +3.51 pts] better | +3.63 pts [+3.18 pts, +4.08 pts] better |
| Dates broken or never given | -79.3 [-91.0, -67.6] better | -68.3 [-79.0, -57.7] better | -77.9 [-87.5, -68.3] better | -87.8 [-101, -74.6] better | -71.2 [-82.8, -59.6] better | -79.3 [-91.0, -67.6] better | -86.6 [-99.4, -73.8] better | +46.0 [+32.7, +59.3] worse | -115 [-126, -103] better | -103 [-118, -87.6] better | -96.6 [-111, -82.3] better | -86.5 [-96.8, -76.3] better | -98.9 [-112, -85.4] better |
| Heard rows that were on the promised date | 0.00 pts [0.00 pts, 0.00 pts] | 0.00 pts [0.00 pts, 0.00 pts] | 0.00 pts [0.00 pts, 0.00 pts] | 0.00 pts [0.00 pts, 0.00 pts] | 0.00 pts [0.00 pts, 0.00 pts] | 0.00 pts [0.00 pts, 0.00 pts] | 0.00 pts [0.00 pts, 0.00 pts] | 0.00 pts [0.00 pts, 0.00 pts] | 0.00 pts [0.00 pts, 0.00 pts] | 0.00 pts [0.00 pts, 0.00 pts] | 0.00 pts [0.00 pts, 0.00 pts] | 0.00 pts [0.00 pts, 0.00 pts] | 0.00 pts [0.00 pts, 0.00 pts] |
| Mean next date gap | -8.55 [-8.65, -8.46] | -8.59 [-8.69, -8.50] | -8.54 [-8.63, -8.45] | -8.58 [-8.67, -8.50] | -9.44 [-9.53, -9.35] | -8.55 [-8.65, -8.46] | -5.76 [-5.84, -5.69] | -14.7 [-14.9, -14.6] | -7.68 [-7.78, -7.59] | -8.65 [-8.77, -8.53] | -8.24 [-8.33, -8.15] | -8.51 [-8.63, -8.39] | -7.86 [-7.95, -7.76] |
| Next dates inside the minimum | +1.42 pts [+1.36 pts, +1.47 pts] | +1.44 pts [+1.38 pts, +1.49 pts] | +1.42 pts [+1.38 pts, +1.46 pts] | +1.42 pts [+1.35 pts, +1.48 pts] | +1.49 pts [+1.43 pts, +1.55 pts] | +1.42 pts [+1.36 pts, +1.47 pts] | +1.52 pts [+1.45 pts, +1.58 pts] | +1.43 pts [+1.37 pts, +1.48 pts] | +1.23 pts [+1.17 pts, +1.30 pts] | +1.60 pts [+1.53 pts, +1.68 pts] | +1.07 pts [+1.00 pts, +1.13 pts] | +1.43 pts [+1.36 pts, +1.50 pts] | +0.99 pts [+0.94 pts, +1.04 pts] |
| Next dates wasted, counting absences | +0.06 pts [-2.99 pts, +3.11 pts] | -0.97 pts [-3.83 pts, +1.89 pts] | +0.38 pts [-2.55 pts, +3.30 pts] | -0.13 pts [-2.92 pts, +2.67 pts] | -0.86 pts [-3.95 pts, +2.23 pts] | +0.06 pts [-2.99 pts, +3.11 pts] | +1.22 pts [-1.26 pts, +3.69 pts] | -1.49 pts [-3.97 pts, +0.99 pts] | +4.07 pts [+1.95 pts, +6.20 pts] worse | +1.94 pts [-0.29 pts, +4.18 pts] | -1.91 pts [-4.68 pts, +0.86 pts] | +0.75 pts [-1.77 pts, +3.26 pts] | +1.43 pts [-0.90 pts, +3.75 pts] |
| Next dates not ready, counting desk re-checks | +0.38 pts [-2.36 pts, +3.11 pts] | +1.07 pts [-1.50 pts, +3.64 pts] | +0.25 pts [-2.53 pts, +3.03 pts] | +0.74 pts [-1.80 pts, +3.27 pts] | -0.87 pts [-3.66 pts, +1.91 pts] | +0.38 pts [-2.36 pts, +3.11 pts] | +0.82 pts [-1.87 pts, +3.51 pts] | -0.71 pts [-3.20 pts, +1.78 pts] | +2.84 pts [+0.41 pts, +5.27 pts] worse | +0.80 pts [-1.07 pts, +2.67 pts] | -1.70 pts [-4.06 pts, +0.66 pts] | +0.38 pts [-2.11 pts, +2.87 pts] | -0.18 pts [-2.31 pts, +1.94 pts] |
| 4y+ cases never heard | -0.53 [-1.62, +0.56] | -0.53 [-1.62, +0.56] | -0.53 [-1.62, +0.56] | -1.53 [-3.14, +0.07] | -0.53 [-1.62, +0.56] | -0.53 [-1.62, +0.56] | -0.53 [-1.62, +0.56] | -0.53 [-1.62, +0.56] | -0.67 [-2.03, +0.70] | -0.67 [-2.03, +0.70] | -0.67 [-2.03, +0.70] | -0.80 [-2.44, +0.84] | -0.87 [-2.43, +0.70] |
| Pending 4y+ cases at the end | -8.00 [-9.17, -6.83] better | -7.83 [-9.19, -6.48] better | -7.60 [-8.75, -6.45] better | -8.13 [-9.43, -6.84] better | -6.60 [-7.60, -5.60] better | -8.00 [-9.17, -6.83] better | -7.13 [-8.29, -5.98] better | -10.2 [-11.3, -9.07] better | -11.5 [-12.5, -10.4] better | -10.5 [-11.6, -9.35] better | -8.23 [-9.11, -7.36] better | -9.77 [-11.0, -8.58] better | -9.33 [-10.8, -7.91] better |
| Disposals inferred from the log | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] |
| Substantive on the promised date (all due) | -0.07 pts [-0.22 pts, +0.09 pts] | +0.43 pts [+0.30 pts, +0.57 pts] better | -0.20 pts [-0.33 pts, -0.07 pts] worse | +0.13 pts [-0.04 pts, +0.31 pts] | -0.45 pts [-0.60 pts, -0.30 pts] worse | -0.07 pts [-0.22 pts, +0.09 pts] | -0.38 pts [-0.53 pts, -0.23 pts] worse | -0.70 pts [-0.85 pts, -0.56 pts] worse | +0.26 pts [+0.11 pts, +0.41 pts] better | +0.05 pts [-0.12 pts, +0.22 pts] | +0.17 pts [-0.04 pts, +0.37 pts] | -0.12 pts [-0.27 pts, +0.04 pts] | +0.09 pts [-0.08 pts, +0.26 pts] |
| First promise kept, per case | -5.73 pts [-6.12 pts, -5.33 pts] worse | -6.05 pts [-6.42 pts, -5.67 pts] worse | -5.80 pts [-6.13 pts, -5.47 pts] worse | -5.38 pts [-5.83 pts, -4.92 pts] worse | -8.37 pts [-8.80 pts, -7.94 pts] worse | -5.73 pts [-6.12 pts, -5.33 pts] worse | -5.90 pts [-6.35 pts, -5.46 pts] worse | -7.72 pts [-8.17 pts, -7.26 pts] worse | -4.25 pts [-4.57 pts, -3.93 pts] worse | -4.92 pts [-5.45 pts, -4.39 pts] worse | -4.43 pts [-4.91 pts, -3.95 pts] worse | -5.13 pts [-5.48 pts, -4.78 pts] worse | -4.34 pts [-4.75 pts, -3.93 pts] worse |
| Next date excess over the gap for the next purpose | -8.03 [-8.14, -7.93] better | -8.08 [-8.18, -7.98] better | -8.02 [-8.12, -7.92] better | -8.06 [-8.15, -7.97] better | -8.96 [-9.06, -8.86] better | -8.03 [-8.14, -7.93] better | -5.22 [-5.30, -5.13] better | -14.4 [-14.5, -14.3] better | -7.28 [-7.36, -7.19] better | -8.20 [-8.33, -8.08] better | -7.77 [-7.87, -7.68] better | -8.14 [-8.26, -8.02] better | -7.41 [-7.50, -7.31] better |
| Next purposes inferred | -5.89 pts [-6.04 pts, -5.74 pts] | -5.91 pts [-6.06 pts, -5.76 pts] | -5.89 pts [-6.01 pts, -5.76 pts] | -5.87 pts [-6.06 pts, -5.68 pts] | -6.32 pts [-6.49 pts, -6.16 pts] | -5.89 pts [-6.04 pts, -5.74 pts] | -5.19 pts [-5.29 pts, -5.09 pts] | -11.9 pts [-12.1 pts, -11.7 pts] | -5.71 pts [-5.84 pts, -5.57 pts] | -6.85 pts [-7.00 pts, -6.70 pts] | -6.15 pts [-6.26 pts, -6.04 pts] | -6.82 pts [-6.97 pts, -6.67 pts] | -6.47 pts [-6.59 pts, -6.35 pts] |
| Next dates beyond the horizon end | -5.89 pts [-6.04 pts, -5.74 pts] | -5.91 pts [-6.06 pts, -5.76 pts] | -5.89 pts [-6.01 pts, -5.76 pts] | -5.87 pts [-6.06 pts, -5.68 pts] | -6.32 pts [-6.49 pts, -6.16 pts] | -5.89 pts [-6.04 pts, -5.74 pts] | -5.19 pts [-5.29 pts, -5.09 pts] | -11.9 pts [-12.1 pts, -11.7 pts] | -5.71 pts [-5.84 pts, -5.57 pts] | -6.85 pts [-7.00 pts, -6.70 pts] | -6.15 pts [-6.26 pts, -6.04 pts] | -6.82 pts [-6.97 pts, -6.67 pts] | -6.47 pts [-6.59 pts, -6.35 pts] |
| Gap from the horizon start to first heard, all cases | +2.81 [+2.60, +3.02] worse | +2.88 [+2.68, +3.09] worse | +2.88 [+2.71, +3.05] worse | +2.51 [+2.27, +2.75] worse | +3.82 [+3.60, +4.05] worse | +2.81 [+2.60, +3.02] worse | +2.88 [+2.67, +3.10] worse | +2.97 [+2.71, +3.22] worse | +2.11 [+1.92, +2.29] worse | +2.20 [+2.01, +2.39] worse | +2.23 [+2.05, +2.41] worse | +2.27 [+2.14, +2.40] worse | +1.90 [+1.73, +2.07] worse |
| Minutes waited per person heard | -14.5 [-15.6, -13.4] better | -12.0 [-13.2, -10.9] better | -14.9 [-15.9, -13.9] better | -12.4 [-14.0, -10.8] better | -15.6 [-16.9, -14.4] better | -14.5 [-15.6, -13.4] better | -17.6 [-18.6, -16.6] better | -8.26 [-9.52, -7.00] better | -12.6 [-13.5, -11.6] better | -11.9 [-13.1, -10.7] better | -10.6 [-11.7, -9.56] better | -10.3 [-11.7, -8.97] better | -11.3 [-12.4, -10.2] better |
| Minutes waited, counting matters not reached | -19.3 [-20.5, -18.1] better | -14.9 [-16.1, -13.6] better | -19.8 [-20.8, -18.7] better | -18.1 [-20.1, -16.1] better | -20.5 [-21.7, -19.2] better | -19.3 [-20.5, -18.1] better | -25.5 [-26.6, -24.4] better | -6.91 [-8.12, -5.70] better | -19.5 [-20.9, -18.1] better | -18.2 [-19.7, -16.7] better | -16.7 [-17.9, -15.5] better | -16.1 [-17.4, -14.7] better | -18.0 [-19.0, -17.1] better |
| Mean age of the 100 oldest pending cases | -0.00 [-0.01, -0.00] better | -0.00 [-0.01, -0.00] better | -0.00 [-0.01, -0.00] better | -0.00 [-0.01, -0.00] better | -0.00 [-0.01, -0.00] better | -0.00 [-0.01, -0.00] better | -0.00 [-0.00, +0.00] | -0.01 [-0.01, -0.01] better | -0.00 [-0.00, +0.00] | -0.00 [-0.00, +0.00] | -0.00 [-0.01, -0.00] better | -0.00 [-0.00, -0.00] better | -0.00 [-0.01, -0.00] better |
| Cases never acted on | -115 [-126, -104] better | -106 [-116, -95.5] better | -110 [-118, -102] better | -140 [-153, -126] better | -116 [-127, -104] better | -115 [-126, -104] better | -107 [-119, -94.8] better | -70.4 [-84.7, -56.1] better | -140 [-150, -129] better | -126 [-139, -112] better | -129 [-143, -114] better | -119 [-128, -110] better | -140 [-153, -127] better |
| 4y+ cases acted on | +0.06 pts [-0.06 pts, +0.18 pts] | +0.06 pts [-0.06 pts, +0.18 pts] | +0.06 pts [-0.06 pts, +0.18 pts] | +0.17 pts [-0.01 pts, +0.35 pts] | +0.06 pts [-0.06 pts, +0.18 pts] | +0.06 pts [-0.06 pts, +0.18 pts] | +0.06 pts [-0.06 pts, +0.18 pts] | +0.06 pts [-0.06 pts, +0.18 pts] | +0.07 pts [-0.07 pts, +0.22 pts] | +0.07 pts [-0.08 pts, +0.23 pts] | +0.08 pts [-0.08 pts, +0.23 pts] | +0.09 pts [-0.09 pts, +0.26 pts] | +0.09 pts [-0.08 pts, +0.26 pts] |
| Disposals by verdict | +5.33 [+4.37, +6.30] | +5.13 [+4.03, +6.24] | +5.20 [+4.23, +6.17] | +5.37 [+4.32, +6.41] | +5.33 [+4.34, +6.33] | +5.33 [+4.37, +6.30] | +4.30 [+3.34, +5.26] | +7.07 [+6.17, +7.96] | +6.87 [+5.94, +7.79] | +6.67 [+5.92, +7.42] | +5.23 [+4.34, +6.13] | +4.93 [+4.19, +5.67] | +5.30 [+4.31, +6.29] |
| Disposals by settlement | -0.60 [-0.97, -0.23] | -0.57 [-0.95, -0.18] | -0.63 [-0.99, -0.27] | -0.57 [-0.99, -0.14] | -0.70 [-1.16, -0.24] | -0.60 [-0.97, -0.23] | -0.77 [-1.14, -0.39] | -0.10 [-0.57, +0.37] | -0.43 [-0.81, -0.06] | -0.37 [-0.68, -0.05] | -0.90 [-1.38, -0.42] | +0.17 [-0.16, +0.49] | -0.47 [-0.87, -0.07] |
| Disposals by compounding | -0.33 [-1.04, +0.37] | -0.13 [-0.85, +0.58] | -0.40 [-1.10, +0.30] | 0.00 [-0.78, +0.78] | -1.00 [-1.80, -0.20] | -0.33 [-1.04, +0.37] | -0.97 [-1.71, -0.22] | -0.40 [-1.25, +0.45] | -1.20 [-1.87, -0.53] | -0.70 [-1.39, -0.01] | -0.13 [-0.69, +0.43] | -1.47 [-2.25, -0.68] | -0.33 [-1.02, +0.36] |
| Acquittals for the complainant's default | +1.93 [+1.34, +2.53] | -0.17 [-0.53, +0.20] | +2.07 [+1.52, +2.61] | +2.17 [+1.41, +2.92] | +1.70 [+1.15, +2.25] | +1.93 [+1.34, +2.53] | +3.13 [+2.48, +3.79] | +0.90 [+0.23, +1.57] | +2.60 [+2.03, +3.17] | +2.10 [+1.54, +2.66] | +1.60 [+0.99, +2.21] | +1.77 [+1.08, +2.45] | +2.77 [+2.10, +3.43] |
| Dismissals for steps not taken | +1.77 [+1.21, +2.33] | +1.77 [+1.21, +2.33] | +1.73 [+1.20, +2.27] | +1.80 [+1.19, +2.41] | +1.27 [+0.74, +1.79] | +1.77 [+1.21, +2.33] | +1.90 [+1.23, +2.57] | +2.60 [+1.95, +3.25] | +1.70 [+1.26, +2.14] | +1.67 [+1.15, +2.18] | +1.63 [+1.02, +2.25] | +1.17 [+0.67, +1.67] | +1.27 [+0.76, +1.78] |
| Post-judgment closures | +4.27 [+3.55, +4.99] | +4.30 [+3.58, +5.02] | +3.90 [+3.15, +4.65] | +5.80 [+4.75, +6.85] | +3.63 [+2.79, +4.48] | +4.27 [+3.55, +4.99] | +3.37 [+2.78, +3.95] | +8.37 [+7.34, +9.40] | +3.87 [+3.15, +4.59] | +4.23 [+3.33, +5.14] | +4.33 [+3.58, +5.08] | +5.17 [+4.20, +6.14] | +5.67 [+4.88, +6.45] |
| Long-pending splits | -0.97 [-1.27, -0.66] | -0.93 [-1.24, -0.62] | -1.00 [-1.29, -0.71] | -0.97 [-1.25, -0.68] | -0.97 [-1.27, -0.66] | -0.97 [-1.27, -0.66] | -0.93 [-1.24, -0.62] | -0.90 [-1.17, -0.63] | -0.83 [-1.11, -0.55] | -1.30 [-1.75, -0.85] | -0.43 [-0.72, -0.14] | -0.83 [-1.08, -0.59] | -1.17 [-1.65, -0.69] |
| Cases off the file, all routes | +11.4 [+9.86, +12.9] | +9.40 [+7.80, +11.0] | +10.9 [+9.35, +12.4] | +13.6 [+11.6, +15.6] | +9.27 [+7.87, +10.7] | +11.4 [+9.86, +12.9] | +10.0 [+8.28, +11.8] | +17.5 [+15.7, +19.3] | +12.6 [+10.8, +14.4] | +12.3 [+10.3, +14.3] | +11.3 [+9.69, +13.0] | +10.9 [+8.96, +12.8] | +13.0 [+11.3, +14.8] |
| Disposals with an inferred route | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] |
| Throughput, all routes | +4.57 [+3.95, +5.18] | +3.76 [+3.12, +4.40] | +4.35 [+3.75, +4.96] | +5.45 [+4.65, +6.25] | +3.71 [+3.15, +4.27] | +4.57 [+3.95, +5.18] | +4.02 [+3.32, +4.72] | +7.02 [+6.30, +7.74] | +5.03 [+4.31, +5.76] | +4.93 [+4.14, +5.72] | +4.54 [+3.88, +5.20] | +4.37 [+3.59, +5.14] | +5.22 [+4.53, +5.91] |
| Disposals on the merits (verdict + settlement + compounded) | +4.40 [+3.26, +5.54] better | +4.43 [+3.17, +5.70] better | +4.17 [+3.04, +5.29] better | +4.80 [+3.49, +6.11] better | +3.63 [+2.43, +4.83] better | +4.40 [+3.26, +5.54] better | +2.57 [+1.42, +3.72] better | +6.57 [+5.42, +7.72] better | +5.23 [+4.05, +6.42] better | +5.60 [+4.35, +6.85] better | +4.20 [+2.92, +5.48] better | +3.63 [+2.50, +4.76] better | +4.50 [+3.16, +5.84] better |

## The winner's own level per condition (mean [95% t interval])

| Measure | baseline | nobehaviour | cv025 | cv100 | process15 | falsealarm2 | pbias_up | pbias_down | roster1 | roster2 | roster3 | roster4 | roster5 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Substantive per sitting day | 18.2 [18.1, 18.3] | 18.5 [18.4, 18.6] | 18.2 [18.1, 18.3] | 18.0 [17.9, 18.1] | 17.4 [17.3, 17.5] | 18.2 [18.1, 18.3] | 17.8 [17.7, 17.9] | 19.0 [18.9, 19.2] | 18.6 [18.5, 18.7] | 18.3 [18.2, 18.5] | 17.9 [17.8, 18.0] | 18.8 [18.7, 18.9] | 18.8 [18.7, 18.9] |
| Disposals on the merits (verdict + settlement + compounded) | 89.3 [86.7, 91.9] | 89.3 [86.7, 91.9] | 89.2 [86.5, 91.9] | 88.9 [86.0, 91.7] | 88.6 [85.6, 91.6] | 89.3 [86.7, 91.9] | 87.5 [84.7, 90.2] | 91.5 [88.4, 94.6] | 101 [97.4, 105] | 93.7 [90.5, 96.8] | 95.9 [92.8, 99.0] | 86.6 [83.0, 90.2] | 91.7 [88.6, 94.7] |
| Dates honoured (court or desk order) | 94.9% [94.5%, 95.4%] | 94.6% [94.1%, 95.0%] | 95.6% [95.3%, 96.0%] | 93.4% [92.8%, 94.0%] | 95.3% [94.8%, 95.7%] | 94.9% [94.5%, 95.4%] | 95.1% [94.6%, 95.5%] | 91.7% [91.3%, 92.1%] | 94.8% [94.4%, 95.2%] | 94.9% [94.5%, 95.2%] | 94.8% [94.5%, 95.2%] | 95.1% [94.7%, 95.5%] | 94.4% [94.0%, 94.9%] |
| Dates broken or never given | 166 [151, 181] | 177 [162, 192] | 142 [130, 155] | 217 [198, 235] | 155 [140, 169] | 166 [151, 181] | 159 [144, 173] | 291 [276, 306] | 169 [156, 182] | 168 [157, 179] | 168 [155, 181] | 161 [147, 175] | 182 [169, 196] |
| Cases never heard | 380 [368, 391] | 389 [378, 400] | 359 [350, 369] | 412 [399, 426] | 440 [428, 452] | 380 [368, 391] | 394 [382, 406] | 396 [386, 406] | 376 [365, 387] | 385 [376, 395] | 366 [354, 378] | 370 [359, 381] | 372 [360, 384] |
| Pending 4y+ cases at the end | 952 [949, 956] | 953 [949, 956] | 953 [950, 956] | 953 [949, 956] | 954 [951, 957] | 952 [949, 956] | 953 [950, 956] | 950 [947, 953] | 948 [944, 952] | 906 [903, 909] | 913 [909, 917] | 939 [936, 942] | 953 [950, 956] |
| Trips per substantive hearing | 10.5 [10.4, 10.6] | 10.5 [10.5, 10.6] | 10.4 [10.4, 10.5] | 10.6 [10.6, 10.7] | 10.8 [10.7, 10.8] | 10.5 [10.4, 10.6] | 10.4 [10.3, 10.5] | 10.7 [10.7, 10.8] | 10.3 [10.2, 10.3] | 10.5 [10.4, 10.5] | 10.7 [10.6, 10.7] | 10.3 [10.2, 10.3] | 10.2 [10.2, 10.3] |
| Days that overran | 19.7 [18.8, 20.7] | 23.2 [22.3, 24.1] | 19.2 [18.1, 20.2] | 20.0 [19.1, 20.9] | 17.7 [16.6, 18.7] | 19.7 [18.8, 20.7] | 16.2 [15.1, 17.2] | 26.6 [25.6, 27.6] | 22.0 [20.9, 23.1] | 21.6 [20.4, 22.7] | 20.8 [19.3, 22.3] | 20.8 [19.5, 22.2] | 21.8 [20.8, 22.9] |
| Cases whose date came up | 3000 [3000, 3000] | 3000 [3000, 3000] | 3000 [3000, 3000] | 3000 [3000, 3000] | 3000 [3000, 3000] | 3000 [3000, 3000] | 3000 [3000, 3000] | 3000 [3000, 3000] | 3000 [3000, 3000] | 3000 [3000, 3000] | 3000 [3000, 3000] | 3000 [3000, 3000] | 3000 [3000, 3000] |
| Cases never acted on | 125 [113, 136] | 134 [123, 145] | 105 [95.0, 114] | 157 [144, 171] | 105 [93.0, 117] | 125 [113, 136] | 133 [120, 145] | 169 [159, 179] | 133 [123, 143] | 135 [125, 144] | 130 [118, 141] | 123 [111, 135] | 136 [125, 146] |
| 4y+ cases heard at all | 100.0% [100.0%, 100.0%] | 100.0% [100.0%, 100.0%] | 100.0% [100.0%, 100.0%] | 100.0% [99.9%, 100.0%] | 100.0% [100.0%, 100.0%] | 100.0% [100.0%, 100.0%] | 100.0% [100.0%, 100.0%] | 100.0% [100.0%, 100.0%] | 100.0% [100.0%, 100.0%] | 100.0% [100.0%, 100.0%] | 100.0% [100.0%, 100.0%] | 100.0% [100.0%, 100.0%] | 100.0% [100.0%, 100.0%] |
| 4y+ cases never heard | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.37 [-0.38, 1.12] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] |
| 4y+ cases heard substantively | 30.8% [30.4%, 31.3%] | 30.9% [30.5%, 31.3%] | 30.8% [30.3%, 31.2%] | 30.8% [30.4%, 31.3%] | 30.4% [30.0%, 30.8%] | 30.8% [30.4%, 31.3%] | 30.8% [30.4%, 31.2%] | 31.0% [30.6%, 31.3%] | 30.8% [30.3%, 31.2%] | 29.6% [29.2%, 30.1%] | 28.8% [28.3%, 29.3%] | 29.7% [29.3%, 30.2%] | 30.8% [30.4%, 31.3%] |
| Next date excess over the minimum | 42.7 [42.6, 42.8] | 42.7 [42.6, 42.8] | 42.7 [42.6, 42.9] | 42.7 [42.6, 42.8] | 41.8 [41.7, 42.0] | 42.7 [42.6, 42.8] | 45.5 [45.5, 45.6] | 36.4 [36.3, 36.5] | 43.6 [43.5, 43.7] | 42.6 [42.4, 42.7] | 43.1 [43.0, 43.2] | 42.4 [42.3, 42.5] | 43.2 [43.1, 43.3] |
| Utilisation within capacity | 90.0% [89.6%, 90.3%] | 91.7% [91.4%, 92.1%] | 90.7% [90.4%, 91.1%] | 87.8% [87.3%, 88.3%] | 88.5% [88.1%, 88.9%] | 90.0% [89.6%, 90.3%] | 87.8% [87.3%, 88.3%] | 93.3% [92.9%, 93.6%] | 90.5% [90.1%, 91.0%] | 90.5% [90.0%, 91.1%] | 90.3% [89.7%, 91.0%] | 90.3% [89.7%, 90.9%] | 90.7% [90.1%, 91.2%] |
| Reach rate | 95.2% [94.8%, 95.7%] | 94.9% [94.4%, 95.3%] | 96.0% [95.6%, 96.4%] | 93.6% [93.0%, 94.2%] | 95.8% [95.3%, 96.3%] | 95.2% [94.8%, 95.7%] | 96.5% [96.0%, 96.9%] | 92.7% [92.2%, 93.1%] | 95.0% [94.5%, 95.4%] | 95.0% [94.6%, 95.4%] | 95.2% [94.8%, 95.6%] | 95.4% [94.9%, 95.8%] | 94.9% [94.5%, 95.4%] |
| Substantiveness (readme) | 32.9% [32.7%, 33.2%] | 33.6% [33.4%, 33.9%] | 32.8% [32.6%, 33.0%] | 33.0% [32.8%, 33.2%] | 32.1% [31.9%, 32.4%] | 32.9% [32.7%, 33.2%] | 32.6% [32.3%, 32.8%] | 33.2% [33.0%, 33.4%] | 33.7% [33.5%, 33.9%] | 33.0% [32.7%, 33.3%] | 32.3% [32.0%, 32.6%] | 33.7% [33.4%, 33.9%] | 33.9% [33.6%, 34.1%] |
| Wasted listings | 68.7% [68.5%, 68.8%] | 68.1% [67.9%, 68.3%] | 68.5% [68.3%, 68.7%] | 69.1% [68.9%, 69.4%] | 69.3% [69.1%, 69.4%] | 68.7% [68.5%, 68.8%] | 68.6% [68.4%, 68.8%] | 69.3% [69.1%, 69.4%] | 68.0% [67.8%, 68.2%] | 68.6% [68.4%, 68.9%] | 69.3% [69.1%, 69.5%] | 67.9% [67.7%, 68.1%] | 67.8% [67.7%, 68.0%] |
| Minutes waited per person heard | 141 [140, 142] | 143 [142, 145] | 143 [142, 144] | 135 [133, 137] | 139 [138, 140] | 141 [140, 142] | 138 [136, 139] | 147 [146, 148] | 142 [141, 143] | 141 [140, 142] | 143 [142, 144] | 142 [141, 143] | 143 [141, 144] |
| Load balance (CV of daily minutes) | 0.14 [0.14, 0.15] | 0.13 [0.13, 0.14] | 0.13 [0.12, 0.13] | 0.19 [0.18, 0.20] | 0.15 [0.15, 0.16] | 0.14 [0.14, 0.15] | 0.15 [0.15, 0.16] | 0.12 [0.12, 0.13] | 0.15 [0.14, 0.15] | 0.14 [0.14, 0.15] | 0.14 [0.14, 0.15] | 0.15 [0.14, 0.15] | 0.14 [0.13, 0.15] |

## Guardrails per condition

### as calibrated (the arena)

| Guardrail | Measure | Margin | Candidate | Today | Paired difference [95% CI] | Bound | Pass | Pass with the tournament's t |
|---|---|---|---|---|---|---|---|---|
| every case given a date inside the quarter | extra.casesScheduled | >= 2985 | 3000 | 3000 | (absolute limit on the mean) | 3000 | yes | yes |
| dates honoured (heard or desk order on the day) | extra.promisesHonouredInclDesk | -0.02 | 94.9% | 92.0% | +2.93 pts [+2.54 pts, +3.32 pts] | +2.54 pts | yes | yes |
| cases never acted on | extra.neverActedOn | +100 | 125 | 240 | -115 [-126, -104] | -104 | yes | yes |
| cases never heard | siddarth.neverHeard | +150 | 380 | 240 | +140 [+128, +151] | +151 | **NO** | no |
| 4y+ heard at all (README) | readme.backlog4yHeardShare | -0.01 | 100.0% | 99.9% | +0.06 pts [-0.06 pts, +0.18 pts] | -0.06 pts | yes | yes |
| every 4y+ case heard at least once (README score) | extra.neverHeard4yPlus | +0.5 | 0.00 | 0.53 | -0.53 [-1.62, +0.56] | +0.56 | **NO** | no |
| 4y+ moved on | readme.backlog4ySubstantiveShare | -0.01 | 30.8% | 29.2% | +1.60 pts [+1.40 pts, +1.80 pts] | +1.40 pts | yes | yes |
| 4y+ still pending at the end | extra.pending4yPlusEnd | +5 | 952 | 960 | -8.00 [-9.17, -6.83] | -6.83 | yes | yes |
| disposals on the merits (verdict + settlement + compounded) | derived.meritsDisposals | -5 | 89.3 | 84.9 | +4.40 [+3.26, +5.54] | +3.26 | yes | yes |
| next-date excess over PUCAR's gap | caseStudy.nextDateExcessDays | +2 | 42.7 | 50.7 | -7.96 [-8.06, -7.85] | -7.85 | yes | yes |
| days that ran late | caseStudy.overrunDays | +2 | 19.7 | 20.6 | -0.90 [-1.64, -0.16] | -0.16 | yes | yes |
| court time used | caseStudy.utilisation | -0.05 | 90.0% | 90.7% | -0.72 pts [-0.97 pts, -0.47 pts] | -0.97 pts | yes | yes |
| reach rate | readme.reachRate | -0.01 | 95.2% | 92.0% | +3.23 pts [+2.84 pts, +3.61 pts] | +2.84 pts | yes | yes |
| substantiveness | readme.substantiveness | -0.01 | 32.9% | 30.9% | +1.98 pts [+1.84 pts, +2.13 pts] | +1.84 pts | yes | yes |
| trips per useful hearing | extra.tripsPerSubstantive | +0.25 | 10.5 | 11.7 | -1.22 [-1.28, -1.16] | -1.16 | yes | yes |
| wasted listings | siddarth.wastedListings | +0.01 | 68.7% | 71.5% | -2.89 pts [-3.04 pts, -2.73 pts] | -2.73 pts | yes | yes |
| minutes waited | extra.minutesWaited | +5 | 141 | 155 | -14.5 [-15.6, -13.4] | -13.4 | yes | yes |
| load balance across days | siddarth.loadBalanceCv | +0.05 | 0.14 | 0.13 | +0.01 [+0.01, +0.02] | +0.02 | yes | yes |
| useful hearings a day at least today's | extra.substantivePerDay | -0 | 18.2 | 17.1 | +1.08 [+0.98, +1.18] | +0.98 | yes | yes |

### behaviour responses off (--no-behaviour)

| Guardrail | Measure | Margin | Candidate | Today | Paired difference [95% CI] | Bound | Pass | Pass with the tournament's t |
|---|---|---|---|---|---|---|---|---|
| every case given a date inside the quarter | extra.casesScheduled | >= 2985 | 3000 | 3000 | (absolute limit on the mean) | 3000 | yes | yes |
| dates honoured (heard or desk order on the day) | extra.promisesHonouredInclDesk | -0.02 | 94.6% | 92.0% | +2.59 pts [+2.24 pts, +2.95 pts] | +2.24 pts | yes | yes |
| cases never acted on | extra.neverActedOn | +100 | 134 | 240 | -106 [-116, -95.5] | -95.5 | yes | yes |
| cases never heard | siddarth.neverHeard | +150 | 389 | 240 | +149 [+138, +160] | +160 | **NO** | no |
| 4y+ heard at all (README) | readme.backlog4yHeardShare | -0.01 | 100.0% | 99.9% | +0.06 pts [-0.06 pts, +0.18 pts] | -0.06 pts | yes | yes |
| every 4y+ case heard at least once (README score) | extra.neverHeard4yPlus | +0.5 | 0.00 | 0.53 | -0.53 [-1.62, +0.56] | +0.56 | **NO** | no |
| 4y+ moved on | readme.backlog4ySubstantiveShare | -0.01 | 30.9% | 29.2% | +1.65 pts [+1.47 pts, +1.84 pts] | +1.47 pts | yes | yes |
| 4y+ still pending at the end | extra.pending4yPlusEnd | +5 | 953 | 960 | -7.83 [-9.19, -6.48] | -6.48 | yes | yes |
| disposals on the merits (verdict + settlement + compounded) | derived.meritsDisposals | -5 | 89.3 | 84.9 | +4.43 [+3.17, +5.70] | +3.17 | yes | yes |
| next-date excess over PUCAR's gap | caseStudy.nextDateExcessDays | +2 | 42.7 | 50.7 | -8.00 [-8.10, -7.89] | -7.89 | yes | yes |
| days that ran late | caseStudy.overrunDays | +2 | 23.2 | 20.6 | +2.60 [+1.83, +3.37] | +3.37 | **NO** | no |
| court time used | caseStudy.utilisation | -0.05 | 91.7% | 90.7% | +1.03 pts [+0.76 pts, +1.30 pts] | +0.76 pts | yes | yes |
| reach rate | readme.reachRate | -0.01 | 94.9% | 92.0% | +2.88 pts [+2.52 pts, +3.24 pts] | +2.52 pts | yes | yes |
| substantiveness | readme.substantiveness | -0.01 | 33.6% | 30.9% | +2.70 pts [+2.59 pts, +2.80 pts] | +2.59 pts | yes | yes |
| trips per useful hearing | extra.tripsPerSubstantive | +0.25 | 10.5 | 11.7 | -1.20 [-1.25, -1.14] | -1.14 | yes | yes |
| wasted listings | siddarth.wastedListings | +0.01 | 68.1% | 71.5% | -3.45 pts [-3.57 pts, -3.32 pts] | -3.32 pts | yes | yes |
| minutes waited | extra.minutesWaited | +5 | 143 | 155 | -12.0 [-13.2, -10.9] | -10.9 | yes | yes |
| load balance across days | siddarth.loadBalanceCv | +0.05 | 0.13 | 0.13 | +0.00 [-0.00, +0.01] | +0.01 | yes | yes |
| useful hearings a day at least today's | extra.substantivePerDay | -0 | 18.5 | 17.1 | +1.41 [+1.32, +1.49] | +1.32 | yes | yes |

### duration CV 0.25

| Guardrail | Measure | Margin | Candidate | Today | Paired difference [95% CI] | Bound | Pass | Pass with the tournament's t |
|---|---|---|---|---|---|---|---|---|
| every case given a date inside the quarter | extra.casesScheduled | >= 2985 | 3000 | 3000 | (absolute limit on the mean) | 3000 | yes | yes |
| dates honoured (heard or desk order on the day) | extra.promisesHonouredInclDesk | -0.02 | 95.6% | 92.8% | +2.83 pts [+2.52 pts, +3.15 pts] | +2.52 pts | yes | yes |
| cases never acted on | extra.neverActedOn | +100 | 105 | 215 | -110 [-118, -102] | -102 | yes | yes |
| cases never heard | siddarth.neverHeard | +150 | 359 | 215 | +144 [+134, +154] | +154 | **NO** | no |
| 4y+ heard at all (README) | readme.backlog4yHeardShare | -0.01 | 100.0% | 99.9% | +0.06 pts [-0.06 pts, +0.18 pts] | -0.06 pts | yes | yes |
| every 4y+ case heard at least once (README score) | extra.neverHeard4yPlus | +0.5 | 0.00 | 0.53 | -0.53 [-1.62, +0.56] | +0.56 | **NO** | no |
| 4y+ moved on | readme.backlog4ySubstantiveShare | -0.01 | 30.8% | 29.2% | +1.55 pts [+1.37 pts, +1.73 pts] | +1.37 pts | yes | yes |
| 4y+ still pending at the end | extra.pending4yPlusEnd | +5 | 953 | 960 | -7.60 [-8.75, -6.45] | -6.45 | yes | yes |
| disposals on the merits (verdict + settlement + compounded) | derived.meritsDisposals | -5 | 89.2 | 85.1 | +4.17 [+3.04, +5.29] | +3.04 | yes | yes |
| next-date excess over PUCAR's gap | caseStudy.nextDateExcessDays | +2 | 42.7 | 50.7 | -7.94 [-8.04, -7.84] | -7.84 | yes | yes |
| days that ran late | caseStudy.overrunDays | +2 | 19.2 | 20.4 | -1.20 [-2.05, -0.35] | -0.35 | yes | yes |
| court time used | caseStudy.utilisation | -0.05 | 90.7% | 91.5% | -0.74 pts [-1.02 pts, -0.46 pts] | -1.02 pts | yes | yes |
| reach rate | readme.reachRate | -0.01 | 96.0% | 92.8% | +3.19 pts [+2.86 pts, +3.51 pts] | +2.86 pts | yes | yes |
| substantiveness | readme.substantiveness | -0.01 | 32.8% | 31.0% | +1.85 pts [+1.69 pts, +2.02 pts] | +1.69 pts | yes | yes |
| trips per useful hearing | extra.tripsPerSubstantive | +0.25 | 10.4 | 11.6 | -1.16 [-1.21, -1.12] | -1.12 | yes | yes |
| wasted listings | siddarth.wastedListings | +0.01 | 68.5% | 71.3% | -2.76 pts [-2.90 pts, -2.63 pts] | -2.63 pts | yes | yes |
| minutes waited | extra.minutesWaited | +5 | 143 | 158 | -14.9 [-15.9, -13.9] | -13.9 | yes | yes |
| load balance across days | siddarth.loadBalanceCv | +0.05 | 0.13 | 0.12 | +0.01 [+0.01, +0.01] | +0.01 | yes | yes |
| useful hearings a day at least today's | extra.substantivePerDay | -0 | 18.2 | 17.2 | +1.00 [+0.91, +1.09] | +0.91 | yes | yes |

### duration CV 1.0

| Guardrail | Measure | Margin | Candidate | Today | Paired difference [95% CI] | Bound | Pass | Pass with the tournament's t |
|---|---|---|---|---|---|---|---|---|
| every case given a date inside the quarter | extra.casesScheduled | >= 2985 | 3000 | 3000 | (absolute limit on the mean) | 3000 | yes | yes |
| dates honoured (heard or desk order on the day) | extra.promisesHonouredInclDesk | -0.02 | 93.4% | 90.1% | +3.34 pts [+2.90 pts, +3.78 pts] | +2.90 pts | yes | yes |
| cases never acted on | extra.neverActedOn | +100 | 157 | 297 | -140 [-153, -126] | -126 | yes | yes |
| cases never heard | siddarth.neverHeard | +150 | 412 | 297 | +116 [+102, +130] | +130 | yes | yes |
| 4y+ heard at all (README) | readme.backlog4yHeardShare | -0.01 | 100.0% | 99.8% | +0.17 pts [-0.01 pts, +0.35 pts] | -0.01 pts | yes | yes |
| every 4y+ case heard at least once (README score) | extra.neverHeard4yPlus | +0.5 | 0.37 | 1.90 | -1.53 [-3.14, +0.07] | +0.07 | yes | yes |
| 4y+ moved on | readme.backlog4ySubstantiveShare | -0.01 | 30.8% | 29.2% | +1.65 pts [+1.42 pts, +1.89 pts] | +1.42 pts | yes | yes |
| 4y+ still pending at the end | extra.pending4yPlusEnd | +5 | 953 | 961 | -8.13 [-9.43, -6.84] | -6.84 | yes | yes |
| disposals on the merits (verdict + settlement + compounded) | derived.meritsDisposals | -5 | 88.9 | 84.1 | +4.80 [+3.49, +6.11] | +3.49 | yes | yes |
| next-date excess over PUCAR's gap | caseStudy.nextDateExcessDays | +2 | 42.7 | 50.7 | -7.99 [-8.08, -7.89] | -7.89 | yes | yes |
| days that ran late | caseStudy.overrunDays | +2 | 20.0 | 20.7 | -0.73 [-1.46, -0.01] | -0.01 | yes | yes |
| court time used | caseStudy.utilisation | -0.05 | 87.8% | 88.4% | -0.61 pts [-0.93 pts, -0.30 pts] | -0.93 pts | yes | yes |
| reach rate | readme.reachRate | -0.01 | 93.6% | 90.1% | +3.54 pts [+3.10 pts, +3.98 pts] | +3.10 pts | yes | yes |
| substantiveness | readme.substantiveness | -0.01 | 33.0% | 30.9% | +2.09 pts [+1.93 pts, +2.24 pts] | +1.93 pts | yes | yes |
| trips per useful hearing | extra.tripsPerSubstantive | +0.25 | 10.6 | 12.0 | -1.34 [-1.41, -1.26] | -1.26 | yes | yes |
| wasted listings | siddarth.wastedListings | +0.01 | 69.1% | 72.2% | -3.05 pts [-3.23 pts, -2.87 pts] | -2.87 pts | yes | yes |
| minutes waited | extra.minutesWaited | +5 | 135 | 148 | -12.4 [-14.0, -10.8] | -10.8 | yes | yes |
| load balance across days | siddarth.loadBalanceCv | +0.05 | 0.19 | 0.17 | +0.01 [+0.01, +0.02] | +0.02 | yes | yes |
| useful hearings a day at least today's | extra.substantivePerDay | -0 | 18.0 | 16.7 | +1.27 [+1.15, +1.39] | +1.15 | yes | yes |

### process returns 1.5x slower

| Guardrail | Measure | Margin | Candidate | Today | Paired difference [95% CI] | Bound | Pass | Pass with the tournament's t |
|---|---|---|---|---|---|---|---|---|
| every case given a date inside the quarter | extra.casesScheduled | >= 2985 | 3000 | 3000 | (absolute limit on the mean) | 3000 | yes | yes |
| dates honoured (heard or desk order on the day) | extra.promisesHonouredInclDesk | -0.02 | 95.3% | 92.6% | +2.66 pts [+2.27 pts, +3.05 pts] | +2.27 pts | yes | yes |
| cases never acted on | extra.neverActedOn | +100 | 105 | 221 | -116 [-127, -104] | -104 | yes | yes |
| cases never heard | siddarth.neverHeard | +150 | 440 | 221 | +220 [+207, +233] | +233 | **NO** | no |
| 4y+ heard at all (README) | readme.backlog4yHeardShare | -0.01 | 100.0% | 99.9% | +0.06 pts [-0.06 pts, +0.18 pts] | -0.06 pts | yes | yes |
| every 4y+ case heard at least once (README score) | extra.neverHeard4yPlus | +0.5 | 0.00 | 0.53 | -0.53 [-1.62, +0.56] | +0.56 | **NO** | no |
| 4y+ moved on | readme.backlog4ySubstantiveShare | -0.01 | 30.4% | 29.0% | +1.36 pts [+1.19 pts, +1.53 pts] | +1.19 pts | yes | yes |
| 4y+ still pending at the end | extra.pending4yPlusEnd | +5 | 954 | 961 | -6.60 [-7.60, -5.60] | -5.60 | yes | yes |
| disposals on the merits (verdict + settlement + compounded) | derived.meritsDisposals | -5 | 88.6 | 85.0 | +3.63 [+2.43, +4.83] | +2.43 | yes | yes |
| next-date excess over PUCAR's gap | caseStudy.nextDateExcessDays | +2 | 41.8 | 50.7 | -8.86 [-8.96, -8.76] | -8.76 | yes | yes |
| days that ran late | caseStudy.overrunDays | +2 | 17.7 | 19.0 | -1.30 [-2.27, -0.33] | -0.33 | yes | yes |
| court time used | caseStudy.utilisation | -0.05 | 88.5% | 89.5% | -0.97 pts [-1.24 pts, -0.69 pts] | -1.24 pts | yes | yes |
| reach rate | readme.reachRate | -0.01 | 95.8% | 92.6% | +3.17 pts [+2.77 pts, +3.57 pts] | +2.77 pts | yes | yes |
| substantiveness | readme.substantiveness | -0.01 | 32.1% | 29.7% | +2.45 pts [+2.26 pts, +2.63 pts] | +2.26 pts | yes | yes |
| trips per useful hearing | extra.tripsPerSubstantive | +0.25 | 10.8 | 12.1 | -1.38 [-1.45, -1.31] | -1.31 | yes | yes |
| wasted listings | siddarth.wastedListings | +0.01 | 69.3% | 72.5% | -3.28 pts [-3.44 pts, -3.12 pts] | -3.12 pts | yes | yes |
| minutes waited | extra.minutesWaited | +5 | 139 | 155 | -15.6 [-16.9, -14.4] | -14.4 | yes | yes |
| load balance across days | siddarth.loadBalanceCv | +0.05 | 0.15 | 0.14 | +0.01 [+0.01, +0.02] | +0.02 | yes | yes |
| useful hearings a day at least today's | extra.substantivePerDay | -0 | 17.4 | 16.5 | +0.87 [+0.77, +0.97] | +0.77 | yes | yes |

### check-in false alarms doubled (0.05 to 0.10)

| Guardrail | Measure | Margin | Candidate | Today | Paired difference [95% CI] | Bound | Pass | Pass with the tournament's t |
|---|---|---|---|---|---|---|---|---|
| every case given a date inside the quarter | extra.casesScheduled | >= 2985 | 3000 | 3000 | (absolute limit on the mean) | 3000 | yes | yes |
| dates honoured (heard or desk order on the day) | extra.promisesHonouredInclDesk | -0.02 | 94.9% | 92.0% | +2.93 pts [+2.54 pts, +3.32 pts] | +2.54 pts | yes | yes |
| cases never acted on | extra.neverActedOn | +100 | 125 | 240 | -115 [-126, -104] | -104 | yes | yes |
| cases never heard | siddarth.neverHeard | +150 | 380 | 240 | +140 [+128, +151] | +151 | **NO** | no |
| 4y+ heard at all (README) | readme.backlog4yHeardShare | -0.01 | 100.0% | 99.9% | +0.06 pts [-0.06 pts, +0.18 pts] | -0.06 pts | yes | yes |
| every 4y+ case heard at least once (README score) | extra.neverHeard4yPlus | +0.5 | 0.00 | 0.53 | -0.53 [-1.62, +0.56] | +0.56 | **NO** | no |
| 4y+ moved on | readme.backlog4ySubstantiveShare | -0.01 | 30.8% | 29.2% | +1.60 pts [+1.40 pts, +1.80 pts] | +1.40 pts | yes | yes |
| 4y+ still pending at the end | extra.pending4yPlusEnd | +5 | 952 | 960 | -8.00 [-9.17, -6.83] | -6.83 | yes | yes |
| disposals on the merits (verdict + settlement + compounded) | derived.meritsDisposals | -5 | 89.3 | 84.9 | +4.40 [+3.26, +5.54] | +3.26 | yes | yes |
| next-date excess over PUCAR's gap | caseStudy.nextDateExcessDays | +2 | 42.7 | 50.7 | -7.96 [-8.06, -7.85] | -7.85 | yes | yes |
| days that ran late | caseStudy.overrunDays | +2 | 19.7 | 20.6 | -0.90 [-1.64, -0.16] | -0.16 | yes | yes |
| court time used | caseStudy.utilisation | -0.05 | 90.0% | 90.7% | -0.72 pts [-0.97 pts, -0.47 pts] | -0.97 pts | yes | yes |
| reach rate | readme.reachRate | -0.01 | 95.2% | 92.0% | +3.23 pts [+2.84 pts, +3.61 pts] | +2.84 pts | yes | yes |
| substantiveness | readme.substantiveness | -0.01 | 32.9% | 30.9% | +1.98 pts [+1.84 pts, +2.13 pts] | +1.84 pts | yes | yes |
| trips per useful hearing | extra.tripsPerSubstantive | +0.25 | 10.5 | 11.7 | -1.22 [-1.28, -1.16] | -1.16 | yes | yes |
| wasted listings | siddarth.wastedListings | +0.01 | 68.7% | 71.5% | -2.89 pts [-3.04 pts, -2.73 pts] | -2.73 pts | yes | yes |
| minutes waited | extra.minutesWaited | +5 | 141 | 155 | -14.5 [-15.6, -13.4] | -13.4 | yes | yes |
| load balance across days | siddarth.loadBalanceCv | +0.05 | 0.14 | 0.13 | +0.01 [+0.01, +0.02] | +0.02 | yes | yes |
| useful hearings a day at least today's | extra.substantivePerDay | -0 | 18.2 | 17.1 | +1.08 [+0.98, +1.18] | +0.98 | yes | yes |

### planner shown P(substantive) +30%

| Guardrail | Measure | Margin | Candidate | Today | Paired difference [95% CI] | Bound | Pass | Pass with the tournament's t |
|---|---|---|---|---|---|---|---|---|
| every case given a date inside the quarter | extra.casesScheduled | >= 2985 | 3000 | 3000 | (absolute limit on the mean) | 3000 | yes | yes |
| dates honoured (heard or desk order on the day) | extra.promisesHonouredInclDesk | -0.02 | 95.1% | 92.0% | +3.10 pts [+2.68 pts, +3.53 pts] | +2.68 pts | yes | yes |
| cases never acted on | extra.neverActedOn | +100 | 133 | 240 | -107 [-119, -94.8] | -94.8 | yes | yes |
| cases never heard | siddarth.neverHeard | +150 | 394 | 240 | +155 [+141, +168] | +168 | **NO** | no |
| 4y+ heard at all (README) | readme.backlog4yHeardShare | -0.01 | 100.0% | 99.9% | +0.06 pts [-0.06 pts, +0.18 pts] | -0.06 pts | yes | yes |
| every 4y+ case heard at least once (README score) | extra.neverHeard4yPlus | +0.5 | 0.00 | 0.53 | -0.53 [-1.62, +0.56] | +0.56 | **NO** | no |
| 4y+ moved on | readme.backlog4ySubstantiveShare | -0.01 | 30.8% | 29.2% | +1.57 pts [+1.39 pts, +1.75 pts] | +1.39 pts | yes | yes |
| 4y+ still pending at the end | extra.pending4yPlusEnd | +5 | 953 | 960 | -7.13 [-8.29, -5.98] | -5.98 | yes | yes |
| disposals on the merits (verdict + settlement + compounded) | derived.meritsDisposals | -5 | 87.5 | 84.9 | +2.57 [+1.42, +3.72] | +1.42 | yes | yes |
| next-date excess over PUCAR's gap | caseStudy.nextDateExcessDays | +2 | 45.5 | 50.7 | -5.14 [-5.23, -5.05] | -5.05 | yes | yes |
| days that ran late | caseStudy.overrunDays | +2 | 16.2 | 20.6 | -4.47 [-5.39, -3.54] | -3.54 | yes | yes |
| court time used | caseStudy.utilisation | -0.05 | 87.8% | 90.7% | -2.86 pts [-3.22 pts, -2.49 pts] | -3.22 pts | yes | yes |
| reach rate | readme.reachRate | -0.01 | 96.5% | 92.0% | +4.48 pts [+4.07 pts, +4.90 pts] | +4.07 pts | yes | yes |
| substantiveness | readme.substantiveness | -0.01 | 32.6% | 30.9% | +1.62 pts [+1.45 pts, +1.78 pts] | +1.45 pts | yes | yes |
| trips per useful hearing | extra.tripsPerSubstantive | +0.25 | 10.4 | 11.7 | -1.31 [-1.37, -1.25] | -1.25 | yes | yes |
| wasted listings | siddarth.wastedListings | +0.01 | 68.6% | 71.5% | -2.95 pts [-3.11 pts, -2.79 pts] | -2.79 pts | yes | yes |
| minutes waited | extra.minutesWaited | +5 | 138 | 155 | -17.6 [-18.6, -16.6] | -16.6 | yes | yes |
| load balance across days | siddarth.loadBalanceCv | +0.05 | 0.15 | 0.13 | +0.02 [+0.02, +0.03] | +0.03 | yes | yes |
| useful hearings a day at least today's | extra.substantivePerDay | -0 | 17.8 | 17.1 | +0.70 [+0.60, +0.80] | +0.60 | yes | yes |

### planner shown P(substantive) -30%

| Guardrail | Measure | Margin | Candidate | Today | Paired difference [95% CI] | Bound | Pass | Pass with the tournament's t |
|---|---|---|---|---|---|---|---|---|
| every case given a date inside the quarter | extra.casesScheduled | >= 2985 | 3000 | 3000 | (absolute limit on the mean) | 3000 | yes | yes |
| dates honoured (heard or desk order on the day) | extra.promisesHonouredInclDesk | -0.02 | 91.7% | 92.0% | -0.31 pts [-0.75 pts, +0.13 pts] | -0.75 pts | yes | yes |
| cases never acted on | extra.neverActedOn | +100 | 169 | 240 | -70.4 [-84.7, -56.1] | -56.1 | yes | yes |
| cases never heard | siddarth.neverHeard | +150 | 396 | 240 | +157 [+141, +172] | +172 | **NO** | no |
| 4y+ heard at all (README) | readme.backlog4yHeardShare | -0.01 | 100.0% | 99.9% | +0.06 pts [-0.06 pts, +0.18 pts] | -0.06 pts | yes | yes |
| every 4y+ case heard at least once (README score) | extra.neverHeard4yPlus | +0.5 | 0.00 | 0.53 | -0.53 [-1.62, +0.56] | +0.56 | **NO** | no |
| 4y+ moved on | readme.backlog4ySubstantiveShare | -0.01 | 31.0% | 29.2% | +1.75 pts [+1.56 pts, +1.93 pts] | +1.56 pts | yes | yes |
| 4y+ still pending at the end | extra.pending4yPlusEnd | +5 | 950 | 960 | -10.2 [-11.3, -9.07] | -9.07 | yes | yes |
| disposals on the merits (verdict + settlement + compounded) | derived.meritsDisposals | -5 | 91.5 | 84.9 | +6.57 [+5.42, +7.72] | +5.42 | yes | yes |
| next-date excess over PUCAR's gap | caseStudy.nextDateExcessDays | +2 | 36.4 | 50.7 | -14.3 [-14.4, -14.1] | -14.1 | yes | yes |
| days that ran late | caseStudy.overrunDays | +2 | 26.6 | 20.6 | +5.97 [+4.82, +7.11] | +7.11 | **NO** | no |
| court time used | caseStudy.utilisation | -0.05 | 93.3% | 90.7% | +2.58 pts [+2.33 pts, +2.82 pts] | +2.33 pts | yes | yes |
| reach rate | readme.reachRate | -0.01 | 92.7% | 92.0% | +0.67 pts [+0.23 pts, +1.11 pts] | +0.23 pts | yes | yes |
| substantiveness | readme.substantiveness | -0.01 | 33.2% | 30.9% | +2.24 pts [+2.11 pts, +2.37 pts] | +2.11 pts | yes | yes |
| trips per useful hearing | extra.tripsPerSubstantive | +0.25 | 10.7 | 11.7 | -1.00 [-1.05, -0.94] | -0.94 | yes | yes |
| wasted listings | siddarth.wastedListings | +0.01 | 69.3% | 71.5% | -2.28 pts [-2.42 pts, -2.15 pts] | -2.15 pts | yes | yes |
| minutes waited | extra.minutesWaited | +5 | 147 | 155 | -8.26 [-9.52, -7.00] | -7.00 | yes | yes |
| load balance across days | siddarth.loadBalanceCv | +0.05 | 0.12 | 0.13 | -0.01 [-0.01, -0.00] | -0.00 | yes | yes |
| useful hearings a day at least today's | extra.substantivePerDay | -0 | 19.0 | 17.1 | +1.96 [+1.87, +2.05] | +1.87 | yes | yes |

### roster seed 1

| Guardrail | Measure | Margin | Candidate | Today | Paired difference [95% CI] | Bound | Pass | Pass with the tournament's t |
|---|---|---|---|---|---|---|---|---|
| every case given a date inside the quarter | extra.casesScheduled | >= 2985 | 3000 | 3000 | (absolute limit on the mean) | 3000 | yes | yes |
| dates honoured (heard or desk order on the day) | extra.promisesHonouredInclDesk | -0.02 | 94.8% | 90.7% | +4.06 pts [+3.68 pts, +4.44 pts] | +3.68 pts | yes | yes |
| cases never acted on | extra.neverActedOn | +100 | 133 | 273 | -140 [-150, -129] | -129 | yes | yes |
| cases never heard | siddarth.neverHeard | +150 | 376 | 273 | +103 [+92.7, +114] | +114 | yes | yes |
| 4y+ heard at all (README) | readme.backlog4yHeardShare | -0.01 | 100.0% | 99.9% | +0.07 pts [-0.07 pts, +0.22 pts] | -0.07 pts | yes | yes |
| every 4y+ case heard at least once (README score) | extra.neverHeard4yPlus | +0.5 | 0.00 | 0.67 | -0.67 [-2.03, +0.70] | +0.70 | **NO** | no |
| 4y+ moved on | readme.backlog4ySubstantiveShare | -0.01 | 30.8% | 28.9% | +1.86 pts [+1.71 pts, +2.02 pts] | +1.71 pts | yes | yes |
| 4y+ still pending at the end | extra.pending4yPlusEnd | +5 | 948 | 959 | -11.5 [-12.5, -10.4] | -10.4 | yes | yes |
| disposals on the merits (verdict + settlement + compounded) | derived.meritsDisposals | -5 | 101 | 95.8 | +5.23 [+4.05, +6.42] | +4.05 | yes | yes |
| next-date excess over PUCAR's gap | caseStudy.nextDateExcessDays | +2 | 43.6 | 50.8 | -7.16 [-7.26, -7.07] | -7.07 | yes | yes |
| days that ran late | caseStudy.overrunDays | +2 | 22.0 | 23.9 | -1.90 [-2.77, -1.03] | -1.03 | yes | yes |
| court time used | caseStudy.utilisation | -0.05 | 90.5% | 91.6% | -1.10 pts [-1.31 pts, -0.89 pts] | -1.31 pts | yes | yes |
| reach rate | readme.reachRate | -0.01 | 95.0% | 90.7% | +4.23 pts [+3.88 pts, +4.57 pts] | +3.88 pts | yes | yes |
| substantiveness | readme.substantiveness | -0.01 | 33.7% | 31.9% | +1.80 pts [+1.62 pts, +1.97 pts] | +1.62 pts | yes | yes |
| trips per useful hearing | extra.tripsPerSubstantive | +0.25 | 10.3 | 11.5 | -1.25 [-1.32, -1.19] | -1.19 | yes | yes |
| wasted listings | siddarth.wastedListings | +0.01 | 68.0% | 71.1% | -3.06 pts [-3.23 pts, -2.89 pts] | -2.89 pts | yes | yes |
| minutes waited | extra.minutesWaited | +5 | 142 | 155 | -12.6 [-13.5, -11.6] | -11.6 | yes | yes |
| load balance across days | siddarth.loadBalanceCv | +0.05 | 0.15 | 0.13 | +0.01 [+0.01, +0.02] | +0.02 | yes | yes |
| useful hearings a day at least today's | extra.substantivePerDay | -0 | 18.6 | 17.4 | +1.21 [+1.11, +1.30] | +1.11 | yes | yes |

### roster seed 2

| Guardrail | Measure | Margin | Candidate | Today | Paired difference [95% CI] | Bound | Pass | Pass with the tournament's t |
|---|---|---|---|---|---|---|---|---|
| every case given a date inside the quarter | extra.casesScheduled | >= 2985 | 3000 | 3000 | (absolute limit on the mean) | 3000 | yes | yes |
| dates honoured (heard or desk order on the day) | extra.promisesHonouredInclDesk | -0.02 | 94.9% | 91.2% | +3.71 pts [+3.22 pts, +4.20 pts] | +3.22 pts | yes | yes |
| cases never acted on | extra.neverActedOn | +100 | 135 | 260 | -126 [-139, -112] | -112 | yes | yes |
| cases never heard | siddarth.neverHeard | +150 | 385 | 260 | +125 [+109, +141] | +141 | yes | yes |
| 4y+ heard at all (README) | readme.backlog4yHeardShare | -0.01 | 100.0% | 99.9% | +0.07 pts [-0.08 pts, +0.23 pts] | -0.08 pts | yes | yes |
| every 4y+ case heard at least once (README score) | extra.neverHeard4yPlus | +0.5 | 0.00 | 0.67 | -0.67 [-2.03, +0.70] | +0.70 | **NO** | no |
| 4y+ moved on | readme.backlog4ySubstantiveShare | -0.01 | 29.6% | 27.8% | +1.85 pts [+1.66 pts, +2.04 pts] | +1.66 pts | yes | yes |
| 4y+ still pending at the end | extra.pending4yPlusEnd | +5 | 906 | 916 | -10.5 [-11.6, -9.35] | -9.35 | yes | yes |
| disposals on the merits (verdict + settlement + compounded) | derived.meritsDisposals | -5 | 93.7 | 88.1 | +5.60 [+4.35, +6.85] | +4.35 | yes | yes |
| next-date excess over PUCAR's gap | caseStudy.nextDateExcessDays | +2 | 42.6 | 50.7 | -8.11 [-8.24, -7.98] | -7.98 | yes | yes |
| days that ran late | caseStudy.overrunDays | +2 | 21.6 | 22.8 | -1.27 [-2.38, -0.15] | -0.15 | yes | yes |
| court time used | caseStudy.utilisation | -0.05 | 90.5% | 90.8% | -0.27 pts [-0.56 pts, +0.03 pts] | -0.56 pts | yes | yes |
| reach rate | readme.reachRate | -0.01 | 95.0% | 91.2% | +3.85 pts [+3.36 pts, +4.33 pts] | +3.36 pts | yes | yes |
| substantiveness | readme.substantiveness | -0.01 | 33.0% | 31.3% | +1.73 pts [+1.55 pts, +1.90 pts] | +1.55 pts | yes | yes |
| trips per useful hearing | extra.tripsPerSubstantive | +0.25 | 10.5 | 11.7 | -1.20 [-1.26, -1.13] | -1.13 | yes | yes |
| wasted listings | siddarth.wastedListings | +0.01 | 68.6% | 71.5% | -2.85 pts [-3.02 pts, -2.67 pts] | -2.67 pts | yes | yes |
| minutes waited | extra.minutesWaited | +5 | 141 | 153 | -11.9 [-13.1, -10.7] | -10.7 | yes | yes |
| load balance across days | siddarth.loadBalanceCv | +0.05 | 0.14 | 0.13 | +0.01 [+0.00, +0.01] | +0.01 | yes | yes |
| useful hearings a day at least today's | extra.substantivePerDay | -0 | 18.3 | 17.1 | +1.21 [+1.09, +1.32] | +1.09 | yes | yes |

### roster seed 3

| Guardrail | Measure | Margin | Candidate | Today | Paired difference [95% CI] | Bound | Pass | Pass with the tournament's t |
|---|---|---|---|---|---|---|---|---|
| every case given a date inside the quarter | extra.casesScheduled | >= 2985 | 3000 | 3000 | (absolute limit on the mean) | 3000 | yes | yes |
| dates honoured (heard or desk order on the day) | extra.promisesHonouredInclDesk | -0.02 | 94.8% | 91.4% | +3.49 pts [+3.01 pts, +3.97 pts] | +3.01 pts | yes | yes |
| cases never acted on | extra.neverActedOn | +100 | 130 | 258 | -129 [-143, -114] | -114 | yes | yes |
| cases never heard | siddarth.neverHeard | +150 | 366 | 258 | +108 [+93.1, +122] | +122 | yes | yes |
| 4y+ heard at all (README) | readme.backlog4yHeardShare | -0.01 | 100.0% | 99.9% | +0.08 pts [-0.08 pts, +0.23 pts] | -0.08 pts | yes | yes |
| every 4y+ case heard at least once (README score) | extra.neverHeard4yPlus | +0.5 | 0.00 | 0.67 | -0.67 [-2.03, +0.70] | +0.70 | **NO** | no |
| 4y+ moved on | readme.backlog4ySubstantiveShare | -0.01 | 28.8% | 27.0% | +1.79 pts [+1.65 pts, +1.93 pts] | +1.65 pts | yes | yes |
| 4y+ still pending at the end | extra.pending4yPlusEnd | +5 | 913 | 921 | -8.23 [-9.11, -7.36] | -7.36 | yes | yes |
| disposals on the merits (verdict + settlement + compounded) | derived.meritsDisposals | -5 | 95.9 | 91.7 | +4.20 [+2.92, +5.48] | +2.92 | yes | yes |
| next-date excess over PUCAR's gap | caseStudy.nextDateExcessDays | +2 | 43.1 | 50.8 | -7.65 [-7.74, -7.55] | -7.55 | yes | yes |
| days that ran late | caseStudy.overrunDays | +2 | 20.8 | 23.1 | -2.23 [-3.43, -1.04] | -1.04 | yes | yes |
| court time used | caseStudy.utilisation | -0.05 | 90.3% | 91.2% | -0.82 pts [-1.10 pts, -0.54 pts] | -1.10 pts | yes | yes |
| reach rate | readme.reachRate | -0.01 | 95.2% | 91.4% | +3.81 pts [+3.34 pts, +4.28 pts] | +3.34 pts | yes | yes |
| substantiveness | readme.substantiveness | -0.01 | 32.3% | 30.6% | +1.75 pts [+1.59 pts, +1.91 pts] | +1.59 pts | yes | yes |
| trips per useful hearing | extra.tripsPerSubstantive | +0.25 | 10.7 | 11.9 | -1.26 [-1.35, -1.17] | -1.17 | yes | yes |
| wasted listings | siddarth.wastedListings | +0.01 | 69.3% | 72.1% | -2.83 pts [-3.05 pts, -2.61 pts] | -2.61 pts | yes | yes |
| minutes waited | extra.minutesWaited | +5 | 143 | 154 | -10.6 [-11.7, -9.56] | -9.56 | yes | yes |
| load balance across days | siddarth.loadBalanceCv | +0.05 | 0.14 | 0.13 | +0.01 [+0.01, +0.01] | +0.01 | yes | yes |
| useful hearings a day at least today's | extra.substantivePerDay | -0 | 17.9 | 16.8 | +1.18 [+1.04, +1.31] | +1.04 | yes | yes |

### roster seed 4

| Guardrail | Measure | Margin | Candidate | Today | Paired difference [95% CI] | Bound | Pass | Pass with the tournament's t |
|---|---|---|---|---|---|---|---|---|
| every case given a date inside the quarter | extra.casesScheduled | >= 2985 | 3000 | 3000 | (absolute limit on the mean) | 3000 | yes | yes |
| dates honoured (heard or desk order on the day) | extra.promisesHonouredInclDesk | -0.02 | 95.1% | 91.9% | +3.17 pts [+2.84 pts, +3.51 pts] | +2.84 pts | yes | yes |
| cases never acted on | extra.neverActedOn | +100 | 123 | 242 | -119 [-128, -110] | -110 | yes | yes |
| cases never heard | siddarth.neverHeard | +150 | 370 | 242 | +128 [+118, +139] | +139 | yes | yes |
| 4y+ heard at all (README) | readme.backlog4yHeardShare | -0.01 | 100.0% | 99.9% | +0.09 pts [-0.09 pts, +0.26 pts] | -0.09 pts | yes | yes |
| every 4y+ case heard at least once (README score) | extra.neverHeard4yPlus | +0.5 | 0.00 | 0.80 | -0.80 [-2.44, +0.84] | +0.84 | **NO** | no |
| 4y+ moved on | readme.backlog4ySubstantiveShare | -0.01 | 29.7% | 27.8% | +1.96 pts [+1.77 pts, +2.14 pts] | +1.77 pts | yes | yes |
| 4y+ still pending at the end | extra.pending4yPlusEnd | +5 | 939 | 949 | -9.77 [-11.0, -8.58] | -8.58 | yes | yes |
| disposals on the merits (verdict + settlement + compounded) | derived.meritsDisposals | -5 | 86.6 | 82.9 | +3.63 [+2.50, +4.76] | +2.50 | yes | yes |
| next-date excess over PUCAR's gap | caseStudy.nextDateExcessDays | +2 | 42.4 | 50.5 | -8.02 [-8.14, -7.90] | -7.90 | yes | yes |
| days that ran late | caseStudy.overrunDays | +2 | 20.8 | 22.1 | -1.23 [-2.14, -0.33] | -0.33 | yes | yes |
| court time used | caseStudy.utilisation | -0.05 | 90.3% | 90.7% | -0.39 pts [-0.72 pts, -0.07 pts] | -0.72 pts | yes | yes |
| reach rate | readme.reachRate | -0.01 | 95.4% | 91.9% | +3.47 pts [+3.15 pts, +3.80 pts] | +3.15 pts | yes | yes |
| substantiveness | readme.substantiveness | -0.01 | 33.7% | 31.9% | +1.72 pts [+1.55 pts, +1.89 pts] | +1.55 pts | yes | yes |
| trips per useful hearing | extra.tripsPerSubstantive | +0.25 | 10.3 | 11.4 | -1.13 [-1.18, -1.07] | -1.07 | yes | yes |
| wasted listings | siddarth.wastedListings | +0.01 | 67.9% | 70.6% | -2.75 pts [-2.90 pts, -2.60 pts] | -2.60 pts | yes | yes |
| minutes waited | extra.minutesWaited | +5 | 142 | 152 | -10.3 [-11.7, -8.97] | -8.97 | yes | yes |
| load balance across days | siddarth.loadBalanceCv | +0.05 | 0.15 | 0.14 | +0.01 [+0.00, +0.01] | +0.01 | yes | yes |
| useful hearings a day at least today's | extra.substantivePerDay | -0 | 18.8 | 17.6 | +1.17 [+1.07, +1.27] | +1.07 | yes | yes |

### roster seed 5

| Guardrail | Measure | Margin | Candidate | Today | Paired difference [95% CI] | Bound | Pass | Pass with the tournament's t |
|---|---|---|---|---|---|---|---|---|
| every case given a date inside the quarter | extra.casesScheduled | >= 2985 | 3000 | 3000 | (absolute limit on the mean) | 3000 | yes | yes |
| dates honoured (heard or desk order on the day) | extra.promisesHonouredInclDesk | -0.02 | 94.4% | 90.8% | +3.63 pts [+3.18 pts, +4.08 pts] | +3.18 pts | yes | yes |
| cases never acted on | extra.neverActedOn | +100 | 136 | 276 | -140 [-153, -127] | -127 | yes | yes |
| cases never heard | siddarth.neverHeard | +150 | 372 | 276 | +96.6 [+83.9, +109] | +109 | yes | yes |
| 4y+ heard at all (README) | readme.backlog4yHeardShare | -0.01 | 100.0% | 99.9% | +0.09 pts [-0.08 pts, +0.26 pts] | -0.08 pts | yes | yes |
| every 4y+ case heard at least once (README score) | extra.neverHeard4yPlus | +0.5 | 0.00 | 0.87 | -0.87 [-2.43, +0.70] | +0.70 | **NO** | no |
| 4y+ moved on | readme.backlog4ySubstantiveShare | -0.01 | 30.8% | 29.2% | +1.64 pts [+1.45 pts, +1.83 pts] | +1.45 pts | yes | yes |
| 4y+ still pending at the end | extra.pending4yPlusEnd | +5 | 953 | 962 | -9.33 [-10.8, -7.91] | -7.91 | yes | yes |
| disposals on the merits (verdict + settlement + compounded) | derived.meritsDisposals | -5 | 91.7 | 87.2 | +4.50 [+3.16, +5.84] | +3.16 | yes | yes |
| next-date excess over PUCAR's gap | caseStudy.nextDateExcessDays | +2 | 43.2 | 50.6 | -7.33 [-7.43, -7.24] | -7.24 | yes | yes |
| days that ran late | caseStudy.overrunDays | +2 | 21.8 | 23.6 | -1.73 [-2.77, -0.70] | -0.70 | yes | yes |
| court time used | caseStudy.utilisation | -0.05 | 90.7% | 91.4% | -0.69 pts [-0.98 pts, -0.40 pts] | -0.98 pts | yes | yes |
| reach rate | readme.reachRate | -0.01 | 94.9% | 90.8% | +4.12 pts [+3.69 pts, +4.56 pts] | +3.69 pts | yes | yes |
| substantiveness | readme.substantiveness | -0.01 | 33.9% | 32.1% | +1.77 pts [+1.62 pts, +1.92 pts] | +1.62 pts | yes | yes |
| trips per useful hearing | extra.tripsPerSubstantive | +0.25 | 10.2 | 11.5 | -1.23 [-1.29, -1.16] | -1.16 | yes | yes |
| wasted listings | siddarth.wastedListings | +0.01 | 67.8% | 70.9% | -3.01 pts [-3.19 pts, -2.82 pts] | -2.82 pts | yes | yes |
| minutes waited | extra.minutesWaited | +5 | 143 | 154 | -11.3 [-12.4, -10.2] | -10.2 | yes | yes |
| load balance across days | siddarth.loadBalanceCv | +0.05 | 0.14 | 0.13 | +0.01 [+0.01, +0.01] | +0.01 | yes | yes |
| useful hearings a day at least today's | extra.substantivePerDay | -0 | 18.8 | 17.5 | +1.31 [+1.20, +1.43] | +1.20 | yes | yes |

