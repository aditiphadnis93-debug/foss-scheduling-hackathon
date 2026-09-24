"""Export an agent simulation as one JSON document for the agent-journey boards.

``export_agents(behaviour, sim_result)`` returns a JSON-serialisable dict:

.. code-block:: text

    {
      "schema_version": 1,
      "meta": {
        "engine": "rules" | "sarvam", "model": str | null, "seed": int, "config": str,
        "start": "YYYY-MM-DD", "end": "YYYY-MM-DD", "sitting_days": ["YYYY-MM-DD", ...],
        "court_start": "HH:MM", "roster_size": int,
        "drift_measure": {"litigant": "...", "advocate": "..."},
        "llm": {batches, live_calls, cache_hits, errors, mean_latency_s, fallback_decisions}
      },
      "agents": [                               # only people with at least one listing
        {"id": str, "role": "advocate" | "litigant",
         "traits": {...persona traits...},      # advocate: diligence, caseload_pressure, reliability,
                                                #   responds_to_appointment, cost_sensitivity (0..1)
                                                # litigant: travel_km, daily_wage_loss (rupees/day),
                                                #   trust_in_court, patience (0..1)
         "case_ids": [str, ...],
         "totals": {"listings", "trips", "wasted_trips", "minutes_waited", "wages_lost", "travel_cost"}}
      ],
      "journeys": {                             # keyed by agent id, ordered by day
        "<agent id>": [
          {"day": "YYYY-MM-DD", "case_id": str, "purpose": str,
           "listed_window": {"slot": str, "start": "HH:MM", "end": "HH:MM", "start_min": int, "end_min": int},
           "decision": null | {                 # null when the matter was never called
               "appear": bool, "ready": bool, "seek_adjournment": bool,
               "p_absent": float, "p_seek": float, "p_ready": float,   # probabilities the draw used
               "p_absent_statistical": float, "p_seek_statistical": float,
               "confirmed_in_advance": bool, "source": "rules" | "sarvam",
               "minutes_if_heard": float | null,                    # model's duration estimate (sarvam)
               "model_choice": str | null},                         # model's own most likely outcome
           "rationale": str,
           "outcome": {"kind": "substantive" | "adjourned" | "not_reached" | "not_ready", "reason": str | null},
           "trip_made": bool, "trip_wasted": bool,
           "minutes_waited": int, "travel_minutes": int,           # travel only for litigants
           "wages_lost": int, "travel_cost": int}                  # rupees; litigants only (0 for advocates)
        ]
      },
      "drift": {"<agent id>": [{"day": "YYYY-MM-DD", "value": float}]},
      "comparison": {
        "statistical": {...metrics.score...}, "agents": {...metrics.score...},
        "delta": {metric: agents - statistical},
        "agent_summary": {...AgentBehaviour.summary()...}
      }
    }

Command line (writes the document; ``--record`` also stores the replay cache next to it so the
run can be reproduced offline from a fresh checkout):

    python -m causelist.agents.export --engine rules --out out/agents_export.json
    python -m causelist.agents.export --engine sarvam --end 2026-10-12 --record
    # offline replay of the recording (no key needed):
    python -m causelist.agents.export --engine sarvam --end 2026-10-12 \
        --cache src/causelist/agents/recordings/sarvam_demo_cache.json
"""
from __future__ import annotations

import argparse
import json
from collections import defaultdict
from datetime import date
from pathlib import Path
from typing import Any

from ..behaviour import StatisticalBehaviour
from ..config import load_config
from ..metrics import score
from ..roster import load_roster
from ..simulate import DEFAULT_END, DEFAULT_START, SimResult, run
from .agent_behaviour import AgentBehaviour

SCHEMA_VERSION = 1
RECORDINGS = Path(__file__).resolve().parent / "recordings"
DEMO_EXPORT = RECORDINGS / "sarvam_demo_100.json"
DEMO_CACHE = RECORDINGS / "sarvam_demo_cache.json"


def _hhmm(base: int, m: int) -> str:
    t = base + int(m)
    return f"{t // 60:02d}:{t % 60:02d}"


def _iso(d: Any) -> Any:
    return d.isoformat() if isinstance(d, date) else d


def export_agents(behaviour: AgentBehaviour, sim_result: SimResult, baseline: SimResult | None = None,
                  compare: bool = True) -> dict[str, Any]:
    """Build the board document. ``baseline`` defaults to a statistical run on the same inputs."""
    res = sim_result
    h, m = map(int, res.config.day_start.split(":"))
    base = h * 60 + m
    decisions = {(d["case_id"], d["day"]): d for d in behaviour.decisions}

    journeys: dict[str, list[dict]] = defaultdict(list)
    for o in behaviour.observations:
        d = decisions.get((o["case_id"], o["day"]))
        dec = None
        if d is not None:
            dec = {"appear": d["appears"], "ready": d["ready"], "seek_adjournment": d["seeks_adjournment"],
                   "p_absent": d["p_absent"], "p_seek": d["p_seek"], "p_ready": d.get("p_ready", 1.0),
                   "p_absent_statistical": d["base_absent"], "p_seek_statistical": d["base_seek"],
                   "confirmed_in_advance": d["confirmed"], "source": d["source"],
                   "minutes_if_heard": d.get("minutes_estimate"), "model_choice": d.get("model_choice")}
        s, e = o["window"]
        common = {"day": o["day"].isoformat(), "case_id": o["case_id"], "purpose": o["purpose"],
                  "listed_window": {"slot": o["slot"], "start": _hhmm(base, s), "end": _hhmm(base, e),
                                    "start_min": s, "end_min": e},
                  "decision": dec,
                  "rationale": d["rationale"] if d else (o["reason"] or ""),
                  "outcome": {"kind": o["kind"], "reason": o["reason"]}}
        journeys[o["party_id"]].append({**common, "trip_made": o["litigant_came"], "trip_wasted": o["wasted_trip"],
                                        "minutes_waited": o["minutes_waited"] if o["litigant_came"] else 0,
                                        "travel_minutes": o["travel_minutes"], "wages_lost": o["wages_lost"],
                                        "travel_cost": o["travel_cost"]})
        journeys[o["advocate_id"]].append({**common, "trip_made": o["advocate_came"],
                                           "trip_wasted": o["advocate_wasted"],
                                           "minutes_waited": o["minutes_waited"] if o["advocate_came"] else 0,
                                           "travel_minutes": 0, "wages_lost": 0, "travel_cost": 0})

    cases_by: dict[str, list[str]] = defaultdict(list)
    for c in res.cases:
        cases_by[c.advocate_id].append(c.case_id)
        cases_by[c.party_id].append(c.case_id)

    agents: list[dict] = []
    drift: dict[str, list[dict]] = {}
    for role, people, mems in (("advocate", behaviour.advocates, behaviour.adv_mem),
                               ("litigant", behaviour.litigants, behaviour.lit_mem)):
        for aid, p in sorted(people.items()):
            j = journeys.get(aid)
            if not j:
                continue
            traits = {k: v for k, v in p.as_dict().items() if k not in ("advocate_id", "party_id")}
            agents.append({"id": aid, "role": role, "traits": traits, "case_ids": sorted(cases_by.get(aid, [])),
                           "totals": {"listings": len(j), "trips": sum(x["trip_made"] for x in j),
                                      "wasted_trips": sum(x["trip_wasted"] for x in j),
                                      "minutes_waited": sum(x["minutes_waited"] for x in j),
                                      "wages_lost": sum(x["wages_lost"] for x in j if x["trip_made"]),
                                      "travel_cost": sum(x["travel_cost"] for x in j if x["trip_made"])}})
            drift[aid] = [{"day": day.isoformat(), "value": v} for day, v in mems[aid].history]

    comparison: dict[str, Any] = {"agent_summary": behaviour.summary()}
    if compare:
        agents_score = score(res)
        if baseline is None:
            baseline = run(res.initial, res.config, behaviour=StatisticalBehaviour(), start=res.start,
                           end=res.end, seed=res.seed)
        stat_score = score(baseline)
        comparison.update({"statistical": stat_score, "agents": agents_score,
                           "delta": {k: round(agents_score[k] - stat_score[k], 2) for k in agents_score
                                     if isinstance(agents_score[k], (int, float))}})

    summ = comparison["agent_summary"]
    return {
        "schema_version": SCHEMA_VERSION,
        "meta": {"engine": behaviour.engine, "model": summ.get("model"), "seed": res.seed,
                 "config": res.config.name, "start": res.start.isoformat(), "end": res.end.isoformat(),
                 "sitting_days": [d.day.isoformat() for d in res.days], "court_start": res.config.day_start,
                 "roster_size": len(res.initial),
                 "drift_measure": {"litigant": "P(turns up) for a typical hearing, after this day's experience",
                                   "advocate": "effective reliability (kept vs broken confirmations)"},
                 "llm": {k.removeprefix("llm_"): v for k, v in summ.items() if k.startswith("llm_")}},
        "agents": agents,
        "journeys": {k: sorted(v, key=lambda x: (x["day"], x["case_id"])) for k, v in journeys.items()},
        "drift": drift,
        "comparison": json.loads(json.dumps(comparison, default=_iso)),
    }


def run_and_export(engine: str = "rules", roster: str | None = None, config: str = "optimal", seed: int = 42,
                   start: date = DEFAULT_START, end: date = DEFAULT_END, **agent_kw) -> tuple[dict, AgentBehaviour]:
    cases = load_roster(roster)
    cfg = load_config(config)
    b = AgentBehaviour(engine, seed=seed, **agent_kw)
    res = run(cases, cfg, behaviour=b, start=start, end=end, seed=seed)
    b.close()
    return export_agents(b, res), b


def load_demo() -> dict | None:
    """The recorded Sarvam demo run (100 cases, optimal preset, ~10 sitting days), if present."""
    return json.loads(DEMO_EXPORT.read_text()) if DEMO_EXPORT.exists() else None


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--engine", default="rules", choices=["rules", "sarvam"])
    ap.add_argument("--roster", default=None)
    ap.add_argument("--config", default="optimal")
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--start", default=DEFAULT_START.isoformat())
    ap.add_argument("--end", default=DEFAULT_END.isoformat())
    ap.add_argument("--budget", type=int, default=60)
    ap.add_argument("--cache", default=None, help="replay cache path (default out/agent_cache.json)")
    ap.add_argument("--out", default=None)
    ap.add_argument("--record", action="store_true", help="write the demo recording (export + replay cache)")
    args = ap.parse_args()
    cache = args.cache
    doc, b = run_and_export(args.engine, args.roster, args.config, args.seed, date.fromisoformat(args.start),
                            date.fromisoformat(args.end), budget=args.budget, cache_path=cache)
    out = Path(args.out) if args.out else (DEMO_EXPORT if args.record else
                                           Path(__file__).resolve().parents[3] / "out" / f"agents_export_{args.engine}.json")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(doc, indent=1))
    if args.record and b.client is not None:
        used = {k: b.client.cache.data[k] for k in sorted(b.client.cache.used)}
        DEMO_CACHE.write_text(json.dumps(used, indent=1, sort_keys=True))
        print(f"recorded {len(used)} cached replies -> {DEMO_CACHE.name}")
    print(json.dumps(doc["meta"]["llm"]), f"agents={len(doc['agents'])}", f"-> {out}")


if __name__ == "__main__":
    main()
