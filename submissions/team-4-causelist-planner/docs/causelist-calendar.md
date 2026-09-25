# Causelist as a Calendar: Persona Views

Implements `ideas/causelist-as-a-calendar.md` and `ideas/user-personas.md`. Built with the `causelist-calendar` skill (`.claude/skills/causelist-calendar/SKILL.md`). The scheduler is unchanged: these views only read its output and never re-order, drop or add listings.

## What each persona gets

Pick a role and a person under **Sign in (demo)** in the sidebar.

| Persona | Page | What's on it |
| --- | --- | --- |
| **Judge** | The L1 tabs plus a **Calendar** tab | **Day**: cases per appointment window, and the day's list; select a case for its summary, checklist and timeline. **Week**: load per block against budget. **Month**: cases listed per sitting day. The Causelist tab also gets **pre-hearing briefs** for every 4y+ case on the day |
| **Court Master** | Whole court | Load per courtroom, a chart with the three courtrooms side by side, advocates double-booked across courtrooms, and a roll-call table per courtroom (window order, with each advocate's matters together, and a clash flag) |
| **Advocate** | Their practice | Matters, listings, court days (trips) and clashes. **Week**: one row per day and courtroom, so overlapping rows are clashes. **Month**: grid. **All cases**: every matter, oldest first, with a summary. `.ics` download of every listing |
| **Litigant** | Their cases | Every case they are a party to, with their side, the other side, the court and the next hearing. Select a case for details, summary, the **checklist for the next hearing** and the **timeline**. `.ics` download |

**Case panel** (shared by every persona): filing date, age, court, hearings so far, the templated summary, the next hearing's checklist and why-trail, a timeline strip (✓ effective, ◆ heard not effective, ✕ not heard, ★ upcoming), and the timeline table.

## How it's built

| Piece | Where | Notes |
| --- | --- | --- |
| The court | `views/court.py` | One courtroom per preset (`courtroom:` in the YAML). Each has its own seeded roster with case-ID prefix `HC<n>/…`. Advocates share one pool, so clashes across courtrooms are real |
| Events | `views/events.py` | `CourtEvent` mirrors `causelist_item` in `docs/scheduler-schema.sql`. Filters: courtroom, advocate, party, day. `clashes()` finds overlapping windows in different courtrooms |
| Timeline, summary, checklist | `views/history.py` | History before the start date is **synthetic** and deterministic per case, built from the case's own fields. Facts mirror the `case_summary_facts` view. The summary is a fixed template. The checklist combines `PURPOSE_CHECKLIST` (placeholder data) with case-specific items |
| Calendar invites | `views/ics.py` | RFC 5545, stdlib only. IST converted to UTC, lines folded at 75 octets. Each invite carries purpose, court, window, parties, advocates, why-trail, summary and checklist |
| Charts | `views/charts.py` | The dataviz reference palette in fixed order, a label on every bar, and a table under every chart. Status colours only appear with a symbol and a label |
| Pages | `views/pages.py`, `app.py` | Streamlit. The court is built once per data setting (`st.cache_resource`) |

**Scheduler-side changes** (small, and none alters an ordering or a count):
- `Case.parties`: synthetic, from a separate RNG, so the existing roster is byte-for-byte unchanged (tested).
- `Listing.window_start` / `window_end`.
- `JudgeConfig.courtroom` and `cover_page_for` (Dimakar needs a cover page before evidence and argument hearings).
- `generate_roster(id_prefix=…)`.
- **Bug fix in stage 5 (`slots.py`).** An overbooked block (listing factor > 1) used to publish zero-length windows such as "13:30–13:30" for the cases that ran past the end of the block. Those cases now share the block's last full window.
- **Bug fix in `app.py`.** Docket insights could show the previous judge's roster after switching judges and back. The roster is now re-saved whenever the signed-in judge changes.

Tests: `tests/test_calendar.py` (10 tests) covers:
- one event per listing, with IDs unique across courtrooms;
- windows inside their blocks, on sitting days only;
- exact role filters;
- clash detection, checked against brute force;
- history is deterministic and consistent with `adjournment_count`, `last_heard` and pending prerequisites;
- the summary and checklist, including the preset-driven cover-page rule;
- valid ICS output;
- the roster unchanged by the party generator.

## What the demo shows (default picks)

- **Court Master, Mon 5 Oct:** Court 1 (Sehgal) 60 listed, Court 2 (Dimakar) 16, Court 3 (Joshi) 47. **25 advocate clashes** across courtrooms that day.
- **Advocate:** the default is a typical advocate (47 matters, 20 listings over 13 court days, 3 clashes), picked to match the brief's "15 matters across 3 courtrooms" persona. The busiest advocates in the synthetic pool have hundreds of matters, because the generator uses a long-tail advocate distribution.
- **Litigant:** individuals come first (the persona). Institutions (State, Union of India, ...) are last.

## Findings worth raising

- **Cross-court clashes are invisible to the scheduler.** It plans one judge's roster at a time, so it can't see that an advocate is due in Court 1 and Court 3 in the same window. The Court Master and Advocate views make the problem visible. Avoiding it needs either a shared advocate ledger across courtrooms or the L2 solver. This ties to the open organiser question on modelling advocates' clashes in other courtrooms.
- **Checklists turn "raise substantive hearing rates" (goal 4) into something concrete.** The prerequisite item comes straight from the eligibility data. The rest are placeholders until the real hearing-type table shows what each purpose needs.

## Deferred

| Item | Why / where |
| --- | --- |
| Real login | DRISTI's user service. For a standalone deployment, Streamlit `st.login` (OIDC) with Keycloak (Apache-2.0) |
| Notifications and reminders; collecting intent to appear | `notification` table (L2 input) |
| Overriding a listing from the calendar, with its cost | L2 "override impact", `schedule_override` table |
| Prose summaries | Local open model only, from `court_order.order_text`. The template stays as the fallback |
| Reading the timeline from DuckDB views | Once the real roster populates `docs/scheduler-schema.sql`, `case_timeline` and `case_summary_facts` replace the synthetic history |
| Cross-court clash avoidance | Scheduler change (see Findings). Not a view |
