"""Core invariants: data loads, determinism, validator, calibration against the organiser tables."""
from collections import Counter

import pytest

from causelist.behaviour import StatisticalBehaviour
from causelist.config import MIN_AGEING_SHARE, load_config
from causelist.metrics import score
from causelist.reference import load_hearing_types
from causelist.roster import load_roster
from causelist.simulate import run
from causelist.validate import check


@pytest.fixture(scope="module")
def roster():
    return load_roster()


def test_reference_tables_consistent():
    types = load_hearing_types()
    assert len(types) == 14
    for t in types.values():
        assert abs(t.p_substantive + t.p_prereq + t.p_attend + t.p_court - 1) < 1e-6
        assert t.minutes > 0 and t.ideal_gap_days > 0


def test_roster_loads(roster):
    assert len(roster) == 100
    assert all(c.purpose in load_hearing_types() for c in roster)


def test_floor_cannot_be_configured_away():
    cfg = load_config("fresh_matters_first")
    assert cfg.ageing_share >= MIN_AGEING_SHARE and cfg.weights.age >= 1.0


@pytest.mark.parametrize("preset", ["optimal", "baseline", "block_schedule", "cluster_by_advocate", "fresh_matters_first"])
def test_deterministic_and_valid(roster, preset):
    cfg = load_config(preset)
    a = score(run(roster, cfg, seed=7))
    b = score(run(roster, cfg, seed=7))
    assert a == b
    res = run(roster, cfg, seed=7)
    assert check(res) == []


def test_baseline_matches_case_study_shape(roster):
    m = score(run(roster, load_config("baseline"), seed=3))
    assert m["next_date_mean_gap_days"] >= 55          # flat 60-day default
    assert m["listed_per_day"] > 0


def test_calibration_substantive_rate_per_type(roster):
    """Under 'list and attempt everything', the simulated P(substantive | listed) per type
    should sit near the organiser table (within 12 percentage points where n >= 40)."""
    types = load_hearing_types()
    cfg = load_config("baseline")
    listed, sub = Counter(), Counter()
    for seed in range(1, 6):
        res = run(roster, cfg, seed=seed, behaviour=StatisticalBehaviour(True, seed))
        for d in res.days:
            for o in d.outcomes:
                if o.kind == "not_reached":
                    continue
                listed[o.purpose] += 1
                sub[o.purpose] += o.kind == "substantive"
    checked = 0
    for t, n in listed.items():
        if n >= 40:
            checked += 1
            assert abs(sub[t] / n - types[t].p_substantive) < 0.12, (t, n, sub[t] / n, types[t].p_substantive)
    assert checked >= 3
