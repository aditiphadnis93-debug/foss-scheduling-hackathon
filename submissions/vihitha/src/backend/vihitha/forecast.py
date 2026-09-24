"""When does a case end? (spec v3 section 4). Monte Carlo over the remaining stages.

Per remaining stage: hearings needed ~ Geometric(chance it moves forward); each hearing is
followed by the reference gap for that type. Settlement (per reached hearing) can end a
path early. Paths start at the case's next scheduled date, else today.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta

import numpy as np

from . import rng
from .calendar import fmt_day
from .enums import INTERRUPTS, SEQUENTIAL, STAGE_INDEX, HearingType
from .reference import Reference

H = HearingType
DEFAULT_PATHS = 200
OPTIONAL = {H.DELAY_CONDONATION_HEARING, H.WARRANT}


@dataclass
class Forecast:
    p10: date
    p50: date
    p90: date
    prob_ends_by_horizon: float
    remaining_stages: list[dict]
    how_it_ends: str
    explanation: str
    median_days: int
    prob_settles: float


def remaining_stages(stage: HearingType, next_purpose: HearingType) -> list[HearingType]:
    """Sequence from the current stage to JUDGEMENT; optional stages only if the case is in them."""
    idx = STAGE_INDEX.get(stage, 0)
    seq = [h for h in SEQUENTIAL[idx:] if h not in OPTIONAL or h == stage]
    if next_purpose in INTERRUPTS:
        seq = [next_purpose] + seq
    return seq


def _paths(stages: list[HearingType], ref: Reference, seed: int, paths: int, settlement_prob: float):
    """Simulated days-to-end for a remaining-stage sequence (sorted), shared by every case at that
    point of the lifecycle and cached: a case's forecast is this distribution shifted to its start
    date, so re-planning dates never needs a new simulation."""
    key = ("forecast-paths", tuple(h.value for h in stages), seed, paths, settlement_prob)
    hit = ref.cache.get(key)
    if hit is not None:
        return hit
    g = rng.rng_for(seed, "forecast", *key[1])
    p = np.array([max(min(ref.p_sub(h), 1.0), 1e-3) for h in stages])
    gaps = np.array([ref.gap(h) for h in stages], dtype=float)

    hearings = g.geometric(p[:, None], size=(len(stages), paths))  # [stages, paths], >= 1
    days_per_stage = hearings * gaps[:, None]
    total_h = hearings.sum(axis=0)
    # The last hearing (judgement) ends the case: no gap after it.
    total_days = days_per_stage.sum(axis=0) - gaps[-1]

    settled = np.zeros(paths, dtype=bool)
    if settlement_prob > 0:
        s = g.geometric(settlement_prob, size=paths)  # hearing index at which parties settle
        settled = s < total_h
        cum_h = np.cumsum(hearings, axis=0)  # [stages, paths]
        cum_d = np.cumsum(days_per_stage, axis=0)
        for j in np.nonzero(settled)[0]:
            k = int(np.searchsorted(cum_h[:, j], s[j]))  # stage where hearing s falls
            before_h = cum_h[k - 1, j] if k > 0 else 0
            before_d = cum_d[k - 1, j] if k > 0 else 0.0
            total_days[j] = before_d + (s[j] - before_h - 1) * gaps[k]
    out = (np.sort(np.maximum(total_days, 0)), round(float(settled.mean()), 3), p, gaps)
    ref.cache[key] = out
    return out


def forecast_case(case_id: str, stage: HearingType, next_purpose: HearingType, start: date, horizon_end: date,
                  ref: Reference, seed: int = 42, paths: int = DEFAULT_PATHS,
                  settlement_prob: float = 0.02) -> Forecast:
    stages = remaining_stages(stage, next_purpose)
    total_days, settled_rate, p, gaps = _paths(stages, ref, seed, paths, settlement_prob)

    q10, q50, q90 = (int(round(v)) for v in np.percentile(total_days, [10, 50, 90]))
    horizon = (horizon_end - start).days
    prob = float(np.searchsorted(total_days, horizon, side="right") / len(total_days)) if horizon >= 0 else 0.0
    rem = [{"stage": h.value, "expected_hearings": round(1.0 / pp, 1),
            "expected_days": int(round(gap / pp))} for h, pp, gap in zip(stages, p, gaps)]
    slowest = max(rem, key=lambda r: r["expected_days"]) if rem else None
    p50 = start + timedelta(days=q50)
    how = ("Judgement (conviction or acquittal) after "
           f"{stages[-2].label if len(stages) > 1 else 'the judgement hearing'}"
           ", or earlier settlement/withdrawal")
    expl = f"Most likely ends around {fmt_day(p50)} {p50.year}"
    if slowest and len(rem) > 1:
        expl += (f". Slowest step: {H(slowest['stage']).label} (about {slowest['expected_hearings']:g} hearings, "
                 f"~{slowest['expected_days']} days)")
    expl += f". {prob:.0%} chance it ends by {fmt_day(horizon_end)} {horizon_end.year}."
    return Forecast(
        p10=start + timedelta(days=q10), p50=p50, p90=start + timedelta(days=q90),
        prob_ends_by_horizon=round(prob, 3), remaining_stages=rem, how_it_ends=how, explanation=expl,
        median_days=q50, prob_settles=settled_rate,
    )


def to_json(f: Forecast) -> dict:
    return {
        "projected_end": {"p10": f.p10.isoformat(), "p50": f.p50.isoformat(), "p90": f.p90.isoformat()},
        "prob_ends_by_horizon": f.prob_ends_by_horizon,
        "remaining_stages": f.remaining_stages,
        "how_it_ends": f.how_it_ends,
        "explanation": f.explanation,
        "median_days": f.median_days,
    }
