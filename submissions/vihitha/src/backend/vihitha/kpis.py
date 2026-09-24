"""The 4 judge KPIs (spec v3 section 7.8). Values are 0-100 percentages or counts per week."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date

MOVED = {"MOVED_FORWARD", "DISPOSED"}
REACHED = {"MOVED_FORWARD", "ADJOURNED", "DISPOSED"}

KPI_META = {
    "moved_forward": ("Cases moved forward", "per week", True),
    "old_cases_heard": ("Old cases heard", "%", True),
    "court_time_used": ("Court time used", "%", True),
    "heard_on_promised": ("Heard on promised date", "%", True),
}
GOOD_BAND = (85.0, 100.0)  # court time used


@dataclass
class KpiRow:
    date: date
    case_id: str
    result: str | None  # MOVED_FORWARD | ADJOURNED | NOT_REACHED | DISPOSED
    minutes: float  # actual minutes used (0 if not reached)
    first_promised_date: date | None


def _pct(a: float, b: float) -> float:
    return round(100.0 * a / b, 1) if b else 0.0


def compute(rows: list[KpiRow], sitting_days: int, old_cohort: set[str], capacity_minutes: int = 420) -> dict:
    """Raw KPI values plus the numbers behind them."""
    reached = [r for r in rows if r.result in REACHED]
    moved = [r for r in reached if r.result in MOVED]
    weeks = max(sitting_days / 5.0, 0.2)
    heard_ids = {r.case_id for r in reached}
    old_heard = len(old_cohort & heard_ids)
    promised = [r for r in reached if r.first_promised_date is not None]
    on_time = sum(1 for r in promised if r.first_promised_date == r.date)
    minutes = sum(r.minutes for r in reached)
    return {
        "moved_forward": round(len(moved) / weeks, 1),
        "old_cases_heard": _pct(old_heard, len(old_cohort)),
        "court_time_used": _pct(minutes, capacity_minutes * sitting_days),
        "heard_on_promised": _pct(on_time, len(promised)),
        "detail": {
            "moved_forward": f"{len(moved)} of {len(reached)} hearings reached moved the case forward "
                             f"({_pct(len(moved), len(reached)):.0f}%)",
            "old_cases_heard": f"{old_heard} of {len(old_cohort)} cases aged 4+ years heard at least once",
            "court_time_used": f"{minutes:.0f} of {capacity_minutes * sitting_days} minutes "
                               f"over {sitting_days} sitting days (good band 85-100%)",
            "heard_on_promised": f"{on_time} of {len(promised)} hearings reached on the first date promised",
        },
        "counts": {"reached": len(reached), "moved": len(moved), "listed": len(rows), "minutes": minutes,
                   "old_heard": old_heard, "old_cohort": len(old_cohort)},
    }


def better(key: str, value: float, compare: float | None) -> bool | None:
    if compare is None:
        return None
    if key == "court_time_used":  # closer to the good band is better
        def dist(v):
            lo, hi = GOOD_BAND
            return 0 if lo <= v <= hi else min(abs(v - lo), abs(v - hi))
        return dist(value) <= dist(compare)
    return value >= compare


def as_list(values: dict, compare: dict | None = None, is_forecast: bool = False) -> list[dict]:
    """Kpi schema dicts, in display order."""
    out = []
    for key, (label, unit, _) in KPI_META.items():
        v = values[key]
        c = compare[key] if compare else None
        out.append({
            "key": key, "label": label, "value": v, "unit": unit,
            "compare_value": c,
            "delta": round(v - c, 1) if c is not None else None,
            "better": better(key, v, c),
            "is_forecast": is_forecast,
            "detail": values.get("detail", {}).get(key),
        })
    return out


def rows_from_records(records) -> list[KpiRow]:
    """engine HearingRecord -> KpiRow."""
    return [KpiRow(r.date, r.case_id, r.result, r.outcome.duration if r.outcome.reached else 0,
                   r.first_promised_date) for r in records]
