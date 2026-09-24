"""Forecasts: what the next few weeks look like under an Option, compared with the current plan.

Honesty rule: a forecast must not use the Simulated Court's hidden truth, or the judge would be
shown the real future. So each forecast *re-draws an imaginary future* from what the planner knows
(fresh outcome dice, fresh hidden reliability, fresh return dates for outstanding process) and
runs every option against the *same* re-drawn futures (paired), several times.
"""

from __future__ import annotations

import copy
import pickle
from dataclasses import dataclass, field, replace
from datetime import date, timedelta

from .sim import Simulation

BUCKET_KEYS = ("3+", "4+", "5+")


@dataclass
class Option:
    """A proposed change. Empty = the current plan."""

    label: str = "Current plan"
    params: dict = field(default_factory=dict)  # strategy parameter changes (rules)
    remove: list[int] = field(default_factory=list)  # today's list
    add: list[int] = field(default_factory=list)
    extra: int = 0  # overbook today by N next-best cases
    move: dict[int, date] = field(default_factory=dict)  # case -> later sitting day
    leave: list[date] = field(default_factory=list)

    def is_empty(self) -> bool:
        return not (self.params or self.remove or self.add or self.extra or self.move or self.leave)


def apply(sim: Simulation, opt: Option) -> None:
    """Apply an option to a simulation (a fork for forecasting, or the live court when adopted)."""
    if opt.params and hasattr(sim.strategy, "p"):
        sim.strategy.p = replace(sim.strategy.p, **opt.params)
        if hasattr(sim.strategy, "z"):
            from statistics import NormalDist
            sim.strategy.z = NormalDist().inv_cdf(sim.strategy.p.fill)
    for d in opt.leave:
        sim.add_leave(d)
    o = sim.overrides
    o["remove"] = sorted(set(o["remove"]) | set(opt.remove))
    o["add"] = [c for c in dict.fromkeys(o["add"] + opt.add)]
    o["extra"] = o["extra"] + opt.extra
    for c, d in opt.move.items():
        sim.move(c, d)


def reimagine(sim: Simulation, k: int) -> Simulation:
    """A fork whose future is re-drawn from planner-visible knowledge only."""
    f = pickle.loads(pickle.dumps(sim))
    f.court.seed = 10_000 + 7919 * k + sim.seed
    f.court._draw(f.court.n_cases, f.court.seed)
    f.court.assign_latent(f.cases)
    today = f.today or f.days[-1]
    for c in f.cases:
        if c.process_back is not None and c.process_back > today:
            f.court.maybe_issue_process(c, today, force=True)
    f.days = list(f.days)  # leave changes on a fork must not touch the live court
    f.ctx.days = f.days
    return f


def _age_counts(sim: Simulation, on: date) -> dict:
    out = {k: 0 for k in BUCKET_KEYS}
    for c in sim.cases:
        if c.disposed:
            continue
        a = (on - c.filing_date).days / 365.25
        if a >= 3:
            out["3+"] += 1
        if a >= 4:
            out["4+"] += 1
        if a >= 5:
            out["5+"] += 1
    return out


def run_forward(sim: Simulation, until: date) -> dict:
    """Play days up to `until`; return weekly series and totals."""
    start_idx = len(sim.records)
    start_day = sim.today
    weeks: dict[date, dict] = {}
    cap = sim.scenario.minutes_per_day
    daily = []
    while sim.today is not None and sim.today <= until:
        day = sim.today
        listings, _ = sim.draft()
        exp = sum(l.exp_minutes for l in listings)
        recs = sim.play()
        reached = [r for r in recs if r.reached]
        used = min(cap, sum(r.minutes for r in reached))
        wk = day - timedelta(days=day.weekday())
        w = weeks.setdefault(wk, {"week": str(wk), "days": 0, "listed": 0, "reached": 0, "substantive": 0,
                                  "advanced": 0, "carried": 0, "minutes": 0.0, "late_days": 0, "late_n": 0,
                                  "slot_ok": 0, "slot_n": 0})
        w["days"] += 1
        w["listed"] += len(recs)
        w["reached"] += len(reached)
        w["substantive"] += sum(bool(r.substantive) for r in reached)
        w["advanced"] += sum(bool(r.advanced_to) for r in reached)
        w["carried"] += sum(not r.reached for r in recs)
        w["minutes"] += used
        for r in reached:
            if r.first_scheduled:
                w["late_days"] += (r.day - r.first_scheduled).days
                w["late_n"] += 1
            if r.slot_start is not None and r.start_min is not None:
                w["slot_n"] += 1
                w["slot_ok"] += r.slot_start <= r.start_min < r.slot_start + 60
        w.update({f"backlog_{k}": v for k, v in _age_counts(sim, day).items()})
        daily.append({"day": str(day), "expected": round(exp, 1), "used": round(used, 1), "listed": len(recs)})
    series = []
    for w in weeks.values():
        series.append({
            "week": w["week"], "days": w["days"], "listed": w["listed"], "substantive": w["substantive"],
            "advanced": w["advanced"], "carried": w["carried"],
            "utilisation": w["minutes"] / (cap * w["days"]) if w["days"] else 0.0,
            "days_late": w["late_days"] / w["late_n"] if w["late_n"] else 0.0,
            "slot_kept": w["slot_ok"] / w["slot_n"] if w["slot_n"] else None,
            **{k: w[k] for k in w if k.startswith("backlog_")},
        })
    recs = sim.records[start_idx:]
    first_heard: dict[int, str] = {}
    for r in recs:
        if r.reached and r.case not in first_heard:
            first_heard[r.case] = str(r.day)
    reached = [r for r in recs if r.reached]
    days_n = max(1, sum(w["days"] for w in weeks.values()))
    end = _age_counts(sim, sim.today or until)
    start_old = {c.idx for c in sim.cases if c.old}
    totals = {
        "days": days_n,
        "utilisation": sum(w["minutes"] for w in weeks.values()) / (cap * days_n),
        "reach_rate": len(reached) / max(1, len(recs)),
        "substantive_per_day": sum(bool(r.substantive) for r in reached) / days_n,
        "substantiveness": sum(bool(r.substantive) for r in reached) / max(1, len(reached)),
        "stage_advances": float(sum(bool(r.advanced_to) for r in reached)),
        "disposals": float(sum(r.advanced_to == "DISPOSED" for r in reached)),
        "carried_over": float(sum(not r.reached for r in recs)),
        "days_late": (sum((r.day - r.first_scheduled).days for r in reached if r.first_scheduled)
                      / max(1, sum(1 for r in reached if r.first_scheduled))),
        "old_advanced": float(len({r.case for r in reached if r.advanced_to and r.case in start_old})),
        **{f"backlog_{k}_end": float(v) for k, v in end.items()},
    }
    return {"from": str(start_day), "to": str(until), "weekly": series, "daily": daily, "totals": totals,
            "first_heard": first_heard}


def _job(args):
    blob, opt, k, until = args
    f = reimagine(pickle.loads(blob), k)
    apply(f, opt)
    return run_forward(f, until)


_POOL = None


def _pool():
    global _POOL
    if _POOL is None:
        from concurrent.futures import ProcessPoolExecutor
        _POOL = ProcessPoolExecutor(max_workers=8)
    return _POOL


def forecast(sim: Simulation, options: list[Option], weeks: int = 4, samples: int = 3,
             parallel: bool = True, until: date | None = None) -> dict:
    """Run the current plan and each option forward over the same re-imagined futures."""
    today = sim.today
    if today is None:
        return {"options": []}
    until = until or today + timedelta(days=7 * weeks - 1)
    all_opts = [Option()] + [o for o in options if not o.is_empty()]
    blob = pickle.dumps(sim)
    jobs = [(blob, opt, k, until) for opt in all_opts for k in range(samples)]
    results = list(_pool().map(_job, jobs)) if parallel else [_job(j) for j in jobs]
    runs = [results[i * samples:(i + 1) * samples] for i in range(len(all_opts))]
    out = []
    for opt, rs in zip(all_opts, runs):
        keys = rs[0]["totals"].keys()
        totals = {key: _band([r["totals"][key] for r in rs]) for key in keys}
        weekly = []
        for wi in range(len(rs[0]["weekly"])):
            row = {"week": rs[0]["weekly"][wi]["week"]}
            for key, v in rs[0]["weekly"][wi].items():
                if key != "week" and isinstance(v, (int, float)):
                    vals = [r["weekly"][wi][key] for r in rs if wi < len(r["weekly"]) and r["weekly"][wi][key] is not None]
                    row[key] = sum(vals) / len(vals) if vals else None
            weekly.append(row)
        daily = []
        for di in range(len(rs[0]["daily"])):
            vals = [r["daily"][di] for r in rs if di < len(r["daily"])]
            daily.append({"day": vals[0]["day"], "expected": sum(v["expected"] for v in vals) / len(vals),
                          "used": sum(v["used"] for v in vals) / len(vals), "listed": sum(v["listed"] for v in vals) / len(vals)})
        out.append({"label": opt.label, "totals": totals, "weekly": weekly, "daily": daily,
                    "today": rs[0]["daily"][0] if rs[0]["daily"] else None})
    base = runs[0]
    for o, rs in zip(out[1:], runs[1:]):
        o["affected"] = _affected(sim, base, rs)
        o["delta"] = {key: _band([r["totals"][key] - b["totals"][key] for r, b in zip(rs, base)])
                      for key in rs[0]["totals"]}
    return {"from": str(today), "to": str(until), "weeks": weeks, "samples": samples, "options": out}


def _band(xs: list[float]) -> dict:
    xs = sorted(x for x in xs if x is not None)
    if not xs:
        return {"mean": None, "low": None, "high": None}
    return {"mean": sum(xs) / len(xs), "low": xs[0], "high": xs[-1]}


def _affected(sim: Simulation, base: list[dict], opt: list[dict], limit: int = 40) -> dict:
    """Which cases does an option move? Compares when each case is first heard, future by future."""
    from datetime import date as _d
    rows = []
    cases = set().union(*[set(r["first_heard"]) for r in base + opt])
    for c in cases:
        b = [r["first_heard"].get(c) for r in base]
        o = [r["first_heard"].get(c) for r in opt]
        both = [(_d.fromisoformat(x), _d.fromisoformat(y)) for x, y in zip(b, o) if x and y]
        heard_b, heard_o = sum(x is not None for x in b), sum(y is not None for y in o)
        shift = sum((y - x).days for x, y in both) / len(both) if both else None
        if heard_b and not heard_o:
            kind = "no longer heard"
        elif heard_o and not heard_b:
            kind = "newly heard"
        elif shift is not None and abs(shift) >= 1:
            kind = "earlier" if shift < 0 else "later"
        else:
            continue
        cs = sim.cases[c]
        rows.append({"case_idx": c, "case_id": cs.case_id, "kind": kind, "shift_days": shift,
                     "age_years": round((sim.today - cs.filing_date).days / 365.25, 2), "old": bool(cs.old)})
    counts = {k: sum(r["kind"] == k for r in rows) for k in ("earlier", "later", "newly heard", "no longer heard")}
    old_counts = {k: sum(r["kind"] == k and r["old"] for r in rows) for k in counts}
    rows.sort(key=lambda r: (-abs(r["shift_days"] or 99), -r["age_years"]))
    return {"counts": counts, "old_counts": old_counts, "cases": rows[:limit]}


def hindsight(before: Simulation, opt: Option, until: date) -> dict:
    """What the change actually did: replay the *same* simulated world from just before the change,
    with and without it, up to `until`. Only possible in simulation; later changes are not replayed."""
    with_ = pickle.loads(pickle.dumps(before))
    without = pickle.loads(pickle.dumps(before))
    apply(with_, opt)
    a, b = run_forward(without, until), run_forward(with_, until)
    delta = {k: b["totals"][k] - a["totals"][k] for k in a["totals"]}
    return {"without": a["totals"], "with": b["totals"], "delta": delta,
            "affected": _affected(before, [a], [b])["counts"], "days": a["totals"]["days"]}
