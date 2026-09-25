"""python -m agents probe | warm

probe  Check the Laya sidecar and show one decision next to the rule fallback.
warm   Play every courtroom's L1, status-quo and L3 policies forward with Laya, filling the decision
       cache (data/laya_decisions.json) so the app's Agents tab runs from memory. It loads the
       dataset into a temporary DuckDB, so it can run while the app holds data/court.duckdb.
"""
from __future__ import annotations

import argparse
import tempfile
import time
from pathlib import Path

from .decide import LayaDecider, RuleDecider
from .outcomes import Agents
from .situation import Situation


def probe(url: str | None) -> None:
    d = LayaDecider(url=url, cache_path=None)
    print(f"Laya at {d.url}: {'reachable' if d.reachable() else 'NOT reachable'}")
    s = Situation.of("advocate", trait="habitual adjourner", persona="an advocate known for asking for adjournments",
                     purpose="final_arguments", age="5y+", adjournments="6+", window=False, reminder=False,
                     cover_page=False, clash=True, same_court_matters="none", costs_risk=False, prereq_met=True)
    t = time.perf_counter()
    got = d.decide([s])[0]
    print(f"{got.source} ({time.perf_counter() - t:.2f}s): {got.probs}")
    print(f"rules: {RuleDecider().decide([s])[0].probs}")


def warm(url: str | None, days: int, budget: int, judges: list[str] | None) -> None:
    from scheduler.store import DATASET_DIR, open_store
    from sim.simulate import simulate

    with tempfile.TemporaryDirectory() as tmp:
        store = open_store(Path(tmp) / "warm.duckdb", DATASET_DIR)
        try:
            d = LayaDecider(url=url, budget=budget)
            if not d.reachable():
                raise SystemExit(f"Laya not reachable at {d.url}: start it with docker compose --profile agents up -d laya")
            t = time.perf_counter()
            picked = [j for j in store.judges
                      if not judges or any(q.lower() in f"{j.id} {j.name} {j.preset_name}".lower() for q in judges)]
            if not picked:
                raise SystemExit(f"No judge matches {judges}; have {[j.name for j in store.judges]}")
            for j in picked:
                cfg, roster = store.config(j.id), store.cases(j.id)
                start = store.today
                for policy in ("l1", "baseline", "l3"):
                    simulate(roster, cfg, start, days, policy, agents=Agents(d))
                    d.save()
                    print(f"{j.name} · {policy}: {d.calls} new calls so far, {len(d.cache)} cached, "
                          f"{time.perf_counter() - t:.0f}s")
                    if d.calls >= d.budget:
                        print("Call budget spent; the rest used rules. Run warm again to continue.")
                        return
        finally:
            store.close()


def main() -> None:
    ap = argparse.ArgumentParser(prog="python -m agents")
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("probe")
    p.add_argument("--url")
    w = sub.add_parser("warm")
    w.add_argument("--url")
    w.add_argument("--days", type=int, default=10)
    w.add_argument("--budget", type=int, default=2000, help="max new Laya calls")
    w.add_argument("--judge", action="append", help="judge id or part of the name (repeatable); default all")
    a = ap.parse_args()
    if a.cmd == "probe":
        probe(a.url)
    else:
        warm(a.url, a.days, a.budget, a.judge)


if __name__ == "__main__":
    main()
