from datetime import date

import pytest

from causelist import actions


@pytest.fixture(autouse=True)
def _tmp_rosters(tmp_path, monkeypatch):
    monkeypatch.setattr(actions, "ROSTER_DIR", tmp_path)


def test_generate_upload_and_causelist():
    g = actions.generate_roster(120, 3, "t")
    assert g["cases"] == 120
    with pytest.raises(ValueError):
        actions.upload_roster("bad", "a,b\n1,2\n")
    c = actions.causelist_for("t", "optimal", date(2026, 9, 29))
    assert c["listings"] and c["csv"].startswith("window_start")


def test_next_date_rules():
    d = date(2026, 10, 5)
    moved = actions.suggest_next_date("100", "ST/819/2023", d, "moved")
    absent = actions.suggest_next_date("100", "ST/819/2023", d, "absent")
    assert moved["rule"] == "procedural" and absent["rule"] == "absence-short"
    assert date.fromisoformat(absent["suggested"]) > d


def test_party_date_preferences_respect_the_rule():
    d = date(2026, 10, 5)
    base = actions.suggest_next_date("100", "ST/819/2023", d, "absent")
    avoid = actions.suggest_next_date("100", "ST/819/2023", d, "absent",
                                      preferences={"respondent": {"avoid": [base["suggested"]]}})
    assert avoid["suggested"] > base["suggested"]
    assert (date.fromisoformat(avoid["suggested"]) - date.fromisoformat(base["rule_date"])).days <= 14
