# Gaps and contradictions seen from the judge console (causelist)

What the console shows but cannot fix itself. The console flags these on screen rather than hiding them.

## Engine and data

1. **A decided case is still pending.** ST/1211/2022's last order reads "Judgment pronounced; accused acquitted",
   yet the case is pending "application review" and gets a new date. The console now shows a red "Check this case"
   note whenever a last order reads as decided (acquitted, convicted, judgment pronounced, disposed of) while the
   case is still pending.
2. **32 identical application reviews.** Under the `benchtime` policy, Thursday 1 October is 32 nine-minute
   "application review" matters of 2022 and 2023 filings, then 3 judgments. A magistrate will ask where the
   trials and evidence are. To be checked on the engine side once the tournament winner is the default planner.
3. **Matters planned through lunch** (seen on the pre-release rules engine on port 8781, before g237). Under `zoo`, call times
   on 1 October run straight through the 1:30 to 2:00 break (several judgments are called from about 12:55 and one
   at 2:10). The `benchtime` planner skips the break. The console shows a "Check the times" note under the day
   picture when any matter runs into a break.
4. **Sehgal's hours leave 10:00 to 11:00 empty.** The `sehgal_way` preset's first slot starts at 11:00, but the
   court sits from 10:00. The console shows the slots as the preset defines them.
5. **Filing dates bunch together.** 39 cases turn 10 years old on the same Sunday (8 November), from synthetic
   filing dates.
6. **`crossesNext.on` is one day off.** For a case filed on 7 November 2016 it gives 8 November 2026. The console
   computes the anniversary from the filing date itself.
7. **`totalHearings` counts listings.** The console says "Listed 36 times", not "Heard".
8. **The old-case minimum changes nothing under `zoo` (g237).** Raising `ageingFloor` to 0.5 gives the same plan
   for 1 October and the same scorecards to 15 December. Either the genome already exceeds it or the rule is not
   applied; the console says "No difference to tomorrow's list" rather than inventing an effect.
9. **The `zoo` planner (g237) gives no call times.** `callTime` and `window` are null and `standby` is false for all
   50 matters, while the expected minutes (588) are well past the day (420). The console estimates times from
   `load.cumulative`, says so under the day picture, and puts matters that would start after 5:30 under "May not be
   reached before 5:30". It also uses the engine's `reached` for "About 37 will be reached".
10. **`meta.defaultConfig.fillTarget` is now 1.105** under the patched engine; the fill sentence adds it as a choice
   ("about 111% of the day") so the recommended setting is always visible.

11. **`aim` is honoured but reported as unknown.** With `config.aim = "focus_finish"`, `/api/plan` and the
   `/api/rules/preview` scorecards change (cases finished 193 instead of 103), yet the preview's `problems` still
   says `unknown rule "aim" ignored`. The console shows the engine's message as it is.

## Planner choice

- The judge's rules (maxListed, blocks, blocksByWeekday, halfDays, leaveDays, priorityTypes, minNoticeDays,
  maxGapDays, maxPerAdvocate, groupByAdvocate, carriedFirst, carryForward) are honoured only by the `zoo` planner.
  The console therefore plans with `zoo` whenever `/api/meta` lists it, for both Tomorrow's list and My rules, so
  a kept rule really changes the list. `meta.recommended` is still `benchtime`, so the recommended day differs
  (on 8791: 50 matters, about 37 reached, under `zoo` (g237), against 35 ending about 4:40 under `benchtime`).

## Preferences the console shows as "Noted, not yet possible"

- Justice Dimakar's front-page cover before arguments are listed (no "required filing before listing" rule).
- Continue a part-heard matter on the next working day.
- Do not list an advocate who is due in another court at the same time (one court only in the data).
- Senior citizens first (no party age in the data).
- A limit on last chances before a matter proceeds.

## Console-side limits

- Approval, rules and pins/drops are kept in this browser (localStorage); nothing is stored on the server.
- The time-slot sentence offers four slot plans (none, fresh morning and oldest afternoon, Sehgal's hours, trials in
  the morning) rather than a free slot editor.
- The rules preview takes about 10 seconds (the forecast to 15 December runs 5 seeds); tomorrow's list with the
  change marked in appears first, from `/api/plan`.
