"""The single metrics page (spec v3 7.8, 7.9, 8.7): 4 KPIs, trends, needs attention, official scoring."""
from __future__ import annotations

import hashlib
import json
from collections import defaultdict
from datetime import date, timedelta

from sqlalchemy.orm import Session

from vihitha import kpis as kpi_mod
from vihitha import metrics as off
from vihitha.calendar import fmt_day
from vihitha.enums import BUCKETS, HearingType, ReasonGroup, age_bucket
from vihitha.inputs import Inputs
from vihitha.models import HearingRecord, Outcome
from vihitha.rules import preset
from vihitha.simulate import simulate_many

from .. import config
from ..db import session_scope
from ..errors import ValidationFailed
from ..repositories import cases as cases_repo
from ..repositories import days as days_repo
from ..repositories import hearings as hearings_repo
from ..repositories import settings as settings_repo
from . import case_service, context, views
from .whatif_service import kpi_values, snapshot_sim

_CACHE: dict = {}
_BASE_CACHE: dict = {}  # cleared on roster load / reset (see clear_caches)
ACTIONS = {
    "PROCESS": "Hold until the warrant/summons return is confirmed",
    "ABSENCE": "Issue a last-chance notice with a fixed slot",
    "PREP": "Require a case summary before the next listing",
    "COURT": "Give a fixed slot early in the day",
    "UNCLEAR": "Review the file before the next listing",
}


def clear_caches() -> None:
    _CACHE.clear()
    _BASE_CACHE.clear()


def _cached(key, fn):
    k = (context.version(), key)
    if k not in _CACHE:
        if len(_CACHE) > 32:
            _CACHE.clear()
        _CACHE[k] = fn()
    return _CACHE[k]


def _week(d: date) -> date:
    return d - timedelta(days=d.weekday())


def _actual_rows(s: Session, start: date, end: date) -> tuple[list[kpi_mod.KpiRow], list[date]]:
    closed = [d for d, r in days_repo.in_range(s, start, end).items() if r.status == "CLOSED"]
    rows = []
    for h in hearings_repo.done(s, start, end):
        if h.date not in closed:
            continue
        mins = 0.0
        if h.result != "NOT_REACHED" and h.actual_start and h.actual_end:
            from vihitha.windows import hhmm_to_min
            mins = max(0, hhmm_to_min(h.actual_end) - hhmm_to_min(h.actual_start))
        rows.append(kpi_mod.KpiRow(h.date, h.case_id, h.result, mins, h.first_promised_date))
    return rows, sorted(closed)


def _old_cohort_db(s: Session, on: date) -> set[str]:
    out = set()
    for c in cases_repo.all_(s):
        if c.status == "DISPOSED" and c.disposed_on and c.disposed_on < on:
            continue
        if (on - c.filing_date).days / 365.25 >= 4:
            out.add(c.id)
    return out


def _needs_attention(s: Session, t: date) -> list[dict]:
    rows = cases_repo.pending(s)
    active = {}
    for h in hearings_repo.all_active(s):
        if h.case_id not in active or h.date < active[h.case_id].date:
            active[h.case_id] = h
    last_reason = {}
    for h in hearings_repo.done(s):
        if h.result == "ADJOURNED":
            last_reason[h.case_id] = h.reason_group
    rules = context.active_rules(s)[0]
    ref = context.reference()
    start = settings_repo.get(s, "roster_start")
    roster_start = date.fromisoformat(start) if start else t
    groups: dict[str, list] = defaultdict(list)
    for c in rows:
        age = (t - c.filing_date).days / 365.25
        nxt = active.get(c.id)
        if (c.consecutive_adjourned or 0) >= 3:
            g = last_reason.get(c.id) or "UNCLEAR"
            groups["REPEAT_ADJOURNED"].append((c, nxt, f"Adjourned {c.consecutive_adjourned} times in a row "
                                                      f"(last: {g.lower()})", ACTIONS.get(g, ACTIONS["UNCLEAR"])))
        t_ref = ref[HearingType(c.stage)]
        at = c.hearings_at_stage or 0
        if at > 2 * t_ref.median_h or at >= t_ref.max_h:
            groups["STUCK"].append((c, nxt, f"{at} hearings at {HearingType(c.stage).label} "
                                            f"(usual {t_ref.median_h:g}, max {t_ref.max_h})",
                                    "Require a case summary and give a fixed slot" if age >= 4
                                    else "Review why the stage is not moving"))
        for yrs in (4, 5):
            cross = c.filing_date + timedelta(days=int(yrs * 365.25) + 1)
            if t < cross <= t + timedelta(days=30) and (nxt is None or nxt.date > cross):
                groups["AGEING_RISK"].append((c, nxt, f"Turns {yrs} years old on {fmt_day(cross)} and is not listed "
                                                      f"before then", f"List before {fmt_day(cross)}"))
        if age >= 4:
            last = c.last_reached_on or roster_start
            waited = (t - last).days
            limit = rules.max_wait_days_4y
            due = last + timedelta(days=limit)
            if waited >= limit - 5 and (nxt is None or nxt.date > due):
                groups["OLD_NOT_HEARD"].append((c, nxt, f"{age:.1f} years old; not heard for {waited} days",
                                                "Give a fixed slot in the ageing block"))
        if c.pending_until and c.pending_until <= t and nxt is None:
            groups["WAITING_ON_PROCESS"].append((c, nxt, f"{c.pending_reason or 'Prerequisite'} was due back on "
                                                         f"{fmt_day(c.pending_until)}; not re-listed yet",
                                                 "Re-list now: the return date has passed"))
    labels = {
        "REPEAT_ADJOURNED": "Repeat adjournments", "STUCK": "Stuck at stage", "AGEING_RISK": "Ageing risk",
        "OLD_NOT_HEARD": "Old case not heard in 30 days", "WAITING_ON_PROCESS": "Waiting on process",
    }
    out = []
    for code, lab in labels.items():
        items = sorted(groups.get(code, []), key=lambda x: x[0].filing_date)
        out.append({"code": code, "label": lab, "count": len(items),
                    "top": [{**views.case_summary(c, t, nxt), "why": why, "suggested_action": act}
                            for c, nxt, why, act in items[:5]]})
    return out


def summary(start: date | None = None, end: date | None = None) -> dict:
    with session_scope() as s:
        t = context.today(s)
        if not context.roster_loaded(s):
            return {"from": None, "to": None, "today": t.isoformat(), "kpis": [], "weekly": [], "backlog_by_age": [],
                    "needs_attention": [], "cases_ending": {"this_month": 0, "next_month": 0}}
        rs = settings_repo.get(s, "roster_start")
        start = start or (date.fromisoformat(rs) if rs else t)
        end = end or (t + timedelta(days=30))
        if end < start:
            raise ValidationFailed("'to' must be on or after 'from'")
        cal = context.calendar(s)
        rules = context.active_rules(s)[0]
        seed = context.seed(s)
        actual, closed_days = _actual_rows(s, start, min(end, t))
        fut_end = end
        sim = None
        base = None
        if fut_end >= t:
            sim = _cached(("summary-sim", fut_end), lambda: snapshot_sim(s, rules, fut_end, seed, False))
            # The baseline comparison doesn't depend on the judge's edits: re-simulate it once per day.
            bkey = ("summary-base", fut_end, t, seed)
            if bkey not in _BASE_CACHE:
                if len(_BASE_CACHE) > 8:
                    _BASE_CACHE.clear()
                _BASE_CACHE[bkey] = snapshot_sim(s, preset("baseline"), fut_end, seed, True)
            base = _BASE_CACHE[bkey]
        fut_rows = kpi_mod.rows_from_records([r for d in sim.days for r in d.records]) if sim else []
        base_rows = kpi_mod.rows_from_records([r for d in base.days for r in d.records]) if base else []
        sit_future = [d.date for d in sim.days] if sim else []
        n_days = len(closed_days) + len(sit_future)
        cohort = _old_cohort_db(s, start)
        cur = kpi_mod.compute(actual + fut_rows, n_days, cohort)
        cmp_ = kpi_mod.compute(actual + base_rows, len(closed_days) + (len(base.days) if base else 0), cohort)
        kpis = kpi_mod.as_list(cur, cmp_, is_forecast=bool(sim))
        for k in kpis:
            k["compare_label"] = "Case-study baseline"

        # Weekly trend: actual (closed days) before today, forecast after.
        weekly = []
        all_rows = actual + fut_rows
        sitting_by_week = defaultdict(int)
        for d in closed_days + sit_future:
            sitting_by_week[_week(d)] += 1
        rows_by_week = defaultdict(list)
        for r in all_rows:
            rows_by_week[_week(r.date)].append(r)
        w = _week(start)
        while w <= end:
            n = sitting_by_week.get(w, 0)
            if n:
                v = kpi_mod.compute(rows_by_week.get(w, []), n, set())
                reached = [r for r in rows_by_week.get(w, []) if r.result in kpi_mod.REACHED]
                weekly.append({"week_start": w.isoformat(),
                               "moved_forward": sum(1 for r in reached if r.result in kpi_mod.MOVED),
                               "court_time_pct": v["court_time_used"], "heard_on_promised_pct": v["heard_on_promised"],
                               "is_forecast": w + timedelta(days=6) >= t})
            w += timedelta(days=7)

        # Backlog by age at each week start.
        backlog = []
        all_cases = cases_repo.all_(s)
        sim_disposed = {fn: c.disposed_on for fn, c in (sim.cases.items() if sim else []) if c.disposed_on}
        w = _week(start)
        while w <= end:
            b = {k: 0 for k in BUCKETS}
            for c in all_cases:
                disp = c.disposed_on if c.status == "DISPOSED" else sim_disposed.get(c.id)
                if disp is not None and disp < w:
                    continue
                b[age_bucket((w - c.filing_date).days / 365.25)] += 1
            backlog.append({"week_start": w.isoformat(), "buckets": b, "is_forecast": w > t})
            w += timedelta(days=7)

        pend = cases_repo.pending(s)
        case_service.ensure_forecasts(s, pend)
        this_m = t.strftime("%Y-%m")
        nm = (t.replace(day=1) + timedelta(days=32)).strftime("%Y-%m")
        ending = {"this_month": 0, "next_month": 0}
        for c in pend:
            p50 = c.forecast_p50.strftime("%Y-%m") if c.forecast_p50 else None
            if p50 == this_m:
                ending["this_month"] += 1
            elif p50 == nm:
                ending["next_month"] += 1
        ending["disposed_this_month"] = sum(1 for c in all_cases if c.disposed_on and c.disposed_on.strftime("%Y-%m") == this_m)
        return {"from": start.isoformat(), "to": end.isoformat(), "today": t.isoformat(), "kpis": kpis,
                "weekly": weekly, "backlog_by_age": backlog, "needs_attention": _needs_attention(s, t),
                "cases_ending": ending}


# ------------------------------------------------------------ official six

def _metric_list(m: dict) -> list[dict]:
    out = []
    for k in off.HEADLINE:
        v = m[k]
        pct = k in off.PERCENT
        scale = 100.0 if pct else 1.0
        val = round(v["value"] * scale, 1)
        base = round(v["baseline"] * scale, 1) if v.get("baseline") is not None else None
        delta = round(val - base, 1) if base is not None else None
        better = None
        if delta is not None:
            better = delta <= 0 if k in off.LOWER_IS_BETTER else delta >= 0
        out.append({"key": k, "label": off.LABELS[k], "value": val, "unit": "%" if pct else "days",
                    "baseline": base, "delta": delta, "better": better, "tooltip": off.TOOLTIPS[k]})
    return out


def _roster_inputs(s: Session) -> Inputs:
    from vihitha import roster as roster_mod
    from vihitha.loaders import read_roster
    from .setup_service import ROSTER_FILE
    if ROSTER_FILE.exists():
        df = read_roster(ROSTER_FILE)
    else:
        from vihitha.loaders import load_sample_roster
        df = load_sample_roster(config.DATA_DIR)
    return Inputs(roster=roster_mod.normalise(df), calendar=context.calendar(s), ref=context.reference())


def scoring(start: date | None = None, end: date | None = None, source: str = "simulated") -> dict:
    source = (source or "simulated").lower()
    if source not in ("simulated", "actual"):
        raise ValidationFailed("source must be actual or simulated")
    with session_scope() as s:
        context.require_roster(s)
        rs = settings_repo.get(s, "roster_start")
        start = start or (date.fromisoformat(rs) if rs else config.DEMO_TODAY)
        end = end or config.FORECAST_HORIZON_END
        seed = context.seed(s)
        if source == "simulated":
            rules, row = context.active_rules(s)
            key = hashlib.sha1(json.dumps([rules.to_dict(), sorted(str(d) for d in context.calendar(s).leave),
                                           str(start), str(end), seed, context.horizon_working_days(s)],
                                          default=str).encode()).hexdigest()
            if key not in _CACHE:
                inp = _roster_inputs(s)
                from vihitha.cli import score
                _, m = score(inp, rules, start, end, seed, 1, context.horizon_working_days(s))
                _CACHE[key] = m
            m = _CACHE[key]
            return {"source": "simulated", "from": start.isoformat(), "to": end.isoformat(),
                    "ruleset": row.name if row else None,
                    "note": "Fresh run from the roster with the active rules vs the case-study baseline "
                            "(same seed as `vihitha run`).",
                    "metrics": _metric_list(m)}
        # actual: recorded outcomes on closed days
        closed = sorted(d for d, r in days_repo.in_range(s, start, end).items() if r.status == "CLOSED")
        recs = []
        case_rows = {c.id: c for c in cases_repo.all_(s)}
        from vihitha.windows import hhmm_to_min
        for h in hearings_repo.done(s, start, end):
            if h.date not in closed:
                continue
            c = case_rows[h.case_id]
            reached = h.result != "NOT_REACHED"
            mins = (hhmm_to_min(h.actual_end) - hhmm_to_min(h.actual_start)) if (reached and h.actual_start and h.actual_end) else 0
            o = Outcome(reached=reached, substantive=h.result in ("MOVED_FORWARD",) or (h.result == "DISPOSED"),
                        reason_group=ReasonGroup(h.reason_group) if h.reason_group else None, duration=max(0, mins))
            recs.append(HearingRecord(
                date=h.date, case_id=h.case_id, case_number=c.case_number, advocate_id=c.advocate_id,
                party_id=c.party_id, purpose=HearingType(h.hearing_type), age_years=0, block_id=h.block_id,
                window_start=h.window_start, window_end=h.window_end, est_start=h.est_start, est_end=h.est_end,
                expected_minutes=h.expected_minutes, p_substantive=h.p_substantive, reason=h.reason,
                carried_forward=h.carried_forward, first_promised_date=h.first_promised_date, outcome=o,
                next_date_gap_ok=h.next_date_gap_ok))
        ages = {c.id: (start - c.filing_date).days / 365.25 for c in case_rows.values()
                if not (c.disposed_on and c.disposed_on < start)}
        disposed = {c.id: c.disposal_type for c in case_rows.values() if c.disposed_on and start <= c.disposed_on <= end}
        m = off.compute(recs, len(closed), 420, ages, disposed)
        wrapped = off.with_baseline({k: {"value": m[k], "range": None} for k in off.HEADLINE} | {"extras": m["extras"]}, None)
        return {"source": "actual", "from": start.isoformat(), "to": end.isoformat(), "closed_days": len(closed),
                "note": "Recorded outcomes on closed days only.", "metrics": _metric_list(wrapped)}
