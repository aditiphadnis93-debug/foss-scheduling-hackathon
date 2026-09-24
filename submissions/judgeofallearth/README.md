# judgeofallearth: Court Planner

A scheduler and a court app for one judge's roster. It decides what to list, packs each day to fit 420 minutes, keeps old cases moving, and shows the judge what each choice does. The write-up is in `SUBMISSION.md`.

## Run

```bash
uv sync
uv run pytest -q                                   # checks
uv run courtsched --out results                    # batch experiments → results/index.html
uv run courtsched-story                            # the model story (each rule's effect)

# the app
COURT_WORKSPACES=./workspaces uv run uvicorn courtsched.app.api:app --port 8765
cd web && npm install && npm run dev               # → http://localhost:3000
```

## Layout

- `src/courtsched/`: engine (planner, simulated court, forecasts), batch experiments, `app/` API.
- `web/`: Next.js app (Today, Plan, Rules & options, Changes, Docket health, How it was built).
- `experiments/`: comparison scripts. `tests/`: behaviour checks.
- Reads the organisers' `data/` folder.
