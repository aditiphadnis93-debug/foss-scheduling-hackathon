"""Saved schedules: several per day can coexist, and a saved one reads back exactly as planned."""
from scheduler.runs import delete_batch, list_batches, save_batch
from views.court import build_court, court_from_batch


def _listings(rooms):
    return {(r.judge_id, l.day, l.case_id, l.block, l.purpose, l.window, tuple(l.reasons), l.score,
             l.expected_minutes) for r in rooms for p in r.plans for l in p.listings}


def test_saved_schedule_reads_back_identically(fresh_store):
    live = build_court(fresh_store, fresh_store.today, n_days=5)
    batch = save_batch(fresh_store, live, label="A")
    saved = court_from_batch(fresh_store, batch)
    assert [r.judge_id for r in saved] == [r.judge_id for r in live]
    assert _listings(saved) == _listings(live)
    for a, b in zip(live, saved):
        assert a.days == b.days
        assert [p.near_miss for p in a.plans if p.listings] == [p.near_miss for p in b.plans if p.listings]


def test_two_schedules_for_the_same_days_coexist(fresh_store):
    a = build_court(fresh_store, fresh_store.today, n_days=5)
    j = fresh_store.judges[0].id
    b = build_court(fresh_store, fresh_store.today, n_days=5, overrides={j: {"max_cases_per_day": 20}})
    ba = save_batch(fresh_store, a, label="A")
    bb = save_batch(fresh_store, b, label="B", overrides={j: {"max_cases_per_day": 20}})
    listed = list_batches(fresh_store)
    assert {ba, bb, "seed"} <= set(listed["batch"])
    rb = next(r for r in court_from_batch(fresh_store, bb) if r.judge_id == j)
    assert rb.overrides == {"max_cases_per_day": 20} and rb.cfg.max_cases_per_day == 20
    assert all(len(p.listings) <= 20 for p in rb.plans)


def test_decisions_link_to_items_and_delete_removes_the_batch(fresh_store):
    batch = save_batch(fresh_store, build_court(fresh_store, fresh_store.today, n_days=3), label="X")
    bad = fresh_store.cursor().execute("""
        SELECT count(*) FROM listing_decision d JOIN causelist_item i ON i.id = d.causelist_item_id
        WHERE i.case_id <> d.case_id""").fetchone()[0]
    assert bad == 0
    delete_batch(fresh_store, batch)
    assert batch not in set(list_batches(fresh_store)["batch"])
    left = fresh_store.cursor().execute(
        "SELECT count(*) FROM scheduling_run WHERE additional_details->>'batch' = ?", [batch]).fetchone()[0]
    assert left == 0


def test_seed_schedule_from_the_dataset_opens(fresh_store):
    rooms = court_from_batch(fresh_store, "seed")
    assert len(rooms) == len(fresh_store.judges)
    assert sum(len(p.listings) for r in rooms for p in r.plans) > 0
