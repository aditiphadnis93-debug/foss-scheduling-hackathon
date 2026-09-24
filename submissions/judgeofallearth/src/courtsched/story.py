"""The model story: how the planner was built, one rule at a time, with why and what happened.

Each step switches on one more rule, starting from current practice. Every step runs on the
same simulated courts (paired seeds), so the difference between steps is the effect of that rule.
The brief asks for exactly this: "what changed in the model, why you changed it, and what happened".
"""

from __future__ import annotations

import json
from dataclasses import replace
from pathlib import Path

from .experiment import Cell, mean_ci, paired_delta, run_grid
from .scenario import Scenario
from .strategies import AdaptiveParams, CurrentPracticeParams, RuleParams

METRICS = [  # key, label, higher_is_better, kind
    ("utilisation", "Share of the day used", True, "pct"),
    ("reach_rate", "Listed hearings reached", True, "pct"),
    ("substantiveness", "Heard hearings that were useful", True, "pct"),
    ("substantive_per_day", "Useful hearings per day", True, "num"),
    ("old_heard", "4+ yr cases heard", True, "pct"),
    ("old_advanced", "4+ yr cases moved forward", True, "pct"),
    ("predictability_days", "Days late vs promised date", False, "num"),
    ("appearances_per_advance", "Appearances per step forward", False, "num"),
    ("wasted_on_pending_process", "Listings wasted on pending paperwork / day", False, "num"),
    ("trips_per_case", "Advocate trips per listed case", False, "num"),
    ("slot_kept", "Called within the 1-hour slot", True, "pct"),
    ("projected_days_to_disposal", "Projected days to disposal", False, "num"),
    ("adjournment_heavy_advanced", "Adjournment-heavy cases moved forward", True, "pct"),
]

# Rule-based planner with every one of our rules switched off (except packing by time).
NAIVE = replace(RuleParams(), old_share=0.0, old_max_wait=10**6, old_cap_share=0.0, age_weight=0.0,
                adv_bonus=0.0, due_share=1.0, flat_gap=60)

STEPS = [
    ("current", "Current practice", "current_practice", CurrentPracticeParams(), {"process_tracking": False},
     "The starting point: about 30 cases listed a day in the order they fall due, and a flat 60-day next "
     "date whatever happened. It's the case study's court."),
    ("pack", "Pack each day by expected time", "rule_based", NAIVE, {"process_tracking": False},
     "A day is 420 minutes, not 30 slots. A 2-minute mention and a 30-minute evidence hearing aren't the "
     "same. List cases until there's an 80% chance the day fits, using each hearing's published duration "
     "and its chance of being useful (the clinic/airline overbooking idea)."),
    ("ready", "List only cases that can happen", "rule_based", NAIVE, {},
     "Most failed Warrant and Appearance hearings are waiting for a summons or warrant to come back. "
     "DRISTI already tracks e-post and police returns, so hold those cases back until it's back."),
    ("nextdate", "Set the next date from what happened", "rule_based", replace(NAIVE, flat_gap=0), {},
     "The brief: 'match the gap to the actual procedural minimum, rather than a flat default'. Moved on "
     "→ the next type's gap; same stage → its gap; party absent → 7 days; paperwork out → when it's back."),
    ("promise", "Only promise dates that can be kept", "rule_based", replace(NAIVE, flat_gap=0, due_share=0.35), {},
     "An experiment found that unlimited next dates crowded future days and made promises late. Only "
     "promise a date on days with room left (35% of a day)."),
    ("old", "Guarantee time for old cases", "rule_based",
     replace(NAIVE, flat_gap=0, due_share=0.35, old_share=0.30, old_max_wait=10, old_cap_share=0.60, age_weight=0.25), {},
     "Ranking by 'useful per minute' favours quick hearings; old, long ones would wait forever (the brief's "
     "Justice Joshi problem). The brief says old cases must not be deprioritised, so: 30% of each day for "
     "ready 4+ yr cases, no ready old case waits over 10 sitting days, and a small age boost."),
    ("group", "Group each advocate's cases", "rule_based", RuleParams(), {},
     "Fewer trips for advocates (brief goal 1): among cases of similar priority, prefer advocates already "
     "on the day's list, and seat their matters together in one slot."),
    ("adaptive", "Learn each case's reliability", "adaptive", AdaptiveParams(), {},
     "Parties differ: some keep missing hearings. Estimate each case's odds from its history and update "
     "after every hearing; use it to size the day and to space re-listing. It doesn't rank cases "
     "(fairness guard), so unreliable parties aren't pushed down the queue."),
]


def build(seeds: int = 5, workers: int = 8, base: Scenario = Scenario()) -> dict:
    cells = [Cell(title, replace(base, name=key, **sc), strat, params) for key, title, strat, params, sc, _ in STEPS]
    grid = run_grid(cells, list(range(seeds)), workers=workers)
    steps, prev = [], None
    for (key, title, strat, params, sc, why), cell in zip(STEPS, cells):
        scores = grid[title]["scores"]
        values = {k: dict(zip(("mean", "ci"), mean_ci([scores[s][k] for s in scores]))) for k, *_ in METRICS}
        delta = None
        if prev is not None:
            delta = {k: dict(zip(("mean", "ci"), paired_delta(grid[prev]["scores"], scores, k))) for k, *_ in METRICS}
        steps.append({"key": key, "title": title, "why": why, "planner": strat, "values": values, "delta": delta})
        prev = title
    return {"seeds": seeds, "cases": base.roster_size, "sitting_days": None,
            "metrics": [{"key": k, "label": l, "higher_is_better": h, "kind": kd} for k, l, h, kd in METRICS],
            "steps": steps}


def main() -> None:
    import argparse
    ap = argparse.ArgumentParser(description="Build the model story (what changed, why, what happened)")
    ap.add_argument("--out", default="results/model_story.json")
    ap.add_argument("--seeds", type=int, default=5)
    a = ap.parse_args()
    out = Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    data = build(a.seeds)
    out.write_text(json.dumps(data, indent=1, default=float))
    for s in data["steps"]:
        d = s["delta"] or {}
        print(f"{s['title']:40}", "  ".join(f"{k[:10]} {s['values'][k]['mean']:.3f}" + (f" ({d[k]['mean']:+.3f})" if d else "")
                                           for k in ("utilisation", "substantive_per_day", "old_heard", "predictability_days", "appearances_per_advance")))
    print("wrote", out)


if __name__ == "__main__":
    main()
