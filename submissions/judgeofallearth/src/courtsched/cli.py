"""One command: run every experiment, write results/index.html, scorecard CSV and a causelist."""

from __future__ import annotations

import argparse
import csv
import json
import time
from dataclasses import asdict
from pathlib import Path

from .experiment import mean_ci, run_grid, standard_cells
from .report import build_page, write_causelist
from .scenario import Scenario
from .sim import run
from .strategies import AdaptivePlanner


def main() -> None:
    ap = argparse.ArgumentParser(description="Scheduling Justice experiment bench")
    ap.add_argument("--out", default="results")
    ap.add_argument("--seeds", type=int, default=10)
    ap.add_argument("--sweep-seeds", type=int, default=5)
    ap.add_argument("--workers", type=int, default=8)
    a = ap.parse_args()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    t = time.time()

    exps_cells = standard_cells(Scenario())
    exps = {}
    for name, cells in exps_cells.items():
        seeds = list(range(a.seeds if name == "headline" else a.sweep_seeds))
        exps[name] = run_grid(cells, seeds, workers=a.workers)
        print(f"{name:12} {len(cells)} cells × {len(seeds)} seeds  ({time.time() - t:.0f}s)")

    sample = run(Scenario(), AdaptivePlanner(), seed=0)
    day = sample.days[0]
    write_causelist(sample, day, out / f"causelist_{day}.csv")
    with open(out / "proposed_schedule.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["hearing_date", "order", "slot_start", "case_number", "advocate_id", "hearing_purpose",
                    "age_4plus", "why_listed", "expected_minutes", "sim_reached", "sim_substantive",
                    "sim_advanced_to", "sim_adjournment_reason", "next_gap_days"])
        order = 0
        prev = None
        for r in sample.listings:
            order = order + 1 if r.day == prev else 1
            prev = r.day
            slot = f"{10 + int((r.slot_start or 0) // 60):02d}:00"
            w.writerow([r.day, order, slot, r.case_id, r.advocate, r.purpose, int(r.old), r.why,
                        f"{r.exp_minutes:.1f}", int(r.reached), int(r.substantive), r.advanced_to or "",
                        r.reason or "", "" if r.next_gap is None else r.next_gap])

    with open(out / "scorecard.csv", "w", newline="") as f:
        w = csv.writer(f)
        keys = list(next(iter(next(iter(exps["headline"].values()))["scores"].values())))
        w.writerow(["experiment", "cell", "metric", "mean", "ci95"])
        for name, grid in exps.items():
            for label, g in grid.items():
                for k in keys:
                    m, ci = mean_ci([g["scores"][s][k] for s in g["scores"]])
                    w.writerow([name, label, k, f"{m:.6f}", f"{ci:.6f}"])

    meta = {name: {c.label: {"scenario": c.scenario.describe(), "strategy": c.strategy,
                             "params": asdict(c.params)} for c in cells}
            for name, cells in exps_cells.items() if name == "headline"}
    (out / "settings.json").write_text(json.dumps(meta, indent=1, default=str))
    page = build_page(exps, list(range(a.seeds)), sample, day, meta)
    (out / "index.html").write_text(page)
    print(f"wrote {out}/index.html, scorecard.csv, causelist_{day}.csv  ({time.time() - t:.0f}s)")


if __name__ == "__main__":
    main()
