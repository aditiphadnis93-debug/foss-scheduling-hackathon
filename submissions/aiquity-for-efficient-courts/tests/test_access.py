from causelist import access
from causelist.config import load_config
from causelist.roster import load_roster
from causelist.simulate import run


def test_ours_saves_hours_and_gives_windows():
    r = load_roster()
    o = access.summarise(run(r, load_config("optimal"), seed=3))
    b = access.summarise(run(r, load_config("baseline"), seed=3))
    assert o["visibility"]["time_window_pct"] == 100.0 and b["visibility"]["time_window_pct"] == 0.0
    assert o["possibility"]["life_hours_per_hearing_moved"] < b["possibility"]["life_hours_per_hearing_moved"]
    assert b["possibility"]["actions_open"] == []
