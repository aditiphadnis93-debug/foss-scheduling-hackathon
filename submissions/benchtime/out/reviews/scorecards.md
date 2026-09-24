# Evaluators' scorecards against the tournament's selection

Lens: every criterion PUCAR will judge on, whether the selection guards it, and where the winner could lose
without the selection noticing. Data: live table `table.json?view=1-6&all=1`, seeds 1-6 (re-fetched 14:10, 834
tournament rows). "Today" = `status_quo_60`. Rivals = the 8 baselines (status_quo_60, status_quo_ref, fifo_capped,
bin_packing, oldest_first, sehgal, dimakar, joshi) plus our overnight `benchtime`.
Selection code: `scripts/tournament.ts` violation() lines 300-326, objectives() 328-333, preRegistered() 424-452.

Note on sources: the slides PDF in `submission/` is a copy of the case study; it has no text for "slide 06". Siddarth's
six are taken from the quotes in `src/eval/metrics.ts` (SID fields, lines 494-509) and `/tmp/briefs/eval.txt`.

## 1. Verdict

The 10-guardrail rule plus "maximise useful hearings/day" is still wrong in four ways.
- It guards 9 of about 30 scorecard readings. Utilisation (a README score), reach rate, substantiveness, load
  balance, minutes waited, the case study's 5+ band and the all-cases predictability reading are not guarded at all.
- It measures trips and wasted listings against a composite "best baseline". That is bin_packing, which keeps 7%
  of promised dates. No single rival reaches that point.
- Guardrail (c) at 600 is not jointly feasible with (a) and (b) anywhere in the archive. The relaxation in
  preRegistered() (lines 440-447) then picks whichever candidate covers the most cases, even if it loses to today on
  the objective itself. On the 14:04 snapshot that was g533: 16.08 useful hearings a day against today's 16.75, with
  1,227 never acted on.
- The objective counts a 5-minute appearance the same as a 60-minute argument. g869 does 19.3 useful hearings a day
  in 275 substantive minutes, against today's 16.8 in 309 minutes (14.3 against 18.4 minutes per useful hearing).
  It leaves 87 minutes a day idle while 1,356 cases never get a turn.

## 2. The scorecard table

Legend for cover: H = hard guardrail, O = NSGA objective only (does not decide the pick), T = tie-break only
(counted in bestCount), no = not in the selection. The final pick is preRegistered(): guardrails, then useful/day, then
bestCount. So O on its own has no effect on which candidate wins.

| # | Criterion (source) | Measure key(s) | Cover | Today | g869 | g798 | g814 (covers most while meeting all else) | Winner loses to |
|---|---|---|---|---|---|---|---|---|
| R1 | Utilisation (README) / Judge time used (Siddarth) | readme.utilisation = siddarth.judgeTimeUsed | T | 0.916 | 0.799 | 0.761 | 0.860 | **today, status_quo_ref (1.002)** |
| C1a | Utilisation, well packed (case study) | caseStudy.utilisation, caseStudy.idleMinutesShare | T | 0.905 / 9.5% idle | 0.793 / 20.7% | 0.753 / 24.7% | 0.851 / 14.9% | **today, status_quo_ref** |
| C1b | Not overbooked (case study) | caseStudy.overrunDays (extra.overrunMinutes) | H vs today +1 | 21.8 (241 min) | 11.2 (123) | 9.5 (161) | 16.2 | **sehgal 0.5, benchtime 0.3, bin_packing 1.5, fifo 3.7, joshi 8.5, oldest_first 9.2** |
| R2 | Reach rate (README) | readme.reachRate | T | 0.913 | 0.960 | 0.977 | 0.943 | **bin_packing, sehgal, benchtime 0.999, fifo 0.993, joshi 0.969** |
| R3/C3 | Substantiveness (README, case study) | readme.substantiveness | T | 0.306 | 0.391 | 0.396 | 0.353 | **benchtime 0.417** |
| R4 | 4y+ heard at all (README backlog) | readme.backlog4yHeardShare, extra.neverHeard4yPlus | H vs today | 1.000 / 0 | 1.000 / 0 | 1.000 / 0 | 1.000 | nobody |
| C4a | Backlog moved on | readme.backlog4ySubstantiveShare, extra.disposed4yPlus | H / T | 0.278 / 67.5 | 0.386 / 117 | 0.381 / 125 | 0.348 | nobody |
| C4b | Fewer cases in the 5+ band (case study) | caseStudy.ageBandsEnd.5+ (**absent from the tournament**), proxy extra.pending4yPlusEnd | no | 967 (4y+) | 889 | 889 | 927 | nobody on the 4y+ proxy. 5+ is unmeasured |
| R5 | Predictability gap (README, literal) | readme.predictabilityGapDays | T | 0.00 d | 0.03 | 0.05 | 1.00 | today, oldest_first, joshi (0.00): trivial |
| R5' | Same, counting cases never heard | extra.predictabilityGapFromStartDays | no | 40.7 d | 53.5 | 53.8 | 45.5 | **today, joshi 39.8, ref 46.0, dimakar 47.8, sehgal 49.7, bin 50.2, fifo 52.0** |
| C2 | Held when listed (case study) | caseStudy.heldAsScheduledAllDue (and heldAsScheduled) | H (b) | 0.913 | 0.941 | 0.975 | 0.637 | g869: joshi 0.969, dimakar 0.962, oldest_first 0.952 |
| S4 | Held on the promised date (Siddarth) | siddarth.heldOnPromisedDate | H (a), O | 0.913 | 0.941 | 0.975 | 0.637 | as C2 |
| C5a | Next date near the procedural minimum (case study, ask 5) | caseStudy.nextDateExcessDays | H vs today +1 | 50.8 d | 17.2 | 22.5 | 37.7 | g798 loses to status_quo_ref 20.5 |
| C5b | Next dates the case was not ready for | caseStudy.wastedRelistShare | T | 0.347 | 0.251 | 0.293 | 0.326 | nobody |
| S1 | Throughput (Siddarth) | siddarth.throughputPerMonth, extra.disposed | H vs today -2, O | 37.6 / 94 | 52.2 / 130 | 55.3 / 138 | 44.2 / 110 | nobody (ref 116.7) |
| S3 | Wasted listings (Siddarth) | siddarth.wastedListings | H vs best baseline | 0.721 | 0.625 | 0.613 | 0.667 | **benchtime 0.584** (not in BASELINES) |
| S5a | Fairness: oldest pending (Siddarth) | siddarth.oldestPendingAgeYears, p95, extra.oldest100PendingMeanAgeYears | T | 10.1 / 9.34 / 9.77 | 10.1 / 9.25 / 9.72 | 10.1 / 9.30 / 9.74 | n/a | nobody. The max is 10.1 for every policy, so it tells policies apart on nothing |
| S5b | Fairness: who is never heard (Siddarth) | siddarth.neverHeard, extra.neverActedOn | H (c) ≤600, O | 262 | **1,356** | **1,408** | 468 | **every rival**: today 262, joshi 436, ref 761, dimakar 776, sehgal 996, bin 1,005, fifo 1,126, oldest 1,182, benchtime 1,227 |
| S6 | Load balance (Siddarth) | siddarth.loadBalanceCv | T | 0.143 | 0.218 | 0.320 | 0.200 | **today, ref 0.082** (g798 also loses to fifo, bin, sehgal, joshi) |
| A1 | Minimise trips (ask 1) | extra.tripsPerSubstantive, extra.wastedTripShare | H vs best baseline +0.1 | 11.97 / 0.697 | 8.99 / 0.606 | 8.49 / 0.585 | 10.24 | g869: benchtime 8.77 |
| A2 | Causelist capped to what can be heard, more heard and substantive (ask 2) | extra.substantivePerDay (+ reach, overrun, idle) | maximised | 16.75 | 19.31 | 18.82 | 18.28 | nobody on the count. On substantive minutes a day (derived) it loses to today: 275 against 309 |
| A3 | Real appointment (ask 3) | extra.minutesWaited | T | 153 min | 14.4 | 14.7 | 38.2 | **sehgal 0.8, benchtime 4.3** |
| A4 | Raise substantive rates, do not list the unready (ask 4) | readme.substantiveness, caseStudy.wastedRelistShare | T | see R3, C5b | | | | benchtime on substantiveness |
| A6 | Configurable per judge, ageing floor not configurable (ask 6, template section 4 L2) | none. No run tests the winner with a judge's overlay | no | n/a | n/a | n/a | n/a | the joshi preset itself breaks the floor: 4y+ heard 0.670, 296 old cases never heard |
| A7/V | Visualise impact of overrides (ask 7, section 6.2, template section 5) | none (UI) | no | n/a | n/a | n/a | n/a | out of scope for selection. The UI must show the rows marked in bold |
| T5 | Template section 5 "vs the 60-day baseline" | all of the above against today | H partly | | | | | |

In bold: criteria where the winner can lose and the selection does not notice. Under today's rule the pick (g869 or
g798) loses to today's way on utilisation (-11.7 points), idle capacity (+11 points), load balance, all-cases
predictability (+13 days) and coverage (5.2x). It loses to a single named rival on reach rate, substantiveness,
overrun, wasted listings, trips (benchtime), minutes waited (sehgal, benchtime) and coverage. No rival dominates it
across the scorecard vector I checked. That vector covers utilisation, reach, substantiveness, 4y+ heard, gap from
start, overrun, idle, promises kept, pending 4y+, next-date excess, disposals, wasted listings, coverage, load, trips
and waiting. It is non-dominated, but it is not the best on every criterion.

## 3. Defects (with evidence)

1. **Coverage: the winner is last in the whole field.** g869 leaves 1,356 cases never acted on and g798 leaves
   1,408. That is worse than every rival, including plain bin packing (1,005) and our own overnight build (1,227).
   Cause: the objective and the next-date guardrail (≤ today + 1 day) reward depth. Over the horizon the court has
   about 2,500 reached slots for 3,000 cases, so short gaps concentrate on a subset. g869 reaches 49 rows a day but
   touches only 1,644 distinct cases.
2. **The utilisation score is unguarded while capacity sits idle.** g869's idle share is 20.7% against today's
   9.5%, about 87 minutes a day, while 1,356 cases get no hearing. Filling those minutes with first calls on
   untouched cases is the obvious lever between coverage and depth. Nothing in violation() pushes towards it.
3. **The objective favours short hearings.** Derived substantive minutes a day = utilisation x 420 - 2 x (reached -
   substantive). Today does 309, g869 275 and g798 262; g504 does 318 and g1173 309. So "19.3 useful hearings a day"
   partly comes from choosing 14-minute items over 18-minute ones. Disposals do rise (130 against 94), so this is not
   pure gaming. But a panel member who asks "is the bench doing more work?" gets the answer no.
4. **"Best baseline per measure" builds a composite of rivals.** bestTrips and bestWasted (lines 305-306) are both
   bin_packing (8.94 trips, 0.633 wasted). bin_packing keeps 7.2% of promised dates and leaves 1,005 cases never
   acted on. This bars points that beat every single rival. At the same time it misses our own benchtime (0.584
   wasted, 8.77 trips), because RIVALS is not part of BASELINES.
5. **The relaxation can pick a loser on the objective.** Nothing requires useful/day ≥ today. The relaxed level of
   max(600, min x 1.05) at lines 443-445 selected g533 on the 14:04 snapshot: 16.08 against today's 16.75.
6. **The case study's own backlog measure never reaches the tournament.** `scripts/tournament-worker.ts:40-44`
   flatten() keeps only numbers, so `caseStudy.ageBandsEnd.{3+,4+,5+}` (objects) are dropped. The case study asks
   literally about "the 5+ year buckets", and no candidate is checked on it.
7. **Two scorecard readings cannot tell policies apart.** siddarth.oldestPendingAgeYears is 10.1 for every policy.
   readme.predictabilityGapDays is about 0 for everyone and leaves never-heard cases out, so a policy that never
   schedules a case improves it. Use extra.predictabilityGapFromStartDays and extra.oldest100PendingMeanAgeYears as
   the guarded readings.
8. **Judge customisation is untested.** The tournament selects one fixed genome. The case study (ask 6) and the
   template (section 4, L2: "what changes when a judge overrides a rule") both expect overrides. Our joshi preset
   shows what an override can do: 4y+ heard 0.670 and 296 old cases never heard. That is exactly the "ageing
   cases getting deprioritised shouldn't be configurable" failure. No run checks the winner with the
   Sehgal/Dimakar/Joshi overlays against the ageing floor.
9. **Answer to the coordinator: g1173 is not a clean compromise.** It breaks more than the four guardrails reported.
   4y+ heard is 0.861 against 1.000, which is the README's own backlog measure and the case study's "not
   deprioritised" rule. Next-date excess is 58.3 days against today's 50.8. It also has disposals 94.8 against 94,
   4y+ moved 0.271 against 0.278, and pending 4y+ of 970 against 967. So it is no better than today on any ageing
   reading.

## 4. Comparators: which one is right for each measure

- **Today's way (status_quo_60), hard, with noise tolerance.** The case study and the template (section 5) frame
  everything against "the default 60-day gap" baseline. A district judge asks one question: "am I worse off
  anywhere than now?" Use this for every scorecard criterion where beating today is achievable. That includes trips
  and wasted listings: we beat today's 11.97 and 0.721 by a wide margin.
- **Each rival separately, never a per-measure composite.** Require that no single rival dominates the pick across
  the scorecard vector: at least as good on everything and better on something. This is what "better than bin
  packing" means to an evaluator. Keep "best or tied on N measures" as the tie-break, reported openly.
- **An absolute bar only where no rival sets a sensible one.** Coverage is the case. See the proposal below.

## 5. Proposed final criteria

Pick on tuning seeds, confirm on validation seeds 21-30. The tolerances are the existing noise tolerances.

Hard guardrails, versus today's way:
1. readme.backlog4yHeardShare ≥ SQ - 0.005 and extra.neverHeard4yPlus ≤ SQ + 5. Old cases are not deprioritised;
   this is the unchangeable rule.
2. readme.backlog4ySubstantiveShare ≥ SQ - 0.005, and extra.pending4yPlusEnd ≤ SQ. Add caseStudy.ageBandsEnd.5+ ≤
   SQ once flatten() keeps the bands.
3. extra.disposed ≥ SQ - 2 (Siddarth's throughput).
4. caseStudy.nextDateExcessDays ≤ SQ + 1 and caseStudy.wastedRelistShare ≤ SQ + 0.01 (both halves of next-date
   quality).
5. caseStudy.overrunDays ≤ SQ + 1.
6. siddarth.heldOnPromisedDate ≥ SQ - 0.01 and caseStudy.heldAsScheduledAllDue ≥ SQ - 0.01. A date fixed in the
   order sheet is kept.
7. readme.reachRate ≥ SQ - 0.005 and readme.substantiveness ≥ SQ - 0.005 (README scores; nearly free).
8. extra.substantivePerDay ≥ SQ. The objective must itself beat today's way, so no relaxation can pick a loser.
9. extra.minutesWaited ≤ SQ, extra.tripsPerSubstantive ≤ SQ and siddarth.wastedListings ≤ SQ. These replace the
   bin_packing composite.
10. Coverage: extra.neverActedOn ≤ 600 (under 2.3x today's 262, and within the range of the judges' presets:
    joshi 436, dimakar 776), or better. Never relax it automatically. If it is unmet, the frontier in section 6
    goes to the owner and the trade-off is stated in the submission.

Not dominated by any single rival (each baseline plus benchtime) on the vector in section 2.

Disclosed trade-offs, soft-bounded so they cannot collapse:
- readme.utilisation ≥ SQ - 0.05. Report it next to derived substantive minutes a day, because about 76 of today's
  385 minutes are two-minute failed calls.
- siddarth.loadBalanceCv ≤ SQ + 0.05.
- extra.predictabilityGapFromStartDays is reported, not guarded. It moves with coverage.

Maximise extra.substantivePerDay. Break ties by fewer extra.neverActedOn, then more extra.disposed, then bestCount.

Outside the tournament but required before submission: rerun the winner with each persona overlay (sehgal blocks,
dimakar clustering, joshi fresh-first) and show that guardrail 1 still holds. That is the evidence for ask 6.

## 6. Feasibility on seeds 1-6 (834 tournament rows)

- Guardrails 1-9, all against today: **15 candidates**. With coverage ≤ 600 added: **0**. With the utilisation and
  load soft bounds added: **0**.
- Among Tier 1-9 candidates, the fewest never acted on is 1,109 (g1158, 17.84 useful a day). The most useful is
  g1161 (19.52 a day at 1,414). g869 gives 19.31 at 1,356.
- **What binds is promises kept against coverage.** Of the 70 candidates with coverage ≤ 600, 68 break held on the
  promised date. The best of them:
  - g814 breaks only (6). It has 468 never acted on, 18.28 useful a day, 0.637 of promises kept, utilisation 0.860,
    disposals 110, 4y+ heard 1.000, next-date excess 37.7, trips 10.2, wasted 0.667 and cv 0.200.
  - g504 has 134 never acted on and 18.61 useful a day, but 4y+ heard 0.994 (6 more old cases never heard), 0.857 of
    promises kept, and it overran on 22.3 days.
- On the frontier (4y+, excess, overrun, reach and substantiveness held), the points run from 468 never acted on
  at 0.637 held, through 881 at 0.853 (g1184) and 1,091 at 0.899 (g1021), to 1,116 at 0.970 (g1208). Nothing below
  about 1,100 keeps today's 0.913.
- Today's way holds both, 262 and 0.913, by listing everyone. The price is 72% wasted listings and 12 trips per useful
  hearing. The honest statement is: in this genome space, beating today on coverage costs promised dates, and
  beating it on promised dates costs coverage.
- Two levers are unexplored: the idle 15-25% of the day spent on first calls for untouched cases, and the process
  desk. g869 uses 0 desk actions a day, yet a desk action counts as acting on a case at 0.5 minutes. These are
  where a candidate that meets everything would come from, not from relaxing the coverage limit.
