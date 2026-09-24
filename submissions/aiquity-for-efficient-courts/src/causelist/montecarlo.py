"""Run the same court under many random seeds: mean and spread of every metric."""
from __future__ import annotations

import statistics
from datetime import date

from .config import JudgeConfig
from .domain import Case
from .metrics import score
from .simulate import DEFAULT_END, DEFAULT_START, run


def run_many(cases: list[Case], cfg: JudgeConfig, seeds: list[int] | int = 5, *,
             start: date = DEFAULT_START, end: date = DEFAULT_END, behaviour_factory=None) -> dict[str, dict[str, float]]:
    """Return {metric: {"mean", "p10", "p90", "min", "max"}} over the seeds."""
    seeds = list(range(1, seeds + 1)) if isinstance(seeds, int) else seeds
    rows = []
    for s in seeds:
        beh = behaviour_factory(s) if behaviour_factory else None   # None: run() builds it exactly as a single run does
        rows.append(score(run(cases, cfg, behaviour=beh, start=start, end=end, seed=s)))
    out: dict[str, dict[str, float]] = {}
    for k in rows[0]:
        vals = sorted(float(r[k]) for r in rows)
        q = lambda f: vals[min(len(vals) - 1, max(0, round(f * (len(vals) - 1))))]
        out[k] = {"mean": round(statistics.mean(vals), 2), "p10": q(0.1), "p90": q(0.9),
                  "min": vals[0], "max": vals[-1]}
    return out
