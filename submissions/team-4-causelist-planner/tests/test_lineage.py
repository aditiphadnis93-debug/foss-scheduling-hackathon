"""Decision lineage: every listed case can say how it got there, every waiting case why it waited."""
from datetime import date, timedelta

import pytest

from scheduler.assign import plan_day
from scheduler.config import list_presets, load_preset
from scheduler.data import generate_roster
from scheduler.eligibility import check, gates
from scheduler.runs import save_batch
from scheduler.scoring import score, terms
from views import lineage
from views.court import build_room, court_from_batch

DAY = date(2026, 10, 5)


@pytest.fixture(scope="module")
def roster():
    return generate_roster(800, seed=3)


@pytest.mark.parametrize("preset", list_presets())
def test_gates_agree_with_the_eligibility_stage(roster, preset):
    cfg = load_preset(preset)
    for day in (DAY + timedelta(days=k) for k in range(7)):
        for c in roster[:300]:
            ok, why = check(c, day, cfg)
            g = gates(c, day, cfg)
            assert ok == all(passed for _, passed, _ in g)


def test_score_terms_add_up_to_the_score(roster):
    cfg = load_preset("joshi")
    for c in roster[:200]:
        assert sum(v for v, _ in terms(c, DAY, cfg)) == pytest.approx(score(c, DAY, cfg)[0])


@pytest.mark.parametrize("preset", list_presets())
def test_every_eligible_case_has_a_recorded_fate(roster, preset):
    cfg = load_preset(preset)
    day = next(d for d in (DAY + timedelta(days=k) for k in range(7)) if cfg.blocks_on(d))
    plan = plan_day(roster, day, cfg)
    listed = {l.case_id for l in plan.listings}
    assert len(plan.rank) == plan.pool_size and sorted(plan.rank.values()) == list(range(1, plan.pool_size + 1))
    for l in plan.listings:
        assert plan.how[l.case_id], l.case_id
        assert l.window_why and l.block in l.window_why
    for cid in plan.rank:
        assert cid in listed or plan.skipped.get(cid), cid
    assert not listed & set(plan.skipped)


def test_lineage_of_a_listed_and_a_waiting_case(store):
    j = store.judges[0].id
    room = build_room(store, j, store.today, n_days=5)
    listed = next(l for p in room.plans for l in p.listings)
    lin = lineage.build(room, listed.case_id)
    assert lin.listed_on == listed.day and lin.how and lin.recorded
    assert all(ok for _, ok, _ in lin.gates)
    assert lin.days[-1]["Outcome"].endswith("listed")

    ever = {l.case_id for p in room.plans for l in p.listings}
    waiting = next(c.id for c in room.cases if c.id not in ever)
    lin = lineage.build(room, waiting)
    assert lin.listed_on is None and len(lin.days) == len(room.days)
    assert all(row["Why"] for row in lin.days)


def test_saved_schedule_keeps_its_lineage(fresh_store):
    j = fresh_store.judges[0].id
    live = [build_room(fresh_store, j, fresh_store.today, n_days=3)]
    saved = court_from_batch(fresh_store, save_batch(fresh_store, live, label="L"))[0]
    for a, b in zip(live[0].plans, saved.plans):
        for la in a.listings:
            lb = next(l for l in b.listings if l.case_id == la.case_id)
            assert lb.window_why == la.window_why
            assert b.how[la.case_id] == a.how[la.case_id]
            assert b.rank.get(la.case_id) == a.rank.get(la.case_id)
        assert b.pool_size == a.pool_size
        for cid in a.near_miss:
            assert b.skipped[cid] == a.skipped[cid]
