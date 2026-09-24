"""Run the town + court together (optionally cached as a pickle under ``out/``)."""
from __future__ import annotations

import pickle
import time
from pathlib import Path
from typing import Any

from .. import simulate
from ..config import load_config
from ..roster import load_roster
from .model import TownWorld

OUT_DIR = Path(__file__).resolve().parents[3] / "out"
CACHE_VERSION = 2          # bump when the world model changes shape


def cache_path(roster: str, config: str, seed: int) -> Path:
    tag = Path(roster).stem if roster else "roster_sample_100"
    return OUT_DIR / f"world_run_{tag}_{config}_s{seed}_v{CACHE_VERSION}.pkl"


def run_world(roster: str | None = None, config: str = "optimal", seed: int = 42) -> dict[str, Any]:
    cases = load_roster(roster)
    world = TownWorld(seed=seed, roster=cases)
    t = time.time()
    from ..behaviour import StatisticalBehaviour
    from .coupling import SCENARIOS, WorldCoupledBehaviour
    cfg = load_config(config)
    # the town shapes attendance too (distance, frustration, wage, town events), not only filings
    beh = WorldCoupledBehaviour(StatisticalBehaviour(cfg.advocate_correlation, seed), world, SCENARIOS["normal"], seed)
    res = simulate.run(cases, cfg, inflow=world, behaviour=beh, seed=seed)
    return {"world": world, "res": res, "runtime_s": round(time.time() - t, 1),
            "roster": roster or "roster_sample_100", "config": config, "seed": seed}


def load_or_run(roster: str | None = None, config: str = "optimal", seed: int = 42,
                refresh: bool = False) -> dict[str, Any]:
    path = cache_path(roster or "", config, seed)
    if path.exists() and not refresh:
        with open(path, "rb") as fh:
            return pickle.load(fh)
    run = run_world(roster, config, seed)
    OUT_DIR.mkdir(exist_ok=True)
    with open(path, "wb") as fh:
        pickle.dump(run, fh, protocol=pickle.HIGHEST_PROTOCOL)
    return run
