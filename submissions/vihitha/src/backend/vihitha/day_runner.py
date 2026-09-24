"""Running one sitting day (v2 section 6.10), shared by the simulator and the demo auto-run.

`walk` samples outcomes in time order against the 420-minute clock.
`apply_outcome` updates the case (lifecycle, learning, counters) after one hearing.
`carry_forward` picks the date for a not-reached case.
"""
from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from datetime import date, timedelta

from . import lifecycle, outcomes
from .agents import ListingContext
from .calendar import fmt_day
from .enums import PART_HEARD_LABEL, HearingType, ReasonGroup
from .estimates import expected_minutes
from .models import Case, Outcome
from .next_date import Scheduler, Suggestion
from .windows import to_elapsed


@dataclass
class WalkItem:
    case: Case
    purpose: HearingType
    block_id: str
    est_start: str  # HH:MM
    est_end: str


def walk(items: list[WalkItem], d: date, sched: Scheduler, seed: int, start_clock: int = 0) -> list[Outcome]:
    """Sample every hearing in order. Items that start after closing time are not reached."""
    rules, ref = sched.rules, sched.ref
    capacity = rules.capacity_minutes
    in_block = Counter((x.case.advocate_id, x.block_id) for x in items)
    clock = start_clock
    out: list[Outcome] = []
    for x in items:
        c = x.case
        if clock + 1 > capacity:
            out.append(Outcome(reached=False))
            continue
        ctx = ListingContext(
            slot_given=rules.slots,
            notice_days=(d - c.committed_on).days if c.committed_on else 0,
            last_chance=c.last_chance,
            not_reached_count=c.not_reached_count,
            advocate_matters_in_block=in_block[(c.advocate_id, x.block_id)],
        )
        o = outcomes.sample(c, x.purpose, d, seed, rules, ref, ctx)
        remaining = capacity - clock
        if o.substantive and o.duration > remaining:
            o = Outcome(reached=True, substantive=False, reason_group=ReasonGroup.COURT,
                        reason_label=PART_HEARD_LABEL, duration=remaining, shown=True)
        o.duration = min(o.duration, remaining)
        o.settled = outcomes.settles(c, x.purpose, d, seed, rules)
        o.actual_start = clock
        clock += o.duration
        out.append(o)
    return out


def apply_outcome(case: Case, purpose: HearingType, o: Outcome, d: date, sched: Scheduler) -> None:
    """Case bookkeeping after one listing (reached or not)."""
    rules = sched.rules
    case.listed_count += 1
    case.last_listed_on = d
    case.scheduled_date = None
    if not o.reached:
        case.not_reached_count += 1
        case.carried_forward = True
        return
    case.reached_count += 1
    case.last_reached_on = d
    case.not_reached_count = 0
    case.carried_forward = False
    case.priority_boost = 0.0
    if rules.learning and o.shown is not None:
        a, b = case.posterior_show
        case.posterior_show = (a + 1, b) if o.shown else (a, b + 1)
    lifecycle.apply(case, purpose, o, d, sched.ref)
    case.first_scheduled_date = None


class _FirmOnly:
    """Court orders (next dates, carry-forwards) only see firm listings: the planner's soft
    tentative placements give way and are re-planned around them."""
    def __init__(self, sched: Scheduler):
        self.sched, self.prev = sched, sched.firm_only

    def __enter__(self):
        self.sched.firm_only = True

    def __exit__(self, *exc):
        self.sched.firm_only = self.prev


def next_date(case: Case, d: date, sched: Scheduler) -> Suggestion:
    """Next-date suggestion after a reached hearing on `d`."""
    rules, ref = sched.rules, sched.ref
    gap = 0 if rules.next_date_mode == "FLAT_60" else ref.gap(case.next_purpose)
    minutes, _ = expected_minutes(case, case.next_purpose, d + timedelta(days=max(gap, 1)), rules, ref)
    with _FirmOnly(sched):
        return sched.suggest(case, d, minutes, today=d)


def carry_forward(case: Case, d: date, sched: Scheduler) -> tuple[date, str, float]:
    """Date for a not-reached case: Sehgal same weekday next week, baseline +60, others earliest with room."""
    with _FirmOnly(sched):
        return _carry_forward(case, d, sched)


def _carry_forward(case: Case, d: date, sched: Scheduler) -> tuple[date, str, float]:
    rules, ref = sched.rules, sched.ref
    minutes, _ = expected_minutes(case, case.next_purpose, d + timedelta(days=1), rules, ref)
    if rules.is_baseline:
        s = sched.suggest(case, d, minutes, today=d)
        return s.date, "Not reached. " + s.reason, minutes
    if rules.carry_forward_same_weekday:
        nd = sched.calendar.next_working_day(d + timedelta(days=7))
        return nd, f"Not reached. Carried forward to the same weekday next week ({fmt_day(nd)})", minutes
    case.priority_boost = rules.carry_forward_boost
    s = sched.suggest(case, d + timedelta(days=1), minutes, today=d, target_gap=0,
                      label=f"Not reached on {fmt_day(d)}; earliest day with room")
    return s.date, s.reason, minutes


def gap_ok(case: Case, d: date, nd: date, sched: Scheduler) -> bool:
    """Next-date sanity: within [ref gap, 2 x ref gap], or the prerequisite date forced it."""
    g = sched.ref.gap(case.next_purpose)
    gap = (nd - d).days
    if g <= gap <= 2 * g:
        return True
    if case.pending_until and nd == sched.calendar.next_working_day(case.pending_until):
        return True
    return False


def elapsed(hhmm: str, sched: Scheduler) -> int:
    return to_elapsed(hhmm, sched.rules.day)
