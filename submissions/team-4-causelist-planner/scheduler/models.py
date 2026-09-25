"""Core data types shared by every pipeline stage."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, time

AGE_BUCKETS = ["<1y", "1-3y", "3-4y", "4-5y", "5y+"]


@dataclass(frozen=True)
class HearingType:
    purpose: str
    priority: int
    est_minutes: int
    p_heard: float
    p_effective: float
    ideal_gap_days: int
    min_gap_days: int


@dataclass
class Case:
    id: str
    filing_date: date
    case_type: str
    purpose: str  # purpose of the next hearing
    advocate_ids: list[str]
    last_heard: date | None = None
    adjournment_count: int = 0
    consecutive_skips: int = 0
    prerequisites_met: bool = True
    urgent: bool = False
    on_hold: bool = False
    next_date: date | None = None  # set by stage 6: the case is booked for this day
    next_block: str | None = None
    disposed: bool = False
    parties: list[str] = field(default_factory=list)  # party IDs, petitioner first (synthetic until datasets)

    def age_years(self, on: date) -> float:
        return (on - self.filing_date).days / 365.25

    def age_bucket(self, on: date) -> str:
        a = self.age_years(on)
        if a < 1:
            return "<1y"
        if a < 3:
            return "1-3y"
        if a < 4:
            return "3-4y"
        if a < 5:
            return "4-5y"
        return "5y+"

    def is_fresh(self, on: date) -> bool:
        return (on - self.filing_date).days <= 90


@dataclass(frozen=True)
class Block:
    name: str
    start: time
    end: time
    purposes: tuple[str, ...]
    weekdays: tuple[int, ...] = (0, 1, 2, 3, 4)  # Mon=0
    sort_by: str = "score"  # "score", "age" (oldest first) or "newest"

    @property
    def minutes(self) -> int:
        return (self.end.hour * 60 + self.end.minute) - (self.start.hour * 60 + self.start.minute)


@dataclass
class JudgeConfig:
    name: str
    blocks: list[Block]
    max_cases_per_day: int = 60
    listing_factor: float = 1.0
    clustering: bool = False
    rollover: bool = False
    case_types: tuple[str, ...] | None = None
    weights: dict[str, float] = field(default_factory=dict)
    leave: tuple[date, ...] = ()
    courtroom: str = "Court 1"
    cover_page_for: tuple[str, ...] = ()  # purposes that need a case summary / cover page first (Dimakar)
    style: str = ""  # the judge's way of working in their own words; read by the L3 judge agent, never by the rules
    clamped: list[str] = field(default_factory=list)  # locked-rule corrections applied on load

    def blocks_on(self, day: date) -> list[Block]:
        return [b for b in self.blocks if day.weekday() in b.weekdays]


@dataclass
class Listing:
    case_id: str
    day: date
    block: str
    purpose: str
    advocate: str
    age_years: float
    score: float
    expected_minutes: float
    reasons: list[str]
    window: str = ""
    window_start: datetime | None = None
    window_end: datetime | None = None
    window_why: str = ""  # how stage 5 set the window (lineage)
