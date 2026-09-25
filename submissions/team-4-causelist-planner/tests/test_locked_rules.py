from datetime import date

import pytest

from scheduler import config as locked
from scheduler.assign import plan_day
from scheduler.capacity import block_budget, expected_cost
from scheduler.config import from_dict, list_presets, load_preset
from scheduler.data import generate_roster
from scheduler.next_date import Ledger, recommend
from sim.metrics import combine, summary
from sim.simulate import simulate

DAY = date(2026, 10, 5)  # a Monday


@pytest.fixture(scope="module")
def roster():
    return generate_roster(3000, today=DAY, seed=7)


@pytest.fixture(params=list_presets())
def cfg(request):
    return load_preset(request.param)


def test_joshi_weights_are_clamped():
    cfg = load_preset("joshi")
    assert cfg.weights["age"] == locked.W_AGE_FLOOR
    assert cfg.listing_factor == locked.LISTING_FACTOR_MAX
    assert len(cfg.clamped) == 2


def test_budgets_and_daily_cap_hold(roster, cfg):
    plan = plan_day(roster, DAY, cfg)
    assert len(plan.listings) <= cfg.max_cases_per_day
    for b in cfg.blocks_on(DAY):
        used = sum(l.expected_minutes for l in plan.listings if l.block == b.name)
        assert used <= block_budget(b, cfg) + 1e-9


def test_ageing_quota_is_met(roster, cfg):
    plan = plan_day(roster, DAY, cfg)
    total = sum(block_budget(b, cfg) for b in cfg.blocks_on(DAY))
    old = sum(l.expected_minutes for l in plan.listings if l.age_years >= locked.AGE_QUOTA_MIN_YEARS)
    # Allow one hearing's slack: the quota stops at the first case that crosses it or no longer fits.
    assert old >= locked.AGE_QUOTA * total - 36


def test_unmet_prerequisites_never_listed(roster, cfg):
    blocked = {c.id for c in roster if not c.prerequisites_met}
    plan = plan_day(roster, DAY, cfg)
    assert blocked.isdisjoint(l.case_id for l in plan.listings)


def test_every_listing_explains_itself(roster, cfg):
    for l in plan_day(roster, DAY, cfg).listings:
        assert l.reasons and l.window


def test_starvation_guard_forces_case_in(roster):
    cfg = load_preset("sehgal")
    baseline_ids = {l.case_id for l in plan_day(roster, DAY, cfg).listings}
    victim = next(c for c in roster if c.prerequisites_met and c.purpose == "mention"
                  and c.id not in baseline_ids and (c.last_heard is None or (DAY - c.last_heard).days > 3)
                  and not c.on_hold)
    victim.consecutive_skips = locked.STARVATION_K
    try:
        ids = {l.case_id for l in plan_day(roster, DAY, cfg).listings}
        assert victim.id in ids
    finally:
        victim.consecutive_skips = 0


def test_next_date_respects_min_gap_and_quota_room(roster):
    cfg = from_dict({"name": "t", "blocks": [{"name": "A", "start": "11:00", "end": "13:30",
                                               "purposes": ["mention", "admission", "interim_application"]}]})
    ledger = Ledger()
    young = [c for c in roster if c.purpose == "mention" and c.age_years(DAY) < 1][:200]
    for c in young:
        r = recommend(c, DAY, True, cfg, ledger)
        assert r is not None
        assert (r[0] - DAY).days >= 3
    budget = block_budget(cfg.blocks[0], cfg)
    for (d, _), mins in ledger.minutes.items():
        assert mins <= budget * (1 - locked.AGE_QUOTA) + 1e-9


def test_l1_beats_baseline(roster):
    cfg = load_preset("sehgal")
    res = combine(simulate(roster, cfg, DAY, 30, "l1"), simulate(roster, cfg, DAY, 30, "baseline"))
    m = summary(res).set_index("policy")
    assert m.loc["l1", "predictability"] > m.loc["baseline", "predictability"]
    assert m.loc["l1", "substantiveness"] > m.loc["baseline", "substantiveness"]
    assert m.loc["l1", "mean_next_gap_days"] < m.loc["baseline", "mean_next_gap_days"]
