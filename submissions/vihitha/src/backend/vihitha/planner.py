"""Planning (spec v3 section 7.2): give every unscheduled pending case a day in the range.

Pure engine code. The API service and the simulator both call `assign_pool`, then
`windows.pack_day` for each day, so the CLI and the API plan the same way.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta

from . import rng
from .enums import GROUP_OF, GROUPS
from .estimates import expected_minutes
from .models import Case
from .next_date import Scheduler
from .priority import score as priority_score
from .priority import value as priority_value


@dataclass
class Assignment:
    case_id: str
    date: date
    expected_minutes: float
    p_substantive: float
    score: float
    reason: str


@dataclass
class Unscheduled:
    case_id: str
    earliest: date
    reason: str


def earliest_for(case: Case, start: date, sched: Scheduler) -> date:
    """max(start, pending_until if prerequisite check, last reached hearing + reference gap)."""
    e = start
    r = sched.rules
    if r.prerequisite_check and case.pending_until and case.pending_until > e:
        e = case.pending_until
    if case.last_reached_on is not None and not r.is_baseline:
        gap_end = case.last_reached_on + timedelta(days=sched.ref.gap(case.next_purpose))
        if gap_end > e:
            e = gap_end
    return e


def commit(sched: Scheduler, case: Case, d: date, minutes: float, on: date, first: bool = False,
           soft: bool = False) -> None:
    sched.book.commit(case.filing_number, d, minutes, case.age_years(d) >= 4, case.advocate_id, soft=soft)
    case.scheduled_date = d
    case.committed_on = on
    if first or case.first_scheduled_date is None:
        case.first_scheduled_date = d


DAY_COST = 10.0  # cost of pushing a waiting case one day later
ADVOCATE_BONUS = 3.0  # prefer a day the advocate is already in court (never worth a day of delay)
PURPOSE_DAY_PENALTY = 100.0  # judge's purpose-of-the-day rule (Dimakar) outweighs up to ~10 days


def first_listing_cost(case: Case, d: date, earliest: date, sched: Scheduler) -> float:
    """Fill-first: a free minute today is lost for good, a free slot later is not.

    Only called for days that still have room, so the earliest such day wins; clustering
    and purpose-of-day rules break ties or override it.
    """
    r = sched.rules
    cost = DAY_COST * (d - earliest).days
    if r.clustering.by_advocate and sched.book.advocates[d].get(case.advocate_id):
        cost -= ADVOCATE_BONUS
    if not sched.purpose_allowed(case, d):
        cost += PURPOSE_DAY_PENALTY
    return cost


def _interleave_groups(ranked: list) -> list:
    """Mixed days: merge the SHORT / TRIAL / FINAL queues so each group gets court time in
    proportion to its share of the waiting minutes (priority order kept inside each group).
    Filling days in this order gives every day the same mix instead of, say, all judgements."""
    queues: dict[str, list] = {g: [] for g in GROUPS}
    for t in ranked:
        queues[GROUP_OF[t[2].next_purpose]].append(t)
    demand = {g: sum(t[4] for t in q) for g, q in queues.items()}
    total = sum(demand.values()) or 1.0
    share = {g: max(demand[g] / total, 1e-6) for g in GROUPS}
    used = {g: 0.0 for g in GROUPS}
    pos = {g: 0 for g in GROUPS}
    out = []
    while len(out) < len(ranked):
        g = min((g for g in GROUPS if pos[g] < len(queues[g])), key=lambda g: (used[g] / share[g], GROUPS.index(g)))
        t = queues[g][pos[g]]
        pos[g] += 1
        used[g] += t[4]
        out.append(t)
    return out


def assign_pool(
    pool: list[Case],
    days: list[date],
    sched: Scheduler,
    today: date,
    seed: int = 0,
    horizon_start: date | None = None,
    soft_from: date | None = None,
    avoid: dict[str, set] | None = None,
) -> tuple[list[Assignment], list[Unscheduled]]:
    """Highest priority first; each case gets the cheapest day (next-date cost function) in `days`.

    Commits into `sched.book` and sets `case.scheduled_date`. Deterministic: ties on case id.
    Baseline: seed-shuffled roster order, earliest day with room (60 a day).
    """
    rules, ref = sched.rules, sched.ref
    horizon_start = horizon_start or today
    days = sorted(days)
    out: list[Assignment] = []
    left: list[Unscheduled] = []
    if not days:
        return out, [Unscheduled(c.filing_number, today, "No sitting day in the planning range") for c in pool]
    first_day, last_day = days[0], days[-1]
    smallest = float(rules.adjourn_call_minutes)

    ranked = []
    for c in pool:
        if c.disposed:
            continue
        e = max(earliest_for(c, first_day, sched), first_day)
        if e > last_day:
            why = (c.pending_reason or "Awaiting prerequisite") if (c.pending_until and c.pending_until > last_day) \
                else "Next hearing falls after the planning range"
            left.append(Unscheduled(c.filing_number, e, f"{why}; eligible from {e.isoformat()}"))
            continue
        minutes, p = expected_minutes(c, c.next_purpose, e, rules, ref)
        if rules.is_baseline:
            key = rng.hash64(seed, "baseline-order", c.filing_number)
            ranked.append((0.0, key, c, e, minutes, p))
        else:
            ranked.append((-priority_value(c, e, p, rules, horizon_start), c.filing_number, c, e, minutes, p))
    ranked.sort(key=lambda t: (t[0], t[1]))
    if rules.mix_by_group and not rules.is_baseline:
        # Oldest first (4+ years, the ageing guardrail), but every tier is a mix of hearing types.
        old = [t for t in ranked if t[2].age_years(t[3]) >= 4]
        young = [t for t in ranked if t[2].age_years(t[3]) < 4]
        ranked = _interleave_groups(old) + _interleave_groups(young)

    full = False
    for n, (_, _, c, e, minutes, p) in enumerate(ranked):
        if not full and n % 25 == 0 and not any(sched.room(d, smallest, True, today) for d in days):
            full = True
        if full:
            left.append(Unscheduled(c.filing_number, e, "No day with room in the planning range"))
            continue
        aged = c.age_years(e) >= 4
        best, best_cost = None, None
        skip = avoid.get(c.filing_number, ()) if avoid else ()
        for d in days:
            if d < e or d in skip:
                continue
            if best_cost is not None and DAY_COST * (d - e).days - ADVOCATE_BONUS > best_cost:
                break  # every later day costs more than the best found
            if not sched.room(d, minutes, aged, today):
                continue
            if rules.is_baseline:
                best = d
                break
            cost = first_listing_cost(c, d, e, sched)
            if best_cost is None or cost < best_cost:
                best, best_cost = d, cost
        if best is None:
            left.append(Unscheduled(c.filing_number, e, "No day with room in the planning range"))
            continue
        m, p2 = expected_minutes(c, c.next_purpose, best, rules, ref)
        pr = priority_score(c, best, p2, rules, horizon_start)
        commit(sched, c, best, m, today, first=True, soft=soft_from is not None and best >= soft_from)
        out.append(Assignment(c.filing_number, best, m, p2, pr.score, pr.reason))
    return out, left


def held_back(cases: list[Case], d: date, sched: Scheduler) -> list[dict]:
    """Pending cases not listed on `d` because a prerequisite (process, report) is not back yet."""
    if not sched.rules.prerequisite_check:
        return []
    out = []
    for c in cases:
        if c.disposed or c.scheduled_date is not None:
            continue
        if c.pending_until and c.pending_until > d:
            out.append({"case_id": c.filing_number, "case_number": c.case_number,
                        "hearing_type": c.next_purpose.value,
                        "reason": c.pending_reason or "Awaiting prerequisite",
                        "eligible_from": c.pending_until})
    out.sort(key=lambda x: (x["eligible_from"], x["case_id"]))
    return out
