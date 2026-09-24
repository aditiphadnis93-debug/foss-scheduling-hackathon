"""Cases, case detail and the "when does it end" forecast (spec v3 section 4, 8.5)."""
from __future__ import annotations

import json
from collections import Counter, defaultdict
from datetime import date, datetime
from statistics import median

from sqlalchemy.orm import Session

from vihitha import forecast as fc
from vihitha.enums import SEQUENTIAL, STAGE_INDEX, HearingType
from vihitha.state import counts_from_json

from .. import config
from ..clock import utcnow
from ..db import session_scope
from ..errors import NotFound, ValidationFailed
from ..repositories import cases as cases_repo
from ..repositories import hearings as hearings_repo
from . import context, views

SORTS = {"age_desc", "age_asc", "end_asc", "end_desc", "next_date", "case_number"}
OPTIONAL = {HearingType.DELAY_CONDONATION_HEARING, HearingType.WARRANT}


def ensure_forecasts(s: Session, rows: list, next_dates: dict | None = None) -> None:
    """(Re)compute forecasts whose inputs changed (stage, purpose, start date, horizon)."""
    t = context.today(s)
    ref = context.reference()
    seed = context.seed(s)
    horizon_end = config.FORECAST_HORIZON_END if config.FORECAST_HORIZON_END > t else date(t.year, 12, 31)
    if next_dates is None:
        next_dates = {}
        for h in hearings_repo.all_active(s):
            if h.case_id not in next_dates or h.date < next_dates[h.case_id]:
                next_dates[h.case_id] = h.date
    rules = context.active_rules(s)[0]
    for r in rows:
        if r.status != "PENDING":
            continue
        start = next_dates.get(r.id) or t
        if r.id not in next_dates and r.pending_until and r.pending_until > start:
            start = r.pending_until
        key = f"{r.stage}|{r.next_purpose}|{start.isoformat()}|{horizon_end.isoformat()}|{seed}"
        if r.forecast_key == key and r.forecast_json:
            continue
        f = fc.forecast_case(r.id, HearingType(r.stage), HearingType(r.next_purpose), start, horizon_end, ref,
                             seed=seed, settlement_prob=rules.settlement_prob)
        r.forecast_json = json.dumps(fc.to_json(f))
        r.forecast_key = key
        r.forecast_p50 = f.p50
        r.forecast_at = utcnow()


def _next_hearings(s: Session) -> dict:
    out = {}
    for h in hearings_repo.all_active(s):
        if h.case_id not in out or h.date < out[h.case_id].date:
            out[h.case_id] = h
    return out


def list_(stage=None, bucket=None, status=None, q=None, ends_before=None, flag=None, sort="age_desc",
          page=1, size=50) -> dict:
    if sort not in SORTS:
        raise ValidationFailed(f"sort must be one of {sorted(SORTS)}")
    page, size = max(1, int(page)), max(1, min(500, int(size)))
    with session_scope() as s:
        rows = cases_repo.all_(s)
        nxt = _next_hearings(s)
        ensure_forecasts(s, rows, {k: v.date for k, v in nxt.items()})
        t = context.today(s)
        items = [views.case_summary(r, t, nxt.get(r.id)) for r in rows]
        if stage:
            items = [x for x in items if x["stage"] == stage.upper()]
        if bucket:
            items = [x for x in items if x["age_bucket"] == bucket]
        if status:
            items = [x for x in items if x["status"] == status.upper()]
        if q:
            ql = q.lower()
            items = [x for x in items if ql in x["case_number"].lower() or ql in x["case_id"].lower()
                     or ql in x["advocate_id"].lower()]
        if ends_before:
            eb = ends_before.isoformat()
            items = [x for x in items if x["projected_end"] and x["projected_end"]["p50"] <= eb]
        if flag:
            items = [x for x in items if flag.upper() in x["flags"]]
        far = "9999-12-31"
        keyf = {
            "age_desc": lambda x: (-x["age_years"], x["case_id"]),
            "age_asc": lambda x: (x["age_years"], x["case_id"]),
            "end_asc": lambda x: ((x["projected_end"] or {}).get("p50", far), x["case_id"]),
            "end_desc": lambda x: ((x["projected_end"] or {}).get("p50", ""), x["case_id"]),
            "next_date": lambda x: ((x["next_hearing"] or {}).get("date", far), x["case_id"]),
            "case_number": lambda x: (x["case_number"], x["case_id"]),
        }[sort]
        items.sort(key=keyf, reverse=(sort == "end_desc"))
        total = len(items)
        return {"items": items[(page - 1) * size: page * size], "total": total, "page": page, "size": size}


def _lifecycle(r) -> list[dict]:
    counts = counts_from_json(r.hearing_counts_json)
    cur = HearingType(r.stage)
    ci = STAGE_INDEX.get(cur, 0)
    out = []
    for i, h in enumerate(SEQUENTIAL):
        if r.status == "DISPOSED":
            state = "DONE" if i <= ci or counts.get(h, 0) else "SKIPPED"
        elif i < ci:
            state = "SKIPPED" if (h in OPTIONAL and counts.get(h, 0) == 0) else "DONE"
        elif i == ci:
            state = "CURRENT"
        else:
            state = "SKIPPED" if h in OPTIONAL else "UPCOMING"
        out.append({"stage": h.value, "label": h.label, "index": i, "state": state, "hearings_so_far": counts.get(h, 0)})
    return out


def detail(case_id: str) -> dict:
    with session_scope() as s:
        r = cases_repo.get(s, case_id)
        if r is None:
            raise NotFound(f"Case {case_id} not found")
        t = context.today(s)
        ensure_forecasts(s, [r])
        hs = hearings_repo.for_case(s, r.id)
        upcoming = [h for h in hs if h.status in hearings_repo.ACTIVE]
        history = [h for h in hs if h.status == "DONE"]
        nxt = min(upcoming, key=lambda h: h.date) if upcoming else None
        f = views.forecast_of(r) if r.status == "PENDING" else None
        return {
            **views.case_summary(r, t, nxt),
            "filing_date": r.filing_date.isoformat(), "party_id": r.party_id,
            "last_hearing_summary": r.last_hearing_summary,
            "pending_until": r.pending_until.isoformat() if r.pending_until else None,
            "pending_reason": r.pending_reason,
            "lifecycle": _lifecycle(r),
            "hearing_counts": views.hearing_counts(r),
            "history": [views.hearing_event(h, r, t) for h in sorted(history, key=lambda h: h.date, reverse=True)],
            "upcoming": [views.hearing_event(h, r, t) for h in upcoming],
            "forecast": ({"how_it_ends": f["how_it_ends"], "remaining_stages": f["remaining_stages"],
                          "projected_end": f["projected_end"], "prob_ends_by_horizon": f["prob_ends_by_horizon"],
                          "explanation": f["explanation"]} if f else None),
        }


def forecast_summary() -> dict:
    with session_scope() as s:
        rows = cases_repo.pending(s)
        ensure_forecasts(s, rows)
        t = context.today(s)
        horizon_end = config.FORECAST_HORIZON_END if config.FORECAST_HORIZON_END > t else date(t.year, 12, 31)
        fs = [(r, json.loads(r.forecast_json)) for r in rows if r.forecast_json]
        days = [(date.fromisoformat(f["projected_end"]["p50"]) - t).days for _, f in fs]
        months = Counter(f["projected_end"]["p50"][:7] for _, f in fs)
        by_stage: dict[str, list[int]] = defaultdict(list)
        for (r, f), dd in zip(fs, days):
            by_stage[r.stage].append(dd)
        return {
            "horizon_end": horizon_end.isoformat(),
            "median_days_to_end": int(median(days)) if days else None,
            "pct_ending_by_horizon": round(100 * sum(f["prob_ends_by_horizon"] for _, f in fs) / len(fs), 1) if fs else 0.0,
            "ending_by_month": [{"month": m, "count": n} for m, n in sorted(months.items())],
            "by_stage": [{"stage": h.value, "cases": len(by_stage[h.value]),
                          "median_days_to_end": int(median(by_stage[h.value])) if by_stage[h.value] else None}
                         for h in SEQUENTIAL if by_stage.get(h.value)],
        }
