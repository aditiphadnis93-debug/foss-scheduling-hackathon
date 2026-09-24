"""L4 world model: determinism, valid filings, serialisable snapshots, follow-one-dispute."""
from __future__ import annotations

import json
import sys
from datetime import date, timedelta
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from causelist import simulate  # noqa: E402
from causelist.config import load_config  # noqa: E402
from causelist.domain import HearingOutcome  # noqa: E402
from causelist.interfaces import InflowSource  # noqa: E402
from causelist.reference import STAGE_ORDER  # noqa: E402
from causelist.roster import load_roster  # noqa: E402
from causelist.world import FUNNEL, PERSON_STATES, TownWorld, load_world_config  # noqa: E402


def _run(seed: int = 42, adopt: bool = True):
    roster = load_roster()
    world = TownWorld(seed=seed, roster=roster if adopt else None)
    res = simulate.run(roster, load_config("optimal"), inflow=world)
    return world, res


@pytest.fixture(scope="module")
def run42():
    return _run(42)


def test_implements_inflow_protocol():
    assert isinstance(TownWorld(seed=1), InflowSource)


def test_deterministic_for_seed(run42):
    w1, r1 = run42
    w2, r2 = _run(42)
    ids1 = [c.case_id for c in r1.cases if c.origin == "world"]
    ids2 = [c.case_id for c in r2.cases if c.origin == "world"]
    assert ids1 == ids2 and ids1
    last = r1.days[-1].day
    assert json.dumps(w1.snapshot(last), sort_keys=True) == json.dumps(w2.snapshot(last), sort_keys=True)
    mid = r1.days[len(r1.days) // 2].day
    assert json.dumps(w1.snapshot(mid), sort_keys=True) == json.dumps(w2.snapshot(mid), sort_keys=True)


def test_different_seed_differs():
    a, b = TownWorld(seed=1), TownWorld(seed=2)
    assert [p.name for p in a.people[:20]] != [p.name for p in b.people[:20]]


def test_filings_enter_court_valid(run42):
    world, res = run42
    filed = {e.case_id: e for e in res.events if e.kind == "filed"}
    world_cases = [c for c in res.cases if c.origin == "world"]
    per_day = len(world_cases) / len(res.days)
    assert 1.0 <= per_day <= 3.0, per_day            # calibrated inflow ~1-3 per sitting day
    sitting = {d.day for d in res.days}
    people = {p.pid for p in world.people}
    for c in world_cases:
        assert c.case_id in filed and filed[c.case_id].data["purpose"] == "ADMISSION"
        assert filed[c.case_id].day == c.filing_date and c.filing_date in sitting
        assert c.stage in STAGE_ORDER and c.purpose in STAGE_ORDER + ["BAIL", "REPORTS", "APPLICATION_REVIEW"]
        assert c.advocate_id in world.advocates
        assert c.party_id in people
        d = world.dispute_for_case(c.case_id)
        assert d is not None and d.origin == "world" and d.filed_on == c.filing_date
    # the pre-existing docket is adopted: every roster advocate is an advocate agent
    assert {c.advocate_id for c in res.initial} <= set(world.advocates)


def test_snapshot_json_and_history(run42):
    world, res = run42
    days = [d.day for d in res.days]
    assert world.sitting_days() == days
    prev_filed = 0
    for day in days[:: max(1, len(days) // 6)] + [days[-1]]:
        snap = world.snapshot(day)
        back = json.loads(json.dumps(snap))
        assert back["day"] == day.isoformat()
        assert len(back["people"]) == len(world.people)
        assert {p["state"] for p in back["people"]} <= set(PERSON_STATES)
        f = back["funnel"]
        assert list(f) == FUNNEL
        assert f["filed"] <= f["notice_sent"] <= f["arisen"]
        assert f["filed"] >= prev_filed          # history is cumulative over time
        prev_filed = f["filed"]
        assert len(back["top_by_trips"]) <= 5
        assert "pending_by_stage" in back["court"] and "filed_today" in back["court"]
    # a non-sitting day falls back to the latest sitting day at or before it
    sat = next(days[0] + timedelta(days=i) for i in range(10) if (days[0] + timedelta(days=i)).weekday() == 5)
    assert world.snapshot(sat)["day"] <= sat.isoformat()


def test_follow_dispute_end_to_end(run42):
    world, res = run42
    story = world.followable()[0]
    tl = world.follow(story.did, res.events)
    kinds = [r["kind"] for r in tl["timeline"]]
    for k in ("quarrel", "legal_notice", "complaint_filed", "filed", "listed", "hearing"):
        assert k in kinds, k
    assert kinds.index("quarrel") < kinds.index("legal_notice") < kinds.index("complaint_filed") \
        < kinds.index("listed") < kinds.index("hearing")
    days = [r["day"] for r in tl["timeline"]]
    assert days == sorted(days)
    assert tl["dispute"]["case_id"] and tl["dispute"]["hearings"] >= 1
    json.dumps(tl)
    # some dispute in the run reaches a resolution of any kind
    assert any(d.resolved_on for d in world.disputes.values())


def test_outcome_costs_and_frustration():
    world = TownWorld(seed=7)
    day = date(2026, 9, 28)
    filed = []
    while not filed:
        filed = world.new_filings(day)
        day += timedelta(days=1)
    case = filed[0]
    d = world.dispute_for_case(case.case_id)
    comp, acc = world.person(d.complainant), world.person(d.accused)
    world.on_outcome(HearingOutcome(case.case_id, day, "ADMISSION", "adjourned",
                                    "Respondent Absence / Non-Compliance", 1.0, "ADMISSION", day + timedelta(days=14)))
    assert comp.trips == 1 and acc.trips == 0          # the absent accused did not travel
    assert comp.wages_lost == pytest.approx(comp.wage)
    assert d.frustration > 0 and d.adjournments == 1
    world.on_outcome(HearingOutcome(case.case_id, day, "ADMISSION", "substantive", None, 10.0, "COGNIZANCE", None))
    assert d.court_stage == "COGNIZANCE" and acc.trips == 1
    world.on_outcome(HearingOutcome(case.case_id, day, "JUDGEMENT", "substantive", None, 30.0, None, None))
    assert d.state == "judgement" and d.resolved_on == day
    assert world.snapshot(day)["people"][int(comp.pid.split("-")[1]) - 1]["state"] != "calm"


def test_config_rate_and_validation():
    cfg = load_world_config()
    per_day = cfg.expected_filings_per_sitting_day()
    assert 1.0 <= per_day <= 3.0, per_day        # the default population is scaled to ~2 per sitting day
    assert all(k.sources for k in cfg.funnel.kinds.values())
    half = load_world_config({"funnel": {**cfg.funnel.as_config(),
                                         "city_population": {"value": cfg.funnel.city_population / 2}}})
    assert half.expected_filings_per_sitting_day() == pytest.approx(per_day / 2)
    with pytest.raises(ValueError):
        load_world_config({"no_such_key": 1})
    with pytest.raises(ValueError):
        load_world_config({"funnel": {"kinds": {"x": {"per_1000_per_year": 1, "stages": {"legal_notice": 1.5}}}}})


def test_funnel_is_derived_from_population():
    from causelist.world.funnel import STAGES, funnel_table
    cfg = load_world_config()
    rows = funnel_table(cfg.funnel, window_days=365)
    court = [r for r in rows if r["stage"] == "reaches_court" and r["kind"] != "all"]
    assert all(r["expected_per_year"] == 0 for r in court if r["forum"] != "this_court")
    assert sum(r["expected_per_year"] for r in court) == pytest.approx(cfg.funnel.court_filings_per_year(), abs=0.5)
    for k in cfg.funnel.kinds.values():
        e = k.expected(cfg.funnel.city_population)
        assert [s for s in STAGES] == list(e)
        assert e["arisen"] >= e["legal_notice"] >= e["paid_on_notice"]
        assert e["complaint_filed"] >= e["reaches_court"]
    # the world's arrival rate for court-heard kinds is the full catchment rate
    w = TownWorld(seed=3)
    for k in w.court_kinds:
        assert w.funnel.arrivals_per_day(k) == pytest.approx(
            cfg.funnel.city_population / 1000 * cfg.funnel.kinds[k].per_1000_per_year / 365)


def test_export_schema_size_and_deltas(run42):
    from causelist.world.export import export_world
    world, res = run42
    doc = export_world(world, res)
    text = json.dumps(doc, separators=(",", ":"))
    assert len(text) < 5_000_000, len(text)
    assert doc["schema"] == "town-world/1" and doc["meta"]["plane"] == 1000
    assert doc["days"] == [d.day.isoformat() for d in res.days] and len(doc["timeline"]) == len(res.days)
    pts = doc["people"] + doc["advocates"] + doc["places"]["businesses"] + [doc["places"]["court"]]
    assert all(0 <= p["x"] <= 1000 and 0 <= p["y"] <= 1000 for p in pts)
    ids = {p["id"] for p in doc["people"]}
    assert all(r["creditor_id"] in ids and r["debtor_id"] in ids for r in doc["relationships"])
    assert any(r["dispute_ids"] for r in doc["relationships"])
    # replaying the delta-encoded people state reproduces the final snapshot
    state, trips = {}, dict.fromkeys(ids, 0)
    assert set(doc["timeline"][0]["people_state"]) == ids
    for t in doc["timeline"]:
        state.update(t["people_state"])
        for pid, (dt, _) in t["deltas"].items():
            trips[pid] += dt
    snap = world.snapshot(res.days[-1].day)
    assert state == {p["id"]: p["state"] for p in snap["people"]}
    assert trips == {p["id"]: p["trips"] for p in snap["people"]}
    # court lines carry outcomes, events carry types, disputes carry a story
    assert sum(t["court"]["listed"] for t in doc["timeline"]) == sum(len(d.plan.listings) for d in res.days)
    assert {e["type"] for t in doc["timeline"] for e in t["events"]} <= set(doc["meta"]["event_types"])
    story = next(d for d in doc["disputes"] if d["id"] == world.followable()[0].did)
    types = [r["type"] for r in story["timeline"]]
    assert {"quarrel", "legal_notice", "complaint_filed", "listed", "hearing"} <= set(types)
    assert story["story"] and story["case_id"]
    assert doc["timeline"][-1]["funnel"]["filed"] == doc["meta"]["filings"]
    # funnel block: config with sources, expected per kind, observed in the window
    fb = doc["funnel"]
    assert fb["config"]["city_population"]["source"]
    assert set(fb["expected_per_year"]) == set(fb["observed_in_window"]) == set(fb["config"]["kinds"])
    obs_reach = sum(v["reaches_court"] for v in fb["observed_in_window"].values())
    assert obs_reach == doc["meta"]["filings"]
    assert fb["table"] and all("source" in r for r in fb["table"])
    # case file support: people know their case ids, disputes carry kind + money at stake
    by_case = {c["case_id"]: c for c in doc["disputes"] if c["case_id"]}
    some = next(p for p in doc["people"] if p["case_ids"])
    assert all(cid in by_case for cid in some["case_ids"])
    assert all(d["kind"] in fb["config"]["kinds"] and d["money_at_stake"] > 0 for d in doc["disputes"])
