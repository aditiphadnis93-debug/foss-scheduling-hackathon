"""Receding-horizon date assignment: constraints, stability, capacity-aware next dates, determinism."""
import dataclasses
from datetime import date, timedelta

import pytest

from causelist import horizon
from causelist.config import load_config
from causelist.domain import Case
from causelist.reference import load_hearing_types, working_days
from causelist.roster import load_roster
from causelist.simulate import recommend_next_date, run

TODAY = date(2026, 10, 1)


@pytest.fixture(scope="module")
def types():
    return load_hearing_types()


@pytest.fixture(scope="module")
def sittings():
    return working_days(TODAY, TODAY + timedelta(days=90))


def make_cases(n, adv_every=1, purpose="EVIDENCE_COMPLAINANT", years=2):
    return [Case(case_id=f"C{i:03d}", filing_number=f"F{i}", filing_date=TODAY - timedelta(days=int(365 * (years + i % 5))),
                 advocate_id=f"A{i // adv_every:03d}", party_id=f"P{i}", stage=purpose, purpose=purpose)
            for i in range(n)]


def cfg_with(**kw):
    return dataclasses.replace(load_config("optimal"), **kw)


def test_capacity_once_and_window(types, sittings):
    cfg = cfg_with(horizon_days=5)
    cases = make_cases(300)
    res = horizon.plan_horizon(cases, TODAY, sittings, cfg, types)
    days = horizon.horizon_days(TODAY, sittings, 5)
    assert res.days == days and res.solver.startswith("horizon/")
    assert set(res.assigned.values()) <= set(days)
    cap = res.capacity
    assert cap >= horizon.daily_capacity(cfg)
    for d in days:
        assert res.load[d] <= cap + 1e-6
        assert sum(1 for v in res.assigned.values() if v == d) <= cfg.max_listed
    # plenty of demand: every horizon day is filled close to capacity
    assert min(res.load.values()) > 0.9 * cap


def test_earliest_date_and_known_prerequisite(types, sittings):
    cfg = cfg_with(horizon_days=5)
    cases = make_cases(4)
    days = horizon.horizon_days(TODAY, sittings, 5)
    cases[0].next_date = days[3]                        # not before its next date
    cases[1].ready_on, cases[1].meta = days[1], {"prereq_visible": True, "prereq_pending": True}
    cases[2].next_date = days[-1] + timedelta(days=30)  # outside the horizon
    res = horizon.plan_horizon(cases, TODAY, sittings, cfg, types)
    assert res.assigned["C000"] >= days[3]
    assert "C001" not in res.assigned                   # no date against an unserved process
    assert "C002" not in res.assigned
    assert res.assigned["C003"] == days[0]              # earlier is better


def test_advocate_daily_cap(types, sittings):
    cfg = cfg_with(horizon_days=3)
    cases = make_cases(20, adv_every=20)                # one advocate holds all 20 matters
    res = horizon.plan_horizon(cases, TODAY, sittings, cfg, types)
    per_day = {}
    for d in res.assigned.values():
        per_day[d] = per_day.get(d, 0) + 1
    assert max(per_day.values()) <= horizon.ADVOCATE_DAILY_CAP
    assert len(res.assigned) == min(20, 3 * horizon.ADVOCATE_DAILY_CAP)


def test_stability_keeps_published_dates(types, sittings):
    cfg = cfg_with(horizon_days=5)
    cases = make_cases(250)
    first = horizon.plan_horizon(cases, TODAY, sittings, cfg, types)
    by_id = {c.case_id: c for c in cases}
    horizon.publish(first, by_id, TODAY, [])
    # next evening: nothing heard, one day consumed; published dates inside the window should hold
    tomorrow = first.days[0]
    for c in cases:
        if c.published_date == tomorrow:
            c.published_date = None
    second = horizon.plan_horizon(cases, tomorrow, sittings, cfg, types)
    kept = [cid for cid, d in first.assigned.items() if d > tomorrow and second.assigned.get(cid) == d]
    later = [cid for cid, d in first.assigned.items() if d > tomorrow]
    assert len(kept) >= 0.9 * len(later)
    assert len(second.moved) == len(later) - len(kept)


def test_publish_records_reschedules(types, sittings):
    cases = make_cases(2)
    by_id = {c.case_id: c for c in cases}
    d1, d2 = sittings[1], sittings[2]
    cases[0].published_date = d1
    events = []
    res = horizon.HorizonResult([d1, d2], {"C000": d2, "C001": d1}, [("C000", d1, d2)], {}, "test", 2)
    horizon.publish(res, by_id, TODAY, events)
    assert cases[0].published_date == d2 and cases[0].meta["reschedules"] == 1
    assert cases[1].published_date == d1 and cases[1].meta["first_published"] == d1
    kinds = [e.kind for e in events]
    assert kinds.count("rescheduled") == 1 and kinds.count("published") == 1 and "horizon" in kinds


def test_recommend_next_date_capacity_aware(types, sittings):
    cfg = cfg_with()
    c = make_cases(1)[0]
    base = recommend_next_date(c, "substantive", None, TODAY, types, cfg, sittings)
    assert recommend_next_date(c, "substantive", None, TODAY, types, cfg, sittings, {}, 10.0) == base
    full = {base: horizon.daily_capacity(cfg)}
    nd = recommend_next_date(c, "substantive", None, TODAY, types, cfg, sittings, full, 10.0)
    assert nd > base and nd in sittings


def test_horizon_off_publishes_nothing():
    roster = load_roster()
    cfg = cfg_with(use_horizon=False)
    res = run(roster, cfg, seed=5, end=date(2026, 10, 16))
    assert all(c.published_date is None for c in res.cases)
    assert not any(e.kind in ("published", "rescheduled", "horizon") for e in res.events)
    assert not any("published_vs_heard" in c.meta for c in res.cases)


def test_horizon_run_deterministic_and_recorded():
    roster = load_roster()
    cfg = cfg_with(use_horizon=True)
    end = date(2026, 10, 30)
    a = run(roster, cfg, seed=11, end=end)
    b = run(roster, cfg, seed=11, end=end)
    key = lambda r: [(e.day, e.kind, e.case_id, sorted(map(str, e.data.items()))) for e in r.events]
    assert key(a) == key(b)
    pairs = [p for c in a.cases for p in c.meta.get("published_vs_heard", [])]
    assert pairs  # (published, heard); a standby call can hear a matter before its published date
    # every listing on a day was either published for that day or carried over unreached
    assert sum(1 for e in a.events if e.kind == "horizon") == len(a.days)
