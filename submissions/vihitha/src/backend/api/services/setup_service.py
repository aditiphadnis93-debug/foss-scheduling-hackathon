"""Roster, reference data, calendar and leave, settings, reset (spec v3 8.1)."""
from __future__ import annotations

import io
import json
from datetime import date, timedelta

import pandas as pd

from vihitha import loaders
from vihitha import roster as roster_mod
from vihitha.enums import BUCKETS, REASON_GROUPS, SEQUENTIAL, HearingType, ReasonGroup, age_bucket
from vihitha.rules import PRESET_IDS, preset, validate
from vihitha.simulate import build_cases
from vihitha.state import row_values_from_roster

from .. import config
from ..db import session_scope
from ..errors import Conflict, ValidationFailed
from ..repositories import cases as cases_repo
from ..repositories import days as days_repo
from ..repositories import hearings as hearings_repo
from ..repositories import leave as leave_repo
from ..repositories import rulesets as rulesets_repo
from ..repositories import settings as settings_repo
from . import context, views

ROSTER_FILE = config.STATE_DIR / "roster.csv"
GROUP_LABELS = {
    ReasonGroup.ABSENCE: "Party or advocate absent",
    ReasonGroup.PREP: "Not ready / sought time",
    ReasonGroup.PROCESS: "Awaiting process, summons or report",
    ReasonGroup.COURT: "Court administrative issue",
    ReasonGroup.UNCLEAR: "Unclear",
}


def _wipe(s) -> None:
    hearings_repo.delete_all(s)
    days_repo.delete_all(s)
    cases_repo.delete_all(s)
    leave_repo.delete_all(s)
    settings_repo.delete_all(s)
    s.flush()


def seed_rulesets(s) -> None:
    if rulesets_repo.all_(s):
        return
    for pid in PRESET_IDS:
        r, _ = validate(preset(pid))
        rulesets_repo.add(s, name=r.name, preset=pid, body_json=json.dumps(r.to_dict()), is_active=(pid == "optimal"))


def _read_upload(content: bytes) -> pd.DataFrame:
    try:
        df = pd.read_csv(io.BytesIO(content), dtype={"case_number": str, "filing_number": str})
    except Exception as e:
        raise ValidationFailed(f"Could not read the CSV: {e}")
    missing = loaders.missing_roster_columns(df.columns)
    if missing:
        raise ValidationFailed(f"Roster is missing columns: {', '.join(missing)}", {"missing": missing})
    return df


def _load(s, source: str, n: int | None, seed: int | None, content: bytes | None, reset: bool) -> dict:
    source = (source or "SAMPLE").upper()
    if context.roster_loaded(s) and not reset:
        raise Conflict("A roster and schedule already exist. Send reset=true to replace them.")
    seed = config.SEED if seed is None else int(seed)
    if source == "SAMPLE":
        df = loaders.load_sample_roster(config.DATA_DIR)
    elif source == "GENERATE":
        df = roster_mod.generate(int(n or 3000), seed, loaders.load_sample_roster(config.DATA_DIR))
    elif source == "UPLOAD":
        if not content:
            raise ValidationFailed("UPLOAD needs a CSV file")
        df = _read_upload(content)
    else:
        raise ValidationFailed("source must be SAMPLE, GENERATE or UPLOAD")
    try:
        roster = roster_mod.normalise(df)
    except ValueError as e:
        raise ValidationFailed(str(e))
    _wipe(s)
    seed_rulesets(s)
    today = config.DEMO_TODAY
    settings_repo.put(s, "today", today.isoformat())
    settings_repo.put(s, "roster_start", today.isoformat())
    settings_repo.put(s, "roster_source", source)
    settings_repo.put(s, "seed", seed)
    settings_repo.put(s, "horizon_working_days", config.DEFAULT_HORIZON_WORKING_DAYS)
    settings_repo.put(s, "window_minutes", config.DEFAULT_WINDOW_MINUTES)
    cases = build_cases(roster, context.reference(), today, seed)
    cases_repo.add_many(s, [row_values_from_roster(r, cases[r.filing_number]) for r in roster])
    s.flush()
    config.STATE_DIR.mkdir(parents=True, exist_ok=True)
    df.to_csv(ROSTER_FILE, index=False)
    from . import metrics_service, schedule_service
    metrics_service.clear_caches()
    plan = schedule_service._plan(s)
    return {"roster": _summary(s), "plan": plan}


def load_roster(source: str, n: int | None = None, seed: int | None = None, content: bytes | None = None,
                reset: bool = False) -> dict:
    with context.LOCK, session_scope() as s:
        out = _load(s, source, n, seed, content, reset)
        context.bump()
        return out


def ensure_loaded() -> None:
    """On first start: seed rulesets and load the sample roster so the app has data."""
    with context.LOCK, session_scope() as s:
        seed_rulesets(s)
        if config.AUTOLOAD_SAMPLE and not context.roster_loaded(s):
            _load(s, config.DEFAULT_ROSTER, config.DEFAULT_ROSTER_N, None, None, True)
            context.bump()
        elif context.roster_loaded(s):
            # Re-plan the soft listings on start, so a database from an older planner is brought up to date.
            from . import schedule_service
            schedule_service._plan(s)


def _summary(s) -> dict:
    rows = cases_repo.all_(s)
    t = context.today(s)
    pending = [r for r in rows if r.status == "PENDING"]
    ages = [(t - r.filing_date).days / 365.25 for r in pending]
    by_stage = {h.value: 0 for h in SEQUENTIAL}
    for r in pending:
        by_stage[r.stage] = by_stage.get(r.stage, 0) + 1
    buckets = {b: 0 for b in BUCKETS}
    for a in ages:
        buckets[age_bucket(a)] += 1
    n = len(pending)
    return {
        "cases": len(rows), "pending": n, "disposed": len(rows) - n,
        "advocates": len({r.advocate_id for r in rows}),
        "pct_4y_plus": round(100 * sum(a >= 4 for a in ages) / n, 1) if n else 0.0,
        "pct_5y_plus": round(100 * sum(a >= 5 for a in ages) / n, 1) if n else 0.0,
        "by_stage": [{"stage": k, "count": v} for k, v in by_stage.items()],
        "by_bucket": [{"bucket": k, "count": v} for k, v in buckets.items()],
        "source": settings_repo.get(s, "roster_source"), "seed": settings_repo.get(s, "seed"),
    }


def roster_summary() -> dict:
    with session_scope() as s:
        return _summary(s)


def reference() -> dict:
    ref = context.reference()
    out = []
    for h in HearingType:
        t = ref[h]
        out.append({
            "type": h.value, "label": h.label, "duration_min": t.duration_min,
            "reference_gap_days": t.reference_gap_days, "p_substantive": round(t.p_substantive, 3),
            "expected_hearings": round(1 / t.p_substantive, 1) if t.p_substantive else None,
            "min_h": t.min_h, "max_h": t.max_h, "mean_h": t.mean_h, "median_h": t.median_h,
            "sources": {"p_substantive": t.source_p_substantive, "failures": t.source_failures},
            "failure_reasons": t.failure_counts,
            "reason_groups": {g.value: round(v, 3) for g, v in t.group_shares.items()},
        })
    groups = [{"group": g.value, "label": GROUP_LABELS[g],
               "columns": [c for c, gg in REASON_GROUPS.items() if gg == g]} for g in ReasonGroup]
    return {"hearing_types": out, "reason_groups": groups}


def calendar(start: date, end: date) -> dict:
    if end < start:
        raise ValidationFailed("'to' must be on or after 'from'")
    if (end - start).days > 400:
        raise ValidationFailed("Range too long (max 400 days)")
    with session_scope() as s:
        cal = context.calendar(s)
        out, d = [], start
        while d <= end:
            out.append({"date": d.isoformat(), "weekday": d.strftime("%a").upper(), "sitting": cal.is_working(d),
                        "holiday_name": cal.holiday_names.get(d), "leave": d in cal.leave,
                        "leave_note": cal.leave.get(d)})
            d += timedelta(days=1)
        return {"days": out}


def add_leave(d: date, note: str | None) -> dict:
    from . import hearing_service, schedule_service
    with context.LOCK, session_scope() as s:
        row = days_repo.get(s, d)
        if row is not None and row.status == "CLOSED":
            raise Conflict(f"{d.isoformat()} is already closed")
        if d < context.today(s):
            raise ValidationFailed("Leave can only be added for today or later")
        leave_repo.add(s, d, note or "Judge's leave")
        s.flush()
        moved = 0
        affected = []
        on_day = hearings_repo.on_date(s, d, hearings_repo.ACTIVE)
        for h in on_day:
            if h.status == "DRAFT" and h.origin == "PLANNER" and not h.pinned:
                s.delete(h)
                moved += 1
        s.flush()
        rules = context.active_rules(s)[0]
        for h in [h for h in on_day if h in s]:
            view = context.engine_view(s, rules, exclude_hearing_ids={h.id})
            c = view.cases[h.case_id]
            from vihitha.estimates import expected_minutes
            m, _ = expected_minutes(c, c.next_purpose, d + timedelta(days=1), rules, view.sched.ref)
            view.sched.firm_only = True  # court orders outrank the planner's tentative listings
            sug = view.sched.suggest(c, d + timedelta(days=1), m, today=context.today(s), target_gap=0,
                                     label="Judge on leave; next day with room")
            was_published = h.status == "PUBLISHED"
            h.date = sug.date
            h.status = hearing_service._status_for(s, sug.date)
            h.window_start, h.fixed_window = "", False
            h.reason = f"Moved: judge on leave on {d.isoformat()}. {sug.reason}"
            days_repo.ensure(s, sug.date, None)
            s.flush()
            schedule_service.repack_day(s, sug.date, rules)
            moved += 1
            if was_published:
                affected.append(views.hearing_event(h, cases_repo.get(s, h.case_id), context.today(s)))
        days_repo.remove(s, d)
        s.flush()
        schedule_service._plan(s)
        context.bump()
        return {"date": d.isoformat(), "hearings_moved": moved, "published_hearings_affected": affected}


def remove_leave(d: date) -> None:
    from . import schedule_service
    with context.LOCK, session_scope() as s:
        leave_repo.remove(s, d)
        s.flush()
        if context.roster_loaded(s):
            schedule_service._plan(s)
        context.bump()


def get_settings() -> dict:
    with session_scope() as s:
        return {"horizon_working_days": context.horizon_working_days(s), "window_minutes": context.window_minutes(s),
                "today": context.today(s).isoformat()}


def put_settings(body: dict) -> dict:
    from . import schedule_service
    with context.LOCK, session_scope() as s:
        if body.get("horizon_working_days") is not None:
            v = int(body["horizon_working_days"])
            if not 1 <= v <= 120:
                raise ValidationFailed("horizon_working_days must be 1-120")
            settings_repo.put(s, "horizon_working_days", v)
        if body.get("window_minutes") is not None:
            v = int(body["window_minutes"])
            if v not in (10, 15, 20, 30, 45, 60, 90):
                raise ValidationFailed("window_minutes must be one of 10, 15, 20, 30, 45, 60, 90")
            settings_repo.put(s, "window_minutes", v)
        if body.get("today") is not None:
            settings_repo.put(s, "today", body["today"].isoformat() if isinstance(body["today"], date) else body["today"])
        s.flush()
        if context.roster_loaded(s):
            t = context.today(s)
            rules = context.active_rules(s)[0]
            if body.get("window_minutes") is not None:
                for d, row in days_repo.in_range(s, t, t + timedelta(days=400)).items():
                    if row.status == "DRAFT":
                        for h in hearings_repo.on_date(s, d, hearings_repo.ACTIVE):
                            if not h.fixed_window:
                                h.window_start = ""
                        schedule_service.repack_day(s, d, rules)
            schedule_service._plan(s)
        context.bump()
        return {"horizon_working_days": context.horizon_working_days(s), "window_minutes": context.window_minutes(s),
                "today": context.today(s).isoformat()}


def reset(confirm: bool) -> None:
    if not confirm:
        raise ValidationFailed("Send {\"confirm\": true} to reset the demo")
    with context.LOCK, session_scope() as s:
        rulesets_repo.delete_all(s)
        _wipe(s)
        seed_rulesets(s)
        _load(s, config.DEFAULT_ROSTER, config.DEFAULT_ROSTER_N, None, None, True)
    context.bump()
