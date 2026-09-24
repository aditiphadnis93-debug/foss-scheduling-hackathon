"""Calendar, schedule and hearing routes (HTTP only)."""
from __future__ import annotations

from datetime import date
from typing import Optional

from fastapi import APIRouter, Body

from ..schemas.requests import (AutoIn, DateIn, HearingAdd, HearingPatch, NextDateIn, OutcomeIn, PlanIn,
                                PreviewIn, RangeIn)
from ..services import hearing_service, schedule_service

router = APIRouter()


@router.get("/calendar/day/{d}")
def day(d: date):
    return schedule_service.day(d)


@router.get("/calendar/week")
def week(start: date):
    return schedule_service.week(start)


@router.get("/calendar/month")
def month(month: str):
    return schedule_service.month(month)


@router.post("/schedule/plan")
def plan(body: Optional[PlanIn] = Body(default=None)):
    body = body or PlanIn()
    return schedule_service.plan_range(body.from_, body.to, body.force)


@router.post("/schedule/publish")
def publish(body: RangeIn):
    return schedule_service.publish(body.from_, body.to)


@router.post("/schedule/unpublish")
def unpublish(body: DateIn):
    return schedule_service.unpublish(body.date)


@router.get("/schedule/unscheduled")
def unscheduled():
    return schedule_service.unscheduled()


@router.post("/hearings/preview")
def preview(body: PreviewIn):
    return hearing_service.preview(body.change.model_dump())


@router.post("/hearings")
def add(body: HearingAdd):
    return hearing_service.add(body.model_dump())


@router.patch("/hearings/{hid}")
def move(hid: int, body: HearingPatch):
    return hearing_service.move(hid, body.model_dump())


@router.delete("/hearings/{hid}")
def remove(hid: int, force: bool = False):
    return hearing_service.remove(hid, force)


@router.post("/hearings/{hid}/outcome")
def outcome(hid: int, body: OutcomeIn):
    return hearing_service.record_outcome(hid, body.model_dump())


@router.get("/hearings/{hid}/next-date")
def next_date(hid: int):
    return hearing_service.suggest_next_date(hid)


@router.post("/hearings/{hid}/next-date")
def confirm_next_date(hid: int, body: NextDateIn):
    return hearing_service.confirm_next_date(hid, body.model_dump())


@router.post("/calendar/day/{d}/close")
def close_day(d: date):
    return schedule_service.close_day(d)


@router.post("/calendar/day/{d}/auto-outcomes")
def auto_outcomes(d: date, body: Optional[AutoIn] = Body(default=None)):
    body = body or AutoIn()
    return schedule_service.auto_outcomes(d, body.seed, body.agents)
