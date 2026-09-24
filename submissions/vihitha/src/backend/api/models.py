"""Database tables (spec v3 section 6)."""
from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, Float, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from .clock import utcnow
from .db import Base


def _now() -> datetime:
    return utcnow()


class CaseRow(Base):
    __tablename__ = "cases"
    id: Mapped[str] = mapped_column(String, primary_key=True)  # filing number
    case_number: Mapped[str] = mapped_column(String, index=True)
    filing_date: Mapped[date] = mapped_column(Date)
    advocate_id: Mapped[str] = mapped_column(String, index=True)
    party_id: Mapped[str] = mapped_column(String)
    stage: Mapped[str] = mapped_column(String, index=True)
    next_purpose: Mapped[str] = mapped_column(String)
    status: Mapped[str] = mapped_column(String, default="PENDING", index=True)  # PENDING | DISPOSED
    disposal_type: Mapped[str | None] = mapped_column(String, nullable=True)
    disposed_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    hearing_counts_json: Mapped[str] = mapped_column(Text, default="{}")
    hearings_at_stage: Mapped[int] = mapped_column(Integer, default=0)
    consecutive_adjourned: Mapped[int] = mapped_column(Integer, default=0)
    consecutive_absence: Mapped[int] = mapped_column(Integer, default=0)
    stage_entered_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    pending_until: Mapped[date | None] = mapped_column(Date, nullable=True)
    pending_reason: Mapped[str | None] = mapped_column(String, nullable=True)
    last_chance: Mapped[bool] = mapped_column(Boolean, default=False)
    accused_seen: Mapped[bool] = mapped_column(Boolean, default=False)
    show_alpha: Mapped[float] = mapped_column(Float, default=1.0)
    show_beta: Mapped[float] = mapped_column(Float, default=1.0)
    not_reached_count: Mapped[int] = mapped_column(Integer, default=0)
    carried_forward: Mapped[bool] = mapped_column(Boolean, default=False)
    priority_boost: Mapped[float] = mapped_column(Float, default=0.0)
    last_listed_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    last_reached_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    last_hearing_summary: Mapped[str] = mapped_column(Text, default="")
    roster_order: Mapped[int] = mapped_column(Integer, default=0)
    forecast_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    forecast_key: Mapped[str | None] = mapped_column(String, nullable=True)
    forecast_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    forecast_p50: Mapped[date | None] = mapped_column(Date, nullable=True, index=True)


class HearingRow(Base):
    __tablename__ = "hearings"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    case_id: Mapped[str] = mapped_column(ForeignKey("cases.id"), index=True)
    date: Mapped[date] = mapped_column(Date, index=True)
    hearing_type: Mapped[str] = mapped_column(String)
    block_id: Mapped[str] = mapped_column(String, default="")
    window_start: Mapped[str] = mapped_column(String, default="")
    window_end: Mapped[str] = mapped_column(String, default="")
    est_start: Mapped[str] = mapped_column(String, default="")
    est_end: Mapped[str] = mapped_column(String, default="")
    seq: Mapped[int] = mapped_column(Integer, default=0)
    duration_min: Mapped[float] = mapped_column(Float, default=0.0)
    expected_minutes: Mapped[float] = mapped_column(Float, default=0.0)
    p_substantive: Mapped[float] = mapped_column(Float, default=0.0)
    score: Mapped[float] = mapped_column(Float, default=0.0)
    reason: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String, default="DRAFT", index=True)  # DRAFT|PUBLISHED|DONE|CANCELLED
    result: Mapped[str | None] = mapped_column(String, nullable=True)
    reason_group: Mapped[str | None] = mapped_column(String, nullable=True)
    disposal_type: Mapped[str | None] = mapped_column(String, nullable=True)
    actual_start: Mapped[str | None] = mapped_column(String, nullable=True)
    actual_end: Mapped[str | None] = mapped_column(String, nullable=True)
    first_promised_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    pinned: Mapped[bool] = mapped_column(Boolean, default=False)
    fixed_window: Mapped[bool] = mapped_column(Boolean, default=False)
    tentative: Mapped[bool] = mapped_column(Boolean, default=False)
    carried_forward: Mapped[bool] = mapped_column(Boolean, default=False)
    origin: Mapped[str] = mapped_column(String, default="PLANNER")  # PLANNER|JUDGE|NEXT_DATE|CARRY_FORWARD
    next_date_gap_ok: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (Index("ix_hearings_case_status", "case_id", "status"),)


class DayRow(Base):
    __tablename__ = "days"
    date: Mapped[date] = mapped_column(Date, primary_key=True)
    status: Mapped[str] = mapped_column(String, default="DRAFT")  # DRAFT | PUBLISHED | CLOSED
    ruleset_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    published_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class RulesetRow(Base):
    __tablename__ = "rulesets"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String)
    preset: Mapped[str] = mapped_column(String, default="custom")
    body_json: Mapped[str] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)


class LeaveRow(Base):
    __tablename__ = "leave"
    date: Mapped[date] = mapped_column(Date, primary_key=True)
    note: Mapped[str | None] = mapped_column(String, nullable=True)


class SettingRow(Base):
    __tablename__ = "settings"
    key: Mapped[str] = mapped_column(String, primary_key=True)
    value_json: Mapped[str] = mapped_column(Text)
