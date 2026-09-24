# The benchtime design contract

Every module follows this file. The shared types are in `src/domain/types.ts`. When this file and the
code disagree, fix the code or change this file on purpose. Do not let the two drift apart.

Everything the planner produces is advisory. A judge signs every list and every order. Every number in this file
is on PUCAR's synthetic sample court. That court is PUCAR's generated roster, run through a simulated court
calibrated to PUCAR's tables.

## The problem, as PUCAR's data defines it

The court is the Kollam district court, and the cases are Section 138 NI Act summary trials (case numbers
`ST/...`). One judge holds a roster of 3,000 cases (`data/roster_3000_seed42.csv`, produced by PUCAR's own
`scripts/generate_roster.py --seed 42`). Every team faces this same court. The judge has 420 bench minutes per
working day (`court_calendar.csv`). The horizon runs from 2026-10-01 to 2026-12-15. The case study (section
5.A) sets existing next dates aside, so the judge starts from the roster and decides what to hear, when, and
how to use the time.

The case study's lifecycle has 11 sequential stages, in this order:

`ADMISSION`, `DELAY_CONDONATION_HEARING`, `COGNIZANCE`, `APPEARANCE`, `WARRANT`, `PLEA`,
`EXAMINATION_UNDER_S351_BNSS`, `EVIDENCE_COMPLAINANT`, `EVIDENCE_ACCUSED`, `ARGUMENTS`, `JUDGEMENT`, then disposed.

Two stages are optional. DELAY_CONDONATION happens only when the complaint was late. WARRANT happens only when
the accused does not appear on summons. Three interrupting types return the case to its underlying stage when
they are done. `BAIL` comes before trial only, `REPORTS` is mostly mediation, and `APPLICATION_REVIEW` can come
at any stage. A hearing is substantive when it moves the case to its next purpose (case study, 5.C).

## The three rules (non-negotiable)

1. Plan only what is known before the day. A policy receives a `PlanContext` built from `CaseView`s. A view
   holds the roster record, the parsed last-hearing summary, and the outcomes the court has recorded so far
   (date, type, outcome, recorded reason, minutes, attendance as recorded). It also holds the process events
   the court has been told about. The court learns of a return on the working day after the return
   (`src/world/simulate.ts`). When a policy asks for check-ins, the view holds the day-before answers. A policy
   never sees the world's latent propensities, future return days, or today's duration and attendance draws.
   `test/leakage-imports.test.ts` follows the import graph from `src/planner` and fails if any file under
   `src/world` or `src/eval` is reachable. The simulator builds each day's views fresh and freezes them.
2. Every policy faces the same random draws (shared seeds, common random numbers). Every random quantity in the world is drawn from `u(seed, key...)`, a
   stateless hash of the seed and a semantic key (case, actor, date, hearing ordinal, event). No draw comes
   from a stream whose position depends on what a policy did. The same person on the same day makes the same
   draw under every policy. A policy changes only thresholds, never the draw. For example, a time slot raises
   the attendance probability that the same draw is compared with. The world keys every case's draws by
   `rosterId|caseId` (`buildWorld` in `src/world/world.ts`). Two rosters that share case ids are therefore two
   different courts. The arena and the API use the roster id `roster_3000_seed42` (`ROSTER_ID` in
   `src/api/context.ts`). `test/crn-duration.test.ts` checks that a case heard substantively on a given day
   draws the same duration whatever failed before.
3. Report every measure. Every run reports all the scorecards below, per seed and as a mean with a 95% interval
   across seeds, with paired differences against `status_quo_60`. The headline comes only from the held-out
   world seeds 31-60 (`out/HEADLINE.md`).

## Scorecards (compute exactly as each source defines)

`src/eval/metrics.ts` computes every field. `SCORECARD_FIELDS` in the same file gives each field's label, unit,
direction and source text. `test/metrics.test.ts` checks that the catalogue matches a computed scorecard, so no
field goes unreported.

The repo README's printed scores use a capacity of 420 minutes a day.

- `readme.utilisation` is the minutes of substantive and failed hearings divided by (420 x sitting days). It is
  not capped, so a day that overruns can push it past 100%.
- `readme.reachRate` is reached divided by listed. Listed means substantive, failed, not reached and court not
  sitting. Vacated and desk matters were never on the day's list.
- `readme.substantiveness` is substantive divided by reached.
- `readme.backlog4yHeardShare` is the share of cases aged 4+ years at the start that had at least one reached
  hearing. `readme.backlog4ySubstantiveShare` counts a substantive hearing instead.
- `readme.predictabilityGapDays` is the mean over heard cases of the days from the first date the case came up
  in the horizon to its first reached hearing. Lower is better. Never-heard cases are left out here and counted
  in `extra.predictabilityGapDaysCensored`.

The case study PDF, section 6, defines these.

- `caseStudy.utilisation` caps each day at capacity. `overrunDays` and `idleMinutesShare` are reported next to it.
- `caseStudy.heldAsScheduled` is the rows reached on the date they were listed for, divided by listed plus
  deferred. `heldAsScheduledAllDue` divides the same count by every row that fell due, including vacated rows,
  desk rows and closure days.
- `caseStudy.substantiveness` is substantive divided by reached.
- `caseStudy.ageBandsStart` and `ageBandsEnd` count pending cases in the 0-1, 1-3, 3-4, 4-5 and 5+ year bands,
  plus 3+ and 4+.
- `caseStudy.nextDateExcessDays` is the mean over reached, non-disposing hearings of max(0, days to the next
  date minus PUCAR's reference gap for the hearing type).
- `caseStudy.wastedRelistShare` is the share of relisted dates on which the case was not ready: handled at the
  desk, vacated, or failed for process, an external dependency, not ready or time sought. A desk row straight
  after another desk row is a registry re-check and is left out.

Siddarth's slide 06 defines six.

- `siddarth.throughputPerMonth` is headline disposals divided by the horizon in months (calendar days / 30.44).
- `siddarth.judgeTimeUsed` is minutes used divided by minutes available.
- `siddarth.wastedListings` is (not reached + court not sitting + failed) divided by listed.
- `siddarth.heldOnPromisedDate` is the rows reached on their promised date divided by the rows that carried a
  promised date. A desk order on the date counts as broken here.
- `siddarth.oldestPendingAgeYears`, `p95PendingAgeYears` and `neverHeard` measure fairness.
- `siddarth.loadBalanceCv` is the coefficient of variation of minutes used per sitting day.

The `extra` family holds the rest. The final tournament rule added three of these measures.

- `extra.promisesHonouredInclDesk` is the rows reached on their promised date, or taken up at the desk that day
  with process or a report still out, divided by the rows that carried a promised date. A magistrate who writes
  "process not returned, issue fresh, call on X" has honoured the date.
- `extra.promisesBroken` is the promised dates on which the court passed no order (not reached, deferred,
  vacated, court not sitting), plus the cases given no date inside the horizon. A policy that parks a case past
  15 December is charged for it.
- `extra.neverActedOn` is the cases with neither a reached hearing nor a desk action in the horizon.
- `extra.casesScheduled`, `neverHeard4yPlus`, `pending4yPlusEnd` and `backlog4yActedOnShare` count coverage.
- `extra.tripsPerSubstantive`, `wastedTripShare`, `minutesWaited` and `minutesWaitedInclNotReached` measure
  people's time. Minutes waited needs start minutes in the log.
- `extra.disposed` and `disposed4yPlus` count headline disposals. Each route has its own count
  (`disposedVerdict`, `disposedSettlement`, `disposedCompounded`, `disposedAcquittedDefault`,
  `disposedDismissedSteps`, `disposedPostJudgment`, `disposedLpSplit`), and `disposedAllRoutes` adds them up.
  The headline leaves out post-judgment closures and long-pending splits.
- The remaining `extra` fields are alternative readings of the measures above. `SCORECARD_FIELDS` names each one.

The tournament also uses one derived measure. `derived.meritsDisposals` is verdict + settlement + compounded
(`out/tournament/criteria.json`).

## The world (src/world), calibrated to PUCAR's tables

The world draws these hidden quantities per seed.

- Each complainant, accused and advocate has an attendance propensity. It is heterogeneous (Beta) and seeded
  from the roster's Present/Absent record, so the world agrees with what the court has seen.
- Each summons, notice or warrant has a latent return or execution day, drawn per kind. A share of warrants at
  the WARRANT stage (`abscondShare`, 0.15 by default) is never executed inside the horizon, because the accused
  has absconded.
- Each mediation report has a latent ready day.
- Each hearing has a preparedness draw (not ready, or seeks time). A "last chance" order raises preparedness.
- Duration is lognormal with PUCAR's estimate as the mean and a CV of 0.5 (`durationCv`, an assumption).
- Court administrative loss and a residual "unclear" failure are outside any policy's control.

A called hearing resolves in this order (`STEPS` in `src/world/resolve.ts`):

court administrative issue, process not back, external dependency not ready, a required party absent (who is
required depends on the hearing type), not ready, seeks time, unclear, substantive.

A failed hearing takes `callMinutes` (2 minutes by default, an assumption). A substantive hearing takes its
sampled duration. A hearing not called by the 420th minute is `not_reached`.

Calibration fits the latent parameters so that, under the calibration status quo, the simulated per-type
P(substantive | reached) and failure-reason shares match `substantiveness_by_hearing_type.csv` and
`hearing_failure_reasons.csv`. The fit and its quality per type are in `out/calibration-fit.md`. PUCAR's tables
disagree about JUDGEMENT (100% substantive, yet 3.58 hearings per case). `src/world/defaults.ts` documents the
conflict and follows the hearing counts through `closureProb`.

The court does not know what the roster summary does not record. Process and reports ordered before the horizon
stay hidden in the world until a hearing fails for them, and nothing issued before the horizon carries a date in
a view (`issuedOn` and `since` are null). Planners receive deep-frozen copies of the tables, calendar,
configuration and check-ins. The world reads its own copies.

The world classifies each outcome. It does not take the policy's label. A deferral is `vacated` only when the policy asked for
check-ins and a side the hearing needs answered "not ready". A desk row is `desk` only when the court's record
shows process or a report out; otherwise it is `deferred`. The check-in has its own draws. A side foresees only
part of its day-of failures (`checkinUnforeseen`), and a side that would have gone ahead sometimes says "not
ready" (`checkinFalseAlarm`).

A substantive APPEARANCE goes to PLEA. WARRANT is entered only when a served accused stays away, with
probability `pWarrantOnAbsence`; otherwise the accused gets another chance. That move counts as substantive,
because PUCAR defines substantive as a move to the next purpose. At JUDGEMENT a warrant issues only after the
accused is absent. `pDelayCondonation` and `pWarrantOnAbsence` are named assumptions in `WorldParams`. PUCAR's
hearing counts cannot identify them, because its generator puts hearings at every stage. None of the runs
reported here sweeps them.

Each disposal route has a name. `WorldParams.disposal` switches every route except the verdict and mediation
settlement. The disposing row records its route in `HearingLog.disposalRoute`. The routes are these:

- verdict;
- mediation settlement (`settleOnReport`, 0.4 by default);
- compounding under s.147 NI Act, a small hazard at each hearing with both parties present;
- acquittal for the complainant's default under s.279 BNSS, when a warned complainant is absent again;
- dismissal when steps are not taken;
- a long-pending split for an absconding accused;
- closure of the last post-judgment matter, including cases awaiting the District Court's order.

The behaviour responses are named assumptions in `src/world/defaults.ts`. A fixed time slot lifts attendance
(`slotAttendLift` 0.3). A day-before reminder lifts attendance (`reminderAttendLift` 0.2). A side that foresees a
failure says so at check-in with probability `checkinHonesty` (0.7), and the slot is vacated. A standby matter's
attendance is multiplied by `standbyAttendMult` (0.85). Each wasted trip lowers a litigant's attendance by
`fatiguePerWastedTrip` (0.02). `noBehaviour` turns all of them off.

## Policies (src/planner)

Every policy implements `Policy` and faces the same court. `POLICY_IDS` and `POLICIES` in
`src/planner/index.ts` are the registry.

### The submitted planner, the zoo with the tournament's pick

`zoo` (`src/planner/zoo.ts`) is one meta-policy. Each of its design choices is a named gene in a `Genome`
(`src/planner/zoo/genome.ts`). A genome is data, so the tournament can sample, mutate and cross it, and a judge
can read it. `validate` clamps every gene into `NUMERIC_BOUNDS` and the listed choices. The fairness floor never
goes below 15% of minutes for 4+ year cases. The only exception is a preset that reproduces a floorless baseline
(`enforceFloor: false`), and the tournament never samples those.

Each day the zoo runs the same five steps. A part of a step runs only when its gene is on. The next section
lists which parts the submitted genome uses.

1. It triages the due cases. The process desk takes matters whose process is out, the day-before check-in
   releases matters, desk and released matters unseen too long get a short review call, and never-heard old
   cases get a 2-minute mention.
2. It forces calls for the 4+ year rotation, when the rotation is on.
3. It selects the list with the genome's rule (`knapsack`, `index`, `ppm`, `oldest`, `youngest`, `fifo`,
   `portfolio`, `simple` or `listAll`). The fairness floor holds, and the list stays inside the judge's blocks
   and weekday themes.
4. It sets the call order, the call times, a standby list and the judge's cap on matters.
5. It gives every case not heard today a next date by the next-date rule, in the policy's own diary.

The genome has three kinds of gene.

- Choices are `selection`, `firstDates` (spread, priority, horizon, rotation), `nextDate` (flat60, pucar,
  window, earliest, projected), `coverage` (none, floor, rotation, mention), `callOrder` (rank, short, simple,
  cluster) and `calibration` (off, fail, pscale, learned).
- Switches are `caseEstimate`, `priorCheck`, `desk`, `checkin`, `checkinRobust`, `cluster`, `callTimes`,
  `quickRelist`, `gapOfHeard`, `countDiary` and `rotationAll`. The genes `blocks`, `purposeDays` and
  `carryForward` reproduce the judges' styles.
- Numbers are the fill target, standby share, promise fill, first-date fill, first-date old share, age exponent,
  ageing floor, window days, relist days and cap, diary cap, pending hold, return margin, re-check days, rotation days and cap,
  review days, mention threshold and portfolio share. Five weights (throughput, disposal, fairness, trips,
  predictability) lie in [0, 3].

`DEFAULT_GENOME` in `src/planner/zoo/presets.ts` is `TOURNAMENT_WINNER`, the genome g237. The same genome is
frozen as `BENCHTIME_FINAL_GENOME` in `src/planner/zoo/final.ts` and registered as the policy `benchtime_final`.
`test/benchtime-final.test.ts` checks that the frozen genome still matches `out/tournament/winner.json`. The API's
recommended planner is `zoo` (`RECOMMENDED` in `src/api/context.ts`). With no aim and no rules, `zoo` and
`benchtime_final` run the same genome with the same configuration.

g237 does the following (winner.json's description, with the gene values).

- The daily list uses one priority index per case. The index is P(substantive) x (throughput weight + disposal
  weight x progress to disposal), plus the waiting cost a hearing today stops, less the trips a failure would
  waste, all divided by expected minutes (`score` in `src/planner/zoo/select.ts`). The list fills 111% of the
  day (`fillTarget` 1.105), with a standby list of 30% (`standbyShare` 0.3).
- 4+ year cases are offered the first 33% of the day's minutes (`ageingFloor` 0.33 with `coverage: "rotation"`;
  `floorOf`).
- Every 4+ year case comes before the bench at least once every 45 working days (`rotationDays` 45). The
  rotation's calls take at most 34% of the fill target (`rotationCap` 0.34).
- The process desk is on. A matter whose summons, notice or warrant is not back goes to the desk and is not
  called. The desk re-checks an overdue return every 12 days (`recheckDays`). A pending return is dated 1.376
  times its expected span out (`returnMargin`).
- Desk matters unseen for 11 days compete for a short review call (`reviewDays` 11).
- There is no day-before check-in (`checkin: false`) and no call times (`callTimes: false`).
- A next date is the earliest day with room after PUCAR's gap for the purpose just heard (`nextDate:
  "earliest"`, `gapOfHeard: true`). Failed or unheard matters come back after 11 days (`quickRelist`,
  `relistDays` 11), never later than PUCAR's gap. A day may be promised up to 120% of its minutes
  (`promiseFill` 1.204).
- Every case gets a first date inside the quarter. The first dates are spread over the days (`firstDates:
  "spread"`), fill each day to 95% of the promise cap, and offer 21% of each day first to 4+ year cases.
- P(substantive) comes from the case's own record (`caseEstimate`), with PUCAR's prior checked against its own
  hearings per case (`priorCheck`) and no further calibration (`calibration: "off"`).
- An advocate's matters are called together (`callOrder: "cluster"`), and next dates prefer a day the advocate
  already comes (`cluster`).

### The judge's rules

`src/planner/zoo/rules.ts` defines `Rules`, which is `JudgeConfig` plus these optional rules:

- weekday themes (`blocksByWeekday`);
- a cap on matters listed, standby included (`maxListed`);
- half days of 210 minutes (`halfDays`, `halfDayWeekdays`);
- leave, with nothing listed and no date given (`leaveDays`);
- purposes selected and called first (`priorityTypes`);
- notice and gap limits on next dates (`minNoticeDays`, `maxGapDays`);
- a cap per advocate a day (`maxPerAdvocate`);
- an advocate's matters called one after another (`groupByAdvocate`);
- carried matters taken first (`carriedFirst`).

The zoo honours every rule on top of whatever genome it runs.

- `applyRules(base, rules)` lays a rule set over a configuration. The rules win field by field, the weights
  merge, and the floor stays at 15% or more.
- `effectiveGenome(genome, config)` makes the desk, check-in, clustering, weights and smart next dates follow
  the configuration. A judge who sets time slots gets call times, so every listing sits inside its slot.
- `ruleViolations` and `nextDateViolations` check a day's plan and its next dates against the rules.
  `test/rules.test.ts`, the preview route and `scripts/rules-check.ts` call them.
- `RULE_PRESETS` holds the case study's three judges as rule sets that a judge can start from and edit.
  `sehgal_way` lists fresh matters 11:00 to 13:30 and the oldest 14:30 to 16:30, takes carried matters first and
  fills to 130%. `dimakar_way` hears evidence to judgment on Monday, Wednesday and Friday and appearances and
  process on Tuesday and Thursday, oldest first, with an advocate's matters together, and fills to 100%.
  `joshi_way` calls the youngest filings first, sets the fairness weight to 0 and gives old cases the 15% floor
  and no more. These presets are rules over the winner. They are separate from the plain `sehgal`, `dimakar` and
  `joshi` policies.
- `GET /api/rules/presets` and `POST /api/rules/preview` expose the presets and a rule set's effect
  (`src/api/rules.ts`, `web/API.md`). The `config` of every route accepts the rules.

### What the list aims for

A judge can pick an aim with `config.aim`. `zooForAim` in `src/planner/index.ts` then runs `AIM_GENOMES[aim]`
from `src/planner/zoo/presets.ts`. The fields the judge set still override that genome, and the judge's rules
still apply. There are six aims: `balanced` (the tournament winner and the default), `focus_hearings`,
`focus_finish`, `keep_dates`, `reach_everyone` and `least_waiting`. Each is the best genome the final tournament
stage found for that aim among genomes that honour at least 85% of dates and leave at most 5 old cases unheard,
on tuning seeds 1-6. `out/aims.json` holds each aim's measured effect on seeds 1-6, and `GET /api/meta` returns
it as `aims`. Only `balanced` has held-out numbers. Some aims leave cases undated. For example, on tuning seeds
1-6 of PUCAR's synthetic sample court, `focus_hearings` gives 22.4 useful hearings a day against 17.9 for
`balanced`, but only 1,991 of 3,000 cases get a date before 15 December.

### Rivals

- The baselines are in `src/planner/baselines.ts`. `status_quo_60` is today's way and the case study's
  default. It lists every case whose date has come, gives a flat 60-day gap and calls the list in order.
  `status_quo_ref` uses PUCAR's reference gaps. The others are `fifo_capped`, `bin_packing` (greedy
  P(substantive) per minute to capacity, Siddarth's strawman) and `oldest_first`.
- The case study's judges are `sehgal`, `dimakar` and `joshi` in `src/planner/judges.ts`.
- `benchtime` (`src/planner/benchtime.ts`) is the overnight build, kept as a rival. It selects by an exact 0/1
  knapsack over expected minutes with a 95% fill target and a 10% standby list. It runs the process desk, the
  day-before check-in and advocate clustering, and gives the earliest next date with room
  (`defaultConfig("benchtime")`).
- The tournament also scored the baselines, the three judges and the seven redesigns as genomes (`PRESETS` in
  `src/planner/zoo/presets.ts`). It also scored an ADP planner that exists only as a patch outside this package.

`JudgeConfig` carries the weights over the measures, the fill target, the fairness floor, clustering, blocks by
hearing type, carry-forward, the process desk, the check-in, the standby share and smart next dates.
`MIN_AGEING_FLOOR` is 0.15 (`src/planner/index.ts`). `merged`, `applyRules`, `validate` and `genomeConfig` all
clamp the floor, so no configuration goes below 15% of minutes for 4+ year cases.

## How the planner was chosen (scripts/tournament.ts, out/tournament)

- The rule in force is `out/tournament/criteria.json` ("final rule, 14:15"). It has 19 guardrails, each a paired
  non-inferiority test against `status_quo_60` on the same seeds. A guardrail passes when the 95% t bound of
  (candidate minus today) clears its margin. Absolute limits are compared on the mean. Candidates rank
  first by guardrails failed, then by the worst shortfall relative to its margin, then by useful hearings a day
  (`extra.substantivePerDay`). No guardrail relaxes on its own.
- The first rule (the most useful hearings a day behind 7 guardrails) was rejected after four adversarial
  reviews, which the criteria note lists. The reviews found that the guardrails compared candidates with
  bin_packing's best numbers instead of today's way, that parking cases past 15 December kept promises, and
  that several measures were unguarded or had tolerances inside seed noise.
- The tournament searched on world seeds 1-6, decided on fresh runs on seeds 7-20, and confirmed on seeds
  21-30. Seeds 21-30 had been used once before, under the first rule. The headline uses seeds 31-60 only.
- About 2,587 distinct genomes were tried over the whole tournament. The final stage ran 264 genomes fresh on
  the current code, with 3 generations of NSGA-II (`out/tournament/summary.md`).
- g237 passed all 19 guardrails on seeds 7-20 and failed 1 (cases never heard) on seeds 21-30. No rival beat
  it on every guarded measure.

## Experiments (scripts/experiments, out)

World seeds 1-6 are for search, 7-20 for the decision, 21-30 for confirmation and 31-60 for the held-out test.
The roster is `roster_3000_seed42`, and the stress test adds roster seeds 1-5. The horizon is 2026-10-01
to 2026-12-15. Every held-out run goes through the CLI arena path (`runArena` in `src/eval/arena.ts`).

- The held-out test (`out/heldout.md`, `out/HEADLINE.md`) runs the winner against every rival on seeds 31-60,
  paired against `status_quo_60`, with t intervals on 29 degrees of freedom. The pick was fixed in advance. A
  guardrail failure on these seeds is reported, and the pick stands. On PUCAR's synthetic sample court, g237 gives 18.2
  useful hearings a day against today's 17.1 (+1.08, 95% interval +0.98 to +1.18). It decides 89.3 cases on
  the merits against 84.9, and it honours 94.9% of dates against 92.0%. It leaves 380 cases never heard
  against 240, which is worse by 140. Under `criteria.json` it fails 1 of the 19 guardrails on these seeds,
  cases never heard. The old-case guardrail is defined on the mean, and the pick passes it: it leaves 0 old
  cases unheard on every seed, against 0.53 for today's way. A stricter paired t-bound would fail that guardrail
  too, only because today's result varies from seed to seed.
- The ablation (`out/ablation.md`) switches each gene of the winner and compares the result with the winner on
  the same seeds. It also adds each component to today's way.
- The stress test (`out/robustness.md`) puts the winner and today in the same changed court under each of
  these conditions: behaviour responses off, duration CV 0.25 and 1.0, process returns 1.5 times slower,
  check-in false alarms doubled, the planner shown P(substantive) 30% high and 30% low, and roster seeds 1-5.
  The winner beats today on useful hearings, merits disposals and dates honoured in every condition but one.
  When the planner is shown P(substantive) 30% low, the dates-honoured difference is -0.31 points (95% interval
  -0.75 to +0.13).
- The styles study (`out/styles.md`) lays the three rule presets over the winner. It compares each with the
  plain judge policy, the winner alone and today, and checks rule compliance with `scripts/rules-check.ts`.
- The settlement study (`out/settlement.md`) tests a settlement-day add-on from a patch outside this package,
  on a temporary copy. `src/planner/settlement.ts` is not in this package. The world's settlement hazards do not
  respond to a settlement sitting.
- `out/calibration-fit.md` reports the world's fit. `scripts/causelist-22sep.ts` scores the real causelist of 22
  September with PUCAR's tables (`out/causelist-22sep.md`).
- `out/aims.json` measures the aims on tuning seeds 1-6 only.

## Interfaces

- `src/serve.ts` and `src/api/*` serve the engine API, and `web/API.md` documents it. The routes are `GET
  /api/meta`, `POST /api/plan`, `POST /api/simulate`, `POST /api/compare`, `GET /api/health`, `GET
  /api/evidence`, `GET /api/case/:id`, `GET /api/rules/presets` and `POST /api/rules/preview`.
- The judge console is `web-concepts/causelist` (design B). Three console designs were built. An agent review,
  written from a magistrate's and a court master's point of view, chose this one; the other two are not included.
- `INTEGRATION.md` is the DRISTI contract. A local DRISTI 2.0 branch, `feat/scheduler-kollam`, implements it
  outside this package with six routes and four tables. It is not pushed. Its `docs/scheduler.md` lists what
  DRISTI must add before the planner can run on live data.
