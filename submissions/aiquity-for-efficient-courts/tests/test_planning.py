"""Planner invariants on small random instances: slot capacity, max listings, ageing floor,
determinism, and the shape of the progress / justice-weight functions."""
import random
from datetime import date, timedelta

import pytest

from causelist.config import OLD_CASE_YEARS, JudgeConfig, Slot, Weights, effective_ageing_share
from causelist.domain import Case
from causelist.planning import (ProgressTable, _slot_caps, build_candidates, default_slots, justice_weight,
                                plan_greedy, plan_milp)
from causelist.reference import INTERRUPT_TYPES, NEXT_PURPOSE_ON_SUCCESS, STAGE_ORDER, load_hearing_types

DAY = date(2026, 10, 5)
TYPES = load_hearing_types()


def random_cases(n: int, seed: int) -> list[Case]:
    rng = random.Random(seed)
    purposes = sorted(TYPES)
    out = []
    for i in range(n):
        purpose = rng.choice(purposes)
        stage = purpose if purpose in STAGE_ORDER else rng.choice(STAGE_ORDER)
        out.append(Case(
            case_id=f"C{i:04d}", filing_number=f"F{i:04d}",
            filing_date=DAY - timedelta(days=rng.randint(30, 365 * 9)),
            advocate_id=f"A{rng.randint(0, n // 3):03d}", party_id=f"P{i}",
            stage=stage, purpose=purpose, hearings_at_stage=rng.randint(0, 6),
            listed_count_current=rng.randint(0, 2)))
    return out


def cfg_for(slots=None, max_listed=60, ageing_share=0.25) -> JudgeConfig:
    return JudgeConfig(name="t", planner="milp", slots=slots or [], max_listed=max_listed,
                       ageing_share=ageing_share).enforce_floors()


SLOTTED = [Slot("fresh", "10:30", "13:00", purposes=["ADMISSION", "APPEARANCE", "WARRANT", "BAIL",
                                                        "APPLICATION_REVIEW", "REPORTS", "PLEA"]),
           Slot("old", "14:00", "16:00", min_age_years=3),
           Slot("rest", "16:00", "17:30")]


def check_plan(plan, cfg, cases):
    cands, _ = build_candidates(DAY, cases, cfg, TYPES, {})
    caps = _slot_caps(cfg, cands)
    by_id = {c.case_id: c for c in cases}
    slots = {s.name: s for s in default_slots(cfg)}
    # every case at most once
    ids = [l.case_id for l in plan.listings]
    assert len(ids) == len(set(ids))
    # max listed
    assert len(ids) <= cfg.max_listed
    # slot capacity (expected minutes) and slot eligibility
    for name, cap in caps.items():
        used = sum(l.expected_minutes for l in plan.listings if l.slot == name)
        assert used <= cap + 0.05 * len(plan.listings) + 1e-6, (name, used, cap)
    for l in plan.listings:
        s = slots[l.slot]
        c = by_id[l.case_id]
        assert not s.purposes or c.purpose in s.purposes
        assert c.age_years(DAY) >= s.min_age_years
    # ageing floor: share of listed expected minutes on 4+ year cases
    old_frac = sum(c.exp_min for c in cands if c.old) / sum(c.exp_min for c in cands)
    alpha = effective_ageing_share(cfg, old_frac)
    total = sum(l.expected_minutes for l in plan.listings)
    old = sum(l.expected_minutes for l in plan.listings if by_id[l.case_id].age_years(DAY) >= OLD_CASE_YEARS)
    old_supply = sum(c.exp_min for c in cands if c.old)
    if old_supply >= alpha * sum(caps.values()):
        assert old >= alpha * total - 0.05 * len(plan.listings) - 1e-6, (old, total, alpha)
    else:
        assert old >= 0.99 * old_supply - 0.05 * len(plan.listings)


@pytest.mark.parametrize("seed", [1, 2, 3])
@pytest.mark.parametrize("slots", [None, SLOTTED])
def test_milp_respects_capacity_max_listed_and_floor(seed, slots):
    cases = random_cases(250, seed)
    cfg = cfg_for(slots=slots)
    plan = plan_milp(DAY, cases, cfg, TYPES, {})
    assert plan.listings
    assert plan.solver.startswith("milp")
    check_plan(plan, cfg, cases)


def test_milp_max_listed_binds():
    cases = random_cases(200, 7)
    cfg = cfg_for(max_listed=8)
    plan = plan_milp(DAY, cases, cfg, TYPES, {})
    assert 0 < len(plan.listings) <= 8
    check_plan(plan, cfg, cases)


def test_floor_cannot_be_configured_below_minimum():
    cases = random_cases(250, 11)
    cfg = cfg_for(ageing_share=0.0)
    assert cfg.ageing_share >= 0.20
    check_plan(plan_milp(DAY, cases, cfg, TYPES, {}), cfg, cases)


def test_greedy_respects_same_constraints():
    cases = random_cases(250, 5)
    cfg = cfg_for(slots=SLOTTED)
    check_plan(plan_greedy(DAY, cases, cfg, TYPES, {}), cfg, cases)


def test_planner_is_deterministic():
    cases = random_cases(300, 21)
    cfg = cfg_for()
    a = plan_milp(DAY, cases, cfg, TYPES, {})
    b = plan_milp(DAY, random_cases(300, 21), cfg, TYPES, {})
    assert [(l.case_id, l.slot, l.start_min) for l in a.listings] == \
           [(l.case_id, l.slot, l.start_min) for l in b.listings]


def test_progress_grows_towards_disposal():
    prog = ProgressTable(TYPES)
    path, s = [], "ADMISSION"
    while s:
        path.append(s)
        s = NEXT_PURPOSE_ON_SUCCESS[s]
    values = [prog(p, p) for p in path]
    assert values[-1] == pytest.approx(1.0)          # judgement = disposal
    assert values == sorted(values)                  # never decreases along the lifecycle
    for i in INTERRUPT_TYPES:                        # an interrupt never disposes, and is worth more
        iv = [prog(i, st) for st in path]            # the closer its case is to disposal
        assert all(0 < v < 1 for v in iv)
        assert iv == sorted(iv)


def test_justice_weight_never_below_neutral():
    w = Weights(age=0.0, wait=0.0)
    assert justice_weight(0.1, 0, 3, 0, w) == 1.0
    assert justice_weight(6.0, 0, 3, 0, Weights(age=1.0)) >= 2.0
    assert justice_weight(2.0, 9, 3, 0, w) > justice_weight(2.0, 1, 3, 0, w)     # stuck at stage
    assert justice_weight(2.0, 0, 3, 3, Weights()) > justice_weight(2.0, 0, 3, 0, Weights())  # bypassed
