"""Delay attribution and profiles."""
import json
from datetime import date

from causelist.attribution import STAKEHOLDERS, stakeholder_for, summarise
from causelist.behaviour import StatisticalBehaviour
from causelist.config import load_config
from causelist.learning import LearningBehaviour
from causelist import profiles
from causelist.roster import load_roster
from causelist.simulate import run


def _res():
    lb = LearningBehaviour(StatisticalBehaviour(True, 42, gaming_share=0.2))
    return run(load_roster(), load_config("optimal"), behaviour=lb, seed=42, end=date(2026, 10, 30)), lb


def test_mapping():
    assert stakeholder_for("substantive", None) is None
    assert stakeholder_for("not_reached", "Day ended before the matter was called") == "time_ran_out"
    assert stakeholder_for("adjourned", "Petitioner Absence / Non-Compliance") == "petitioner_side"
    assert stakeholder_for("not_ready", "Awaiting Process / Summons / Warrant Return") == "state_agencies"
    assert stakeholder_for("adjourned", "Judge emergency: afternoon lost") == "judge_emergency"
    assert stakeholder_for("not_ready", "Police report awaited") == "state_agencies"
    assert stakeholder_for("adjourned", "something new") == "court"


def test_attribution_sums_equal_non_substantive():
    res, _ = _res()
    a = summarise(res)
    outs = [o for d in res.days for o in d.outcomes]
    non_sub = [o for o in outs if o.kind != "substantive"]
    assert a["non_substantive"] == len(non_sub) and a["listed"] == len(outs)
    assert sum(v["count"] for v in a["by_stakeholder"].values()) == len(non_sub)
    assert abs(a["minutes_lost"]["court_total"] - sum(o.minutes_used for o in non_sub)) < 0.5
    assert sum(sum(v["count"] for v in row.values()) for row in a["by_type"].values()) == len(non_sub)
    assert sum(sum(r[s]["count"] for s in STAKEHOLDERS) for r in a["by_week"]) == len(non_sub)
    assert sum(sum(r[s] for s in STAKEHOLDERS) for r in a["by_day"]) == len(non_sub)
    assert sum(v["non_substantive"] for v in a["per_advocate"].values()) == len(non_sub)
    sought = sum(1 for o in non_sub if o.reason == "Party Sought Time / Adjournment")
    assert sum(a["sought_time_by_side"].values()) == sought
    json.dumps(a)


def test_profiles_serialisable_and_complete():
    res, lb = _res()
    p = profiles.build(res, lb)
    json.dumps(p)
    advs = {c.advocate_id for c in res.cases for d in res.days for o in d.outcomes if o.case_id == c.case_id}
    assert advs <= set(p["advocates"])
    row = next(iter(p["advocates"].values()))
    for k in ("hearings", "appearance_rate", "readiness_rate", "time_requests", "expected_requests",
              "time_seeking_ratio", "p_exceed", "adjournments_by_reason", "trips", "posterior", "gaming_flag",
              "gaming_evidence", "cases", "delay_court_minutes"):
        assert k in row
    flagged = [k for k, v in p["advocates"].items() if v["gaming_flag"]]
    for k in flagged:
        assert p["advocates"][k]["gaming_evidence"]["requests"] >= 3
    json.dumps(profiles.build(res))               # works without a learner too


def test_judge_emergency_tail_is_not_time_ran_out():
    assert stakeholder_for("not_reached", "Judge emergency — rolled with priority") == "judge_emergency"
