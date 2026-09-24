"""Common random numbers (section 5.1).

Every draw is keyed by (seed, filing_number, date, purpose, draw_name) and
derived from a stable hash, so:
- the same seed always gives the same result;
- moving case A never changes the draws of case B, which keeps
  "with vs without override" comparisons fair.
"""
from __future__ import annotations

import hashlib
import math
from statistics import NormalDist

import numpy as np

_TWO_64 = float(2**64)
_STD_NORMAL = NormalDist()


def _key(seed: int, parts: tuple) -> bytes:
    return "|".join([str(seed), *(str(p) for p in parts)]).encode()


def hash64(seed: int, *parts) -> int:
    return int.from_bytes(hashlib.blake2b(_key(seed, parts), digest_size=8).digest(), "little")


def rng_for(seed: int, *parts) -> np.random.Generator:
    """A numpy Generator seeded from the stable hash of the key."""
    return np.random.default_rng(hash64(seed, *parts))


def uniform(seed: int, *parts) -> float:
    """U(0, 1), strictly inside the interval. Cheaper than building a Generator."""
    return (hash64(seed, *parts) + 0.5) / _TWO_64


def bernoulli(p: float, seed: int, *parts) -> bool:
    return uniform(seed, *parts) < p


def normal(mu: float, sd: float, seed: int, *parts) -> float:
    return mu + sd * _STD_NORMAL.inv_cdf(uniform(seed, *parts))


def lognormal_median(median: float, sigma: float, seed: int, *parts) -> float:
    return median * math.exp(sigma * _STD_NORMAL.inv_cdf(uniform(seed, *parts)))


def choice(weights: dict, seed: int, *parts):
    """Pick a key with probability proportional to its weight (keys in insertion order)."""
    total = sum(w for w in weights.values() if w > 0)
    if total <= 0:
        raise ValueError("choice() needs at least one positive weight")
    u = uniform(seed, *parts) * total
    acc = 0.0
    last = None
    for k, w in weights.items():
        if w <= 0:
            continue
        acc += w
        last = k
        if u < acc:
            return k
    return last
