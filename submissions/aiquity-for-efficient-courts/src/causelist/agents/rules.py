"""Transparent utility model: how a persona plus its memory shifts the statistical base rates.

Start from the L2 statistical probabilities (``behaviour.conditional_probs`` times the
case multiplier), then scale them by persona/memory multipliers ``g(L) = 1 + 0.95 tanh(L)`` where ``L`` is a
weighted sum of centred trait terms. ``g`` is odd around 1 and the trait distributions are
symmetric, so a neutral persona (every trait at its centre) reproduces the statistical rates
exactly and a fresh population reproduces them on average. A tiny residual (clipping of the
distance/wage tails) is removed by dividing by the population mean ``N`` (~1.00).

Absence is split between the litigant (does the person travel to court?) and the advocate
(does counsel turn up?). Seeking time is the advocate's call.

Every weight below is a stated assumption, not a fitted value.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import date

from ..behaviour import CONFIRMED_READY_MULT, case_multiplier, conditional_probs
from ..domain import Case
from ..reference import HearingType
from .personas import AdvocatePersona, LitigantPersona, make_advocate, make_litigant

LITIGANT_SHARE = 0.6        # share of absence risk that sits with the litigant
ADVOCATE_SHARE = 1.0 - LITIGANT_SHARE
MEMORY_DECAY = 0.85         # older experiences fade (per new hearing of the same agent)

# --- litigant absence terms (positive = more likely to stay away) ---
W_TRAVEL = 0.30             # per SD of log distance
W_WAGE = 0.20               # per SD of log daily wage loss
W_TRUST = -1.6              # per unit of trust above the centre
W_APPT_WAGE = -0.15         # a real time window helps those losing most from a day in court
W_WASTED_EROSION = 0.08     # trust lost per (decayed) wasted trip, scaled by (1.5 - patience)
W_ADJ_EROSION = 0.03        # trust lost per adjournment suffered
W_APPT_REPAIR = 0.06        # trust regained per appointment that was honoured with a hearing

# --- advocate absence terms ---
W_PRESSURE_ABS = 1.2
W_RELIAB_ABS = -1.2
W_DILIG_ABS = -0.6
W_APPT_RESPONDS = -0.8      # heterogeneous response to a time window (mean zero)
W_COST_WASTE = 0.12         # per decayed wasted appearance, times cost sensitivity

# --- advocate seek-time terms ---
W_DILIG_SEEK = -1.8
W_PRESSURE_SEEK = 1.2
W_COST_SEEK = 0.4

# --- reliability memory ---
W_BROKEN = 0.06             # reliability lost per broken confirmation
W_KEPT = 0.02               # reliability gained per kept confirmation


def c(x: float) -> float:
    return x - 0.5


def clip01(x: float) -> float:
    return min(1.0, max(0.0, x))


@dataclass
class LitigantMemory:
    trips: int = 0
    wasted: float = 0.0              # decayed count of wasted trips
    wasted_total: int = 0
    adjournments_suffered: int = 0
    appointments_honoured: int = 0
    hours_lost: float = 0.0
    money_lost: float = 0.0          # wages + travel, rupees
    history: list[tuple[date, float]] = field(default_factory=list)  # (day, P(attend) on a typical hearing)


@dataclass
class AdvocateMemory:
    appearances: int = 0
    trip_days: set = field(default_factory=set)
    wasted: float = 0.0
    wasted_total: int = 0
    confirmations: int = 0
    kept: int = 0
    broken: int = 0
    hours_waited: float = 0.0
    history: list[tuple[date, float]] = field(default_factory=list)  # (day, effective reliability)


# ---------------------------------------------------------------- term builders

def trust_eff(p: LitigantPersona, m: LitigantMemory | None) -> float:
    if m is None:
        return p.trust_in_court
    erosion = W_WASTED_EROSION * m.wasted * (1.5 - p.patience) + W_ADJ_EROSION * min(m.adjournments_suffered, 10)
    return clip01(p.trust_in_court - erosion + W_APPT_REPAIR * min(m.appointments_honoured, 8))


def reliability_eff(a: AdvocatePersona, m: AdvocateMemory | None) -> float:
    if m is None:
        return a.reliability
    return clip01(a.reliability - W_BROKEN * m.broken + W_KEPT * min(m.kept, 10))


def litigant_terms(p: LitigantPersona, m: LitigantMemory | None, appt: bool) -> dict[str, float]:
    t = {
        "distance": W_TRAVEL * p.z_travel,
        "wage loss": W_WAGE * p.z_wage,
        "trust": W_TRUST * c(trust_eff(p, m)),
    }
    if appt:
        t["appointment"] = W_APPT_WAGE * p.z_wage
    return t


def advocate_abs_terms(a: AdvocatePersona, m: AdvocateMemory | None, appt: bool) -> dict[str, float]:
    t = {
        "caseload": W_PRESSURE_ABS * c(a.caseload_pressure),
        "reliability": W_RELIAB_ABS * c(reliability_eff(a, m)),
        "diligence": W_DILIG_ABS * c(a.diligence),
    }
    if appt:
        t["appointment"] = W_APPT_RESPONDS * c(a.responds_to_appointment)
    if m is not None and m.wasted:
        t["wasted appearances"] = W_COST_WASTE * min(m.wasted, 5) * a.cost_sensitivity * 2
    return t


def advocate_seek_terms(a: AdvocatePersona, m: AdvocateMemory | None) -> dict[str, float]:
    t = {
        "diligence": W_DILIG_SEEK * c(a.diligence),
        "caseload": W_PRESSURE_SEEK * c(a.caseload_pressure),
    }
    if m is not None and m.wasted:
        t["wasted appearances"] = W_COST_SEEK * min(m.wasted, 5) * c(a.cost_sensitivity)
    return t


# ---------------------------------------------------------------- normalisers

_NORM: dict[tuple[str, bool], float] = {}


def g(x: float) -> float:
    """Bounded, odd-around-1 response: g(0) = 1, range (0.05, 1.95)."""
    return 1.0 + 0.95 * math.tanh(x)


def _normalisers(appt: bool) -> tuple[float, float, float]:
    """Population mean of g(terms) for fresh personas (fixed Monte Carlo, computed once)."""
    key = ("lit", appt)
    if key not in _NORM:
        n = 6000
        lit = adv = seek = 0.0
        for i in range(n):
            p = make_litigant(f"norm-{i}", seed=-1)
            a = make_advocate(f"norm-{i}", seed=-1)
            lit += g(sum(litigant_terms(p, None, appt).values()))
            adv += g(sum(advocate_abs_terms(a, None, appt).values()))
            seek += g(sum(advocate_seek_terms(a, None).values()))
        _NORM[("lit", appt)] = lit / n
        _NORM[("adv", appt)] = adv / n
        _NORM[("seek", appt)] = seek / n
    return _NORM[("lit", appt)], _NORM[("adv", appt)], _NORM[("seek", appt)]


# ---------------------------------------------------------------- the model

@dataclass
class Propensity:
    base_absent: float           # statistical, after the case multiplier
    base_seek: float
    p_absent: float              # agent-adjusted
    p_seek: float
    litigant_mult: float
    advocate_mult: float
    seek_mult: float
    lit_terms: dict[str, float]
    adv_terms: dict[str, float]
    seek_terms: dict[str, float]
    confirm_mult: float

    @property
    def p_goes_ahead(self) -> float:
        return max(0.02, 1.0 - min(0.95, self.p_absent + self.p_seek))

    def litigant_share_of_absence(self) -> float:
        lit = LITIGANT_SHARE * self.litigant_mult
        return lit / max(1e-9, lit + ADVOCATE_SHARE * self.advocate_mult)


def confirm_multiplier(a: AdvocatePersona, m: AdvocateMemory | None) -> float:
    """Commitment effect of a confirmation: neutral reliability reproduces the statistical 0.5."""
    return min(1.0, max(0.25, 1.0 - CONFIRMED_READY_MULT * (0.4 + 1.2 * reliability_eff(a, m))))


def propensity(case: Case, ht: HearingType, appt: bool, adv: AdvocatePersona, lit: LitigantPersona,
               am: AdvocateMemory | None, lm: LitigantMemory | None, confirmed: bool | None = None) -> Propensity:
    confirmed = case.confirmed_ready if confirmed is None else confirmed
    p = conditional_probs(ht)
    m = case_multiplier(case, appt)
    if case.confirmed_ready:          # take the statistical confirmation effect out; we model our own
        m /= CONFIRMED_READY_MULT
    cm = confirm_multiplier(adv, am) if confirmed else 1.0
    m *= cm
    n_lit, n_adv, n_seek = _normalisers(appt)
    lt = litigant_terms(lit, lm, appt)
    at = advocate_abs_terms(adv, am, appt)
    st = advocate_seek_terms(adv, am)
    lit_mult = g(sum(lt.values())) / n_lit
    adv_mult = g(sum(at.values())) / n_adv
    seek_mult = g(sum(st.values())) / n_seek
    abs_mult = LITIGANT_SHARE * lit_mult + ADVOCATE_SHARE * adv_mult
    base_abs, base_seek = p["absent"] * m, p["seek"] * m
    p_abs = min(0.9, base_abs * abs_mult)
    p_seek = min(0.9 - p_abs, base_seek * seek_mult)
    return Propensity(base_abs, base_seek, p_abs, p_seek, lit_mult, adv_mult, seek_mult, lt, at, st, cm)


def top_term(terms: dict[str, float], sign: int = 1) -> tuple[str, float] | None:
    items = [(k, v) for k, v in terms.items() if v * sign > 0.05]
    return max(items, key=lambda kv: abs(kv[1])) if items else None


def p_confirm(pr_unconfirmed: Propensity, adv: AdvocatePersona, am: AdvocateMemory | None) -> float:
    """Chance an advocate confirms preparedness when the court asks.

    Advocates who expect to be ready confirm; diligent ones confirm more; unreliable ones
    over-promise a little (they confirm even when shaky, and their confirmation is worth less).
    """
    x = 8.0 * (pr_unconfirmed.p_goes_ahead - 0.72) + 2.0 * c(adv.diligence) - 1.0 * c(reliability_eff(adv, am))
    return 1.0 / (1.0 + math.exp(-x))


def propensity_litigant_mult(p: LitigantPersona, m: LitigantMemory | None, appt: bool) -> float:
    """The litigant's absence multiplier on its own (1.0 = the statistical average)."""
    return g(sum(litigant_terms(p, m, appt).values())) / _normalisers(appt)[0]
