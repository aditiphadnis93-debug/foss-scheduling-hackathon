"""Experiments: scenarios × strategies × seeds, paired by seed, summarised with 95% CIs."""

from __future__ import annotations

import math
from concurrent.futures import ProcessPoolExecutor
from dataclasses import dataclass, replace

from .scenario import Scenario
from .sim import run
from .strategies import (AdaptiveParams, AdaptivePlanner, CurrentPractice, CurrentPracticeParams, RuleParams,
                         RulePlanner)


@dataclass(frozen=True)
class Cell:
    label: str
    scenario: Scenario
    strategy: str  # "current_practice" | "rule_based" | "adaptive"
    params: object

    def make(self):
        return {"current_practice": CurrentPractice, "rule_based": RulePlanner, "adaptive": AdaptivePlanner}[self.strategy](self.params)


def _run_cell(args):
    cell, seed = args
    res = run(cell.scenario, cell.make(), seed=seed)
    return cell.label, seed, res.scorecard(), res.old_heard_by_day, res.old_advanced_by_day


def run_grid(cells: list[Cell], seeds: list[int], workers: int = 8) -> dict[str, dict]:
    """Returns {label: {"scores": {seed: scorecard}, "old_heard": [...], "old_advanced": [...]}}"""
    jobs = [(c, s) for c in cells for s in seeds]
    out: dict[str, dict] = {c.label: {"scores": {}, "old_heard": [], "old_advanced": []} for c in cells}
    with ProcessPoolExecutor(max_workers=workers) as ex:
        for label, seed, sc, oh, oa in ex.map(_run_cell, jobs):
            out[label]["scores"][seed] = sc
            out[label]["old_heard"].append(oh)
            out[label]["old_advanced"].append(oa)
    return out


def mean_ci(xs: list[float]) -> tuple[float, float]:
    xs = [x for x in xs if not (isinstance(x, float) and math.isnan(x))]
    if not xs:
        return float("nan"), float("nan")
    m = sum(xs) / len(xs)
    if len(xs) < 2:
        return m, 0.0
    sd = math.sqrt(sum((x - m) ** 2 for x in xs) / (len(xs) - 1))
    return m, 1.96 * sd / math.sqrt(len(xs))


def paired_delta(a: dict[int, dict], b: dict[int, dict], metric: str) -> tuple[float, float]:
    """b − a per seed (same seed = same roster and same pre-drawn outcomes)."""
    return mean_ci([b[s][metric] - a[s][metric] for s in a if s in b])


def standard_cells(base: Scenario = Scenario()) -> dict[str, list[Cell]]:
    """The experiments shown on the results page. Every knob here is a named parameter."""
    b, l1 = CurrentPracticeParams(), RuleParams()
    exps: dict[str, list[Cell]] = {}
    l2 = AdaptiveParams()
    exps["headline"] = [Cell("Current practice", base, "current_practice", b), Cell("rule_based", base, "rule_based", l1),
                        Cell("adaptive", base, "adaptive", l2)]
    exps["styles"] = [
        Cell("Current practice", base, "current_practice", b),
        Cell("Balanced (adaptive)", base, "adaptive", l2),
        Cell("Quick wins first", base, "adaptive", replace(l2, old_share=0, age_weight=0, old_max_wait=10**6, old_cap_share=0)),
        Cell("Oldest first", base, "adaptive", replace(l2, age_weight=3.0, old_share=0.45)),
        Cell("Batch by advocate", base, "adaptive", replace(l2, adv_bonus=2.0)),
    ]
    exps["model"] = [
        Cell("identical cases, rule-based", replace(base, name="identical cases", case_heterogeneity=0.0), "rule_based", l1),
        Cell("identical cases, adaptive", replace(base, name="identical cases", case_heterogeneity=0.0), "adaptive", l2),
        Cell("varied cases, rule-based", base, "rule_based", l1),
        Cell("varied cases, adaptive", base, "adaptive", l2),
        Cell("strong history signal, rule-based", replace(base, name="strong signal", case_heterogeneity=1.2, history_signal=0.8), "rule_based", l1),
        Cell("strong history signal, adaptive", replace(base, name="strong signal", case_heterogeneity=1.2, history_signal=0.8), "adaptive", l2),
        Cell("varied cases, adaptive ranks by prediction", base, "adaptive", replace(l2, rank_with_case_model=True)),
    ]
    exps["fill"] = [Cell(f"fill {f:.0%}", base, "rule_based", replace(l1, fill=f)) for f in (0.5, 0.65, 0.8, 0.9, 0.97)]
    exps["old_share"] = [Cell(f"old share {s:.0%}", base, "rule_based", replace(l1, old_share=s)) for s in (0.0, 0.15, 0.3, 0.45)]
    exps["spacing"] = [Cell(f"gap ×{g}", base, "rule_based", replace(l1, gap_mult=g, short_gap=max(1, round(7 * g))))
                       for g in (0.5, 0.75, 1.0, 1.5, 2.0)]
    no_track = replace(base, name="no process tracking", process_tracking=False)
    exps["tracking"] = [Cell("paperwork tracked", base, "rule_based", l1), Cell("paperwork not tracked", no_track, "rule_based", l1)]
    lop = replace(base, name="lopsided", advocates="lopsided")
    exps["grouping"] = [
        Cell("uniform, grouping off", base, "rule_based", replace(l1, adv_bonus=0.0)),
        Cell("uniform, grouping on", base, "rule_based", l1),
        Cell("lopsided, grouping off", lop, "rule_based", replace(l1, adv_bonus=0.0)),
        Cell("lopsided, grouping on", lop, "rule_based", l1),
    ]
    literal = replace(base, name="literal stage advance", advance_rule="literal")
    no_ramp = replace(base, name="no preparation ramp", ramp_floor=1.0)
    exps["assumptions"] = [
        Cell("default world", base, "rule_based", l1),
        Cell("literal stage advance", literal, "rule_based", l1),
        Cell("no preparation ramp", no_ramp, "rule_based", l1),
        Cell("durations vary (cv 0.5)", replace(base, name="durations vary", duration_cv=0.5), "rule_based", l1),
    ]
    return exps
