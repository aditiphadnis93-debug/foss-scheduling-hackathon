"""Stage 1: hard filters. Returns (eligible, reason-if-excluded)."""
from __future__ import annotations

from datetime import date

from .data import HEARING_TYPES, is_sitting_day
from .models import Case, JudgeConfig


def check(case: Case, day: date, cfg: JudgeConfig) -> tuple[bool, str | None]:
    if case.disposed:
        return False, "Disposed"
    if not is_sitting_day(day, cfg.leave):
        return False, "Court not sitting"
    if cfg.case_types and case.case_type not in cfg.case_types:
        return False, "Not this bench's case type"
    if case.on_hold:
        return False, "Stayed or on hold"
    if not case.prerequisites_met:
        return False, "Prerequisite pending (e.g. warrant not served)"
    if case.next_date is not None and case.next_date != day:
        return False, "Already booked for another date"
    ht = HEARING_TYPES[case.purpose]
    if case.last_heard and (day - case.last_heard).days < ht.min_gap_days:
        return False, "Too soon after the last hearing"
    return True, None


def gates(case: Case, day: date, cfg: JudgeConfig) -> list[tuple[str, bool, str]]:
    """Every filter `check` applies, in the same order, as (gate, passed, detail) — for the lineage view."""
    ht = HEARING_TYPES[case.purpose]
    since = (day - case.last_heard).days if case.last_heard else None
    return [
        ("Not disposed", not case.disposed, "pending"),
        ("Court sitting", is_sitting_day(day, cfg.leave), "sitting day" if is_sitting_day(day, cfg.leave)
         else "holiday, weekend or the judge's leave"),
        ("Bench's case type", not cfg.case_types or case.case_type in cfg.case_types,
         f"{case.case_type}" + (f" (bench hears {', '.join(cfg.case_types)})" if cfg.case_types else " (bench hears all)")),
        ("Not stayed or on hold", not case.on_hold, "on hold" if case.on_hold else "active"),
        ("Prerequisites met", case.prerequisites_met,
         "none pending" if case.prerequisites_met else "a task blocks this hearing (e.g. warrant not served)"),
        ("Not booked for another date", case.next_date is None or case.next_date == day,
         "booked for today" if case.next_date == day else
         "no date fixed" if case.next_date is None else f"booked for {case.next_date:%d %b}"),
        ("Minimum gap since last hearing", not (since is not None and since < ht.min_gap_days),
         f"last heard {since} days ago, minimum {ht.min_gap_days} for {case.purpose.replace('_', ' ')}"
         if since is not None else "never heard"),
    ]
