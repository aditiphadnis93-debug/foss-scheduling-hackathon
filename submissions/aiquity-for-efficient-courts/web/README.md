# AIQuity for Efficient Courts — web app

The judge's view of the scheduler, plus the people and the town around the court.

```bash
pnpm install
pnpm build && pnpm start      # http://localhost:3000  (or: pnpm dev)
```

It works as a static site from the precomputed runs in `public/data/`. To regenerate them, run
`PYTHONPATH=src python -m causelist.precompute` from `submissions/aiquity-for-efficient-courts`. For live
what-if, start the engine API from `submissions/aiquity-for-efficient-courts`:

```bash
PYTHONPATH=src uvicorn causelist.api:app --port 8000
```

`NEXT_PUBLIC_API_URL` overrides the default `http://localhost:8000`.

Pages:
- Home
- How it works
- Scorecard
- Court day
- What people see
- What-if
- Backlog
- Who is the delay
- Profiles
- Audit
- People
- Observatory
- World
- Case file (`/case/<id>`)

Data schema: [`DATA_CONTRACT.md`](DATA_CONTRACT.md). Colours: [`COLORS.md`](COLORS.md). Motion and 3D: [`DESIGN.md`](DESIGN.md).
