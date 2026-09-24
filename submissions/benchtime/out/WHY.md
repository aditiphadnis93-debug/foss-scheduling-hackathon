# Why the numbers are not higher

All figures are on synthetic data: PUCAR's seed-42 roster of 3,000 s.138 cases in a simulated Kollam court, 420 bench
minutes a day, 51 sitting days from 1 October to 15 December 2026. Today's way is `status_quo_60`, and our pick is
`benchtime_final` (g237). Held-out figures use seeds 31-60 (`out/heldout.md`), which the search never saw. Seeds 1-6 are
the search's tuning seeds, and figures on them say so. The diagnostic runs use seeds 31-40. Guardrail counts follow the
rule in `out/tournament/criteria.json`. Everything is advisory, and a judge signs every order.

## The short answer

Today's list already keeps the bench busy for about 91% of the day. A failed call costs only 2 minutes in the simulated
court. Only 23% of failed hearings there come from causes the registry knows the evening before (46% in PUCAR's data).
Avoiding every one of those would free about one useful hearing a day (seeds 31-40). The pick gains 1.08 a day (+6.3%)
on seeds 31-60, which is about the same size. Among the 257 final-stage designs on the tuning seeds, none that passes
all 19 guardrails gives more than 18.15 useful hearings a day. The designs that scored higher ran late, left old cases
unheard, parked cases with no date or broke dates. The larger gains sit outside the list, in process service,
attendance, readiness and the judge's choice of aim.

## The bench is already busy

Today's way uses 90.7% of court time on seeds 31-60, and the pick uses 90.0%. On seeds 31-40, today's day gives 309
minutes to 17.3 hearings that move a case, 76 minutes to 38.1 failed calls and 38 minutes to idle time. A failed call
takes 2 minutes in the simulated court, so avoiding one frees little.

The next table is arithmetic on today's list (seeds 31-40), not a run. It divides the minutes freed by 17.9 minutes per
useful hearing.

| If a list could avoid | Minutes freed a day | Extra useful hearings a day, at 17.9 minutes each |
|---|---|---|
| Failures known the evening before, at the simulated mix | 17.6 | +1.0 (+5.7%) |
| The same, at PUCAR's mix | 35.1 | +2.0 (+11.4%) |
| Every failure, including those that arise in court | 76.2 | +4.3 (+24.7%) |
| Every failure and every idle minute | 114.4 | +6.4 (+37%) |

The first row is the most a list could gain in this court by dodging failures it can foresee. The pick's +1.0 on these
seeds is the same size. The pick gets there mostly by choosing shorter hearings that are likelier to go ahead. It still
has 37.2 failed calls a day against today's 38.1. The second row applies PUCAR's mix of causes, which this simulated
court does not have. The last two rows need knowledge nobody has in advance.

In PUCAR's `hearing_failure_reasons.csv` (880 failed hearings), process and reports not back are on the file the evening
before. Absences, "sought time", court-side losses and "unclear" happen in the courtroom. A missing filing could be
checked the day before, but a witness who drops out cannot, so "not ready" is partly known. The simulated roster has
more trial-stage cases than PUCAR's sample, so its failures lean further toward causes that arise in court.

| Failure cause | PUCAR share | Simulated, today's list (seeds 31-40) |
|---|---|---|
| Known the evening before (process 35.7%, reports 10.3% in PUCAR) | 46.0% | 23.1% |
| Partly known (evidence or filing not ready) | 8.3% | 20.0% |
| Not known before the day | 45.4% | 56.8% |

A counterfactual tests this. It is a diagnostic, not a policy result. We changed the simulated world on purpose, left
both planners as they were and ran seeds 31-40. No real court works like these worlds. The table gives useful hearings a
day.

| World (diagnostic) | Today | Pick | Pick minus today |
|---|---|---|---|
| As calibrated | 17.3 | 18.3 | +1.0 |
| Process always back on time | 18.6 | 20.3 | +1.7 |
| Every party and advocate attends | 17.6 | 20.5 | +2.9 |
| Everyone ready, nobody seeks time | 17.2 | 21.6 | +4.4 |
| All three together | 16.8 | 23.3 | +6.5 (+39%) |

Today's fixed list gains little from a better court. Its useful hearings stay between 16.8 and 18.6 a day in every
world. In the combined world more hearings take their full 10 to 30 minutes, and today's reached matters fall from 55 a
day to 31. The pick's lead grows from +1.0 to +6.5. A list gains more when more outcomes can be foreseen. In a further
diagnostic run where a failed call takes 5 minutes (seeds 31-40), the pick's gain rises from +5.9% to +21.6%.

## Why plain bin packing and the other rivals fall short

Siddarth's bin packer ranks due cases by PUCAR's chance of a useful hearing per expected minute. It fills the day to 420
expected minutes and moves the rest to the next working day. On seeds 31-60, 37.5% of its reached hearings move the
case, against 30.9% under today's list. Yet it gives 15.0 useful hearings a day against 17.1. Three mechanisms explain
this.

1. PUCAR's substantiveness table calls a judgment hearing 100% substantive. The hearings-per-case column in PUCAR's
   hearing-type table (3.58 a case) implies 27.9%. The simulated court follows the column. The packer books 216 minutes
   a day for judgments that use 72, and 37% of the day sits idle.
2. The score has no term for age or waiting. Evidence, examination and arguments hearings score 0.023 to 0.030 a minute.
   Short procedural matters such as admission and appearance score 0.08 to 0.14. The packer lists 4.8 trial-stage
   matters a day to today's 25.0, and 281 of the 897 cases aged 4 years or more are never heard.
3. Each deferral re-promises the case for tomorrow at the same rank. The pile grows from 23 on day 1 to 1,006 on day 50.
   It breaks 26,366 dates against 245 and honours 7.2% against 92.0%.

We repaired it one step at a time on the tuning seeds 1-6. The steps are cumulative. The table leaves out four middle
steps (per-case estimates, process desk, next-date rule, old-case rotation).

| Step | Useful a day | Dates broken or never given | Old cases never heard | Late days | Guardrails failed |
|---|---|---|---|---|---|
| Today | 16.75 | 265 | 0 | 21.8 | 0 |
| Bin packing as proposed | 14.68 | 26,364 | 280 | 1.5 | 11 |
| Judgment priced at 27.9% | 18.08 | 2,575 | 52 | 19.5 | 4 |
| Standby list, fill 110% | 19.78 | 477 | 123 | 36.3 | 8 |
| All repairs, index selection | 18.09 | 148 | 0 | 19.8 | 1 |
| The pick (g237) | 17.91 | 159 | 0 | 20.0 | 0 |

With every repair in place, the bin packer gives 18.09 a day and fails one guardrail, cases never heard. By then it has
the pick's main settings and differs only in minor dials. It ends within 0.2 a day of the pick. The idea suits a court
whose hearings go ahead as listed. In the diagnostic world where every call goes ahead (seeds 31-40), it gives 31.4 a
day, 78% above today's list there. In this court, nobody knows before the day whether a hearing takes 2 minutes or 30.

Most capped rivals fill the day to the table's minutes, so the judgment price idles the bench. Those that defer break a
date with each deferral. Those that do not defer leave cases with no date this quarter.

| Rival (seeds 31-60) | Useful a day | Main mechanism |
|---|---|---|
| First come, capped | 10.5 | Defers 587 a day; honours 6.0% of dates |
| Oldest first | 10.6 | A table-priced day holds 37.5 matters; 1,091 cases undated |
| Our overnight build | 11.7 | Prices a judgment at about 29 minutes; parks 955 cases |
| Justice Sehgal | 13.6 | Fresh block fills 114 of 303 minutes; the rest cannot pass to older matters |
| Justice Joshi | 13.7 | Judgments come last; 46.7 merits disposals against 84.9 |
| Justice Dimakar | 16.2 | Trial and judgment get three days in five; 696 cases undated |
| PUCAR's gaps, 90 a day | 16.5 | Lists about 1.5 times what the day can hear; late on 43.9 of 51 days |

## Why the search stops near 18 a day, and where the big numbers came from

The quarter has 21,420 bench minutes. Listing all 3,000 cases once costs 20,947 expected minutes at PUCAR's odds, with
the judgment odds taken from the hearings-per-case column. If every listed case is reached, that pass yields 18.3 useful
hearings a day. The pick gets 17.9 on the tuning seeds 1-6 and 18.2 held out, so it already sits near that one-pass
level.

To go higher, a design must book more than the day holds, stop listing some cases, or prefer short procedural hearings
that decide little. In the search, each of these moves ran into a guardrail. On the frontier of 930 fresh designs
(tuning seeds 1-6), each extra useful hearing a day cost about 190 more dates broken or never given and about 140 more
cases never heard. Only 33 of the 257 final-stage designs pass all 19 guardrails, and none of them exceeds 18.15 a day.
Of the 85 final-stage designs at 18.5 or more, 92% fail on days that ran late and 88% leave an old case unheard. A
looser reading, on means only with no allowance for seed noise, lifts the best of the 930 only to 18.43.

The best passer on the tuning seeds, g157 at 18.15, gives 18.3 on the held-out seeds against the pick's 18.2
(`frontier_1` in `out/heldout.md`). It also fails one guardrail there, because it leaves 1.27 old cases unheard on
average against today's 0.53. The two designs differ in several settings, yet both stop near 18.

The pick itself fails one guardrail on the held-out seeds. It leaves 140 more cases never heard than today [+128, +151],
against a margin of 150. Most of these cases have a summons, notice or warrant that is not back, so they get a desk
order on their date instead of a court call. Turning the desk off cuts cases never heard by 168 but adds 81 dates broken
or never given (`out/ablation.md`). `out/heldout.md` counts a second failure under a stricter reading of the old-case
guardrail, although the pick leaves no old case unheard on any seed.

The ablation on seeds 31-60 also shows that the guardrails turn down some real throughput. Turning off the per-case
estimate adds 1.48 useful hearings a day, with 18 more late days and 363 more dates broken or never given.

The designs at 24 to 26 a day used gaps that the old rule did not measure. On the tuning seeds, 9 designs reached 24 or
more. Seven of them parked cases with no date, and all 9 had more than 1,000 dates broken or never given. The old rule's
winner, g921, gives 25.9 useful hearings a day on seeds 31-60 in our run. Counting desk orders, it honours 86.4% of
dates against today's 92.0%. It leaves 1,143 cases never heard, gives 898 cases no date this quarter and fails 5
guardrails. Its useful hearings take about 12.1 minutes each against today's 18.4 (tuning seeds 1-6), so more of them
are procedural steps. The old rule's 7 guardrails counted neither cases left undated nor the number of cases never
heard. The loophole review of the criteria found the gap (`out/reviews/gaming.md`, loophole L1), and the final rule
counts both. The fall from 25.9 to 18.2 is the price of counting them.

## Where the bigger gains are

The engine gives larger numbers when the judge picks a narrower aim. The cost sits in the same row.

| Setting | Seeds | Useful a day | Merits disposals | Undated this quarter | Never heard |
|---|---|---|---|---|---|
| Today | 31-60 | 17.1 | 84.9 | 0 | 240 |
| Balanced (the pick) | 31-60 | 18.2 | 89.3 | 0 | 380 |
| Focused dial setting (g1121) | 31-60 | 23.1 (+35%) | 120 | 1,190 | 1,211 |
| Today | 1-6 (tuning) | 16.75 | 82.2 | 0 | 262 |
| Finish the most cases aim | 1-6 (tuning) | 12.1 | 183 | 1,777 | 1,809 |

Each setting chooses who waits until January. The judge's console (`web-concepts/causelist`) shows each aim's numbers
next to today's, costs included.

Process tracking through DRISTI's e-post is the next step. Process not back causes 35.7% of failed hearings in PUCAR's
data. At PUCAR's mix of failures, the arithmetic above puts the most a list could gain from knowing about process and
reports at about +2.0 a day. That is twice the simulated figure, and it is an upper bound, not a run. PUCAR's handover
prepays summons, notice and warrant rounds at filing and sends them by e-post (`INTEGRATION.md`). Delivery status can
then feed the process desk with no data entry. In the diagnostic world where process always returns on time (seeds
31-40), today's list rises from 17.3 to 18.6 useful hearings a day and the pick from 18.3 to 20.3. When process returns
1.5 times slower (seeds 31-60, `out/robustness.md`), the pick's lead falls from +1.08 to +0.87. No run has yet varied
the late-report setting (`returnReportDelayDays`, default 0), so the feed's own value is still unmeasured.

Attendance moves decisions more than the pick's list does. In the diagnostic world where everyone attends (seeds 31-40),
today's decisions on the merits rise 32% (81.9 to 108) with the same list. On those seeds in the calibrated world, the
pick adds 5.6 decisions on the merits. Fixed call times on the pick give 18.7 useful hearings a day and 96.4 merits
disposals on seeds 31-60, and cut waiting from 141 to 23.4 minutes. That variant fails the guardrails on cases never
heard and days that ran late, and its attendance lift is an assumption.

Readiness is the largest of the three levers for useful hearings. In the diagnostic world where everyone is ready (seeds
31-40), the pick leads today by 4.4 a day. A day-before check of filings on DRISTI could catch part of this. It cannot
catch a witness who drops out.

Settlement sittings add decisions and cost dates (`out/settlement.md`, seeds 31-60). A Friday tail for settlement and
reports gives 96.3 merits disposals against today's 84.9 (+11.4 [+9.7, +13.0]). It leaves 163 more cases never heard
than today, above the margin of 150. A daily tail gives 110 merits disposals, but dates honoured fall to 86.2%. It fails
the guardrails on dates honoured, cases never heard and days that ran late. Simulated parties do not settle more because
a sitting exists, so the gain comes only from who is called and when.

On synthetic data, a better list is worth about 6% in this court. The rest depends on process, attendance and readiness,
and on which cases the judge chooses to hear first.
