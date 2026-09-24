# AIQuity for Efficient Courts

A scheduling layer for one High Court judge's roster. It decides **what to hear, when to hear it,
and how to structure the day** so that judicial minutes turn into case progress. It never lets
old cases starve, and the judge can see and change every rule.

- **North-star metric:** justice-weighted case progress per hour of judicial time.
- **Core (L2):** probabilistic prediction → mixed-integer optimisation (MILP) → rolling re-planning, run forward in a stochastic court simulator.
- **L3:** advocates and litigants as behavioural agents (rules, or a decision model / LLM engine) who react to the schedule.
- **L4:** a synthetic town where disputes arise, turn into filings and flow through the court lifecycle.

See [`SUBMISSION.md`](SUBMISSION.md) for the approach, assumptions, results and the integration spec.

## Quick start

```bash
cd submissions/aiquity-for-efficient-courts
pip install -r requirements.txt

# 1. Scorecard: the recommended list vs current practice vs three judges' styles, 3,000-case roster
PYTHONPATH=src python -m causelist.cli --roster data/roster_3000.csv \
    --config optimal --compare baseline block_schedule cluster_by_advocate fresh_matters_first

# 2. The web app: scorecard, court day, what-if, backlog, people (L3), world (L4)
cd web && pnpm install && pnpm build && pnpm start        # http://localhost:3000
#    live what-if needs the engine API (from submissions/aiquity-for-efficient-courts, another terminal):
#    PYTHONPATH=src uvicorn causelist.api:app --port 8000

# 3. Tests (determinism, schedule validator, calibration against the organiser tables)
cd .. && PYTHONPATH=src python -m pytest
```

Outputs land in `out/`: `causelist_<config>.csv` (every day's causelist with appointment windows,
why each case was listed, the simulated outcome and the recommended next date), `scorecard.json`,
and `flags_<config>.json`.

## Layout

```
config/            judge presets (YAML) - change rules without code
data/roster_3000.csv   generated with scripts/generate_roster.py --num-cases 3000 --seed 42
src/causelist/
  reference.py     organiser tables -> hearing types, reason groups, lifecycle, calendar
  roster.py        roster CSV -> Case objects
  domain.py        shared data model (Case, Listing, DayPlan, HearingOutcome, Event, Annotation)
  interfaces.py    plug-in points: Behaviour (L2/L3), InflowSource (L4)
  behaviour.py     statistical behaviour (observed rates, per-case adjustments, correlated absence)
  planning.py      baseline / greedy / MILP daily planners + appointment windows
  horizon.py       rolling multi-day date assignment (published provisional dates)
  simulate.py      the court run forward day by day
  metrics.py       the five scored dimensions + supporting numbers
  montecarlo.py    many seeds -> mean and spread
  validate.py      independent re-check of every produced causelist
  agents/          L3 behavioural agents
  world/           L4 world model
  export.py / api.py / precompute.py   JSON export, live HTTP API, static scenario files
web/               Next.js app (COLORS.md, DESIGN.md, DATA_CONTRACT.md)
tests/
```
