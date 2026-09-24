# sama-panda UI (Court-Time-Planner shell + readiness API)

Visual shell from [Court-Time-Planner](https://github.com/aarnaahuja/Court-Time-Planner), data from **sama-panda FastAPI** on `http://127.0.0.1:8000`. Cause List Generate calls live `POST /generate` per date; Calendar loads `GET /calendar` (fallback `public/court_calendar.csv`). Impact/Finalise stay DEMO-STATIC.

## Backend (readiness)

```bash
cd submissions/sama-panda
source .venv/bin/activate   # or: python3 -m venv .venv && pip install -r requirements.txt
python -m src.seed --reset  # once
uvicorn src.main:app --reload --host 127.0.0.1 --port 8000
```

## Frontend

```bash
cd submissions/sama-panda/ui
pnpm install
cd artifacts/court-time-planner
PORT=5173 BASE_PATH=/ pnpm dev
```

Open http://127.0.0.1:5173/

Optional: `VITE_READINESS_URL=http://127.0.0.1:8000` (default).

Stub auth: sidebar **Role** sets `X-Actor-Role: counsel|party|registry` on API calls.

## Live vs DEMO-STATIC

| Screen | Data |
|--------|------|
| Overview, Roster, Case detail, Eligibility, Registry queue | Live → `:8000` |
| Calendar | Live → `GET /calendar` (fallback `public/court_calendar.csv`) |
| Priorities | DEMO-STATIC (local stubs) |
| Cause List → Generate | Live → `POST /generate` (minute packer · J-DEMO per date) |
| Impact, Finalise | DEMO-STATIC (local stubs) |
