"""Precompute scenario JSON for the web app (so it works as a static site, no Python needed).

    PYTHONPATH=src python -m causelist.precompute            # 100 + 3000 rosters, all presets
    PYTHONPATH=src python -m causelist.precompute --rosters 100 --seeds 3
"""
from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

from .api import ROSTERS
from .config import list_presets, load_config
from .export import export_result
from .montecarlo import run_many
from .roster import load_roster
from .simulate import run

OUT = Path(__file__).resolve().parents[2] / "web" / "public" / "data"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--rosters", nargs="*", default=["100", "3000"])
    ap.add_argument("--configs", nargs="*", default=None)
    ap.add_argument("--seeds", type=int, default=3, help="Monte Carlo seeds for the spread")
    ap.add_argument("--index-only", action="store_true", help="rebuild index.json from the run files present")
    args = ap.parse_args()
    if args.index_only:
        rebuild_index()
        return
    OUT.mkdir(parents=True, exist_ok=True)
    configs = args.configs or list_presets()
    idx_path = OUT / "index.json"
    index = json.loads(idx_path.read_text()) if idx_path.exists() else {"scenarios": []}
    index["scenarios"] = [s for s in index.get("scenarios", []) if s["roster"] not in args.rosters]
    index["rosters"] = sorted({*index.get("rosters", []), *args.rosters})
    index["configs"] = configs
    for rk in args.rosters:
        roster = load_roster(ROSTERS[rk])
        for name in configs:
            t = time.time()
            cfg = load_config(name)
            data = export_result(run(roster, cfg, seed=42), include_cases=(rk == "100"), label=name)
            if args.seeds > 1:
                data["montecarlo"] = run_many(roster, load_config(name), args.seeds)
            fn = f"run_{rk}_{name}.json"
            (OUT / fn).write_text(json.dumps(data, separators=(",", ":")))
            index["scenarios"].append({"roster": rk, "config": name, "file": f"/data/{fn}",
                                       "metrics": data["metrics"]})
            print(f"{fn}: {time.time() - t:.1f}s, {(OUT / fn).stat().st_size / 1e6:.2f} MB")
    (OUT / "index.json").write_text(json.dumps(index, indent=1))


def rebuild_index() -> None:
    scenarios = []
    for f in sorted(OUT.glob("run_*_*.json")):
        _, rk, name = f.stem.split("_", 2)
        m = json.loads(f.read_text()).get("metrics", {})
        scenarios.append({"roster": rk, "config": name, "file": f"/data/{f.name}", "metrics": m})
    idx = {"scenarios": scenarios, "rosters": sorted({s["roster"] for s in scenarios}),
           "configs": sorted({s["config"] for s in scenarios})}
    (OUT / "index.json").write_text(json.dumps(idx, indent=1))
    print(f"index: {len(scenarios)} scenarios")


if __name__ == "__main__":
    main()
