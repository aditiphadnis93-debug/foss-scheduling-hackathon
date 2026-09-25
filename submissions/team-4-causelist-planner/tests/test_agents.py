"""L3 agents: the rule fallback, the Laya client, the judge agent under the locked rules, the simulator seam."""
from datetime import date

import pytest

from agents.decide import Decision, LayaDecider, RuleDecider
from agents.judge import judge_scorer, style_text
from agents.outcomes import Agents, Levers
from agents.situation import QUESTIONS, Situation
from scheduler import config as locked
from scheduler.assign import plan_day
from scheduler.capacity import block_budget
from scheduler.config import list_presets, load_preset
from scheduler.data import HEARING_TYPES, generate_roster
from scheduler.eligibility import check
from scheduler.next_date import Ledger, recommend
from sim.metrics import combine, summary
from sim.simulate import simulate

DAY = date(2026, 10, 5)


@pytest.fixture(scope="module")
def roster():
    return generate_roster(800, seed=3)


def advocate(**kw):
    base = dict(trait="average", persona="an ordinary advocate", purpose="evidence", age="1-3y",
                adjournments="none", window=False, reminder=False, cover_page=False, clash=False,
                same_court_matters="none", costs_risk=False, prereq_met=True)
    return Situation.of("advocate", **{**base, **kw})


def litigant(**kw):
    base = dict(trait="travels far", persona="a litigant who travels far", purpose="evidence", window=False,
                reminder=False, notice="under a week", wasted_trips="none")
    return Situation.of("litigant", **{**base, **kw})


def p(s: Situation, option: str) -> float:
    return RuleDecider().decide([s])[0].probs[option]


# ---------------------------------------------------------------- rule fallback

def test_rule_decisions_are_distributions_over_the_role_options():
    for s in [advocate(), litigant()]:
        d = RuleDecider().decide([s])[0]
        assert set(d.probs) == set(QUESTIONS[s.role][1])
        assert sum(d.probs.values()) == pytest.approx(1.0, abs=1e-3)
        assert d == RuleDecider().decide([s])[0]  # deterministic


def test_levers_move_behaviour_the_right_way():
    assert p(advocate(reminder=True), "ready") > p(advocate(), "ready")
    assert p(advocate(clash=True), "absent") > p(advocate(), "absent")
    assert p(advocate(clash=True, window=True), "absent") < p(advocate(clash=True), "absent")
    assert p(advocate(costs_risk=True), "seek_adjournment") < p(advocate(), "seek_adjournment")
    assert p(advocate(cover_page=True, age="5y+"), "ready") > p(advocate(age="5y+"), "ready")
    assert p(litigant(window=True), "appear") > p(litigant(), "appear")
    assert p(litigant(wasted_trips="3+"), "appear") < p(litigant(), "appear")


def test_sample_follows_the_distribution():
    d = Decision({"a": 0.2, "b": 0.8}, "rules", "")
    assert d.sample(0.1) == "a" and d.sample(0.5) == "b" and d.sample(0.9999) == "b"


# ---------------------------------------------------------------- Laya client

def fake_laya(probs_by_role, calls):
    def post(payload):
        calls.append(payload)
        role = next(r for r, (ins, _) in QUESTIONS.items() if ins == payload["questions"]["decision"]["instructions"])
        return {"answers": {"decision": {"choice": "x", "probabilities": probs_by_role[role], "confidence": 0.9}}}
    return post


def test_laya_answers_are_parsed_memoised_and_persisted(tmp_path):
    calls = []
    d = LayaDecider(url="http://laya.invalid", cache_path=tmp_path / "c.json")
    d._reachable = True
    d._post = fake_laya({"advocate": {"ready": 3, "unprepared": 1, "seek_adjournment": 0, "absent": 0}}, calls)
    s = advocate()
    first, again = d.decide([s, s])
    assert first.source == again.source == "laya"
    assert first.probs == {"ready": 0.75, "unprepared": 0.25, "seek_adjournment": 0.0, "absent": 0.0}
    assert len(calls) == 1 and d.hits == 1
    assert calls[0]["questions"]["decision"]["type"] == "choice"
    assert "situation" in calls[0]["state"]
    d.save()

    reloaded = LayaDecider(url="http://laya.invalid", cache_path=tmp_path / "c.json")
    reloaded._reachable = False  # a cached answer needs no sidecar
    assert reloaded.decide([s])[0].probs == first.probs


def test_laya_falls_back_to_rules_when_down_or_over_budget(tmp_path):
    down = LayaDecider(url="http://127.0.0.1:9", cache_path=None, timeout=0.5)
    d = down.decide([advocate()])[0]
    assert d.source == "rules (laya unavailable)"
    assert d.probs == RuleDecider().decide([advocate()])[0].probs

    calls = []
    capped = LayaDecider(url="http://laya.invalid", cache_path=None, budget=1)
    capped._reachable = True
    capped._post = fake_laya({"litigant": {"appear": 0.9, "stay_away": 0.1}}, calls)
    got = capped.decide([litigant(), litigant(window=True)])
    assert [g.source for g in got] == ["laya", "rules (budget spent)"]
    assert len(calls) == 1


# ---------------------------------------------------------------- judge agent under the locked rules

def contrarian(pool, day, cfg):
    """The worst judge agent: ranks every 4y+ case last."""
    return {c.id: (-100.0 if c.age_years(day) >= locked.AGE_QUOTA_MIN_YEARS else 100.0, ["contrarian"])
            for c in pool}


@pytest.mark.parametrize("preset", list_presets())
def test_locked_rules_hold_whatever_the_judge_agent_says(roster, preset):
    cfg = load_preset(preset)
    day = next(d for d in (date(2026, 10, 5 + k) for k in range(7)) if cfg.blocks_on(d))
    plan = plan_day(roster, day, cfg, contrarian)
    budget = sum(block_budget(b, cfg) for b in cfg.blocks_on(day))
    old = sum(l.expected_minutes for l in plan.listings if l.age_years >= locked.AGE_QUOTA_MIN_YEARS)
    assert old >= locked.AGE_QUOTA * budget - max(HEARING_TYPES[h].est_minutes for h in HEARING_TYPES)
    assert sum(l.expected_minutes for l in plan.listings) <= budget
    assert cfg.listing_factor <= locked.LISTING_FACTOR_MAX
    assert len(plan.listings) <= cfg.max_cases_per_day

    # A young case the contrarian judge would list anyway can't show the guard; starve one it passed over.
    listed = {l.case_id for l in plan.listings}
    purposes = {pp for b in cfg.blocks_on(day) for pp in b.purposes}
    victim = next((c for c in roster if check(c, day, cfg)[0] and c.purpose in purposes and c.id not in listed), None)
    if victim is None:
        return  # every eligible case already listed: nothing to starve
    victim.consecutive_skips = locked.STARVATION_K
    try:
        assert victim.id in {l.case_id for l in plan_day(roster, day, cfg, contrarian).listings}
    finally:
        victim.consecutive_skips = 0


def test_judge_agent_listing_explains_itself(roster):
    cfg = load_preset("sehgal")
    plan = plan_day(roster, DAY, cfg, judge_scorer(RuleDecider()))
    assert plan.listings
    assert any(any(r.startswith("judge agent (rules)") for r in l.reasons) for l in plan.listings)
    assert "oldest matters" in style_text(cfg)


@pytest.mark.parametrize("band", ["short", "ideal", "long"])
def test_judge_next_date_never_below_the_procedural_minimum(roster, band):
    cfg = load_preset("sehgal")
    ledger = Ledger()
    for c in [c for c in roster if not c.disposed][:40]:
        r = recommend(c, DAY, True, cfg, ledger, band)
        if r:
            assert (r[0] - DAY).days >= HEARING_TYPES[c.purpose].min_gap_days


# ---------------------------------------------------------------- simulator seam

def test_l3_needs_agents(roster):
    with pytest.raises(ValueError):
        simulate(roster, load_preset("sehgal"), DAY, 3, "l3")


def test_agent_simulation_runs_end_to_end(roster):
    cfg = load_preset("dimakar")
    runs = [simulate(roster, cfg, DAY, 10, "l1")]
    for policy in ("baseline", "l1", "l3"):
        a = Agents(RuleDecider(), Levers() if policy != "baseline" else Levers(False, False, False, False))
        runs.append(simulate(roster, cfg, DAY, 10, policy, agents=a))
        assert a.log and {r["agent"] for r in a.log} >= {"advocate", "litigant"}
    m = summary(combine(*runs)).set_index(["policy", "behaviour"])
    assert set(m.index) == {("l1", "fixed"), ("baseline", "agents"), ("l1", "agents"), ("l3", "agents")}
    h = runs[-1].hearings
    assert (h["decision_source"] == "rules").all() and h["agent_why"].str.len().gt(0).all()
    assert m.loc[("l1", "agents"), "predictability"] > m.loc[("baseline", "agents"), "predictability"]


def test_same_seed_same_agents(roster):
    cfg = load_preset("joshi")
    a = simulate(roster, cfg, DAY, 5, "l3", agents=Agents(RuleDecider()))
    b = simulate(roster, cfg, DAY, 5, "l3", agents=Agents(RuleDecider()))
    assert a.hearings.equals(b.hearings)
