"""Core data model shared by every layer (planner, simulator, agents, world, dashboard).

This file is the integration contract. Change it only through the design note.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from typing import Any, Literal

CaseStatus = Literal["pending", "disposed"]
OutcomeKind = Literal[
    "substantive",      # heard and moved to the next purpose (or disposed)
    "adjourned",        # heard/called but did not move forward (reason says why)
    "not_reached",      # listed but the day ran out before it was called
    "not_ready",        # prerequisite unmet (process unserved, filing not ready)
]


@dataclass
class Case:
    case_id: str
    filing_number: str
    filing_date: date
    advocate_id: str
    party_id: str
    stage: str                      # current substantive stage (STAGE_ORDER code)
    purpose: str                    # purpose of the next hearing (may be an interrupt type)
    hearings_by_type: dict[str, int] = field(default_factory=dict)
    total_hearings: int = 0
    # --- state tracked by the simulator ---
    status: CaseStatus = "pending"
    ready_on: date | None = None     # earliest date prerequisites are met (None = ready now)
    next_date: date | None = None    # recommended next hearing date (None = unscheduled)
    first_listed_on: date | None = None   # first listing for the *current* purpose
    listed_count_current: int = 0    # times listed for the current purpose
    adjournments_in_row: int = 0
    hearings_at_stage: int = 0
    last_heard_on: date | None = None
    accused_absent_last: bool = False
    complainant_absent_last: bool = False
    confirmed_ready: bool = False    # preparedness confirmed in advance (agents / portal)
    carry_weekday: int | None = None  # block-scheduler: stays on this weekday until heard
    published_date: date | None = None   # provisional date published by the horizon planner
    origin: str = "roster"           # "roster" | "world" (new filing from the world model)
    meta: dict[str, Any] = field(default_factory=dict)

    def age_years(self, on: date) -> float:
        return (on - self.filing_date).days / 365.25


@dataclass
class Listing:
    """One line of a causelist."""
    case_id: str
    day: date
    slot: str                 # slot name from the judge config, e.g. "fresh", "old"
    start_min: int            # minutes after court start (appointment window start)
    end_min: int              # appointment window end
    purpose: str
    advocate_id: str
    expected_minutes: float   # planner's expected court time for this listing
    p_goes_ahead: float       # planner's estimate the hearing happens
    p_substantive: float      # planner's estimate it moves the case forward
    score: float
    why: list[str] = field(default_factory=list)   # human-readable reasons it was listed


@dataclass
class DayPlan:
    day: date
    listings: list[Listing]
    capacity_minutes: int
    expected_minutes: float
    held_back: list[tuple[str, str]] = field(default_factory=list)  # (case_id, reason) eligible but not listed
    solver: str = ""
    standby: list[Listing] = field(default_factory=list)  # called only if the day ends early


@dataclass
class HearingOutcome:
    case_id: str
    day: date
    purpose: str
    kind: OutcomeKind
    reason: str | None
    minutes_used: float
    next_purpose: str | None
    next_date: date | None
    decided_by: str = "statistical"   # which behaviour model made the attendance decision


@dataclass
class DayResult:
    day: date
    plan: DayPlan
    outcomes: list[HearingOutcome]
    minutes_used: float
    new_filings: int = 0


@dataclass
class Event:
    """Append-only trace consumed by the dashboard and the world board."""
    day: date
    kind: str          # "listed" | "outcome" | "filed" | "agent_decision" | "world" | ...
    case_id: str | None
    data: dict[str, Any] = field(default_factory=dict)


@dataclass
class Annotation:
    """Judge/staff feedback on a prediction -- the data loop for later behaviour modelling."""
    case_id: str
    day: date
    field: str            # e.g. "p_goes_ahead", "expected_minutes", "next_date", "listed"
    predicted: Any
    judge_value: Any      # the judge's correction or verdict ("agree" / "disagree" / a number)
    note: str = ""
    annotator: str = "judge"
