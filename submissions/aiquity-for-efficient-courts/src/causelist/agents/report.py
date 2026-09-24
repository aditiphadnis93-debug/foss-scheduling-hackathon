"""Scorecards and journeys for the agent layer.

    python -m causelist.agents.report                      # statistical vs agents(rules), 100 roster
    python -m causelist.agents.report --engines rules sarvam --policy
    python -m causelist.agents.report --roster data/roster_3000.csv
"""
from __future__ import annotations

import argparse
import copy
import json
from datetime import date
from typing import Any

from ..behaviour import StatisticalBehaviour
from ..config import JudgeConfig, load_config
from ..domain import Case
from ..metrics import score
from ..roster import load_roster
from ..simulate import DEFAULT_END, DEFAULT_START, SimResult, run
from .agent_behaviour import AgentBehaviour

SCORE_KEYS = ["utilisation_pct", "reach_rate_pct", "substantive_pct_of_heard", "backlog_4y_heard_pct",
              "predictability_gap_days", "heard_on_first_listing_pct", "next_date_sane_pct",
              "listed_total", "heard_total", "substantive_total", "disposed", "advocate_trips"]


def run_one(roster: list[Case], cfg: JudgeConfig, behaviour, seed: int = 42,
            start: date = DEFAULT_START, end: date = DEFAULT_END) -> SimResult:
    return run(roster, cfg, behaviour=behaviour, seed=seed, start=start, end=end)


def compare(roster: list[Case], cfg: JudgeConfig, engines: list[str], seed: int = 42,
            **agent_kw) -> tuple[dict[str, dict], dict[str, AgentBehaviour]]:
    """Scorecards for the statistical model and each agent engine on the same roster/config/seed."""
    table: dict[str, dict] = {}
    table["statistical"] = score(run_one(roster, cfg, StatisticalBehaviour(), seed))
    agents: dict[str, AgentBehaviour] = {}
    for e in engines:
        b = AgentBehaviour(e, seed=seed, **agent_kw)
        res = run_one(roster, cfg, b, seed)
        b.close()
        s = score(res)
        s.update({f"agents_{k}": v for k, v in b.summary().items() if not isinstance(v, (dict, str))})
        table[b.name] = s
        agents[e] = b
    return table, agents


def policy_grid(roster: list[Case], cfg: JudgeConfig, seed: int = 42) -> dict[str, dict]:
    """How appointments and advance confirmations change attendance (rules engine)."""
    out: dict[str, dict] = {}
    for appt in (False, True):
        for conf in (False, True):
            c = copy.deepcopy(cfg)
            c.give_appointments = appt
            b = AgentBehaviour("rules", seed=seed, ask_confirmation=conf, appointments=appt)
            s = score(run_one(roster, c, b, seed))
            sm = b.summary()
            out[f"appointments={'on' if appt else 'off'}, confirm={'on' if conf else 'off'}"] = {
                "appear_pct": sm["appear_pct"], "ready_pct": sm["ready_pct"], "seek_time_pct": sm["seek_time_pct"],
                "substantive_pct_of_heard": s["substantive_pct_of_heard"], "substantive_total": s["substantive_total"],
                "litigant_trips": sm["litigant_trips"], "litigant_wasted_trips": sm["litigant_wasted_trips"],
                "litigant_hours_lost": sm["litigant_hours_lost"], "confirmed_pct": sm["confirmed_share_of_decisions_pct"],
            }
    return out


# ---------------------------------------------------------------- journeys (dashboard)

def advocate_rows(b: AgentBehaviour) -> list[dict[str, Any]]:
    rows = []
    for aid, p in b.advocates.items():
        m = b.adv_mem[aid]
        n = sum(1 for d in b.decisions if d["advocate_id"] == aid)
        if not n and not m.appearances:
            continue
        rows.append({"advocate_id": aid, **{k: v for k, v in p.as_dict().items() if k != "advocate_id"},
                     "matters_called": n, "trip_days": len(m.trip_days), "hours_waited": round(m.hours_waited, 1),
                     "wasted_appearances": m.wasted_total, "confirmations": m.confirmations,
                     "kept": m.kept, "broken": m.broken})
    return sorted(rows, key=lambda r: -r["matters_called"])


def litigant_rows(b: AgentBehaviour) -> list[dict[str, Any]]:
    rows = []
    for pid, p in b.litigants.items():
        m = b.lit_mem[pid]
        if not m.history:
            continue
        rows.append({"party_id": pid, **{k: v for k, v in p.as_dict().items() if k != "party_id"},
                     "trips": m.trips, "wasted_trips": m.wasted_total, "hours_lost": round(m.hours_lost, 1),
                     "money_lost": round(m.money_lost), "adjournments_suffered": m.adjournments_suffered,
                     "appointments_honoured": m.appointments_honoured,
                     "p_attend_start": m.history[0][1], "p_attend_end": m.history[-1][1]})
    return sorted(rows, key=lambda r: -r["wasted_trips"])


def journey(b: AgentBehaviour, kind: str, agent_id: str) -> dict[str, Any]:
    key = "advocate_id" if kind == "advocate" else "party_id"
    persona = (b.advocates if kind == "advocate" else b.litigants)[agent_id]
    mem = (b.adv_mem if kind == "advocate" else b.lit_mem)[agent_id]
    outcome = {(o["case_id"], o["day"]): o for o in b.observations if o[key] == agent_id}
    timeline = []
    for d in b.decisions:
        if d[key] != agent_id:
            continue
        o = outcome.get((d["case_id"], d["day"]), {})
        timeline.append({"day": d["day"], "case_id": d["case_id"], "purpose": d["purpose"],
                         "decision": ("ready" if d["ready"] else "seeks time" if d["seeks_adjournment"]
                                      else "absent"),
                         "outcome": o.get("kind"), "rationale": d["rationale"], "source": d["source"],
                         "p_absent": d["p_absent"], "base_absent": d["base_absent"], "confirmed": d["confirmed"]})
    decided = {(t["case_id"], t["day"]) for t in timeline}
    for (cid, day), o in outcome.items():
        if (cid, day) not in decided:
            timeline.append({"day": day, "case_id": cid, "purpose": "", "decision": "(not called)",
                             "outcome": o["kind"], "rationale": o.get("reason") or "", "source": "court",
                             "p_absent": None, "base_absent": None, "confirmed": o.get("confirmed")})
    timeline.sort(key=lambda t: (t["day"], t["case_id"]))
    return {"persona": persona.as_dict(), "memory": {k: (len(v) if isinstance(v, set) else v)
                                                     for k, v in mem.__dict__.items() if k != "history"},
            "history": mem.history, "timeline": timeline}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--roster", default=None)
    ap.add_argument("--config", default="optimal")
    ap.add_argument("--engines", nargs="*", default=["rules"])
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--budget", type=int, default=None, help="LLM batch calls per run (sarvam default 60)")
    ap.add_argument("--policy", action="store_true", help="also run the appointments x confirmation grid")
    args = ap.parse_args()
    roster = load_roster(args.roster)
    cfg = load_config(args.config)
    kw = {"budget": args.budget} if args.budget is not None else {}
    table, agents = compare(roster, cfg, args.engines, args.seed, **kw)
    names = list(table)
    print(f"{'metric':32}" + "".join(f"{n:>16}" for n in names))
    for k in SCORE_KEYS:
        print(f"{k:32}" + "".join(f"{table[n].get(k, ''):>16}" for n in names))
    for e, b in agents.items():
        print(f"\n[{b.name}] " + json.dumps(b.summary(), default=str))
    if args.policy:
        print("\nAttendance under court policies (agents, rules engine):")
        grid = policy_grid(roster, cfg, args.seed)
        cols = list(next(iter(grid.values())))
        print(f"{'policy':36}" + "".join(f"{c[:14]:>15}" for c in cols))
        for k, v in grid.items():
            print(f"{k:36}" + "".join(f"{v[c]:>15}" for c in cols))


if __name__ == "__main__":
    main()
