"""Causelist listings as calendar events, one role-agnostic model with a filter per role.

Events mirror `causelist_item` in docs/scheduler-schema.sql. They are read-only copies of the
scheduler's output: the calendar never re-orders, drops or adds listings.
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime
from itertools import combinations

from .court import Courtroom


@dataclass(frozen=True)
class CourtEvent:
    uid: str
    case_id: str
    day: date
    start: datetime
    end: datetime
    window: str
    courtroom: str
    judge: str
    block: str
    purpose: str
    advocates: tuple[str, ...]  # advocate ids
    parties: tuple[str, ...]  # party person keys, petitioner first
    reasons: tuple[str, ...]
    expected_minutes: float
    age_years: float
    advocate_names: tuple[str, ...] = ()
    party_names: tuple[str, ...] = ()
    case_number: str = ""

    @property
    def title(self) -> str:
        return f"{self.case_number or self.case_id} · {self.purpose.replace('_', ' ')}"


def events_for_room(room: Courtroom) -> list[CourtEvent]:
    names = room.store.directory
    numbers = room.store.case_numbers
    out = []
    for plan in room.plans:
        for l in plan.listings:
            c = room.by_id[l.case_id]
            out.append(CourtEvent(
                uid=f"{l.case_id}@{l.day.isoformat()}", case_id=l.case_id, day=l.day,
                start=l.window_start, end=l.window_end, window=l.window,
                courtroom=room.name, judge=room.judge, block=l.block, purpose=l.purpose,
                advocates=tuple(c.advocate_ids), parties=tuple(c.parties), reasons=tuple(l.reasons),
                expected_minutes=l.expected_minutes, age_years=l.age_years,
                advocate_names=tuple(names.advocate(a) for a in c.advocate_ids),
                party_names=tuple(names.person(p) for p in c.parties), case_number=numbers.get(c.id, ""),
            ))
    return out


def events_for_court(rooms: list[Courtroom]) -> list[CourtEvent]:
    return sorted((e for r in rooms for e in events_for_room(r)), key=lambda e: (e.day, e.start, e.courtroom))


def for_courtroom(events: list[CourtEvent], courtroom: str) -> list[CourtEvent]:
    return [e for e in events if e.courtroom == courtroom]


def for_advocate(events: list[CourtEvent], advocate: str) -> list[CourtEvent]:
    return [e for e in events if advocate in e.advocates]


def for_party(events: list[CourtEvent], party: str) -> list[CourtEvent]:
    return [e for e in events if party in e.parties]


def on_day(events: list[CourtEvent], day: date) -> list[CourtEvent]:
    return [e for e in events if e.day == day]


@dataclass(frozen=True)
class Clash:
    advocate: str
    a: CourtEvent
    b: CourtEvent


def clashes(events: list[CourtEvent], advocate: str | None = None) -> list[Clash]:
    """An advocate listed in overlapping windows in different courtrooms on the same day."""
    by_key: dict[tuple[str, date], list[CourtEvent]] = defaultdict(list)
    for e in events:
        for a in e.advocates:
            if advocate is None or a == advocate:
                by_key[(a, e.day)].append(e)
    out = []
    for (adv, _), evs in sorted(by_key.items(), key=lambda kv: (kv[0][1], kv[0][0])):
        for x, y in combinations(sorted(evs, key=lambda e: (e.start, e.courtroom)), 2):
            if x.courtroom != y.courtroom and x.start < y.end and y.start < x.end:
                out.append(Clash(adv, x, y))
    return out
