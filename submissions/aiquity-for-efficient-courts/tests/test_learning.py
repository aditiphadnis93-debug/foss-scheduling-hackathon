"""Online learning, strategic-delay behaviour and detection."""
import random
from datetime import date, timedelta

import pytest

from causelist.behaviour import (SOUGHT_TIME, STRATEGIC_STAGE_MULT, StatisticalBehaviour, conditional_probs,
                                 is_strategic, p_goes_ahead, strategic_seek)
from causelist.config import load_config
from causelist.domain import Case, HearingOutcome, Listing
from causelist.interfaces import AttendanceDecision, HearingContext
from causelist.learning import LearningBehaviour, beta_cdf, p_exceed, respondent_actor
from causelist.metrics import score
from causelist.reference import load_hearing_types
from causelist.roster import load_roster
from causelist.simulate import run

TYPES = load_hearing_types()
D0 = date(2026, 10, 1)


def _case(cid="C-1", adv="ADV-A", party="P-1", purpose="ARGUMENTS"):
    return Case(cid, cid, date(2020, 1, 1), adv, party, purpose, purpose)


class Scripted:
    """Inner behaviour that plays back a fixed decision (and records who asked for time)."""
    name = "scripted"

    def __init__(self, kind="ahead", side="petitioner"):
        self.kind, self.side = kind, side

    def readiness_signal(self, cases, day):
        return {}

    def decide(self, ctx, rng):
        if self.kind == "absent":
            return AttendanceDecision(False, False, False, "Petitioner Absence / Non-Compliance")
        if self.kind == "seek":
            ctx.case.meta["last_request"] = {"day": ctx.day.isoformat(), "side": self.side}
            ctx.case.meta.setdefault("time_requests", []).append([ctx.day.isoformat(), self.side])
            return AttendanceDecision(True, False, True, SOUGHT_TIME)
        return AttendanceDecision(True, True, False)

    def observe(self, ctx, outcome):
        return None


def _hear(lb, case, day, inner_kind=None):
    ht = TYPES[case.purpose]
    lst = Listing(case.case_id, day, "any", 0, 30, case.purpose, case.advocate_id, 10.0, 0.5, 0.3, 1.0)
    ctx = HearingContext(case, lst, ht, day, None, True)
    if inner_kind:
        lb.inner.kind = inner_kind
    dec = lb.decide(ctx, random.Random(0))
    if not dec.appears:
        out = HearingOutcome(case.case_id, day, case.purpose, "adjourned", dec.reason, 1.0, case.purpose, None)
    elif dec.seeks_adjournment:
        out = HearingOutcome(case.case_id, day, case.purpose, "adjourned", dec.reason, 3.0, case.purpose, None)
    else:
        out = HearingOutcome(case.case_id, day, case.purpose, "substantive", None, 20.0, case.purpose, None)
    lb.observe(ctx, out)


def test_beta_cdf_matches_reference():
    sp = pytest.importorskip("scipy.stats")
    for x, a, b in [(0.3, 2.0, 5.0), (0.05, 0.4, 7.6), (0.9, 12.0, 3.0), (0.5, 30.0, 30.0)]:
        assert abs(beta_cdf(x, a, b) - sp.beta.cdf(x, a, b)) < 1e-8


def test_posterior_moves_toward_observed_rate():
    case = _case(purpose="APPLICATION_REVIEW")
    lb = LearningBehaviour(Scripted("absent"))
    prior = p_goes_ahead(case, TYPES["APPLICATION_REVIEW"], True)
    for i in range(12):
        _hear(lb, case, D0 + timedelta(days=i))
    mean, lo, hi, n = lb.posterior("ADV-A")
    assert n == 12 and lo < mean < hi
    assert mean < prior - 0.3                       # moved toward the observed 0% go-ahead
    # a fresh case of the same advocate inherits the learned level
    other = _case("C-2", "ADV-A", "P-2", "APPLICATION_REVIEW")
    sig = lb.readiness_signal([other], D0 + timedelta(days=20))
    assert sig["C-2"] < p_goes_ahead(other, TYPES["APPLICATION_REVIEW"], True) - 0.2
    # and an advocate who always goes ahead moves up (or stays at the ceiling)
    good = _case("C-3", "ADV-B", "P-3", "DELAY_CONDONATION_HEARING")
    lb.inner.kind = "ahead"
    for i in range(12):
        _hear(lb, good, D0 + timedelta(days=i))
    assert lb.posterior("ADV-B")[0] > p_goes_ahead(good, TYPES["DELAY_CONDONATION_HEARING"], True)


def test_flags_the_requesting_side_only():
    lb = LearningBehaviour(Scripted("seek", side="petitioner"))
    gamer = _case("C-1", "ADV-G", "P-1", "ARGUMENTS")
    other = _case("C-9", "ADV-G", "P-9", "JUDGEMENT")      # another open matter of the same advocate
    lb.readiness_signal([gamer, other], D0)
    for i in range(6):
        _hear(lb, gamer, D0 + timedelta(days=i))
    flags = lb.flags()
    assert "ADV-G" in flags and flags["ADV-G"]["side"] == "advocate"
    assert respondent_actor("C-1") not in flags
    ev = gamer.meta["gaming_flag"]["evidence"]
    assert set(ev) >= {"requests", "expected", "ratio", "p_exceed", "hearings"}
    assert ev["requests"] >= 3 and ev["p_exceed"] > 0.9
    assert other.meta["gaming_flag"]["actor"] == "ADV-G"   # all the advocate's open cases carry it

    lb2 = LearningBehaviour(Scripted("seek", side="respondent"))
    c = _case("C-5", "ADV-H", "P-5", "ARGUMENTS")
    for i in range(6):
        _hear(lb2, c, D0 + timedelta(days=i))
    f2 = lb2.flags()
    assert respondent_actor("C-5") in f2 and f2[respondent_actor("C-5")]["side"] == "respondent"
    assert "ADV-H" not in f2 and "P-5" not in f2


def test_ordinary_rate_is_not_flagged():
    lb = LearningBehaviour(Scripted("ahead"))
    c = _case("C-1", "ADV-O", "P-1", "ARGUMENTS")
    for i in range(20):                                 # 2 requests in 20 arguments hearings: below expected
        _hear(lb, c, D0 + timedelta(days=i), "seek" if i in (3, 11) else "ahead")
    assert not lb.flags() and "gaming_flag" not in c.meta
    assert p_exceed(2, 20, 20 * 0.5 * conditional_probs(TYPES["ARGUMENTS"])["seek"]) < 0.5


def test_flag_cleared_when_evidence_fades():
    lb = LearningBehaviour(Scripted("seek"))
    c = _case("C-1", "ADV-F", "P-1", "ARGUMENTS")
    for i in range(4):
        _hear(lb, c, D0 + timedelta(days=i))
    assert "ADV-F" in lb.flags()
    for i in range(4, 60):
        _hear(lb, c, D0 + timedelta(days=i), "ahead")
    assert "ADV-F" not in lb.flags() and "gaming_flag" not in c.meta


def test_strategic_share_and_marginal():
    ids = [f"ADV-{i}" for i in range(4000)]
    share = sum(is_strategic(a, 42, 0.08) for a in ids) / len(ids)
    assert 0.06 < share < 0.10
    assert not any(is_strategic(a, 42, 0.0) for a in ids)
    for code in STRATEGIC_STAGE_MULT:
        p = conditional_probs(TYPES[code])["seek"]
        base, extra = strategic_seek(p, code, True, 0.08)
        base_n, extra_n = strategic_seek(p, code, False, 0.08)
        assert extra_n == 0.0 and extra > 0 and base == base_n
        marginal = 0.92 * base_n + 0.08 * (base + extra)
        assert marginal == pytest.approx(p, abs=0.013)  # exact where p >= floor, +<=1.2 points elsewhere
        if p >= 0.10:
            assert marginal == pytest.approx(p, abs=1e-9)


def test_gaming_off_is_unchanged():
    roster = load_roster()
    cfg = load_config("optimal")
    end = date(2026, 10, 16)
    a = run(roster, cfg, behaviour=StatisticalBehaviour(True, 42), seed=42, end=end)
    b = run(roster, cfg, behaviour=StatisticalBehaviour(True, 42, gaming_share=0.0), seed=42, end=end)
    assert [(o.case_id, o.kind, o.reason) for d in a.days for o in d.outcomes] == \
           [(o.case_id, o.kind, o.reason) for d in b.days for o in d.outcomes]
    assert not any("strategic_truth" in c.meta for c in a.cases)


def test_learning_run_reports_new_keys():
    roster = load_roster()
    cfg = load_config("optimal")
    lb = LearningBehaviour(StatisticalBehaviour(True, 42, gaming_share=0.3))
    res = run(roster, cfg, behaviour=lb, seed=42, end=date(2026, 11, 13))
    s = score(res)
    for k in ("gaming_flags", "gaming_precision", "gaming_recall", "learning_brier", "state_agency_delay_pct",
              "delay_share_petitioner_side_pct", "delay_share_time_ran_out_pct"):
        assert k in s
    assert 0.0 <= s["learning_brier"] <= 1.0
    assert any("strategic_truth" in c.meta for c in res.cases)
    b = lb.brier()
    assert b["n"] > 0 and b["learned"] is not None


def test_absence_mult_raises_absence():
    ht = TYPES["EVIDENCE_COMPLAINANT"]
    def rate(mult):
        b = StatisticalBehaviour(False, 42, absence_mult=mult)
        rng = random.Random(1)
        n = 0
        for i in range(3000):
            c = _case(f"C-{i}", f"ADV-{i}", f"P-{i}", "EVIDENCE_COMPLAINANT")
            lst = Listing(c.case_id, D0, "any", 0, 30, c.purpose, c.advocate_id, 10.0, 0.5, 0.3, 1.0)
            n += not b.decide(HearingContext(c, lst, ht, D0, None, True), rng).appears
        return n / 3000
    assert rate(1.5) > rate(1.0) + 0.1
