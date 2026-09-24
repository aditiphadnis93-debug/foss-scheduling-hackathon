"""Request bodies (API contract v3). Responses follow API_CONTRACT_v3.md and are built in services/views.py."""
from __future__ import annotations

from datetime import date
from typing import Any, Literal, Optional, Union

from pydantic import BaseModel, ConfigDict, Field


class _In(BaseModel):
    model_config = ConfigDict(extra="ignore")


class RosterLoad(_In):
    source: Literal["SAMPLE", "GENERATE", "UPLOAD"] = "SAMPLE"
    n: Optional[int] = Field(default=None, ge=10, le=20000)
    seed: Optional[int] = None
    reset: bool = False


class LeaveIn(_In):
    date: date
    note: Optional[str] = None


class SettingsIn(_In):
    horizon_working_days: Optional[int] = None
    window_minutes: Optional[int] = None
    today: Optional[date] = None


class ResetIn(_In):
    confirm: bool = False


class RulesetIn(_In):
    name: str
    rules: dict[str, Any]


class RulesetUpdate(_In):
    name: Optional[str] = None
    rules: dict[str, Any]


class ActivateIn(_In):
    ruleset_id: int
    replan_from: Optional[date] = None


class PlanIn(_In):
    from_: Optional[date] = Field(default=None, alias="from")
    to: Optional[date] = None
    force: bool = False


class RangeIn(_In):
    from_: date = Field(alias="from")
    to: date


class DateIn(_In):
    date: date


class Change(_In):
    type: Literal["ADD", "MOVE", "REMOVE", "PIN"]
    hearing_id: Optional[int] = None
    case_id: Optional[str] = None
    to_date: Optional[date] = None
    to_window_start: Optional[str] = None
    pinned: Optional[bool] = None


class PreviewIn(_In):
    change: Change


class HearingAdd(_In):
    case_id: str
    date: date
    window_start: Optional[str] = None


class HearingPatch(_In):
    to_date: Optional[date] = None
    to_window_start: Optional[str] = None
    pinned: Optional[bool] = None
    force: bool = False


class OutcomeIn(_In):
    result: Literal["MOVED_FORWARD", "ADJOURNED", "NOT_REACHED", "DISPOSED"]
    reason_group: Optional[Literal["ABSENCE", "PREP", "PROCESS", "COURT", "UNCLEAR"]] = None
    disposal_type: Optional[Literal["CONVICTION", "ACQUITTAL", "JUDGEMENT", "SETTLED", "WITHDRAWN", "DISMISSED"]] = None
    actual_start: Optional[str] = Field(default=None, pattern=r"^\d{2}:\d{2}$")
    actual_end: Optional[str] = Field(default=None, pattern=r"^\d{2}:\d{2}$")
    note: Optional[str] = None


class NextDateIn(_In):
    date: Optional[date] = None
    accept_suggestion: bool = False
    window_start: Optional[str] = None


class AutoIn(_In):
    seed: Optional[int] = None
    agents: Optional[bool] = None


class WhatIfIn(_In):
    ruleset_id: Optional[int] = None
    rules: Optional[dict[str, Any]] = None
    preset: Optional[str] = None
    compare_to: Union[int, Literal["ACTIVE", "BASELINE"]] = "ACTIVE"
    horizon_days: Literal[30, 60, 90] = 30
    focus_date: Optional[date] = None
    agents: bool = False
    runs: int = Field(default=1, ge=1, le=5)


class WhatIfApply(_In):
    from_date: Optional[date] = None
    name: Optional[str] = None
