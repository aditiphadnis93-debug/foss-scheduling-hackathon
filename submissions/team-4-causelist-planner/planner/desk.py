"""Decision support for the hearing day: where can this case go next, and what does each choice cost?

- earliest: the first sitting day on or after the hearing day + the purpose's gap.
- nearest fit: the first sitting day from the earliest that has room without moving anyone.
- impact: re-run the forecast with the case fixed on a date and compare every other case's listings
  with the current draft, at the first one that differs: who moves later (and by how much), who
  moves earlier.
- best fit: the least-cost candidate date. Cost = Σ (1 + age points) × days late, for the case
  itself (days past its earliest) and for every case the choice pushes later.
"""
from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import date, timedelta

from .forecast import DeskState, Draft, Fixed, forecast
from .reference import DISPOSED, NEXT_STAGE, SIDE_TYPES, hearing_types, sitting_days
from .roster import PCase

BEYOND = "beyond horizon"


def earliest_date(day: date, purpose: str) -> date | None:
    target = day + timedelta(days=hearing_types()[purpose].gap_days)
    return next((d for d in sitting_days() if d >= target), None)


def nearest_fit(draft: Draft, case: str, purpose: str, earliest: date, minutes: int | None = None) -> date | None:
    """First day from the earliest with room for the case, not counting its own current bookings."""
    cost = hearing_types()[purpose].expected_for(minutes)
    return next((d for d in draft.days if d >= earliest and draft.free(d, excluding=case) >= cost), None)


def with_date(state: DeskState, case: str, purpose: str, day: date | None, disposed: bool = False,
              minutes: int | None = None) -> DeskState:
    """The state after the judge's decision: the case's judge-fixed date (if any) replaced."""
    fixed = tuple(f for f in state.fixed if not (f.case == case and f.kind == "judge"))
    if day is not None and not disposed:
        fixed += (Fixed(case, day, purpose, "judge", minutes),)
    purposes = tuple((c, p) for c, p in state.purposes if c != case) + (() if disposed else ((case, purpose),))
    gone = state.disposed | {case} if disposed else state.disposed - {case}
    return replace(state, fixed=fixed, purposes=purposes, disposed=gone)


@dataclass
class Moved:
    case: str
    purpose: str
    age_years: float
    old: date | None
    new: date | None
    delay: int  # days; positive = later
    kind: str  # the old booking's kind


@dataclass
class Impact:
    day: date
    fits: bool
    free_before: float  # expected minutes free on the day, without this case
    free_after: float
    later: list[Moved]
    earlier: list[Moved]
    own_delay: int  # days past the earliest date
    cost: float

    @property
    def old_delayed(self) -> int:
        return sum(1 for m in self.later if m.age_years >= 4)


def _weight(c: PCase, on: date) -> int:
    return 1 + c.age_points(on)


def impact(cases: tuple[PCase, ...], state: DeskState, base: Draft, case: str, purpose: str, day: date,
           earliest: date, minutes: int | None = None) -> Impact:
    by_id = {c.number: c for c in cases}
    cost = hearing_types()[purpose].expected_for(minutes)
    free = base.free(day, excluding=case)
    new = forecast(cases, with_date(state, case, purpose, day, minutes=minutes))
    edge = base.end + timedelta(days=1)  # "beyond horizon" counts as the day after it, a lower bound
    later, earlier = [], []
    for cid in by_id:
        if cid == case:
            continue
        # The first listing that differs: a displaced repeat hearing counts as much as a next hearing.
        olds, news = base.of(cid), new.of(cid)
        i = next((i for i, (x, y) in enumerate(zip(olds, news)) if x.day != y.day), min(len(olds), len(news)))
        a, b = (olds[i] if i < len(olds) else None), (news[i] if i < len(news) else None)
        da, db = (a.day if a else None), (b.day if b else None)
        if da == db:
            continue
        m = Moved(cid, (b or a).purpose, round(by_id[cid].age_years(state.start), 1), da, db,
                  ((db or edge) - (da or edge)).days, a.kind if a else "")
        (later if m.delay > 0 else earlier).append(m)
    own = max(0, (day - earliest).days)
    total = _weight(by_id[case], state.start) * own + sum(_weight(by_id[m.case], state.start) * m.delay for m in later)
    later.sort(key=lambda m: -m.delay)
    return Impact(day, free >= cost, free, free - cost, later, earlier, own, total)


def candidates(draft: Draft, purpose: str, earliest: date, limit: int = 12) -> list[date]:
    span = max(2 * hearing_types()[purpose].gap_days, 14)
    last = earliest + timedelta(days=span - 1)
    return [d for d in draft.days if earliest <= d <= last][:limit]


def best_fit(cases: tuple[PCase, ...], state: DeskState, base: Draft, case: str, purpose: str,
             earliest: date, minutes: int | None = None) -> tuple[Impact | None, list[Impact]]:
    rows = [impact(cases, state, base, case, purpose, d, earliest, minutes)
            for d in candidates(base, purpose, earliest)]
    best = min(rows, key=lambda i: (i.cost, i.day)) if rows else None
    return best, rows


OUTCOMES = ("Heard, moved on", "Heard, same stage", "Adjourned", "Not reached", "Disposed")


def default_next_purpose(stage: str, current: str, outcome: str) -> str:
    """The purpose to suggest for an outcome. Moving on follows the lifecycle; a side type returns
    to the case's stage; anything else keeps the purpose."""
    if outcome == "Disposed":
        return DISPOSED
    if outcome != "Heard, moved on":
        return current
    if current in SIDE_TYPES:
        return stage
    return NEXT_STAGE.get(current, current)
