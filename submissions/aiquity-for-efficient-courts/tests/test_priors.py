from causelist.config import load_config
from causelist.priors import effective_types, master_list
from causelist.reference import load_hearing_types
from causelist.roster import load_roster
from causelist.simulate import run
from causelist.learning import LearningBehaviour
from causelist.behaviour import StatisticalBehaviour


def test_court_master_list_matches_organiser_by_default():
    org, eff = load_hearing_types(), effective_types(load_config("optimal"))
    assert all(abs(org[k].minutes - eff[k].minutes) < 1e-9 for k in org)


def test_judge_override_applies_and_is_bounded():
    cfg = load_config("block_schedule")
    eff = effective_types(cfg)
    assert eff["EVIDENCE_COMPLAINANT"].minutes == 40
    assert abs(eff["ARGUMENTS"].minutes - load_hearing_types()["ARGUMENTS"].minutes * 1.2) < 1e-9
    cfg.priors = {"PLEA": {"minutes": 9999, "p_substantive": 5}}
    e2 = effective_types(cfg)["PLEA"]
    assert e2.minutes == 240 and e2.p_substantive == 1.0


def test_master_list_reports_learned_per_type():
    cfg = load_config("optimal")
    types = effective_types(cfg)
    beh = LearningBehaviour(StatisticalBehaviour(True, 5), types, 5)
    res = run(load_roster(), cfg, behaviour=beh, seed=5)
    ml = master_list(cfg, beh.learned_by_type())
    learned = [r for r in ml["rows"] if r["learned"]]
    assert learned and all(0 <= r["learned"]["posterior_go_ahead"] <= 1 for r in learned)
