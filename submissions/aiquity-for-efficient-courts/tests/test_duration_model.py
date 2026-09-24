from datetime import date

from causelist.config import load_config
from causelist.duration_model import JudgeProfile, duration_multiplier, judge_from_config

D = date(2026, 10, 1)


def test_recent_hearing_is_faster_and_stale_old_file_slower():
    fresh = duration_multiplier(None, "ARGUMENTS", date(2026, 9, 29), D, 2.0)
    month = duration_multiplier(None, "ARGUMENTS", date(2026, 9, 1), D, 2.0)
    stale_old = duration_multiplier(None, "ARGUMENTS", date(2026, 3, 1), D, 6.0)
    assert fresh < month <= 1.0 < stale_old


def test_criminal_bar_is_quicker_on_trial_stages_and_experience_helps():
    crim = JudgeProfile("criminal_bar", 10)
    civ = JudgeProfile("civil_bar", 10)
    assert duration_multiplier(crim, "EVIDENCE_COMPLAINANT", None, D, 1) < duration_multiplier(civ, "EVIDENCE_COMPLAINANT", None, D, 1)
    assert duration_multiplier(JudgeProfile("criminal_bar", 0.2), "PLEA", None, D, 1) > duration_multiplier(crim, "PLEA", None, D, 1)


def test_preset_loads_judge():
    j = judge_from_config(load_config("new_judge_from_criminal_bar"))
    assert j and j.background == "criminal_bar" and j.years_on_bench == 0.5
