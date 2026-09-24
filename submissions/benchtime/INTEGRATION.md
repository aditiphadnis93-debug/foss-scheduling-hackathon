# Running this in a real court, and in DRISTI 2.0

This file is for the people who would deploy the tool. It describes the court's day with the tool in it, the
data the tool needs and produces, the API, and what DRISTI 2.0 has to add. Everything here is advisory. The
judge signs every causelist and every order, and can move any listing after seeing what the move costs.

The recommended planner is the tournament winner, g237. It is registered as the policy `benchtime_final`
(`src/planner/zoo/final.ts`) and is the default genome of the `zoo` planner, which the API recommends
(`RECOMMENDED` in `src/api/context.ts`). The older `benchtime` policy is the overnight build and stays as a
rival. Every number below comes from the simulator on PUCAR's synthetic sample court, on held-out world seeds
31 to 60, unless it says otherwise (`out/HEADLINE.md`, `out/ablation.md`).

## 1. The court's day with the tool in it

| When | Who | What happens |
|---|---|---|
| 4:30 pm, the day before | Court master | Opens tomorrow's proposed list in the console (`web-concepts/causelist`). The list shows matters in call order with item numbers. Matters that would start after 5:30 pm sit under "May not be reached before 5:30". A section headed "No one needs to come tomorrow" holds the process desk and any matter moved to a later date, each with its reason. The court master can take a matter off or put one on. Before the change is kept, the console shows the new end of the day, the number of matters and how many are likely to go ahead. The court master then approves and prints the list. |
| 5:00 pm | System | Publishing would send each advocate one message per matter, with the item number, the purpose and the last order. A desk message says why the matter goes to the desk and that nobody need come. The plan already carries this text (`messages` in `POST /api/plan`). Nothing sends it yet. |
| 10:00 am | Bench | Calls the list in order. When a matter fails or ends early, the bench calls the next matter on the list. The court sits from 10:00 am to 5:30 pm with a break from 1:30 to 2:00 pm. |
| During the day | Court master | Records each outcome with one of PUCAR's ten reasons (party absent, process not returned, party sought time, and so on) and the minutes the matter took. In this package the simulator plays the day. In the DRISTI branch the `/outcome` route stores the record. |
| Any time | Bench clerk | Enters process events as they happen: issued, served, unserved, executed. A case can be listed from the working day after its process comes back, never before. |
| Weekly | Judge | Opens the court-health view (`GET /api/health`; the console has no health screen yet, so today this is the API's JSON). It shows cases about to cross 3, 4 and 5 years, repeated adjournments, matters stuck at one purpose, the desk, and drift. On the console's rules page (`web-concepts/causelist/rules.html`), the judge can change the rules or the aim and see the effect on tomorrow's list and on the forecast to 15 December before keeping the change. |

The two new habits are entering the outcome reason and entering process returns. Both replace work the court
already does on paper. Nothing in this day needs a new law or new staff.

### The process desk

The desk takes matters that cannot be heard yet. A matter goes to the desk when its summons, notice or warrant
has not come back, or when an outside report such as a mediation report is still awaited. The desk has three
actions: wait for the return, re-issue the process, or wait for the report. Nobody is asked to attend.

The desk is on in the recommended rules. On PUCAR's synthetic sample court, switching it off adds 81 dates that
are broken or never given over the quarter (95% interval 68 to 93). It also adds 0.77 trips for each hearing
that moves a case. Switching the desk off would leave 168 fewer cases never heard, because a desk order does
not count as a hearing.

### Call times

The recommended list gives an order and item numbers, not clock times. On PUCAR's synthetic sample court, each
person heard waits 141 minutes on average before the hearing starts, against 155 minutes today. A judge who sets time
slots gets call times, because the planner gives every matter a time inside its slot (`effectiveGenome` in
`src/planner/zoo/rules.ts`). The aims "least waiting" and "most useful hearings" also give every matter a call time.

Call times cost something. With call times added to the winner, the wait falls to 23 minutes. But 211 dates are
broken or never given instead of 166, and 417 cases are never heard instead of 380. That setting also fails
the guardrail on days that run late.

The recommended list can run past the day. In the engine's plan for 1 October on the sample court (world
seed 42, not the held-out seeds), the list holds 50 matters and 588 expected minutes for a 420-minute day. The console estimates finishing times from the expected minutes, and it marks
the matters that may not be reached before 5:30 pm (`web-concepts/causelist/GAPS.md`, item 9).

### The day-before check-in is an optional setting

The recommended rules do not ask anyone whether they are ready. A judge can turn the check-in on with
`checkin: true` in the rules, or with the console's rule "The day before, ask each side if they are ready".
The aim "most useful hearings" also turns it on. When it is on, an advocate can answer ready or not ready, and
a timely "not ready" releases the slot. The held-out ablation shows why it is off. Turning it on adds 5 cases
decided on the merits, but it adds 516 dates broken or never given and 276 cases never heard.

## 2. What the tool needs

The minimum input is one row per pending case, in PUCAR's roster schema as it is. The columns are
`case_number`, `filing_number`, `filing_date`, `advocate_id`, `party_id`, `current_stage`,
`last_hearing_summary`, `purpose_of_next_hearing`, one `hearings_<type>` count for each of the 14 hearing
types, and `total_hearings_held`. The tool also needs PUCAR's reference tables (`hearing_type_reference.csv`,
`substantiveness_by_hearing_type.csv`, `hearing_failure_reasons.csv`) and the court calendar with the judge's
leave.

The loader refuses to guess. A bad date, an unknown hearing type or a duplicate case number stops the import,
and the error names the row (`src/data/roster.ts`). A missing column also stops it, and the error names the
column.

The planner reads the court's own records as they build up, and uses each record only from the day after it
is made. For each case it uses who has turned up (each party and each advocate), how long process has taken to
come back, last-chance orders and repeated adjournments (`src/planner/predict.ts`). Durations and each hearing
type's success rate stay PUCAR's. The planner can also re-scale each type's success rate from recorded
outcomes, but that option is off in the winner. On the held-out seeds, turning it on adds 266 broken or
never-given dates.

## 3. What the tool produces

- `out/proposed_schedule.csv`, written by `bun run src/cli.ts day --date <date> --policy benchtime_final`. It
  has PUCAR's causelist columns (`Case Number`, `Filing Number`, `Hearing Type`, `Hearing Date`) plus call
  time, window, standby flag, expected minutes, the predicted chance that the hearing moves the case, and the
  reasons for the listing. Call time and window are empty unless the judge has set time slots.
- The process desk list, and the list of deferred matters with their new dates and reasons.
- A next date for every matter heard. The rule is the earliest day with room after PUCAR's gap for the
  purpose, and sooner for a matter that failed or was not reached.
- Every measure in PUCAR's three scorecards for any rule set a judge wants to try, before the judge tries it.
  The new measures in `src/eval/metrics.ts` include dates honoured when a desk order counts
  (`extra.promisesHonouredInclDesk`), dates broken or never given (`extra.promisesBroken`) and cases never
  acted on (`extra.neverActedOn`).

## 4. The engine's API (this package)

`bun run src/serve.ts` serves the engine on port 8791. The console (`bun run web-concepts/causelist/serve.ts`)
serves on port 8796 and passes `/api/*` through to the engine. `web/API.md` gives every request and response
shape. The engine has these routes, and no others (`src/serve.ts`):

| Route | What it does |
|---|---|
| `GET /api/meta` | Everything static the console needs: the court, the horizon, hearing types, PUCAR's failure reasons with their shares, the policies, the recommended planner (`zoo`), the aims with their measured effect (`aims`, from `out/aims.json`), the three judges' rule presets (`rulePresets`), limits, seeds and the catalogue of measures. |
| `POST /api/plan` | One day's list under one policy and set of rules: listings, desk, deferred matters, expected load and overrun risk, and the messages publishing would send. With `pin` or `drop` it plans twice and returns the cost of the court's change. |
| `POST /api/simulate` | Runs the simulator for one rule set over the horizon and returns every scorecard as a mean with its 95% interval, week by week. |
| `POST /api/compare` | Two rule sets on the same seeds, with the paired difference on every measure. |
| `GET /api/health?date=&policy=` | The docket on a date as the court knows it: ageing risk, repeated adjournments, matters stuck at one purpose, the desk, and drift from the simulator. |
| `GET /api/case/:id?date=&policy=` | One case in full: stage, history, attendance record, process, the prediction with its reasons, and the next date. |
| `GET /api/evidence` | The stored experiment results under `out/`, served as they are and never recomputed. |
| `GET /api/rules/presets` | The case study's three judges as rule sets over the `zoo` planner: `sehgal_way`, `dimakar_way` and `joshi_way`. A judge starts from one and edits it. |
| `POST /api/rules/preview` | The effect of a rule set. It returns the effective rules, any problems (an unknown rule, a floor below 15%), tomorrow's plan with and without the rules, whether that plan keeps every rule, and every scorecard with and without the rules, paired on shared seeds. |
| `GET /api/health-check` | Confirms the engine is up and lists the routes. `GET /` and `GET /api` return the same. |

The judge's aim is one field in the rules, `config.aim`. It can be `balanced` (the winner, and the
default), `focus_hearings`, `focus_finish`, `keep_dates`, `reach_everyone` or `least_waiting`. Each aim runs
the genome the tournament found best for it (`AIM_GENOMES` in `src/planner/zoo/presets.ts`). The judge's own
rules still apply on top of the aim. The measured effect of each aim in `out/aims.json` comes from the tuning
seeds 1 to 6. Only `balanced` also has held-out numbers.

The judge's rules include time slots, weekday themes, a cap on matters, half days, leave, purposes called
first, notice and gap limits, and a cap per advocate (`Rules` in `src/planner/zoo/rules.ts`). No rule can
lower the floor below 15% of the day for cases four years or older. The console keeps the rules and the
approval in the browser. Nothing is stored on the server.

## 5. DRISTI 2.0 integration

DRISTI 2.0 (`pucardotorg/dristi-v2`) is Next.js, Drizzle and Postgres. The engine is TypeScript with no
runtime dependencies, so it fits in as a workspace package behind a few routes. A local branch,
`feat/scheduler-kollam` in `/tmp/dristi-v2`, does this. It is cut from `origin/main` and has not been pushed,
and no pull request exists. Its draft description is `docs/scheduler.md` on that branch.

The branch adds `packages/scheduler` (a copy of this engine), an adapter from DRISTI rows to the engine's case
records (`lib/scheduler/adapter.ts`), six routes, four tables and a smoke test (`scripts/scheduler-smoke.ts`)
that runs without a database on PUCAR's 100-case sample. `docs/scheduler.md` records that the branch builds,
typechecks and passes the smoke test, and that every route was tried against a throwaway PostgreSQL.

| Route | What it does |
|---|---|
| `POST /api/scheduler/plan` (also `GET`) | Tomorrow's list for one judge from DRISTI's rows. It writes nothing. |
| `POST /api/scheduler/outcome` | Stores a hearing outcome and returns the next date. The court's own date always wins over the recommended one. |
| `POST /api/scheduler/process` | Stores a process event and returns the day from which the case can be listed. |
| `POST /api/scheduler/checkin` | Stores a readiness answer. It matters only when the check-in is on. |
| `POST /api/scheduler/simulate` | Every scorecard for a rule set against today's way on the same seeds. |
| `GET` and `PUT /api/scheduler/rules` | Reads the judge's saved rules, or saves a new version. |

The four tables follow DRISTI's conventions (varchar ids, epoch-millisecond bigints, `tenant_id` on every row).
They are `hearing_outcome`, `process_event`, `hearing_checkin` and `judge_rules` (`db/schema/scheduler.ts`,
`db/scheduler.sql`). DRISTI 2.0 does not record hearing outcomes, process returns or trial stages today. These
tables hold what the tool needs and what the court is missing.

The last commit on the branch carries an engine copy synced at 13:51 IST, before g237 was frozen. Its default
policy is `benchtime`. A newer re-sync from this package (15:36 IST, recorded in
`packages/scheduler/SYNCED_FROM`) sits in the working tree and is not committed. It brings in the winner as
the `zoo` default, the judge rules module and the aims. It also sets `DEFAULT_POLICY` in
`lib/scheduler/validate.ts` to `zoo`, and it adds `aim` and the rule fields to the strict schema for saved
rules. The working-tree `docs/scheduler.md` (also not committed) describes this re-sync. On the re-synced
tree at 15:45 IST, `pnpm exec tsc --noEmit` was clean and `pnpm scheduler:smoke` passed. The build was not
re-run.

`docs/scheduler.md` lists 13 things DRISTI must add for live data:

1. A registered case number. Until then cases are keyed by filing number.
2. `case.filing_date`, set at filing or registration. Without it, ages fall back to the date the draft was
   created, which understates the old backlog.
3. The trial stage and the purpose of the next hearing.
4. A hearing or causelist table for the published list and each promised date.
5. Hearing history for cases already pending, as a one-time import from CIS.
6. `case.judge_id`, set by routing or registration.
7. The court calendar and the judge's leave.
8. Process per accused and per address, with the prepaid rounds recorded.
9. Master-table entries and wiring for the notification, event and pending-task keys.
10. Separate roles for the court master, the bench clerk and the judge.
11. The screens. The branch is API only.
12. PostgreSQL 15 or later for the scheduler tables.
13. A background job for simulation once the docket grows well past 3,000 cases.

## 6. Rolling it out when DRISTI does not yet hold the data

The scheduler needs four things DRISTI 2.0 does not record today. It needs each case's stage and next purpose,
its hearing history and attendance, whether its summons, notice or warrant has come back, and why each hearing
failed. PUCAR's e-filing handover ends at cognisance. So the tool cannot plug into DRISTI today. It can run in
a court today, and it improves as DRISTI records more.

| Phase | Where the data comes from | What works |
|---|---|---|
| 1. Day one | A nightly roster export from the court's existing case system, in PUCAR's roster shape | Lists sized to the day, next dates from PUCAR's gaps, the process desk from the last hearing note, and the floor for old cases. Predictions start from PUCAR's per-type tables. |
| 2. Weeks 1 to 4 | The court master records each outcome in the console, with one of PUCAR's ten reasons | The planner learns who turns up and how long process takes in this court. This creates the data DRISTI lacks. |
| 3. With DRISTI's e-post | PUCAR's handover (section 19.3) has summons, warrant and notice rounds prepaid at filing and sent by e-post. Triggering a prepaid round creates no payment task. E-post delivery status becomes the `process_event` feed with no data entry. | The desk chases a matter whose summons is out by triggering the next prepaid round, instead of calling the matter. This is the most valuable integration. Process not returned is the largest cause of failed hearings in PUCAR's data, at 36% of non-substantive hearings. |
| 4. DRISTI hearing module | DRISTI records hearings and outcomes itself, and the scheduler reads them | The roster export is retired. |

Messages go through DRISTI's master notifications table, and the desk queue goes through its pending-tasks
tables (handover section 20.5). The tool adds no channel of its own.

### Shadow mode before any court relies on it

Run the tool in shadow mode for two to four weeks. The tool proposes each day's list while the court lists as
usual. The same scorecards are computed from the court's real outcomes, which tests the simulator's claims
against the court itself. Then trial the tool on chosen days and compare.

### The risk is data entry

If nobody records outcomes, nothing improves. So the outcome screen should take two taps a matter, and the tool
should take whatever it can from other systems, such as process status from e-post. That screen does not exist
yet, in this package or in the DRISTI branch. The held-out runs tested process returns 1.5 times
slower than calibrated. The winner still beat today's way on useful hearings, merits disposals and dates
honoured. The world model has a setting for process returns reported late (`returnReportDelayDays`, default
0), but no held-out run has varied it yet. That run would put a number on what the e-post feed is worth.

## 7. What is real and what is modelled

Real, from PUCAR's data: the 100-case roster and its seed-42 scale-up to 3,000 cases, the hearing types,
PUCAR's durations and gaps, P(substantive) and the failure-reason shares for each type, the Kollam calendar,
and the sample causelist.

Modelled: how attendance varies between people, process return times, preparedness, the spread of durations,
and how people respond to a call time or a reminder. These are named assumptions in `src/world/defaults.ts`
and `src/world/calibrated.json`. The experiments vary them (`out/robustness.md`). The winner still beat today's
way on all three headline measures under every condition but one. When the planner is shown success rates 30%
lower than the truth, it still gives more useful hearings and merits disposals, but the gain in dates honoured
disappears.

The winner is worse than today's way on some measures, and `out/HEADLINE.md` lists them. The largest is cases
never heard in the quarter, 380 against 240. On the held-out seeds it fails 1 of the 19 pre-registered
guardrails as `out/tournament/criteria.json` defines them, which is cases never heard. A stricter test also
fails a second guardrail, that every case four years or older is heard at least once. The winner leaves no
such case unheard on any seed. The stricter test fails because today's way varies from seed to seed.
