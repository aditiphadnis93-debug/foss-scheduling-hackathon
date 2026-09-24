"""Assemble engine inputs from the organisers' files (shared by the CLI and the API)."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from pathlib import Path

from . import loaders, roster
from .calendar import CourtCalendar
from .models import RosterCase
from .reference import Reference, load_reference

DEFAULT_START = date(2026, 9, 24)
DEFAULT_END = date(2026, 12, 31)


@dataclass
class Inputs:
    roster: list[RosterCase]
    calendar: CourtCalendar
    ref: Reference


def parse_leave(value: str | None) -> dict[date, str]:
    if not value:
        return {}
    return {date.fromisoformat(s.strip()): "Judge's leave" for s in value.split(",") if s.strip()}


def load_inputs(roster_path: str | Path | None = None, data_dir: str | Path | None = None,
                leave: dict[date, str] | None = None) -> Inputs:
    df = loaders.read_roster(roster_path) if roster_path else loaders.load_sample_roster(data_dir)
    return Inputs(
        roster=roster.normalise(df),
        calendar=CourtCalendar.from_frame(loaders.load_calendar(data_dir), leave),
        ref=load_reference(data_dir),
    )
