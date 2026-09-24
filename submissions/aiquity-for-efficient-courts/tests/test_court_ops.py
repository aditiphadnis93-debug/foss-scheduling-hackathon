"""Court operations: reserve, urgent matters, judge emergencies, checklists, gaming response, audit, phases."""
import dataclasses
import random
from datetime import date, timedelta

import pytest

from causelist import horizon, phases
from causelist.behaviour import SOUGHT_TIME
from causelist.config import load_config
from causelist.domain import Case
from causelist.export import export_result
from causelist.interfaces import AttendanceDecision
from causelist.planning import build_candidates, plan_milp
from causelist.reference import load_hearing_types, working_days
from causelist.roster import load_roster
from causelist.simulate import (EMERGENCY_REASON, draw_attempt, load_checklists, recheck_prerequisites, run)
from causelist.validate import MAX_RISK_BUFFER, check

START = date(2026, 9, 28)
SHORT_END = START + timedelta(days=13)


@pytest.fixture(scope="module")
def types():
    return load_hearing_types()


def cfg_with(name="optimal", **kw):
    return dataclasses.replace(load_config(name), **kw)


def make_cases(n, purpose="EVIDENCE_COMPLAINANT", years=2, adv_every=1):
    return [Case(case_id=f"C{i:03d}", filing_number=f"F{i}",
                 filing_date=START - timedelta(days=int(365 * (years + i % 5))),
                 advocate_id=f"A{i // adv_every:03d}", party_id=f"P{i}", stage=purpose, purpose=purpose)
            for i in range(n)]


class Always:
    """Test behaviour: every side appears and asks for time (or is absent, if configured)."""
    name = "always"

    def __init__(self, reason=SOUGHT_TIME, appears=True):
        self.reason, self.appears = reason, appears

    def readiness_signal(self, cases, day):
        return {}

    def decide(self, ctx, rng):
        return AttendanceDecision(self.appears, False, self.appears, self.reason, source=self.name)

    def observe(self, ctx, outcome):
        return None


# --- 1. reserve ---------------------------------------------------------------------------------
def test_reserve_excluded_from_planner_and_horizon_capacity(types):
    cases = make_cases(400)
    for c in cases:
        c.meta["prereq_pending"] = False
    full = plan_milp(START, cases, cfg_with(reserve_minutes=0, use_readiness=False), types, {})
    held = plan_milp(START, cases, cfg_with(reserve_minutes=120, use_readiness=False), types, {})
    assert held.expected_minutes < full.expected_minutes
    day = cfg_with().day_minutes
    assert held.expected_minutes <= (day - 120) * (1 + MAX_RISK_BUFFER) + 1
    assert horizon.daily_capacity(cfg_with(reserve_minutes=120)) == pytest.approx(day - 120)
    assert horizon.daily_capacity(cfg_with(reserve_minutes=0)) == pytest.approx(day)


def test_urgent_matters_heard_first_from_reserve():
    res = run(load_roster(None), cfg_with(reserve_minutes=60, urgent_per_day=3.0), start=START, end=SHORT_END, seed=7)
    urgent = [u for v in res.day_ops.values() for u in v["urgent"]]
    assert urgent, "urgent matters should arrive at mean 3/day"
    for day, v in res.day_ops.items():
        assert v["reserve_used"] <= 60 + 1e-9
        assert v["reserve_used"] + v["reserve_released"] == pytest.approx(60, abs=0.2)
        if v["urgent"]:
            assert v["urgent"][0]["start_min"] == 0.0          # heard before the list
    assert sum(1 for e in res.audit if e["action"] == "urgent_heard") == len(urgent)
    assert check(res) == []
    # the published list's capacity is still the whole court day for the metrics
    assert all(d.plan.capacity_minutes == cfg_with().day_minutes for d in res.days)


# --- 2. judge emergency -------------------------------------------------------------------------
def test_judge_emergency_tail_rolled_with_priority_no_party_penalty():
    cfg = cfg_with(judge_emergency_p=1.0, urgent_per_day=0.0, use_horizon=False, learning=False)
    cases = make_cases(400)
    end = START + timedelta(days=1)                 # two sittings
    res = run(cases, cfg, start=START, end=end, seed=3)
    d1, d2 = res.days[0], res.days[1]
    rolled = [o for o in d1.outcomes if (o.reason or "").startswith("Judge emergency")]
    assert rolled and all(o.reason == EMERGENCY_REASON and o.kind == "not_reached" for o in rolled)
    assert all(o.next_date == d2.day for o in rolled)
    by_id = {c.case_id: c for c in res.cases}
    initial = {c.case_id: c for c in res.initial}
    for o in rolled:                                 # nothing on the parties' record
        c = by_id[o.case_id]
        if c.last_heard_on is None or c.last_heard_on < d2.day:
            assert c.adjournments_in_row == initial[o.case_id].adjournments_in_row
    listed2 = {l.case_id: l for l in d2.plan.listings}
    kept = [o for o in rolled if o.case_id in listed2]
    assert len(kept) >= 0.8 * len(rolled)
    assert all("rolled with priority (judge emergency)" in listed2[o.case_id].why for o in kept)
    em = res.day_ops[d1.day]["judge_emergency"]
    assert 90 <= em["lost_minutes"] <= 240 and set(em["rolled"]) == {o.case_id for o in rolled}
    ex = export_result(res, include_cases=False)
    stake = {l["outcome"]["stakeholder"] for l in ex["days"][0]["listings"]
             if l["outcome"] and (l["outcome"]["reason"] or "").startswith("Judge emergency")}
    assert stake == {"judge_emergency"}
    assert any(e["action"] == "judge_emergency" for e in res.audit)


# --- 3. checklists --------------------------------------------------------------------------------
def test_checklist_holdback_names_item_and_removes_published_date(types):
    cfg = cfg_with(readiness_visibility=1.0)
    rng = random.Random(5)
    c = None
    for i in range(200):
        c = make_cases(1, purpose="WARRANT")[0]
        c.published_date = START + timedelta(days=3)
        draw_attempt(c, types, cfg, rng, START, seed=1)
        if c.meta["prereq_pending"]:
            break
    assert c.meta["prereq_pending"] and c.meta["prereq_visible"]
    item = c.meta["checklist_item"]
    assert item in load_checklists("default")["WARRANT"]
    assert c.meta["checklist_agency"] is True
    assert c.published_date is None                  # lost its published date
    _, held = build_candidates(START + timedelta(days=1), [c], cfg, types, {})
    assert held == [(c.case_id, f"checklist: {item} not met")]
    assert horizon.earliest_date(c, START + timedelta(days=1), cfg) is None
    sittings = working_days(START, START + timedelta(days=60))
    assert c.case_id not in horizon.plan_horizon([c], START, sittings, cfg, types).assigned
    # the item clears at a re-check -> the case can be dated again
    day = c.ready_on
    for _ in range(50):
        recheck_prerequisites([c], types, rng, day, cfg)
        if not c.meta["prereq_pending"]:
            break
        day = c.ready_on
    assert not c.meta["prereq_pending"]
    assert horizon.earliest_date(c, day, cfg) is not None


def test_agency_delay_mult_scales_only_agency_prerequisites(types):
    from causelist.simulate import prereq_p
    base = cfg_with()
    slow = cfg_with(agency_delay_mult=2.0)
    assert prereq_p(types["WARRANT"], slow) > prereq_p(types["WARRANT"], base)
    # EVIDENCE_ACCUSED has no agency prerequisite reason in the reference tables
    assert prereq_p(types["EVIDENCE_ACCUSED"], slow) == pytest.approx(prereq_p(types["EVIDENCE_ACCUSED"], base))


# --- 4. gaming response ---------------------------------------------------------------------------
def _gaming_run(behaviour, planner="optimal"):
    cases = make_cases(40)
    for c in cases[::2]:
        c.meta["gaming_flag"] = {"actor": c.advocate_id, "side": "petitioner", "p_exceed": 0.97,
                                 "evidence": {"sought_time": 5, "expected": 1.2}}
    cfg = cfg_with(planner, learning=False, use_readiness=False, readiness_visibility=0.0,
                   urgent_per_day=0.0, judge_emergency_p=0.0)
    return run(cases, cfg, behaviour=behaviour, start=START, end=START + timedelta(days=60), seed=11)


def test_gaming_response_only_flagged_side():
    res = _gaming_run(Always())
    flagged = {f"C{i:03d}" for i in range(0, 40, 2)}
    firm = [e for e in res.audit if e["rule"] == "gaming-firm-short"]
    assert firm and {e["case_id"] for e in firm} <= flagged
    for e in firm:
        gap = (date.fromisoformat(e["after"]) - date.fromisoformat(e["day"])).days
        assert gap <= 7 + 2 and e["evidence"] == {"sought_time": 5, "expected": 1.2}
    lc = [e for e in res.audit if e["action"] == "last_chance"]
    assert lc and {e["case_id"] for e in lc} <= flagged
    assert all(c.meta.get("last_chance") for c in res.cases if c.meta.get("gaming_requests", 0) >= 2)
    assert not any(c.meta.get("last_chance") for c in res.cases if c.case_id not in flagged)
    # the opposing side's absence is handled as before: no firm date, no last chance
    res2 = _gaming_run(Always("Respondent Absence / Non-Compliance", appears=False))
    assert not [e for e in res2.audit if e["rule"] == "gaming-firm-short" or e["action"] == "last_chance"]


def test_baseline_ignores_gaming_flags():
    res = _gaming_run(Always(), planner="baseline")
    assert not [e for e in res.audit if e["rule"] == "gaming-firm-short" or e["action"] == "last_chance"]


# --- 5. audit + determinism + phases --------------------------------------------------------------
@pytest.fixture(scope="module")
def short_run():
    return run(load_roster(None), load_config("optimal"), start=START, end=SHORT_END + timedelta(days=14), seed=42)


def test_audit_covers_every_listing_and_next_date(short_run):
    res = short_run
    a = res.audit
    n_list = sum(len(d.plan.listings) for d in res.days)
    n_standby = sum(len(d.plan.standby) for d in res.days)
    n_out = sum(len(d.outcomes) for d in res.days)
    assert sum(1 for e in a if e["action"] == "listed") == n_list
    assert sum(1 for e in a if e["action"] == "standby_called") == n_standby
    assert sum(1 for e in a if e["action"] in ("next_date", "rolled_over")) == n_out
    keys = {"day", "case_id", "action", "rule", "why", "before", "after", "actor"}
    assert all(keys <= set(e) for e in a)
    nd = [e for e in a if e["action"] == "next_date"]
    assert {e["rule"] for e in nd} <= {"procedural", "absence-short", "prerequisite", "capacity-aware", "flat",
                                       "disposed", "gaming-firm-short", "emergency-roll"}
    ex = export_result(res, include_cases=False)
    assert ex["audit_total"] == len(a) and len(ex["audit"]) == len(a)
    assert "attribution" in ex and "profiles" in ex
    assert all("reserve_used" in d and "urgent" in d and "judge_emergency" in d for d in ex["days"])


def test_determinism(short_run):
    again = run(load_roster(None), load_config("optimal"), start=START, end=SHORT_END + timedelta(days=14), seed=42)
    assert again.audit == short_run.audit
    assert again.day_ops == short_run.day_ops


def test_phases_sum_to_duration():
    for purpose, kind, mins in [("ARGUMENTS", "substantive", 31.7), ("BAIL", "adjourned", 3.0),
                                ("JUDGEMENT", "substantive", 12.25), ("PLEA", "not_ready", 1.0)]:
        ph = phases.split(purpose, kind, mins, f"k|{purpose}")
        assert sum(p["seconds"] for p in ph) == round(mins * 60)
        assert ph == phases.split(purpose, kind, mins, f"k|{purpose}")
    assert phases.split("PLEA", "not_reached", 0.0, "x") == []


# --- 6. day profiles + duration model ------------------------------------------------------------
def test_morning_bench_day_profile():
    from causelist.config import sitting_minutes, sitting_windows
    cfg = load_config("morning_bench")
    res = run(load_roster(None), cfg, start=START, end=SHORT_END, seed=5)
    assert check(res) == []
    h, m = map(int, cfg.day_start.split(":"))
    court_start = h * 60 + m
    for d in res.days:
        mins = sitting_minutes(cfg, d.day)
        assert d.plan.capacity_minutes == mins == 210
        assert sum(l.expected_minutes for l in d.plan.listings) <= (mins - cfg.reserve_minutes) * (1 + MAX_RISK_BUFFER) + 1
        wins = sitting_windows(cfg, d.day)
        for l in d.plan.listings:        # appointment windows only inside a sitting, never in admin time
            assert any(a - court_start <= l.start_min < l.end_min <= b - court_start for a, b in wins), l
            assert l.slot.startswith("sitting_")
        assert sum(o.minutes_used for o in d.outcomes) + res.day_ops[d.day]["urgent_minutes"] <= mins + 240
    ex = export_result(res, include_cases=False)
    assert ex["days"][0]["sitting_windows"] == [["10:00", "13:30"]]
    assert ex["days"][0]["admin_windows"] == [["14:00", "16:30"]]
    assert ex["meta"]["profile_report"]["weekly_sitting_minutes"] == 5 * 210
    assert all("duration_mult" in l for d in ex["days"] for l in d["listings"])


def test_duration_multiplier_reaches_planner(types):
    stale, fresh = make_cases(2, purpose="ARGUMENTS", years=5)
    stale.last_heard_on = START - timedelta(days=200)
    fresh.last_heard_on = START - timedelta(days=2)
    cands, _ = build_candidates(START, [stale, fresh], cfg_with(use_readiness=False), types, {})
    by = {c.case.case_id: c for c in cands}
    assert by[stale.case_id].duration_mult > 1.0 > by[fresh.case_id].duration_mult
    assert by[stale.case_id].exp_min > by[fresh.case_id].exp_min


def test_api_day_profile_guardrail():
    from fastapi import HTTPException
    from causelist.api import Overrides, _apply
    bad = Overrides(day_profile={"default": {"sittings": [["10:30", "11:00"]]}})
    with pytest.raises(HTTPException) as e:
        _apply(load_config("optimal"), bad)
    assert e.value.status_code == 422
    ok = _apply(load_config("optimal"), Overrides(day_profile={"default": {"sittings": [["10:30", "13:30"], ["14:30", "16:30"]]}},
                                                 judge={"background": "criminal_bar", "years_on_bench": 1}))
    assert ok.day_minutes == 300 and ok.judge["background"] == "criminal_bar"
