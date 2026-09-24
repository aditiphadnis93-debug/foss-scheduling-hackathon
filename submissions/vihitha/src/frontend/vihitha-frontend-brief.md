# Vihitha â€” frontend brief (v3)

Vihitha (Malayalam for "time") is a **court scheduling assistant** for a High Court judge's roster. The case study is Justice Sehgal: about 3,000 pending cases, about 2.5 months (24 Sep â€“ 31 Dec 2026), and 420 minutes of judicial time per day. The real schedule (cases, hearings, days) lives in the backend database. The judge plans, publishes and edits it; the Court Master records what happened; What-If tries other rules on a copy before applying them. Requirements: `backend/VIHITHA_BACKEND_SPEC_v3.md` Â§9; shapes: `backend/API_CONTRACT_v3.md`.

Reference data comes from the hackathon data pack (`backend/foss-scheduling-hackathon-main/data`): `roster_sample_100.csv`, `court_calendar.csv`, `hearing_type_reference.csv`, `substantiveness_by_hearing_type.csv` and `hearing_failure_reasons.csv`.

## Global rules

- **Users:** Judge (decides, not technical) and Court Master (prepares lists). Litigants and advocates use the public mobile view with no login.
- **Every system suggestion shows a one-line reason**, phrased "Suggested because â€¦". Never "AI decided". The judge can always override.
- **Copy tone:** short, plain, judge-friendly. Never show internal labels such as "L1/L2/L3".
- **Breakpoints:** desktop-first at 1280px; the public view is mobile-first at 390px.
- **Click targets:** at least 44px.

### Metrics (same wording and tooltip on every screen)

| Metric | Tooltip | Better when |
|---|---|---|
| Utilisation | Share of the 420 minutes spent on hearings that were reached | higher |
| Reach rate | Share of listed hearings the court actually got to | higher |
| Substantiveness | Share of reached hearings that moved the case forward | higher |
| Backlog-age impact | Share of cases 4+ years old that were heard | higher |
| Predictability | Average days between a case's first scheduled date and when it was actually heard | lower |
| Next-date sanity | Share of next dates within the procedural range for that hearing type | higher |

**Baseline** is 60 matters listed per day with a flat 60-day next-date gap.

## Design tokens (unchanged)

| Token | Value | Use |
|---|---|---|
| navy | #0B2545 | Header bar, primary text |
| blue | #1E5AA8 | Buttons, links, selected states |
| teal | #0F8B8D | Suggestion accents, charts, toggles on |
| teal-light | #E0F4F4 | Suggestion cards, info panels |
| bg / card / border | #F6F9FC / #FFFFFF / #DDE5EE | Surfaces |
| green | #2E8B57 | Substantive / better / High |
| amber | #D98E04 | Adjourned / over capacity / guardrail warning |
| red | #C0392B | Errors / worse / 5+ year cases |
| grey | #7A8699 | Not reached |

Amber, teal and grey fail 4.5:1 as small text on white. Use them for dots, bars and borders only. For text, use the darker shades: muted #52627A, teal #0B6E70, green #1F6B41 on #E6F3EC, amber #8A5A00 on #FBF1DC, red #A12F22 on #F9E5E2, grey #5A6678 on #EEF1F5, blue selected background #E8F0FA.

- **Age-bucket colours** (charts and the age chip): 0â€“1 yrs #A9DEDF, 1â€“3 #5FBFC1, 3â€“4 #0F8B8D, 4â€“5 #D98E04, 5+ #C0392B. The old buckets use warm colours so they stand out.
- **Judge leave** uses purple (#7A5AA8 border on #F1ECF8) so it isn't confused with holidays.
- **Fonts:** Inter for the UI and Noto Sans Malayalam for Malayalam. Numbers use tabular figures.
- **Radii:** 12px for cards and pills, 8px for buttons and inputs.
- **Icons:** Lucide line icons at 1.8px stroke.


## App shell

- **Top bar (64px, navy):** the wordmark with "à´µà´¿à´¹à´¿à´¤", the court name and `today` (from `GET /health`, polled every 30 s), the active rule set name, and the **Judge / Court Master** switch. No scenario selector.
- **Sidebar (232px):** Calendar, What-If, Cases, Metrics, Settings. The footer holds the Public slot link.
- **Role behaviour:** the Judge publishes, unpublishes, moves, pins and removes. The Court Master records outcomes, closes the day and can run the demo auto-run.

## Shared components

- **KpiCard:** one of the 4 judge KPIs (moved forward per week, old cases heard, court time used, heard on promised date) with a tooltip, the value, the comparison value and a delta coloured by `better`. A "Forecast" tag when `is_forecast`.
- **DayCalendar:** the Google-Calendar-style day (time axis, lunch band, block bands, windows as events, hearing chips). Used interactively on the Calendar and read-only on What-If.
- **InfoTip, AgeChip, LikelihoodDot, DayStatusBadge, Guardrail (amber with a lock), ErrorCard, Skeleton, EmptyState, Modal/confirm, Toast (ok and error), Drawer, Toggle, Stepper, Segmented, Tabs, SuggestionCard, CapacityBar, StatCard.**
- **Charts:** hand-drawn SVG. LineChart supports solid actual and dashed forecast; StackedBars fades forecast weeks. Each has a hover tooltip and a "Show as table" fallback.

---

## Screens (spec Â§9)

1. **Calendar** Â· `/` (`?view=day|week|month&date=`)
   - Day: windows as events, expand for chips; drag a chip to another window or to a day in "Next sitting days" â†’ impact banner (`POST /hearings/preview`) â†’ Apply (`PATCH /hearings/{id}`, force-confirm when PUBLISHED) or Cancel. Pin, Remove and Move to date on each chip. Top bar: status badge, Publish (day or next N days), Unpublish, Export CSV. Right panel: Held back and Not yet scheduled with "Add to this day".
   - Court Master: outcome buttons per chip (Moved forward / Adjourned â–¸ reason / Not reached / Disposed â–¸ type), then the Next-date panel. "Close day" and "Auto-run day (demo)".
   - Week: 7 columns with block bands, counts and load %. Month: grid coloured by load %, holidays, leave in purple. Clicking a day opens it.
2. **What-If** Â· `/whatif`: preset or rule set, 5 key controls, horizon 30/60/90, agents, compare-to, focus date â†’ Run (`POST /whatif`). Results: KPI cards, cost sentences, focus day (read-only), month strip with compare overlay. **Apply these rules** (`POST /whatif/{id}/apply`).
3. **Cases** Â· `/cases`: forecast strip, filters (search, stage, age, status, flag, ends before, sort), paged list with "Likely to finish". Case drawer: lifecycle bar, next hearing, **How and when this case ends**, hearing counts, history.
4. **Metrics** Â· `/metrics`: 4 KPIs, weekly trend (actual solid, forecast dashed), backlog by age, Needs attention (5 groups), cases ending this and next month, collapsed Hackathon scoring.
5. **Settings** Â· `/settings?tab=`: Roster, Calendar and leave, Rule sets (full rule editor), Reference data, Settings, Reset demo.
6. **Public slot** Â· `/public`: mobile-first, English â‡„ à´®à´²à´¯à´¾à´³à´‚, shows the time window, ETA, queue and the `NOT_SCHEDULED` state.

## Data

- Real API only: `src/api/client.ts` calls `${VITE_API_URL ?? 'http://localhost:8000'}/api/v1`. Types in `src/api/types.ts` mirror the contract.
- react-query everywhere. Every mutation calls `refreshAll()` (in `src/api/queries.ts`), which invalidates every live query so all screens show fresh data. Queries refetch on window focus.
- Errors use the body `{error:{code,message}}` and are shown in an ErrorCard or an error toast. If no roster is loaded, screens point to Settings.
