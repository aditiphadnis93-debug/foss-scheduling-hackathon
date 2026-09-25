"""The causelist planner on the organisers' dataset: reference derivation, roster, forecast, desk, store."""
from __future__ import annotations

from datetime import date
from statistics import mean

import pandas as pd
import pytest

from planner import desk
from planner.forecast import DeskState, Fixed, forecast
from planner.reference import DAY_MINUTES, PLAN_MINUTES, PROVIDED_DIR, calendar, code, hearing_types, sitting_days
from planner import synth
from planner import roster
from planner.roster import frame, load_roster
from planner.store import DeskStore

START = date(2026, 9, 25)


@pytest.fixture(scope="module")
def small():
    return load_roster("100")


@pytest.fixture(scope="module")
def big():
    return load_roster("3000")


@pytest.fixture(scope="module", autouse=True)
def synth_roster(tmp_path_factory):
    """The synthetic roster goes to a temp file, never data/."""
    mp = pytest.MonkeyPatch()
    mp.setenv("SYNTH_ROSTER", str(tmp_path_factory.mktemp("synth") / "roster.csv"))
    yield
    mp.undo()


@pytest.fixture
def store(tmp_path):
    return DeskStore(tmp_path / "desk.duckdb")


# ---------------------------------------------------------------- reference
def test_reference_matches_csv():
    ref = hearing_types()
    csv = pd.read_csv(PROVIDED_DIR / "data" / "hearing_type_reference.csv")
    assert len(ref) == 14 == len(csv)
    for r in csv.to_dict("records"):
        ht = ref[code(r["Hearing Purpose"])]
        assert ht.minutes == r["Time it takes for hearing (mins) - estimated"]
        assert ht.gap_days == r["Time to next hearing given this is the purpose (days)"]
        assert 0 < ht.p_heard <= 1
    assert ref["WARRANT"].p_heard == pytest.approx(0.49, abs=0.01)  # rebuild-spec §5 table
    assert ref["ADMISSION"].p_heard == pytest.approx(0.77, abs=0.01)


def test_about_thirty_listings_fill_a_day(small):
    ref = hearing_types()
    per_day = DAY_MINUTES / mean(ref[c.purpose].expected_minutes for c in small)
    assert 25 <= per_day <= 36  # the case study's 30 a day


def test_sitting_days_follow_the_calendar():
    days = set(sitting_days())
    for r in calendar():
        assert (r["date"] in days) == r["sitting"]
    assert all(d.weekday() < 5 for d in days)


# ---------------------------------------------------------------- roster
def test_rosters_load_and_normalise(small, big):
    ref = hearing_types()
    assert len(small) == 100 and len(big) == 3000
    for c in small + big:
        assert c.purpose in ref and c.stage in ref
    assert [c.number for c in small if c.awaiting_disposal] == ["ST/1278/2018", "ST/789/2022", "ST/628/2022"]


def test_big_roster_is_the_organisers_script_output():
    import subprocess
    import sys
    out = pd.read_csv(pd.io.common.StringIO(subprocess.run(
        [sys.executable, "-c", "import sys; sys.path.insert(0, sys.argv[1]); import generate_roster as g; "
         "print(g.generate(3000, 42, sys.argv[2]).to_csv(index=False))",
         str(PROVIDED_DIR / "scripts"), str(PROVIDED_DIR / "data" / "roster_sample_100.csv")],
        capture_output=True, text=True, check=True).stdout))
    ours = frame("3000")
    assert list(out["case_number"]) == list(ours["case_number"])
    assert list(out["advocate_id"]) == list(ours["advocate_id"])


# ---------------------------------------------------------------- synthetic roster
@pytest.fixture(scope="module")
def gen():
    return synth.generate(3000, 7)


def test_synth_matches_the_sample_schema_and_is_deterministic(gen):
    sample = pd.read_csv(PROVIDED_DIR / "data" / "roster_sample_100.csv", parse_dates=["filing_date"])
    assert list(gen.columns) == list(sample.columns)
    assert dict(gen.dtypes.astype(str)) == dict(sample.dtypes.astype(str)) | {"filing_date": str(gen.filing_date.dtype)}
    assert gen["case_number"].is_unique and gen["filing_number"].is_unique and gen["party_id"].is_unique
    counts = [c for c in gen.columns if c.startswith("hearings_")]
    assert (gen[counts].sum(axis=1) == gen["total_hearings_held"]).all()
    ref = hearing_types()
    assert set(gen["current_stage"].map(code)) <= set(ref) and set(gen["purpose_of_next_hearing"].map(code)) <= set(ref)
    small = synth.generate(200, 1)
    assert small.equals(synth.generate(200, 1)) and not small.equals(synth.generate(200, 2))


def test_synth_lifecycles_are_coherent(gen):
    as_of = pd.Timestamp(synth.default_as_of())
    assert (gen["filing_date"] < as_of).all()
    for r in gen.to_dict("records"):
        stage = code(r["current_stage"])
        assert r[f"hearings_{stage.lower()}"] >= 1
        later = synth.MAINLINE[synth.MAINLINE.index(stage) + 1:]
        assert all(r[f"hearings_{s.lower()}"] == 0 for s in later)
    age = gen.groupby(gen["current_stage"].map(code))["filing_date"].median()
    order = ["ADMISSION", "APPEARANCE", "PLEA", "EVIDENCE_COMPLAINANT", "ARGUMENTS", "JUDGEMENT"]
    assert list(age[order]) == sorted(age[order], reverse=True)  # later stage, older case


def test_synth_has_spread(gen):
    assert set(gen["current_stage"].map(code)) == set(synth.MAINLINE)
    shapes = gen.drop(columns=["case_number", "filing_number", "filing_date", "advocate_id", "party_id",
                               "last_hearing_summary"]).drop_duplicates()
    assert len(shapes) > 1000  # the organisers' resample has 100
    per_adv = gen["advocate_id"].value_counts()
    assert per_adv.max() >= 20 and per_adv.median() <= 3  # a few busy advocates, a long tail
    assert (gen["hearings_bail"] > 0).any()
    summaries = gen["last_hearing_summary"].str.lower()
    assert 0 < (summaries.str.contains("convicted") & summaries.str.contains("sentenced")).sum() < 150
    assert gen["last_hearing_summary"].map(lambda t: bool(roster.PROCESS.search(t))).sum() > 100
    assert len(load_roster("synth")) == synth.DEFAULT_CASES


def test_synth_default_leaves_room_on_some_days():
    d = forecast(load_roster("synth"), DeskState(START))
    loads = [d.load(x) for x in d.days]
    assert sum(ld >= PLAN_MINUTES - 20 for ld in loads) >= len(loads) // 3  # busy days
    assert sum(ld <= PLAN_MINUTES - 60 for ld in loads) >= 5  # and days with an hour or more spare


# ---------------------------------------------------------------- forecast
@pytest.mark.parametrize("kind", ["100", "3000", "synth"])
def test_forecast_respects_calendar_capacity_and_gaps(kind):
    cases = load_roster(kind)
    ref = hearing_types()
    d = forecast(cases, DeskState(START))
    sitting = set(sitting_days())
    assert d.bookings
    for b in d.bookings:
        assert b.day in sitting and b.kind == "tentative" and b.why
    for day in d.days:
        assert d.load(day) <= PLAN_MINUTES + 1e-9  # the ad-hoc buffer is never planned
    for c in cases:
        own = d.of(c.number)
        if c.awaiting_disposal:
            assert not own
        for a, b in zip(own, own[1:]):
            assert (b.day - a.day).days >= ref[a.purpose].gap_days


def test_fixed_bookings_always_kept(small):
    c = small[0]
    d0 = forecast(small, DeskState(START))
    full = max(d0.days, key=d0.load)
    state = DeskState(START, fixed=(Fixed(c.number, full, "JUDGEMENT", "judge"),))
    d = forecast(small, state)
    mine = [b for b in d.of(c.number) if b.day <= full]
    assert [(b.day, b.kind) for b in mine] == [(full, "judge")]  # nothing tentative before the judge's date


# ---------------------------------------------------------------- desk
def _published_state(store, cases):
    store.reset("t", cases, START)
    return store.state("t")


def test_earliest_is_gap_then_sitting_day():
    e = desk.earliest_date(START, "ADMISSION")  # +5 days = Wed 30 Sep
    assert e == date(2026, 9, 30)
    e = desk.earliest_date(date(2026, 9, 28), "ADMISSION")  # +5 = Sat 3 Oct; Fri 2 Oct was Gandhi Jayanti
    assert e == date(2026, 10, 5)


def test_nearest_fit_is_first_day_with_room(store, big):
    state = _published_state(store, big)
    d = forecast(big, state)
    b = d.on(START)[0]
    e = desk.earliest_date(START, b.purpose)
    nf = desk.nearest_fit(d, b.case, b.purpose, e)
    cost = hearing_types()[b.purpose].expected_minutes
    assert nf is not None and d.free(nf, excluding=b.case) >= cost
    assert all(d.free(x, excluding=b.case) < cost for x in d.days if e <= x < nf)
    imp = desk.impact(big, state, d, b.case, b.purpose, nf, e)
    assert imp.fits and imp.own_delay == (nf - e).days


def test_full_day_displaces_only_tentative(store, big):
    state = _published_state(store, big)
    d = forecast(big, state)
    b = d.on(START)[0]
    nxt = sitting_days()[sitting_days().index(START) + 1]
    full = next(x for x in d.days if x > nxt and d.free(x, excluding=b.case) < hearing_types()[b.purpose].expected_minutes)
    e = desk.earliest_date(START, b.purpose)
    imp = desk.impact(big, state, d, b.case, b.purpose, full, e)
    assert not imp.fits and imp.later
    assert all(m.kind == "tentative" for m in imp.later)
    published = {f.case for f in state.fixed if f.kind == "published"}
    new = forecast(big, desk.with_date(state, b.case, b.purpose, full))
    assert {x.case for x in new.on(START)} >= published


def test_best_fit_no_worse_than_nearest(store, big):
    state = _published_state(store, big)
    d = forecast(big, state)
    for b in d.on(START)[:3]:
        e = desk.earliest_date(START, b.purpose)
        best, rows = desk.best_fit(big, state, d, b.case, b.purpose, e)
        nf = desk.nearest_fit(d, b.case, b.purpose, e)
        by_day = {r.day: r for r in rows}
        assert best is not None
        if nf in by_day:
            assert best.cost <= by_day[nf].cost


def test_default_next_purpose():
    assert desk.default_next_purpose("APPEARANCE", "APPEARANCE", "Heard, moved on") == "PLEA"
    assert desk.default_next_purpose("EVIDENCE_COMPLAINANT", "BAIL", "Heard, moved on") == "EVIDENCE_COMPLAINANT"
    assert desk.default_next_purpose("ARGUMENTS", "ARGUMENTS", "Adjourned") == "ARGUMENTS"
    assert desk.default_next_purpose("JUDGEMENT", "JUDGEMENT", "Heard, moved on") == "DISPOSED"


# ---------------------------------------------------------------- store
def test_decide_close_and_replay(tmp_path, small):
    path = tmp_path / "desk.duckdb"
    s = DeskStore(path)
    s.reset("100", small, START)
    listed = s.published("100", START)
    assert listed
    first, second = listed[0]["case_number"], listed[1]["case_number"]
    target = desk.earliest_date(START, "PLEA")
    s.decide("100", first, START, "Heard, moved on", "PLEA", target, "test")
    s.decide("100", second, START, "Disposed", "DISPOSED", None)
    nxt = s.close_day("100", small)
    assert nxt == sitting_days()[sitting_days().index(START) + 1]

    again = DeskStore(path).state("100")  # a restart: everything comes back from the file
    assert again.start == nxt
    assert dict(again.purposes)[first] == "PLEA"
    assert second in again.disposed
    assert Fixed(first, target, "PLEA", "judge") in again.fixed
    assert len(s.decisions("100", START)) == len(listed)  # the rest were booked automatically
    frozen = [r["case_number"] for r in s.published("100", nxt)]
    assert frozen and {f.case for f in again.fixed if f.kind == "published" and f.day == nxt} == set(frozen)
    d = forecast(small, again)
    assert {b.case for b in d.on(nxt)} >= set(frozen)
    assert not d.of(second)


# ---------------------------------------------------------------- view (headless)
@pytest.mark.parametrize("kind", ["100", "synth"])
def test_planner_view_renders_and_decides(kind, tmp_path, monkeypatch):
    from streamlit.testing.v1 import AppTest

    monkeypatch.setenv("CAUSELIST_DB", str(tmp_path / "view.duckdb"))

    def page():
        from datetime import date as _date

        from views import planner
        planner.render(_date(2026, 9, 24))

    at = AppTest.from_function(page, default_timeout=120)
    at.run()
    assert not at.exception, at.exception
    at.radio(key="pl-roster").set_value(kind).run()
    assert not at.exception, at.exception
    ok = next(b for b in at.button if b.key and b.key.startswith("pl-ok-"))
    ok.click().run()
    assert not at.exception, at.exception
    assert any("Change this decision" == b.label for b in at.button)


def test_proposal_offers_only_sitting_days(tmp_path, monkeypatch):
    from streamlit.testing.v1 import AppTest

    monkeypatch.setenv("CAUSELIST_DB", str(tmp_path / "view.duckdb"))

    def page():
        from datetime import date as _date

        from views import planner
        planner.render(_date(2026, 9, 24))

    at = AppTest.from_function(page, default_timeout=120)
    at.run()
    at.radio(key="pl-roster").set_value("100").run()
    outcome = next(r for r in at.radio if r.key and r.key.startswith("pl-out-"))
    outcome.set_value("Adjourned").run()  # "moved on" disposes a Judgement case, which has no next date
    mins = next(n for n in at.number_input if n.key and n.key.startswith("pl-mins-"))
    assert mins.value == hearing_types()[mins.key.rsplit("-", 1)[-1]].minutes  # filled from the table
    mins.set_value(200).run()  # the judge's own estimate: every option is worked out again
    assert not at.exception, at.exception
    assert any("your estimate" in c.value for c in at.caption)
    pick = next(r for r in at.radio if r.key and r.key.startswith("pl-pick-"))
    pick.set_value("Propose another date").run()
    assert not at.exception, at.exception
    assert any(c.key and c.key.startswith("pl-strip-") for c in at.get("plotly_chart"))
    box = next(s for s in at.selectbox if s.key and s.key.startswith("pl-date-"))
    sitting = {f"{d:%a %d %b}" for d in sitting_days()}
    assert box.options and all(o.split(" · ")[0] in sitting for o in box.options)
    assert not any(o.startswith(("Sat", "Sun", "Fri 02 Oct", "Tue 20 Oct", "Mon 09 Nov")) for o in box.options)


# ---------------------------------------------------------------- the judge's own hearing time
def test_judge_minutes_drive_cost_fit_and_forecast(store, big):
    state = _published_state(store, big)
    d = forecast(big, state)
    b = d.on(START)[0]
    ht = hearing_types()[b.purpose]
    e = desk.earliest_date(START, b.purpose)
    long = PLAN_MINUTES  # a whole plannable day: only an empty day has room
    assert ht.expected_for(long) == pytest.approx(long * ht.p_heard)
    assert ht.expected_for(None) == ht.expected_minutes
    nf_table = desk.nearest_fit(d, b.case, b.purpose, e)
    nf_long = desk.nearest_fit(d, b.case, b.purpose, e, long)
    assert nf_long is None or nf_long >= nf_table
    imp = desk.impact(big, state, d, b.case, b.purpose, nf_table, e, long)
    assert imp.free_after == pytest.approx(imp.free_before - long * ht.p_heard)
    new = forecast(big, desk.with_date(state, b.case, b.purpose, nf_table, minutes=long))
    mine = next(x for x in new.of(b.case) if x.day == nf_table)
    assert mine.minutes == long and mine.expected == pytest.approx(long * ht.p_heard)
    assert any("judge's estimate" in w for w in mine.why)


def test_judge_minutes_survive_store_and_publishing(tmp_path, small):
    s = DeskStore(tmp_path / "desk.duckdb")
    s.reset("100", small, START)
    cid = s.published("100", START)[0]["case_number"]
    nxt = sitting_days()[sitting_days().index(START) + 1]
    s.decide("100", cid, START, "Adjourned", "ARGUMENTS", nxt, minutes=75)
    s.decide("100", s.published("100", START)[1]["case_number"], START, "Adjourned", "ARGUMENTS", nxt,
             minutes=hearing_types()["ARGUMENTS"].minutes)  # same as the table: not kept as an override
    assert Fixed(cid, nxt, "ARGUMENTS", "judge", 75) in s.state("100").fixed
    assert sum(1 for r in s.decisions("100") if r["minutes"]) == 1
    s.close_day("100", small)
    row = next(r for r in s.published("100", nxt) if r["case_number"] == cid)
    assert row["minutes"] == 75
    assert row["expected_minutes"] == pytest.approx(75 * hearing_types()["ARGUMENTS"].p_heard)
    assert Fixed(cid, nxt, "ARGUMENTS", "published", 75) in s.state("100").fixed


# ---------------------------------------------------------------- the advocate's read-only view
WRITES = {"Confirm", "Confirm decision", "Change this decision", "Close the day", "Start over from this day"}
TODAY = date(2026, 9, 24)  # the desk starts on the next sitting day, START


def _advocate_page(tmp_path, monkeypatch, advocate: str | None = None):
    from streamlit.testing.v1 import AppTest

    from views import planner

    monkeypatch.setenv("CAUSELIST_DB", str(tmp_path / "view.duckdb"))
    planner.desk_store.clear()  # the cached store would otherwise point at another test's file

    def page(adv):
        from datetime import date as _date

        from views import planner
        today = _date(2026, 9, 24)
        planner.render_advocate(today, "100", adv or planner.advocate_options("100", today)[0][0])

    return AppTest.from_function(page, args=(advocate,), default_timeout=120)


def test_advocate_options_count_cases_and_put_listed_first(tmp_path, monkeypatch, small):
    from views import planner

    monkeypatch.setenv("CAUSELIST_DB", str(tmp_path / "opts.duckdb"))
    planner.desk_store.clear()
    opts = planner.advocate_options("100", TODAY)
    assert sum(n for _, n, _ in opts) == len(small)
    assert {a for a, _, _ in opts} == {c.advocate for c in small}
    listed = {r["case_number"] for r in planner.desk_store().published("100", START)}
    assert sum(t for _, _, t in opts) == len(listed)
    flags = [t > 0 for _, _, t in opts]
    assert flags == sorted(flags, reverse=True)


def test_advocate_view_is_read_only(tmp_path, monkeypatch):
    at = _advocate_page(tmp_path, monkeypatch)
    at.run()
    assert not at.exception, at.exception
    s = DeskStore(tmp_path / "view.duckdb")
    before = (len(s.decisions("100")), len(s.published("100")))
    assert not WRITES & {b.label for b in at.button}
    assert not any(r.key and r.key.startswith("pl-out-") for r in at.radio)
    assert not any(n.key and n.key.startswith("pl-mins-") for n in at.number_input)
    assert not at.get("download_button")
    purpose = next(b for b in at.selectbox if b.key and b.key.startswith("pl-adv-purpose-"))
    other = next(o for o in purpose.options if o != purpose.value)
    purpose.set_value(other).run()  # the only input: the dates are worked out again
    assert not at.exception, at.exception
    assert any(m.label == "Model's best fit" for m in at.metric)
    assert any(c.key and c.key.startswith("pl-strip-") for c in at.get("plotly_chart"))
    pick = next(r for r in at.radio if r.key and r.key.startswith("pl-adv-pick-"))
    pick.set_value("Propose another date").run()
    assert not at.exception, at.exception
    assert (len(s.decisions("100")), len(s.published("100"))) == before


def test_advocate_sees_the_judges_decision(tmp_path, monkeypatch, small):
    s = DeskStore(tmp_path / "view.duckdb")
    s.reset("100", small, START)
    row = s.published("100", START)[0]
    nxt = sitting_days()[sitting_days().index(START) + 5]
    s.decide("100", row["case_number"], START, "Adjourned", row["purpose"], nxt, "counsel unwell")
    adv = next(c.advocate for c in small if c.number == row["case_number"])
    at = _advocate_page(tmp_path, monkeypatch, adv)
    at.run()
    assert not at.exception, at.exception
    at.selectbox(key=f"pl-adv-case-100-{adv}-{START}").set_value(row["case_number"]).run()
    assert not at.exception, at.exception
    assert any("Decided by the judge" in m.value for m in at.markdown)
    assert any("counsel unwell" in x.value for x in at.success)
    assert not WRITES & {b.label for b in at.button}
