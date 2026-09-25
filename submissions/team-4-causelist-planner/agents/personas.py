"""Agent personalities. Synthetic until the datasets say what is known about advocates and parties.

Traits are drawn deterministically from the agent's id and a seed, so a simulation is repeatable and
the same advocate behaves the same way in every courtroom.
"""
from __future__ import annotations

import hashlib

# (trait, weight, how the agent is described to the decision model)
ADVOCATE_TRAITS = [
    ("diligent", 35, "a diligent advocate who prepares every brief"),
    ("average", 35, "an ordinary advocate with a normal practice"),
    ("overstretched", 20, "an overstretched advocate with too many matters across several courtrooms"),
    ("habitual adjourner", 10, "an advocate known for asking for adjournments"),
]
LITIGANT_TRAITS = [
    ("lives nearby", 50, "a litigant who lives near the court"),
    ("travels far", 35, "a litigant who travels several hours to reach the court"),
    ("daily-wage earner", 15, "a daily-wage earner who loses a day's pay for every trip to court"),
]
ORGANISATION = ("organisation", "a government department or company represented by an officer")


def _unit(*parts: object) -> float:
    h = hashlib.sha256("|".join(map(str, parts)).encode()).digest()
    return int.from_bytes(h[:8], "big") / 2**64


def _pick(traits: list[tuple[str, int, str]], u: float) -> tuple[str, str]:
    total = sum(w for _, w, _ in traits)
    acc = 0.0
    for name, w, text in traits:
        acc += w / total
        if u < acc:
            return name, text
    return traits[-1][0], traits[-1][2]


def advocate_trait(advocate_id: str, seed: int = 0) -> tuple[str, str]:
    return _pick(ADVOCATE_TRAITS, _unit("adv", advocate_id, seed))


def litigant_trait(party_key: str, seed: int = 0) -> tuple[str, str]:
    if party_key.startswith("ORG"):
        return ORGANISATION
    return _pick(LITIGANT_TRAITS, _unit("lit", party_key, seed))


def clash_chance(trait: str) -> float:
    """Daily chance an advocate also has a matter in another courtroom at the same time."""
    return {"overstretched": 0.45, "habitual adjourner": 0.30, "average": 0.20, "diligent": 0.15}.get(trait, 0.2)
