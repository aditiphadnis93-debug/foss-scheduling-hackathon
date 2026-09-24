# Submission: benchtime

Every number below comes from PUCAR's synthetic sample court (the seed-42 roster of 3,000 Section 138 cases
before one judge, 1 October to 15 December 2026). The tool only advises. The judge signs every causelist and
every order.

## 1. Team

- **Team / solo name:** benchtime
- **Members:** Rohan Shiralkar
- **Complexity level claimed:** L3 (section 4 gives the justification)

## 2. One-line summary

benchtime shows a judge, before they sign, what any causelist choice gains and costs on every measure PUCAR
named, and recommends a list that beats today's way on 18 of 19 guarded measures in tests on unseen data.

### What we found, in one minute

1. **A better list, tested on data the search never saw.** On 30 held-out simulated quarters, the recommended
   list gives 1.08 more hearings a day that move a case (18.2 against 17.1, 95% interval +0.98 to +1.18). It
   also decides 4.4 more cases on the merits, finishes 8.1 more cases in all and breaks 79 fewer dates. It
   brings 1.2 fewer journeys to court per useful hearing. Over a year of about 240 sitting days, if a year
   behaves like this quarter, one court would hold about 260 more useful hearings and finish about 38 more
   cases. It would also break about 370 fewer dates and save litigants and advocates about 5,300 journeys.
2. **The price of bigger gains, measured.** A judge who focuses the docket on fewer cases this quarter gets 23.1
   useful hearings a day (+35%) and 120 cases decided on the merits (+41%) on the same held-out seeds. The
   cost is that 1,190 of the 3,000 cases get no date before 15 December. The judge chooses the aim, and the
   console shows its cost before anything changes.
3. **Why "40% better" claims deserve a second look.** Our own first search found a list with 25.9 useful
   hearings a day. That list kept only 66% of the court's promised dates and left 1,144 cases unheard. Four
   independent reviews caught it, and a second loophole where a planner parks cases past the quarter. We
   changed the rule and publish both.
4. **The list is not the main bottleneck.** About 70% of listings fail for reasons a list cannot fix. In
   PUCAR's own data, 36% of failed hearings failed because a summons, notice or warrant had not come back.
   Tracking process through DRISTI's e-post is the next large gain.
5. **Built for a real court.** A judge console lets a judge start from Sehgal's, Dimakar's or Joshi's way,
   edit every rule as a sentence, and preview each change on tomorrow's list and to 15 December. A local
   DRISTI 2.0 branch with the scheduler's tables and routes builds and passes its smoke test.

## 3. The approach

### In plain language

We built a model of the court that matches PUCAR's data. We wrote every scheduling idea we found as settings
of one planner. A search tried about 2,600 combinations. A rule written in advance picked one.
We tested the pick on 30 simulated quarters that nothing had run on ([DESIGN.md](DESIGN.md)).

### Inputs

We used PUCAR's `roster_3000_seed42.csv`, hearing type reference, substantiveness table, failure reasons and
calendar. PUCAR's `generate_roster.py` makes the 3,000-case roster by resampling whole rows of its 100-case
sample, so it has the same mix of stages and ages, not independently simulated cases. We invented no case data. We fitted the model's hidden per-type rates so that a court listing every
due case at PUCAR's reference gaps reproduces PUCAR's P(substantive) per hearing type to a mean absolute
error of 0.2%. Under today's 60-day way the error is 0.6% ([out/calibration-fit.md](out/calibration-fit.md)).

### Core logic

1. The zoo planner (`src/planner/zoo/`) writes every idea as 41 genes. Today's way and the three judges'
   ways are presets of it. The genes set case choice, dates, old-case coverage, the process desk,
   check-ins, call times and the fill level.
2. An NSGA-II search worked on seven objectives. Eight baselines, our earlier planner and a dynamic
   programming planner also ran.
3. A rule fixed in advance made the pick ([out/tournament/criteria.json](out/tournament/criteria.json)).
   Its 19 guardrails compare each candidate with today's way under a stated margin: 17 by a paired 95% t
   bound, one on the mean and one as an absolute floor.
   Among candidates that pass, the rule picks the one with the most useful hearings a day. No margin relaxes
   itself.
4. The search ran on seeds 1 to 6. The rule made the pick on seeds 7 to 20. Seeds 21 to 30 confirmed the
   pick, although the first rule had used them once. Nothing ran on seeds 31 to 60 before the pick.
5. The planner sees only what the court knows before the day. A test enforces this. The simulator keys every
   random draw by seed, case, person and date, so every policy faces the same people.

### The winner, g237 (`benchtime_final`)

g237 passed all 19 guardrails on seeds 7 to 20. No rival beats it on every guarded measure
([out/tournament/summary.md](out/tournament/summary.md)).

- It ranks cases by value per minute. The value is the worth of a hearing today plus the waiting cost it
  stops, less the cost of wasted trips.
- It fills the day to 111% of capacity and keeps a 30% standby list.
- It sets each next date on the earliest day with room after PUCAR's procedural gap.
- It keeps matters whose summons, notice or warrant is not back at the process desk, so nobody has to
  attend.
- It brings every 4+ year case before the bench at least once every 45 working days.

### Key decisions

- Today's way (status_quo_60, a flat 60-day gap for every due case) is the yardstick for every guardrail.
- A desk order on the fixed date keeps the date, as a magistrate would count it.
- A case with no date inside the quarter counts as a broken date. This closes the parking loophole (section 5).
- The planner ignores existing next dates, as the case study asks.

### Assumptions

[out/robustness.md](out/robustness.md) varies each assumption in `src/world/defaults.ts`. Attendance follows
a Beta distribution per person. Duration is lognormal with PUCAR's mean and a coefficient of variation of
0.5. Each kind of process has its own return time. Call times and reminders raise attendance, and wasted
trips lower it. Settlement chances do not respond to a settlement sitting.

## 4. Justify your complexity level (L3)

- The complainant, the accused and each advocate decide whether to come on each date (`src/world/`). Call
  times and reminders raise that chance, and wasted trips lower it. A warned complainant who stays away
  again can lose the case under s.279 BNSS.
- The planner learns of these decisions only from the court's record and builds the next list from it. A
  scheduler that wastes trips gets fewer people later in the quarter.
- The judge acts through rule sets for Sehgal's, Dimakar's and Joshi's ways, with 0 violations in about
  35,000 listings and next dates on seeds 31 and 32 (`out/styles-rules-check.txt`).

## 5. Results

### The winner against today's way on held-out seeds 31 to 60

The table gives means over 30 held-out seeds and paired differences with 95% t intervals
([out/HEADLINE.md](out/HEADLINE.md)).

| Measure | Winner | Today | Difference [95% CI] | |
|---|---|---|---|---|
| Useful hearings a day | 18.2 | 17.1 | +1.08 [+0.98, +1.18] | better |
| Cases decided on the merits | 89.3 | 84.9 | +4.40 [+3.26, +5.54] | better |
| Dates honoured (heard or desk order) | 94.9% | 92.0% | +2.93 pts [+2.54, +3.32] | better |
| Dates broken or never given | 166 | 245 | -79.3 [-91.0, -67.6] | better |
| Cases never heard | 380 | 240 | +140 [+128, +151] | **worse** |
| Old (4+ year) cases moved on | 30.8% | 29.2% | +1.60 pts [+1.40, +1.80] | better |
| Trips per useful hearing | 10.5 | 11.7 | -1.22 [-1.28, -1.16] | better |
| Minutes waited per person heard | 141 | 155 | -14.5 [-15.6, -13.4] | better |

### Against the case study's five dimensions

| Dimension | Reading | Winner | Today | Difference [95% CI] | |
|---|---|---|---|---|---|
| Utilisation | Court time used | 91.4% | 91.5% | -0.17 pts [-0.48, +0.13] | no clear difference |
| | Minutes past capacity | 297 | 180 | +117 [+85.6, +148] | worse |
| Predictability | Dates honoured | 94.9% | 92.0% | +2.93 pts [+2.54, +3.32] | better |
| | Held on the promised date, strict | 86.2% | 92.0% | -5.74 pts [-6.15, -5.33] | worse |
| Substantiveness | Reached hearings that moved the case | 32.9% | 30.9% | +1.98 pts [+1.84, +2.13] | better |
| Backlog-age impact | 5+ year cases at the end | 433 | 439 | -6.33 [-7.33, -5.34] | better |
| Next-date quality | Days of overshoot over PUCAR's gap | 42.7 | 50.7 | -7.96 [-8.06, -7.85] | better |
| | Next dates the case was not ready for | 34.1% | 33.8% | +0.28 pts [-2.46, +3.01] | no clear difference |

### Against the 60-day baseline

Today's way lists every due case and dates the next hearing 60 days out. The winner lists by value per
minute, keeps process-pending matters at the desk and dates next hearings at PUCAR's gap. The court gets
about 6% more useful hearings and 79 fewer dates broken or never given, but 140 more cases go unheard.

### How the selection rule changed

- The first rule maximised useful hearings a day behind 7 guardrails. Its winner, g921, gave 25.9 useful
  hearings a day but kept only 66% of promised dates and left 1,144 cases never heard (seeds 21 to 30, on an
  earlier copy of the court).
- The 14:05 patch to the rule had 10 guardrails. Its leaders kept 94 to 98% of promised dates because they
  gave 40 to 47% of the docket no date inside the quarter. That rule did not count a case with no date as a
  broken date.
- Four adversarial reviews (a magistrate's view, the scorecards, loopholes and statistics) found this loophole
  ([out/reviews/](out/reviews/)). They also found guardrails set against the best baseline instead of today's
  way, a self-relaxing cap, tolerances inside seed noise and five unguarded scorecard readings.
- We fixed the final rule at 14:15 and added the old-case guardrail at 14:36, both on tuning seeds, before
  anything ran on seeds 31 to 60.

### Where we lose

Under `criteria.json` the winner fails 1 of 19 guardrails on seeds 31 to 60. It leaves 140 more cases never
heard [+128, +151] against a margin of 150. This guardrail also failed on seeds 21 to 30. The rule still
keeps the pick. The process desk causes the loss, because a desk order is not a hearing. With the desk off, 168
fewer cases go unheard, but 80.8 more dates are broken or never given ([out/ablation.md](out/ablation.md)).
The old-case guardrail passes on the mean, as `criteria.json` defines it. The winner leaves 0 old cases
unheard on every seed, against today's average of 0.53. A stricter paired t-bound reading fails it.

These measures are also worse, and each interval excludes zero.

| Measure | Winner | Today | Difference [95% CI] |
|---|---|---|---|
| Matters deferred per sitting day | 0.47 | 0.00 | +0.47 [+0.43, +0.52] |
| Time used within capacity | 90.0% | 90.7% | -0.72 pts [-0.97, -0.47] |
| Days from 1 October to first heard | 43.4 | 40.6 | +2.81 [+2.60, +3.02] |
| Spread of daily minutes (CV) | 0.14 | 0.13 | +0.01 [+0.01, +0.02] |

[out/heldout.md](out/heldout.md) lists every loss and every rival that beats the winner on one measure. The
gains in useful hearings, merits disposals and dates honoured hold with behaviour responses off, other
duration spreads, slower process returns and roster seeds 1 to 5. Dates honoured stops being clearly better
only when the planner sees a P(substantive) 30% too low ([out/robustness.md](out/robustness.md)).

### The judge's dial and aims

This table shows the same engine at other settings on seeds 31 to 60.

| Measure | Today's way | g237 (the pick) | g237 with call times | Focused docket |
|---|---|---|---|---|
| Useful hearings a day | 17.1 | 18.2 | 18.7 | 23.1 |
| Cases given a date inside the quarter | 3,000 | 3,000 | 3,000 | 1,810 |
| Dates broken or never given | 245 | 166 | 211 | 1,469 |
| Cases never heard | 240 | 380 | 417 | 1,211 |
| Minutes waited | 155 | 141 | 23.4 | 20.1 |

Call times cut waiting to 23 minutes but add a guardrail failure on days that ran late. The focused docket
leaves 1,190 cases without a date this quarter. That choice belongs to the judge.

The judge can also pick an aim. We measured the aims on tuning seeds 1 to 6 ([out/aims.json](out/aims.json)).

| Aim | Useful a day | Merits disposals | Dates broken or never given | Never heard |
|---|---|---|---|---|
| Today's way, for scale | 16.8 | 82.2 | 265 | 262 |
| Balanced (the winner) | 17.9 | 86.5 | 159 | 365 |
| Most useful hearings | 22.4 | 144 | 1,492 | 1,225 |
| Finish the most cases | 12.1 | 183 | 1,998 | 1,809 |
| Keep every date | 17.6 | 81.0 | 82 | 340 |
| Reach every case | 18.8 | 83.7 | 317 | 56 |

Sehgal's, Dimakar's and Joshi's ways are editable rule sets laid over the winner. The preview shows every
scorecard with and without an edit. No edit can remove the 15% old-case floor. Dimakar's rules give 18.8
useful hearings a day but break or never give 553 dates ([out/styles.md](out/styles.md)).

### What the console shows

The console (`web-concepts/causelist`) shows tomorrow's list in call order, how many matters will likely go
ahead and how many will be reached before the court rises. It is standalone HTML that calls the engine API,
not a DRISTI screen. The judge approves the list before the court sends it to any advocate
(`out/README-assets/console-tomorrow.png`).

## 6. Specs for integration

[INTEGRATION.md](INTEGRATION.md) has the full detail.

- **Data schema:** The tool reads PUCAR's roster CSV, reference tables and calendar unchanged. The loader
  stops on a bad row. The output, `out/proposed_schedule.csv`, has PUCAR's causelist columns plus the
  call time, a standby flag, expected minutes, P(substantive) and the reasons.
- **Interfaces:** The tool has a CLI (`src/cli.ts`) and a deterministic JSON API (`src/serve.ts`, port
  8791) with routes such as `/api/plan`, `/api/simulate` and `/api/rules/preview`.
- **Dependencies:** The tool runs on Bun and TypeScript with zero runtime dependencies and calls no external
  service or model.
- **What's stubbed vs. real:** The planner, simulator, scorecards, rules, CSV and API are working code, and
  331 tests pass. The model assumes behaviour responses and process times. The tool does not yet store live
  outcomes.
- **What integration would take:** The engine would join DRISTI 2.0 as a workspace package behind six
  routes and four new tables. DRISTI does not yet record outcomes or process returns, so rollout would start
  from a nightly roster export and two to four weeks of shadow mode. We prepared a `dristi-v2` branch
  locally and have not pushed it.

## 7. How to run it

Run these from this folder (`submissions/benchtime`).

```bash
bun install
bunx tsc --noEmit                    # This runs the strict typecheck.
bun test                             # This runs 331 tests in about 90 seconds.

# This runs the winner against today's way on three held-out seeds in about 5 seconds.
# It writes out/arena.md and out/arena.json.
bun run src/cli.ts arena --seeds 31-33 --policies status_quo_60,benchtime_final

# This prints one day's list from the winner and writes out/proposed_schedule.csv.
bun run src/cli.ts day --date 2026-10-06 --policy benchtime_final

# This starts the engine API on http://localhost:8791.
bun run src/serve.ts

# In a second terminal, this starts the judge's console on http://localhost:8796.
# The console forwards /api/* to the engine.
bun run web-concepts/causelist/serve.ts
```

The full held-out tables are already in `out/`. The scripts in `scripts/` regenerate them.

## 8. What we'd build next

1. We would write a coverage rule that reaches the last 140 unheard cases and keeps the gain on broken dates.
2. We would run shadow mode on a real court's export, with outcome screens and e-post status as the feed,
   and refit the assumptions.
3. We would add part-heard continuation and a time budget per hearing type as rules.

---
**Checklist before you open your PR:**
- [x] No real case numbers, party names, or advocate names appear anywhere in this submission. Every case
  number, party and advocate comes from PUCAR's synthetic roster.
- [x] Everything lives under `submissions/benchtime/`.
- [x] This file is filled in, not left as a template.
- [x] Your code actually runs with the commands in section 7. We ran each one on 24 September 2026.
