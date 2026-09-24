# Submission: sama-panda

## 1. Team

- **Team / solo name:** sama-panda
- **Members:** Sama (sama-panda) / Paul (P&A)
- **Complexity level claimed:** L1 readiness + L1 minute packer (greedy)

## 2. One-line summary

Readiness gate (blocking/soft defects) + Zeng-style minute packer `Generate` for READY-only cause lists.

## 3. The approach

- Soft defects do not block READY; judge toggles soft↔blocking via `GET/PATCH /policy`.
- `POST /generate` packs READY cases by expected load with a +25% overbook buffer into sitting blocks; waitlists the rest (`no_capacity`).
- Multi-day / week mode uses `exclude_case_numbers` so later days take the next tranche.
- Onboarding: `POST /seed/demo` (wipe + seed roster_3000) and `POST /reset` (empty without reseeding).
- Court-Time-Planner UI shell (`ui/artifacts/court-time-planner`) wired to our FastAPI service.

## 4. Justify your complexity level

- **L1 (fixed behaviour):** Fixed defect catalog, deterministic readiness, fixed duration table + greedy minute packer. No ML, no agents, no learned distributions.
- **L2 / L3:** Not claimed.

## 5. Results

- 3k roster seed → ~269 READY with soft RSVP policy (rest BLOCKED/HEALING).
- Generate on a working day → ~13 listed / ~390 expected mins into 420 capacity; remainder waitlisted for minute capacity.
- UI: Overview (Seed demo), Roster, Eligibility, Cause List (Calendar + Generate), Defect policy, Registry queue.

## 6. Specs for integration

- **Data:** Local `data/roster_3000.csv` + `data/court_calendar.csv`; SQLite `data/readiness.db` (gitignored).
- **API:** FastAPI `src/main.py`; stub auth `X-Actor-Role: registry|counsel|party`.
- **UI:** Vite/React Court-Time-Planner under `ui/`.
- **Deps:** Python 3.10+, fastapi, uvicorn, pydantic, pytest; pnpm for UI.

## 7. How to run it

```bash
# Terminal A — API
cd submissions/sama-panda
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn src.main:app --reload --host 127.0.0.1 --port 8000

# Seed demo roster (or use Overview → Seed in UI)
curl -X POST http://127.0.0.1:8000/seed/demo

# Terminal B — UI
cd submissions/sama-panda/ui
pnpm install
cd artifacts/court-time-planner
PORT=5173 BASE_PATH=/ pnpm dev
# → http://127.0.0.1:5173/

# smoke
curl -s http://127.0.0.1:8000/stats
pytest -q src/tests
```

Reset to empty without reseeding: `curl -X POST http://127.0.0.1:8000/reset`

## 8. What we'd build next

Expire HEALING deadlines; bulk process-return for warrant clusters; richer Impact/Finalise flows; live CIS roster ETL.

---
**Checklist before you open your PR:**
- [x] No real case numbers, party names, or advocate names appear anywhere in this submission.
- [x] Everything lives under `submissions/sama-panda/`.
- [x] This file is filled in, not left as a template.
- [x] Your code actually runs with the commands in section 7.
