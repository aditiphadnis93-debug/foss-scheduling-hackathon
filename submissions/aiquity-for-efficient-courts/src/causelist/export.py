"""SimResult -> JSON for the web app. The schema is documented in web/DATA_CONTRACT.md."""
from __future__ import annotations

import dataclasses
from collections import Counter
from datetime import date
from typing import Any

from . import attribution, phases
from .audit import capped, counts
from .config import admin_windows, profile_report, sitting_windows
from .metrics import flags, score
from .simulate import SimResult

AUDIT_FULL_MAX_ROSTER = 500     # the full audit log is exported for rosters up to this size (the 100 roster)
AUDIT_LIMIT = 25000             # ...capped at this many entries (rare decisions kept first)
AUDIT_RARE_LIMIT = 5000         # larger rosters: only the rare decisions (no listed/next_date/held_back)

AGE_BUCKETS = ["<1y", "1-2y", "2-3y", "3-4y", "4-5y", "5y+"]


def _bucket(years: float) -> str:
    return AGE_BUCKETS[min(int(years), 5)]


def _d(x: date | None) -> str | None:
    return x.isoformat() if x else None


def backlog_series(res: SimResult) -> list[dict[str, Any]]:
    """Pending cases per age bucket at the end of each sitting day."""
    disposed_on: dict[str, date] = {}
    filed_on: dict[str, date] = {}
    for d in res.days:
        for o in d.outcomes:
            if o.kind == "substantive" and o.next_purpose is None:
                disposed_on[o.case_id] = d.day
    initial_ids = {c.case_id for c in res.initial}
    for c in res.cases:
        if c.case_id not in initial_ids:
            filed_on[c.case_id] = c.filing_date
    out = []
    for d in res.days:
        cnt: Counter = Counter()
        for c in res.cases:
            if c.case_id in filed_on and filed_on[c.case_id] > d.day:
                continue
            if c.case_id in disposed_on and disposed_on[c.case_id] <= d.day:
                continue
            cnt[_bucket(c.age_years(d.day))] += 1
        out.append({"date": _d(d.day), **{b: cnt.get(b, 0) for b in AGE_BUCKETS},
                    "disposed_cum": sum(1 for v in disposed_on.values() if v <= d.day)})
    return out


def export_result(res: SimResult, *, include_cases: bool = True, label: str | None = None,
                  include_audit: bool | None = None) -> dict[str, Any]:
    cfg = res.config
    h, m = map(int, cfg.day_start.split(":"))
    base = h * 60 + m
    hhmm = lambda x: f"{(base + x) // 60:02d}:{(base + x) % 60:02d}"
    hm = lambda x: f"{x // 60:02d}:{x % 60:02d}"          # absolute minutes after midnight
    days = []

    def row(l, o) -> dict[str, Any]:
        return {
            "case_id": l.case_id, "slot": l.slot, "start": hhmm(l.start_min), "end": hhmm(l.end_min),
            "purpose": l.purpose, "advocate": l.advocate_id, "exp_min": l.expected_minutes,
            "p_ahead": l.p_goes_ahead, "p_sub": l.p_substantive, "score": l.score, "why": l.why,
            "duration_mult": getattr(l, "duration_mult", 1.0),
            "outcome": None if o is None else {
                "kind": o.kind, "reason": o.reason, "minutes": o.minutes_used,
                "rationale": said.get((o.case_id, o.day)),
                "next_date": _d(o.next_date), "next_purpose": o.next_purpose, "decided_by": o.decided_by,
                "stakeholder": ("judge_emergency" if (o.reason or "").startswith("Judge emergency")
                                else attribution.stakeholder_for(o.kind, o.reason)),
                "phases": phases.split(o.purpose, o.kind, o.minutes_used, f"{res.seed}|{o.case_id}|{o.day}")},
        }

    day_ops = getattr(res, "day_ops", {}) or {}
    said = {(e.case_id, e.day): e.data.get("rationale") for e in res.events if e.kind == "agent_decision"}
    for d in res.days:
        outs = {o.case_id: o for o in d.outcomes}
        listings = [row(l, outs.get(l.case_id)) for l in sorted(d.plan.listings, key=lambda l: (l.start_min, -l.score))]
        ops = day_ops.get(d.day, {})
        days.append({"date": _d(d.day), "capacity": d.plan.capacity_minutes, "minutes_used": d.minutes_used,
                     "expected": d.plan.expected_minutes, "solver": d.plan.solver, "new_filings": d.new_filings,
                     "listings": listings,
                     "standby": [row(l, outs.get(l.case_id)) for l in d.plan.standby],
                     "held_back": [{"case_id": cid, "reason": why} for cid, why in d.plan.held_back if why != "capacity"][:200],
                     "held_back_capacity": sum(1 for _, why in d.plan.held_back if why == "capacity"),
                     "sitting_windows": [[hm(a), hm(b)] for a, b in sitting_windows(cfg, d.day)],
                     "admin_windows": [[hm(a), hm(b)] for a, b in admin_windows(cfg, d.day)],
                     "reserve_minutes": ops.get("reserve_minutes", 0), "reserve_used": ops.get("reserve_used", 0.0),
                     "urgent": ops.get("urgent", []), "judge_emergency": ops.get("judge_emergency")})
    out: dict[str, Any] = {
        "meta": {"label": label or cfg.name, "config": cfg.name, "planner": cfg.planner,
                 "roster_size": len(res.initial), "start": _d(res.start), "end": _d(res.end), "seed": res.seed,
                 "behaviour": res.behaviour, "inflow": res.inflow, "sitting_days": len(res.days),
                 "config_detail": _jsonable(dataclasses.asdict(cfg)),
                 "profile_report": _jsonable(profile_report(cfg))},
        "metrics": score(res),
        "backlog": backlog_series(res),
        "flags": flags(res),
        "days": days,
    }
    entries = list(getattr(res, "audit", []) or [])
    out["audit_counts"] = counts(entries)
    out["audit_total"] = len(entries)
    if include_audit is None:
        include_audit = len(res.initial) <= AUDIT_FULL_MAX_ROSTER
    if include_audit:
        out["audit"] = capped(entries, AUDIT_LIMIT)
    else:
        rare = [e for e in entries if e["action"] not in ("listed", "next_date", "held_back")]
        out["audit"] = rare[:AUDIT_RARE_LIMIT]
    out["audit_truncated"] = len(out["audit"]) < len(entries)
    try:
        out["attribution"] = attribution.summarise(res)
    except Exception as exc:          # the attribution build must never break an export
        out["attribution"] = {"error": f"{type(exc).__name__}: {exc}"}
    try:
        from . import access as _access
        out["access"] = _access.summarise(res)
    except Exception as exc:          # never break an export
        out["access"] = {"error": f"{type(exc).__name__}: {exc}"}
    try:
        from . import profiles as _profiles
        out["profiles"] = _profiles.build(res, getattr(res, "learner", None))
    except ImportError:
        out["profiles"] = None
    try:
        from . import runway as _runway
        out["runway"] = _runway.summarise(res)
    except Exception as exc:          # never break an export
        out["runway"] = {"error": f"{type(exc).__name__}: {exc}"}
    try:
        from .priors import master_list
        learner = getattr(res, "learner", None)
        learned = learner.learned_by_type() if learner is not None and hasattr(learner, "learned_by_type") else None
        out["priors"] = master_list(cfg, learned)
    except Exception as exc:          # never break an export
        out["priors"] = {"error": f"{type(exc).__name__}: {exc}"}
    if include_cases:
        init = {c.case_id: c for c in res.initial}
        out["cases"] = {
            c.case_id: {"filing_date": _d(c.filing_date), "age_at_start": round(c.age_years(res.start), 2),
                        "advocate": c.advocate_id, "party": c.party_id,
                        "stage_start": init[c.case_id].stage if c.case_id in init else "ADMISSION",
                        "purpose_start": init[c.case_id].purpose if c.case_id in init else "ADMISSION",
                        "stage_end": c.stage, "purpose_end": c.purpose, "status_end": c.status,
                        "origin": c.origin, "hearings_total": c.total_hearings}
            for c in res.cases}
    return out


def _jsonable(x: Any) -> Any:
    if isinstance(x, dict):
        return {k: _jsonable(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [_jsonable(v) for v in x]
    if isinstance(x, date):
        return x.isoformat()
    return x
