"""The real schedule: plan, pack, calendar views, publish, close day, demo auto-run (spec v3 7.2-7.6)."""
from __future__ import annotations

import calendar as pycal
from datetime import date, datetime, timedelta

from sqlalchemy.orm import Session

from vihitha import day_runner
from vihitha.enums import HearingType
from vihitha.estimates import expected_minutes
from vihitha.planner import assign_pool, earliest_for
from vihitha.priority import score as priority_score
from vihitha.rules import Rules
from vihitha.models import Outcome
from vihitha.state import case_from_row, case_to_row
from vihitha.windows import PackItem, block_bounds, block_windows, day_blocks, hhmm_to_min, pack_day, to_wall

from ..clock import utcnow
from ..db import session_scope
from ..errors import Conflict, ValidationFailed
from ..repositories import cases as cases_repo
from ..repositories import days as days_repo
from ..repositories import hearings as hearings_repo
from ..repositories import settings as settings_repo
from . import context, views

CAPACITY = 420.0


# ------------------------------------------------------------ packing

def repack_day(s: Session, d: date, rules: Rules | None = None, case_rows: dict | None = None,
               rows: list | None = None, *, today: date | None = None, window_minutes: int | None = None,
               published: bool | None = None) -> None:
    """Re-pack one day's DRAFT/PUBLISHED hearings into windows and store the times.

    On a PUBLISHED day, hearings that already have a window keep it (promised to parties);
    only new ones are fitted in. On a DRAFT day only judge-fixed windows are kept.
    """
    rules = rules or context.active_rules(s)[0]
    ref = context.reference()
    rows = rows if rows is not None else hearings_repo.on_date(s, d, hearings_repo.ACTIVE)
    if not rows:
        return
    if published is None:
        day = days_repo.get(s, d)
        published = day is not None and day.status == "PUBLISHED"
    t = today or context.today(s)
    items = []
    for i, h in enumerate(rows):
        cr = case_rows.get(h.case_id) if case_rows else cases_repo.get(s, h.case_id)
        c = case_from_row(cr)
        purpose = HearingType(h.hearing_type)
        m, p = expected_minutes(c, purpose, d, rules, ref)
        pr = priority_score(c, d, p, rules, t)
        locked = None
        if (published and h.window_start) or (h.fixed_window and h.window_start):
            locked = h.window_start
        items.append(PackItem(
            key=str(h.id), purpose=h.hearing_type, age_years=c.age_years(d), advocate_id=c.advocate_id,
            carried_forward=bool(h.carried_forward), score=pr.score + (1.0 if h.pinned else 0.0),
            expected_minutes=m, duration_min=ref.duration(purpose), p_substantive=p,
            locked_window=locked, order_hint=h.seq if h.seq else 10_000 + i,
        ))
        h.score = pr.score
        if not h.reason:
            h.reason = f"Suggested because: {pr.reason[:1].lower() + pr.reason[1:]}"
    packed = pack_day(d, items, rules, window_minutes or context.window_minutes(s))
    by_id = {str(h.id): h for h in rows}
    for key, pl in packed.placements.items():
        h = by_id[key]
        h.block_id, h.window_start, h.window_end = pl.block_id, pl.window_start, pl.window_end
        h.est_start, h.est_end, h.seq = pl.est_start, pl.est_end, pl.seq
        h.expected_minutes, h.duration_min, h.p_substantive = pl.expected_minutes, pl.duration_min, pl.p_substantive


# ------------------------------------------------------------ plan

MAX_PLAN_DAYS = 730  # calendar days searched when giving every case a tentative date


def is_soft(h) -> bool:
    """The planner's own placement: re-planned after every change; court orders take its place."""
    return h.origin == "PLANNER" and not h.pinned and h.status == "DRAFT"


def _plan(s: Session, start: date | None = None, end: date | None = None, force: bool = False) -> dict:
    """Give every pending case a date (v3.1).

    Firm listings (published days, next dates, carry-forwards, judge edits, pinned) stay put.
    The planner's soft listings are re-planned around them, fill-first and mixed by hearing
    group. Days inside the draft horizon are DRAFT; later ones are TENTATIVE. A case keeps
    its hearing row (and id) when it is re-planned, so links and open panels stay valid.
    """
    context.require_roster(s)
    rules, rs_row = context.active_rules(s)
    cal = context.calendar(s)
    t, h_end = context.horizon(s, cal)
    start = max(start or t, t)
    end = end or (t + timedelta(days=MAX_PLAN_DAYS))
    if end < start:
        raise ValidationFailed("'to' must be on or after 'from'")
    day_rows = days_repo.in_range(s, start, end)
    targets = []
    for d in cal.working_days(start, end):
        row = day_rows.get(d)
        if row is None or row.status in ("DRAFT", "TENTATIVE") or (force and row.status == "PUBLISHED"):
            targets.append(d)
            if force and row is not None and row.status == "PUBLISHED":
                row.status = "DRAFT"
                for h in hearings_repo.on_date(s, d, ("PUBLISHED",)):
                    h.status = "DRAFT"
    target_set = set(targets)

    # 1. Release the soft listings on changeable days (rows kept to reuse their ids).
    soft_rows = {h.case_id: h for h in hearings_repo.in_range(s, start, end, hearings_repo.ACTIVE)
                 if h.date in target_set and is_soft(h)}
    view = context.engine_view(s, rules, cal, exclude_hearing_ids={h.id for h in soft_rows.values()})
    pool = [c for c in view.cases.values() if not c.disposed and c.scheduled_date is None]
    avoid: dict[str, set] = {}
    for h in hearings_repo.in_range(s, start, end, ("CANCELLED",)):
        if h.note == "Removed by the judge":
            avoid.setdefault(h.case_id, set()).add(h.date)
    assigned, left = assign_pool(pool, targets, view.sched, today=t, seed=context.seed(s), horizon_start=t,
                                 avoid=avoid)

    ref = context.reference()
    for a in assigned:
        c = view.cases[a.case_id]
        fields = dict(date=a.date, hearing_type=c.next_purpose.value, expected_minutes=a.expected_minutes,
                      p_substantive=a.p_substantive, score=a.score, duration_min=ref.duration(c.next_purpose),
                      reason=f"Suggested because: {a.reason[:1].lower() + a.reason[1:]}",
                      carried_forward=c.carried_forward, first_promised_date=a.date)
        row = soft_rows.pop(a.case_id, None)
        if row is None:
            hearings_repo.add(s, case_id=a.case_id, status="DRAFT", origin="PLANNER", **fields)
        else:
            for k, v in fields.items():
                setattr(row, k, v)
    for row in soft_rows.values():  # case no longer needs this listing (disposed / firm date / not eligible)
        s.delete(row)
    s.flush()

    # 2. Day statuses and tentative flags.
    active = hearings_repo.active_from(s, start)
    dates_with = {h.date for h in active}
    last_date = max(dates_with) if dates_with else t
    for d in targets:
        row = day_rows.get(d) or days_repo.get(s, d)
        if d > h_end and d not in dates_with:
            if row is not None and row.status in ("DRAFT", "TENTATIVE"):
                s.delete(row)
            continue
        row = row or days_repo.ensure(s, d, None)
        row.status = "DRAFT" if d <= h_end else "TENTATIVE"
        row.ruleset_id = rs_row.id if rs_row else None
    for h in active:
        h.tentative = is_soft(h) and h.date > h_end
    s.flush()

    # 3. Pack every changeable day that has hearings.
    case_rows = {r.id: r for r in cases_repo.all_(s)}
    by_date: dict[date, list] = {}
    for h in active:
        by_date.setdefault(h.date, []).append(h)
    wm = context.window_minutes(s)
    with s.no_autoflush:
        for d in targets:
            if d in by_date:
                repack_day(s, d, rules, case_rows, sorted(by_date[d], key=lambda h: (h.seq, h.id)),
                           today=t, window_minutes=wm, published=False)
    context.bump()
    warnings = []
    if rs_row is not None:
        _, warnings = context.rules_of(rs_row)
    return {"from": start.isoformat(), "to": last_date.isoformat(),
            "days_planned": sum(1 for d in targets if d in dates_with or d <= h_end),
            "hearings_created": len(assigned), "unscheduled_count": len(left), "warnings": warnings,
            "tentative_days": sum(1 for d in targets if d > h_end and d in dates_with),
            "last_date": last_date.isoformat(), "draft_until": h_end.isoformat(),
            "firm_hearings": sum(1 for h in active if not is_soft(h)),
            "pending_cases": sum(1 for c in view.cases.values() if not c.disposed)}


def replan(s: Session) -> dict:
    """Re-plan the soft listings after any change (every mutating service calls this)."""
    return _plan(s)


def plan_range(start: date | None = None, end: date | None = None, force: bool = False) -> dict:
    with context.LOCK, session_scope() as s:
        return _plan(s, start, end, force)


# ------------------------------------------------------------ views

def _windows_for_day(hearings: list) -> list[dict]:
    """v3.1: one slot per hearing, in calling order."""
    out = []
    for h in sorted(hearings, key=lambda h: (h.seq or 0, h.window_start or "99")):
        if not h.window_start:
            continue
        start, end = hhmm_to_min(h.window_start), hhmm_to_min(h.window_end or h.window_start)
        out.append({"start": h.window_start, "end": h.window_end or h.window_start, "block_id": h.block_id,
                    "hearing_ids": [h.id], "expected_minutes": round(h.expected_minutes or 0, 1),
                    "capacity_minutes": float(max(end - start, 1))})
    return out


def _rules_for_day(s: Session, day_row) -> tuple[Rules, object]:
    if day_row is not None and day_row.ruleset_id:
        from ..repositories import rulesets as rulesets_repo
        rs = rulesets_repo.get(s, day_row.ruleset_id)
        if rs is not None:
            return context.rules_of(rs)[0], rs
    return context.active_rules(s)


def _held_back(s: Session, d: date, case_rows: dict, active_case_ids: set[str], limit: int = 30) -> list[dict]:
    out = []
    for c in case_rows.values():
        if c.status != "PENDING" or c.id in active_case_ids:
            continue
        if c.pending_until and c.pending_until > d:
            out.append({"case_id": c.id, "case_number": c.case_number, "hearing_type": c.next_purpose,
                        "reason": c.pending_reason or "Awaiting prerequisite",
                        "eligible_from": c.pending_until.isoformat()})
    out.sort(key=lambda x: (x["eligible_from"], x["case_id"]))
    return out[:limit]


IDLE_NOTE_PCT = 10.0  # explain unused time when more than this share of the day is free


def _idle_reason(d: date, totals: dict, case_rows: dict, active_case_ids: set[str]) -> str | None:
    """Why part of a planned day is empty: the judge should see that no eligible case was left out."""
    if totals["unused_minutes"] < totals["capacity_minutes"] * IDLE_NOTE_PCT / 100:
        return None
    ref = context.reference()
    waiting = process = not_due = 0
    for c in case_rows.values():
        if c.status != "PENDING" or c.id in active_case_ids:
            continue
        if c.pending_until and c.pending_until > d:
            process += 1
        elif c.last_reached_on and c.last_reached_on + timedelta(days=ref.gap(HearingType(c.next_purpose))) > d:
            not_due += 1
        else:
            waiting += 1
    free = f"{totals['unused_minutes']:.0f} of {totals['capacity_minutes']:.0f} minutes are free"
    if waiting:
        return (f"{free}. {waiting} eligible cases are not listed yet; re-plan to fill the day "
                f"(published days are only changed by hand).")
    parts = []
    if process:
        parts.append(f"{process} are waiting on summons, warrant or reports")
    if not_due:
        parts.append(f"{not_due} are not due for their next hearing yet")
    tail = f": every pending case already has a date, or {' and '.join(parts)}" if parts         else ": every pending case already has a hearing date"
    return f"{free}. No eligible case is left to list{tail}."


def day_view_data(s: Session, d: date) -> dict:
    cal = context.calendar(s)
    t = context.today(s)
    row = days_repo.get(s, d)
    rules, rs = _rules_for_day(s, row)
    hearings = [h for h in hearings_repo.on_date(s, d) if h.status != "CANCELLED"]
    case_rows = cases_repo.by_ids(s, [h.case_id for h in hearings])
    events = [views.hearing_event(h, case_rows[h.case_id], t) for h in hearings]
    events.sort(key=lambda e: (e["window_start"] or "99", e["est_start"] or "99"))
    status = row.status if row else None
    # Only cases without any date can be held back or explain idle time (normally a handful).
    undated = {r.id: r for r in cases_repo.pending_without_hearing(s)}
    active_ids: set[str] = set()
    sitting = cal.is_working(d)
    totals = views.day_totals(d, hearings, status, CAPACITY, d, case_rows)
    idle = _idle_reason(d, totals, undated, active_ids) if (sitting and status != "CLOSED" and d >= t) else None
    return {
        "date": d.isoformat(), "status": status, "sitting": sitting,
        "holiday_name": cal.holiday_names.get(d), "leave": d in cal.leave, "leave_note": cal.leave.get(d),
        "day_start": rules.day.start, "day_end": rules.day.end, "lunch": [rules.day.lunch_start, rules.day.lunch_end],
        "blocks": block_bounds(rules), "windows": _windows_for_day(hearings) if sitting else [],
        "hearings": events,
        "totals": totals,
        "idle_reason": idle,
        "held_back": _held_back(s, d, undated, active_ids) if (sitting and d >= t and status != "CLOSED") else [],
        "ruleset": {"id": rs.id, "name": rs.name} if rs is not None else None,
    }


def day(d: date) -> dict:
    with session_scope() as s:
        return day_view_data(s, d)


def week(start: date) -> dict:
    monday = start - timedelta(days=start.weekday())
    with session_scope() as s:
        cal = context.calendar(s)
        rows = days_repo.in_range(s, monday, monday + timedelta(days=6))
        hearings = hearings_repo.in_range(s, monday, monday + timedelta(days=6))
        case_rows = cases_repo.by_ids(s, [h.case_id for h in hearings])
        out = []
        for i in range(7):
            d = monday + timedelta(days=i)
            row = rows.get(d)
            rules, _ = _rules_for_day(s, row)
            hs = [h for h in hearings if h.date == d and h.status != "CANCELLED"]
            blocks = []
            for b in block_bounds(rules):
                bh = [h for h in hs if h.block_id == b["id"]]
                cap = max(1, hhmm_to_min(b["end"]) - hhmm_to_min(b["start"])
                          - _lunch_overlap(b, rules))
                blocks.append({**b, "listed": len(bh),
                               "load_pct": round(100 * sum(h.expected_minutes or 0 for h in bh) / cap, 1)})
            out.append({"date": d.isoformat(), "weekday": d.strftime("%a").upper(), "status": row.status if row else None,
                        "sitting": cal.is_working(d), "holiday_name": cal.holiday_names.get(d),
                        "leave": d in cal.leave, "blocks": blocks,
                        "totals": views.day_totals(d, hs, row.status if row else None, CAPACITY, d, case_rows)})
        return {"start": monday.isoformat(), "days": out}


def _lunch_overlap(b: dict, rules: Rules) -> int:
    s, e = hhmm_to_min(b["start"]), hhmm_to_min(b["end"])
    ls, le = hhmm_to_min(rules.day.lunch_start), hhmm_to_min(rules.day.lunch_end)
    return max(0, min(e, le) - max(s, ls))


def month(month_str: str) -> dict:
    try:
        y, m = (int(x) for x in month_str.split("-"))
        first = date(y, m, 1)
    except Exception:
        raise ValidationFailed("month must be YYYY-MM")
    last = date(y, m, pycal.monthrange(y, m)[1])
    with session_scope() as s:
        cal = context.calendar(s)
        rows = days_repo.in_range(s, first, last)
        hearings = hearings_repo.in_range(s, first, last)
        case_rows = cases_repo.by_ids(s, [h.case_id for h in hearings])
        out = []
        d = first
        while d <= last:
            row = rows.get(d)
            hs = [h for h in hearings if h.date == d and h.status != "CANCELLED"]
            tot = views.day_totals(d, hs, row.status if row else None, CAPACITY, d, case_rows)
            out.append({"date": d.isoformat(), "weekday": d.strftime("%a").upper(), "sitting": cal.is_working(d),
                        "holiday_name": cal.holiday_names.get(d), "leave": d in cal.leave,
                        "status": row.status if row else None, "listed": tot["listed"], "load_pct": tot["load_pct"],
                        "old_cases": tot["old_cases"], "moved_forward": tot["moved_forward"]})
            d += timedelta(days=1)
        return {"month": f"{y:04d}-{m:02d}", "days": out}


# ------------------------------------------------------------ publish

def publish(start: date, end: date) -> dict:
    with context.LOCK, session_scope() as s:
        context.require_roster(s)
        days_n = hearings_n = 0
        now = utcnow()
        for d, row in sorted(days_repo.in_range(s, start, end).items()):
            if row.status not in ("DRAFT", "TENTATIVE"):
                continue
            row.status, row.published_at = "PUBLISHED", now
            days_n += 1
            for h in hearings_repo.on_date(s, d, ("DRAFT",)):
                h.status, h.tentative = "PUBLISHED", False
                hearings_n += 1
        context.bump()
        return {"days_published": days_n, "hearings_published": hearings_n}


def unpublish(d: date) -> dict:
    with context.LOCK, session_scope() as s:
        row = days_repo.get(s, d)
        if row is None or row.status != "PUBLISHED":
            raise Conflict(f"{d.isoformat()} is not published")
        if any(h.result for h in hearings_repo.on_date(s, d)):
            raise Conflict("Outcomes are already recorded on this day; it cannot be unpublished")
        row.status, row.published_at = "DRAFT", None
        for h in hearings_repo.on_date(s, d, ("PUBLISHED",)):
            h.status = "DRAFT"
        s.flush()
        _plan(s)
        context.bump()
        return {"date": d.isoformat(), "status": "DRAFT"}


def unscheduled() -> dict:
    with session_scope() as s:
        if not context.roster_loaded(s):
            return {"items": []}
        from . import case_service
        if not cases_repo.pending_without_hearing(s):
            return {"items": []}  # every pending case has a date
        cal = context.calendar(s)
        t, h_end = context.horizon(s, cal)
        view = context.engine_view(s, cal=cal)
        rows = {r.id: r for r in cases_repo.all_(s)}
        pool = [c for c in view.cases.values() if not c.disposed and c.scheduled_date is None]
        case_service.ensure_forecasts(s, [rows[c.filing_number] for c in pool])
        items = []
        for c in pool:
            e = max(earliest_for(c, t, view.sched), t)
            if c.pending_until and c.pending_until > t and view.sched.rules.prerequisite_check:
                reason = f"{c.pending_reason or 'Awaiting prerequisite'} until {c.pending_until.isoformat()}"
            elif e > h_end:
                reason = "Next hearing is due after the planning horizon"
            else:
                reason = "No day with room in the planning horizon"
            items.append({**views.case_summary(rows[c.filing_number], t), "earliest": e.isoformat(), "reason": reason})
        items.sort(key=lambda x: (-x["age_years"], x["case_id"]))
        return {"items": items}


# ------------------------------------------------------------ close day + demo auto-run

def _close(s: Session, d: date) -> dict:
    row = days_repo.get(s, d)
    if row is None or row.status != "PUBLISHED":
        raise Conflict("Only a published day can be closed. Publish it first.")
    t = context.today(s)
    if d > t:
        raise Conflict(f"{d.isoformat()} is in the future; only today or earlier can be closed")
    from . import hearing_service
    for h in hearings_repo.on_date(s, d, hearings_repo.ACTIVE):
        h.result, h.status = "NOT_REACHED", "DONE"
    s.flush()
    rules = context.active_rules(s)[0]
    view = context.engine_view(s, rules)
    carried = 0
    for h in hearings_repo.on_date(s, d, ("DONE",)):
        if h.result != "NOT_REACHED" or h.case_id in view.active_by_case:
            continue
        c = view.cases[h.case_id]
        if c.disposed:
            continue
        cr = cases_repo.get(s, h.case_id)
        day_runner.apply_outcome(c, HearingType(h.hearing_type), Outcome(reached=False), d, view.sched)
        nd, reason, m = day_runner.carry_forward(c, d, view.sched)
        case_to_row(c, cr)
        cr.forecast_key = None
        hearing_service.create_listing(s, cr, nd, origin="CARRY_FORWARD", reason=reason, minutes=m,
                                       first_promised=h.first_promised_date or h.date, carried=True,
                                       view=view, repack=True)
        carried += 1
    row.status, row.closed_at = "CLOSED", utcnow()
    if d >= t:
        cal = context.calendar(s)
        settings_repo.put(s, "today", cal.next_working_day(d + timedelta(days=1)).isoformat())
    s.flush()
    plan = _plan(s)
    context.bump()
    return {"carried_forward": carried, "plan": plan, "today": context.today(s).isoformat()}


def close_day(d: date) -> dict:
    with context.LOCK, session_scope() as s:
        return _close(s, d)


def auto_outcomes(d: date, seed: int | None = None, agents: bool | None = None) -> dict:
    """Demo only: sample outcomes for the day with the engine, confirm next dates, close the day."""
    from . import hearing_service
    with context.LOCK, session_scope() as s:
        context.require_roster(s)
        row = days_repo.get(s, d)
        if row is None:
            raise Conflict(f"Nothing is planned on {d.isoformat()}")
        if row.status == "CLOSED":
            raise Conflict(f"{d.isoformat()} is already closed")
        if d > context.today(s):
            raise Conflict(f"{d.isoformat()} is in the future; move 'today' forward by closing earlier days")
        if row.status == "DRAFT":
            row.status, row.published_at = "PUBLISHED", utcnow()
            for h in hearings_repo.on_date(s, d, ("DRAFT",)):
                h.status = "PUBLISHED"
        s.flush()
        rules = context.active_rules(s)[0].copy()
        if agents is not None:
            rules.agents.enabled = agents
        seed = context.seed(s) if seed is None else seed
        done = [h for h in hearings_repo.on_date(s, d) if h.status == "DONE" and h.result != "NOT_REACHED"]
        start_clock = 0
        for h in done:
            if h.actual_start and h.actual_end:
                start_clock = max(start_clock, day_runner.elapsed(h.actual_end, _Sched(rules)))
        todo = sorted(hearings_repo.on_date(s, d, ("PUBLISHED",)), key=lambda h: (h.est_start or "99", h.seq))
        view = context.engine_view(s, rules)
        items = [day_runner.WalkItem(view.cases[h.case_id], HearingType(h.hearing_type), h.block_id,
                                     h.est_start, h.est_end) for h in todo]
        outs = day_runner.walk(items, d, view.sched, seed, start_clock=start_clock)
        for h, o in zip(todo, outs):
            if not o.reached:
                hearing_service.apply_result(s, h, "NOT_REACHED", view=view)
                continue
            a_start = to_wall(o.actual_start, rules.day)
            a_end = to_wall(o.actual_start + o.duration, rules.day)
            purpose = HearingType(h.hearing_type)
            if o.settled:
                res = hearing_service.apply_result(s, h, "DISPOSED", disposal_type="SETTLED",
                                                   actual_start=a_start, actual_end=a_end, minutes=o.duration, view=view)
            elif o.substantive and purpose == HearingType.JUDGEMENT:
                res = hearing_service.apply_result(s, h, "DISPOSED", disposal_type="JUDGEMENT",
                                                   actual_start=a_start, actual_end=a_end, minutes=o.duration, view=view)
            elif o.substantive:
                res = hearing_service.apply_result(s, h, "MOVED_FORWARD", actual_start=a_start,
                                                   actual_end=a_end, minutes=o.duration, view=view)
            else:
                res = hearing_service.apply_result(s, h, "ADJOURNED", reason_group=o.reason_group.value,
                                                   actual_start=a_start, actual_end=a_end, minutes=o.duration,
                                                   note=o.reason_label, view=view)
            if res.get("needs_next_date"):
                hearing_service.confirm_next(s, h, None, None, repack=False, view=view)
        s.flush()
        # New next dates on published days are fitted in now; draft/tentative days are re-packed by the re-plan in _close.
        published = {x.date for x in hearings_repo.active_from(s, d) if x.status == "PUBLISHED"}
        case_rows = {r.id: r for r in cases_repo.all_(s)}
        for td in published:
            repack_day(s, td, None, case_rows)
        _close(s, d)
        return day_view_data(s, d)


class _Sched:
    """Minimal stand-in exposing `.rules` for clock conversions."""
    def __init__(self, rules: Rules):
        self.rules = rules
