# World calibration fit

Fitted under the calibration status quo (every due case listed, earliest promised date first; next date at PUCAR's reference gap, on the first working day with room under 75 cases a day, so no Monday carries a weekend's pile-up; first dates spread the same way in a fixed hash order) on world seeds 1-20 with 3000 cases of the seed-42 roster (the full roster), 10 iterations of proportional fitting.
One simulate() call on this roster took 0.46 s; the whole fit took 98 s.

Tolerance is judged by PUCAR's own evidence: P(substantive) where its source is real and rests on at least 50 hearings, the failure shares where PUCAR's failure table is real and counts at least 30 failures. Each is allowed two standard errors of PUCAR's estimate, never less than 3 points for P(substantive) and 6 points for a share; the simulation must also have called at least 200 hearings of the type.
Reached-weighted mean absolute error in P(substantive): 0.2%.

## P(substantive | reached)

| Type | Called hearings | Target | Simulated | Error | PUCAR hearings (P(sub) source) | PUCAR failures (source) | Tolerance P(sub) / share | Largest share error | Within tolerance |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| ADMISSION | 381 | 48.6% | 50.7% | 2.1% | 111 (real) | 57 (real) | 9.5% / 6.0% | 3.6% | yes |
| DELAY_CONDONATION_HEARING | 1536 | 29.3% | 29.4% | 0.1% | 41 (real) | 29 (real) | 14.2% / 15.0% | 0.6% | too little evidence to judge |
| COGNIZANCE | 260 | 90.0% | 91.2% | 1.2% | 30 (real) | 3 (estimated) | 11.0% / 54.4% | 1.4% | too little evidence to judge |
| APPEARANCE | 1832 | 40.1% | 39.6% | 0.5% | 336 (real) | 201 (real) | 5.3% / 6.0% | 0.5% | yes |
| WARRANT | 5451 | 13.5% | 13.3% | 0.2% | 339 (real) | 293 (real) | 3.7% / 6.0% | 0.2% | yes |
| PLEA | 1619 | 90.0% | 89.7% | 0.3% | 50 (real) | 5 (estimated) | 8.5% / 8.9% | 1.8% | yes (P(substantive) only) |
| EXAMINATION_UNDER_S351_BNSS | 1817 | 40.7% | 40.6% | 0.1% | 27 (real) | 16 (real) | 18.9% / 16.5% | 0.8% | too little evidence to judge |
| EVIDENCE_COMPLAINANT | 8148 | 29.4% | 29.4% | 0.0% | 183 (real) | 129 (real) | 6.7% / 6.0% | 0.2% | yes |
| EVIDENCE_ACCUSED | 13165 | 16.7% | 16.3% | 0.4% | 18 (real) | 15 (real) | 17.6% / 6.0% | 2.1% | too little evidence to judge |
| ARGUMENTS | 6358 | 13.0% | 13.0% | 0.0% | 29 (real) | 25 (estimated) | 12.5% / 19.6% | 0.1% | too little evidence to judge |
| JUDGEMENT | 9184 | 27.9% | 28.0% | 0.0% | estimated | 4 (estimated) | 200.0% / 43.3% | 24.3% | estimated targets: reported, not judged |
| BAIL | 322 | 31.3% | 31.4% | 0.1% | 66 (real) | 45 (real) | 11.4% / 14.5% | 1.6% | yes |
| REPORTS | 5057 | 8.3% | 8.4% | 0.1% | 60 (real) | 55 (real) | 7.1% / 8.4% | 0.2% | yes |
| APPLICATION_REVIEW | 5151 | 85.0% | 85.0% | 0.0% | estimated | 3 (estimated) | 16.0% / 54.4% | 0.3% | estimated targets: reported, not judged |

## Failure shares among failed called hearings (target / simulated)

| Type | admin | resp. absent | pet. absent | sought time | not ready | process | external | both absent | unclear |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| ADMISSION | 0.0% / 0.0% | 3.6% / 0.0% | 10.9% / 12.2% | 5.5% / 5.3% | 10.9% / 12.8% | 52.7% / 51.1% | 0.0% / 0.0% | 0.0% / 0.0% | 16.4% / 18.6% |
| DELAY_CONDONATION_HEARING | 0.0% / 0.0% | 0.0% / 0.0% | 20.7% / 21.3% | 24.1% / 24.1% | 10.3% / 9.9% | 17.2% / 17.2% | 0.0% / 0.0% | 13.8% / 13.9% | 13.8% / 13.7% |
| COGNIZANCE | 33.3% / 34.8% | 0.0% / 0.0% | 0.0% / 0.0% | 0.0% / 0.0% | 0.0% / 0.0% | 66.7% / 65.2% | 0.0% / 0.0% | 0.0% / 0.0% | 0.0% / 0.0% |
| APPEARANCE | 1.0% / 0.9% | 19.4% / 19.0% | 8.5% / 8.9% | 4.5% / 4.8% | 3.5% / 3.4% | 35.3% / 34.9% | 3.0% / 3.0% | 7.5% / 7.6% | 17.4% / 17.5% |
| WARRANT | 2.0% / 2.0% | 0.3% / 0.5% | 1.0% / 1.1% | 0.3% / 0.3% | 0.7% / 0.7% | 66.9% / 66.9% | 14.7% / 14.5% | 0.7% / 0.7% | 13.3% / 13.2% |
| PLEA | 0.0% / 0.0% | 60.0% / 58.7% | 0.0% / 0.0% | 0.0% / 0.0% | 20.0% / 20.4% | 0.0% / 1.8% | 0.0% / 0.0% | 0.0% / 0.0% | 20.0% / 19.2% |
| EXAMINATION_UNDER_S351_BNSS | 0.0% / 0.0% | 12.5% / 12.6% | 6.3% / 5.9% | 12.5% / 13.3% | 25.0% / 25.0% | 18.8% / 18.4% | 6.3% / 6.2% | 6.3% / 6.2% | 12.5% / 12.3% |
| EVIDENCE_COMPLAINANT | 0.8% / 0.8% | 13.2% / 13.1% | 19.4% / 19.3% | 4.7% / 4.6% | 27.1% / 27.1% | 5.4% / 5.4% | 0.0% / 0.2% | 14.0% / 14.0% | 15.5% / 15.5% |
| EVIDENCE_ACCUSED | 0.0% / 0.0% | 26.7% / 26.5% | 6.7% / 6.6% | 0.0% / 0.0% | 53.3% / 51.8% | 0.0% / 0.0% | 0.0% / 0.1% | 0.0% / 2.1% | 13.3% / 12.9% |
| ARGUMENTS | 24.0% / 23.9% | 8.0% / 8.0% | 0.0% / 0.0% | 40.0% / 40.1% | 20.0% / 20.0% | 0.0% / 0.0% | 0.0% / 0.0% | 0.0% / 0.0% | 8.0% / 8.0% |
| JUDGEMENT | 50.0% / 50.0% | 0.0% / 19.9% | 0.0% / 0.0% | 0.0% / 0.0% | 0.0% / 0.0% | 25.0% / 0.7% | 0.0% / 0.0% | 0.0% / 0.0% | 25.0% / 29.3% |
| BAIL | 2.2% / 2.3% | 28.9% / 29.4% | 0.0% / 0.0% | 17.8% / 19.0% | 0.0% / 0.0% | 0.0% / 0.0% | 0.0% / 0.0% | 13.3% / 13.1% | 37.8% / 36.2% |
| REPORTS | 0.0% / 0.0% | 7.3% / 7.3% | 3.6% / 3.7% | 0.0% / 0.0% | 1.8% / 1.8% | 0.0% / 0.0% | 74.5% / 74.7% | 1.8% / 1.9% | 10.9% / 10.7% |
| APPLICATION_REVIEW | 0.0% / 0.0% | 0.0% / 0.0% | 0.0% / 0.0% | 33.3% / 33.6% | 33.3% / 33.1% | 0.0% / 0.0% | 0.0% / 0.0% | 0.0% / 0.0% | 33.3% / 33.3% |

## Fitted per-type parameters

| Type | admin | procP | procScale | extP | extScale | absA | absC | both | notReady | soughtTime | unclear |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| ADMISSION | 0.000 | 1.000 | 1.559 | 0.000 | 1.000 | 1.000 | 0.423 | 0.000 | 0.087 | 0.044 | 0.119 |
| DELAY_CONDONATION_HEARING | 0.000 | 1.000 | 1.651 | 0.000 | 1.000 | 1.000 | 0.794 | 0.120 | 0.108 | 0.343 | 0.272 |
| COGNIZANCE | 0.023 | 0.018 | 0.832 | 0.000 | 1.000 | 1.000 | 0.000 | 0.000 | 0.000 | 0.000 | 0.000 |
| APPEARANCE | 0.006 | 1.000 | 2.491 | 0.010 | 0.910 | 0.544 | 0.896 | 0.092 | 0.050 | 0.090 | 0.369 |
| WARRANT | 0.016 | 1.000 | 2.229 | 0.949 | 1.000 | 0.007 | 0.420 | 0.021 | 0.030 | 0.018 | 0.467 |
| PLEA | 0.000 | 0.000 | 0.078 | 0.000 | 1.000 | 0.071 | 0.000 | 0.000 | 0.027 | 0.000 | 0.021 |
| EXAMINATION_UNDER_S351_BNSS | 0.000 | 0.224 | 1.000 | 0.134 | 1.000 | 0.134 | 0.466 | 0.032 | 0.229 | 0.143 | 0.151 |
| EVIDENCE_COMPLAINANT | 0.006 | 0.269 | 1.000 | 0.000 | 0.130 | 0.320 | 0.294 | 0.083 | 0.363 | 0.092 | 0.285 |
| EVIDENCE_ACCUSED | 0.000 | 0.000 | 1.000 | 0.000 | 0.216 | 0.261 | 0.407 | 0.000 | 0.796 | 0.000 | 0.419 |
| ARGUMENTS | 0.202 | 0.000 | 1.000 | 0.000 | 1.000 | 0.291 | 0.000 | 0.000 | 0.270 | 0.748 | 0.347 |
| JUDGEMENT | 0.363 | 0.000 | 1.000 | 0.000 | 1.000 | 0.250 | 0.000 | 0.000 | 0.000 | 0.000 | 0.443 |
| BAIL | 0.011 | 0.000 | 1.000 | 0.000 | 1.000 | 0.439 | 0.000 | 0.112 | 0.000 | 0.261 | 0.515 |
| REPORTS | 0.000 | 0.000 | 1.000 | 1.000 | 1.714 | 0.315 | 0.200 | 0.017 | 0.097 | 0.000 | 0.568 |
| APPLICATION_REVIEW | 0.000 | 0.000 | 1.000 | 0.000 | 1.000 | 0.000 | 0.000 | 0.000 | 0.060 | 0.057 | 0.052 |

## The same world under status_quo_60

The fitted world, unchanged, run under the case study's default court (every due case listed, a flat 60-day gap, called in list order) on the same seeds: 60.0 listed and 55.0 reached per sitting day. Reached-weighted mean absolute error in P(substantive): 0.6%. The world's latent rates do not depend on the court, so differences here come from which cases and stages each court reaches.

| Type | Called hearings | Target | Simulated | Error | PUCAR hearings (P(sub) source) | PUCAR failures (source) | Tolerance P(sub) / share | Largest share error | Within tolerance |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| ADMISSION | 779 | 48.6% | 52.2% | 3.6% | 111 (real) | 57 (real) | 9.5% / 6.0% | 3.6% | yes |
| DELAY_CONDONATION_HEARING | 2710 | 29.3% | 27.9% | 1.4% | 41 (real) | 29 (real) | 14.2% / 11.3% | 1.7% | too little evidence to judge |
| COGNIZANCE | 398 | 90.0% | 89.4% | 0.6% | 30 (real) | 3 (estimated) | 11.0% / 54.4% | 11.9% | too little evidence to judge |
| APPEARANCE | 2133 | 40.1% | 38.1% | 2.0% | 336 (real) | 201 (real) | 5.3% / 6.7% | 5.3% | yes |
| WARRANT | 6076 | 13.5% | 14.0% | 0.5% | 339 (real) | 293 (real) | 3.7% / 6.0% | 0.5% | yes |
| PLEA | 1889 | 90.0% | 89.3% | 0.7% | 50 (real) | 5 (estimated) | 8.5% / 43.8% | 6.8% | yes (P(substantive) only) |
| EXAMINATION_UNDER_S351_BNSS | 1708 | 40.7% | 39.9% | 0.8% | 27 (real) | 16 (real) | 18.9% / 21.7% | 2.4% | too little evidence to judge |
| EVIDENCE_COMPLAINANT | 7193 | 29.4% | 29.5% | 0.1% | 183 (real) | 129 (real) | 6.7% / 7.0% | 1.6% | yes |
| EVIDENCE_ACCUSED | 11019 | 16.7% | 17.4% | 0.7% | 18 (real) | 15 (real) | 17.6% / 25.8% | 2.4% | too little evidence to judge |
| ARGUMENTS | 4793 | 13.0% | 12.9% | 0.1% | 29 (real) | 25 (estimated) | 12.5% / 10.9% | 0.9% | too little evidence to judge |
| JUDGEMENT | 7348 | 27.9% | 28.6% | 0.6% | estimated | 4 (estimated) | 200.0% / 43.3% | 24.9% | estimated targets: reported, not judged |
| BAIL | 477 | 31.3% | 31.4% | 0.1% | 66 (real) | 45 (real) | 11.4% / 11.4% | 8.8% | yes |
| REPORTS | 4282 | 8.3% | 8.4% | 0.1% | 60 (real) | 55 (real) | 7.1% / 11.7% | 2.3% | yes |
| APPLICATION_REVIEW | 5291 | 85.0% | 84.9% | 0.1% | estimated | 3 (estimated) | 16.0% / 54.4% | 8.9% | estimated targets: reported, not judged |

## Notes

- JUDGEMENT follows 1 / mean hearings per case (3.58), not the table's 100%: PUCAR's substantiveness table marks it 100% (estimated) while its failure row lists adjourned judgement hearings and the observed mean is 3.58 hearings per case.
- Court holiday shares are left out of the per-type targets: a no-sitting day is a whole-day closure (closureProb), never a called hearing.
- Types with fewer than 200 called hearings across the seeds are reported but not judged against the tolerance; failure shares are judged only when there are at least 100 failed hearings.
- Process and mediation reports recorded as out in a roster summary were ordered at the last hearing, taken to be 1 to 60 days before the start (the roster's own next dates are ignored), so some are already back when the horizon opens.
- Absconding (warrants never executed) is modelled only at the WARRANT stage; warrants at plea, examination or judgment come back on their fitted delay. Without this the roster's outstanding warrants at PLEA would contradict PUCAR's 0% awaiting-process share there.
- Awaiting-process and external-dependency failures are fitted through two knobs per type: the probability that process (or a report) is out when a case comes to the purpose, then a multiplier on its delay once that probability reaches 1 or the lifecycle's own summons and warrants already exceed the target.
- A failure that changes the purpose (the accused away after service, APPEARANCE to WARRANT) and a failure that ends the case (default acquittal, dismissal for steps, split-up) count as substantive: PUCAR's definition is that the hearing moved the case to its next purpose. So PUCAR's respondent-absence share at APPEARANCE is reachable only through the absences that do not draw a warrant.
- Process and reports ordered before the horizon but not recorded in the roster summary are hidden from planners until a hearing fails for them; the fit is unaffected (the calibration court reads neither).
- Held, not fitted: the accused-side absence multiplier before APPEARANCE (no effect: the accused is not yet a party) and at JUDGEMENT (0.25, an assumption: a warrant issues only after the accused stays away, so JUDGEMENT's residual rate is fitted to P(substantive) rather than to its four-failure estimated table).
- Assumptions held fixed during the fit: failed hearings take 2 minutes, duration CV 0.5, closure probability 0.0015 per day (PUCAR's holiday count over all hearings), 15% of warrants at the WARRANT stage never executed, 40% of substantive mediation reports settle.
- The calibration policy asks no check-in and gives no call times, so the behaviour responses (and the check-in's false-alarm and unforeseen-failure rates) are not identified by this fit; they are assumptions and are swept in the experiments.
- Branch and disposal assumptions held fixed (PUCAR's hearing counts cannot identify them): P(delay condonation needed) 0.25, P(warrant when a served accused stays away) 0.6, default acquittal 0.3, dismissal for steps 0.15, compounding 0.01 per hearing with both parties present, split-up 0.25 per call after 4 warrant hearings.
