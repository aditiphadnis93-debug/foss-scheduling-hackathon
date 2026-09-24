# Review lens: statistics and selection process (tournament.ts)

Reviewer data: out/tournament/old-rule/runs.json (6,714 runs, full measures), the stage2b rows now being appended to
candidates.jsonl by the 14:05 resume, and the live table (localhost:8799, view 1-6). Scripts used: /tmp/review/_an.py.
"Today" = status_quo_60. All numbers are on synthetic data, seeds 1-6 unless stated.

## 1. Verdict

The 10-guardrail rule plus "maximise useful hearings per day" is not yet trustworthy, for statistical reasons as much as
policy ones:

- Every guardrail is a point comparison of two 6-seed means with a tolerance that sits well inside the seed noise.
  A pass or fail on seeds 1-6 is close to a coin toss for any candidate near the boundary. And the objective
  (useful/day) trades against the guardrails, so the argmax lands on exactly those boundary candidates.
- The "paired / common random numbers" claim does not hold in practice. Candidate and today's per-seed values are
  essentially uncorrelated, so pairing buys nothing.
- The archive mixes code versions: today's way as the tournament scored it is not today's way as the live table shows it.
- Guardrails (a) and (b) are the same number.
- The tie-break is dead code, and it is not "paired wins".
- The (c) relaxation is a data-dependent threshold, so (c) is not really a guardrail.
- Winner's curse on the objective itself is negligible. Winner's curse on the constraints is the real risk.

## 2. Defects, with evidence

D1. The CRN is nominal. Median per-seed correlation between a candidate and today (720 genomes, seeds 1-6):
useful/day 0.08, held on promised -0.13, disposals 0.16, 4y+ substantive -0.19, overrun 0.08, trips 0.02, wasted
0.04, never acted 0.31. The paired-difference SD is larger than either series' own SD (disposals: paired SD 9.65,
today's SD 7.9). Same seeds do not mean same random draws: policies consume the RNG stream differently.
(tournament.ts:3 and :640 claim "common random numbers".) Consequence: all comparisons have unpaired variance.

D2. The tolerances are far below the noise. The table gives the median paired SD (candidate minus today), then the
95% half-width at n = 6, 10 and 20 seeds, then the tolerance in code (tournament.ts:308-320).

| Guardrail | Paired SD | 95% half-width n=6 | n=10 | n=20 | Tolerance in code |
|---|---|---|---|---|---|
| 4y+ substantive share | 0.019 | 0.020 | 0.014 | 0.009 | 0.005 |
| Disposals | 9.65 | 10.1 | 6.9 | 4.5 | 2 |
| Overrun days | 3.56 | 3.7 | 2.5 | 1.7 | 1 |
| Held on promised (a) = (b) | 0.026 | 0.028 | 0.019 | 0.012 | 0.01 |
| Trips per useful | 0.25 | 0.26 | 0.18 | 0.12 | 0.1 |
| Wasted listings | 0.009 | 0.0095 | 0.0065 | 0.004 | 0.005 |
| Next-date excess | 0.42 | 0.44 | 0.30 | 0.20 | 1 (fine) |
| Never acted on | 69 | 72 | 49 | 32 | absolute 600 |

What this means: take a candidate truly 2 points worse than today on promised dates. It passes the 6-seed test (a)
with probability about 18%. Among roughly 1,100 genomes, many pass by luck, and max-useful selects them.

Empirical flips: of the 30 candidates that met the original 7 on seeds 1-6 and were re-run, 3 broke on the fresh seeds
7-20 (all on overrun). Under the amended hard set, only 2 were re-run, too few to say.

D3. (a) and (b) are identical. siddarth.heldOnPromisedDate == caseStudy.heldAsScheduledAllDue in 6,714 of 6,714
runs. The amendment adds two guardrails, not three, and double-weights one of them in cv (tournament.ts:318-319).

D4. Code-version mismatch. On seeds 1-6, the live table's "Today's way" (cur:status_quo_60) gives useful 16.75,
disposals 94.0, trips 11.97, overrun 21.8, 4y+ substantive 0.278, wasted 0.721. The tournament's archived
status_quo_60 on the same seeds gives 17.25, 99.8, 11.64, 22.8, 0.287, 0.713. Held (0.913) and never acted on (262)
match.

- The disposals gap (5.8) is about 3x the disposals tolerance.
- metrics.ts changed at 13:24:33, tournament-worker.ts at 13:12:10, and genome.ts/presets.ts at 13:59:05. The archive
  was produced from 13:04 on (out/tournament created 13:03:53).
- The 14:05 resume (--resume old-rule/runs.json) spawns workers on the current code. But evalOn skips any seed
  already present, so references and all 1,073 archived candidates keep their old-code numbers, and new children are
  judged against an old-code status quo.
- ADP's runs come from a separate file (/tmp/zoo-adp/adp-runs.json) whose code version is not recorded.
- The live table then judges "broken" against cur: numbers while showing tournament rows from the archive.

The brief's "today's 16.8 useful/day" is the cur: figure, whereas the tournament's guardrails used 17.25.

D5. Stage-3 entry does not follow the pre-registered rule. top30 = selectN on constrained domination
(tournament.ts:594, :348-351).

- When nothing is fully feasible (true now: 0 of 740), dominance reduces to "smaller cv wins". Search and stage-3
  entry are then a scalar minimisation of an arbitrarily weighted sum: never-acted/200, disposals/20, 4y+/0.05. The
  objectives, including useful/day, are ignored.
- The top 30 by cv include hard-infeasible genomes ahead of the hard-feasible ones. g1158 (breaks trips) is rank 1.
  The best hard-feasible, g798 (18.82/day), is only rank 10.
- preRegistered (tournament.ts:441-449) wants hard-first, then max useful. The two disagree.
- When fronts are large (the original rule), the 30 are chosen by crowding distance, which favours extremes on 8
  objectives. That is not the selection rule either.

D6. The (c) relaxation is post hoc (tournament.ts:446): level = max(600, 1.05 x min never-acted among hard-feasible).
The threshold is set by the most favourable noisy mean in whatever set is being ranked (top 30 on seeds 1-20, then
top 8 on seeds 21-30), so it moves with the data it judges. At seeds 1-6 it gives 1,424, which admits g979 (1,356),
g798 (1,408) and g860 (1,411) but not g1110 (1,426). A 5% band is about 1.4 half-widths at 10 seeds: arbitrary.

D7. The tie-break is dead and mislabelled. `b.useful - a.useful || b.best - a.best` (tournament.ts:448, :451): a float
difference is never exactly 0, so bestCount never decides. bestCount counts measures within 0.5% of the field's
best mean. It is not paired wins across seeds.

D8. The best-baseline comparator is a minimum of 8 noisy means (tournament.ts:305-306), set by baselines that
themselves break other guardrails (e.g. bin_packing's trips 8.9). Today's way itself fails trips and wasted. This
alone excludes g1139 (21.51/day, held 0.958, disposals 119.5) and g1151 (19.84/day). Both are non-inferior to today on
every other guardrail by a paired 95% bound.

D8b. Are per-measure best-of-N comparators sound? No, but not mainly because of noise. Here is what the data show.

- The order-statistic bias is small in this case. bin_packing is the minimum on both measures in every seed set, by a
  wide margin, and the bar is stable:

| Seeds | bin_packing trips | Runner-up trips | bin_packing wasted | Runner-up wasted |
|---|---|---|---|---|
| 1-4 | 8.69 | 10.47 | 0.623 | 0.677 |
| 1-6 | 8.73 | 10.55 | 0.625 | 0.679 |
| 7-20 | 8.79 | 10.64 | 0.628 | 0.680 |
| 21-30 | 8.77 | 10.74 | 0.625 | 0.677 |

  Runner-up trips were dimakar, then sehgal on 21-30; runner-up wasted was sehgal throughout. With margins that wide,
  the min over 8 does not pick up much noise, and the bar will not flip on validation.
- The real defect is structural. The comparator is a chimera: the per-measure minimum over rivals assembles an ideal
  point no admissible policy reaches. Its trips and wasted figures come from bin_packing, which keeps 7% of promised
  dates (held 0.072) and breaks the 4y+ and disposals guardrails. So the bar rewards a candidate for matching a policy
  the rule itself would reject, on exactly the two measures where abandoning promises is cheap. It also rules out
  today's way (11.64 trips) and every realistic redesign.
- In general, "at least as good as the best of N on each measure separately" is a multiple-comparison max. Its bias
  grows with N and with how close the rivals are, and it changes whenever a baseline is added or removed. That is an
  unstable, gameable contract.
- What to use instead:
  (i) Non-inferiority against today (status_quo_60), paired, with a margin. This is P2.
  (ii) If "beat the best rival" is wanted, compare with one named admissible rival, fixed in advance: the best
  baseline that itself passes the other guardrails, which on this data is today's way. Use the same paired bound.
  (iii) Or report the per-measure best rival as context in the table, not as a guardrail.

D9. Validation seeds 21-30 are no longer fresh for the rule. The original run completed stage 4 at about 13:30:
winner g921, 8 finalists plus every reference on seeds 21-30. The amendment text (tournament.ts:645) says it was made
"before validation seeds 21-30 ... were looked at for this rule". That is literally true, but those seeds had already
been used for this candidate pool. The criteria are still being set now (--no-finals: "the finals run later under
the final criteria"). Only seeds 31-60 are untouched. The grep found no code that runs them.

D10. Stage 3 reuses seeds 1-6 inside 1-20, so it is not an independent check. The fresh evidence is seeds 7-20.

Not a defect: winner's curse on useful/day is small. Across the 46 genomes re-run, the correlation between 1-6 and
7-20 means is 1.00 and the mean change is +0.05. g921 went 25.92 (1-6), 25.90 (7-20), 25.92 (21-30). Between-candidate
gaps (several hearings a day) dwarf the standard error (about 0.15). The risk sits in the constraints, not the
objective.

## 3. Corrected procedure (proposal)

P0. One code version. Before the finals, re-run every reference, every finalist and ADP on the current commit. Record
the git hash or file hashes in winner.json. Assert that status_quo_60 on seeds 1-3 reproduces the table's cur: values
exactly.

P1. Drop the duplicate: keep siddarth.heldOnPromisedDate only (9 distinct guardrails).

P2. Guardrails as paired non-inferiority tests against today (status_quo_60), not against the best of 8 baselines. A
candidate passes a guardrail when the lower bound of the two-sided 95% t-interval of the per-seed paired difference
(candidate minus today, signed so that higher is better) is at least -margin. Margins are what a judge would call
"no worse":

| Measure | Margin |
|---|---|
| readme.backlog4yHeardShare | 0.01 |
| readme.backlog4ySubstantiveShare | 0.01 |
| extra.disposed | 5 (about 5% of today's ~100) |
| caseStudy.nextDateExcessDays | 2 days |
| caseStudy.overrunDays | 2 days |
| siddarth.heldOnPromisedDate | 0.02 |
| extra.tripsPerSubstantive | 0.25 vs today |
| siddarth.wastedListings | 0.01 vs today |
| extra.neverActedOn | upper bound of (candidate minus today) at most +338, which equals the 600 cap at today's 262; the owner may choose a tighter figure |

- Because the claim is "all guardrails hold", this is an intersection-union test: each at 95% gives 95% for the
  joint claim, so no Bonferroni is needed.
- Seeds 1-6 are for search only. Pass or fail is decided on seeds 7-20 (stage 3, fresh), again on 21-30 (stage 4),
  and reported on 31-60.

P3. Search and stage-3 entry use the same rule as the final pick. When nothing is feasible, rank by the number of
guardrails failed at the bound, then by the normalised worst shortfall (shortfall divided by margin), then useful/day.
Do not use a weighted cv sum. Stage 3 takes the top 30 by that order, plus the best 5 of the useful-versus-never-acted
frontier at five never-acted bands, so constraint-safe candidates cannot be crowded out.

P4. No data-dependent threshold. Delete the 1.05 x min relaxation. If nothing meets (c), say so, and pick from the
frontier with a rule fixed now: the most useful/day among candidates passing the other eight, subject to never acted
at most N, where the owner fixes N in writing before stage 4.

P5. Tie-break. Candidates whose useful/day paired 95% interval against the leader contains 0 count as tied (at 10
seeds that is about ±0.3/day). Among tied candidates, prefer fewer never acted on, then more held on promised, then
more paired wins across seeds 21-30 on useful/day.

P6. Finalists. Carry 8-12 to seeds 21-30: the top 6 by P3, plus the frontier points. Choose the winner on 21-30 by
P2 to P5. Report the winner only from seeds 31-60 (n=30, half-width about 0.37 paired SD), with the paired mean and
95% interval for every measure against today and against the runner-up. State in advance that if a guardrail fails at
the bound on 31-60, that is reported as a failure, and the pick is not changed.

P7. Honest amendment note (suggested wording): "The selection rule was amended at 14:05 and finalised at [time], after
seeing tuning seeds 1-6 for about 1,100 candidates and, for the eight finalists of the original rule and every
reference, validation seeds 21-30. The amended rule was chosen because the original winner kept 45% of promised dates
against today's 91%. Seeds 31-60 had not been run by any code at the time the rule was fixed; the headline numbers
come only from them." Also state that (a) and (b) were found to be one measure, and that references were re-run on one
code version.

## 4. Feasibility of P2 on seeds 1-6 (n=6, so the bounds are wide)

- 0 of 740 floor-honouring genomes pass all nine guardrails.
- 29 pass all but never-acted-on. Never acted on binds everywhere: the best is 982 (g1144, 16.75/day), against
  today's 262.
- Frontier among the 29 (best useful/day at each never-acted ceiling):

| Never acted on at most | Best useful/day | Candidate |
|---|---|---|
| 1,100 | 16.75 | g1144 |
| 1,200 | 19.24 | g1230 (1,116) |
| 1,300 | 19.84 | g1151 (1,212) |
| 1,500 | 21.51 | g1139 (1,414) |

- Best overall: g1139 at 21.51/day (lower bound of gain +3.9), held 0.958, disposals 119.5, 4y+ substantive 0.371,
  overrun 12.5, trips 9.00, wasted 0.645, never acted on 1,414. Today: 16.75 (cur:) or 17.25 (archived), held 0.913,
  never acted on 262.
- Under the current rule, g869 fails held on promised at the bound (-0.022 against -0.02). g798, g860 and g979 pass
  everything except never acted on.

Bottom line: the constraint that binds is never acted on. No genome gets within about 700 of today, so a hard 600
cap has no feasible point. Either a new gene closes the gap (rotationAll is being searched now), or the owner fixes N
in writing before stage 4, with the frontier above as the evidence.
