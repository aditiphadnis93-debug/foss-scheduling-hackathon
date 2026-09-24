"""Behaviour checks, one per user-facing promise (judge, court master, advocate, analyst)."""

from collections import defaultdict
from dataclasses import replace
from datetime import date
from statistics import NormalDist

import pytest

from courtsched.data import load_hearing_types, load_sample_roster
from courtsched.scenario import Scenario
from courtsched.sim import run
from courtsched.strategies import CurrentPractice, RuleParams, RulePlanner, next_gap_days

SMALL = Scenario(name="small", start=date(2026, 10, 1), end=date(2026, 11, 15))
HTS = load_hearing_types()


@pytest.fixture(scope="module")
def l1_run():
    return run(SMALL, RulePlanner(), seed=1, roster=load_sample_roster())


@pytest.fixture(scope="module")
def base_run():
    return run(SMALL, CurrentPractice(), seed=1, roster=load_sample_roster())


def by_day(result):
    days = defaultdict(list)
    for rec in result.listings:
        days[rec.day].append(rec)
    return days


# Judge: a daily list that fits 420 min with 80% confidence
def test_day_fits_at_fill_level(l1_run):
    z = NormalDist().inv_cdf(RuleParams().fill)
    for day, recs in by_day(l1_run).items():
        if len(recs) <= 1:
            continue
        mean = sum(r.exp_minutes for r in recs)
        var = sum(r.exp_var for r in recs)
        assert mean + z * var**0.5 <= SMALL.minutes_per_day + 1e-6, day


# Judge: never see a case listed while its warrant/summons is still out
def test_no_case_listed_with_outstanding_process(l1_run, base_run):
    assert not any(r.process_outstanding for r in l1_run.listings)
    assert any(r.process_outstanding for r in base_run.listings)  # today's court does


# Judge: >= 30% of time to old cases (when enough ready old cases exist)
def test_old_case_floor(l1_run):
    for day, recs in by_day(l1_run).items():
        meta = l1_run.day_meta[day]
        total = sum(r.exp_minutes for r in recs)
        old = sum(r.exp_minutes for r in recs if r.old)
        assert meta["old_exhausted"] or old >= 0.3 * total - 1e-6, day


# Judge: no ready old case waits more than 10 sitting days (roster small enough to be feasible)
def test_old_case_max_wait(l1_run):
    assert l1_run.max_old_wait_sitting_days <= 10


# Judge: next date fits what happened, not a flat 60 days
def test_next_gap_depends_on_outcome():
    p = RuleParams()
    ev = "EVIDENCE_COMPLAINANT"
    assert next_gap_days(ev, advanced_to="EVIDENCE_ACCUSED", substantive=True, reason=None, hts=HTS, params=p) == HTS["EVIDENCE_ACCUSED"].gap_days
    assert next_gap_days(ev, advanced_to=None, substantive=True, reason=None, hts=HTS, params=p) == HTS[ev].gap_days
    assert next_gap_days(ev, advanced_to=None, substantive=False, reason="Petitioner Absence / Non-Compliance", hts=HTS, params=p) == 7
    assert next_gap_days(ev, advanced_to=None, substantive=False, reason="Awaiting Process / Summons / Warrant Return", hts=HTS, params=p) is None


def test_baseline_uses_flat_60_days(base_run):
    gaps = [r.next_gap for r in base_run.listings if r.next_gap is not None]
    assert gaps and all(g >= 60 for g in gaps)


# Court master: unreached cases top tomorrow's list
def test_carry_overs_lead_next_day(l1_run):
    days = sorted(by_day(l1_run))
    lists = by_day(l1_run)
    for d, nxt in zip(days, days[1:]):
        carried = {r.case for r in lists[d] if not r.reached}
        if not carried:
            continue
        nxt_list = lists[nxt]
        ids = [r.case for r in nxt_list]
        assert carried <= set(ids), d  # every carried case is listed the next sitting day
        carry_advs = {r.advocate for r in nxt_list if r.case in carried}
        last_carry = max(ids.index(c) for c in carried)
        # nothing unrelated (neither carried nor sharing a carried advocate) comes before them
        assert all(r.case in carried or r.advocate in carry_advs for r in nxt_list[:last_carry]), d


# Court master / advocate: priority list with slots, an advocate's matters together in one slot
def test_advocate_matters_contiguous_and_share_slot(l1_run):
    for day, recs in by_day(l1_run).items():
        seen, prev = {}, None
        for i, r in enumerate(recs):
            assert r.slot_start is not None
            if r.advocate in seen and prev != r.advocate:
                pytest.fail(f"{day}: {r.advocate} split in list")
            if r.advocate in seen:
                assert seen[r.advocate] == r.slot_start
            seen.setdefault(r.advocate, r.slot_start)
            prev = r.advocate


# Analyst: swap an assumption via a named scenario, no code change
def test_scenario_swap_changes_results():
    a = run(SMALL, RulePlanner(), seed=2, roster=load_sample_roster())
    b = run(replace(SMALL, name="literal", advance_rule="literal"), RulePlanner(), seed=2, roster=load_sample_roster())
    assert a.scorecard() != b.scorecard()
    assert b.scenario_name == "literal"


# Analyst: identical numbers on rerun
def test_deterministic():
    a = run(SMALL, RulePlanner(), seed=3, roster=load_sample_roster())
    b = run(SMALL, RulePlanner(), seed=3, roster=load_sample_roster())
    assert a.scorecard() == b.scorecard()


# Analyst: simulator hearings-per-stage match the organisers' table (where the data allows)
def test_stage_calibration_matches_table():
    from courtsched.court import p_advance

    for purpose, ht in HTS.items():
        pa = p_advance(ht, "matched")
        if pa < 1.0:  # uncapped: two dice reproduce the published mean exactly
            assert 1 / (ht.p_sub * pa) == pytest.approx(ht.mean_hearings, rel=0.01), purpose


# Analyst: more minutes never reduces cases reached (metamorphic)
def test_more_capacity_never_fewer_reached():
    for seed in (4, 5):
        lo = run(SMALL, RulePlanner(), seed=seed, roster=load_sample_roster())
        hi = run(replace(SMALL, minutes_per_day=480), RulePlanner(), seed=seed, roster=load_sample_roster())
        assert sum(r.reached for r in hi.listings) >= sum(r.reached for r in lo.listings)


# Adaptive planner: the per-case model learns from each appearance
def test_l2_learns_from_outcomes():
    from courtsched.strategies import AdaptivePlanner

    strat = AdaptivePlanner()
    res = run(SMALL, strat, seed=6, roster=load_sample_roster())
    reached = defaultdict(list)
    for r in res.listings:
        if r.reached and not r.process_outstanding:
            reached[r.case].append(r.substantive)
    failing = [c for c, xs in reached.items() if len(xs) >= 3 and not any(xs)]
    assert failing, "expected some repeatedly unsuccessful cases in the sample"
    for c in failing:
        assert strat.offset(res.cases[c]) < strat.prior(res.cases[c])


# Adaptive planner fairness guard: by default the model never pushes adjournment-heavy cases down the queue
def test_l2_default_does_not_rank_by_prediction():
    from courtsched.strategies import AdaptiveParams, AdaptivePlanner

    fair, unfair = [], []
    for seed in (7, 8, 9):
        fair.append(run(SMALL, AdaptivePlanner(), seed=seed, roster=load_sample_roster()).scorecard()["adjournment_heavy_heard"])
        unfair.append(run(SMALL, AdaptivePlanner(AdaptiveParams(rank_with_case_model=True)), seed=seed,
                          roster=load_sample_roster()).scorecard()["adjournment_heavy_heard"])
    assert sum(fair) >= sum(unfair)


# App foundation (E0): stepping and snapshots reproduce the batch run exactly
def test_step_and_snapshot_match_batch():
    import pickle

    from courtsched.sim import Simulation
    from courtsched.strategies import AdaptivePlanner

    batch = run(SMALL, AdaptivePlanner(), seed=11, roster=load_sample_roster()).scorecard()
    sim = Simulation(SMALL, AdaptivePlanner(), seed=11, roster=load_sample_roster())
    for _ in range(5):
        sim.draft()
        sim.play()
    blob = pickle.dumps(sim)
    assert len(blob) < 2_000_000  # outcome arrays are regenerated, not stored
    restored = pickle.loads(blob)
    restored.run_all()
    assert restored.result().scorecard() == batch
