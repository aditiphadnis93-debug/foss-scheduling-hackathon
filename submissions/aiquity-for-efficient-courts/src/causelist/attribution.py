"""Delay attribution: every non-substantive outcome belongs to a stakeholder.

CONTRACT (the learning build fills in the analytics; the mapping below is final):
    stakeholder_for(kind, reason) -> one of STAKEHOLDERS
    summarise(sim_result) -> {"by_stakeholder": {...}, "by_type": {...}, "by_day": [...], "minutes_lost": {...}}
    (additions: "by_week", "per_advocate", "by_reason", "sought_time_by_side", "share_pct", "listed",
     "non_substantive")
"""
from __future__ import annotations

from collections import Counter, defaultdict
from datetime import timedelta

STAKEHOLDERS = ["petitioner_side", "respondent_side", "both_sides", "state_agencies", "court", "judge_emergency", "time_ran_out"]

_MAP = {
    "Petitioner Absence / Non-Compliance": "petitioner_side",
    "Respondent Absence / Non-Compliance": "respondent_side",
    "Both Parties Unready / Absent": "both_sides",
    "Party Sought Time / Adjournment": "both_sides",
    "Evidence / Filing Not Ready": "both_sides",
    "Awaiting Process / Summons / Warrant Return": "state_agencies",
    "External Dependency": "state_agencies",
    "Court Administrative Issue": "court",
    "Court Holiday / No Sitting": "court",
    "Unclear": "court",
}


_AGENCY_WORDS = ("agency", "police", "forensic", "process", "summons", "warrant", "report awaited")


def stakeholder_for(kind: str, reason: str | None) -> str | None:
    if kind == "substantive":
        return None
    if reason and reason.startswith("Judge emergency"):   # before not_reached: emergency tails are rolled
        return "judge_emergency"
    if kind == "not_reached":
        return "time_ran_out"
    if reason in _MAP:
        return _MAP[reason]
    low = (reason or "").lower()
    if "judge" in low and ("emergency" in low or "leave" in low or "unavailable" in low):
        return "judge_emergency"
    if any(w in low for w in _AGENCY_WORDS):
        return "state_agencies"
    return "court"


def request_side(case, day_iso: str) -> str | None:
    """Which side asked for time on ``day_iso`` (recorded by the behaviour), if known."""
    for d, side in (getattr(case, "meta", {}) or {}).get("time_requests", []):
        if d == day_iso:
            return side
    return None


def _week(d) -> str:
    return (d - timedelta(days=d.weekday())).isoformat()


def _blank() -> dict:
    return {"count": 0, "court_minutes": 0.0, "slot_minutes": 0.0}


def _add(bucket: dict, minutes: float, slot: float) -> None:
    bucket["count"] += 1
    bucket["court_minutes"] += minutes
    bucket["slot_minutes"] += slot


def _round(d):
    if isinstance(d, dict):
        return {k: _round(v) for k, v in d.items()}
    if isinstance(d, list):
        return [_round(v) for v in d]
    return round(d, 1) if isinstance(d, float) else d


def summarise(res) -> dict:
    """Every non-substantive outcome, attributed to a stakeholder.

    ``court_minutes``: court time actually spent on the outcome (call-over / short adjournment).
    ``slot_minutes``: the planner's expected minutes for that listing -- the court time the list
    had set aside for a hearing that did not happen (it is refilled only if standby matters exist).
    Counts in ``by_stakeholder`` sum to ``non_substantive`` exactly.
    """
    cases = {c.case_id: c for c in res.cases}
    by_st = {s: _blank() for s in STAKEHOLDERS}
    by_type: dict[str, dict] = defaultdict(lambda: {s: _blank() for s in STAKEHOLDERS})
    by_week: dict[str, dict] = defaultdict(lambda: {s: _blank() for s in STAKEHOLDERS})
    by_day: list[dict] = []
    per_adv: dict[str, dict] = defaultdict(lambda: {"listed": 0, "non_substantive": 0, "court_minutes": 0.0,
                                                    "slot_minutes": 0.0, "caused": _blank(),
                                                    "by_stakeholder": defaultdict(int)})
    sought_by_side: Counter = Counter()
    by_reason: Counter = Counter()
    total = non_sub = 0
    for d in res.days:
        slot = {l.case_id: l.expected_minutes for l in list(d.plan.listings) + list(getattr(d.plan, "standby", []) or [])}
        day_row = {"day": d.day.isoformat(), **{s: 0 for s in STAKEHOLDERS}}
        for o in d.outcomes:
            total += 1
            c = cases.get(o.case_id)
            adv = c.advocate_id if c else "unknown"
            per_adv[adv]["listed"] += 1
            st = stakeholder_for(o.kind, o.reason)
            if st is None:
                continue
            non_sub += 1
            sm = float(slot.get(o.case_id, 0.0))
            mins = float(o.minutes_used)
            _add(by_st[st], mins, sm)
            _add(by_type[o.purpose][st], mins, sm)
            _add(by_week[_week(o.day)][st], mins, sm)
            day_row[st] += 1
            by_reason[o.reason or o.kind] += 1
            pa = per_adv[adv]
            pa["non_substantive"] += 1
            pa["court_minutes"] += mins
            pa["slot_minutes"] += sm
            pa["by_stakeholder"][st] += 1
            side = None
            if o.reason == "Party Sought Time / Adjournment":
                side = (request_side(c, o.day.isoformat()) if c else None) or "unknown"
                sought_by_side[side] += 1
            # delay the advocate's own side caused: their side absent, or their side sought time
            if st == "petitioner_side" or side == "petitioner":
                _add(pa["caused"], mins, sm)
        by_day.append(day_row)
    court_total = sum(v["court_minutes"] for v in by_st.values())
    out = {
        "listed": total,
        "non_substantive": non_sub,
        "by_stakeholder": by_st,
        "share_pct": {s: round(100 * v["count"] / max(non_sub, 1), 1) for s, v in by_st.items()},
        "by_type": {k: v for k, v in sorted(by_type.items())},
        "by_week": [{"week": w, **v} for w, v in sorted(by_week.items())],
        "by_day": by_day,
        "by_reason": dict(by_reason.most_common()),
        "sought_time_by_side": dict(sought_by_side),
        "per_advocate": {a: {**v, "by_stakeholder": dict(v["by_stakeholder"])} for a, v in sorted(per_adv.items())},
        "minutes_lost": {"court": {s: v["court_minutes"] for s, v in by_st.items()},
                         "slot": {s: v["slot_minutes"] for s, v in by_st.items()},
                         "court_total": court_total},
    }
    return _round(out)
