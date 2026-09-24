"""One simulation, every layer at once: the town (L4) files the cases and shapes attendance, every
party and advocate is an AI agent (L3) deciding with its own persona and memory, and the recommended
list (L2) plans, re-plans each night and absorbs what happens. A transport strike lands mid-run.

All four web views (Court day, Observatory, World, People) read the exports of this single run, so
what you see in the town, in the court and in each person's journey is the same world.

    set -a; . <key file>; set +a      # SARVAM_API_KEY (optional: without it, recorded replies / rules)
    PYTHONPATH=src python -m causelist.combined
"""
from __future__ import annotations

import argparse
import json
import time
from datetime import date
from pathlib import Path

from .agents.agent_behaviour import AgentBehaviour
from .agents.export import export_agents
from .config import load_config
from .export import export_result
from .roster import load_roster
from .simulate import DEFAULT_START, run
from .world.coupling import TownEvent, WorldCoupledBehaviour
from .world.export import export_world
from .world.model import TownWorld

OUT = Path(__file__).resolve().parents[2] / "web" / "public" / "data"
CACHE = Path(__file__).resolve().parent / "agents" / "recordings" / "combined_cache.json"
DEMO_EVENTS = [TownEvent("transport_strike", date(2026, 10, 14), 2, 0.55, "Bus and auto strike across the town")]


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--end", default="2026-10-23")
    ap.add_argument("--budget", type=int, default=120)
    ap.add_argument("--seed", type=int, default=42)
    a = ap.parse_args()
    t = time.time()
    cases = load_roster()
    cfg = load_config("optimal")
    world = TownWorld(seed=a.seed, roster=cases)
    agents = AgentBehaviour(engine="sarvam", seed=a.seed, budget=a.budget, cache_path=CACHE)
    beh = WorldCoupledBehaviour(agents, world, DEMO_EVENTS, a.seed)
    res = run(cases, cfg, inflow=world, behaviour=beh, start=DEFAULT_START, end=date.fromisoformat(a.end), seed=a.seed)
    run_x = export_result(res, label="combined")
    run_x["meta"]["label"] = "One world: town + AI agents + recommended list"
    run_x["meta"]["combined"] = {"events": [e.__dict__ | {"start": e.start.isoformat()} for e in DEMO_EVENTS],
                                 "town_kept_away": beh.impact}
    (OUT / "run_100_combined.json").write_text(json.dumps(run_x, separators=(",", ":"), default=str))
    (OUT / "world_100_combined.json").write_text(json.dumps(export_world(world, res), separators=(",", ":"), default=str))
    ag = export_agents(agents, res)
    (OUT / "agents_100_combined.json").write_text(json.dumps(ag, separators=(",", ":"), default=str))
    if hasattr(agents, "close"):
        agents.close()
    print(f"combined run: {len(res.days)} sitting days, {sum(len(d.plan.listings) for d in res.days)} listings, "
          f"{sum(1 for d in res.days for o in d.outcomes if (o.decided_by or '').startswith('sarvam'))} AI decisions, "
          f"town kept away {sum(v['extra_absent'] for v in beh.impact.values())}, llm {ag.get('meta', {}).get('llm')}, "
          f"{time.time() - t:.0f}s")


if __name__ == "__main__":
    main()
