"""Behavioural agents (section 6.7).

Each case has a Litigant (party_id) and an Advocate (advocate_id, shared across that
advocate's matters). Each agent has a reliability trait drawn once from the seed.
Their decisions respond to the schedule (fixed slot, notice, clustering, fatigue from
not-reached listings) and change it in turn: a no-show becomes an adjournment, which
becomes a new next date, which changes the next decision.
"""
from __future__ import annotations

from dataclasses import dataclass

from . import rng
from .rules import Rules


def litigant_trait(seed: int, party_id: str, sd: float) -> float:
    return rng.normal(0.0, sd, seed, "litigant", party_id, "trait")


def advocate_trait(seed: int, advocate_id: str, sd: float) -> float:
    return rng.normal(0.0, sd, seed, "advocate", advocate_id, "trait")


def clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))


@dataclass(frozen=True)
class ListingContext:
    """What an agent can see about this listing."""
    slot_given: bool
    notice_days: int
    last_chance: bool
    not_reached_count: int
    advocate_matters_in_block: int


def show_prob(base: float, ctx: ListingContext, party_id: str, seed: int, rules: Rules) -> float:
    a = rules.agents
    if not a.enabled:
        return base
    s = (base
         + litigant_trait(seed, party_id, a.trait_sd)
         + a.slot_bonus * ctx.slot_given
         + a.notice_bonus * (ctx.notice_days >= a.notice_min_days)
         + a.last_chance_bonus * ctx.last_chance
         - min(a.fatigue_per_miss * ctx.not_reached_count, a.fatigue_cap))
    return clamp(s, 0.05, 0.99)


def prep_prob(base: float, ctx: ListingContext, advocate_id: str, seed: int, rules: Rules) -> float:
    a = rules.agents
    if not a.enabled:
        return base
    p = (base
         + advocate_trait(seed, advocate_id, a.trait_sd)
         + a.cluster_bonus * (ctx.advocate_matters_in_block >= 2))
    return clamp(p, 0.05, 0.99)
