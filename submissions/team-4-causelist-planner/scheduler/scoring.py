"""Stage 2: transparent priority score. Every term becomes a line of the why-trail."""
from __future__ import annotations

from datetime import date, timedelta

from .data import HEARING_TYPES
from .models import Case, JudgeConfig

AGE_POINTS = {"<1y": 0, "1-3y": 1, "3-4y": 2, "4-5y": 3, "5y+": 5}


def score(case: Case, day: date, cfg: JudgeConfig) -> tuple[float, list[str]]:
    t = terms(case, day, cfg)
    total = sum(v for v, _ in t)
    return total, [f"+{v:.0f} {label}" for v, label in sorted(t, reverse=True)]


def terms(case: Case, day: date, cfg: JudgeConfig) -> list[tuple[float, str]]:
    """The non-zero (points, label) terms of the score: weight × raw value, per preset weight."""
    w = cfg.weights
    ht = HEARING_TYPES[case.purpose]
    bucket = case.age_bucket(day)
    ideal = (case.last_heard or case.filing_date) + timedelta(days=ht.ideal_gap_days)
    overdue = max(0, (day - ideal).days)
    terms = [
        (w["age"] * AGE_POINTS[bucket], f"age {bucket}"),
        (w["purpose"] * ht.priority, case.purpose.replace("_", " ")),
        (w["overdue"] * overdue, f"overdue {overdue}d"),
        (w["urgent"] * case.urgent, "urgent"),
        (w["adjournments"] * case.adjournment_count, f"{case.adjournment_count} adjournments"),
        (w["fresh"] * case.is_fresh(day), "fresh matter"),
    ]
    return [(v, label) for v, label in terms if v]
