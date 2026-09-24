# Why the numbers are not higher

All figures are on synthetic data: PUCAR's seed-42 roster of 3,000 s.138 cases in a simulated Kollam court, 420 bench
minutes a day, 51 sitting days from 1 October to 15 December 2026. Today's way is `status_quo_60`, and our pick is
`benchtime_final` (g237). Held-out figures use seeds 31-60 (`out/heldout.md`). Other seeds are named where used.
Everything is advisory, and a judge signs every order.

## The short answer

Today's list already keeps the bench busy for about 91% of the day, and a failed call costs only 2 minutes. Only 23%
of failed hearings in the simulated court (46% in PUCAR's data) come from causes the registry knows the evening
before, and the pick's gain of 1.08 useful hearings a day (+6.3%) is about what that knowledge is worth. Every design
that scored higher did it by parking cases or breaking dates, and the 19 guardrails rule that out. The larger gains
sit outside the list, in process service, attendance, readiness and the judge's choice of aim.

## The court is the bottleneck, not the list

Today's way uses 90.7% of court time on seeds 31-60, and the pick uses 90.0%. On seeds 31-40, today's day gives 309
minutes to 17.3 hearings that move a case, 76 minutes to 38.1 failed calls and 38 minutes to idle time. A failed call
takes 2 minutes, so avoiding one frees little.

| If a list could avoid | Minutes freed a day | Extra useful hearings a day, at 17.9 minutes each |
|---|---|---|
| Failures known the evening before, at the simulated mix | 17.6 | +1.0 (+5.7%) |
| The same, at PUCAR's mix | 35.1 | +2.0 (+11.4%) |
| Every failure, including those that arise in court | 76.2 | +4.3 (+24.7%) |
| Every failure and every idle minute | 114.4 | +6.4 (+37%) |

The pick gives +1.0 on these seeds, which is the first row. The other rows need knowledge nobody has in advance. In
PUCAR's `hearing_failure_reasons.csv` (880 failed hearings), process and reports not back are on the file the evening
before. Absences, "not ready", "sought time", court-side losses and "unclear" happen in the courtroom. The simulated
roster has more trial-stage cases than PUCAR's sample, so its failures lean further toward the second kind.

| Failure cause | PUCAR share | Simulated, today's list |
|---|---|---|
| Known the evening before (process 35.7%, reports 10.3% in PUCAR) | 46.0% | 23.1% |
| Partly known (evidence or filing not ready) | 8.3% | 20.0% |
| Not known before the day | 45.4% | 56.8% |

A counterfactual tests this. It is a diagnostic, not a policy result. We changed the world on purpose and left both
planners as they were (seeds 31-40, useful hearings a day).

| World (diagnostic) | Today | Pick | Pick minus today |
|---|---|---|---|
| As calibrated | 17.3 | 18.3 | +1.0 |
| Process always back on time | 18.6 | 20.3 | +1.7 |
| Every party and advocate attends | 17.6 | 20.5 | +2.9 |
| Everyone ready, nobody seeks time | 17.2 | 21.6 | +4.4 |
| All three together | 16.8 | 23.3 | +6.5 (+39%) |

Today's fixed list gains nothing from a better court. In the combined world more hearings take their full 10 to 30
minutes, and reached matters fall from 55 a day to 31. The pick's lead grows from +1.0 to +6.5, because a list changes
outcomes only when outcomes can be foreseen. In a diagnostic run where a failed call takes 5 minutes, the pick's gain
rises from +5.9% to +21.6%.

## Why plain bin packing fails, and why the other rivals do

Siddarth's bin packer ranks due cases by PUCAR's chance of a useful hearing per expected minute, fills the day to 420
expected minutes and moves the rest to the next working day. On seeds 31-60 each of its hearings is likelier to move
the case (37.5% against 30.9%), yet it gives 15.0 useful hearings a day against 17.1. Three mechanisms explain this.

1. PUCAR's table calls a judgment hearing 100% substantive, but its hearings-per-case column (3.58) implies 27.9%. The
   simulated court follows the column. The packer books 216 minutes a day for judgments that use 72, and 37% of the
   day sits idle.
2. The score has no term for age or waiting. Evidence and arguments score 0.023 to 0.030 a minute, against 0.08 to
   0.14 for procedural matters. The packer lists 4.8 trial-stage matters a day to today's 25.0, and 281 of the 897
   cases aged 4 years or more are never heard.
3. Each deferral re-promises the case for tomorrow at the same rank. The pile grows from 23 on day 1 to 1,006 on day
   50. It breaks 26,366 dates against 245 and honours 7.2% against 92.0%.

We repaired it one step at a time (seeds 1-6, steps cumulative).

| Step | Useful a day | Dates broken or never given | Old cases never heard | Late days | Guardrails failed |
|---|---|---|---|---|---|
| Today | 16.75 | 265 | 0 | 21.8 | 0 |
| Bin packing as proposed | 14.68 | 26,364 | 280 | 1.5 | 11 |
| Judgment priced at 27.9% | 18.08 | 2,575 | 52 | 19.5 | 4 |
| Standby list, fill 110% | 19.78 | 477 | 123 | 36.3 | 8 |
| All repairs, index selection | 18.09 | 148 | 0 | 19.8 | 1 |
| The pick (g237) | 17.91 | 159 | 0 | 20.0 | 0 |

Once the bin packer keeps its dates and hears its old cases, it becomes the pick. The idea suits a court whose
hearings go ahead as listed. In the diagnostic world where every call goes ahead, it gives 31.4 a day, 78% above today
there. In this court, nobody knows before the day whether a hearing takes 2 minutes or 30.

The capped rivals share the same two faults. They fill the day to the table's minutes, so the judgment price idles the
bench, and each deferral breaks a date.

| Rival (seeds 31-60) | Useful a day | Main mechanism |
|---|---|---|
| First come, capped | 10.5 | Defers 587 a day; honours 6.0% of dates |
| Oldest first | 10.6 | A table-priced day holds 37.5 matters; 1,091 cases undated |
| Our overnight build | 11.7 | Prices a judgment at 29 minutes; parks 955 cases |
| Justice Sehgal | 13.6 | Fresh block fills 114 of 303 minutes; the rest cannot pass to older matters |
| Justice Joshi | 13.7 | Judgments come last; 46.7 merits disposals against 84.9 |
| Justice Dimakar | 16.2 | Trial and judgment get three days in five; 696 cases undated |
| PUCAR's gaps, 90 a day | 16.5 | Lists 1.5 times what the day holds; late on 43.9 of 51 days |

## Why the search plateaus, and why the big numbers were not real

The quarter has 21,420 bench minutes. Listing all 3,000 cases once at PUCAR's odds costs 20,947 expected minutes and
yields 18.3 useful hearings a day. The pick gets 17.9 on seeds 1-6 and 18.2 held out, so it already sits at that
one-pass level.

To go higher, a design must book more than the day holds, stop listing some cases, or prefer short procedural hearings
that decide little. Each move breaks a guardrail. On the frontier of 930 fresh designs (seeds 1-6), each extra useful
hearing a day costs about 190 more dates broken or never given and about 140 more cases never heard. Only 33 of the
257 final-stage designs pass all 19 guardrails, and none exceeds 18.15 a day. Of the 85 designs at 18.5 or more, 92%
fail on days that ran late and 88% leave an old case unheard. A looser reading lifts the best of the 930 only to
18.43. The ablation (`out/ablation.md`) shows that the guardrails refuse real throughput. Turning off the per-case
estimate adds 1.48 useful hearings a day, with 18 more late days and 363 more dates broken or never given.

The designs at 24 to 26 a day came from loopholes. Of the 9 at 24 or more, 7 parked cases with no date and all 9 had
more than 1,000 dates broken or never given. The old rule's winner, g921, gives 25.9 useful hearings a day on seeds
31-60. It holds 66.6% of dates on the promised day, leaves 1,143 cases never heard, gives 898 cases no date this
quarter and fails 5 guardrails. Its useful hearings average 12.1 minutes against today's 18.4 (seeds 1-6), so more of
them are procedural steps. The old rule's 7 guardrails did not count undated or unheard cases. Four reviews found the
gap (`out/reviews/gaming.md`), and the final rule counts both. The fall from 25.9 to 18.2 is the price of counting
them.

## Where bigger gains really are

The engine gives larger numbers when the judge picks a narrower aim. The cost sits in the same row.

| Aim | Seeds | Useful a day | Merits disposals | Undated this quarter | Never heard |
|---|---|---|---|---|---|
| Today | 31-60 | 17.1 | 84.9 | 0 | 240 |
| Balanced (the pick) | 31-60 | 18.2 | 89.3 | 0 | 380 |
| Most useful hearings (g1121) | 31-60 | 23.1 (+35%) | 120 | 1,190 | 1,211 |
| Finish the most cases | 1-6 | 12.1 | 183 (today 82.2) | 1,777 | 1,809 |

Each aim chooses who waits until January, and the console shows that price first.

Process tracking through DRISTI's e-post comes next. Process not back causes 35.7% of failed hearings in PUCAR's data.
If a real court's failures follow PUCAR's mix, the known share is worth about +2.0 a day, twice the simulated figure.
PUCAR's handover prepays summons, notice and warrant rounds at filing and sends them by e-post, so delivery status can
feed the process desk with no data entry. In the diagnostic world where process always returns on time, the pick rises
from 18.3 to 20.3 useful hearings a day (seeds 31-40). When process returns 1.5 times slower, its held-out lead falls
from +1.08 to +0.87. No run has yet varied the late-report setting (`returnReportDelayDays`), so the feed's own value
is still unmeasured.

Attendance moves decisions more than any list. In the diagnostic world where everyone attends, today's decisions on
the merits rise 32% (81.9 to 108) with the same list. Fixed call times on the pick give 18.7 useful hearings a day and
96.4 merits disposals, and cut waiting from 141 to 23.4 minutes. That variant runs late more often and fails 3
guardrails, and its attendance lift is an assumption. Readiness is the largest single lever on useful hearings. When
everyone is ready (diagnostic), the pick leads today by 4.4 a day. A day-before filing check on DRISTI is the
practical version.

Settlement sittings add decisions and cost dates (`out/settlement.md`). A Friday tail for settlement and reports gives
96.3 merits disposals against 84.9 (+11.4 [+9.7, +13.0]) but leaves 163 more cases unheard, above the margin of 150. A
daily tail gives 110, but dates honoured fall to 86.2% and it fails 3 guardrails. Simulated parties do not settle more
because a sitting exists, so the gain comes only from who is called and when.

A better list is worth about 6% in this court. The rest depends on process, attendance and readiness, and on which
cases the judge chooses to hear first.
