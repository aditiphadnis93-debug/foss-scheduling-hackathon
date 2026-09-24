"""Map stored rows and engine objects to the API contract shapes (API_CONTRACT_v3.md)."""
from __future__ import annotations

import json
from datetime import date

from vihitha.enums import HearingType, age_bucket, group_of
from vihitha.state import counts_from_json

from . import context

LIKELY, UNCERTAIN = 0.6, 0.3


def likelihood(p: float) -> str:
    return "LIKELY" if p >= LIKELY else ("UNCERTAIN" if p >= UNCERTAIN else "UNLIKELY")


def age_years(filing_date: date, on: date) -> float:
    return round((on - filing_date).days / 365.25, 2)


def label(h: str) -> str:
    try:
        return HearingType(h).label
    except ValueError:
        return h.title()


def case_flags(c, today: date, hearing=None) -> list[str]:
    ref = context.reference()
    flags = []
    age = (today - c.filing_date).days / 365.25
    if age >= 4:
        flags.append("OLD_CASE")
    if age >= 5:
        flags.append("VERY_OLD_CASE")
    if (c.consecutive_adjourned or 0) >= 3:
        flags.append("REPEAT_ADJOURNED")
    try:
        t = ref[HearingType(c.stage)]
        at_stage = c.hearings_at_stage or 0
        if c.status == "PENDING" and (at_stage > 2 * t.median_h or at_stage >= t.max_h):
            flags.append("STUCK")
    except (ValueError, KeyError):
        pass
    if c.pending_until and c.pending_until > today:
        flags.append("PROCESS_PENDING")
    if c.last_chance:
        flags.append("LAST_CHANCE")
    if hearing is not None and hearing.carried_forward:
        flags.append("CARRIED_FORWARD")
    return flags


def hearing_event(h, c, today: date) -> dict:
    result = None
    if h.result:
        result = {"result": h.result, "reason_group": h.reason_group, "disposal_type": h.disposal_type,
                  "actual_start": h.actual_start, "actual_end": h.actual_end, "note": h.note}
    age = age_years(c.filing_date, h.date)
    return {
        "hearing_id": h.id, "case_id": c.id, "case_number": c.case_number,
        "title": f"{c.case_number} · {label(h.hearing_type)}",
        "hearing_type": h.hearing_type, "stage": c.stage, "age_years": age, "age_bucket": age_bucket(age),
        "advocate_id": c.advocate_id, "date": h.date.isoformat(), "block_id": h.block_id,
        "window_start": h.window_start, "window_end": h.window_end, "est_start": h.est_start,
        "est_end": h.est_end, "duration_min": h.duration_min, "expected_minutes": round(h.expected_minutes or 0, 1),
        "likelihood": likelihood(h.p_substantive or 0), "p_substantive": round(h.p_substantive or 0, 3),
        "reason": h.reason or "", "status": h.status, "pinned": bool(h.pinned),
        "carried_forward": bool(h.carried_forward),
        "first_promised_date": h.first_promised_date.isoformat() if h.first_promised_date else None,
        "origin": h.origin, "result": result, "flags": case_flags(c, today, h),
        "tentative": bool(getattr(h, "tentative", False)), "queue_position": h.seq or None,
        "group": group_of(h.hearing_type),
    }


def forecast_of(c) -> dict | None:
    return json.loads(c.forecast_json) if c.forecast_json else None


def case_summary(c, today: date, next_hearing=None) -> dict:
    f = forecast_of(c) if c.status == "PENDING" else None
    prob = f["prob_ends_by_horizon"] if f else None
    age = age_years(c.filing_date, today)
    return {
        "case_id": c.id, "case_number": c.case_number, "stage": c.stage, "next_purpose": c.next_purpose,
        "status": c.status, "age_years": age, "age_bucket": age_bucket(age), "advocate_id": c.advocate_id,
        "next_hearing": ({"hearing_id": next_hearing.id, "date": next_hearing.date.isoformat(),
                          "window_start": next_hearing.window_start, "window_end": next_hearing.window_end,
                          "status": next_hearing.status,
                          "tentative": bool(getattr(next_hearing, "tentative", False))}
                         if next_hearing is not None else None),
        "projected_end": f["projected_end"] if f else None,
        "prob_ends_by_horizon": prob,
        "likely_to_finish": (prob >= 0.5) if prob is not None else None,
        "flags": case_flags(c, today, next_hearing),
        "disposed_on": c.disposed_on.isoformat() if c.disposed_on else None,
        "disposal_type": c.disposal_type,
    }


def day_totals(d: date, hearings: list, status: str | None, capacity: float = 420.0,
               old_on: date | None = None, case_rows: dict | None = None) -> dict:
    """Totals for a day from its non-cancelled hearings."""
    rows = [h for h in hearings if h.status != "CANCELLED"]
    expected = sum(h.expected_minutes or 0 for h in rows)
    old = 0
    if case_rows is not None:
        on = old_on or d
        old = sum(1 for h in rows if h.case_id in case_rows
                  and (on - case_rows[h.case_id].filing_date).days / 365.25 >= 4)
    closed = status == "CLOSED"
    results = [h.result for h in rows]
    return {
        "date": d.isoformat(), "listed": len(rows), "expected_minutes": round(expected, 1),
        "capacity_minutes": capacity, "load_pct": round(100 * expected / capacity, 1) if capacity else 0.0,
        "old_cases": old,
        "unused_minutes": round(max(0.0, capacity - expected), 1),
        "moved_forward": sum(r in ("MOVED_FORWARD", "DISPOSED") for r in results) if closed else None,
        "adjourned": sum(r == "ADJOURNED" for r in results) if closed else None,
        "not_reached": sum(r == "NOT_REACHED" for r in results) if closed else None,
    }


def hearing_counts(c) -> dict:
    return {h.value: n for h, n in counts_from_json(c.hearing_counts_json).items()}
