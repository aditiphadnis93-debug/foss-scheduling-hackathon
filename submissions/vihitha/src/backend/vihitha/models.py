"""Engine dataclasses. Pure data: no I/O, no database."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date

from .enums import HearingType, ReasonGroup, age_bucket


@dataclass(frozen=True)
class Attendance:
    complainant: bool | None = None
    complainant_advocate: bool | None = None
    accused: bool | None = None
    accused_advocate: bool | None = None


@dataclass(frozen=True)
class ParsedSummary:
    attendance: Attendance
    pending_process: bool
    mediation: bool
    last_chance: bool
    ok: bool = True


@dataclass(frozen=True)
class RosterCase:
    """One roster row, normalised."""
    case_number: str
    filing_number: str
    filing_date: date
    advocate_id: str
    party_id: str
    stage: HearingType
    next_purpose: HearingType
    hearing_counts: dict[HearingType, int]
    total_hearings: int
    last_hearing_summary: str
    parsed: ParsedSummary
    order: int


@dataclass
class Case:
    """Mutable case state shared by the planner, the day runner and the simulator."""
    filing_number: str
    case_number: str
    advocate_id: str
    party_id: str
    filing_date: date
    stage: HearingType
    next_purpose: HearingType
    hearing_counts: dict[HearingType, int]
    order: int = 0
    consecutive_non_substantive: int = 0
    consecutive_absence: int = 0
    hearings_at_stage: int = 0
    stage_entered_on: date | None = None
    pending_until: date | None = None
    pending_reason: str | None = None
    last_chance: bool = False
    accused_seen: bool = False
    disposed_on: date | None = None
    disposal_type: str | None = None
    scheduled_date: date | None = None
    committed_on: date | None = None
    first_scheduled_date: date | None = None
    not_reached_count: int = 0
    carried_forward: bool = False
    priority_boost: float = 0.0
    last_listed_on: date | None = None
    last_reached_on: date | None = None
    posterior_show: tuple[float, float] = (1.0, 1.0)
    reason_history: list[ReasonGroup] = field(default_factory=list)
    listed_count: int = 0
    reached_count: int = 0

    @property
    def disposed(self) -> bool:
        return self.disposed_on is not None

    def age_years(self, on: date) -> float:
        return (on - self.filing_date).days / 365.25

    def age_bucket(self, on: date) -> str:
        return age_bucket(self.age_years(on))

    @property
    def total_hearings(self) -> int:
        return sum(self.hearing_counts.values())


@dataclass
class Outcome:
    reached: bool
    substantive: bool = False
    reason_group: ReasonGroup | None = None
    reason_label: str | None = None
    actual_start: int | None = None  # judicial minutes since day start (lunch excluded)
    duration: int = 0
    settled: bool = False
    shown: bool | None = None


@dataclass
class Placement:
    """Where one hearing sits in a packed day (section 3)."""
    key: str  # caller's id (case id in the simulator, hearing id in the service)
    block_id: str
    window_start: str
    window_end: str
    est_start: str
    est_end: str
    seq: int
    expected_minutes: float
    duration_min: float
    p_substantive: float


@dataclass
class WindowPlan:
    start: str
    end: str
    block_id: str
    keys: list[str]
    expected_minutes: float
    capacity_minutes: float


@dataclass
class PackedDay:
    date: date
    placements: dict[str, Placement]
    windows: list[WindowPlan]

    def ordered(self) -> list[Placement]:
        return sorted(self.placements.values(), key=lambda p: p.seq)


@dataclass
class HearingRecord:
    """One listing plus what happened: the unit the metrics and KPIs read."""
    date: date
    case_id: str
    case_number: str
    advocate_id: str
    party_id: str
    purpose: HearingType
    age_years: float
    block_id: str
    window_start: str
    window_end: str
    est_start: str
    est_end: str
    expected_minutes: float
    p_substantive: float
    reason: str
    carried_forward: bool
    first_promised_date: date | None
    outcome: Outcome
    next_date: date | None = None
    next_date_reason: str | None = None
    next_date_gap_ok: bool | None = None

    @property
    def result(self) -> str:
        o = self.outcome
        if not o.reached:
            return "NOT_REACHED"
        if o.substantive or o.settled:
            return "DISPOSED" if (o.settled or self.purpose == HearingType.JUDGEMENT) else "MOVED_FORWARD"
        return "ADJOURNED"


@dataclass
class DayRecord:
    date: date
    packed: PackedDay
    records: list[HearingRecord]
    minutes_used: int
    held_back: list[dict] = field(default_factory=list)
    pending_by_bucket: dict[str, int] = field(default_factory=dict)
