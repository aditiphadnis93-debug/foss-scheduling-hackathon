"""What-if: the single simulation screen (spec v3 7.7, 8.6). Results live in memory for 30 minutes."""
from __future__ import annotations

import json
import time
import uuid
from datetime import date, timedelta
from statistics import mean

from sqlalchemy.orm import Session

from vihitha import kpis as kpi_mod
from vihitha.calendar import fmt_day
from vihitha.enums import HearingType, age_bucket
from vihitha.rules import Rules, preset, resolve, rules_from_dict
from vihitha.simulate import SimResult, SimState, simulate_state
from vihitha.windows import block_bounds

from .. import config
from ..db import session_scope
from ..errors import NotFound, ValidationFailed
from . import context, views

_STORE: dict[str, dict] = {}


# ------------------------------------------------------------ shared: simulate forward from the stored schedule

def snapshot_sim(s: Session, rules: Rules, end: date, seed: int, replan_drafts: bool,
                 focus_dates: set[date] | None = None) -> SimResult:
    """Copy the current state and simulate it forward with `rules` (the DB is never changed).

    Published and closed days are fixed facts. With `replan_drafts`, the planner's own DRAFT
    listings go back to the pool so `rules` re-plan them.
    """
    t = context.today(s)
    view = context.engine_view(s, rules)
    if replan_drafts:
        for cid, h in list(view.active_by_case.items()):
            if h.status == "DRAFT" and h.origin == "PLANNER" and not h.pinned:
                view.sched.book.uncommit(cid)
                c = view.cases[cid]
                c.scheduled_date = None
                c.first_scheduled_date = None
    return simulate_state(SimState(view.cases, view.sched), t, end, seed,
                          horizon_working_days=context.horizon_working_days(s),
                          window_minutes=context.window_minutes(s), horizon_start=t, focus_dates=focus_dates)


def old_cohort(sim: SimResult) -> set[str]:
    return {fn for fn, a in sim.start_ages.items() if a >= 4}


def kpi_values(sim: SimResult) -> dict:
    rows = kpi_mod.rows_from_records([r for d in sim.days for r in d.records])
    return kpi_mod.compute(rows, len(sim.sitting_days), old_cohort(sim))


def _mean_kpis(vals: list[dict]) -> dict:
    out = {k: round(mean(v[k] for v in vals), 1) for k in kpi_mod.KPI_META}
    out["detail"] = vals[0]["detail"]
    out["counts"] = {k: mean(v["counts"][k] for v in vals) for k in vals[0]["counts"]}
    return out


# ------------------------------------------------------------ what-if

def _resolve_rules(s: Session, body: dict) -> tuple[Rules, list[dict], int | None, str]:
    given = [k for k in ("ruleset_id", "rules", "preset") if body.get(k) is not None]
    if len(given) != 1:
        raise ValidationFailed("Send exactly one of ruleset_id, rules or preset")
    if body.get("ruleset_id") is not None:
        row = context.get_ruleset(s, int(body["ruleset_id"]))
        r, w = context.rules_of(row)
        return r, w, row.id, row.name
    if body.get("preset") is not None:
        try:
            r, w = resolve(preset_name=body["preset"])
        except KeyError as e:
            raise ValidationFailed(str(e))
        return r, w, None, r.name
    try:
        r, w = resolve(rules=rules_from_dict(body["rules"]))
    except (TypeError, ValueError) as e:
        raise ValidationFailed(f"Invalid rules: {e}")
    return r, w, None, r.name or "Custom rules"


def _compare_rules(s: Session, compare_to) -> tuple[Rules, str]:
    if compare_to in (None, "ACTIVE"):
        r, row = context.active_rules(s)
        return r, f"Current rules ({row.name})" if row else "Current rules"
    if compare_to == "BASELINE":
        return preset("baseline"), "Case-study baseline (60 a day, flat 60-day next date)"
    try:
        row = context.get_ruleset(s, int(compare_to))
    except (TypeError, ValueError):
        raise ValidationFailed("compare_to must be ACTIVE, BASELINE or a ruleset id")
    return context.rules_of(row)[0], row.name


def _focus_view(sim: SimResult, rules: Rules, d: date, cal, today: date) -> dict:
    rec = next((x for x in sim.days if x.date == d), None)
    blocks = block_bounds(rules)
    hearings, windows = [], []
    if rec is not None:
        ids = {}
        for i, r in enumerate(sorted(rec.records, key=lambda r: (r.window_start, r.est_start)), start=1):
            ids[r.case_id] = i
            c = sim.cases[r.case_id]
            hearings.append({
                "hearing_id": i, "case_id": r.case_id, "case_number": r.case_number,
                "title": f"{r.case_number} · {r.purpose.label}", "hearing_type": r.purpose.value,
                "stage": c.stage.value, "age_years": r.age_years, "age_bucket": age_bucket(r.age_years),
                "advocate_id": r.advocate_id, "date": d.isoformat(), "block_id": r.block_id,
                "window_start": r.window_start, "window_end": r.window_end, "est_start": r.est_start,
                "est_end": r.est_end, "duration_min": sim_ref_duration(r.purpose),
                "expected_minutes": round(r.expected_minutes, 1), "likelihood": views.likelihood(r.p_substantive),
                "p_substantive": round(r.p_substantive, 3), "reason": r.reason, "status": "DRAFT",
                "pinned": False, "carried_forward": r.carried_forward,
                "first_promised_date": r.first_promised_date.isoformat() if r.first_promised_date else None,
                "origin": "PLANNER", "result": None,
                "flags": (["OLD_CASE"] if r.age_years >= 4 else []) + (["VERY_OLD_CASE"] if r.age_years >= 5 else [])
                + (["CARRIED_FORWARD"] if r.carried_forward else []),
            })
        for w in rec.packed.windows:
            windows.append({"start": w.start, "end": w.end, "block_id": w.block_id,
                            "hearing_ids": [ids[k] for k in w.keys if k in ids],
                            "expected_minutes": w.expected_minutes, "capacity_minutes": w.capacity_minutes})
    totals = _totals(rec, d)
    return {
        "date": d.isoformat(), "status": "DRAFT" if rec else None, "sitting": cal.is_working(d),
        "holiday_name": cal.holiday_names.get(d), "leave": d in cal.leave, "leave_note": cal.leave.get(d),
        "day_start": rules.day.start, "day_end": rules.day.end, "lunch": [rules.day.lunch_start, rules.day.lunch_end],
        "blocks": blocks, "windows": windows, "hearings": hearings, "totals": totals,
        "held_back": [{**h, "eligible_from": h["eligible_from"].isoformat()} for h in (rec.held_back if rec else [])][:30],
        "ruleset": None,
    }


def sim_ref_duration(h: HearingType) -> float:
    return context.reference().duration(h)


def _totals(rec, d: date) -> dict:
    if rec is None:
        return {"date": d.isoformat(), "listed": 0, "expected_minutes": 0.0, "capacity_minutes": 420.0,
                "load_pct": 0.0, "old_cases": 0, "unused_minutes": 420.0, "moved_forward": None, "adjourned": None, "not_reached": None}
    exp = sum(r.expected_minutes for r in rec.records)
    return {"date": d.isoformat(), "listed": len(rec.records), "expected_minutes": round(exp, 1),
            "capacity_minutes": 420.0, "load_pct": round(100 * exp / 420.0, 1),
            "old_cases": sum(1 for r in rec.records if r.age_years >= 4),
            "unused_minutes": round(max(0.0, 420.0 - exp), 1),
            "moved_forward": None, "adjourned": None, "not_reached": None}


def _sentences(cand: dict, comp: dict, compare_label: str, horizon: int) -> list[str]:
    out = []
    ch = round(cand["counts"]["old_heard"] - comp["counts"]["old_heard"])
    if ch:
        out.append(f"{abs(ch)} {'more' if ch > 0 else 'fewer'} cases aged 4+ years are heard in the next {horizon} days "
                   f"than under {compare_label}.")
    dm = cand["moved_forward"] - comp["moved_forward"]
    if abs(dm) >= 0.5:
        out.append(f"{abs(dm):.1f} {'more' if dm > 0 else 'fewer'} hearings a week move a case forward.")
    dt = cand["court_time_used"] - comp["court_time_used"]
    if abs(dt) >= 1:
        out.append(f"Court time used {'rises' if dt > 0 else 'falls'} from {comp['court_time_used']:.0f}% "
                   f"to {cand['court_time_used']:.0f}% of the 420 minutes.")
    dp = cand["heard_on_promised"] - comp["heard_on_promised"]
    if abs(dp) >= 1 and len(out) < 3:
        out.append(f"{abs(dp):.0f} points {'more' if dp > 0 else 'fewer'} hearings happen on the date first promised.")
    return out[:3] or [f"These rules perform about the same as {compare_label} over the next {horizon} days."]


def _trips(sim: SimResult) -> int:
    return len({(r.advocate_id, r.date) for d in sim.days for r in d.records})


def run(body: dict) -> dict:
    horizon = int(body.get("horizon_days") or 30)
    if horizon not in (30, 60, 90):
        raise ValidationFailed("horizon_days must be 30, 60 or 90")
    runs = int(body.get("runs") or 1)
    if not 1 <= runs <= 5:
        raise ValidationFailed("runs must be 1-5")
    agents = bool(body.get("agents"))
    with session_scope() as s:
        context.require_roster(s)
        cand_rules, warnings, rs_id, name = _resolve_rules(s, body)
        comp_rules, comp_label = _compare_rules(s, body.get("compare_to", "ACTIVE"))
        cand_rules = cand_rules.copy()
        cand_rules.agents.enabled = agents
        comp_rules = comp_rules.copy()
        comp_rules.agents.enabled = agents
        cal = context.calendar(s)
        t = context.today(s)
        end = t + timedelta(days=horizon)
        focus = body.get("focus_date") or cal.next_working_day(t)
        if isinstance(focus, str):
            focus = date.fromisoformat(focus)
        seed = context.seed(s)
        cand_sims, comp_sims = [], []
        for k in range(runs):
            cand_sims.append(snapshot_sim(s, cand_rules, end, seed + k, True, {focus}))
            comp_sims.append(snapshot_sim(s, comp_rules, end, seed + k, True, {focus}))
        cand = _mean_kpis([kpi_values(x) for x in cand_sims])
        comp = _mean_kpis([kpi_values(x) for x in comp_sims])
        first, cfirst = cand_sims[0], comp_sims[0]
        cmap = {d.date: d for d in cfirst.days}
        month = []
        for rec in first.days[:23]:
            c = cmap.get(rec.date)
            tot, ctot = _totals(rec, rec.date), _totals(c, rec.date)
            month.append({"date": rec.date.isoformat(), "sitting": True, "listed": tot["listed"],
                          "load_pct": tot["load_pct"],
                          "expected_moved_forward": round(sum(r.p_substantive for r in rec.records), 1),
                          "old_cases": tot["old_cases"], "compare_listed": ctot["listed"],
                          "compare_load_pct": ctot["load_pct"]})
        agents_effect = None
        if agents:
            off = cand_rules.copy()
            off.agents.enabled = False
            base = snapshot_sim(s, off, end, seed, True)
            w, wo = first.show_rate or 0, base.show_rate or 0
            agents_effect = {"show_rate_without": round(100 * wo, 1), "show_rate_with": round(100 * w, 1),
                             "sentence": f"With litigant and advocate behaviour modelled, show-up is {100 * w:.0f}% "
                                         f"vs {100 * wo:.0f}% from the tables alone (fixed slots, notice and "
                                         f"clustering raise it; repeat not-reached lowers it)."}
        tc, tp = _trips(first), _trips(cfirst)
        trips = None
        if cand_rules.clustering.by_advocate != comp_rules.clustering.by_advocate or tc != tp:
            diff = tp - tc
            trips = {"candidate": tc, "compare": tp,
                     "sentence": (f"Advocates make {abs(diff)} {'fewer' if diff > 0 else 'more'} court visits "
                                  f"({tc} vs {tp}) over {horizon} days.")}
        result = {
            "id": uuid.uuid4().hex[:12], "rules_applied": cand_rules.to_dict(), "compare_label": comp_label,
            "warnings": warnings,
            "focus_day": _focus_view(first, cand_rules, focus, cal, t),
            "focus_day_compare": _totals(cmap.get(focus), focus),
            "month": month,
            "kpis": kpi_mod.as_list(cand, comp, is_forecast=True),
            "cost_sentences": _sentences(cand, comp, comp_label, horizon),
            "agents_effect": agents_effect, "advocate_trips": trips,
        }
        _gc()
        _STORE[result["id"]] = {"at": time.time(), "rules": cand_rules.to_dict(), "ruleset_id": rs_id, "name": name}
        return result


def _gc() -> None:
    now = time.time()
    for k in [k for k, v in _STORE.items() if now - v["at"] > config.WHATIF_TTL_SECONDS]:
        _STORE.pop(k, None)


def apply(wid: str, from_date: date | None, name: str | None) -> dict:
    from . import rules_service
    _gc()
    entry = _STORE.get(wid)
    if entry is None:
        raise NotFound("This what-if has expired (30 minutes). Run it again.")
    with context.LOCK, session_scope() as s:
        rules = dict(entry["rules"])
        rules["agents"] = {**rules.get("agents", {}), "enabled": False}
        label = name or (entry["name"] if entry["ruleset_id"] else f"What-if {fmt_day(context.today(s))}")
        out = rules_service.save_and_activate(s, label, rules, entry["ruleset_id"], from_date)
        context.bump()
        return out
