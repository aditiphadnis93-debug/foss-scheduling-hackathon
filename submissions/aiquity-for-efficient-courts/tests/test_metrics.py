from datetime import date

from causelist.config import load_config
from causelist.metrics import score
from causelist.roster import load_roster
from causelist.simulate import run

NEW_KEYS = ["eju_pct", "justice_weighted_progress_per_hour", "idle_minutes_per_day",
            "overrun_minutes_per_day", "old_minutes_share_pct"]
OLD_KEYS = ["utilisation_pct", "reach_rate_pct", "substantive_pct_of_heard", "backlog_4y_heard_pct",
            "substantive_total", "disposed", "cases_5y_pending_start", "cases_5y_pending_end"]


def test_scorecard_keys_and_ranges():
    roster = load_roster()
    for name in ("optimal", "baseline"):
        res = run(roster, load_config(name), start=date(2026, 9, 28), end=date(2026, 10, 9), seed=1)
        sc = score(res)
        for k in NEW_KEYS + OLD_KEYS:
            assert k in sc, k
        assert 0 <= sc["eju_pct"] <= sc["utilisation_pct"] + 1e-9 or sc["utilisation_pct"] == 100.0
        assert 0 <= sc["old_minutes_share_pct"] <= 100
        assert sc["idle_minutes_per_day"] >= 0 and sc["overrun_minutes_per_day"] >= 0
        assert sc["justice_weighted_progress_per_hour"] >= 0


def test_scorecard_deterministic():
    roster = load_roster()
    cfg = load_config("optimal")
    a = score(run(roster, cfg, start=date(2026, 9, 28), end=date(2026, 10, 9), seed=3))
    b = score(run(roster, load_config("optimal"), start=date(2026, 9, 28), end=date(2026, 10, 9), seed=3))
    assert a == b
