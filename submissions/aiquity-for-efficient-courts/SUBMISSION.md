# Submission: aiquity-for-efficient-courts

## 1. Team

- **Team / solo name:** aiquity-for-efficient-courts
- **Members:** Sai Teja G
- **Complexity level claimed:** **L3**: behavioural agents (AI-driven parties and advocates) on top of an in-depth L2 engine. Beyond the ladder, an L4 town world model and L5 integration endpoints are built too; see section 4.

## 2. One-line summary

We maximise **justice-weighted case progress per hour of judicial time**: spend each of the judge's
420 minutes on the hearings most likely to go ahead *and* move a case forward. Old cases can
never be starved, because a floor on their share of the day cannot be configured away.

## 3. The approach

### In plain language
A judge's day fails in a chain: *listed → parties turn up → prepared → called before time runs out
→ the hearing moves the case → a sensible next date*. Current practice lists about 60 matters and
hopes; most of them fail somewhere in that chain. We treat every possible hearing as a
**probabilistic job** competing for scarce judicial minutes:

1. **Eligibility.** Don't list a case whose prerequisite (summons, warrant, filing) is known to be
   outstanding. Hold it back and say why.
2. **Prediction.** For each case, estimate P(it goes ahead), P(it moves forward), and the expected
   court minutes. These come from the organiser's per-hearing-type tables, adjusted for that case's
   own history.
3. **Prescription (MILP).** Choose which cases to list, in which slot, so as to maximise expected
   justice-weighted progress. Capacity is measured in *expected* minutes, so listing is rational
   rather than blind overbooking. Old cases get a guaranteed share, and an advocate's matters are
   grouped together.
4. **Appointments.** Every listing gets a time window, and an advocate's matters sit side by side.
5. **Next date.** The gap to the next date follows the procedural need of the next step and the
   reason the hearing failed, not a flat 60 days.
6. **Rolling horizon.** Dates are published up to 10 sitting days ahead and re-planned every
   evening as new information arrives.
7. **Simulation.** The court is run forward over the full ~2.5-month window (52 sitting days) with
   sampled durations and behaviour, so every metric is measured rather than asserted. Monte Carlo
   runs across seeds show the spread.

### Inputs
- `data/roster_sample_100.csv`, and our `data/roster_3000.csv` generated with the organiser script
  (`scripts/generate_roster.py --num-cases 3000 --seed 42`, a bootstrap of the 100 cases).
- `court_calendar.csv` (sitting days; judge leave is configurable per preset).
- `hearing_type_reference.csv` (duration, ideal gap, hearings per stage).
- `substantiveness_by_hearing_type.csv` (P(substantive) per type).
- `hearing_failure_reasons.csv`. Its reasons are grouped by *when they could have been known*:
  - **Prerequisite** (knowable before listing): awaiting process/summons/warrant, filing not ready, external dependency.
  - **Attendance** (decided on the day): party absent, both unready, time sought.
  - **Court-side**: administrative, holiday, unclear.
- The `last_hearing_summary` Present/Absent line is parsed into a per-case "accused absent last time" signal.
- `sample_causelist_2026-09-22.csv`: used as a shape check for our causelist output.

### Core logic: the model
For case *c* whose next purpose is type *t*:

- Prerequisite state: before each listing attempt, a prerequisite is outstanding with the observed
  probability for *t*. The court can see a configurable share of these in advance (default 80%);
  that is the process-tracking assumption.
- Conditional on prerequisites being met: `p_absent`, `p_seek_time` and `p_court` come from the
  observed reason mix. Case-level multipliers:
  - accused absent last time ×1.4
  - each consecutive adjournment ×1.15, up to 4
  - preparedness confirmed in advance ×0.5
  - a real appointment window ×0.85
- Correlated failure: an advocate can be unavailable for a whole day (5%), in which case all their
  matters fail together. The per-matter absence rate is reduced so the observed marginal is preserved.
- `p_ahead = 1 − (p_absent + p_seek)·m_c`, `p_sub = p_ahead·(1 − p_court)`, and expected minutes
  `e_c = p_ahead·duration_t + (1 − p_ahead)·1`.
- Duration on the day is lognormal around the reference minutes (σ = 0.5).

### Core logic: the optimisation (daily causelist MILP, PuLP + CBC)
**Value of listing case c** (justice-weighted expected progress):

```
v_c = P(substantive)_c × progress_c × J_c

progress (stage hearing s)  = 0.5 + 0.5 × cost(s) / R(s)      judgement (disposal) = 1.0
progress (interrupt i)      = 0.5 + 0.5 × cost(i) / (cost(i) + R(stage))
cost(t)                     = minutes(t) + (1/p_sub(t) − 1) × 2     (expected court minutes to get one success)
R(s)                        = Σ cost over the remaining lifecycle s → judgement
J_c (never below 1)         = 1 + w_age·age/4 + 0.5·max(0, hearings_at_stage/median − 1)
                                + w_wait·times_bypassed + 1.0 if 4+ yrs and unheard for 60 days
```

Two things are balanced here. The closeness-to-disposal term is the textbook
shortest-remaining-work rule for maximising completions; the 0.5 base credits any hearing that
moves a matter. We swept the base: at 0.15, disposals went up but total forward movement fell;
0.5 is the even split. The justice weight J raises old, stuck and repeatedly bypassed cases, and
it can never go below neutral.

```
max  Σ v_c·x_{c,s} + λ·Σ_a (n_a − u_a)                        (progress + advocate-clustering bonus)
s.t. Σ_s x_{c,s} ≤ 1                                            (a case once a day)
     Σ_c e_c·x_{c,s} ≤ capacity_s                               (slot capacity, expected minutes)
     Σ x ≤ max_listed
     u_a ≥ (advocate a has a matter today)
     Σ_{c old} e_c·x ≥ α·Σ_c e_c·x                              (ageing floor; α ≥ 20%, default 25%, or "auto")
```

The rolling horizon adds `x_{c,d}` over the next 10 sitting days, with daily expected-capacity
constraints, a per-advocate daily load cap, a preference for sooner dates, and stability of
already-published dates. Only day 1 is executed; the rest are published as provisional dates.

### Judges shape their day, within guardrails
Judges genuinely differ. Some sit straight through with no lunch break; some hear matters only
in the morning and do administrative work after lunch. A **day profile** (per weekday: sittings,
lunch, administrative blocks) captures this in YAML; see `config/morning_bench.yaml` and
`config/marathon_bench.yaml`. Capacity, appointment windows and the day's clock follow the
profile, and the scorecard shows each profile's cost against a 6-hour norm.

What a judge **cannot** configure away:
- an average of at least 3.5 hours of hearings per sitting day;
- 2 to 7 hours on any sitting day;
- the ageing floor (at least 20% of hearing time for 4+ year cases);
- the emergency reserve;
- the prerequisite checklists.

A profile that breaks a guardrail is rejected with the reason.

### Who is hearing it, and how fresh is the file
Hearing time is not only a function of dispute type and stage.
`minutes = reference(type) × judge_factor × recency_factor`:
- **Judge background.** A judge from the criminal bar is quicker on trial stages (×0.85); one from
  the civil bar is slower at first (×1.10); career judges are quick on procedure (×0.90).
- **Experience.** A new bench takes about 20% longer, decaying with years on the bench (half-life 2 years).
- **Recency.** A matter heard two days ago is up to about 25% faster, because the facts are fresh. A
  file untouched for 4+ months needs re-reading: +10%, or +20% for a 4+ year case.

The same model drives the planner's expected minutes *and* the simulated hearing, so short
return dates are rewarded. See the preset `new_judge_from_criminal_bar`.

### What the court assumes: a priors master list
There are three inspectable layers per hearing type, and each overrides the one below:
1. The organiser tables.
2. The court's own master list, `config/priors/court_default.yaml`, with a `source` on every row.
   Staff edit it as their records improve.
3. A judge's overrides under `priors:` in their preset, for example "my evidence sessions run 40
   minutes" or "arguments ×1.2".

The effective table drives both the planner and the simulator. When learning is on, it is the Beta
prior, and the export reports prior vs learned per type.

### By dispute type
Hearing time and the chance of turning up also depend on the kind of dispute, not only on the stage.
The court master list carries a factor per kind, and a judge can override them under
`priors.dispute_kinds`:

| Kind of dispute | Hearing time | Chance of missing a date |
|---|---|---|
| Not recorded (the reference: the organiser roster has no dispute-type column) | ×1.00 | ×1.00 |
| Cheque / loan | ×1.00 | ×1.00 |
| Supplier | ×1.15 | ×0.90 |
| Unpaid wages | ×0.90 | ×1.25 |
| Rent | ×1.00 | ×1.10 |
| Family / property | ×1.30 | ×1.15 |

All of these are stated assumptions. **The organiser data does not record the dispute type**: its
per-stage tables are dispute-agnostic, so roster cases get the neutral reference factor (no
adjustment, no bias toward any kind). New filings from the town carry their own kind. If a court's
roster has a `dispute_type` or `case_type` column, `roster.py` reads it and the factors apply
automatically. The planner, the simulator and the behaviour model all use them.

### Interrupting hearings: bail, reports, applications
After any called hearing, an interrupting application can be filed at the rate it occurs in the pilot
court: bail 5.0%, reports 4.6%, applications 1.5% of hearings (estimated from the organiser's failure
table). **Bail is barred once complainant evidence begins**, and urgent bail mentions respect the same
rule. After the interrupt is disposed of, the case returns to exactly the step it was heading for.
Every interrupt is in the audit log.

### The town shapes the court day
The world model does not just feed filings.
- **Each party's situation changes whether they turn up:** their distance from the court complex,
  their frustration from wasted trips, and what a day in court costs them in wages.
- **Town-wide events keep a stated share of people away:** a transport strike 55%, heavy rain 30%.
- **The plan does not know in advance,** exactly as a real court does not, so matters fail on the
  day, standby is called, and next dates re-plan.

See `world/coupling.py` and the scenario results in §5.

### What this posting can close: the case runway
For every case the runway records:
- the stages left and the hearings they typically need;
- the fastest and the typical calendar path under the procedural gaps;
- how many times it could come before the judge in the window;
- how many times it actually did;
- whether it was closed.

On the 3,000 roster over a 74-day posting with a 6-hour court day:
- 2,004 cases *could* reach judgement on the fastest path, and only 329 at the typical pace.
- The recommended list disposed 369, against 332 under current practice.
- **2,086 cases never came before the judge at all** (1,654 under current practice, which lists more but hears fewer). The roster is larger than the posting, which is
  exactly why the choice of what to hear matters.

### Parties can ask for a date
At the hearing, through the court master, or ahead of it through check-in, each side can name dates
it prefers or cannot come on. The engine picks the first sitting day that suits both sides, inside
the rule: never earlier than the procedural date, and at most 14 days later (7 for cases over
4 years old). If no day fits, the rule's date stands and the reason is shown. See
`actions.apply_preferences` and `POST /api/next-date` with `preferences`.

### Court operations the plan must survive
- **Emergency quota.** Every day 30 minutes (configurable) are reserved for urgent matters (bail,
  stay, urgent mention). Urgent arrivals are heard from the reserve first. Unused reserve is
  released to standby matters, so it is never idle.
- **Judge emergencies.** When the judge loses part of a day, the unheard tail is rolled to the
  next sitting day *with priority*. It is logged as "judge emergency" and never counted against
  the parties.
- **Prerequisite checklists.** There is one checklist per purpose of hearing (`config/checklists.yaml`),
  and a judge can copy and edit their own. A case with an unmet item is not listed, the item is named,
  and it loses any reserved date until the item clears.
- **Learning as the court runs.** Attendance and readiness are Beta-Bayesian estimates per advocate,
  per party and per hearing type × stage. The organiser tables are the prior, and every outcome
  updates them. The planner uses the posterior for P(goes ahead) and for how much risk buffer to book.
- **Learning: an honest result.** In a simulation generated *from* the organiser tables there is
  little to learn beyond the tables. On the 3,000 roster, the learned P(goes ahead) scores a Brier of
  0.147 against 0.146 for the static estimate. Its extra caution (it notices the correlated
  advocate-day absences) makes the planner overbook, so more matters go unreached: 18% of delays
  against 11%. Learning is **on in the recommended setup** (the published results include it, with
  that cost) and is a one-line toggle (`learning: false`). In a test world
  where behaviour departs from the tables (30% of advocates miss 35% of the hearings they would have
  attended), it improves the Brier from 0.222 to 0.200. That is its real job: tracking a live court
  as it drifts away from any static table.
- **People gaming the system.** A stated share of advocates seek time strategically as a case nears
  evidence or judgment. Detection compares each actor's time-seeking with what their hearing mix
  predicts, and flags only when the posterior probability of exceeding 1.5× is above 0.9. The response
  is a firm, short next date and then a "last chance". **The other side is never penalised**, and the
  judge sees the evidence, not an accusation. Honest limit: on the 3,000 roster an advocate appears
  only about 1.4 times in 52 sitting days, which is too little history to flag anyone. The rule
  deliberately needs at least 3 own-side requests. It is built for a court's multi-year hearing log,
  and the tests exercise it on synthetic histories.
- **Who is the delay?** Every lost hearing is attributed to a stakeholder: petitioner side,
  respondent side, both, **state agencies** (process service, police, forensics, external), court,
  judge emergency, or time running out. It is counted in hearings *and* in court minutes lost.
- **Audit log.** Every decision is logged with the rule that made it and why, including before and
  after values: listed, held back, rolled over, rescheduled, next date, urgent, emergency, last
  chance, standby, withdrawn. Attribution and causality are inspectable for every case.
- **Hearing phases.** Each hearing's sampled duration is split into call and appearance check,
  submissions or evidence, and order dictation. The court clock can show where the minutes go.

### Key decisions
- **Effective, justice-weighted efficiency over raw utilisation.** A busy judge is not the goal; a
  judge whose minutes move the right cases is.
- **Maximising progress per minute alone favours fresh, easy cases** (a Goodhart trap). So age and
  time stuck at a stage raise a case's weight, *and* a hard floor reserves a share of the day for
  4+ year cases. The share is 25% by default, the judge may raise it or set it to "auto" (derived
  from the roster's age mix), and it can never go below 20%.
- **Prediction is separated from prescription.** Any better predictor, whether a trained model,
  the court's own history, or agent signals, plugs in without touching the optimiser.
- **Capacity in expected minutes.** A 10-minute matter with a 40% chance of going ahead costs
  about 4.6 expected minutes. This is how the day ends up packed, not overbooked.

### Assumptions (all explicit, all in code as named constants)
| Assumption | Value | Where |
|---|---|---|
| Simulation window | 52 sitting days, 2026-09-28 → 2026-12-11 (court calendar holidays applied) | `simulate.py` |
| Judicial minutes per day | 420 | `config/*.yaml` |
| "Old" case | 4+ years since filing (5+ is also tracked) | `config.py` |
| Ageing floor | ≥ 25% of listed expected minutes to 4+ yr cases by default; judge may raise it or choose "auto"; **never below 20%** | `config.py` |
| Share of unmet prerequisites visible in advance | 80% (process-service tracking) | `config.readiness_visibility` |
| Advocate unavailable all day | 5% per advocate-day (all their matters fail together; per-matter absence reduced to keep the observed marginal) | `behaviour.py` |
| Accused absent last time | absence ×1.4 | `behaviour.py` |
| Each consecutive adjournment | absence/seek ×1.15, up to 4 | `behaviour.py` |
| Preparedness confirmed in advance | absence/seek ×0.5 | `behaviour.py` |
| Real appointment window | absence/seek ×0.85 | `behaviour.py` |
| Call-over of a matter that doesn't go ahead | 1 minute | `planning.py` |
| Called, present, adjourned | 3 minutes | `planning.py` |
| Hearing duration | lognormal, mean = reference minutes, σ = 0.5 | `simulate.py` |
| Risk buffer when packing a day | +1 standard deviation of the day's uncertain minutes | `planning.py` |
| Standby matters | called only if ≥ 10 minutes remain; only advocates already in court or confirmed ready | `simulate.py` |
| Horizon | 10 sitting days, re-planned nightly; ≤ 6 matters per advocate per day | `horizon.py` |
| Stage progression | a substantive hearing moves to the next stage; judgement disposes; bail/reports/application review return to the current stage; repeated non-appearance at summons escalates to warrant | `reference.py`, `simulate.py` |
| 3,000 roster | bootstrap of the 100-case sample with the organiser's script, seed 42 | `data/roster_3000.csv` |

**Calibration check** (in the test suite): under current practice, the simulated P(substantive | called)
per hearing type stays within 12 percentage points of the organiser table for every type with 40 or
more observations. For example, warrant hearings come out at 17% against 13.5%.

## 4. Justify your complexity level
- **L2 (dynamic + realistic data):**
  - **Distributions:** sampled hearing duration; per-type attendance, time-sought and court-side
    failure rates from the real tables; prerequisite state; correlated advocate-day absence;
    per-case adjustment from history.
  - **Costs and constraints:** expected-minute capacity, the ageing floor, the advocate-clustering
    bonus against its correlated-risk cost, purpose blocks, max listings.
  - **Changes with new information:** rolling re-planning every evening; published dates.
  - **Judge overrides:** presets for three real styles (block scheduler, clusterer, fresh-first).
    The Simulation page lets the judge pin or move cases, overbook, change floors and weights, and
    add leave, and shows the cost against the optimum.
- **L3 (behavioural):** advocates and litigants as agents with personas (diligence, caseload,
  reliability, travel distance, lost wages, trust). They decide whether to confirm preparedness,
  appear, or seek time. They remember wasted trips, which changes their future behaviour. Engines:
  transparent rules (default, offline), a typed decision model, or an LLM for richer structured
  decisions, all cached for reproducible replays.

  What the agents show (100-case roster, rules engine, `optimal` plan):

  | Policy | Appeared | Ready | Substantive hearings |
  |---|---|---|---|
  | No appointments, no confirmations | 57.8% | 46.2% | 177 |
  | Confirmations only | 60.4% | 49.4% | 179 |
  | Appointments only | 67.5% | 53.2% | 196 |
  | **Appointments + confirmations** | **71.7%** | **58.6%** | **218** |

  Giving people a real time window is the biggest lever. Asking advocates to confirm preparedness
  adds more on top. The live LLM run (32 recorded calls, replayable offline) is more pessimistic
  than the statistical model: mean P(absent) 0.33 vs 0.22. That is exactly the kind of gap a
  court's own annotation data should settle.
- **AI inside the court, visible to the judge:**
  - **Court day.** The demo court day is run with every party and advocate as an **AI agent** (an LLM
    through a JSON contract, 10 recorded days that replay offline). Each decides whether to turn up,
    whether they are ready, whether to seek time and how long it will take, and **says why**. Their
    decisions feed back into the plan: next dates, standby calls and re-dating.
  - **Court assistant.** An AI agent the judge can ask: "Why is this matter listed?", "What went wrong
    today and what should I change?", "Who caused today's delays?". It answers **only from the day's
    record** (causelist, outcomes and the audit log with the rule behind each decision), cites case
    numbers, and **proposes and tests changes**. It picks at most 3 changes to the judge's *own* settings,
from an allowed list and inside the guardrails: reserve minutes, how full to list, minimum time for old
cases (never below 20%), grouping by advocate, holding back unready matters, and so on. The engine then
re-runs the same court with the proposal and shows the effect before anything is applied
(`POST /api/assistant`). It never changes the schedule itself: the judge decides.
    It is live through `POST /api/ask`, with recorded answers for the demo days and a rule-based
    fallback offline (`assistant.py`).
- **L4 (world model):** a synthetic town whose relationships generate disputes. Some settle, some
  become complaints that enter the court at Admission. Every hearing costs the people involved a
  trip and lost wages. The board lets you scrub to any day and see the town, the court and the
  people, or follow one dispute from first quarrel to judgment.

### A schedule is a promise to people: what they see, what they can do
The judge's minutes are the scarce resource, but every wasted minute is multiplied across the
people waiting outside. `access.py` measures both sides of that promise.

- **What people see:**
  - date certainty: they were called on the day they were told;
  - a real time window instead of an all-day wait;
  - a missing prerequisite known *before* travelling, not discovered in court;
  - a stated reason for every listing and next date.
- **What they can do, and what it costs them:**
  - hours of life per hearing that moved the case (travel + waiting);
  - wasted trips;
  - the actions open to them: confirm readiness ahead (check-in), be told of a missing item before
    travelling, keep a real window, get a short firm date after a time request, see their date
    published days ahead.

On the 3,000-case roster over 2.5 months, with 2 h travel per person per trip, a 5 h all-day wait
without a window, and 2 people per listing:

| | Current practice | Recommended list |
|---|---|---|
| Called on the day they were told | 43.1% | 90.5% |
| Given a time window | 0% | 100% |
| Missing prerequisite known before travelling | 75.1% | 92.5% |
| Mean wait at court | 5.0 h | 0.46 h |
| Hours of people's lives per hearing that moved the case | **59.1 h** | **7.9 h** |
| Hours of people's lives spent in total | 43,680 h | 6,068 h (**≈ 37,600 h saved**) |
| Wasted trips (came, nothing moved) | 4,762 | 924 (**3,838 avoided**) |

### How the layers connect, in one simulation
`python -m causelist.combined` runs every layer together, and the web views read that single run:
- the **town** (L4) files the cases and shapes who can come;
- every party and advocate is an **AI agent** (L3) with a persona and memory. It is given the
  situation (its window, whether readiness was asked, its wasted trips, what a day in court costs
  it) and chooses, in a JSON contract, whether to come, whether it is ready, whether to seek time
  and how long it will take, with its reason;
- the **recommended list** (L2) plans each day, re-plans every night, calls standby and re-dates;
- a **transport strike** lands mid-run and nobody knows in advance.

What the judge sees in Court day, the Observatory, World and People is therefore one world, and the
agents' decisions move the plan. The 3,000-case results in this section use the statistical model
(the AI engine is too slow for 3,000 cases × 52 days in a day's hackathon). The combined AI run is
100 cases × 20 sitting days, recorded and replayable offline.

### L5: plugs into the court
The layer is designed to be bolted onto a court's systems rather than to replace them.

**Built:** the three court actions as an API.
- **Roster in:** upload a court's roster CSV, validated against the organiser schema.
- **Causelist out:** a day's list with time windows and a CSV.
- **Next date out:** the suggested date with its rule and the alternatives.

The readiness confirmation that advocates give two days ahead is the first form of **web check-in**.

**Next:** read the roster and hearing history straight from the court's case system; offer
check-in and cancellation through portals and SMS; and re-pack the day automatically when someone
cancels, the way travel portals re-pack a flight.

### Every setting, who can change it, and whether it is learned

| Group | Setting | What it does | Default | Range | Who can change it | Learned? |
|---|---|---|---|---|---|---|
| Court day | Hearing minutes in a day (`day_minutes`) | Capacity of the day (follows the day profile). | 420 | 120-420 | judge (per setup) | no |
| Court day | Day profile (`day_profile`) | Sittings, lunch and administrative time per weekday. | None | guardrails below | judge (per setup) | no |
| Court day | Minutes kept for urgent matters (`reserve_minutes`) | Held back every day for bail, stays, urgent mentions. | 30 | 0-120 | judge (per setup) | no |
| Court day | Urgent matters expected per day (`urgent_per_day`) | Simulation: how many urgent matters arrive. | 1.5 | 0-10 | judge (per setup) | no |
| Court day | Chance the judge is called away (`judge_emergency_p`) | Simulation: part of a day lost; the rest rolled with priority. | 0.03 | 0-1 | judge (per setup) | no |
| Overbooking | Fill target (`fill_target`) | Share of hearing time to plan for. | 1.0 | 0.5-1.0 | judge (per setup) | no |
| Overbooking | How full to list the day (`overbook`) | Lists this multiple of the expected minutes (1.0 = to capacity). | 1.0 | 0.9-1.3 | judge (per setup) | no |
| Overbooking | Safety buffer (`risk_kappa`) | Extra expected minutes, in standard deviations of the day's uncertainty. The minutes are recomputed daily from that day's matters. | 1.0 | 0-2 | judge (per setup) | the minutes adapt daily; with learning on, the chances behind them are learned |
| Overbooking | Most matters on one day's list (`max_listed`) | Hard cap on listings. | 60 | 10-60 | judge (per setup) | no |
| Fairness | Minimum time for old cases (`ageing_share`) | Share of the day's expected minutes for cases over 4 years old; 'auto' follows the roster. | 0.25 | 20%-60% or auto | judge above the floor; the floor is fixed | no |
| Fairness | Priority for age (`weights.age`) | How much older cases are raised. | 1.0 | >= 1.0 | judge above the floor; the floor is fixed | no |
| Priority | Priority for being passed over (`weights.wait`) | Raises a matter each time it is listed and not reached. | 0.5 | 0-3 | judge (per setup) | no |
| Priority | Priority for fresh matters (`weights.fresh`) | Raises early-stage matters (the fresh-first style). | 0.0 | 0-3 | judge (per setup) | no |
| Priority | Group each advocate's matters (`weights.cluster`) | Reward for listing an advocate's matters on the same day. | 0.3 | 0-2 | judge (per setup) | no |
| Priority | Value of a hearing that moves (`weights.substantive`) | Scale of the value of progress. | 1.0 | fixed at 1 by default | judge (per setup) | no |
| Readiness | Hold back matters that are not ready (`use_readiness`) | Do not list while a summons, warrant or filing is known to be outstanding. | True | on/off | judge (per setup) | no |
| Readiness | Share of missing prerequisites the court can see (`readiness_visibility`) | How many unmet prerequisites are known before listing (process tracking). | 0.8 | 0-1 | court (master list) | no |
| Readiness | Checklist template (`checklists`) | Which prerequisite checklist per purpose of hearing applies. | default | config/checklists.yaml | judge (per setup) | no |
| People | Give every matter a time window (`give_appointments`) | An appointment window instead of an all-day wait. | True | on/off | judge (per setup) | no |
| Dates | What happens to a matter not reached (`carry_over`) | priority (next day, raised) / same weekday next week / none. | priority | 3 options | judge (per setup) | no |
| Dates | Next-date rule (`next_date_policy`) | procedural (matched to the next step) or flat (a fixed gap). | procedural | 2 options | judge (per setup) | no |
| Dates | Flat gap (`flat_gap_days`) | Used only by the flat rule (current practice: 60). | 60 | 1-120 | judge (per setup) | no |
| Dates | Plan dates ahead (`use_horizon`) | Rolling 10-day date plan, re-planned nightly. | True | on/off | judge (per setup) | no |
| Dates | Days planned ahead (`horizon_days`) | Length of the rolling date plan. | 10 | 5-20 | judge (per setup) | no |
| Learning | Learn as the court runs (`learning`) | Updates each advocate's, party's and hearing type's chance of going ahead after every hearing. | True | on/off | judge (per setup) | yes: this is the learning |
| Simulation | An absent advocate misses all their matters (`advocate_correlation`) | Correlated absence (5% per advocate-day). | True | on/off | court (master list) | no |
| Simulation | Share of advocates who seek time strategically (`gaming_share`) | Simulation only. | 0.08 | 0-0.5 | court (master list) | no |
| Fairness | Respond to strategic delay (`gaming_response`) | Firm short date and a last chance for the requesting side; the other side is never penalised. | True | on/off | judge (per setup) | flags are learned from the record |
| Simulation | State-agency delays (`agency_delay_mult`) | Multiplies delays from process service, police and forensics. | 1.0 | 0.5-3 | court (master list) | no |
| Judge | Judge background and experience (`judge`) | Background (criminal bar, civil bar, judicial service, academic), years on the bench, specialisations: changes hearing time. | None | see duration model | judge (per setup) | no |
| Judge | Judge overrides of the court's master list (`priors`) | Per hearing type: minutes, gap, chance it moves; per dispute type. | None | bounded | judge (per setup) | the effective values are the prior for learning |

**Fairness floors that cannot be dragged:**

- **Minimum time for old cases:** never below 20% of the day's expected minutes when old cases are waiting
- **Priority for age:** never below 1.0 (an old case is never ranked below neutral)
- **Hearing time per week:** an average of at least 3.5 hours a sitting day
- **Hearing time per sitting day:** between 2 and 7 hours
- **Emergency reserve:** always taken out of planning capacity when set
- **Prerequisite checklists:** a matter with a known unmet item is never listed and loses its reserved date
- **The other side:** a strategic-delay response never penalises the side that did not ask for time

**How the chances are estimated:**

1. **Where the chances start:** The organiser's per-hearing-type tables: share of hearings that moved, and the reasons the rest did not (prerequisite, attendance, court-side).
1. **Chance it goes ahead:** 1 - (chance of absence + chance time is sought) x case adjustments; absence x1.4 if absent last time, x1.15 per adjournment in a row (up to 4), x0.5 if readiness confirmed, x0.85 with a time window; dispute type and town conditions also multiply.
1. **Chance it moves forward:** chance it goes ahead x (1 - chance of a court-side problem).
1. **Expected minutes:** chance it goes ahead x usual length (hearing type x judge x recency x dispute type) + otherwise 1 minute to call it.
1. **Uncertainty for the buffer:** each matter's minutes are uncertain (it may not go ahead, and its length varies); the day's total spread sets the buffer.
1. **Learning (when on):** Beta-Bayesian estimates per advocate, party and hearing type x stage, starting from the tables and updated after every hearing; the planner then uses the learned chance.
1. **On the day (simulation):** hearing length is drawn around the usual length (spread 0.5); attendance from the chances above, or from the AI agent's own stated chances.

Settings live in config/<setup>.yaml; the court master list in config/priors/court_default.yaml; checklists in config/checklists.yaml.

## 5. Results

All numbers come from the 3,000-case roster over 52 sitting days (2026-09-28 → 2026-12-11). Every
setup sits the same court day: 10:00–13:30 and 14:00–16:30, 6 hours of hearings. Every operational
friction is on:
- a 30-minute emergency reserve and urgent arrivals;
- judge emergencies;
- correlated advocate absence;
- interrupting applications;
- a duration model driven by judge and recency.

The first number is seed 42; the bracket is the range over three further simulated runs. Every run
reproduces exactly with `python -m causelist.precompute`.

| Measure | Recommended list | Current practice | Block scheduling | Cluster by advocate | Fresh matters first | Morning bench | Full-day bench | New judge (criminal bar) |
|---|---|---|---|---|---|---|---|---|
| Progress per court hour (age-weighted) | 6.519 (6.476–6.584) | 5.28 (5.253–5.299) | 5.704 | 6.333 | 6.196 | 7.044 | 6.555 | 6.326 |
| Court time on hearings that moved % | 90.2 (90.3–91.2) | 91.3 (89.9–93.7) | 85.1 | 89.3 | 84.9 | 84.1 | 88.7 | 90.3 |
| Court time used % | 92.6 (92.6–94.2) | 93.0 (91.7–95.8) | 87.9 | 91.7 | 90.0 | 86.8 | 91.6 | 92.5 |
| Called on the day given % | 91.2 (90.7–92.8) | 43.1 (44.0–47.3) | 99.3 | 92.5 | 95.4 | 89.9 | 91.7 | 91.4 |
| Heard matters that moved % | 83.6 (81.3–84.1) | 86.4 (83.8–87.2) | 81.4 | 83.0 | 76.0 | 82.7 | 81.0 | 84.5 |
| Matters that moved forward | 818 (817.0–873.0) | 739 (733.0–752.0) | 790 | 781 | 1127 | 510 | 817 | 785 |
| Cases disposed | 369 (366.0–373.0) | 332 (321.0–335.0) | 297 | 362 | 252 | 177 | 367 | 369 |
| 4+ yr cases heard % | 57.1 (56.2–56.5) | 49.6 (49.9–50.8) | 48.6 | 57.7 | 42.9 | 36.5 | 56.9 | 55.3 |
| 5+ yr cases still pending (436 at start) | 262 (264.0–275.0) | 324 (322.0–323.0) | 274 | 265 | 274 | 322 | 264 | 271 |
| Mean next-date gap (days) | 18.0 (17.4–17.8) | 57.4 (56.2–60.3) | 19.8 | 17.6 | 18.5 | 20.2 | 17.9 | 17.2 |
| Next dates that fit the next step % | 76.9 (74.9–76.8) | 69.2 (65.3–68.6) | 78.7 | 81.9 | 76.6 | 74.1 | 76.0 | 76.3 |
| Advocate trips | 1219 (1234.0–1290.0) | 3043 (3039.0–3042.0) | 811 | 1145 | 1768 | 767 | 1223 | 1154 |
| Listed per day | 25.4 (26.0–27.7) | 60.0 (60.0–60.0) | 23.5 | 24.7 | 36.9 | 16.3 | 26.5 | 24.2 |

**Recommended list against current practice** (list 60, attempt everything, flat 60-day next date):
- **+23% progress per court hour:** 6.52 vs 5.28, and the ranges across runs do not overlap.
- **+11% matters that moved forward:** 818 vs 739.
- **+11% cases disposed:** 369 vs 332.
- **Called on the day they were given:** 91% vs 43%.
- **Next date:** 18 days, matched to the next step, instead of 57.
- **Advocate trips:** 60% fewer, 1,219 vs 3,043.
- **5+ year backlog:** 436 → 262 pending, vs 324.
- **Honest trade-offs:**
  - *Court time on hearings that moved* is level (90% vs 91%). Current practice fills the day by
    overbooking 60 matters and leaving most of them unreached.
  - "Heard on first listing" favours current practice for the same reason. Reach rate is the honest
    companion number.

**What each judge's style costs** (the "change the recommended list" view):
- **Fresh matters first:** the most matters moved (1,127), because easy matters move. But the fewest
  disposals among the full-day setups (252) and the worst old-case reach (43%). The non-configurable
  ageing floor is what stops it being worse.
- **Block scheduling:** the most predictable, with 99% called on the day given and the fewest trips
  (811), at the cost of disposals (297).
- **Cluster by advocate:** close to the recommended list, with fewer trips.
- **Morning bench:** the highest progress *per hour it sits* (7.0), but on half the hearing time it
  disposes 177 cases against 369. The dashboard shows the cost of every hour moved to administration.
- **New judge from the criminal bar:** matches the recommended list on disposals (369). Quick trial
  stages offset the new-bench penalty.

**Who the delay is:**
- **Current practice:** 69% of lost hearings are simply *never reached*.
- **Recommended list:** unreached falls to 19%. What remains is real friction:
  - the two party sides (30%);
  - both sides unready (19%);
  - court-side (15%);
  - **state agencies** (12%: summons, warrants and reports the court cannot fix by scheduling);
  - judge emergencies (5%).

**What people see and what it costs them:** see §3. Hours of people's lives per hearing that moved
the case fall from 59.1 to 7.9, about 37,600 hours saved over the posting. 3,838 wasted trips are
avoided.

**When the town changes, the court day changes** (the town coupled in, 3,000 roster):
- **Transport strike (3 days):** on 14 October, 14 parties could not reach court instead of 0, and
  only 7 matters moved instead of 11.
- **Monsoon week:** the same pattern across five days.
- **Across the posting,** re-planning re-dates the lost matters quickly, so the posting still closes as
  many cases (371 and 372, against 361 in a normal run of the coupled model). The shock lands on
  people's trips and days, and the plan absorbs it.

**Visualisation:** the web app (`web/`) shows this to a judge in court language:
- **Bench view:** the judge's screen for the matter being heard. It shows the stage on the case's
  lifecycle, both sides (present or absent, their record, what they said), the checklist, and the
  suggested next date with its rule and the alternatives.
- **Court master:** the court master's screen for running the day. It covers roll call (each side
  present, absent or not ready), passing over and re-ordering, and rescheduling a matter with the
  suggested date, the alternatives and a reason. It also shows the running effect (minutes freed,
  standby matters that can be called, people affected) and a log of every change for the record.
- **How we schedule:** a six-step walkthrough of the algorithm, its dynamics and its scores, with the
  maths in plain words.
- **Court assistant:** describe a problem, get a change, and test it on your court.
- Home.
- Court day: planned against actual on one clock, with a "Changes today" log showing each change's impact.
- What people see.
- Simulation: change the recommended list and see the cost.
- Backlog.
- Who is the delay.
- Profiles, with each person's calendar.
- What the court assumes (the priors master list).
- What this posting can close (the runway).
- Audit.
- Observatory: town, court and people on one clock.
- World: a dispute followed from the first quarrel to court, and the town-events panel.
- A case file for every case.

## 6. Specs for integration
- **Input schema:** exactly the organiser's roster CSV columns (`case_number, filing_number,
  filing_date, advocate_id, party_id, current_stage, last_hearing_summary, purpose_of_next_hearing,
  hearings_<type>…, total_hearings_held`), plus the four reference tables and the calendar,
  unchanged. Optional per-case fields a court system can add later: prerequisite status
  (process/warrant served), readiness confirmation, and a published date.
- **Output schema:** `causelist_<config>.csv`, one row per listing: `date, slot, window_start,
  window_end, case_number, purpose, advocate_id, expected_minutes, p_goes_ahead, p_substantive,
  why_listed, simulated_outcome, reason, recommended_next_date`. Plus `scorecard.json` and
  `flags.json` (ageing at risk, repeat adjournments, stuck at stage).
- **Interfaces:**
  - Python package (`causelist`) with three stable seams: `planning.PLANNERS` (plug a planner),
    `interfaces.Behaviour` (plug a predictor or behaviour model), and `interfaces.InflowSource`
    (plug a filing stream).
  - A CLI for batch runs.
  - A local HTTP API (FastAPI). The three court actions are:
    - `POST /api/roster/upload`: a court's own roster CSV, validated against the organiser schema;
    - `POST /api/roster/generate`: a synthetic roster of any size;
    - `POST /api/causelist`: a day's causelist for any roster, setup and date, with a CSV;
    - `POST /api/next-date`: the next best date for a case and today's outcome, with the rule and alternatives.

    The rest are `/api/run`, `/api/compare`, `/api/presets`, `/api/annotations`, `/api/ask` and
    `/api/assistant`. The same functions are in `actions.py`.
  - A Next.js web app. It works as a static site from precomputed JSON, and uses the live API for what-if when that is running.
  - Judge rules are YAML files, so there are no code changes to reconfigure.
  - Judge annotations on predictions are written to `out/annotations.csv`, as the data loop for recalibration.
- **Dependencies:** Python 3.11+ (pandas, numpy, PuLP with its bundled open-source CBC solver, PyYAML,
  FastAPI + uvicorn, httpx, pytest), and Node 20+ for the web app (Next.js, React, Tailwind,
  three.js / react-three-fiber, framer-motion, recharts). No external service is required. The LLM
  engine is optional (key via env var) and falls back to rules.
- **What's stubbed vs real:**
  - **Real:** the planners (MILP, greedy, baseline), the rolling horizon, standby backfill, the simulator, the metrics, Monte Carlo, the independent schedule validator, the judge presets, the live what-if API, the static web app, the L3 agents (rules engine and a live LLM engine with 32 recorded calls, replayable offline), and the L4 town model.
  - **Simulated, not observed:** everything *outcome*-side. Attendance, readiness, durations and prerequisite status are sampled from the organiser's tables with the stated assumptions; there is no real court feed.
  - **Not built:** SMS/portal delivery of appointment windows, real readiness confirmations from advocates, case summarisation, multi-courtroom advocate conflicts, authentication and a database. Judge annotations are stored in a CSV.
- **What integration would take:**
  1. Read the day's roster and hearing history from the case-management database instead of CSVs,
     using the same fields.
  2. Feed process-service status and advocate confirmations into the prerequisite and readiness
     fields.
  3. Recalibrate the per-type rates from the court's own hearing log. The code already consumes
     these as tables.
  4. Run the planner nightly, then publish the causelist and each party's appointment window via
     SMS or portal.
  5. Store the judge's overrides and annotations and learn from them.

## 7. How to run it

```
cd submissions/aiquity-for-efficient-courts
pip install -r requirements.txt

# 1. scorecard on the 3,000-case roster: recommended list vs current practice vs the three judges' styles
PYTHONPATH=src python -m causelist.cli --roster data/roster_3000.csv --config optimal --compare baseline block_schedule cluster_by_advocate fresh_matters_first

# 2. tests: determinism, schedule validator, calibration against the organiser tables
PYTHONPATH=src python -m pytest

# 3. the web app (reads precomputed JSON; regenerate with: PYTHONPATH=src python -m causelist.precompute)
cd web && pnpm install && pnpm build && pnpm start          # http://localhost:3000

# optional: live what-if engine for the web app (in another terminal, from submissions/aiquity-for-efficient-courts)
PYTHONPATH=src uvicorn causelist.api:app --port 8000
```

## 8. What we'd build next
- **Flags on a schedule or on demand.** Daily, weekly and quarterly checks over the roster:
  ageing drift, stuck cases, repeat adjournments, gaming patterns, agency bottlenecks. Each flag
  links to its audit trail.
- **Integration with court systems and public APIs.** Read the roster and hearing history from the
  case information system. Then offer **web check-in and cancellation** for parties and advocates,
  the way airlines and travel portals do: confirm attendance and readiness the day before, cancel
  if unready, and the day's list re-packs automatically (the readiness-confirmation signal already
  exists in the model). Appointment windows and reminders would go out over SMS, the portal and
  messaging apps.
- **Timestamps.** Hearing start and end, down to the phase, would replace sampled durations with learned ones.
- Learn the per-case probabilities from the court's own hearing log (a small classifier)
  instead of type-level rates.
- A litigant and advocate portal for readiness confirmation, and SMS appointment windows.
- Multi-courtroom advocate conflict avoidance, across benches.
- Summarisation for old files (a cover page) to cut "not ready" failures, measured by the same metrics.
- Partial-progress scoring of hearings (`hearing_effectiveness`, 0..1) as a new data field.

---
**Checklist before you open your PR:**
- [x] No real case numbers, party names, or advocate names appear anywhere in this submission.
- [x] Everything lives under `submissions/aiquity-for-efficient-courts/`.
- [x] This file is filled in, not left as a template.
- [x] Your code actually runs with the commands in section 7.
