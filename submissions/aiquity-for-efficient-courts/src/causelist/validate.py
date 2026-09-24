"""Independent checks on a produced schedule. Used by tests and by the CLI.

Every rule here is re-derived from the plan itself, not trusted from the planner.
"""
from __future__ import annotations

from .config import OLD_CASE_YEARS, effective_ageing_share
from .planning import default_slots
from .simulate import SimResult

# The planner books expected minutes up to capacity plus a risk buffer (a few standard deviations
# of the day's uncertain minutes) so that no-shows do not leave the judge idle. Anything beyond
# this share over capacity is treated as overbooking.
MAX_RISK_BUFFER = 0.25


def check(res: SimResult, tolerance_min: float = 1.0) -> list[str]:
    problems: list[str] = []
    cfg = res.config
    slots = {s.name: s for s in default_slots(cfg)}
    h, m = map(int, cfg.day_start.split(":"))
    court_start = h * 60 + m
    first_case = {c.case_id: c for c in res.initial}
    first_case.update({c.case_id: c for c in res.cases})
    budget = cfg.day_minutes * cfg.fill_target * cfg.overbook * (1 + MAX_RISK_BUFFER)
    for d in res.days:
        ids = [l.case_id for l in d.plan.listings]
        if len(ids) != len(set(ids)):
            problems.append(f"{d.day}: a case is listed twice")
        if len(ids) > cfg.max_listed:
            problems.append(f"{d.day}: {len(ids)} listed > max {cfg.max_listed}")
        exp = sum(l.expected_minutes for l in d.plan.listings)
        if cfg.planner != "baseline" and exp > budget + tolerance_min:
            problems.append(f"{d.day}: expected minutes {exp:.0f} exceed budget {budget:.0f}")
        for l in d.plan.listings:
            if cfg.planner == "baseline":
                break                  # today's practice: one undifferentiated list for the whole day
            s = slots.get(l.slot)
            if s is None:
                problems.append(f"{d.day}: {l.case_id} in unknown slot {l.slot}")
                continue
            a, b = s.minutes()
            if cfg.give_appointments and not (a - court_start <= l.start_min < l.end_min <= b - court_start):
                problems.append(f"{d.day}: {l.case_id} window {l.start_min}-{l.end_min} outside slot {l.slot}")
            if s.purposes and l.purpose not in s.purposes:
                problems.append(f"{d.day}: {l.case_id} purpose {l.purpose} not allowed in slot {l.slot}")
        if cfg.planner != "baseline" and exp > 0:
            old_min = sum(l.expected_minutes for l in d.plan.listings
                          if l.case_id in first_case and first_case[l.case_id].age_years(d.day) >= OLD_CASE_YEARS)
            held_old = any(cid in first_case and first_case[cid].age_years(d.day) >= OLD_CASE_YEARS
                           and why == "capacity" for cid, why in d.plan.held_back)
            alpha = effective_ageing_share(cfg, 0.0)
            if held_old and old_min + tolerance_min < alpha * exp * 0.98:
                problems.append(f"{d.day}: old-case share {old_min / exp:.0%} below floor {alpha:.0%} while old cases waited")
    return problems
