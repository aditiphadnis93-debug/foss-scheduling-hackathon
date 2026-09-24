# sama-panda — Readiness + Minute Packer (L1)

FOSS Scheduling Justice: invent defects from roster purpose + `last_hearing_summary`, track `READY | BLOCKED | HEALING`, then **Generate** a draft causelist by packing READY cases into judge calendar blocks (Zeng-style expected-load + 25% overbook).

## Setup

```bash
cd submissions/sama-panda
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Seed + run API

```bash
# Terminal A — API
uvicorn src.main:app --reload --host 127.0.0.1 --port 8000

# Seed demo (wipe + roster_3000) — or Overview → Seed in UI
curl -X POST http://127.0.0.1:8000/seed/demo
# alt: python -m src.seed --reset
```

DB file: `submissions/sama-panda/data/readiness.db`  
Hackathon data CSVs (read-only): `../../data/` (`hearing_type_reference`, substantiveness, failure reasons, court_calendar).

## Quick demo (curl)

```bash
curl -s http://127.0.0.1:8000/stats
curl -s 'http://127.0.0.1:8000/eligibility?as_of=2026-09-22' | head

# Generate draft causelist for a working day (2026-09-22 is working)
curl -s -X POST http://127.0.0.1:8000/generate \
  -H 'Content-Type: application/json' \
  -d '{"judge_id":"J-SEHGAL","date":"2026-09-22","overbook_buffer_pct":0.25,"force_holiday":false,"blocks":null}'
```

## Tests

```bash
cd submissions/sama-panda
pytest -q src/tests
```

## Stub auth

Pass header `X-Actor-Role: registry|counsel|party` (default `counsel`).

## Endpoints — readiness

| Method | Path | Notes |
|--------|------|-------|
| GET | `/health` | liveness |
| POST | `/seed?roster_path=&reset=` | idempotent seed (default resolves roster_3000) |
| POST | `/seed/demo` | wipe demo state and seed roster_3000 for onboarding |
| POST | `/reset` | clear cases/defects/audit/drafts; preserve policy + judge config |
| GET | `/cases?status=&purpose=&q=` | master list |
| GET | `/cases/{case_number}` | case + defects |
| POST | `/cases/{case_number}/defects/{defect_id}/actions` | party/counsel actions |
| GET | `/registry/queue` | submitted awaiting verify |
| POST | `/registry/defects/{id}/verify` | → cleared |
| POST | `/registry/defects/{id}/reject` | `{"reason"}` |
| POST | `/registry/defects/{id}/waive` | `{"note"}` required |
| GET | `/eligibility?as_of=` | READY only |
| GET | `/stats` | READY/BLOCKED/HEALING counts |
| GET | `/policy` | soft/blocking map |
| PATCH | `/policy/{code}` | toggle soft↔blocking |

## Endpoints — scheduler (default judge `J-SEHGAL`)

| Method | Path | Notes |
|--------|------|-------|
| GET | `/judges/{judge_id}/duration-table` | system + judge overrides |
| PUT | `/judges/{judge_id}/duration-table` | body `{rows:[{purpose,stage?,minutes}]}` 1–120 |
| POST | `/judges/{judge_id}/duration-table/reset` | restore system defaults |
| GET | `/judges/{judge_id}/prefs` | buffer, age_weight (≥0.5), capacity… |
| PUT | `/judges/{judge_id}/prefs` | clamps buffer 0.10–0.30; rejects age_weight ≤ 0 |
| GET | `/judges/{judge_id}/sitting-template` | blocks + capacity |
| PUT | `/judges/{judge_id}/sitting-template` | |
| POST | `/generate` | pack READY → draft (see body below) |
| POST | `/judges/{id}/sittings/{date}/generate` | alias |
| GET | `/drafts/{judge_id}/{date}` | latest draft |

**POST /generate body:**
```json
{
  "judge_id": "J-SEHGAL",
  "date": "2026-09-22",
  "overbook_buffer_pct": 0.25,
  "force_holiday": false,
  "blocks": null
}
```

**Stable Generate response shape (for Coco):**
```json
{
  "judge_id": "J-SEHGAL",
  "date": "2026-09-22",
  "capacity_mins": 420,
  "overbook_buffer_pct": 0.25,
  "totals": {
    "cases_listed": 24,
    "expected_load_mins": 502.0,
    "nominal_duration_sum_mins": 610,
    "waitlisted": 118,
    "ready_pool": 269
  },
  "blocks": [
    {
      "block_id": "B1",
      "label": "List 2 — …",
      "list_section": 2,
      "sequence": 1,
      "minute_budget": 90,
      "used_expected_mins": 40.2,
      "entries": [
        {
          "serial": 1,
          "case_number": "ST/…",
          "filing_number": "KL-…",
          "purpose": "BAIL",
          "current_stage": "…",
          "score": 12.4,
          "duration_mins": 15,
          "expected_load_mins": 8.1,
          "advocate_id": "ADV-012",
          "badges": []
        }
      ]
    }
  ],
  "waitlist": [
    {
      "case_number": "…",
      "filing_number": "…",
      "purpose": "…",
      "reason": "no_capacity",
      "suggested_next_date": "2026-10-20",
      "score": 9.1
    }
  ]
}
```

### Packer notes
- Candidates = **READY only** (refreshed from store at Generate; no defect re-gating).
- `expected_load = duration × P_show × P_substantive` per purpose.
- `P_show = 1 − (absence-related failure share)` from `hearing_failure_reasons.csv`.
- Duration lookup: judge `(purpose, stage)` → `(purpose)` → system CSV → roster estimate → 15.
- Soft listed-count guardrail: ≤ 40. Holiday refused unless `force_holiday=true`.

### Not in this slice
- Publish / PDF causelist artefact
- Draft PATCH pin / remove / swap / force-add  
Coco can display the Generate response + `GET /drafts/...` directly.

## Frontend (Court-Time-Planner shell)

See `ui/README.md`. Quick start:

```bash
# Terminal A — API
cd submissions/sama-panda && source .venv/bin/activate
uvicorn src.main:app --reload --host 127.0.0.1 --port 8000

# Terminal B — UI
cd submissions/sama-panda/ui && pnpm install
cd artifacts/court-time-planner && PORT=5173 BASE_PATH=/ pnpm dev
```

### Live in UI
- **Defect policy** (`/policy`) — judge/registry toggles soft↔blocking via `GET/PATCH /policy`. Soft open defects do not gate READY; locked-by-law codes cannot be softened. Set Role → registry in the sidebar.
- **Cause List Generate** — Live (`POST /generate` per working date · J-DEMO · minute packer + overbook buffer).
- **Calendar** — court_calendar (`GET /calendar` when available; else `public/court_calendar.csv`).
- **Defect policy** — code + plain-English “what it means” (API `description` when present; else FE `DEFECT_PLAIN`).
