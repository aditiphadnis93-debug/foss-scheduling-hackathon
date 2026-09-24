"""Tests for the L3 agent layer. No network: HTTP goes to an in-process fake server."""
from __future__ import annotations

import json
import random
import sys
from datetime import date
from pathlib import Path

import httpx
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from causelist.agents import AgentBehaviour  # noqa: E402
from causelist.agents import agent_behaviour as ab  # noqa: E402
from causelist.agents import rules  # noqa: E402
from causelist.agents.annotations import agreement_rate, load_annotations, save_annotation  # noqa: E402
from causelist.agents.engines import ResponseCache, SarvamClient, parse_json_object  # noqa: E402
from causelist.agents.export import export_agents  # noqa: E402
from causelist.agents.personas import make_advocate, make_litigant  # noqa: E402
from causelist.behaviour import case_multiplier, conditional_probs  # noqa: E402
from causelist.config import load_config  # noqa: E402
from causelist.domain import Annotation, Case, HearingOutcome, Listing  # noqa: E402
from causelist.interfaces import Behaviour, HearingContext  # noqa: E402
from causelist.metrics import score  # noqa: E402
from causelist.reference import load_hearing_types  # noqa: E402
from causelist.roster import load_roster  # noqa: E402
from causelist.simulate import run  # noqa: E402

DAY = date(2026, 9, 28)
SHORT_END = date(2026, 10, 9)
TYPES = load_hearing_types()


@pytest.fixture(autouse=True)
def no_key(monkeypatch):
    monkeypatch.delenv("SARVAM_API_KEY", raising=False)


def make_case(i: int = 0, purpose: str = "EVIDENCE_COMPLAINANT", adv: str = "ADV-T", party: str | None = None) -> Case:
    return Case(case_id=f"T/{i}/2020", filing_number=f"F-{i}", filing_date=date(2020, 1, 1),
                advocate_id=adv, party_id=party or f"P-{i}", stage=purpose, purpose=purpose)


def make_ctx(case: Case, appt: bool = True, day: date = DAY) -> HearingContext:
    lst = Listing(case.case_id, day, "day", 0, 60, case.purpose, case.advocate_id, 20.0, 0.8, 0.6, 1.0)
    return HearingContext(case, lst, TYPES[case.purpose], day, None, appt)


# ---------------------------------------------------------------- personas

def test_personas_deterministic_and_in_range():
    a1, a2 = make_advocate("ADV-9", seed=7), make_advocate("ADV-9", seed=7)
    assert a1 == a2 and make_advocate("ADV-9", seed=8) != a1
    for v in (a1.diligence, a1.caseload_pressure, a1.reliability, a1.responds_to_appointment, a1.cost_sensitivity):
        assert 0.0 <= v <= 1.0
    l1 = make_litigant("P-1", seed=7)
    assert l1 == make_litigant("P-1", seed=7)
    assert 1.0 <= l1.travel_km <= 200.0 and 200 <= l1.daily_wage_loss <= 5000
    n = make_litigant("P-1", neutral=True)
    assert n.z_travel == 0 and n.z_wage == 0 and n.trust_in_court == 0.5


def test_behaviour_protocol():
    assert isinstance(AgentBehaviour("rules"), Behaviour)
    with pytest.raises(ValueError):
        AgentBehaviour("nope")


# ---------------------------------------------------------------- calibration

def _stat_rates(case: Case, appt: bool) -> tuple[float, float]:
    p = conditional_probs(TYPES[case.purpose])
    m = case_multiplier(case, appt)
    return min(0.9, p["absent"] * m), p["seek"] * m


@pytest.mark.parametrize("purpose", ["EVIDENCE_COMPLAINANT", "APPEARANCE", "ARGUMENTS"])
def test_neutral_persona_reproduces_statistical_rates(purpose):
    b = AgentBehaviour("rules", neutral=True)
    case = make_case(purpose=purpose)
    pr = b._prop(case, TYPES[purpose], True)
    s_abs, s_seek = _stat_rates(case, True)
    assert pr.p_absent == pytest.approx(s_abs, rel=0.02)
    assert pr.p_seek == pytest.approx(s_seek, rel=0.02)


def test_neutral_sampling_matches_base_rates():
    b = AgentBehaviour("rules", neutral=True)
    rng = random.Random(1)
    case = make_case(purpose="APPEARANCE")
    s_abs, s_seek = _stat_rates(case, True)
    n, absent, seek = 20000, 0, 0
    for i in range(n):
        d = b.decide(make_ctx(case, day=date.fromordinal(DAY.toordinal() + i)), rng)
        absent += not d.appears
        seek += d.seeks_adjournment
    assert absent / n == pytest.approx(s_abs, abs=0.015)
    assert seek / n == pytest.approx(s_seek, abs=0.015)


def test_fresh_population_average_matches_statistical():
    b = AgentBehaviour("rules", seed=3)
    purpose = "EVIDENCE_COMPLAINANT"
    s_abs, s_seek = _stat_rates(make_case(purpose=purpose), True)
    prs = [b._prop(make_case(i, purpose, adv=f"A{i}"), TYPES[purpose], True) for i in range(4000)]
    assert sum(p.p_absent for p in prs) / len(prs) == pytest.approx(s_abs, rel=0.05)
    assert sum(p.p_seek for p in prs) / len(prs) == pytest.approx(s_seek, rel=0.06)
    # ... while individuals really differ
    assert max(p.p_absent for p in prs) > 1.5 * min(p.p_absent for p in prs)


# ---------------------------------------------------------------- memory drift

def _outcome(case: Case, kind: str, reason: str | None = None) -> HearingOutcome:
    return HearingOutcome(case.case_id, DAY, case.purpose, kind, reason, 1.0, case.purpose, None, "agents-rules")


def test_wasted_trips_erode_litigant_attendance():
    b = AgentBehaviour("rules", neutral=True)
    case = make_case(purpose="EVIDENCE_COMPLAINANT")
    before = b._prop(case, TYPES[case.purpose], True).p_absent
    for i in range(5):
        ctx = make_ctx(case, day=date.fromordinal(DAY.toordinal() + 7 * i))
        b._pending[(case.case_id, ctx.day)] = {"appears": True, "lit_attended": True, "confirmed": False}
        b.observe(ctx, HearingOutcome(case.case_id, ctx.day, case.purpose, "not_reached", "Day ended", 0.0,
                                      case.purpose, None, "court"))
    after = b._prop(case, TYPES[case.purpose], True).p_absent
    m = b.lit_mem[case.party_id]
    assert m.wasted_total == 5 and m.trips == 5 and m.hours_lost > 0 and m.money_lost > 0
    assert after > before * 1.2
    hist = [v for _, v in m.history]
    assert hist[0] > hist[-1]                     # P(attend) drifted down


def test_honoured_appointments_raise_attendance():
    b = AgentBehaviour("rules", neutral=True)
    case = make_case(purpose="EVIDENCE_COMPLAINANT")
    before = b._prop(case, TYPES[case.purpose], True).p_absent
    for i in range(4):
        ctx = make_ctx(case, appt=True, day=date.fromordinal(DAY.toordinal() + 7 * i))
        b._pending[(case.case_id, ctx.day)] = {"appears": True, "lit_attended": True, "confirmed": False}
        b.observe(ctx, _outcome(case, "substantive"))
    assert b.lit_mem[case.party_id].appointments_honoured == 4
    assert b._prop(case, TYPES[case.purpose], True).p_absent < before * 0.9


def test_broken_confirmations_cut_reliability():
    b = AgentBehaviour("rules", neutral=True)
    case = make_case()
    ctx = make_ctx(case)
    b.advocate(case.advocate_id)
    b._pending[(case.case_id, DAY)] = {"appears": True, "lit_attended": True, "confirmed": True}
    b.observe(ctx, _outcome(case, "adjourned", "Party Sought Time / Adjournment"))
    am = b.adv_mem[case.advocate_id]
    assert am.broken == 1 and rules.reliability_eff(b.advocates[case.advocate_id], am) < 0.5


# ---------------------------------------------------------------- readiness signal

def test_readiness_signal_confirms_and_raises_probability():
    b = AgentBehaviour("rules", seed=5)
    cases = [make_case(i, adv=f"A{i}") for i in range(300)]
    sig = b.readiness_signal(cases, DAY)
    assert set(sig) == {c.case_id for c in cases}
    conf = [c for c in cases if c.confirmed_ready]
    unconf = [c for c in cases if not c.confirmed_ready]
    assert conf and unconf
    mean = lambda cs: sum(sig[c.case_id] for c in cs) / len(cs)
    assert mean(conf) > mean(unconf)
    # deterministic
    b2 = AgentBehaviour("rules", seed=5)
    cases2 = [make_case(i, adv=f"A{i}") for i in range(300)]
    assert b2.readiness_signal(cases2, DAY) == sig
    # switched off -> no opinion
    assert AgentBehaviour("rules", ask_confirmation=False).readiness_signal(cases, DAY) == {}


def test_advocate_day_absence_is_correlated():
    b = AgentBehaviour("rules", seed=11)
    rng = random.Random(0)
    both_absent = one_absent = 0
    for k in range(400):
        day = date.fromordinal(DAY.toordinal() + k)
        c1, c2 = make_case(1, adv="ADV-X", party="P-1"), make_case(2, adv="ADV-X", party="P-2")
        d1 = b.decide(make_ctx(c1, day=day), rng)
        d2 = b.decide(make_ctx(c2, day=day), rng)
        if "counsel unavailable" in d1.rationale:
            one_absent += 1
            both_absent += (not d2.appears)
    assert one_absent > 0 and both_absent / one_absent > 0.7


# ---------------------------------------------------------------- simulation

def test_simulation_rules_deterministic_and_explained():
    roster = load_roster()
    cfg = load_config("optimal")
    runs = []
    for _ in range(2):
        b = AgentBehaviour("rules", seed=42)
        res = run(roster, cfg, behaviour=b, seed=42, end=SHORT_END)
        runs.append((score(res), [(o.case_id, o.kind, o.reason) for d in res.days for o in d.outcomes], b))
    assert runs[0][0] == runs[1][0] and runs[0][1] == runs[1][1]
    b = runs[0][2]
    assert b.decisions and all(d["source"] == "rules" and d["rationale"] for d in b.decisions)
    assert res.behaviour == "agents-rules"


def test_export_schema():
    roster = load_roster()
    b = AgentBehaviour("rules", seed=42)
    res = run(roster, load_config("optimal"), behaviour=b, seed=42, end=SHORT_END)
    doc = export_agents(b, res)
    json.dumps(doc)                                   # serialisable
    assert doc["schema_version"] == 1 and doc["meta"]["engine"] == "rules"
    roles = {a["role"] for a in doc["agents"]}
    assert roles == {"advocate", "litigant"}
    a = doc["agents"][0]
    assert {"id", "role", "traits", "case_ids", "totals"} <= set(a)
    entry = doc["journeys"][a["id"]][0]
    assert {"day", "case_id", "listed_window", "decision", "rationale", "outcome", "trip_wasted",
            "minutes_waited", "wages_lost"} <= set(entry)
    assert doc["drift"][a["id"]]
    assert {"statistical", "agents", "delta", "agent_summary"} <= set(doc["comparison"])


# ---------------------------------------------------------------- sarvam (mocked)

def _sarvam_reply(matters: list[dict], attend: float = 0.9, ask_time: float = 0.1) -> dict:
    rows = [{"id": m["case_id"], "c": 1, "attend": attend, "ask_time": ask_time, "prepared": 0.95, "o": "R",
             "side": None, "r": None, "m": 42, "why": "counsel diligent; litigant nearby"} for m in matters]
    body = "<think>brief</think>```json\n" + json.dumps({"d": rows}) + "\n```"
    return {"choices": [{"message": {"content": body}}]}


def _transport(calls: list, attend: float = 0.9, fail: bool = False, drop_first: bool = False):
    """A fake chat-completions server (WSGI works across httpx versions)."""
    def app(environ, start_response):
        body = environ["wsgi.input"].read(int(environ.get("CONTENT_LENGTH") or 0))
        calls.append(body)
        assert environ.get("HTTP_API_SUBSCRIPTION_KEY") == "test-key"
        if fail:
            start_response("500 Internal Server Error", [("Content-Type", "application/json")])
            return [b'{"error": "boom"}']
        payload = json.loads(body)
        assert payload["max_tokens"] >= 2000 and "reasoning_effort" in payload
        matters = json.loads(payload["messages"][1]["content"])["matters"]
        if drop_first:
            matters = matters[1:]
        start_response("200 OK", [("Content-Type", "application/json")])
        return [json.dumps(_sarvam_reply(matters, attend)).encode()]
    return httpx.WSGITransport(app=app)


def test_parse_json_object_is_robust():
    assert parse_json_object('<think>x {"no": 1</think> here: ```json\n{"a": {"b": "}"}}\n``` done') == {"a": {"b": "}"}}
    assert parse_json_object("no json") is None and parse_json_object(None) is None


def test_sarvam_batched_decisions_and_cache(tmp_path, monkeypatch):
    monkeypatch.setenv("SARVAM_API_KEY", "test-key")
    cache = tmp_path / "cache.json"
    calls: list = []
    b = AgentBehaviour("sarvam", seed=1, cache_path=cache, transport=_transport(calls), batch_size=10, budget=5)
    cases = [make_case(i, adv=f"A{i}") for i in range(25)]
    sig = b.readiness_signal(cases, DAY)
    assert len(calls) == 3                                   # 25 matters in batches of 10
    assert all(c.confirmed_ready for c in cases)             # model said c=1
    assert sig[cases[0].case_id] == pytest.approx(round(0.9 * 0.9 * 0.95, 2))
    rng = random.Random(0)
    decs = [b.decide(make_ctx(c), rng) for c in cases]
    assert all(d.source == "sarvam" for d in decs)
    assert all(d.minutes == 42 for d in decs) and "42 min if heard" in decs[0].rationale
    assert cases[0].meta["agent_minutes_estimate"] == 42
    b.close()
    text = cache.read_text()
    assert "test-key" not in text and len(json.loads(text)) == 3

    # replay offline: no key, transport that would fail -> identical decisions from cache
    monkeypatch.delenv("SARVAM_API_KEY")
    calls2: list = []
    b2 = AgentBehaviour("sarvam", seed=1, cache_path=cache, transport=_transport(calls2, fail=True), batch_size=10)
    cases2 = [make_case(i, adv=f"A{i}") for i in range(25)]
    assert b2.readiness_signal(cases2, DAY) == sig and not calls2
    rng2 = random.Random(0)
    decs2 = [b2.decide(make_ctx(c), rng2) for c in cases2]
    assert [(d.appears, d.ready, d.seeks_adjournment, d.rationale) for d in decs2] == \
           [(d.appears, d.ready, d.seeks_adjournment, d.rationale) for d in decs]
    assert b2.client.cache_hits == 3 and b2.client.live_calls == 0


def test_sarvam_sampling_follows_probabilities(tmp_path, monkeypatch):
    monkeypatch.setenv("SARVAM_API_KEY", "test-key")
    b = AgentBehaviour("sarvam", seed=2, cache_path=tmp_path / "c.json", transport=_transport([], attend=0.6),
                       batch_size=50, budget=10)
    cases = [make_case(i, adv=f"A{i}") for i in range(200)]
    b.readiness_signal(cases, DAY)
    rng = random.Random(3)
    appear = sum(b.decide(make_ctx(c), rng).appears for c in cases) / len(cases)
    assert appear == pytest.approx(0.6, abs=0.08)


def test_sarvam_budget_errors_and_missing_rows_fall_back(tmp_path, monkeypatch):
    monkeypatch.setenv("SARVAM_API_KEY", "test-key")
    # server error -> rules for every case, no crash
    b = AgentBehaviour("sarvam", cache_path=tmp_path / "a.json", transport=_transport([], fail=True))
    cases = [make_case(i) for i in range(5)]
    b.readiness_signal(cases, DAY)
    d = b.decide(make_ctx(cases[0]), random.Random(0))
    assert d.source == "rules" and "fallback" in d.rationale and b.client.errors == 1
    # a case missing from the reply -> rules for that case only
    b = AgentBehaviour("sarvam", cache_path=tmp_path / "b.json", transport=_transport([], drop_first=True))
    cases = [make_case(i) for i in range(5)]
    b.readiness_signal(cases, DAY)
    srcs = [b.decide(make_ctx(c), random.Random(0)).source for c in cases]
    assert srcs == ["rules", "sarvam", "sarvam", "sarvam", "sarvam"]
    # budget exhausted -> no calls
    calls: list = []
    b = AgentBehaviour("sarvam", cache_path=tmp_path / "c.json", transport=_transport(calls), budget=1, batch_size=2)
    b.readiness_signal([make_case(i) for i in range(6)], DAY)
    assert len(calls) == 1 and b.calls_used == 1


def test_sarvam_without_key_uses_rules(tmp_path):
    b = AgentBehaviour("sarvam", cache_path=tmp_path / "none.json")
    res = run(load_roster(), load_config("optimal"), behaviour=b, seed=42, end=date(2026, 9, 30))
    assert res.days and all(d["source"] == "rules" for d in b.decisions)
    assert not (tmp_path / "none.json").exists()


def test_parse_row_rejects_inconsistent_answers():
    assert ab.AgentBehaviour._parse_row({"attend": 0.1, "ask_time": 0, "prepared": 1, "o": "R"}) is None
    r = ab.AgentBehaviour._parse_row({"attend": 3, "ask_time": -1, "prepared": 0.1, "o": "S", "r": 10, "m": 0})
    assert r["p_appear"] == 0.99 and r["p_seek"] == 0.0 and r["p_ready"] == 0.5
    assert r["reason"] == ab.REASON_CODES[10] and r["minutes"] is None


def test_client_counts_and_never_stores_headers(tmp_path, monkeypatch):
    monkeypatch.setenv("SARVAM_API_KEY", "test-key")
    c = SarvamClient(ResponseCache(tmp_path / "x.json"), _transport([]))
    out = c.ask("sys", json.dumps({"matters": [{"case_id": "A"}]}))
    assert out["d"][0]["id"] == "A" and c.live_calls == 1
    c.close()
    assert "test-key" not in (tmp_path / "x.json").read_text()


# ---------------------------------------------------------------- annotations

def test_annotations_round_trip(tmp_path):
    p = tmp_path / "ann.csv"
    save_annotation(Annotation("ST/1/2020", DAY, "p_goes_ahead", 0.72, "disagree", "accused never comes"), p)
    save_annotation(Annotation("ST/1/2020", DAY, "expected_minutes", 25.0, 40), p)
    save_annotation(Annotation("ST/2/2020", DAY, "next_date", "2026-10-12", "agree", annotator="staff"), p)
    got = load_annotations(p)
    assert len(got) == 3
    assert got[0].predicted == 0.72 and got[0].judge_value == "disagree" and got[0].note == "accused never comes"
    assert got[1].judge_value == 40 and got[2].annotator == "staff" and got[2].day == DAY
    assert agreement_rate(got) == 0.5 and agreement_rate(got, "next_date") == 1.0
    assert load_annotations(tmp_path / "missing.csv") == []
