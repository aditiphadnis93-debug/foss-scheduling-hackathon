# Why the numbers are not higher

All figures are on synthetic data. The court is PUCAR's seed-42 roster of 3,000 s.138 cases in a simulated Kollam
court, with 420 bench minutes a day over 51 sitting days (1 October to 15 December 2026). Today's way is
`status_quo_60`, and our pick is `benchtime_final` (g237). Held-out figures use seeds 31-60 (`out/heldout.md`,
`out/HEADLINE.md`). Other seed ranges are named where they are used. Everything is advisory, and a judge signs every
order.

## The short answer

Today's list already keeps the bench busy for about 91% of the day, and a failed call costs only 2 of the 420
minutes. Only 23% of failed hearings in the simulated court (46% in PUCAR's data) come from causes the registry
knows the evening before, and the pick's gain of 1.08 useful hearings a day (+6.3%) is about what that knowledge is
worth. Every design that scored higher did it by parking cases or breaking dates, and the 19 guardrails rule that
out. The larger gains sit outside the list, in process service, attendance, readiness and the judge's choice of aim.

## The court is the bottleneck, not the list

Today's way uses 90.7% of court time on seeds 31-60, and the pick uses 90.0%. Neither can find many new minutes, so
the only question is how the same minutes are spent. On seeds 31-40 today's day splits as follows.

| Where today's 420 minutes go (seeds 31-40) | Minutes a day | Count a day |
|---|---|---|
| Hearings that moved a case | 309 | 17.3, at 17.9 minutes each |
| Failed calls, at 2 minutes each | 76 | 38.1 |
| Idle, on days that finished early | 38 | |

A failed call is cheap, so avoiding one frees little. The next table converts avoided failures into extra hearings
at 17.9 minutes each.

| If a list could avoid | Minutes freed a day | Extra useful hearings a day |
|---|---|---|
| Failures known the evening before, at the simulated mix (23.1%) | 17.6 | +1.0 (+5.7%) |
| The same, at PUCAR's mix (46.0%) | 35.1 | +2.0 (+11.4%) |
| Every failure, including those that arise in court | 76.2 | +4.3 (+24.7%) |
| Every failure and every idle minute | 114.4 | +6.4 (+37%) |

The pick gives +1.0 a day on these seeds and +1.08 on seeds 31-60, which is the first row. The rows below it need
knowledge nobody has before the day. PUCAR's `hearing_failure_reasons.csv` (880 failed hearings) shows why.
"Awaiting process" (35.7%) and "external dependency" (10.3%) are on the file the evening before. Absences, "not
ready", "sought time", court-side losses and "unclear" happen in the courtroom. The simulated roster holds far more
trial-stage cases than PUCAR's sample (556 wait for defence evidence and 361 for judgment), so its failures lean
further toward the kinds nobody can foresee.

| Failure cause | PUCAR share | Simulated, today's list |
|---|---|---|
| Known the evening before (process, reports) | 46.0% | 23.1% |
| Partly known (evidence or filing not ready) | 8.3% | 20.0% |
| Not known before the day | 45.4% | 56.8% |

We tested this with a counterfactual. It is a diagnostic, not a policy result. We changed the world on purpose,
which no real court can do, and left both planners as they were (seeds 31-40, useful hearings a day).

| World (diagnostic) | Today | Pick | Pick minus today |
|---|---|---|---|
| As calibrated | 17.3 | 18.3 | +1.0 |
| Process always back on time | 18.6 | 20.3 | +1.7 |
| Every party and advocate attends | 17.6 | 20.5 | +2.9 |
| Everyone ready, nobody seeks time | 17.2 | 21.6 | +4.4 |
| All three together | 16.8 | 23.3 | +6.5 (+39%) |

Today's fixed list gains nothing from a better court. When more hearings go ahead, each takes its full 10 to 30
minutes, and reached matters fall from 55 a day to 31. The pick's lead grows from +1.0 to +6.5, because a list
changes outcomes only when outcomes can be foreseen. The cheap failed call matters too. With a 5-minute failed call,
the pick's gain on the calibrated court rises from +5.9% to +21.6%.

## Why plain bin packing fails, and why the other rivals do

Siddarth's bin packer ranks each due case by PUCAR's chance of a useful hearing per expected minute. It fills the
day to 420 expected minutes and moves the rest to the next working day. On seeds 31-60 it picks likelier matters
(37.5% of reached hearings move the case, against 30.9% today). It still gives 15.0 useful hearings a day against
17.1. Three mechanisms explain the loss.

1. PUCAR's table calls a judgment hearing 100% substantive. The same data's hearings-per-case column (3.58)
   implies 27.9%, and the simulated court follows the column. The packer books 216 minutes a day for judgments that
   use 72, so 37% of the day sits idle.
2. The score has no term for age or waiting. Evidence and arguments score 0.023 to 0.030 a minute, against 0.08 to
   0.14 for 5 to 10 minute procedural matters. The packer lists 4.8 trial-stage matters a day where today lists
   25.0, and 281 of the 897 cases aged 4 years or more are never heard.
3. Every deferral re-promises the case for tomorrow at the same rank. The pile grows from 23 on day 1 to 1,006 on
   day 50. It breaks 26,366 dates against today's 245 and honours 7.2% of dates against 92.0%.

We repaired it one step at a time on seeds 1-6.

| Step (cumulative, seeds 1-6) | Useful a day | Dates broken or never given | Old cases never heard | Late days | Guardrails failed |
|---|---|---|---|---|---|
| Today | 16.75 | 265 | 0 | 21.8 | 0 |
| Bin packing as proposed | 14.68 | 26,364 | 280 | 1.5 | 11 |
| Judgment priced at 27.9% | 18.08 | 2,575 | 52 | 19.5 | 4 |
| Standby list, fill 110% | 19.78 | 477 | 123 | 36.3 | 8 |
| All repairs, with index selection | 18.09 | 148 | 0 | 19.8 | 1 |
| The pick (g237) | 17.91 | 159 | 0 | 20.0 | 0 |

Once the bin packer keeps its dates and hears its old cases, it becomes the pick. The idea is sound for a court
whose hearings go ahead as listed. In the diagnostic world where every called hearing goes ahead, it gives 31.4 a
day (+78%), the best of the three planners tested there. In this court, nobody knows a hearing's length before the day.

The other rivals share the same two faults or use a fixed rule that idles the bench. The capped rules fill the day
to the table's minutes, so the judgment price leaves time unused, and each deferral breaks a date.

| Rival (seeds 31-60) | Useful a day | Main mechanism |
|---|---|---|
| First come, capped | 10.5 | Lists 37.7 a day and defers 587 a day; honours 6.0% of dates |
| Oldest first | 10.6 | A table-priced day holds 37.5 matters; 1,091 cases get no date |
| Our overnight build | 11.7 | Fills to 95% of an estimate that prices a judgment at 29 minutes; parks 955 cases |
| Justice Sehgal | 13.6 | The fresh block fills 114 of its 303 minutes, and spare time cannot pass to older matters |
| Justice Joshi | 13.7 | Earliest stage first puts judgments last; 46.7 merits disposals against 84.9 |
| Justice Dimakar | 16.2 | Trial and judgment get three days in five; 696 cases get no date |
| PUCAR's gaps, 90 a day | 16.5 | The diary holds 1.5 times what the day can hear; late on 43.9 of 51 days |

## Why the search plateaus, and why the big numbers were not real

The quarter has 21,420 bench minutes. Listing each of the 3,000 cases once at PUCAR's odds costs 20,947 expected
minutes and yields 936 useful hearings, or 18.3 a day. Today's way reaches 91% of what it lists and gets 16.75 on
seeds 1-6. The pick gets 17.9 there and 18.2 on seeds 31-60, so it already sits at the one-pass level.

Above that level a design can book more than the day holds, and the court sits late. It can stop listing some cases,
and they go unheard or undated. It can prefer short procedural hearings, which raises the count but decides fewer
cases per hearing. Each move breaks a guardrail.

The trade-off is steep. On the frontier of 930 fresh designs (seeds 1-6), each extra useful hearing a day costs about
190 more dates broken or never given and about 140 more cases never heard. Only 33 of the 257 final-stage designs
pass all 19 guardrails, and none of them exceeds 18.15 a day. Of the 85 designs at 18.5 or more, 92% fail on days that
ran late, 88% on every old case heard, and 74% each on cases never heard and dates honoured. More search did not
help. On a looser reading the best of the 930 reaches 18.43.

The ablation (`out/ablation.md`, seeds 31-60) shows that the search found higher throughput and the guardrails
refused it. Turning off the per-case estimate adds 1.48 useful hearings a day. It also adds 18 late days and 363
dates broken or never given.

The 26-a-day designs came from a loophole. The old rule's winner, g921, gives 25.9 useful hearings a day on seeds
31-60. It holds only 66.6% of dates on the promised day, leaves 1,143 cases never heard and gives 898 cases no date
this quarter. It fails 5 of the 19 guardrails. It spends 12.1 minutes per useful hearing against today's 18.4
(seeds 1-6), so more of its useful hearings are procedural steps. The old rule's 7 guardrails did not count undated
or unheard cases. Four reviews found the gap (`out/reviews/gaming.md`), and the final rule counts both. The fall from
25.9 to 18.2 is the price of counting them.

## Where bigger gains really are

The same engine gives much larger numbers when the judge chooses a narrower aim. Each aim's cost appears in the same
row.

| Aim | Seeds | Useful a day | Merits disposals | Cases with no date this quarter | Never heard |
|---|---|---|---|---|---|
| Today | 31-60 | 17.1 | 84.9 | 0 | 240 |
| Balanced (the pick) | 31-60 | 18.2 | 89.3 | 0 | 380 |
| Most useful hearings (g1121) | 31-60 | 23.1 (+35%) | 120 | 1,190 | 1,211 |
| Finish the most cases | 1-6 | 12.1 | 183 (+123% on today's 82.2) | 1,777 | 1,809 |

These are choices about who waits until January. The console shows the price before anything changes.

Process tracking through DRISTI's e-post is the next gain. PUCAR's data blames 35.7% of failed hearings on process
not back. PUCAR's handover prepays summons, notice and warrant rounds at filing and sends them by e-post, so delivery
status can feed the process desk with no data entry. In the diagnostic world where process always returns on time,
the pick rises from 18.3 to 20.3 useful hearings a day (seeds 31-40). When process returns 1.5 times slower, its lead
over today falls from +1.08 to +0.87 (seeds 31-60). No held-out run has yet varied the setting for late return
reports (`returnReportDelayDays`), so the feed's own value is not measured.

Attendance moves decisions more than any list does. In the diagnostic world where everyone attends, today's
decisions on the merits rise 32% (81.9 to 108) with no change to the list, and the pick's lead grows to +2.9 useful
hearings a day. Fixed call times on the pick give 18.7 useful hearings a day and 96.4 merits disposals, and cut
waiting from 141 to 23.4 minutes (seeds 31-60). That variant runs late on more days and fails 3 guardrails. The
attendance lift it relies on is an assumption. Readiness is the largest single lever on hearings. In the diagnostic
world where everyone is ready, the pick leads today by 4.4 a day. A check of filings on DRISTI the day before is the
practical version.

Settlement sittings add decisions and cost dates. A Friday tail for settlement and reports on the pick gives 96.3
merits disposals against today's 84.9 (+11.4 [+9.7, +13.0], seeds 31-60). It also leaves 163 more cases unheard than
today, above the margin of 150. A daily tail gives 110 (+25.3), with 20 more settlements than the pick alone. Its
dates honoured fall to 86.2%, and the court runs late on 1.9 more days. The simulated parties do not settle more
because a settlement sitting exists, so these gains come only from who is called and when (`out/settlement.md`).

A better list is worth about 6% in this court. Process, attendance and readiness hold the rest of the gap, along
with the judge's choice of aim.
