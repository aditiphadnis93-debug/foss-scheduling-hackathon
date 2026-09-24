# Criteria review, lens: Goodhart and loopholes

Data: `table.json?view=1-6&all=1` at 14:05 (655 rows, seeds 1-6). Code: `src/eval/metrics.ts`, `src/world/simulate.ts`, `scripts/tournament.ts`. Scripts: /tmp/review_gaming_*.py.
Today's way (status_quo_60): useful/day 16.8, held on promise 0.913, never acted on 262, disposals 94, 4y+ substantive 0.278, pending 4y+ at end 967, next-date excess 50.8 d, overrun days 21.8 of 51.

## 1. Verdict

The 10-guardrail rule is still wrong. It asks for a combination that is out of reach. It also rewards the loophole that produced g869 and g798.

Today's 91% is not a standard of predictability. It comes from a one-pass rotation: 60 listings a day for 51 days covers about 3,000 cases, so each case is listed once. 97.8% of today's next dates fall after 15 Dec (`extra.nextDatesBeyondHorizonShare` 0.978, next-date gap 68 d), so the only promises it ever faces are the first ones (`extra.firstPromiseKept` 0.913 = heldOnPromisedDate). A candidate that relists cases inside the quarter faces second promises that today never faces.

The search found the cheap way to match 91%: never give 40-47% of the docket a date inside the horizon. Those cases then drop out of both held-rate denominators. Guardrail (c) is the only guard that notices, and (c) can itself be met with desk actions that do nothing.

## 2. Defects (loopholes), with evidence

**L1. Censoring at the start: parked cases leave the promise measures. [exploited by every leader]**
- How it works: `initialDates` is free. `simulate.ts` only checks that the date is a working day on or after 1 Oct. A case given a first date after 15 Dec produces no row, and both held rates count rows only (`metrics.ts:255-259, 369-381`).
- Evidence: all 7 candidates that meet the 9 guardrails other than (c) have `extra.casesScheduled` between 1,490 and 1,870, so 1,129 to 1,408 cases are parked.
  - g869: 1,658 scheduled, 1,341 parked, never acted on 1,356. Almost every case "never acted on" is a case that was never given a date.
  - Across the 640 tournament rows, corr(heldOnPromisedDate, casesScheduled) = -0.59.
  - All 35 rows with neverActedOn <= 600 schedule all 3,000 cases, and their held rate is at most 0.70.
- Corrected reading (a parked case counts as a promise not kept):

| Candidate | Raw held rate | Corrected held rate |
|---|---|---|
| today | 0.913 | 0.913 |
| g869 | 0.941 | 0.627 |
| g798 | 0.975 | 0.622 |
| g979 | 0.987 | 0.623 |
| g533 | 0.929 | 0.610 |

- Candidates that park nobody do better on the corrected reading: g761 0.695, g556 0.693.
- g760 dominates g869 on corrected held (0.629), parked cases and useful/day (21.1), yet the raw guard (0.847) rejects g760 and keeps g869.

**L2. Different denominators across approaches.**
- Today: about 3,060 due rows, one per case.
- g869: about 2,675 rows on 1,658 hand-picked cases (about 1.6 each).
- The per-row rate compares a first-promise-only rotation with a relisting policy on its own chosen subset. A count-based reading (below) removes this.

**L3. Guardrails (a) and (b) are the same guardrail.**
- max |heldOnPromisedDate - heldAsScheduledAllDue| over all 655 rows is 0.0000.
- Every due row carries promised = nextDate (`simulate.ts:310-311`), so both have the same numerator and the same denominator.
- The effect is one constraint counted twice, with a weight of two in NSGA (`tournament.ts:331`).

**L4. neverActedOn can be met with token desk rows.**
- A desk row counts as "acted on" (`metrics.ts:223`), whatever the action: `await_return` and `await_report` do nothing (`types.ts:219`, `zoo.ts:347`).
- The log does not record the action, so the metric cannot tell a real re-issue from a note.
- Evidence (neverHeard / neverActedOn):
  - g858: 685 / 331. It meets (c) through 354 cases touched only at the desk.
  - g910: 1,020 / 665.
  - g617: 1,007 / 656.
  - g504: 395 / 134 (261 desk-only cases).
- Desk rows also sit in the held denominators as broken promises. So (a) and (b) punish desk work while (c) rewards it, which pushes the search towards parking.

**L5. "4y+ heard at all" is saturated and noisy.**
- It is 1.000 for today and for 304 of 640 candidates. One failed call counts as heard.
- g504 breaks the guard at 0.994 against a floor of 0.995, a miss of 0.001: noise on a saturated measure.
- `readme.backlog4ySubstantiveShare` also counts a single substantive hearing of any stage. The outcome measure is `extra.pending4yPlusEnd`.

**L6. Next-date excess measures only some dates, against a very loose anchor.**
- Only reached, non-disposing hearings are scored (`metrics.ts:273`). These dates are never scored: first dates, deferral dates (`simulate.ts:321-329`), desk dates, and dates given after a matter was not reached.
- The tolerance is anchored on today's 50.8 d + 1. That lets next dates run about 50 days past PUCAR's minimum, far enough to leave the horizon. g533 passes with 47.0 d; g640 has 58.7 d.

**L7. Overrun and idle time.**
- Today overruns on 21.8 of 51 days, so the guard accepts 43% late days.
- `extra.overrunMinutes` is not guarded. g504 has 320 minutes against today's 241.
- Idle time is not guarded. g869 is idle 20.7% of the time (today 9.5%), and its capped utilisation is 0.79 (today 0.905).
- g921 (25.9/day) passes the original 7 with 22.5 overrun days.

**L8. Disposals by routes that do not reach the merits.**
- `acquitted_default` and `dismissed_steps` are headline disposals (`metrics.ts:27`).
- The leaders do not exploit this yet: g869 has 8.0 of 130 (6%), today 11.8 of 94 (13%).
- The search does find this corner: g762 27% (14.5 of 55), g578 23%, g1045 20%, g921 14.3 of 122.

**L9. The objective rewards depth over breadth.**
- `extra.substantivePerDay` has no coverage term. g869 hears 1,644 distinct cases against today's 2,739, but hears them more often.
- Nothing in the objective values a case's first hearing more than its fourth.

**L10. The relaxation walks into the loophole.**
- `preRegistered` relaxes (c) to the smallest level any hard-feasible candidate reaches, plus 5% (`tournament.ts:444-447`). That level is about 1,290 never acted on (g533's 1,227 x 1.05).
- The top useful/day at that level is g533 (16.1/day) or nothing, and at the next level up it is the parking candidates. The rule therefore certifies whatever amount of parking the search found.

**L11. Censoring at the end.**
- Cases whose next date falls after 15 Dec vanish from every rate. Today loses 98% of its heard cases this way; g869 loses 58%.
- Only counts over the whole roster (never heard, pending 4y+ at end, parked) are free of this.

## 3. Proposed final criteria

All guards are against status_quo_60 on the tuning seeds, with a noise tolerance. Every guard is either a count over the whole roster of 3,000 cases, so it does not depend on which cases a policy chose to list, or an outcome at the horizon end.

**New corrected readings.** They can be computed from the log, and the metric code or the tournament can add them without touching the engine.
- `promisesBroken` = (every due row not reached on its listed date) + (cases with no row in the horizon, i.e. `3000 - extra.casesScheduled`). Put plainly: dates fixed and not kept, plus cases quietly re-dated past the quarter. This replaces (a) and (b). The approximation used below is `(listedPerDay + deskPerDay + deferredPerDay + vacatedPerDay) x sittingDays x (1 - heldAsScheduledAllDue) + parked`, which gives today 265.
- Coverage uses `siddarth.neverHeard`, not `extra.neverActedOn`, until the log records the desk action and only `reissue` counts.

**Guards:**
1. `promisesBroken` <= today + 300. That is at most one extra unkept date for every ten cases in a quarter, and a judge can defend that trade.
2. `siddarth.neverHeard` <= today + 100 (361). Every litigant gets a hearing, as today.
3. `extra.pending4yPlusEnd` <= today, and `readme.backlog4ySubstantiveShare` >= today - 0.005. This drops "4y+ heard at all" as a guard (L5). It is still reported.
4. Disposals on the merits = `extra.disposed - disposedAcquittedDefault - disposedDismissedSteps` >= today - 2. A court may not count its own default acquittals as progress.
5. `caseStudy.overrunDays` <= today + 1, and `extra.overrunMinutes` <= today x 1.1.
6. `caseStudy.nextDateExcessDays` <= today + 1 (kept as now). Report `extra.nextDatesBeyondHorizonShare` beside it.
7. Trips per useful hearing and wasted listings: keep the current rule (another lens). If relaxed, anchor on today, not on the best baseline.

**Objective and tie-breaks:**
- Maximise useful/day.
- Ties: fewer `promisesBroken`, then fewer neverHeard.
- If nothing is feasible, do not relax one guard automatically (L10). Publish the frontier instead.

## 4. Feasibility on seeds 1-6

Nothing meets the proposal, with trips and wasted listings against either the best baseline or today.

**Closest candidate: g504** (evolved), which breaks only guard 2. It is "today's way, done better": all 3,000 cases scheduled, a one-pass rotation, 97% of next dates beyond the horizon.

| Measure | g504 | Today |
|---|---|---|
| Useful hearings per day | 18.61 | 16.8 |
| promisesBroken | 447 | 265 |
| Held as scheduled (all due) | 0.857 | 0.913 |
| Never heard | 395 | 261 |
| Never acted on | 134 | 262 |
| Pending 4y+ at end | 953 | 967 |
| 4y+ substantive share | 0.302 | 0.278 |
| 4y+ heard at all | 0.994 | 1.0 |
| Disposals (on the merits) | 103 (93) | 94 (82) |
| Overrun days | 22.3 | 21.8 |
| Overrun minutes | 320 | 241 |
| Next-date excess | 47.5 d | 50.8 d |
| Trips per useful hearing | 10.32 | 11.97 |
| Wasted listings | 0.663 | 0.721 |

Caveats on g504:
- It gains nothing on next dates.
- Its 134 "acted on" leans on 261 desk-only cases, whose actions cannot be verified (L4).
- It breaks the current rule on 4y+ heard (by 0.001), trips and wasted listings against the best baseline (8.94 / 0.633), and held.

**Frontier.** Among the 430 candidates that meet everything in the proposal except guards 1 and 2 (with trips and wasted against today), useful/day against promisesBroken (neverHeard):

| promisesBroken | Never heard | Useful/day | Candidate |
|---|---|---|---|
| 447 | 395 | 18.61 | g504 |
| 969 | 632 | 18.80 | g342 |
| 1,155 | 755 | 21.04 | g724 |
| 1,666 | 1,202 | 21.07 | g760 |
| 2,064 | 1,234 | 23.35 | g788 |
| 2,399 | 1,147 | 25.92 | g921 |
| 2,617 | 1,562 | 25.97 | g586 |

g869 sits at 1,499 / 1,356 / 19.3, and g724 dominates it on all three.

**The binding constraint is promise-keeping measured honestly.** Above today's rate, every useful hearing per day costs roughly 600-1,000 broken or parked dates. No tournament candidate is more predictable than today once parked cases count. The claim that survives is a trade-off: g504 buys +1.8 useful/day, +11 merits disposals and -14 pending 4y+ cases for about 180 extra broken dates (3,000 cases).

Recommendations:
- Present that trade-off, or re-run the search with `promisesBroken` and neverHeard as the constraints. Its current objectives never saw the parked cases (L1, L3), and the region around g504 (full rotation plus better selection) is barely explored.
- Do not submit g869, g798 or any candidate with casesScheduled below about 2,900 under a "keeps promises" claim.
