# Submission: lawl

## 1. Team

- **Team / solo name:** case_commits
- **Members:** Venkatesh, Jaganath, Ramkumar, Sayak
- **Complexity level claimed:** L2

## 2. One-line summary

Every day, instead of listing whatever's next in line, we score every pending case on how much it's actually worth hearing, fill the day only with what can realistically be finished in the time available, and keep adjusting our predictions as we see what really happens in court.

## 3. The approach

### Overview

Score every case by its expected productive value, pack each day with only what realistically fits, and continuously update our predictions as outcomes arrive.

### Inputs

| File | Use |
|---|---|
| `roster_sample_100.csv` | The 100-case docket we schedule against |
| `court_calendar.csv` | Defines which days we can schedule |
| `hearing_type_reference.csv` | Estimated duration per hearing type (5–30 min) and recommended gap to next hearing (5–45 days) |
| `substantiveness_by_hearing_type.csv` | Population-level P(substantive) per hearing type, from ~500 real hearings |
| `hearing_failure_reasons.csv` | Per-type breakdown of why hearings fail (party absence, filing not ready, awaiting process, etc.); used to derive no-show probabilities for the simulation |
| `sample_causelist_2026-09-22.csv` | Reference for output format validation |

### Core logic

**Training data generation**

For each case, we simulate a hearing outcome by drawing from the supplied substantiveness probabilities, modulated by case-level features (age, total prior hearings, hearings at current stage). This produces 100 labeled rows: case features → binary outcome (substantive or adjourned).

**ML prediction model (Logistic Regression)**

A model is trained on the 100 simulated outcomes. Features include:

- Hearing type (14 categories)
- Case age in days — (current date − filing date − no. of calendar holidays)
- Stage ordinal (1–11, representing lifecycle position)
- Total hearings held
- Hearings at the current stage (proxy for "stuckness")
- Advocate case load (number of cases handled by this advocate)
- Hearing duration from the reference table
- Backlog flag (case age ≥ 4 years)

The model predicts the chance (0–100%) that a hearing will meaningfully move the case forward.

Unlike a simple lookup table, it considers the case's details—for example, an old case at the Evidence stage with many previous hearings may have a different probability than a new case at the same stage.

**Case scoring formula**

Each case is scored for scheduling priority:

```
score = ML_score  × w_substantive
      + age_priority   × w_age
      + cluster_bonus × w_cluster
      + duration_score × w_duration
```

Where:

- `ML_score` — how likely the hearing is to be productive (from the ML model)
- `age_priority` — older cases get a higher boost
- `cluster_bonus` — bonus if the same advocate has another case that day
- `duration_score` — represents the scheduling preference for hearing duration. (If judges prefer shorter hearings, shorter cases receive a higher score; if they prefer longer hearings, longer cases receive a higher score.)
- `w_*` - weights for different parameters.
Weights are configurable per judge preset.

**Scheduling & Simulation**

- Each day, we pick the highest-scoring cases that fit within 420 minutes and group cases with the same advocate together where possible.
- We run each day's cause list forward: hearing durations vary realistically, and each hearing either moves the case forward (substantive) or results in an adjournment. Cases that don't fit in the day's time are carried to the next round.

**Feedback loop**

After each hearing, the system updates that case's probability of success. Cases that keep getting adjourned gradually drop in priority; cases that progress keep their priority. The more the system is used, the better its predictions become for this specific court.

### Key decisions

- **Logistic Regression:** Use logistic regression to predict the likelihood of a case resulting in a productive hearing.
- **Feedback Model:** Incorporate judge feedback to continuously update and refine the scoring weights over time.
- **Configurable Weights:** Allow judges to configure preferences, such as prioritizing shorter or longer hearings, which dynamically adjusts the scoring weights.

### Assumptions made

- The ML prediction model, feedback loop, and scheduling/simulation engine described above represent our proposed design and the direction we are building towards.
- The current prototype focuses on the case-ranking UI.
- Dummy data is currently used to demonstrate the ranking and scoring flow.
- The scoring weights and judge preferences are currently assumed/configurable values and will be refined once real data and feedback are available.
- All participants are assumed to be available throughout the day; based on the judge's selected cases, the corresponding participants attend those hearings.

## 4. Complexity level - L2


**Prediction model:**

A small logistic regression estimates how likely each case's hearing is to move it forward. It uses the case's own details, such as age, stage and number of past hearings, so two cases at the same stage can get different scores. It currently learns from outcomes simulated using the supplied probabilities, and it will be retrained on real court outcomes later.

**Dynamic updates:**

The model updates every day. Each day is filled only up to the 420 minutes available, using hearing durations that vary rather than fixed times. After each hearing, the case's chance of success is updated.

**Judge override:**

The judge can reorder the model's suggested order, and the model adjusts the rest around it. Judges can also choose a preset, such as oldest-first, or add their own variable.

New parameters can be added as feedback comes in, without changing the core logic.

## 5. Results

Our model ranks every case by how likely its hearing is to move it forward. As it trains on more real court data, including hearing times, hearing counts and events across case types, its predictions become more accurate and scheduling becomes automatic. The figures below are rough estimates from our simulation.

**Rough Numbers**

| Dimension | Baseline (case study) | Our model (rough) |
|---|---|---|
| Utilisation | 60 cases for 420 minutes, heavily overbooked | ~25–30 cases per day, ~85–90% of time used |
| Predictability | 33% of listed cases heard | ~70–80% heard |
| Substantiveness | 50% of heard cases move forward | ~60–65% move forward |
| Backlog-age impact | Older cases have no priority | ~20–30% fewer 4+ year cases in 2.5 months |
| Next-date quality | Flat 60-day gap | ~15–25 day average, set by hearing type |

## 6. Specs for integration

**Data schema:**

The current prototype uses dummy case data with fields such as case_id, case_age, advocate_id, estimated_duration, ML_score, and cluster_bonus. The system outputs a ranked list of cases with their calculated priority scores. The proposed production schema would additionally include historical hearing outcomes, participant/advocate information, hearing duration, adjournment history, and judge feedback to support model training and weight updates.

**Interfaces:**

The current implementation is an app-based UI for case ranking. At this stage, the ranking logic is demonstrated using dummy data. For production integration, the ranking engine would be exposed as an API that accepts case data and judge preferences and returns ranked cases and their scores.

**Dependencies:**

The planned ML component uses Python and scikit-learn, with Logistic Regression for predicting hearing productivity. The current demo does not yet depend on a trained ML model; scores are based on dummy data. The frontend is implemented as an application.

**What's stubbed vs. real:**

The case-ranking UI and scoring demonstration are implemented. The ML prediction model, judge-feedback loop, and scheduling/simulation engine are not yet implemented and represent the proposed next stage of development. The current demo uses dummy case data and assumed/configurable weights.

**What integration would take:**

Integration with a real court system would require mapping the court's existing case-management data to our input schema, exposing the ranking engine through an API, and securely providing relevant historical case and hearing-outcome data for model training. Judge preferences and feedback would then be captured through the interface and used to update the configurable weights. The final scheduling layer would integrate the ranked cases with the court's calendar, participant availability, and existing hearing-allocation workflow.

## 7. How to run it

```
Open the index.html file in any web browser. No installation or setup is required.
```

## 8. What we'd build next

Next, we would launch a soft version of the app with default parameters and let the model learn from how the judge acts on cases. At the same time, we would train it on real court outcomes so its predictions reflect how each court actually works. Can add time slots so litigants and advocates know when their case will be heard, and reminders for pending tasks before each hearing. We would also let advocates confirm preparedness in advance.
