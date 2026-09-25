"""The 60-day causelist forecast: fixed bookings first, then a greedy fill by priority, day by day.

Fixed bookings are the published causelists and the next dates the judge has set; they stay even
if that overbooks a day. Every other listing is tentative. On each sitting day the eligible cases
(earliest date reached, not disposed, no judge-fixed date still ahead) are ranked by a transparent
score and placed while the day's expected minutes stay within 420, short procedural matters first
for up to a third of the day. Placing a case books its
follow-up no earlier than day + gap for its purpose. The purpose is held, since the outcome isn't
known ahead, so the draft shows the repeat listings the court will actually carry.
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, timedelta

from .reference import PLAN_MINUTES, SIDE_TYPES, HearingRef, calendar_end, hearing_types, label, sitting_days
from .roster import PCase

HORIZON_DAYS = 60
W_AGE, W_WAIT, W_STUCK = 3, 0.2, 1  # score weights (assumed; shown in every why)
# Up to a third of the day goes first to short procedural matters (≤ 15 min), like a morning board.
# Without it the oldest 30-minute Judgement matters fill whole days; with it a day carries ~30 listings.
SHORT_SHARE, SHORT_MINUTES = 1 / 3, 15


@dataclass(frozen=True)
class Fixed:
    """A booking the forecast keeps: "published" (on a causelist already out) or "judge" (a date set).
    `minutes` is the judge's estimate of the hearing time, when it differs from the table's."""
    case: str
    day: date
    purpose: str
    kind: str
    minutes: int | None = None


@dataclass(frozen=True)
class DeskState:
    """Everything the forecast needs besides the roster. Frozen, so it can key a cache."""
    start: date  # the hearing day: the first day planned
    purposes: tuple[tuple[str, str], ...] = ()  # purpose changes the judge made, case → purpose
    disposed: frozenset[str] = frozenset()
    fixed: tuple[Fixed, ...] = ()

    @property
    def purpose_of(self) -> dict[str, str]:
        return dict(self.purposes)


@dataclass
class Booking:
    day: date
    case: str
    purpose: str
    minutes: int
    expected: float
    score: float
    why: list[str]
    kind: str  # "published", "judge" or "tentative"


@dataclass
class Draft:
    start: date
    end: date  # last day in the horizon
    days: list[date]
    bookings: list[Booking]
    unplaced: list[str]  # active cases with no listing in the horizon
    cut_by_calendar: bool = False
    _by_day: dict[date, list[Booking]] = field(default_factory=dict, repr=False)
    _by_case: dict[str, list[Booking]] = field(default_factory=dict, repr=False)

    def __post_init__(self) -> None:
        for b in self.bookings:
            self._by_day.setdefault(b.day, []).append(b)
            self._by_case.setdefault(b.case, []).append(b)

    def on(self, day: date) -> list[Booking]:
        return self._by_day.get(day, [])

    def of(self, case: str) -> list[Booking]:
        return self._by_case.get(case, [])

    def load(self, day: date, excluding: str | None = None) -> float:
        return sum(b.expected for b in self.on(day) if b.case != excluding)

    def free(self, day: date, excluding: str | None = None) -> float:
        return PLAN_MINUTES - self.load(day, excluding)

    def next_hearing(self, case: str, after: date) -> Booking | None:
        return next((b for b in self.of(case) if b.day > after), None)


def current_stage(case: PCase, state: DeskState) -> str:
    """The roster's stage, moved on by the judge's last mainline purpose (side types leave it)."""
    p = state.purpose_of.get(case.number)
    return p if p and p not in SIDE_TYPES else case.stage


def horizon(start: date, n_days: int = HORIZON_DAYS) -> tuple[list[date], bool]:
    """Sitting days from start for n calendar days, cut at the calendar's end."""
    end = start + timedelta(days=n_days - 1)
    cut = end > calendar_end()
    return [d for d in sitting_days() if start <= d <= end], cut


def score_terms(case: PCase, purpose: str, stage: str, waiting: int, on: date,
                ref: dict[str, HearingRef]) -> list[tuple[float, str]]:
    ht = ref[purpose]
    stuck = stage == case.stage and case.hearings_at_stage > ref[stage].hearings_median
    terms = [
        (W_AGE * case.age_points(on), f"age {case.age_bucket(on)}"),
        (ht.priority, label(purpose)),
        (W_WAIT * waiting, f"waiting {waiting}d"),
        (W_STUCK * stuck, f"{case.hearings_at_stage} hearings at stage (median {ref[stage].hearings_median:g})"),
    ]
    return [(v, t) for v, t in terms if v]


def _why(terms: list[tuple[float, str]]) -> list[str]:
    return [f"+{v:g} {t}" for v, t in sorted(terms, reverse=True)]


def forecast(cases: tuple[PCase, ...], state: DeskState, n_days: int = HORIZON_DAYS,
             ref: dict[str, HearingRef] | None = None) -> Draft:
    ref = ref or hearing_types()
    days, cut = horizon(state.start, n_days)
    by_id = {c.number: c for c in cases}
    purpose = {c.number: c.purpose for c in cases} | state.purpose_of
    stage = {c.number: current_stage(c, state) for c in cases}
    active = [c.number for c in cases if c.number not in state.disposed and not c.awaiting_disposal]

    fixed_on: dict[date, list[Fixed]] = defaultdict(list)
    fixed_days: dict[str, list[date]] = defaultdict(list)
    for f in state.fixed:
        fixed_on[f.day].append(f)
        fixed_days[f.case].append(f.day)
    # Static part of the score (age at the start, purpose, stuck); only the waiting term moves daily.
    static = {cid: sum(v for v, t in score_terms(by_id[cid], purpose[cid], stage[cid], 0, state.start, ref))
              for cid in active}
    earliest = {cid: state.start for cid in active}
    bookings: list[Booking] = []
    booked: set[str] = set()

    def book(cid: str, d: date, p: str, kind: str, waiting: int, note: str = "", minutes: int | None = None) -> float:
        ht = ref[p]
        terms = score_terms(by_id[cid], p, stage[cid], waiting, state.start, ref)
        why = _why(terms) + [note or {"published": "on the published causelist", "judge": "date set by the judge"}
                             .get(kind, ""), f"judge's estimate {minutes} min" if minutes is not None else ""]
        cost = ht.expected_for(minutes)
        bookings.append(Booking(d, cid, p, ht.minutes if minutes is None else minutes, cost,
                                sum(v for v, _ in terms), [w for w in why if w], kind))
        purpose[cid] = p
        earliest[cid] = d + timedelta(days=ht.gap_days)
        booked.add(cid)
        return cost

    for d in days:
        load = 0.0
        for f in fixed_on.get(d, []):
            if f.case in by_id:
                load += book(f.case, d, f.purpose, f.kind, 0, minutes=f.minutes)
        pool = []
        for cid in active:
            e = earliest[cid]
            if e > d or any(fd >= d for fd in fixed_days.get(cid, ())):
                continue
            pool.append((static[cid] + W_WAIT * (d - e).days, cid))
        pool.sort(key=lambda x: (-x[0], x[1]))
        # Pass 1 fills the procedural share with short matters; pass 2 fills the rest by score alone.
        short = 0.0
        for first in (True, False):
            for _, cid in pool:
                ht = ref[purpose[cid]]
                if earliest[cid] > d or (first and ht.minutes > SHORT_MINUTES):
                    continue
                cost = ht.expected_minutes
                if load + cost <= PLAN_MINUTES and (not first or short + cost <= SHORT_SHARE * PLAN_MINUTES):
                    load += book(cid, d, purpose[cid], "tentative", (d - earliest[cid]).days,
                                 "procedural share of the day" if first else "")
                    short += cost if first else 0
                if PLAN_MINUTES - load < 1:
                    break
    # Judge-fixed dates beyond the horizon still belong to the case's record.
    last = days[-1] if days else state.start
    for f in state.fixed:
        if f.day > last and f.case in by_id:
            book(f.case, f.day, f.purpose, f.kind, 0, minutes=f.minutes)
    bookings.sort(key=lambda b: (b.day, -b.score))
    return Draft(state.start, last, days, bookings, [c for c in active if c not in booked], cut)
