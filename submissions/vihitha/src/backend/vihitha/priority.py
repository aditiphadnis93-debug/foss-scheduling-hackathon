"""Priority score and its one-line reason (section 6.4)."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from .enums import STAGE_INDEX, HearingType
from .models import Case
from .rules import Rules

_COGNIZANCE_IDX = STAGE_INDEX[HearingType.COGNIZANCE]


@dataclass(frozen=True)
class Priority:
    score: float
    reason: str
    escalated: bool


def escalated(case: Case, d: date, rules: Rules, horizon_start: date) -> bool:
    """A 4+ year case close to its maximum wait (guardrail escalation)."""
    if case.age_years(d) < 4:
        return False
    since = (d - (case.last_listed_on or horizon_start)).days
    return since >= rules.max_wait_days_4y - 5


def value(case: Case, d: date, p_sub: float, rules: Rules, horizon_start: date) -> float:
    """The numeric score only (no reason text); used to rank large pools."""
    w = rules.priority_weights
    age = (d - case.filing_date).days / 365.25
    stage_idx = STAGE_INDEX[case.stage]
    waited = max((d - (case.last_reached_on or horizon_start)).days, 0)
    total = (w.age * min(age / 8.0, 1.0)
             + w.p_substantive * p_sub
             + w.waiting * min(waited / 60.0 + 0.2 * case.not_reached_count, 1.0)
             + w.near_disposal * stage_idx / 10.0
             + (w.fresh if (stage_idx <= _COGNIZANCE_IDX or case.total_hearings <= 2) else 0.0)
             + case.priority_boost)
    if age >= 4 and (d - (case.last_listed_on or horizon_start)).days >= rules.max_wait_days_4y - 5:
        total += 1.0
    return total


def score(case: Case, d: date, p_sub: float, rules: Rules, horizon_start: date) -> Priority:
    w = rules.priority_weights
    age = case.age_years(d)
    stage_idx = STAGE_INDEX[case.stage]
    waited = (d - (case.last_reached_on or horizon_start)).days
    comps = {
        "age": min(age / 8.0, 1.0),
        "p_substantive": p_sub,
        "waiting": min(max(waited, 0) / 60.0 + 0.2 * case.not_reached_count, 1.0),
        "near_disposal": stage_idx / 10.0,
        "fresh": 1.0 if (case.total_hearings <= 2 or stage_idx <= _COGNIZANCE_IDX) else 0.0,
    }
    weighted = {k: getattr(w, k) * v for k, v in comps.items()}
    total = sum(weighted.values()) + case.priority_boost
    esc = escalated(case, d, rules, horizon_start)
    if esc:
        total += 1.0

    words = {
        "age": f"{age:.1f} years old",
        "p_substantive": f"{case.next_purpose.label.lower()} likely to proceed ({p_sub:.0%})",
        "waiting": (f"not reached {case.not_reached_count}x before" if case.not_reached_count
                    else f"waiting {max(waited, 0)} days"),
        "near_disposal": f"close to disposal ({case.stage.label.lower()} stage)",
        "fresh": "new matter",
    }
    top = [k for k, v in sorted(weighted.items(), key=lambda kv: -kv[1]) if v > 0][:2]
    parts = [words[k] for k in top]
    if case.carried_forward:
        parts.insert(0, "carried forward")
    if esc:
        parts.insert(0, f"4+ year case due within {rules.max_wait_days_4y} days")
    reason = ", ".join(parts[:3]) if parts else "listed in roster order"
    return Priority(round(total, 4), reason[:1].upper() + reason[1:], esc)
