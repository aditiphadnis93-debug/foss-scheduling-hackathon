# Vihitha backend (v3: real schedule first, what-if second)

Built from `VIHITHA_BACKEND_SPEC_v3.md`. The exact API shapes are in `API_CONTRACT_v3.md`.

```
api/routers (HTTP only) -> api/services (orchestration) -> vihitha/ engine (pure) + api/repositories (SQLite)
```

## Run

```bash
cd backend
py -3.12 -m venv .venv && .venv\Scripts\activate      # or: python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"

uvicorn api.main:app --reload --port 8000             # API at http://localhost:8000/api/v1 (docs at /docs)
pytest -q                                             # engine + API smoke tests
```

- On first start, the server creates `state/vihitha.db`, seeds the five presets (Optimal is active), generates the 3,000-case roster from the 100-case sample (the organisers' `generate_roster.py` logic, seed 42), and plans the next 20 sitting days. Set `VIHITHA_DEFAULT_ROSTER=SAMPLE` to use the raw 100 instead.
- `POST /api/v1/setup/reset {"confirm": true}` restores that state for demos.
- Frontend: `cd ../frontend && npm run dev`. `VITE_API_URL` defaults to `http://localhost:8000`.

CLI (engine only, no DB):
```bash
python -m vihitha.cli generate-roster --n 3000 --seed 42 --out ../data/roster_3000.csv
python -m vihitha.cli run --roster ../data/roster_3000.csv --preset optimal --out ../proposed_schedule.csv
python -m vihitha.cli compare --roster ../data/roster_3000.csv --presets baseline,optimal,sehgal,dimakar,joshi
python -m vihitha.cli plan --roster ../data/roster_3000.csv --from 2026-09-24 --days 20 --out cause_list.csv
```
`/metrics/scoring?source=simulated` runs the same engine as `vihitha run` (same seed, same numbers). A test checks this.

Environment variables:
- `VIHITHA_DATA_DIR`: default is the repo's own `data/` folder, found by walking up from `submissions/vihitha/src/backend`
- `VIHITHA_STATE_DIR`: default `./state`
- `DEMO_TODAY`: default `2026-09-24`
- `VIHITHA_AUTOLOAD`: default `1`
- `CORS_ORIGINS`: default `*`
- `VIHITHA_COURT_NAME`, `VIHITHA_COURT_ADDRESS`
- `VIHITHA_SEED`: default `42`

## Layout

| Path | What |
|---|---|
| `vihitha/` | Engine. Carried over from v2: enums, rng, loaders, reference, calendar, parser, roster, rules, priority, estimates, agents, outcomes, lifecycle, next_date. New in v3: `windows.py` (slot windows and packing), `planner.py` (assign_pool), `simulate.py` (forward simulation on the real planner), `forecast.py` (case end dates), `kpis.py` (4 judge KPIs), `metrics.py` (official six), `state.py` (DB to engine), `cli.py` |
| `api/models.py` | Tables: cases, hearings, days, rulesets, leave, settings |
| `api/repositories/` | Data access, one module per table |
| `api/services/` | setup, rules, schedule, hearing, case, whatif, metrics, public, export (+ `context`, `views`) |
| `api/routers/` | HTTP only; each route calls one service function |
| `api/schemas/requests.py` | Request bodies |

## Behaviour notes

- **Invariants:**
  - A pending case has at most one future DRAFT/PUBLISHED hearing.
  - Nothing is placed on a non-sitting day.
  - Re-planning replaces only the planner's own unpinned DRAFT listings. Next dates, carry-forwards and judge edits stay.
  - PUBLISHED hearings change only with `force=true`, and keep their window when a day is re-packed.
- **Close day:** unheard hearings become NOT_REACHED and are carried forward, keeping `first_promised_date`. Closing today moves `today` to the next sitting day, and the planner tops up the horizon.
- **Auto-run (demo):** samples outcomes with the engine's day runner, confirms suggested next dates, then closes the day.
- **What-if:** never writes to the DB. It copies the state, re-plans DRAFT listings under both rule sets, and simulates both with the same seeds.

## Assumptions (defaults, all configurable)

**Court day and planning**
- The court day runs 10:00â€“17:30 with lunch 13:30â€“14:00, giving 420 minutes.
- Slot windows are 30 minutes (setting `window_minutes`).
- The planning horizon is 20 working days (setting `horizon_working_days`).
- First listings fill each day up to `fill_target` (earliest day with room, most urgent case first) before later days are used.
- Hearings run on one continuous clock of expected minutes, so a block with few matters hands its time to the next block. Each hearing's appointment window is the 30-minute slot its estimated start falls in.
- An adjourned hearing takes 3 minutes of court time.
- Days after the court calendar (after 31 Dec 2026) are treated as Monâ€“Fri sitting days.
- The optimal preset's afternoon block takes arguments and judgements, and any 4+ year case not placed in an earlier block.

**Outcome model**
- A reached hearing ends in settlement or withdrawal with probability 0.02.
- Substantive hearing durations are lognormal with sigma 0.35.
- A required case summary removes 30% of preparation failures.
- The learned show-up prior has strength 10.
- Two absences in a row at Appearance move the case to Warrant.
- Delay condonation is skipped unless the case has already had such hearings.
- Where process is pending at roster start, it returns at a uniform random point within the reference gap.

**Forecast**
- The case-end forecast uses 200 Monte Carlo paths.
- Delay condonation and Warrant are optional stages, counted only if the case is currently in them.
- Forecasts start from the case's next hearing date, or from today.
- The forecast horizon ends on 31 Dec 2026.

**Guardrails and flags**
- Guardrails:
  - the ageing quota is at least 25%
  - the age weight is at least 0.2
  - a 4+ year case must be listed within 30 days
- "Old case not heard" flags a 4+ year case once it has gone `max_wait_days_4y âˆ’ 5` days without a hearing.
- "Stuck at stage" means more hearings at the stage than 2 Ã— the median, or at least the max.
