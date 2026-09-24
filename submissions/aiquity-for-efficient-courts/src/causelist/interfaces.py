"""Plug-in points. The scheduler core depends only on these protocols.

* ``Behaviour``     -- how parties/advocates act on the day (L2 statistical, L3 agents).
* ``InflowSource``  -- where new cases come from while the simulation runs (L4 world model).
"""
from __future__ import annotations

import random
from dataclasses import dataclass
from datetime import date
from typing import Any, Protocol, runtime_checkable

from .domain import Case, HearingOutcome, Listing
from .reference import HearingType


@dataclass
class HearingContext:
    case: Case
    listing: Listing
    hearing_type: HearingType
    day: date
    days_since_last_hearing: int | None
    was_given_appointment: bool     # listing carries a real time window (goal 3)


@dataclass
class AttendanceDecision:
    appears: bool                   # the side needed for this hearing turns up
    ready: bool                     # prepared to proceed if called
    seeks_adjournment: bool
    reason: str | None = None       # a reason label from reference.REASON_GROUPS when not proceeding
    rationale: str = ""             # free text (agents explain themselves; shown on the board)
    source: str = "statistical"
    minutes: float | None = None    # behaviour's own estimate of hearing duration if it goes ahead (simulator uses it when set)


@runtime_checkable
class Behaviour(Protocol):
    name: str

    def readiness_signal(self, cases: list[Case], day: date) -> dict[str, float]:
        """Before listing: probability (0..1) each case's side will turn up prepared.

        Return only the cases you have an opinion on; the planner falls back to the
        statistical estimate for the rest. Used for goal 4 (confirm preparedness).
        """
        ...

    def decide(self, ctx: HearingContext, rng: random.Random) -> AttendanceDecision:
        """On the day: does the side appear, is it ready, does it seek time?"""
        ...

    def observe(self, ctx: HearingContext, outcome: HearingOutcome) -> None:
        """Feedback after the hearing, so behaviour can adapt over time."""
        ...

    # Optional (checked with hasattr by the simulator):
    #   on_plan(plan: DayPlan) -> None   called after planning, before any decide(); lets agents batch
    #                                    their decisions for exactly the listed matters


@runtime_checkable
class InflowSource(Protocol):
    name: str

    def new_filings(self, day: date, rng: random.Random) -> list[Case]:
        """Cases filed on ``day`` (they enter at ADMISSION with origin='world')."""
        ...

    def on_outcome(self, outcome: HearingOutcome) -> None:
        """Court result flows back into the world (disputes resolve, people react)."""
        ...

    # Optional (checked with hasattr by the simulator):
    #   withdrawals(day) -> list[str]   case ids settled out of court, taken off the docket before planning
    #   on_day_end(day) -> None         end-of-day hook for the world's own history

    def snapshot(self, day: date) -> dict[str, Any]:
        """JSON-serialisable world state at ``day`` for the board view."""
        ...
