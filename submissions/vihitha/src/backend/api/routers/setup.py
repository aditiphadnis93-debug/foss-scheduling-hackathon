"""Health and setup routes (HTTP only)."""
from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Request, Response

from ..errors import ValidationFailed
from ..schemas.requests import LeaveIn, ResetIn, RosterLoad, SettingsIn
from ..services import health_service, setup_service

router = APIRouter()


def _qdate(request: Request, key: str, default: date) -> date:
    v = request.query_params.get(key)
    try:
        return date.fromisoformat(v) if v else default
    except ValueError:
        raise ValidationFailed(f"'{key}' must be YYYY-MM-DD")


@router.get("/health")
def health():
    return health_service.health()


@router.post("/setup/roster")
async def load_roster(request: Request):
    if request.headers.get("content-type", "").startswith("multipart/form-data"):
        form = await request.form()
        f = form.get("file")
        content = await f.read() if f is not None and hasattr(f, "read") else None
        reset = str(form.get("reset", "false")).lower() in ("1", "true", "yes", "on")
        n, seed = form.get("n"), form.get("seed")
        return setup_service.load_roster(str(form.get("source") or "UPLOAD"), int(n) if n else None,
                                         int(seed) if seed else None, content, reset)
    raw = await request.body()
    body = RosterLoad.model_validate_json(raw) if raw else RosterLoad()
    return setup_service.load_roster(body.source, body.n, body.seed, None, body.reset)


@router.get("/setup/roster/summary")
def roster_summary():
    return setup_service.roster_summary()


@router.get("/setup/reference")
def reference():
    return setup_service.reference()


@router.get("/setup/calendar")
def calendar(request: Request):
    return setup_service.calendar(_qdate(request, "from", date(2026, 9, 1)), _qdate(request, "to", date(2026, 12, 31)))


@router.post("/setup/leave")
def add_leave(body: LeaveIn):
    return setup_service.add_leave(body.date, body.note)


@router.delete("/setup/leave/{d}", status_code=204)
def remove_leave(d: date):
    setup_service.remove_leave(d)
    return Response(status_code=204)


@router.get("/setup/settings")
def get_settings():
    return setup_service.get_settings()


@router.put("/setup/settings")
def put_settings(body: SettingsIn):
    return setup_service.put_settings(body.model_dump(exclude_none=True))


@router.post("/setup/reset", status_code=204)
def reset(body: ResetIn):
    setup_service.reset(body.confirm)
    return Response(status_code=204)
