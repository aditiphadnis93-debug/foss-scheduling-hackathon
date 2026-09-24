"""Does the per-case model (adaptive planner) help, and in which worlds? Run: uv run python experiments/rules_vs_adaptive.py"""
from courtsched.experiment import mean_ci, paired_delta, run_grid, standard_cells

KEYS = ["substantiveness", "substantive_per_day", "old_heard", "old_advanced", "appearances_per_advance",
        "utilisation", "predictability_days", "adjournment_heavy_heard", "projected_days_to_disposal"]

if __name__ == "__main__":
    cells = standard_cells()["model"]
    g = run_grid(cells, list(range(8)))
    print(f"{'cell':28}" + "".join(f"{k[:9]:>11}" for k in KEYS))
    for c in cells:
        s = g[c.label]["scores"]
        print(f"{c.label:28}" + "".join(f"{mean_ci([s[i][k] for i in s])[0]:11.3f}" for k in KEYS))
    for w in ("identical cases", "varied cases", "strong history signal"):
        a, b = g[f"{w}, rule-based"]["scores"], g[f"{w}, adaptive"]["scores"]
        print(f"\\nadaptive − rule-based in '{w}':", "  ".join(f"{k[:9]} {d:+.3f}±{ci:.3f}" for k in KEYS[:5] + KEYS[7:8]
                                                for d, ci in [paired_delta(a, b, k)]))
