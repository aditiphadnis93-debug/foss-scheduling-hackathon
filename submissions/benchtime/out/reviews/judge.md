# Review of the selection criteria: the presiding officer's view

Lens: a JMFC in Kollam who tries s.138 NI Act complaints summarily, and the Kerala High Court's administrative side that inspects the court.
Data: live table `view=1-6&all=1` (655 rows, seeds 1-6), pulled at 14:04. `tournament.ts` was being edited during the review (14:06), so line numbers are for that version.

## 1. Verdict

I would not sign lists made by the winner of the 10-guardrail rule. The rule still rewards leaving cases off the list; it just hides that better. The three added guardrails do not close the loophole:

- **Promise measures only count dates that fall inside the horizon.** `initialDates` (simulate.ts:185-200) lets each policy place every pending case's first date anywhere from 1 Oct onward, **including after 15 Dec**. If a case is put past the horizon, the simulator never records a row for it, so no broken promise is counted. That puts it outside guardrails (a) and (b).
- **Guardrail (c) is relaxable, so it has no effect.** When nothing meets 600, the limit moves to 1.05 x the smallest level any hard-feasible candidate reaches: about 1,424. g869 at 1,356 then wins on useful hearings a day. That is the 14:00 failure again.

In court terms, the leading candidates keep 94-98% of "promised dates" only because they made about 45% fewer promises. Roughly 1,340 cases that already have dates in their order sheets were quietly moved to January, without being called and without any order. A date fixed by the court can be changed only by an order recorded in the file. BNSS s.346 (old CrPC s.309) and NI Act s.143(2) require recorded reasons for adjourning a summary trial beyond the next day. No magistrate can re-date 1,340 files in chambers on 1 October.

## 2. Defects, with evidence

**D1. Cases can be moved out of the horizon with nothing counted against them (the main defect).**
- All seven candidates that meet every hard guardrail (everything except (c)) do this. None has more than 1,866 of 3,000 cases whose date comes up (`extra.casesScheduled`). Today's way has 3,000.

| Candidate | Cases whose date comes up | Never acted on | Held on promised date | Useful a day |
|---|---|---|---|---|
| g869 | 1,660 | 1,356 | 94.1% | 19.3 |
| g798 | 1,590 | 1,410 | 97.5% | 18.8 |
| g979 | 1,650 | 1,360 | 98.7% | 17.1 |
| Today's way (status_quo_60) | 3,000 | 262 | 91.3% | 16.8 |

- Legally this is re-fixing dates without an order. For the next judge it borrows from January. Dimakar measures himself by what he hands over; nothing in the rule measures what is handed over.

**D2. The relaxable (c) turns a hard rule into a soft one.**
- Where: tournament.ts:360 (`relaxable: true`) and the relax logic at about 520-533.
- A limit that moves to wherever the search already is protects nobody. If nothing meets the coverage limit, the honest outcome is "nothing beats today", not "loosen it".

**D3. The trips and wasted-listings limits are set by a baseline that abandons a third of the docket.**
- The best baseline on both is bin_packing: 8.94 trips per useful hearing, 63.3% wasted listings. It leaves 1,005 cases never acted on and only 68.8% of 4y+ cases heard.
- Today's way (11.97 trips, 72.1% wasted) fails both limits itself.
- Every candidate that covers the docket carries its unheard calls, so these two limits push the search towards dropping cases. They pull against (c). This is a large part of why "nothing meets all 10".

**D4. A desk order on the fixed date counts as a broken date.**
- Code: `REACHED = substantive | failed` (metrics.ts:65). `promisedRows` includes desk rows (metrics.ts:257-258), and `allDue` includes desk (metrics.ts:259).
- In a magistrate's court, "summons not returned, issue fresh summons, call on X", entered in the order sheet that day, honours the date.
- The effect: all seven hard-feasible candidates have `desk: false`. Process-pending cases are pushed out of the horizon instead of being dealt with at the desk.
- Example: g504 does desk work (5.9 a day). It scores 85.7% on the current measure. Counting desk on the date as honoured, it would be about 95.3%, and 94.8% of the matters it lists are held.

**D5. Guardrails (a) and (b) are the same number counted twice.**
- `heldOnPromisedDate == heldAsScheduledAllDue` in every row I checked that has no deferral or vacating.
- So the rule counts one idea twice and has no guardrail at all on "not listed".

**D6. "No worse than today" inherits today's bad day.**
- Today's way overruns on 21.8 of 51 days (43%), and each person heard waits 153 minutes on average. The overrun limit allows 22.8 days.
- Idle time has no limit. g869 is idle 20.7% of the day (about 87 minutes) while 1,356 cases are never touched. An inspecting judge would ask why the court rose early with 1,300 files unposted. The case study's utilisation test is "without being overbooked or leaving significant capacity unused".

**D7. Useful hearings a day is a means, not the end, and it can be inflated by concentration.**
- g869's mean next-date gap is 34.6 days against today's 68. It hears about 1,660 cases roughly twice instead of 3,000 once.
- The Sehgal persona's own brief is a docket of 3,000-4,000 cases "with 2.5 months to go through them" (/tmp/case7.txt:171).
- To be fair to concentration, it has real value. g869 disposes 130 cases against 94 today, and leaves 889 4y+ cases pending against 967. That is a legitimate old-cases-first choice (Dimakar's). The question is whether it is bought by dropping cases (unacceptable) or by using spare time better (fine).

**D8. The objective and headline count default outcomes as wins.**
- `extra.disposed` includes acquittals for the complainant's default and dismissals for steps not taken. A judge does not count those as justice done.
- They are small today (about 12 of 94), but nothing stops a search from harvesting them.

**D9. The measures most relevant to s.143(3) are missing.**
- Cases under a year old (389, of which 175 are under 6 months) are the only ones where the six-month target can still be met.
- The ageing weights protect 4y+ cases, and nothing protects fresh ones.
- With ageExponent about 1.8 and firstOldShare about 0.6, the pushed-out 1,340 are almost certainly the younger cases. This is my inference: the catalogue has no per-age "never acted on" measure to confirm it.
- There is also no end-of-horizon measure: how many dates are booked in the first weeks after 15 Dec.

## 3. Proposed final criteria

All limits are on the same seeds as status_quo_60 (SQ) unless stated. **No limit is relaxable.** If nothing passes, we report that and submit the best candidate that does pass.

| # | Rule (measure key) | Limit | Why a judge would accept it |
|---|---|---|---|
| H1 | `extra.casesScheduled` | >= 2,985 (99.5%) | Every file has a date in its order sheet. A date is moved only by calling the case or by desk order, never by leaving it off. |
| H1 | `extra.neverActedOn` | <= 1.10 x SQ (about 288) | Untouched for the whole 75-day horizon means a gap longer than the court's own 60-day norm (case study line 150). Do no worse than today. |
| H2 | `siddarth.heldOnPromisedDate`, with desk rows on the promised date counted as honoured (needs a small metric fix) | >= SQ - 0.01 | Honour the order-sheet date. A desk order made that day honours it; deferring or vacating does not. |
| H2 | `caseStudy.heldAsScheduled` (listed matters called) | >= SQ - 0.01 | Replaces the duplicate (b). |
| H3 | `readme.backlog4yHeardShare` | >= SQ - 0.005 | Unchanged. |
| H3 | `readme.backlog4ySubstantiveShare` | >= SQ - 0.005 | Unchanged. Old cases are not to be deprioritised. |
| H4 | `extra.disposed` | >= SQ - 2 | Unchanged. |
| H5 | `caseStudy.overrunDays` | <= SQ + 1 | Unchanged. |
| H5 | `caseStudy.idleMinutesShare` (new) | <= SQ + 0.05 | No early rising while files wait. |
| H6 | `extra.tripsPerSubstantive` | <= SQ | Anchored to today, not to the best baseline (see D3). |
| H6 | `siddarth.wastedListings` | <= SQ | Same. |
| H7 | `caseStudy.nextDateExcessDays` | <= SQ + 1 | Unchanged. |

**What is maximised, in order.** A step counts only when the difference exceeds the paired 95% interval across seeds; otherwise go to the next step.
1. Merits disposals (`extra.disposedVerdict + extra.disposedCompounded + extra.disposedSettlement`). This is what the High Court's statements count and the litigant cares about. Compounding is encouraged for s.138 cases, per Kanchan Mehta and Damodar Prabhu.
2. Fewest `extra.pending4yPlusEnd`. The case study's backlog-age test is that fewer cases sit in the old buckets.
3. Most `extra.substantivePerDay`.
4. Least `extra.minutesWaitedInclNotReached`.

Once H1 is enforced, useful hearings a day is a fine third key, but it should not be first.

If the High Court circular sets a limit on causelist size, add `extra.listedPerDay <= cap` as a hard rule. I do not have the circular, so it is not in the table above.

## 4. Feasibility on seeds 1-6

**Nothing passes except SQ itself.**

The closest is **g504** (nsga gen 1; `firstDates: spread`, `desk: true`, `callTimes: true`). It fails only H3 heard-4y+: 0.994 against a limit of 0.995. That is about 5.3 old cases never heard, where about 4.5 is allowed.

| Measure | g504 | Today (SQ) |
|---|---|---|
| Useful hearings a day | 18.61 | 16.75 |
| Cases never acted on | 134 | 262 |
| Cases whose date comes up | 3,000 | 3,000 |
| Held on promised date, current measure | 85.7% | 91.3% |
| Held on promised date, desk counted as honoured (approx.) | 95.3% | 91.3% |
| Listed matters held | 94.8% | 91.3% |
| Disposals (headline) | 103.2 | 94.0 |
| Merits disposals | 93.2 | 82.1 |
| 4y+ disposals | 73.3 | 67.5 |
| 4y+ moved on | 30.2% | 27.8% |
| Pending 4y+ at end | 953 | 967 |
| Overrun days | 22.3 | 21.8 |
| Idle share | 9.7% | 9.5% |
| Trips per useful hearing | 10.32 | 11.97 |
| Wasted listings | 66.3% | 72.1% |
| Next-date excess (days) | 47.5 | 50.8 |
| Minutes waited | 18 | 153 |

Do not loosen H3 to let g504 through. A 10-year-old case unheard is exactly what the judge notices. Raise its ageing floor and rerun.

**The binding constraint is coverage and promise-keeping together.**
- Among candidates that meet every guardrail other than the two promise measures and "never acted on":
  - no candidate at a coverage ceiling of 288 or 400;
  - one at 600 (g814), best promise 77.6%;
  - at 1,000, best promise 99.0%, and the best useful-a-day with promise at least 90.3% is g989 at 21.27, with 958 never acted on.
- Among candidates with full coverage (at least 2,985 dates come up and at most 393 never acted on), only g504 keeps promises. That is on the desk-counted reading; on the current measure, nobody.
- The search found high promise-keeping only by under-booking.

**The constructive path.**
- g869 already has about 87 idle minutes a day. Calling or desk-noting its 1,340 dropped cases costs about 26 calls a day at 2-3 minutes each, around 65 minutes.
- So a candidate that combines g869's concentration with a coverage pass could plausibly keep most of its disposal gain and still meet H1. This is untested.
- If nothing passes by the deadline, submit g504 (or today's way with its fixes), not g869.
