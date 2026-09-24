# benchtime

benchtime plans one judge's daily causelist and next dates, and shows the judge what each choice gains and
costs before they sign. The tool only advises. The judge signs every list and every order. It runs on PUCAR's
synthetic sample court: the seed-42 roster of 3,000 Section 138 cases in Kollam, from 1 October to 15 December
2026.

What we found:

- The recommended list beats today's way on 18 of 19 guarded measures on 30 simulated quarters that the search
  never saw. Over a year, if a year behaves like this quarter, one court would hold about 260 more useful
  hearings. It would also finish about 38 more cases, break about 370 fewer dates and save about 5,300 journeys
  to court.
- Bigger gains exist, and we measured their price. Focusing the docket on fewer cases this quarter gives 35%
  more useful hearings and 41% more cases decided on the merits, but 1,190 cases get no date before 15
  December. The judge chooses.
- About 70% of listings fail for reasons a list cannot fix. Process that has not come back causes 36% of
  failed hearings in PUCAR's data, so e-post tracking in DRISTI is the next large gain.

How we got there: we wrote every scheduling idea (today's way, the three judges, standard rules and our own)
as settings of one planner with about 40 genes. An evolutionary search (NSGA-II) tried about 2,600
combinations in a court simulator calibrated to PUCAR's tables. A rule fixed in advance picked the winner: no
worse than today's way on 19 guardrails, then the most useful hearings a day. The winner is g237, registered as
`benchtime_final`. It ranks the day's cases by one priority number, keeps a standby list, sends matters whose
summons is not back to a process desk, and sets next dates at PUCAR's procedural gap.

## Headline numbers

These numbers come from 30 held-out seeds (31 to 60). Nothing ran on those seeds before the pick. Today's way
lists every due case and sets a flat 60-day gap. Each difference compares the two policies seed by seed and
has a 95% interval (`out/HEADLINE.md`).

| Measure | benchtime_final | Today's way | Difference [95% CI] |
|---|---|---|---|
| Useful hearings a day | 18.2 | 17.1 | +1.08 [+0.98, +1.18] |
| Cases decided on the merits | 89.3 | 84.9 | +4.40 [+3.26, +5.54] |
| All headline disposals | 103 | 94.7 | +8.10 [+6.90, +9.30] |
| Dates honoured (heard or desk order) | 94.9% | 92.0% | +2.93 pts [+2.54, +3.32] |
| Dates broken or never given | 166 | 245 | -79.3 [-91.0, -67.6] |
| Trips per useful hearing | 10.5 | 11.7 | -1.22 [-1.28, -1.16] |
| Minutes waited per person heard | 141 | 155 | -14.5 [-15.6, -13.4] |
| Cases never heard (a loss) | 380 | 240 | +140 [+128, +151] |

The winner loses on cases never heard, and fails that one guardrail narrowly. `SUBMISSION.md` section 5 lists
every loss and explains how the selection rule changed after four adversarial reviews.

## How to run it

```bash
bun install
bunx tsc --noEmit
bun test
bun run src/cli.ts arena --seeds 31-33 --policies status_quo_60,benchtime_final
bun run src/cli.ts day --date 2026-10-06 --policy benchtime_final
bun run src/serve.ts                        # The engine API listens on port 8791.
bun run web-concepts/causelist/serve.ts     # Run this in a second terminal. The console opens on port 8796.
```

The tool needs Bun and TypeScript and has zero runtime dependencies.

## Folders and outputs

| Path | What it holds |
|---|---|
| `src/world/` | The court simulator, calibrated to PUCAR's tables |
| `src/planner/` | The planners. `zoo/` holds the genome planner, the winner and the judges' rule sets (`zoo/rules.ts`). |
| `src/eval/` | Every scorecard: the repo README's, the case study's and Siddarth's six |
| `src/api/`, `src/serve.ts` | The JSON HTTP API |
| `src/cli.ts` | The CLI (`arena`, `day`, `calibrate`, `profile`) |
| `web-concepts/causelist/` | The judge's console |
| `data/` | PUCAR's seed-42 roster, and roster seeds 1 to 5 that test the winner on other courts |
| `scripts/` | The tournament and the held-out experiments |
| `test/` | 331 tests |
| `out/HEADLINE.md` | The winner against today's way on the held-out seeds, and the judge's dial |
| `out/heldout.md` | Every measure for every policy on the held-out seeds |
| `out/ablation.md`, `out/robustness.md` | Each component switched off, and each assumption changed |
| `out/styles.md`, `out/settlement.md` | The three judges' rules on the winner, and settlement days as an add-on |
| `out/aims.json` | The judge's aims, measured on tuning seeds 1 to 6 |
| `out/tournament/` | The selection rule (`criteria.json`), the winner (`winner.json`) and the search (`summary.md`) |
| `out/calibration-fit.md` | How closely the simulator matches PUCAR's tables |
| `out/proposed_schedule.csv` | A day's list in PUCAR's causelist columns plus call time, minutes, P(substantive) and reasons |

## Read next

- [SUBMISSION.md](SUBMISSION.md) describes the approach, the results, the losses and how to integrate.
- [INTEGRATION.md](INTEGRATION.md) describes the court's day with the tool, the data contract and DRISTI 2.0.
- [DESIGN.md](DESIGN.md) is the design contract for the simulator, the planners and the scorecards.
