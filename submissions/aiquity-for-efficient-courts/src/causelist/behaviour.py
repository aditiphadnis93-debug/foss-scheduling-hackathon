"""L2 statistical behaviour: parties act according to the observed per-type distributions,
adjusted by what we know about the individual case.

Conditioning: the organiser tables give, per hearing type, P(substantive) and the split of
non-substantive reasons. Prerequisite failures (process unserved, filing not ready) are
modelled as case *state* by the simulator (``Case.ready_on``), so here we work with the
distribution *conditional on prerequisites being met*.
"""
from __future__ import annotations

import hashlib
import random
from datetime import date

from .domain import Case, HearingOutcome
from .interfaces import AttendanceDecision, HearingContext
from .reference import HearingType

SOUGHT_TIME = "Party Sought Time / Adjournment"
ABSENCE_REASONS = [
    "Respondent Absence / Non-Compliance",
    "Petitioner Absence / Non-Compliance",
    "Both Parties Unready / Absent",
]

# Stated assumptions (documented in SUBMISSION.md). Multipliers on the base probability.
ACCUSED_ABSENT_LAST_MULT = 1.4    # absent last time -> more likely absent again
REPEAT_ADJOURN_MULT = 1.15        # per consecutive adjournment, capped
CONFIRMED_READY_MULT = 0.5        # side confirmed preparedness in advance (goal 4)
APPOINTMENT_MULT = 0.85           # a real time window instead of an all-day wait (goal 3)
ADVOCATE_DAY_ABSENCE = 0.05       # P(an advocate is unavailable for the whole day) -- correlated failure

# --- Strategic delay (gaming) -------------------------------------------------------------
# A deterministic subset of advocates (share ``gaming_share``) seek time more often as their case
# nears evidence, arguments and judgement. The multiplier applies to max(table rate, floor): the
# organiser table has a zero time-sought rate at some stages, where a pure multiplier would do nothing.
STRATEGIC_STAGE_MULT = {
    "PLEA": 1.3,
    "EXAMINATION_UNDER_S351_BNSS": 1.3,
    "EVIDENCE_COMPLAINANT": 1.8,
    "EVIDENCE_ACCUSED": 1.8,
    "ARGUMENTS": 2.5,
    "JUDGEMENT": 2.5,
}
STRATEGIC_SEEK_FLOOR = 0.10       # base the multiplier works on where the table rate is lower
SIDE_SHARE_PETITIONER = 0.5       # share of ordinary time requests made by the advocate-on-record's side
PLAUSIBLE_REASONS = [
    "counsel seeks time to file additional documents",
    "witness not available today; time sought to secure attendance",
    "counsel engaged in a matter before another court",
    "time sought to take fresh instructions from the client",
    "time sought to explore settlement between the parties",
    "certified copies awaited; short accommodation sought",
    "counsel unwell; proxy seeks a short date",
]


def conditional_probs(ht: HearingType) -> dict[str, float]:
    """Absence / seek-time / court-side failure, conditional on prerequisites being met."""
    q = max(1e-6, 1.0 - ht.p_prereq)
    non_sub = 1.0 - ht.p_substantive
    p_seek = non_sub * ht.reason_shares.get(SOUGHT_TIME, 0.0) / q
    p_abs = non_sub * sum(ht.reason_shares.get(r, 0.0) for r in ABSENCE_REASONS) / q
    p_court = ht.p_court / q
    return {"absent": p_abs, "seek": p_seek, "court": p_court}


def case_multiplier(case: Case, appointment: bool) -> float:
    m = 1.0
    if case.accused_absent_last:
        m *= ACCUSED_ABSENT_LAST_MULT
    m *= REPEAT_ADJOURN_MULT ** min(case.adjournments_in_row, 4)
    if case.confirmed_ready:
        m *= CONFIRMED_READY_MULT
    if appointment:
        m *= APPOINTMENT_MULT
    from .priors import kind_factors       # turning up by dispute type (court master list)
    m *= kind_factors(case)[1]
    return m


def p_goes_ahead(case: Case, ht: HearingType, appointment: bool = True) -> float:
    """Planner-side estimate: P(called hearing proceeds), prerequisites assumed met."""
    p = conditional_probs(ht)
    m = case_multiplier(case, appointment)
    return max(0.02, 1.0 - min(0.95, (p["absent"] + p["seek"]) * m))


def _unit(*parts) -> float:
    """Deterministic uniform draw in [0, 1) from a hash (no RNG consumed)."""
    h = hashlib.sha256("|".join(str(p) for p in parts).encode()).digest()
    return int.from_bytes(h[:8], "big") / 2 ** 64


def is_strategic(advocate_id: str, seed: int, share: float) -> bool:
    """Whether an advocate belongs to the strategic subset (hash of id and seed; ground truth only)."""
    return share > 0 and _unit("strategic", seed, advocate_id) < share


def strategic_seek(p_seek: float, stage_code: str, strategic: bool, share: float) -> tuple[float, float]:
    """(ordinary time-sought probability, strategic extra) for one hearing.

    Marginal preservation: with share s and stage multiplier k the extra for a strategic advocate is
    (k - 1) * max(p, floor). Everyone's ordinary rate is scaled to p / (1 + s(k - 1)) where the
    table rate p is at least the floor, so the population mean stays exactly p in expectation over
    the advocate draw. Where p is below the floor (zero in the table at some stages) nothing can be
    taken away, and the marginal rises by s(k - 1) * floor (about 1.2 points at 8% and k = 2.5).
    """
    k = STRATEGIC_STAGE_MULT.get(stage_code, 1.0)
    if share <= 0 or k <= 1.0:
        return p_seek, 0.0
    base = p_seek / (1.0 + share * (k - 1.0)) if p_seek >= STRATEGIC_SEEK_FLOOR else p_seek
    extra = (k - 1.0) * max(base, STRATEGIC_SEEK_FLOOR) if strategic else 0.0
    return base, extra


def advocate_unavailable(advocate_id: str, day: date, seed: int, p: float = ADVOCATE_DAY_ABSENCE) -> bool:
    """Shared advocate-day latent: the same draw for every matter of that advocate that day."""
    h = hashlib.sha256(f"{seed}|{advocate_id}|{day.isoformat()}".encode()).digest()
    return int.from_bytes(h[:8], "big") / 2 ** 64 < p


class StatisticalBehaviour:
    """Observed per-type rates, adjusted per case.

    With ``advocate_correlation`` an advocate is unavailable for the whole day with probability
    ``ADVOCATE_DAY_ABSENCE``; all their matters then fail together. The per-matter absence
    rate is reduced so the *marginal* absence rate still equals the observed table.
    """
    name = "statistical"

    def __init__(self, advocate_correlation: bool = True, seed: int = 42, gaming_share: float = 0.0,
                 absence_mult: float = 1.0):
        self.advocate_correlation = advocate_correlation
        self.seed = seed
        self.gaming_share = float(gaming_share or 0.0)
        self.absence_mult = 1.0 if absence_mult is None else float(absence_mult)   # what-if slider on p_abs

    def is_strategic(self, advocate_id: str) -> bool:
        return is_strategic(advocate_id, self.seed, self.gaming_share)

    def _mark_truth(self, case: Case) -> None:
        # evaluation ground truth only: the planner and the learner never read this key
        if self.gaming_share > 0 and "strategic_truth" not in case.meta:
            case.meta["strategic_truth"] = {"advocate": case.advocate_id,
                                            "strategic": self.is_strategic(case.advocate_id),
                                            "side": "petitioner"}

    def readiness_signal(self, cases: list[Case], day: date) -> dict[str, float]:
        for c in cases:
            self._mark_truth(c)
        return {}

    def decide(self, ctx: HearingContext, rng: random.Random) -> AttendanceDecision:
        p = conditional_probs(ctx.hearing_type)
        m = case_multiplier(ctx.case, ctx.was_given_appointment)
        p_abs = min(0.9, p["absent"] * m * self.absence_mult)
        extra = 0.0
        if self.gaming_share > 0:
            self._mark_truth(ctx.case)
            base, extra = strategic_seek(p["seek"], ctx.hearing_type.code,
                                         self.is_strategic(ctx.case.advocate_id), self.gaming_share)
            p_seek = min(0.9 - p_abs, (base + extra) * m)
            extra = min(extra * m, p_seek)
        else:
            p_seek = min(0.9 - p_abs, p["seek"] * m)
        if self.advocate_correlation:
            q = ADVOCATE_DAY_ABSENCE
            if advocate_unavailable(ctx.case.advocate_id, ctx.day, self.seed, q):
                return AttendanceDecision(False, False, False, "Petitioner Absence / Non-Compliance",
                                          rationale="advocate unavailable all day", source=self.name)
            p_abs = max(0.0, (p_abs - q) / (1 - q))
        u = rng.random()
        if u < p_abs:
            shares = [ctx.hearing_type.reason_shares.get(r, 0.0) for r in ABSENCE_REASONS]
            reason = rng.choices(ABSENCE_REASONS, weights=shares if sum(shares) else None)[0]
            return AttendanceDecision(False, False, False, reason, source=self.name)
        if u < p_abs + p_seek:
            return self._seek(ctx, p_seek, extra)
        return AttendanceDecision(True, True, False, None, source=self.name)

    def _seek(self, ctx: HearingContext, p_seek: float, extra: float) -> AttendanceDecision:
        """A time request: record which side asked (observable in any court record).

        Ordinary requests come from either side (``SIDE_SHARE_PETITIONER``); a strategic advocate's
        extra requests come from their own side. Side and wording use hashed draws, so the RNG
        stream (and every run without gaming) is unchanged.
        """
        c, d = ctx.case, ctx.day.isoformat()
        ordinary = max(p_seek - extra, 0.0)
        p_pet = (SIDE_SHARE_PETITIONER * ordinary + extra) / max(p_seek, 1e-12)
        side = "petitioner" if _unit("side", self.seed, c.case_id, d) < p_pet else "respondent"
        c.meta["last_request"] = {"day": d, "side": side}
        c.meta.setdefault("time_requests", []).append([d, side])
        rationale = ""
        if self.gaming_share > 0:
            i = int(_unit("why", self.seed, c.case_id, d) * len(PLAUSIBLE_REASONS))
            rationale = f"{side} side: {PLAUSIBLE_REASONS[i]}"
        return AttendanceDecision(True, False, True, SOUGHT_TIME, rationale=rationale, source=self.name)

    def observe(self, ctx: HearingContext, outcome: HearingOutcome) -> None:
        return None
