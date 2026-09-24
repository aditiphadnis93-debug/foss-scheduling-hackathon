"""Shared service plumbing: reference data, calendar, settings, active rules, engine views.

No FastAPI imports here (layering rule).
"""
from __future__ import annotations

import json
import threading
from dataclasses import dataclass
from datetime import date, timedelta
from functools import lru_cache

from sqlalchemy.orm import Session

from vihitha import loaders
from vihitha.calendar import CourtCalendar
from vihitha.models import Case
from vihitha.next_date import LoadBook, Scheduler
from vihitha.reference import Reference, load_reference
from vihitha.rules import Rules, resolve, rules_from_dict
from vihitha.state import case_from_row

from .. import config
from ..errors import Conflict, NotFound
from ..repositories import cases as cases_repo
from ..repositories import hearings as hearings_repo
from ..repositories import leave as leave_repo
from ..repositories import rulesets as rulesets_repo
from ..repositories import settings as settings_repo

LOCK = threading.RLock()  # serialises writes (SQLite, one court)
_version = [0]


def bump() -> None:
    """Invalidate caches that depend on the stored schedule."""
    _version[0] += 1


def version() -> int:
    return _version[0]


@lru_cache(maxsize=1)
def reference() -> Reference:
    return load_reference(config.DATA_DIR)


@lru_cache(maxsize=1)
def _calendar_frame():
    return loaders.load_calendar(config.DATA_DIR)


def calendar(s: Session) -> CourtCalendar:
    return CourtCalendar.from_frame(_calendar_frame(), leave_repo.all_(s))


# ------------------------------------------------------------ settings

def today(s: Session) -> date:
    v = settings_repo.get(s, "today")
    return date.fromisoformat(v) if v else config.DEMO_TODAY


def horizon_working_days(s: Session) -> int:
    return int(settings_repo.get(s, "horizon_working_days", config.DEFAULT_HORIZON_WORKING_DAYS))


def window_minutes(s: Session) -> int:
    return int(settings_repo.get(s, "window_minutes", config.DEFAULT_WINDOW_MINUTES))


def seed(s: Session) -> int:
    return int(settings_repo.get(s, "seed", config.SEED))


def roster_loaded(s: Session) -> bool:
    return cases_repo.count(s) > 0


def require_roster(s: Session) -> None:
    if not roster_loaded(s):
        raise Conflict("No roster loaded. Load one in Settings first.")


def sitting_days(cal: CourtCalendar, start: date, end: date) -> list[date]:
    return cal.working_days(start, end)


def horizon(s: Session, cal: CourtCalendar | None = None) -> tuple[date, date]:
    """(today, last day of the planning horizon): the next N sitting days from today."""
    cal = cal or calendar(s)
    t = today(s)
    n = horizon_working_days(s)
    d, count, last = t, 0, t
    while count < n:
        d = cal.next_working_day(d)
        last = d
        count += 1
        d += timedelta(days=1)
    return t, last


# ------------------------------------------------------------ rules

def rules_of(row) -> tuple[Rules, list[dict]]:
    return resolve(rules=rules_from_dict(json.loads(row.body_json)))


def active_rules(s: Session) -> tuple[Rules, object]:
    row = rulesets_repo.active(s)
    if row is None:
        r, _ = resolve(preset_name="optimal")
        return r, None
    r, _ = rules_of(row)
    return r, row


def get_ruleset(s: Session, rid: int):
    row = rulesets_repo.get(s, rid)
    if row is None:
        raise NotFound(f"Ruleset {rid} not found")
    return row


# ------------------------------------------------------------ engine view of the stored schedule

@dataclass
class EngineView:
    cases: dict[str, Case]
    sched: Scheduler
    today: date
    active_by_case: dict[str, object]  # case id -> its future DRAFT/PUBLISHED hearing row


def engine_view(s: Session, rules: Rules | None = None, cal: CourtCalendar | None = None,
                exclude_hearing_ids: set[int] | None = None) -> EngineView:
    """Pending cases as engine objects + a load book of every future active hearing."""
    rules = rules or active_rules(s)[0]
    cal = cal or calendar(s)
    t = today(s)
    cases = {r.id: case_from_row(r) for r in cases_repo.all_(s)}
    book = LoadBook()
    active: dict[str, object] = {}
    exclude = exclude_hearing_ids or set()
    for h in hearings_repo.all_active(s):
        if h.id in exclude:
            continue
        c = cases.get(h.case_id)
        if c is None or c.disposed:
            continue
        soft = h.origin == "PLANNER" and not h.pinned and h.status == "DRAFT"
        book.commit(c.filing_number, h.date, h.expected_minutes or 0.0, c.age_years(h.date) >= 4, c.advocate_id,
                    soft=soft)
        c.scheduled_date = h.date
        c.first_scheduled_date = h.first_promised_date
        c.carried_forward = bool(h.carried_forward) or c.carried_forward
        active[c.filing_number] = h
    sched = Scheduler(calendar=cal, rules=rules, ref=reference(), book=book, horizon_start=t)
    return EngineView(cases=cases, sched=sched, today=t, active_by_case=active)
