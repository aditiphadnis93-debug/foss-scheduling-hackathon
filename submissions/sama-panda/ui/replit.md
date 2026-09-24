# Court Time Planner

A prototype for Justice Sehgal and a court master to review, revise, and print recommended cause lists.

## Run & operate

- Managed workflows: `artifacts/api-server: API Server` and `artifacts/court-time-planner: web`.
- `pnpm run typecheck` checks the workspace.
- `pnpm --filter @workspace/api-spec run codegen` regenerates API hooks and validation after edits to `lib/api-spec/openapi.yaml`.
- `pnpm --filter @workspace/db run push` applies development schema changes.

## Structure

- `artifacts/court-time-planner/` — React frontend and print view.
- `artifacts/api-server/python/engine.py` — the supplied Python scheduler and simulator, unchanged.
- `artifacts/api-server/python/bridge.py` — JSON adapter from saved rules, roster, calendar and moves to the engine.
- `artifacts/api-server/python/run.py` — the supplied batch runner; it still needs the missing `config/*.json` preset files to run standalone.
- `artifacts/api-server/src/lib/planner.ts` — roster validation, persisted planner state, and asynchronous Python bridge calls.
- `artifacts/api-server/src/routes/planner.ts` — API endpoints.
- `artifacts/api-server/data/` — supplied anonymised CSV files used to seed the app.
- `lib/api-spec/openapi.yaml` — API contract; `lib/db/src/schema/` — persistent planner state.

## Product and data limitations

- The upload supplied `engine.py` and `run.py` but not the five JSON rule presets or a real 3,000-case roster. The app calls the supplied engine on the current 100-case CSV unless another roster is uploaded. It does not silently synthesize a 3,000-case docket.
- The existing Express API calls Python as a subprocess rather than running a separate FastAPI service. App controls map to engine `Policy` fields: fullness to fill factor (0.8/1.1/1.4), old-case share to its quota (minimum 25%), preset to priority, advocate grouping to clustering, and saved hours to available judicial minutes. The adapter reorders the engine's chosen cases to honor the app's complex-first/short-first display choice. Readiness gating is off because service confirmation is not supplied.
- Impact counts and the 12-week older-case trend come from one reproducible model simulation (seed 42); they are forecasts, not observed outcomes. Publishing persists proposed listings only, not the simulated outcomes.
- The roster has one latest-hearing summary and hearing counts by stage, not timestamped hearing history, adjournment streaks, service confirmations, or measured weekly outcomes. Show an estimate or “needs confirmation” instead of asserting any of these as fact.
- The engine only lists sitting days present in the supplied September–December 2026 calendar; dates beyond it need an updated calendar. The calendar form's generic weekday fallback outside that period is not a verified court holiday calendar.
- No login or real notification delivery. The Judge/Court Master control is a view toggle; publishing stores a list and audit data within this prototype, while messages are previews only.
- The roster is anonymised; no real case numbers, party names, or advocate names are present. The sample is 100 rows, not independently simulated 3,000 cases.