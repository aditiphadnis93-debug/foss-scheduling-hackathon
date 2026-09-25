# Lawyer view: implementation plan

This plan is built from `lawyer-view.md`. Lawyers take part in the next-date discussion with the judge but decide nothing. An advocate sees their own cases on the Causelist planner. They can pick a **next purpose** and see the same predictions, dates and impact the judge sees. The page has no **Confirm decision** button and writes nothing.

## Scope

**In scope**
- The Advocate role runs on the organisers' dataset only (`provided/`), like the judge's Causelist planner.
- It shows the advocate's cases and the read-only desk for each of them.
- It shows the forecast, filtered to the advocate's cases.

**Hidden from the Advocate role.** These are hidden, not deleted, the same way `SHOW_OLD_JUDGE_TABS` hides the old judge tabs:
- the synthetic-data advocate page (`pages.advocate_page`: calendar, clashes, .ics, case panel)
- the sidebar's **Schedule shown** picker and **Dataset** expander
- every write on the desk: **Confirm**, **Change this decision**, **Close the day** and **Start over**
- file exports: no CSV download and no .ics. The POC lives in the web app only.
- the outcome radio and the hearing-time box. The brief says the lawyer chooses only the next purpose.

## What the advocate sees

**Sidebar**
- The demo sign-in (role radio, unchanged).
- A **Roster** radio that shares the judge's key `pl-roster`, so both roles look at the same desk.
- An **Advocate** picker built from that roster's `advocate_id`s. Each entry reads `ADV-011 · 6 cases, 2 listed today`. Advocates with a case listed on the hearing day sort first, and the default is the first of them.

**Main page** (title "Scheduling Justice · Causelist planner (advocate)"), in two tabs:

1. **My cases · hearing day \<date\>**
   - Metrics: my cases, listed today, decided by the judge, awaiting the judge.
   - A table of all the advocate's pending cases: case, stage, current purpose, age, and status. Status is one of:
     - listed today, with the judge's decision if one has been made
     - next forecast date and its kind (published / set by the judge / tentative)
     - no date in 60 days
     - disposed
   - Pick a case listed today (row click or selectbox) to open the desk below it:
     - **Left:** the same `_facts` panel as the judge's. It shows age, stage, hearings, the last summary, the failure mix, and this advocate's other listings.
     - **Right, if the judge has decided:** the decision, read-only, with no **Change this decision** button.
     - **Right, if the judge hasn't decided:** a "Discuss a next date" panel.
       - A **Next purpose** selectbox is the only input that shapes the prediction. Its default is the lifecycle step after the listed purpose (`default_next_purpose(stage, purpose, "Heard, moved on")`). A Judgement case would default to disposed, so it defaults to the listed purpose instead.
       - Then the same Earliest / Nearest with room / Model's best fit metrics, the availability strip, the date radio with "Propose another date", the impact of the chosen date, and the candidate-dates table.
       - Picking a date only views its impact; nothing is saved.
       - The hearing time is the reference table's figure, shown as a caption.
       - No note field and no **Confirm** button. A caption instead says: "For discussion with the judge. Only the judge records the decision."
   - Cases not listed today show their forecast dates in the table only. The desk works from the hearing day, so it applies only to today's list.

2. **Forecast · my cases**
   - The same forecast view, filtered to the advocate's bookings: a per-day table of their listings with purpose, status and why.
   - Left out: the court-wide charts (the day-load chart and the comparison with the real causelist) and the CSV download. The POC lives in the web app only, with no file exports.

## Code changes

**`views/planner.py`**. This file holds everything for both roles; the role picks what is drawn.
- `_decide(..., readonly: bool = False)`. With `readonly=True`:
  - The outcome radio is skipped and the default next purpose is computed as above.
  - The minutes input becomes a caption (`minutes = None`).
  - The note field and the Confirm button are skipped, and a discussion caption is added.
  - The decided branch shows the decision without the undo button.
  - Widget keys get an `adv-` prefix so they don't collide with the judge's keys in the same session.
- New `render_advocate(today, kind, advocate)`:
  - It calls `store.ensure` so a fresh DB still has a desk, and computes `state` and `draft` through the cached `draft_for`.
  - It draws the two tabs above.
  - It never calls `decide`, `undo`, `close_day` or `reset`.
- New `advocate_options(kind, state) -> list[tuple[str, int, int]]` returns (advocate, cases, listed today), sorted listed-first, for the sidebar.
- `_forecast(..., advocate: str | None = None)` filters `listings` to the advocate's cases and skips the court-wide chart, the comparison and the CSV download when an advocate is given.
- `render()` for the judge doesn't change.

**`app.py`**
- Branch on `role == "Advocate"` before `open_store()` and the court build. The advocate page doesn't need the synthetic court, which saves the load.
  - Draw the roster radio and the advocate picker in the sidebar.
  - Skip **Schedule shown** and **Dataset**.
  - Call `planner_view.render_advocate(date.today(), kind, advocate)`, then `st.stop()`.
- Add `SHOW_OLD_ADVOCATE_PAGE = False` next to `SHOW_OLD_JUDGE_TABS`. It keeps the old `pages.advocate_page` path reachable.
- The Court Master and Litigant roles are unchanged.

**No changes** to `planner/` (the store, forecast and desk are already read-safe), the schema, or the judge's flow.

## Tests (`tests/test_planner.py`)

- `advocate_options` counts match the roster, and listed-today advocates come first.
- A headless `AppTest` of `render_advocate` on the 100 roster, with an advocate who has a case listed today:
  - it renders without an exception;
  - it has no button labelled Confirm, Confirm decision, Change this decision, Close the day or Start over from this day;
  - it has no `pl-out-` radio, no `pl-mins-` number input and no download button;
  - changing the next purpose re-renders the dates, and the metrics and strip are still there.
- The read-only path writes nothing: the `decision` and `published` row counts in `$CAUSELIST_DB` are the same before and after interacting.
- After the judge's `render` records a decision, the advocate view shows it read-only.
- `test_imports.py` still passes.

## Docs

- `docs/causelist-planner.md`: add an "Advocate view" section covering what they see and what is hidden, and that the page is read-only.
- `CLAUDE.md`: update the Status and Code map entries for `views/planner.py`.

## Decisions taken (easy to flip)

1. **"Only choose the next purpose"** is read strictly. The outcome and hearing time are hidden, while viewing the impact of a proposed date is allowed, because it is view-only. If you also want the advocate to enter a time estimate ("I need 90 min for arguments"), it is a one-line change: keep the minutes box in read-only mode.
2. **The desk covers only cases listed on the hearing day**, matching the judge's desk. Other cases show forecast dates only.
3. **No lawyer-to-judge channel**, such as a proposed date the judge sees on their desk. The brief says lawyers use the data to discuss with the judge. A "suggested by the advocate" marker on the judge's desk would be a natural next step, but it adds a write path, so it is left out.
4. **Advocate identity** is the roster's `advocate_id` (e.g. `ADV-011`). In the 3,000 roster the organisers' script redraws advocates at random, which gives about 1,260 advocates with about 2.4 cases each. So most advocates have nothing listed on a given day, and that is why the picker sorts listed-today first.
