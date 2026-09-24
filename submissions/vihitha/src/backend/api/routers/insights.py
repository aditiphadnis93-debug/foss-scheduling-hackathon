"""Cases, what-if, metrics, public and export routes (HTTP only)."""
from __future__ import annotations

from datetime import date
from typing import Optional

from fastapi import APIRouter, Body, Query, Request
from fastapi.responses import PlainTextResponse

from ..errors import ValidationFailed
from ..schemas.requests import WhatIfApply, WhatIfIn
from ..services import case_service, export_service, metrics_service, public_service, whatif_service

router = APIRouter()


def _d(request: Request, key: str) -> Optional[date]:
    v = request.query_params.get(key)
    try:
        return date.fromisoformat(v) if v else None
    except ValueError:
        raise ValidationFailed(f"'{key}' must be YYYY-MM-DD")


@router.get("/cases")
def cases(stage: Optional[str] = None, bucket: Optional[str] = None, status: Optional[str] = None,
          q: Optional[str] = None, ends_before: Optional[date] = None, flag: Optional[str] = None,
          sort: str = "age_desc", page: int = 1, size: int = 50):
    return case_service.list_(stage, bucket, status, q, ends_before, flag, sort, page, size)


@router.get("/cases/forecast/summary")
def forecast_summary():
    return case_service.forecast_summary()


@router.get("/cases/{case_id:path}")
def case_detail(case_id: str):
    return case_service.detail(case_id)


@router.post("/whatif")
def whatif(body: WhatIfIn):
    return whatif_service.run(body.model_dump())


@router.post("/whatif/{wid}/apply")
def whatif_apply(wid: str, body: Optional[WhatIfApply] = Body(default=None)):
    body = body or WhatIfApply()
    return whatif_service.apply(wid, body.from_date, body.name)


@router.get("/metrics/summary")
def metrics_summary(request: Request):
    return metrics_service.summary(_d(request, "from"), _d(request, "to"))


@router.get("/metrics/scoring")
def metrics_scoring(request: Request, source: str = "simulated"):
    return metrics_service.scoring(_d(request, "from"), _d(request, "to"), source)


@router.get("/public/slot")
def public_slot(case_no: str = Query(...)):
    return public_service.slot(case_no)


def _csv(text: str, name: str) -> PlainTextResponse:
    return PlainTextResponse(text, media_type="text/csv",
                             headers={"Content-Disposition": f'attachment; filename="{name}"'})


@router.get("/export/cause-list.csv")
def cause_list(date_: date = Query(alias="date")):
    return _csv(export_service.cause_list(date_), f"cause_list_{date_.isoformat()}.csv")


@router.get("/export/proposed_schedule.csv")
def proposed_schedule(request: Request):
    return _csv(export_service.proposed_schedule(_d(request, "from"), _d(request, "to")), "proposed_schedule.csv")
