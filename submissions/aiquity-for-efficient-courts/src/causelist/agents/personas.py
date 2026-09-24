"""Synthetic personas for the people behind each case.

Every case has two agents: its advocate (shared across that advocate's cases) and its
party (the litigant who has to travel to court). Traits are drawn deterministically from
the agent id and a seed, so the same roster always gets the same people.

All 0..1 traits are drawn from Beta(2, 2): centred on 0.5, which is the "neutral" value the
utility model treats as the statistical average. Distances and wages are log-normal around
a median, and enter the model as standardised log values (z-scores).
"""
from __future__ import annotations

import hashlib
import math
import random
from dataclasses import asdict, dataclass

TRAVEL_MEDIAN_KM = 12.0
TRAVEL_SIGMA = 0.8
WAGE_MEDIAN = 600.0          # daily earnings lost by a day in court (rupees)
WAGE_SIGMA = 0.5


def stable_int(*parts: object) -> int:
    """Process-independent hash (Python's ``hash`` is salted per process)."""
    return int.from_bytes(hashlib.sha256("|".join(map(str, parts)).encode()).digest()[:8], "big")


def stable_uniform(*parts: object) -> float:
    return stable_int(*parts) / 2 ** 64


def stable_rng(*parts: object) -> random.Random:
    return random.Random(stable_int(*parts))


@dataclass(frozen=True)
class AdvocatePersona:
    advocate_id: str
    diligence: float                # prepares files on time
    caseload_pressure: float        # juggling many courts -> clashes, requests for time
    reliability: float              # keeps commitments (a confirmation means something)
    responds_to_appointment: float  # how much a real time window changes their day
    cost_sensitivity: float         # reacts to wasted appearances by sending proxies / skipping

    def as_dict(self) -> dict:
        return asdict(self)


@dataclass(frozen=True)
class LitigantPersona:
    party_id: str
    travel_km: float                # one way
    daily_wage_loss: float          # rupees lost for a full day away from work
    trust_in_court: float           # belief that turning up will lead somewhere
    patience: float                 # how slowly wasted trips erode that belief

    @property
    def z_travel(self) -> float:
        return (math.log(self.travel_km) - math.log(TRAVEL_MEDIAN_KM)) / TRAVEL_SIGMA

    @property
    def z_wage(self) -> float:
        return (math.log(self.daily_wage_loss) - math.log(WAGE_MEDIAN)) / WAGE_SIGMA

    def as_dict(self) -> dict:
        return asdict(self)


def _beta(rng: random.Random) -> float:
    return rng.betavariate(2.0, 2.0)


def _lognormal(rng: random.Random, median: float, sigma: float, lo: float, hi: float) -> float:
    return min(hi, max(lo, median * math.exp(rng.gauss(0.0, sigma))))


def make_advocate(advocate_id: str, seed: int = 0, neutral: bool = False) -> AdvocatePersona:
    if neutral:
        return AdvocatePersona(advocate_id, 0.5, 0.5, 0.5, 0.5, 0.5)
    r = stable_rng("advocate", seed, advocate_id)
    return AdvocatePersona(advocate_id, *(round(_beta(r), 3) for _ in range(5)))


def make_litigant(party_id: str, seed: int = 0, neutral: bool = False) -> LitigantPersona:
    if neutral:
        return LitigantPersona(party_id, TRAVEL_MEDIAN_KM, WAGE_MEDIAN, 0.5, 0.5)
    r = stable_rng("litigant", seed, party_id)
    km = round(_lognormal(r, TRAVEL_MEDIAN_KM, TRAVEL_SIGMA, 1.0, 200.0), 1)
    wage = round(_lognormal(r, WAGE_MEDIAN, WAGE_SIGMA, 200.0, 5000.0), -1)
    return LitigantPersona(party_id, km, wage, round(_beta(r), 3), round(_beta(r), 3))
