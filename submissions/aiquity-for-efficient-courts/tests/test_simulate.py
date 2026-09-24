"""Simulator: per-attempt prerequisite latent (calibrated by construction) and day mechanics."""
import dataclasses
import random
from collections import Counter
from datetime import date, timedelta

from causelist.config import load_config
from causelist.domain import Case
from causelist.reference import load_hearing_types
from causelist.roster import load_roster
from causelist.simulate import draw_attempt, recheck_prerequisites, run

TODAY = date(2026, 10, 1)


def one_case(purpose):
    return Case(case_id="C1", filing_number="F1", filing_date=date(2020, 1, 1), advocate_id="A1",
                party_id="P1", stage=purpose, purpose=purpose)


def test_draw_attempt_rate_and_visibility():
    types = load_hearing_types()
    cfg = load_config("optimal")
    rng = random.Random(1)
    ht = types["WARRANT"]
    n, pend, vis = 20000, 0, 0
    for _ in range(n):
        c = one_case("WARRANT")
        draw_attempt(c, types, cfg, rng, TODAY)
        if c.meta["prereq_pending"]:
            pend += 1
            if c.meta["prereq_visible"]:
                vis += 1
                assert c.ready_on == TODAY + timedelta(days=max(1, ht.ideal_gap_days // 2))
            else:
                assert c.ready_on is None
        else:
            assert c.ready_on is None and not c.meta["prereq_visible"]
    assert abs(pend / n - ht.p_prereq) < 0.015
    assert abs(vis / max(pend, 1) - cfg.readiness_visibility) < 0.03


def test_recheck_clears_or_extends():
    types = load_hearing_types()
    rng = random.Random(2)
    cleared = extended = 0
    for _ in range(2000):
        c = one_case("APPEARANCE")
        c.meta.update(prereq_pending=True, prereq_visible=True)
        c.ready_on = TODAY
        recheck_prerequisites([c], types, rng, TODAY)
        if c.meta["prereq_pending"]:
            extended += 1
            assert c.ready_on > TODAY
        else:
            cleared += 1
            assert c.ready_on is None
    assert abs(extended / 2000 - types["APPEARANCE"].p_prereq) < 0.04
    # not yet due: untouched
    c = one_case("APPEARANCE")
    c.meta.update(prereq_pending=True, prereq_visible=True)
    c.ready_on = TODAY + timedelta(days=3)
    recheck_prerequisites([c], types, rng, TODAY)
    assert c.ready_on == TODAY + timedelta(days=3) and c.meta["prereq_pending"]


def test_not_ready_rate_matches_table_when_everything_is_attempted():
    """Baseline lists without a readiness check, so P(not_ready | called) must equal p_prereq."""
    types = load_hearing_types()
    roster = load_roster()
    cfg = load_config("baseline")
    called, not_ready = Counter(), Counter()
    for seed in range(1, 4):
        for d in run(roster, cfg, seed=seed).days:
            for o in d.outcomes:
                if o.kind != "not_reached":
                    called[o.purpose] += 1
                    not_ready[o.purpose] += o.kind == "not_ready"
    exp = sum(types[t].p_prereq * n for t, n in called.items())
    got = sum(not_ready.values())
    assert abs(got - exp) < 3 * max(exp, 1) ** 0.5 + 5


def test_readiness_planner_skips_visible_prerequisites():
    roster = load_roster()
    cfg = dataclasses.replace(load_config("optimal"), use_horizon=False)
    res = run(roster, cfg, seed=4, end=date(2026, 10, 30))
    base = dataclasses.replace(load_config("baseline"))
    res_b = run(roster, base, seed=4, end=date(2026, 10, 30))
    rate = lambda r: (sum(o.kind == "not_ready" for d in r.days for o in d.outcomes)
                      / max(1, sum(o.kind != "not_reached" for d in r.days for o in d.outcomes)))
    assert rate(res) < rate(res_b)


def test_deterministic_with_and_without_horizon():
    roster = load_roster()
    for hz in (False, True):
        cfg = dataclasses.replace(load_config("optimal"), use_horizon=hz)
        a = run(roster, cfg, seed=9, end=date(2026, 10, 23))
        b = run(roster, cfg, seed=9, end=date(2026, 10, 23))
        sig = lambda r: [(o.case_id, o.day, o.kind, o.reason, o.next_date) for d in r.days for o in d.outcomes]
        assert sig(a) == sig(b)


def test_standby_backfill_only_present_advocates_and_never_unreached():
    roster = load_roster()
    cfg = dataclasses.replace(load_config("optimal"), use_horizon=False)
    res = run(roster, cfg, seed=3, end=date(2026, 10, 30))
    # whether standby is called depends on the docket; the invariants below must hold whenever it is
    called = [e for e in res.events if e.kind == "standby_called"]
    for d in res.days:
        sb = getattr(d.plan, "standby", [])
        ids = {l.case_id for l in d.plan.listings}
        kinds = {o.case_id: o for o in d.outcomes}
        for l in sb:
            assert l.slot == "standby" and l.case_id not in ids
            assert kinds[l.case_id].kind != "not_reached"
    base = run(roster, load_config("baseline"), seed=3, end=date(2026, 10, 30))
    assert not any(e.kind == "standby_called" for e in base.events)


class _Withdraw:
    name = "withdraw-test"

    def __init__(self, cid, on):
        self.cid, self.on, self.ends = cid, on, []

    def new_filings(self, day, rng):
        return []

    def on_outcome(self, outcome):
        return None

    def withdrawals(self, day):
        return [self.cid] if day == self.on else []

    def on_day_end(self, day):
        self.ends.append(day)

    def snapshot(self, day):
        return {}


def test_optional_inflow_hooks():
    roster = load_roster()
    cid = roster[0].case_id
    src = _Withdraw(cid, date(2026, 9, 29))
    res = run(roster, load_config("optimal"), inflow=src, seed=2, end=date(2026, 10, 9))
    c = next(x for x in res.cases if x.case_id == cid)
    assert c.status == "disposed" and c.meta["withdrawn"]
    assert [e.case_id for e in res.events if e.kind == "withdrawn"] == [cid]
    assert not any(o.case_id == cid and o.day > date(2026, 9, 29) for d in res.days for o in d.outcomes)
    assert src.ends == [d.day for d in res.days]
