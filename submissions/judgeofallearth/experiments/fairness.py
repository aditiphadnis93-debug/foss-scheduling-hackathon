"""Anti-starvation for all cases: does it restore hard-case access, and what does it cost?"""
from dataclasses import replace
from courtsched.experiment import Cell, mean_ci, run_grid
from courtsched.scenario import Scenario
from courtsched.strategies import AdaptiveParams, CurrentPracticeParams

KEYS = ["substantiveness", "substantive_per_day", "old_heard", "adjournment_heavy_heard", "adjournment_heavy_advanced", "appearances_per_advance", "projected_days_to_disposal"]
if __name__ == "__main__":
    sc, l2 = Scenario(), AdaptiveParams()
    cells = [Cell("Current practice", sc, "current_practice", CurrentPracticeParams()),
             Cell("Adaptive, no general anti-starvation", sc, "adaptive", replace(l2, any_cap_share=0.0)),
             Cell("Adaptive, wait>20d cap 20%", sc, "adaptive", l2),
             Cell("Adaptive, wait>15d cap 30%", sc, "adaptive", replace(l2, any_max_wait=15, any_cap_share=0.3))]
    g = run_grid(cells, list(range(6)))
    print(f"{'cell':32}" + "".join(f"{k[:10]:>12}" for k in KEYS))
    for c in cells:
        s = g[c.label]["scores"]
        print(f"{c.label:32}" + "".join(f"{mean_ci([s[i][k] for i in s])[0]:12.3f}" for k in KEYS))
