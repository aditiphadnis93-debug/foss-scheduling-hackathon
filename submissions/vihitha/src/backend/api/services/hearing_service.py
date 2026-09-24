"""Hearing edits with impact preview, outcomes and next dates (spec v3 7.4-7.5)."""
from __future__ import annotations

from datetime import date, timedelta

from sqlalchemy.orm import Session

from vihitha import day_runner
from vihitha import kpis as kpi_mod
from vihitha.calendar import fmt_day
from vihitha.enums import HearingType
from vihitha.estimates import expected_minutes
from vihitha.models import Outcome
from vihitha.planner import commit
from vihitha.simulate import SimState, outcome_from_result, simulate_state
from vihitha.state import case_from_row, case_to_row
from vihitha.windows import PackItem, hhmm_to_min, pack_day

from ..db import session_scope
from ..errors import Conflict, NotFound, ValidationFailed
from ..repositories import cases as cases_repo
from ..repositories import days as days_repo
from ..repositories import hearings as hearings_repo
from . import context, views

RESULTS = {"MOVED_FORWARD", "ADJOURNED", "NOT_REACHED", "DISPOSED"}
REASON_GROUPS = {"ABSENCE", "PREP", "PROCESS", "COURT", "UNCLEAR"}
DISPOSAL_TYPES = {"CONVICTION", "ACQUITTAL", "JUDGEMENT", "SETTLED", "WITHDRAWN", "DISMISSED"}
PREVIEW_DAYS = 30


# ------------------------------------------------------------ helpers

def _hearing(s: Session, hid: int):
    h = hearings_repo.get(s, hid)
    if h is None:
        raise NotFound(f"Hearing {hid} not found")
    return h


def _case(s: Session, cid: str):
    c = cases_repo.get(s, cid)
    if c is None:
        raise NotFound(f"Case {cid} not found")
    return c


def _check_day(s: Session, d: date) -> str:
    """Validate a target date; returns the status new hearings on it get."""
    cal = context.calendar(s)
    if not cal.is_working(d):
        name = cal.holiday_names.get(d) or ("judge's leave" if d in cal.leave else "not a sitting day")
        raise ValidationFailed(f"{d.isoformat()} is not a sitting day ({name})")
    row = days_repo.get(s, d)
    if row is not None and row.status == "CLOSED":
        raise Conflict(f"{d.isoformat()} is closed")
    if d < context.today(s):
        raise ValidationFailed(f"{d.isoformat()} is in the past")
    return "PUBLISHED" if (row is not None and row.status == "PUBLISHED") else "DRAFT"


def _repack(s: Session, *dates: date) -> None:
    from . import schedule_service
    rules = context.active_rules(s)[0]
    for d in {d for d in dates if d is not None}:
        schedule_service.repack_day(s, d, rules)


def _replan(s: Session) -> None:
    """Soft (tentative) listings move around every court order and judge edit."""
    from . import schedule_service
    s.flush()
    schedule_service.replan(s)


def _totals(s: Session, d: date) -> dict:
    row = days_repo.get(s, d)
    hs = [h for h in hearings_repo.on_date(s, d) if h.status != "CANCELLED"]
    case_rows = {h.case_id: cases_repo.get(s, h.case_id) for h in hs}
    return views.day_totals(d, hs, row.status if row else None, 420.0, d, case_rows)


def create_listing(s: Session, case_row, d: date, *, origin: str, reason: str, minutes: float | None = None,
                   first_promised: date | None = None, carried: bool = False, window_start: str | None = None,
                   pinned: bool = False, view=None, repack: bool = True):
    """Insert a new DRAFT/PUBLISHED hearing for a case (status follows the day)."""
    status = _check_day(s, d) if origin != "CARRY_FORWARD" else _status_for(s, d)
    days_repo.ensure(s, d, None)
    rules = context.active_rules(s)[0]
    c = case_from_row(case_row)
    m, p = expected_minutes(c, c.next_purpose, d, rules, context.reference())
    h = hearings_repo.add(
        s, case_id=case_row.id, date=d, hearing_type=case_row.next_purpose, status=status,
        expected_minutes=minutes if minutes is not None else m, p_substantive=p,
        duration_min=context.reference().duration(c.next_purpose), reason=reason,
        first_promised_date=first_promised or d, origin=origin, carried_forward=carried,
        pinned=pinned, fixed_window=bool(window_start), window_start=window_start or "",
    )
    if view is not None:
        view.sched.book.commit(case_row.id, d, h.expected_minutes, c.age_years(d) >= 4, c.advocate_id)
        view.active_by_case[case_row.id] = h
    if repack:
        _repack(s, d)
    return h


def _status_for(s: Session, d: date) -> str:
    row = days_repo.get(s, d)
    return "PUBLISHED" if (row is not None and row.status == "PUBLISHED") else "DRAFT"


def _cancel_active(s: Session, case_id: str, except_id: int | None = None) -> list[date]:
    dates = []
    for h in hearings_repo.active_for_case(s, case_id):
        if h.id == except_id:
            continue
        dates.append(h.date)
        if h.status == "DRAFT" and h.origin == "PLANNER":
            s.delete(h)
        else:
            h.status = "CANCELLED"
    s.flush()
    return dates


def _suggestion_payload(s: Session, view, c, d: date, s_obj, hearing_id: int | None) -> dict:
    """NextDateSuggestion with the window the case would land in and a 42-day load heatmap."""
    cal = view.sched.calendar
    ws, we = _predict_window(s, s_obj.date, c)
    heat = []
    for i in range(42):
        x = d + timedelta(days=i + 1)
        heat.append({"date": x.isoformat(), "sitting": cal.is_working(x),
                     # firm load: tentative listings make way for a court's next date
                     "load_pct": round(100 * (view.sched.book.minutes.get(x, 0.0)
                                              - view.sched.book.soft_minutes.get(x, 0.0)) / 420.0, 1)})
    return {
        "hearing_id": hearing_id, "case_id": c.filing_number, "next_purpose": c.next_purpose.value,
        "suggested": {"date": s_obj.date.isoformat(), "window_start": ws, "window_end": we,
                      "reason": f"Suggested because: {s_obj.reason[:1].lower() + s_obj.reason[1:]}"},
        "alternatives": [{"date": a["date"].isoformat(), "reason": a["reason"]} for a in s_obj.alternatives],
        "window": {k: v.isoformat() for k, v in s_obj.window.items()},
        "vs_flat_default_days": s_obj.vs_flat_default_days,
        "heatmap": heat,
    }


def _predict_window(s: Session, d: date, c) -> tuple[str | None, str | None]:
    """Where a new listing for `c` would be packed on `d` (without saving)."""
    rules = context.active_rules(s)[0]
    ref = context.reference()
    row = days_repo.get(s, d)
    published = row is not None and row.status == "PUBLISHED"
    items = []
    for h in hearings_repo.on_date(s, d, hearings_repo.ACTIVE):
        if h.case_id == c.filing_number or (h.origin == "PLANNER" and not h.pinned and h.status == "DRAFT"):
            continue  # tentative listings make way for court orders
        locked = h.window_start if (h.window_start and (published or h.fixed_window)) else None
        items.append(PackItem(str(h.id), h.hearing_type, 0, "", bool(h.carried_forward), h.score or 0,
                              h.expected_minutes or 0, h.duration_min or 0, h.p_substantive or 0,
                              locked_window=locked, order_hint=h.seq))
    m, p = expected_minutes(c, c.next_purpose, d, rules, ref)
    from vihitha.priority import score as priority_score
    items.append(PackItem("new", c.next_purpose.value, c.age_years(d), c.advocate_id, c.carried_forward,
                          priority_score(c, d, p, rules, context.today(s)).score, m,
                          ref.duration(c.next_purpose), p))
    packed = pack_day(d, items, rules, context.window_minutes(s))
    pl = packed.placements.get("new")
    return (pl.window_start, pl.window_end) if pl else (None, None)


# ------------------------------------------------------------ outcomes

def apply_result(s: Session, h, result: str, reason_group: str | None = None, disposal_type: str | None = None,
                 actual_start: str | None = None, actual_end: str | None = None, note: str | None = None,
                 minutes: int | None = None, view=None) -> dict:
    """Store a result and update the case (lifecycle, counters, learning). Shared with the demo auto-run."""
    if result not in RESULTS:
        raise ValidationFailed(f"result must be one of {sorted(RESULTS)}")
    if result == "ADJOURNED" and reason_group not in REASON_GROUPS:
        raise ValidationFailed(f"An adjournment needs reason_group: one of {sorted(REASON_GROUPS)}")
    if result == "DISPOSED" and disposal_type not in DISPOSAL_TYPES:
        raise ValidationFailed(f"A disposal needs disposal_type: one of {sorted(DISPOSAL_TYPES)}")
    cr = cases_repo.get(s, h.case_id)
    rules = context.active_rules(s)[0]
    ref = context.reference()
    purpose = HearingType(h.hearing_type)
    if minutes is None:
        minutes = int(round(ref.duration(purpose))) if result == "MOVED_FORWARD" else int(rules.adjourn_call_minutes)
    if result != "NOT_REACHED":
        actual_start = actual_start or h.est_start or None
        if actual_start and not actual_end:
            end = hhmm_to_min(actual_start) + minutes
            actual_end = f"{end // 60:02d}:{end % 60:02d}"
    h.result, h.status = result, "DONE"
    h.reason_group = reason_group if result == "ADJOURNED" else None
    h.disposal_type = disposal_type if result == "DISPOSED" else None
    h.actual_start = actual_start if result != "NOT_REACHED" else None
    h.actual_end = actual_end if result != "NOT_REACHED" else None
    if note:
        h.note = note
    cr.forecast_key = None
    if result == "NOT_REACHED":
        return {"needs_next_date": False}

    view = view or context.engine_view(s, rules)
    view.sched.book.uncommit(cr.id)  # this hearing is done; it no longer holds court time
    c = view.cases[cr.id]
    c.scheduled_date = None
    sched = view.sched
    if result == "DISPOSED":
        # Counts as a reached hearing (show-up learning, hearing counts); the disposal itself ends the case.
        c.hearing_counts[purpose] = c.hearing_counts.get(purpose, 0) + 1
        c.last_listed_on = c.last_reached_on = h.date
        c.consecutive_non_substantive = 0
        case_to_row(c, cr)
        cr.status, cr.disposed_on, cr.disposal_type = "DISPOSED", h.date, disposal_type
        for d in _cancel_active(s, cr.id):
            _repack(s, d)
        return {"needs_next_date": False}

    o = outcome_from_result(result, reason_group, minutes)
    day_runner.apply_outcome(c, purpose, o, h.date, sched)
    case_to_row(c, cr)
    if c.disposed:  # judgement delivered
        cr.status, cr.disposed_on, cr.disposal_type = "DISPOSED", h.date, "JUDGEMENT"
        h.result, h.disposal_type = "DISPOSED", "JUDGEMENT"
        for d in _cancel_active(s, cr.id):
            _repack(s, d)
        return {"needs_next_date": False}
    return {"needs_next_date": True}


def confirm_next(s: Session, h, d: date | None, window_start: str | None, repack: bool = True, view=None):
    """Create the case's next hearing after `h` (origin NEXT_DATE)."""
    cr = cases_repo.get(s, h.case_id)
    if cr.status != "PENDING":
        raise Conflict("The case is disposed; it gets no more hearings")
    if h.status != "DONE" or h.result not in ("MOVED_FORWARD", "ADJOURNED"):
        raise Conflict("Record a Moved forward or Adjourned outcome before setting the next date")
    moved = _cancel_active(s, cr.id)
    if view is None:
        view = context.engine_view(s)
    else:  # shared view (demo auto-run): drop the cancelled listing from its load book
        view.sched.book.uncommit(cr.id)
        view.cases[cr.id].scheduled_date = None
    c = view.cases[cr.id]
    sug = day_runner.next_date(c, h.date, view.sched)
    if d is None:
        d, reason = sug.date, f"Suggested because: {sug.reason[:1].lower() + sug.reason[1:]}"
    else:
        if d <= h.date:
            raise ValidationFailed("The next date must be after the hearing date")
        reason = f"Set by the judge: {fmt_day(d)}"
    h.next_date_gap_ok = day_runner.gap_ok(c, h.date, d, view.sched)
    nh = create_listing(s, cr, d, origin="NEXT_DATE", reason=reason, window_start=window_start,
                        pinned=bool(window_start), view=view, repack=repack)
    if repack:
        for md in moved:
            _repack(s, md)
    return nh


# ------------------------------------------------------------ public service functions

def record_outcome(hid: int, body: dict) -> dict:
    with context.LOCK, session_scope() as s:
        h = _hearing(s, hid)
        day = days_repo.get(s, h.date)
        if h.status == "DONE":
            raise Conflict("An outcome is already recorded for this hearing")
        if h.status != "PUBLISHED" or day is None or day.status != "PUBLISHED":
            raise Conflict("Outcomes can only be recorded on a published day")
        res = apply_result(s, h, body["result"], body.get("reason_group"), body.get("disposal_type"),
                           body.get("actual_start"), body.get("actual_end"), body.get("note"))
        s.flush()
        cr = cases_repo.get(s, h.case_id)
        t = context.today(s)
        suggestion = None
        if res["needs_next_date"]:
            view = context.engine_view(s)
            c = view.cases[cr.id]
            suggestion = _suggestion_payload(s, view, c, h.date, day_runner.next_date(c, h.date, view.sched), h.id)
        _replan(s)
        context.bump()
        nxt = next(iter(hearings_repo.active_for_case(s, cr.id)), None)
        return {"hearing": views.hearing_event(h, cr, t), "case": views.case_summary(cr, t, nxt),
                "next_date": suggestion, "day_totals": _totals(s, h.date)}


def suggest_next_date(hid: int) -> dict:
    with session_scope() as s:
        h = _hearing(s, hid)
        cr = cases_repo.get(s, h.case_id)
        if cr.status != "PENDING":
            raise Conflict("The case is disposed")
        view = context.engine_view(s, exclude_hearing_ids={x.id for x in hearings_repo.active_for_case(s, cr.id)})
        c = view.cases[cr.id]
        c.scheduled_date = None
        return _suggestion_payload(s, view, c, h.date, day_runner.next_date(c, h.date, view.sched), h.id)


def confirm_next_date(hid: int, body: dict) -> dict:
    with context.LOCK, session_scope() as s:
        h = _hearing(s, hid)
        d = body.get("date")
        if body.get("accept_suggestion") or d is None:
            d = None
        nh = confirm_next(s, h, d, body.get("window_start"))
        s.flush()
        _replan(s)
        context.bump()
        return {"next_hearing": views.hearing_event(nh, cases_repo.get(s, nh.case_id), context.today(s))}


def add(body: dict) -> dict:
    with context.LOCK, session_scope() as s:
        cr = _case(s, body["case_id"])
        if cr.status != "PENDING":
            raise Conflict("The case is disposed")
        from .schedule_service import is_soft
        existing = hearings_repo.active_for_case(s, cr.id)
        firm = [h for h in existing if not is_soft(h)]
        if firm:
            raise Conflict(f"{cr.case_number} is already listed on {firm[0].date.isoformat()}; move that hearing instead",
                           {"hearing_id": firm[0].id})
        d = body["date"]
        _cancel_active(s, cr.id)  # its tentative listing is replaced by the judge's date
        h = create_listing(s, cr, d, origin="JUDGE", reason="Added by the judge",
                           window_start=body.get("window_start"), pinned=True)
        s.flush()
        _replan(s)
        context.bump()
        return {"hearing": views.hearing_event(h, cr, context.today(s)), "day_totals": _totals(s, d)}


def move(hid: int, body: dict) -> dict:
    with context.LOCK, session_scope() as s:
        h = _hearing(s, hid)
        if h.status not in hearings_repo.ACTIVE:
            raise Conflict("Only a planned or published hearing can be changed")
        to_date, to_window = body.get("to_date"), body.get("to_window_start")
        if h.status == "PUBLISHED" and (to_date or to_window) and not body.get("force"):
            raise Conflict("This hearing is published (promised to the parties). Confirm with force=true to change it.")
        old = h.date
        if body.get("pinned") is not None:
            h.pinned = bool(body["pinned"])
        if to_date and to_date != h.date:
            status = _check_day(s, to_date)
            days_repo.ensure(s, to_date, None)
            if h.status == "DRAFT":
                h.first_promised_date = to_date
            h.date, h.status = to_date, status
            h.origin, h.pinned = "JUDGE", True
            h.reason = f"Moved by the judge from {fmt_day(old)}"
            h.window_start, h.fixed_window = "", False
        if to_window:
            h.window_start, h.fixed_window, h.pinned = to_window, True, True
            if not to_date:
                h.origin = "JUDGE"
        s.flush()
        _repack(s, old, h.date)
        _replan(s)
        context.bump()
        t = context.today(s)
        return {"hearing": views.hearing_event(h, cases_repo.get(s, h.case_id), t),
                "affected_days": [_totals(s, d) for d in sorted({old, h.date})]}


def remove(hid: int, force: bool = False) -> dict:
    with context.LOCK, session_scope() as s:
        h = _hearing(s, hid)
        if h.status not in hearings_repo.ACTIVE:
            raise Conflict("Only a planned or published hearing can be removed")
        if h.status == "PUBLISHED" and not force:
            raise Conflict("This hearing is published (promised to the parties). Confirm with force=true to remove it.")
        d = h.date
        h.status, h.note = "CANCELLED", "Removed by the judge"
        s.flush()
        _repack(s, d)
        cr = cases_repo.get(s, h.case_id)
        view = context.engine_view(s)
        c = view.cases[cr.id]
        m, _ = expected_minutes(c, c.next_purpose, d + timedelta(days=1), view.sched.rules, view.sched.ref)
        view.sched.firm_only = True
        sug = view.sched.suggest(c, d + timedelta(days=1), m, today=context.today(s), target_gap=0,
                                 label=f"Removed from {fmt_day(d)} by the judge; next day with room")
        _replan(s)
        context.bump()
        return {"case": views.case_summary(cr, context.today(s)),
                "suggestion": _suggestion_payload(s, view, c, d, sug, None)}


# ------------------------------------------------------------ preview

def _kpi_values(sim, old_cohort: set[str]) -> dict:
    rows = kpi_mod.rows_from_records([r for day in sim.days for r in day.records])
    return kpi_mod.compute(rows, len(sim.sitting_days), old_cohort)


def _apply_to_view(view, change: dict, s: Session) -> tuple[list[date], list[dict]]:
    """Apply a change to an engine snapshot. Returns affected dates and guardrail warnings."""
    typ = change["type"]
    rules, ref, book = view.sched.rules, view.sched.ref, view.sched.book
    warnings = []
    affected = []
    if typ == "PIN":
        h = _hearing(s, change["hearing_id"])
        return [h.date], warnings
    if typ == "ADD":
        cid = change.get("case_id")
        if not cid or cid not in view.cases:
            raise NotFound(f"Case {cid} not found")
        c = view.cases[cid]
        d = change.get("to_date")
        if d is None:
            raise ValidationFailed("ADD needs to_date")
        _check_day(s, d)
        if c.scheduled_date:
            affected.append(c.scheduled_date)
        m, _ = expected_minutes(c, c.next_purpose, d, rules, ref)
        commit(view.sched, c, d, m, view.today, first=True)
        affected.append(d)
        return affected, warnings
    h = _hearing(s, change["hearing_id"])
    c = view.cases[h.case_id]
    if typ == "REMOVE":
        book.uncommit(c.filing_number)
        c.scheduled_date = None
        affected.append(h.date)
    elif typ == "MOVE":
        d = change.get("to_date") or h.date
        if d != h.date:
            _check_day(s, d)
        m, _ = expected_minutes(c, c.next_purpose, d, rules, ref)
        keep_first = h.status == "PUBLISHED"
        first = c.first_scheduled_date
        commit(view.sched, c, d, m, view.today, first=not keep_first)
        if keep_first:
            c.first_scheduled_date = first
        affected += [h.date, d]
    else:
        raise ValidationFailed("change.type must be ADD, MOVE, REMOVE or PIN")
    if c.age_years(view.today) >= 4 and rules.max_wait_days_4y:
        last = c.last_reached_on or c.last_listed_on or view.today
        new_date = c.scheduled_date
        limit = last + timedelta(days=rules.max_wait_days_4y)
        if new_date is None or new_date > limit:
            warnings.append({"field": "max_wait_days_4y", "requested": (new_date or view.today).isoformat(),
                             "applied": limit.isoformat(),
                             "message": f"{c.case_number} is {c.age_years(view.today):.1f} years old and would wait "
                                        f"past its {rules.max_wait_days_4y}-day limit ({fmt_day(limit)})."})
    return affected, warnings


def preview(change: dict) -> dict:
    with session_scope() as s:
        context.require_roster(s)
        rules = context.active_rules(s)[0]
        cal = context.calendar(s)
        t = context.today(s)
        before_view = context.engine_view(s, rules, cal)
        after_view = context.engine_view(s, rules, cal)
        affected, warnings = _apply_to_view(after_view, change, s)
        days = []
        for d in sorted(set(affected)):
            b = 100 * before_view.sched.book.minutes.get(d, 0.0) / 420.0
            a = 100 * after_view.sched.book.minutes.get(d, 0.0) / 420.0
            days.append({"date": d.isoformat(), "load_pct_before": round(b, 1), "load_pct_after": round(a, 1)})
            if a > 100 * (rules.fill_target or 1.0) + 0.5 and a > b:
                warnings.append({"field": "capacity", "requested": round(a, 1), "applied": round(b, 1),
                                 "message": f"{fmt_day(d)} would be over its planned court time ({a:.0f}%)."})
        end = t + timedelta(days=PREVIEW_DAYS)
        seed = context.seed(s)
        kw = dict(horizon_working_days=context.horizon_working_days(s), window_minutes=context.window_minutes(s),
                  horizon_start=t)
        old = {fn for fn, c in before_view.cases.items() if not c.disposed and c.age_years(t) >= 4}
        sim_b = simulate_state(SimState(before_view.cases, before_view.sched), t, end, seed, **kw)
        sim_a = simulate_state(SimState(after_view.cases, after_view.sched), t, end, seed, **kw)
        kb, ka = _kpi_values(sim_b, old), _kpi_values(sim_a, old)
        kpi_deltas = kpi_mod.as_list(ka, kb, is_forecast=True)
        parts = [f"Day load {d['load_pct_before']:.0f}% → {d['load_pct_after']:.0f}% on {fmt_day(date.fromisoformat(d['date']))}"
                 for d in days if abs(d["load_pct_after"] - d["load_pct_before"]) >= 0.5]
        for k in kpi_deltas:
            if k["delta"] and abs(k["delta"]) >= 0.1:
                unit = "" if k["unit"] == "per week" else " pts"
                parts.append(f"{k['label']} {k['delta']:+.1f}{unit} over {PREVIEW_DAYS} days")
        parts += [w["message"] for w in warnings if w["field"] == "max_wait_days_4y"]
        message = "; ".join(parts) if parts else "No measurable effect over the next 30 days."
        return {"kpi_deltas": kpi_deltas, "days": days, "warnings": warnings, "message": message}
