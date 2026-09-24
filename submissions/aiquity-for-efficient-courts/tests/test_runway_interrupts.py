from causelist import runway
from causelist.config import load_config
from causelist.roster import load_roster
from causelist.simulate import run, bail_allowed


def test_runway_and_interrupts():
    res = run(load_roster(), load_config("optimal"), seed=11)
    s = runway.summarise(res)
    assert s["cases"] == 100 and s["finishable"] >= s["finishable_typical"]
    assert s["disposed"] == sum(1 for c in res.cases if c.status == "disposed" and c.origin == "roster")
    for c in res.cases:
        for _, t in c.meta.get("interrupts", []):
            assert t in ("BAIL", "REPORTS", "APPLICATION_REVIEW")
    # bail is never filed once complainant evidence has begun
    assert all(not (t == "BAIL" and c.stage in ("EVIDENCE_COMPLAINANT", "EVIDENCE_ACCUSED", "ARGUMENTS", "JUDGEMENT"))
               for c in res.cases for _, t in c.meta.get("interrupts", []) if c.purpose == "BAIL")
