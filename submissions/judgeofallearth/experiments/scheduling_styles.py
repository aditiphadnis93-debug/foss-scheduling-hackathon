"""Compare scheduling styles (modelled on the brief's three judges) against ours and current practice, on paired seeds.

Run: uv run python experiments/scheduling_styles.py
Copy this file to try any other comparison: each Cell is (label, scenario, strategy, params).
"""

from dataclasses import replace

from courtsched.experiment import Cell, mean_ci, paired_delta, run_grid
from courtsched.scenario import Scenario
from courtsched.strategies import CurrentPracticeParams, RuleParams

METRICS = [("substantiveness", "Subst"), ("old_heard", "4+heard"), ("old_advanced", "4+adv"),
           ("utilisation", "Util"), ("predictability_days", "Late d"),
           ("appearances_per_advance", "App/adv"), ("trips_per_case", "Trips"),
           ("projected_days_to_disposal", "ProjDays")]


def main() -> None:
    sc, l1 = Scenario(), RuleParams()
    cells = [
        Cell("Current practice", sc, "current_practice", CurrentPracticeParams()),
        Cell("Rule-based (ours)", sc, "rule_based", l1),
        Cell("Quick wins first", sc, "rule_based", replace(l1, old_share=0, age_weight=0, old_max_wait=10**6, old_cap_share=0)),
        Cell("Oldest first", sc, "rule_based", replace(l1, age_weight=3.0, old_share=0.45)),
        Cell("Batch by advocate", sc, "rule_based", replace(l1, adv_bonus=2.0)),
    ]
    g = run_grid(cells, list(range(8)))
    print(f"{'strategy':26}" + "".join(f"{h:>10}" for _, h in METRICS))
    for c in cells:
        s = g[c.label]["scores"]
        print(f"{c.label:26}" + "".join(f"{mean_ci([s[i][k] for i in s])[0]:10.3f}" for k, _ in METRICS))
    ref = g["Rule-based (ours)"]["scores"]
    print("\npaired Δ vs Rule-based (ours), mean ± 95% CI:")
    for c in cells[2:]:
        parts = []
        for k, h in METRICS[:3]:
            d, ci = paired_delta(ref, g[c.label]["scores"], k)
            parts.append(f"{h} {d:+.3f}±{ci:.3f}")
        print(f"  {c.label:26}", "   ".join(parts))


if __name__ == "__main__":
    main()
