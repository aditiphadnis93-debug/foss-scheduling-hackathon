"""FastAPI readiness + scheduler service for FOSS Scheduling Justice L1."""

from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Literal, Optional

from fastapi import FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from .db import init_db
from .packer import AGE_WEIGHT_MIN, DEFAULT_JUDGE_ID
from .probabilities import calendar_rows
from .seed import resolve_default_roster, resolve_roster_3000, seed_demo, seed_roster
from . import scheduler_store as sched
from . import store as store_mod

DB_PATH = Path(__file__).resolve().parent.parent / "data" / "readiness.db"


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Schema + policy defaults only — leave empty DB empty for Overview onboarding.
    init_db(DB_PATH)
    yield


app = FastAPI(
    title="Sama-Panda Readiness + Scheduler API",
    description=(
        "Master causelist readiness gating (READY|BLOCKED|HEALING) "
        "plus L1 minute packer / Generate causelist."
    ),
    version="0.2.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_conn():
    from .db import connect

    return connect(DB_PATH)


def actor_role(x_actor_role: Optional[str]) -> str:
    role = (x_actor_role or "counsel").strip().lower()
    if role not in ("registry", "counsel", "party"):
        raise HTTPException(400, f"Invalid X-Actor-Role: {x_actor_role}")
    return role


class ActionBody(BaseModel):
    action: Literal[
        "upload",
        "confirm_evidence",
        "confirm_counsel",
        "process_ack",
        "rsvp",
        "undertake",
        "flag_adjournment",
        "withdraw_adjournment",
        "eta_report",
    ]
    note: Optional[str] = None
    evidence_uri: Optional[str] = None
    window: Optional[str] = None


class RejectBody(BaseModel):
    reason: str = Field(..., min_length=1)


class WaiveBody(BaseModel):
    note: str = Field(..., min_length=1)


class PolicyBody(BaseModel):
    blocking: bool


class DurationRow(BaseModel):
    purpose: str
    stage: Optional[str] = None
    minutes: int = Field(..., ge=1, le=120)


class DurationTableBody(BaseModel):
    rows: list[DurationRow]


class PrefsBody(BaseModel):
    overbook_buffer_pct: Optional[float] = None
    age_weight: Optional[float] = None
    prefer_same_advocate_cluster: Optional[bool] = None
    virtual_hybrid_default: Optional[bool] = None
    strict_adjournment_band: Optional[bool] = None
    max_cases_per_block: Optional[int] = None
    capacity_mins_default: Optional[int] = None


class SittingTemplateBody(BaseModel):
    capacity_mins: Optional[int] = 420
    blocks: list[dict[str, Any]]


class GenerateBody(BaseModel):
    judge_id: str = DEFAULT_JUDGE_ID
    date: str = Field(..., description="YYYY-MM-DD sitting date")
    overbook_buffer_pct: Optional[float] = None
    force_holiday: bool = False
    blocks: Optional[list[dict[str, Any]]] = None
    exclude_case_numbers: list[str] = Field(
        default_factory=list,
        description="Case or filing numbers already packed on earlier sitting days",
    )


@app.get("/health")
def health() -> dict[str, Any]:
    return {"ok": True, "service": "sama-panda-readiness-scheduler", "db": str(DB_PATH)}


@app.post("/seed")
def seed(
    roster_path: Optional[str] = Query(None, description="Path to roster CSV"),
    reset: bool = Query(False),
    preset: Optional[str] = Query(
        None, description="Alias e.g. roster_3000 → local data/roster_3000.csv"
    ),
) -> dict[str, Any]:
    if preset and preset.strip().lower() in ("roster_3000", "3000"):
        path = resolve_roster_3000()
    elif roster_path:
        path = Path(roster_path)
    else:
        path = resolve_default_roster()
    try:
        result = seed_roster(path, DB_PATH, reset_defects=reset)
    except FileNotFoundError as e:
        raise HTTPException(404, str(e)) from e
    return result


@app.post("/seed/demo")
def seed_demo_endpoint() -> dict[str, Any]:
    """Wipe demo data then seed the local 3,000-row roster (one-shot onboarding)."""
    try:
        return seed_demo(DB_PATH)
    except FileNotFoundError as e:
        raise HTTPException(404, str(e)) from e


@app.post("/reset")
def reset_demo_data() -> dict[str, Any]:
    """Clear case/demo state while preserving defect policy and judge config."""
    conn = get_conn()
    try:
        store_mod.wipe_demo(conn)
        return store_mod.stats(conn)
    finally:
        conn.close()


@app.get("/cases")
def cases(
    status: Optional[str] = None,
    purpose: Optional[str] = None,
    q: Optional[str] = None,
) -> dict[str, Any]:
    conn = get_conn()
    try:
        items = store_mod.list_cases(conn, status=status, purpose=purpose, q=q)
        slim = [
            {
                "case_number": c["case_number"],
                "filing_number": c.get("filing_number"),
                "filing_date": c.get("filing_date"),
                "age_days": c.get("age_days"),
                "purpose": c.get("purpose"),
                "stage": c.get("stage"),
                "readiness_status": c.get("readiness_status"),
                "open_defect_count": c.get("open_defect_count"),
                "blocking_open_count": c.get("blocking_open_count"),
                "open_soft_defect_count": c.get("open_soft_defect_count"),
                "advocate_id": c.get("advocate_id"),
                "party_id": c.get("party_id"),
                "duration_mins_estimate": c.get("duration_mins_estimate"),
            }
            for c in items
        ]
        return {"count": len(slim), "cases": slim}
    finally:
        conn.close()


@app.get("/cases/{case_number:path}")
def case_detail(
    case_number: str,
    x_actor_role: Optional[str] = Header(None, alias="X-Actor-Role"),
) -> dict[str, Any]:
    role = actor_role(x_actor_role)
    conn = get_conn()
    try:
        detail = store_mod.get_case_detail(conn, case_number, role=role)
        if not detail:
            raise HTTPException(404, f"Case not found: {case_number}")
        return detail
    finally:
        conn.close()


@app.post("/cases/{case_number:path}/defects/{defect_id}/actions")
def defect_action(
    case_number: str,
    defect_id: str,
    body: ActionBody,
    x_actor_role: Optional[str] = Header(None, alias="X-Actor-Role"),
) -> dict[str, Any]:
    role = actor_role(x_actor_role)
    conn = get_conn()
    try:
        try:
            result = store_mod.apply_party_action(
                conn,
                case_number=case_number,
                defect_id=defect_id,
                action=body.action,
                role=role,
                note=body.note,
                evidence_uri=body.evidence_uri,
                window=body.window,
            )
        except KeyError as e:
            raise HTTPException(404, str(e)) from e
        except PermissionError as e:
            raise HTTPException(403, str(e)) from e
        except ValueError as e:
            raise HTTPException(400, str(e)) from e
        return result
    finally:
        conn.close()


@app.post("/registry/defects/{defect_id}/verify")
def registry_verify(
    defect_id: str,
    x_actor_role: Optional[str] = Header(None, alias="X-Actor-Role"),
) -> dict[str, Any]:
    role = actor_role(x_actor_role or "registry")
    if role != "registry":
        raise HTTPException(403, "X-Actor-Role must be registry")
    conn = get_conn()
    try:
        try:
            return store_mod.registry_verify(conn, defect_id, role=role)
        except KeyError as e:
            raise HTTPException(404, str(e)) from e
        except (PermissionError, ValueError) as e:
            raise HTTPException(400, str(e)) from e
    finally:
        conn.close()


@app.post("/registry/defects/{defect_id}/reject")
def registry_reject(
    defect_id: str,
    body: RejectBody,
    x_actor_role: Optional[str] = Header(None, alias="X-Actor-Role"),
) -> dict[str, Any]:
    role = actor_role(x_actor_role or "registry")
    if role != "registry":
        raise HTTPException(403, "X-Actor-Role must be registry")
    conn = get_conn()
    try:
        try:
            return store_mod.registry_reject(conn, defect_id, reason=body.reason, role=role)
        except KeyError as e:
            raise HTTPException(404, str(e)) from e
        except (PermissionError, ValueError) as e:
            raise HTTPException(400, str(e)) from e
    finally:
        conn.close()


@app.post("/registry/defects/{defect_id}/waive")
def registry_waive(
    defect_id: str,
    body: WaiveBody,
    x_actor_role: Optional[str] = Header(None, alias="X-Actor-Role"),
) -> dict[str, Any]:
    role = actor_role(x_actor_role or "registry")
    if role != "registry":
        raise HTTPException(403, "X-Actor-Role must be registry")
    conn = get_conn()
    try:
        try:
            return store_mod.registry_waive(conn, defect_id, note=body.note, role=role)
        except KeyError as e:
            raise HTTPException(404, str(e)) from e
        except (PermissionError, ValueError) as e:
            raise HTTPException(400, str(e)) from e
    finally:
        conn.close()


@app.get("/registry/queue")
def registry_queue(
    x_actor_role: Optional[str] = Header(None, alias="X-Actor-Role"),
) -> dict[str, Any]:
    role = actor_role(x_actor_role or "registry")
    conn = get_conn()
    try:
        items = store_mod.registry_queue(conn)
        return {"count": len(items), "defects": items, "viewer_role": role}
    finally:
        conn.close()


@app.get("/eligibility")
def eligibility(
    as_of: str = Query("2026-09-22"),
) -> dict[str, Any]:
    conn = get_conn()
    try:
        return store_mod.eligibility(conn, as_of=as_of)
    finally:
        conn.close()


@app.get("/policy")
def get_policy() -> dict[str, Any]:
    """List defect policy: blocking + locked_by_law for every known code."""
    from .catalog import DEFECT_DESCRIPTIONS, severity_for

    conn = get_conn()
    try:
        policy = store_mod.get_policy(conn)
        items = [
            {
                "code": code,
                "blocking": info["blocking"],
                "locked_by_law": info["locked_by_law"],
                "severity": severity_for(code),
                "description": DEFECT_DESCRIPTIONS.get(code, ""),
            }
            for code, info in sorted(policy.items())
        ]
        return {"count": len(items), "policy": items}
    finally:
        conn.close()


@app.get("/calendar")
def calendar(
    from_date: Optional[str] = Query(None, alias="from", description="Inclusive YYYY-MM-DD"),
    to_date: Optional[str] = Query(None, alias="to", description="Inclusive YYYY-MM-DD"),
) -> dict[str, Any]:
    """Return court working days, weekly offs, and holidays from the CSV calendar."""
    from datetime import date

    try:
        start = date.fromisoformat(from_date) if from_date else None
        end = date.fromisoformat(to_date) if to_date else None
    except ValueError as e:
        raise HTTPException(400, "Calendar dates must use YYYY-MM-DD") from e
    if start and end and start > end:
        raise HTTPException(400, "Calendar 'from' date must be on or before 'to'")

    days = calendar_rows(
        start.isoformat() if start else None,
        end.isoformat() if end else None,
    )
    return {"count": len(days), "days": days}


@app.patch("/policy/{code}")
def patch_policy(
    code: str,
    body: PolicyBody,
    x_actor_role: Optional[str] = Header(None, alias="X-Actor-Role"),
) -> dict[str, Any]:
    """Judge/registry toggles soft↔blocking. Locked-by-law codes return 403."""
    role = actor_role(x_actor_role or "registry")
    if role not in ("registry",):
        raise HTTPException(403, "X-Actor-Role must be registry to change policy")
    conn = get_conn()
    try:
        try:
            return store_mod.set_policy(conn, code, blocking=body.blocking, role=role)
        except KeyError as e:
            raise HTTPException(404, str(e)) from e
        except PermissionError as e:
            raise HTTPException(403, str(e)) from e
    finally:
        conn.close()


@app.get("/stats")
def stats() -> dict[str, Any]:
    conn = get_conn()
    try:
        return store_mod.stats(conn)
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Scheduler / minute packer endpoints
# ---------------------------------------------------------------------------


@app.get("/judges/{judge_id}/duration-table")
def get_duration_table(judge_id: str = DEFAULT_JUDGE_ID) -> dict[str, Any]:
    conn = get_conn()
    try:
        return sched.get_duration_table(conn, judge_id)
    finally:
        conn.close()


@app.put("/judges/{judge_id}/duration-table")
def put_duration_table(judge_id: str, body: DurationTableBody) -> dict[str, Any]:
    conn = get_conn()
    try:
        try:
            return sched.put_duration_table(
                conn, judge_id, [r.model_dump() for r in body.rows]
            )
        except ValueError as e:
            raise HTTPException(400, str(e)) from e
    finally:
        conn.close()


@app.post("/judges/{judge_id}/duration-table/reset")
def reset_duration_table(judge_id: str = DEFAULT_JUDGE_ID) -> dict[str, Any]:
    conn = get_conn()
    try:
        return sched.reset_duration_table(conn, judge_id)
    finally:
        conn.close()


@app.get("/judges/{judge_id}/prefs")
def get_prefs(judge_id: str = DEFAULT_JUDGE_ID) -> dict[str, Any]:
    conn = get_conn()
    try:
        return sched.get_prefs(conn, judge_id)
    finally:
        conn.close()


@app.put("/judges/{judge_id}/prefs")
def put_prefs(judge_id: str, body: PrefsBody) -> dict[str, Any]:
    conn = get_conn()
    try:
        data = body.model_dump(exclude_unset=True)
        if "age_weight" in data and data["age_weight"] is not None:
            if float(data["age_weight"]) <= 0:
                raise HTTPException(
                    400,
                    f"age_weight must be > 0 (minimum {AGE_WEIGHT_MIN}); cannot zero ageing",
                )
        return sched.put_prefs(conn, judge_id, data)
    finally:
        conn.close()


@app.get("/judges/{judge_id}/sitting-template")
def get_sitting_template(judge_id: str = DEFAULT_JUDGE_ID) -> dict[str, Any]:
    conn = get_conn()
    try:
        return sched.get_sitting_template(conn, judge_id)
    finally:
        conn.close()


@app.put("/judges/{judge_id}/sitting-template")
def put_sitting_template(judge_id: str, body: SittingTemplateBody) -> dict[str, Any]:
    conn = get_conn()
    try:
        try:
            return sched.put_sitting_template(conn, judge_id, body.model_dump())
        except ValueError as e:
            raise HTTPException(400, str(e)) from e
    finally:
        conn.close()


def _run_generate(body: GenerateBody) -> dict[str, Any]:
    conn = get_conn()
    try:
        try:
            return sched.generate_causelist(
                conn,
                judge_id=body.judge_id or DEFAULT_JUDGE_ID,
                sitting_date=body.date,
                overbook_buffer_pct=body.overbook_buffer_pct,
                force_holiday=body.force_holiday,
                blocks=body.blocks,
                exclude_case_numbers=body.exclude_case_numbers,
            )
        except ValueError as e:
            raise HTTPException(400, str(e)) from e
    finally:
        conn.close()


@app.post("/generate")
def generate(body: GenerateBody) -> dict[str, Any]:
    """Pack READY cases into sitting blocks; persist draft for judge+date."""
    return _run_generate(body)


@app.post("/judges/{judge_id}/sittings/{sitting_date}/generate")
def generate_alias(judge_id: str, sitting_date: str, body: Optional[GenerateBody] = None) -> dict[str, Any]:
    """Alias: POST /judges/{id}/sittings/{date}/generate."""
    payload = body or GenerateBody(judge_id=judge_id, date=sitting_date)
    # Path wins over body for id/date
    merged = GenerateBody(
        judge_id=judge_id,
        date=sitting_date,
        overbook_buffer_pct=payload.overbook_buffer_pct,
        force_holiday=payload.force_holiday,
        blocks=payload.blocks,
        exclude_case_numbers=payload.exclude_case_numbers,
    )
    return _run_generate(merged)


@app.get("/drafts/{judge_id}/{sitting_date}")
def get_draft(judge_id: str, sitting_date: str) -> dict[str, Any]:
    conn = get_conn()
    try:
        draft = sched.get_draft(conn, judge_id, sitting_date)
        if not draft:
            raise HTTPException(404, f"No draft for {judge_id} on {sitting_date}")
        return draft
    finally:
        conn.close()
