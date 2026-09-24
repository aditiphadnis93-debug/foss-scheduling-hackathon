"""Engine tests (spec v3 section 12): planner, windows, forecast, determinism, calibration."""
from collections import Counter
from datetime import date

from vihitha import forecast as fc
from vihitha.enums import HearingType
from vihitha.estimates import expected_minutes
from vihitha.metrics import compute_run
from vihitha.planner import assign_pool
from vihitha.rules import resolve
from vihitha.simulate import build_cases, horizon_days, new_state, simulate_roster
from vihitha.windows import PackItem, hhmm_to_min, pack_day

START = date(2026, 9, 24)


def _plan(inputs, preset="optimal"):
    rules, _ = resolve(preset_name=preset)
    cases = build_cases(inputs.roster, inputs.ref, START, 42)
    state = new_state(cases, inputs.calendar, rules, inputs.ref, START)
    days = horizon_days(inputs.calendar, START, 20)
    assigned, left = assign_pool(list(cases.values()), days, state.sched, today=START, seed=42)
    return rules, cases, state, days, assigned, left


def test_planner_sitting_days_one_hearing_capacity(inputs):
    rules, cases, state, days, assigned, _ = _plan(inputs)
    assert assigned
    assert all(inputs.calendar.is_working(a.date) for a in assigned)
    assert len({a.case_id for a in assigned}) == len(assigned)  # one future hearing per case
    load = Counter()
    for a in assigned:
        load[a.date] += a.expected_minutes
    assert all(v <= rules.capacity_minutes * rules.fill_target + 1e-6 for v in load.values())
    # prerequisite: nobody listed before pending_until
    assert all(not cases[a.case_id].pending_until or a.date >= cases[a.case_id].pending_until for a in assigned)


def test_planner_deterministic(inputs):
    a1 = [(a.case_id, a.date) for a in _plan(inputs)[4]]
    a2 = [(a.case_id, a.date) for a in _plan(inputs)[4]]
    assert a1 == a2


def test_windows_inside_and_no_lunch(inputs):
    rules, cases, state, days, assigned, _ = _plan(inputs)
    d = days[0]
    items = []
    for a in assigned:
        if a.date != d:
            continue
        c = cases[a.case_id]
        m, p = expected_minutes(c, c.next_purpose, d, rules, inputs.ref)
        items.append(PackItem(a.case_id, c.next_purpose.value, c.age_years(d), c.advocate_id, False, a.score, m,
                              inputs.ref.duration(c.next_purpose), p))
    packed = pack_day(d, items, rules, 30)
    assert len(packed.placements) == len(items)
    for pl in packed.placements.values():
        assert hhmm_to_min(pl.window_start) <= hhmm_to_min(pl.est_start) < hhmm_to_min(pl.window_end)
        assert hhmm_to_min(pl.est_end) - hhmm_to_min(pl.est_start) == round(pl.duration_min)
    for w in packed.windows:
        s, e = hhmm_to_min(w.start), hhmm_to_min(w.end)
        assert e <= hhmm_to_min("13:30") or s >= hhmm_to_min("14:00")


def test_baseline_60_a_day(inputs):
    rules, _ = resolve(preset_name="baseline")
    run = simulate_roster(inputs.roster, inputs.calendar, inputs.ref, rules, START, date(2026, 10, 31), 42)
    assert all(len(d.records) <= 60 for d in run.days)


def test_simulation_deterministic(inputs):
    rules, _ = resolve(preset_name="optimal")
    a = compute_run(simulate_roster(inputs.roster, inputs.calendar, inputs.ref, rules, START, date(2026, 11, 15), 7))
    b = compute_run(simulate_roster(inputs.roster, inputs.calendar, inputs.ref, rules, START, date(2026, 11, 15), 7))
    assert a == b


def test_guardrails_clamp_joshi():
    r, warnings = resolve(preset_name="joshi")
    assert r.ageing_quota_pct >= 25 and r.priority_weights.age >= 0.2 and warnings
    b, bw = resolve(preset_name="baseline")
    assert not bw


def test_forecast_order_and_reproducible(inputs):
    ref = inputs.ref
    end = date(2026, 12, 31)
    j = fc.forecast_case("X", HearingType.JUDGEMENT, HearingType.JUDGEMENT, START, end, ref, seed=1)
    assert (j.p50 - START).days <= 3
    early = fc.forecast_case("Y", HearingType.APPEARANCE, HearingType.APPEARANCE, START, end, ref, seed=1)
    args = ("Z", HearingType.EVIDENCE_COMPLAINANT, HearingType.EVIDENCE_COMPLAINANT, START, end, ref)
    mid1, mid2 = fc.forecast_case(*args, seed=3), fc.forecast_case(*args, seed=3)
    assert early.p50 > mid1.p50 > j.p50
    assert (mid1.p10, mid1.p50, mid1.p90) == (mid2.p10, mid2.p50, mid2.p90)
    assert mid1.p10 <= mid1.p50 <= mid1.p90


def test_calibration_substantiveness(inputs):
    """With agents, learning and summaries off, sampled substantiveness matches the table (within 3 pts)."""
    from vihitha import outcomes
    from vihitha.agents import ListingContext
    from vihitha.models import Case
    rules, _ = resolve(preset_name="baseline")
    ctx = ListingContext(False, 0, False, 0, 1)
    for h in (HearingType.ADMISSION, HearingType.EVIDENCE_COMPLAINANT, HearingType.ARGUMENTS):
        n, sub = 5000, 0
        for i in range(n):
            c = Case(f"C{i}", f"C{i}", "A", "P", date(2020, 1, 1), h, h, {})
            sub += outcomes.sample(c, h, START, 42, rules, inputs.ref, ctx).substantive
        assert abs(sub / n - inputs.ref.p_sub(h)) < 0.03


def test_cli_matches_api_scoring(client, inputs):
    """Numbers match between the CLI engine run and /metrics/scoring for the same seed."""
    from vihitha import loaders, roster
    from vihitha.cli import score
    from vihitha.inputs import Inputs
    client.post("/api/v1/setup/reset", json={"confirm": True})  # default roster: 3,000 generated, seed 42
    gen = roster.normalise(roster.generate(3000, 42, loaders.load_sample_roster()))
    rules, _ = resolve(preset_name="optimal")
    _, m = score(Inputs(gen, inputs.calendar, inputs.ref), rules, START, date(2026, 12, 31), 42, 1)
    api = client.get("/api/v1/metrics/scoring").json()
    got = {x["key"]: x["value"] for x in api["metrics"]}
    assert abs(got["utilisation"] - round(100 * m["utilisation"]["value"], 1)) < 0.05
    assert abs(got["predictability_days"] - round(m["predictability_days"]["value"], 1)) < 0.05
