"""The town shapes the court day, not only the docket.

Without this, the world model only feeds the court new filings (and takes back settled cases).
Here, **each party's situation in the town changes whether they turn up**, and **town-wide events**
(a transport strike, heavy rain, a festival) knock out attendance for everyone on those days. The
planner sees none of it in advance, just as a real court doesn't, so the day breaks: matters fail,
standby is called, next dates move, and the scorecard shows the cost.

Per-party multiplier on the chance of not turning up (stated assumptions):
* distance from the court complex: ``1 + DIST_WEIGHT · (d − mean d)`` (the far edge of town is worse)
* frustration from wasted trips: ``1 + FRUSTRATION_WEIGHT · min(frustration, 3)``
* daily wage relative to the town mean (a day in court costs more): ``1 + WAGE_WEIGHT · (w/mean − 1)``
* town-wide events: on those days a stated share of the people who would have come cannot
  reach the court (transport strike 55%, heavy rain 30%)

Only *extra* absence is added (``p_extra = p_absent · (m − 1)`` when m > 1), on top of the inner
behaviour, so switching coupling off gives back the uncoupled run exactly.
"""
from __future__ import annotations

import math
import random
from dataclasses import dataclass
from datetime import date, timedelta

from ..behaviour import conditional_probs
from ..interfaces import AttendanceDecision, HearingContext

DIST_WEIGHT = 0.6
FRUSTRATION_WEIGHT = 0.15
WAGE_WEIGHT = 0.2
COURT_XY = (500.0, 500.0)


@dataclass
class TownEvent:
    kind: str                 # transport_strike | heavy_rain | festival | ...
    start: date
    days: int = 1
    absent_share: float = 0.5      # share of people who would have come but cannot reach court that day
    label: str = ""

    def covers(self, d: date) -> bool:
        return self.start <= d < self.start + timedelta(days=self.days)


SCENARIOS = {
    "normal": [],
    "transport_strike": [TownEvent("transport_strike", date(2026, 10, 14), 3, 0.55,
                                   "Bus and auto strike across the town")],
    "monsoon_week": [TownEvent("heavy_rain", date(2026, 10, 26), 5, 0.30, "Heavy rain, roads flooded")],
}


class WorldCoupledBehaviour:
    """Wrap any Behaviour so the town's state and events change attendance."""

    def __init__(self, inner, world, events: list[TownEvent] | None = None, seed: int = 42):
        self.inner, self.world, self.events, self.seed = inner, world, list(events or []), seed
        self.name = f"{getattr(inner, 'name', 'statistical')}+town"
        people = world.people
        self._mean_d = sum(self._dist(p) for p in people) / max(len(people), 1)
        self._mean_w = sum(p.wage for p in people) / max(len(people), 1) or 1.0
        self.impact: dict[str, dict] = {}   # day -> {"extra_absent": n, "event": label}

    @staticmethod
    def _dist(p) -> float:
        return math.hypot(p.x - COURT_XY[0], p.y - COURT_XY[1]) / 500.0

    def _party(self, case_id: str):
        did = self.world.by_case.get(case_id)
        d = self.world.disputes.get(did) if did else None
        return self.world.person(d.accused) if d else None

    def event_share(self, day: date) -> tuple[float, list[str]]:
        keep, why = 1.0, []
        for e in self.events:
            if e.covers(day):
                keep *= (1 - e.absent_share)
                why.append(e.label or e.kind.replace("_", " "))
        return 1 - keep, why

    def multiplier(self, case_id: str, day: date) -> tuple[float, list[str]]:
        m, why = 1.0, []
        p = self._party(case_id)
        if p is not None:
            md = 1 + DIST_WEIGHT * (self._dist(p) - self._mean_d)
            mf = 1 + FRUSTRATION_WEIGHT * min(p.frustration, 3.0)
            mw = 1 + WAGE_WEIGHT * (p.wage / self._mean_w - 1)
            m *= max(0.5, md) * mf * max(0.7, mw)
            if md > 1.15:
                why.append("lives far from the court")
            if p.frustration >= 1:
                why.append("frustrated by wasted trips")
        return m, why

    def decide(self, ctx: HearingContext, rng: random.Random) -> AttendanceDecision:
        dec = self.inner.decide(ctx, rng)
        if not dec.appears:
            return dec
        m, why = self.multiplier(ctx.case.case_id, ctx.day)
        ev, ev_why = self.event_share(ctx.day)
        p_abs = conditional_probs(ctx.hearing_type)["absent"]
        person_extra = p_abs * (m - 1) if m > 1.0 else 0.0
        extra = min(0.95, 1 - (1 - person_extra) * (1 - ev))
        why = why + ev_why
        if extra <= 0:
            return dec
        # own hashed draw: the inner behaviour's random stream is untouched
        import hashlib
        u = int.from_bytes(hashlib.sha256(f"{self.seed}|town|{ctx.case.case_id}|{ctx.day}".encode()).digest()[:8], "big") / 2 ** 64
        if u < extra:
            rec = self.impact.setdefault(ctx.day.isoformat(), {"extra_absent": 0, "events": sorted({w for w in why})})
            rec["extra_absent"] += 1
            return AttendanceDecision(False, False, False, "Respondent Absence / Non-Compliance",
                                      rationale="did not come: " + (", ".join(why) or "town conditions"),
                                      source=self.name)
        return dec

    def readiness_signal(self, cases, day):
        return self.inner.readiness_signal(cases, day)

    def observe(self, ctx, outcome):
        return self.inner.observe(ctx, outcome)

    def __getattr__(self, item):
        return getattr(self.inner, item)


def scenario_impact(roster_path: str | None, config: str = "optimal", scenario: str = "normal", seed: int = 42) -> dict:
    """Run the court with the town coupled in, under a named scenario; per-day and overall effect."""
    from ..access import summarise as access_summary
    from ..behaviour import StatisticalBehaviour
    from ..config import load_config
    from ..metrics import score
    from ..roster import load_roster
    from ..simulate import run
    from .model import TownWorld
    cases = load_roster(roster_path)
    cfg = load_config(config)
    world = TownWorld(seed=seed, roster=cases)
    beh = WorldCoupledBehaviour(StatisticalBehaviour(cfg.advocate_correlation, seed), world, SCENARIOS[scenario], seed)
    res = run(cases, cfg, inflow=world, behaviour=beh, seed=seed)
    days = []
    for d in res.days:
        out = d.outcomes
        days.append({"date": d.day.isoformat(), "listed": len(d.plan.listings),
                     "moved": sum(o.kind == "substantive" for o in out),
                     "absent": sum(o.kind == "adjourned" and bool(o.reason) and "Absence" in o.reason for o in out),
                     "town_kept_away": beh.impact.get(d.day.isoformat(), {}).get("extra_absent", 0),
                     "events": beh.impact.get(d.day.isoformat(), {}).get("events", []),
                     "minutes_used": d.minutes_used})
    m = score(res)
    return {"scenario": scenario, "events": [e.__dict__ | {"start": e.start.isoformat()} for e in SCENARIOS[scenario]],
            "metrics": {k: m[k] for k in ("justice_weighted_progress_per_hour", "substantive_total", "disposed",
                                          "reach_rate_pct", "utilisation_pct", "eju_pct")},
            "wasted_trips": access_summary(res)["possibility"]["wasted_trips"],
            "town_kept_away_total": sum(v["extra_absent"] for v in beh.impact.values()), "days": days}


if __name__ == "__main__":
    import argparse
    import json
    from pathlib import Path
    ap = argparse.ArgumentParser()
    ap.add_argument("--roster", default=None)
    ap.add_argument("--scenario", default="normal")
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    Path(a.out).write_text(json.dumps(scenario_impact(a.roster, scenario=a.scenario), separators=(",", ":")))
    print("wrote", a.out)
