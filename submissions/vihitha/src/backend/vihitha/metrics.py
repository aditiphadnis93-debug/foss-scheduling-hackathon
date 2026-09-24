"""The six official scoring metrics (v2 section 7). Percentages are fractions in [0, 1] here."""
from __future__ import annotations

from collections import Counter, defaultdict
from statistics import mean

from .enums import ReasonGroup
from .models import HearingRecord

HEADLINE = ["utilisation", "reach_rate", "substantiveness", "backlog_age_impact",
            "predictability_days", "next_date_sanity"]
LOWER_IS_BETTER = {"predictability_days"}
PERCENT = {"utilisation", "reach_rate", "substantiveness", "backlog_age_impact", "next_date_sanity"}
LABELS = {
    "utilisation": "Utilisation",
    "reach_rate": "Reach rate",
    "substantiveness": "Substantiveness",
    "backlog_age_impact": "Backlog-age impact (4+ yrs)",
    "predictability_days": "Predictability (days)",
    "next_date_sanity": "Next-date sanity",
}
TOOLTIPS = {
    "utilisation": "Share of the 420 minutes spent on hearings that were reached",
    "reach_rate": "Share of listed hearings the court actually got to",
    "substantiveness": "Share of reached hearings that moved the case forward",
    "backlog_age_impact": "Share of cases 4+ years old that were heard",
    "predictability_days": "Average days between a case's first scheduled date and when it was actually heard",
    "next_date_sanity": "Share of next dates within the procedural range for that hearing type",
}


def _ratio(a: float, b: float) -> float:
    return a / b if b else 0.0


def compute(records: list[HearingRecord], sitting_days: int, capacity_minutes: int,
            start_ages: dict[str, float], disposed: dict[str, str] | None = None) -> dict:
    """Metrics from hearing records. `start_ages`: age at period start of every pending case."""
    reached = [x for x in records if x.outcome.reached]
    substantive = [x for x in reached if x.outcome.substantive]
    minutes = sum(x.outcome.duration for x in reached)
    reached_ids = {x.case_id for x in reached}

    def backlog(years: float) -> float:
        cohort = [fn for fn, a in start_ages.items() if a >= years]
        return _ratio(sum(fn in reached_ids for fn in cohort), len(cohort))

    delays = [(x.date - x.first_promised_date).days for x in reached if x.first_promised_date]
    sanity = [x.next_date_gap_ok for x in records if x.next_date_gap_ok is not None]
    adv_days: dict[str, set] = defaultdict(set)
    party_days: dict[str, set] = defaultdict(set)
    for x in records:
        adv_days[x.advocate_id].add(x.date)
        party_days[x.party_id].add(x.date)
    reasons = Counter(x.outcome.reason_group.value for x in reached
                      if not x.outcome.substantive and x.outcome.reason_group)
    disposed = disposed or {}
    return {
        "utilisation": _ratio(minutes, capacity_minutes * sitting_days),
        "reach_rate": _ratio(len(reached), len(records)),
        "substantiveness": _ratio(len(substantive), len(reached)),
        "backlog_age_impact": backlog(4),
        "predictability_days": mean(delays) if delays else 0.0,
        "next_date_sanity": _ratio(sum(sanity), len(sanity)),
        "extras": {
            "backlog_3y": backlog(3),
            "backlog_5y": backlog(5),
            "disposed": len(disposed),
            "disposed_4y": sum(1 for fn in disposed if start_ages.get(fn, 0) >= 4),
            "heard_on_first_date_pct": _ratio(sum(1 for v in delays if v == 0), len(delays)),
            "avg_trips_per_party": mean(len(v) for v in party_days.values()) if party_days else 0.0,
            "avg_trips_per_advocate": mean(len(v) for v in adv_days.values()) if adv_days else 0.0,
            "adjournments_by_reason": {g.value: reasons.get(g.value, 0) for g in ReasonGroup},
            "listed_per_day": _ratio(len(records), sitting_days),
            "minutes_used": minutes,
            "listings": len(records),
            "hearings": len(reached),
        },
    }


def compute_run(run) -> dict:
    """Metrics for one SimResult."""
    records = [r for d in run.days for r in d.records]
    disposed = {fn: c.disposal_type for fn, c in run.cases.items()
                if c.disposed and c.disposed_on and c.disposed_on >= run.start}
    return compute(records, len(run.sitting_days), run.capacity_minutes, run.start_ages, disposed)


def aggregate(per_run: list[dict]) -> dict:
    """Mean across runs; headline metrics also get a [min, max] range."""
    out: dict = {}
    for k in HEADLINE:
        vals = [m[k] for m in per_run]
        out[k] = {"value": mean(vals), "range": [min(vals), max(vals)] if len(vals) > 1 else None}
    extras: dict = {}
    for k, v in per_run[0]["extras"].items():
        if isinstance(v, dict):
            extras[k] = {kk: mean(m["extras"][k][kk] for m in per_run) for kk in v}
        else:
            extras[k] = mean(m["extras"][k] for m in per_run)
    out["extras"] = extras
    return out


def with_baseline(agg: dict, base: dict | None) -> dict:
    out = {"extras": agg["extras"]}
    for k in HEADLINE:
        v = agg[k]["value"]
        b = base[k]["value"] if base else None
        out[k] = {"value": v, "baseline": b, "delta": (v - b) if b is not None else None, "range": agg[k]["range"]}
    return out
