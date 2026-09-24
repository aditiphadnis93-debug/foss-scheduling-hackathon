"""Hearing phases for the court-day clock.

Every hearing that uses court time is split into three phases:

* ``call``      -- call of the matter and appearance check
* ``hearing``   -- submissions / evidence
* ``order``     -- order dictation / judge deciding

The shares below are stated assumptions (no organiser data splits a hearing). Per hearing the
split is sampled from a Dirichlet centred on the shares (concentration ``CONCENTRATION``), so the
phase seconds always add up to exactly the hearing's sampled duration. Sampling is keyed on
(seed, case, day) so an export is reproducible and does not touch the simulator's random stream.
"""
from __future__ import annotations

import hashlib
import random

PHASE_NAMES = {"call": "Call & appearance check", "hearing": "Submissions / evidence",
               "order": "Order dictation / judge deciding"}
CONCENTRATION = 30.0

# (call, hearing, order) shares of a substantive hearing, per purpose
SUBSTANTIVE_SHARES: dict[str, tuple[float, float, float]] = {
    "ADMISSION": (0.30, 0.40, 0.30),
    "COGNIZANCE": (0.20, 0.40, 0.40),
    "DELAY_CONDONATION_HEARING": (0.20, 0.50, 0.30),
    "APPEARANCE": (0.50, 0.20, 0.30),
    "WARRANT": (0.50, 0.10, 0.40),
    "PLEA": (0.30, 0.40, 0.30),
    "EXAMINATION_UNDER_S351_BNSS": (0.10, 0.75, 0.15),
    "EVIDENCE_COMPLAINANT": (0.10, 0.80, 0.10),
    "EVIDENCE_ACCUSED": (0.10, 0.80, 0.10),
    "ARGUMENTS": (0.05, 0.85, 0.10),
    "JUDGEMENT": (0.05, 0.15, 0.80),
    "BAIL": (0.15, 0.55, 0.30),
    "REPORTS": (0.30, 0.30, 0.40),
    "APPLICATION_REVIEW": (0.20, 0.50, 0.30),
}
DEFAULT_SHARES = (0.20, 0.50, 0.30)
# a matter called but not proceeding: the call, then a short adjournment order
NON_SUBSTANTIVE_SHARES = (0.60, 0.0, 0.40)


def shares_for(purpose: str, kind: str) -> tuple[float, float, float]:
    if kind == "substantive":
        return SUBSTANTIVE_SHARES.get(purpose, DEFAULT_SHARES)
    return NON_SUBSTANTIVE_SHARES


def split(purpose: str, kind: str, minutes: float, key: str) -> list[dict]:
    """``[{name, seconds}]`` summing to round(minutes * 60); empty when no court time was used."""
    total = int(round(minutes * 60))
    if total <= 0 or kind == "not_reached":
        return []
    rng = random.Random(int.from_bytes(hashlib.sha256(key.encode()).digest()[:8], "big"))
    shares = shares_for(purpose, kind)
    draws = [rng.gammavariate(CONCENTRATION * s, 1.0) if s > 0 else 0.0 for s in shares]
    tot = sum(draws) or 1.0
    secs = [int(total * d / tot) for d in draws]
    # give the rounding remainder to the largest phase so the sum is exact
    secs[max(range(3), key=lambda i: draws[i])] += total - sum(secs)
    return [{"name": PHASE_NAMES[n], "seconds": s} for n, s in zip(("call", "hearing", "order"), secs) if s > 0]
