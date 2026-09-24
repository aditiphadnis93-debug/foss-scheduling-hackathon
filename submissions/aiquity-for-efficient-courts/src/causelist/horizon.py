"""Receding-horizon date assignment: publish a provisional hearing date up to H sitting days ahead.

Every simulated evening the court re-solves a small date-assignment MILP over the next H
sitting days and publishes the result (``Case.published_date``). The next day's daily planner
then packs the cases published for that day into slots; this module never touches slots.

Formulation (x[c, d] binary, d in the next H sitting days, r(d) = 0..H-1 its rank)::

    max   sum value_c * x[c, d]
        - mu   * sum r(d) * value_c * x[c, d]           earlier is better
        + beta * sum value_c * x[c, pub_c]              keep an already-published date
        - lam  * sum_d s_d                              soft ageing floor
    s.t.  sum_d x[c, d] <= 1                                        each case at most once
          x[c, d] = 0                 if d < earliest_c             next date; no date while a known
                                                                    prerequisite is outstanding
          sum_c exp_min_c * x[c, d] <= daily expected capacity      for every d
          sum_c x[c, d]             <= max listings per day         for every d
          sum_{c old} exp_min_c * x[c, d] + s_d >= alpha * capacity          soft ageing floor, every d
          sum_{c of advocate a} x[c, d] <= K                         an advocate is in one place

The pool is limited to cases that can be heard inside the horizon, best value first, plus every
case that already holds a published date (so stability can be honoured). CBC runs single
threaded with a fixed seed, a node limit and a relative gap, so results are reproducible; the
time limit is only a safety net.
"""
from __future__ import annotations

import dataclasses
import math
from dataclasses import dataclass, field
from datetime import date

from .config import JudgeConfig, effective_ageing_share
from .domain import Case, Event
from . import planning
from .planning import Candidate, build_candidates
from .reference import HearingType

EARLY_PENALTY = 0.03        # mu: share of a case's value lost per sitting day of delay inside the horizon
STABILITY_BONUS = 0.8       # beta: share of value gained by keeping an already-published date
ADVOCATE_DAILY_CAP = 6      # K: matters one advocate can attend on one day
POOL_PER_DAY = 1.0          # pool (best value per minute first) size = POOL_PER_DAY * max_listed * H (plus already-published cases)
FLOOR_PENALTY_MULT = 0.5    # lam = this * best value-per-minute in the pool. Kept soft: the daily planner
                            # enforces the hard ageing floor on the published list; a near-hard floor here
                            # (2.0) pushed efficient young matters out of the horizon and cost ~2% progress/hour
BUFFER_SHARE = 0.5          # share of the daily planner's risk buffer the horizon publishes into: the full
                            # buffer over-published and the day planner dropped published matters for capacity
TIME_LIMIT_S = 10
MAX_NODES = 200
GAP_REL = 0.005
HOLD_KNOWN_PREREQ = True    # no date while a visible prerequisite is outstanding (else: date = re-check day)


@dataclass
class HorizonResult:
    days: list[date]
    assigned: dict[str, date]                  # case_id -> published date
    moved: list[tuple[str, date, date | None]] = field(default_factory=list)  # (case_id, old, new)
    load: dict[date, float] = field(default_factory=dict)   # expected minutes published per day
    solver: str = ""
    pool: int = 0
    capacity: float = 0.0                      # expected-minute budget used per day


def daily_capacity(cfg: JudgeConfig, day: date | None = None) -> float:
    """Expected court minutes the daily planner will fill on ``day`` (same budget it enforces): that
    day's sitting minutes (day profile) less the urgent-matter reserve (``planning.with_reserve``)."""
    cfg = planning.with_reserve(cfg, day)
    return cfg.day_minutes * cfg.fill_target * cfg.overbook


def planning_capacity(cfg: JudgeConfig, pool: list[Candidate], day: date | None = None) -> float:
    """Daily expected-minute budget for the horizon: the base capacity plus the same kind of
    risk buffer the daily planner adds (RISK_KAPPA standard deviations of the day's minutes,
    estimated from the variance per expected minute of the best candidates), so the published
    load is what the daily planner will actually be willing to list."""
    base = daily_capacity(cfg, day)
    kappa = getattr(cfg, "risk_kappa", None) or getattr(planning, "RISK_KAPPA", 0.0)
    e = v = 0.0
    for c in sorted(pool, key=lambda c: (-c.efficiency, c.case.case_id)):
        if e >= base:
            break
        e += c.exp_min
        v += getattr(c, "var_min", 0.0)
    if kappa <= 0 or e <= 0:
        return base
    return base + BUFFER_SHARE * kappa * math.sqrt(base * v / e)


def horizon_days(after: date, sittings: list[date], h: int) -> list[date]:
    """The next ``h`` sitting days strictly after ``after``."""
    return [d for d in sittings if d > after][:h]


def earliest_date(c: Case, first: date, cfg: JudgeConfig) -> date | None:
    """Earliest publishable date, or None while a known prerequisite is still outstanding.

    A case whose prerequisite the court can see is unmet (process not yet returned) gets no date
    until the re-check clears it: a date published against an unserved summons would mostly move.
    """
    e = max(c.next_date or first, first)
    if cfg.use_readiness and c.ready_on and c.meta.get("prereq_visible") and c.meta.get("prereq_pending", True):
        if HOLD_KNOWN_PREREQ:
            return None
        e = max(e, c.ready_on)
    return e


def _candidates(cases: list[Case], first: date, cfg: JudgeConfig,
                types: dict[str, HearingType]) -> dict[str, Candidate]:
    # Readiness is handled here through ``earliest_date`` (a known prerequisite pushes the date
    # later instead of dropping the case), so the candidate builder must not hold those back.
    open_cfg = dataclasses.replace(cfg, use_readiness=False)
    cands, _ = build_candidates(first, cases, open_cfg, types, {})
    return {c.case.case_id: c for c in cands}


def plan_horizon(cases: list[Case], after: date, sittings: list[date], cfg: JudgeConfig,
                 types: dict[str, HearingType]) -> HorizonResult:
    """Assign provisional dates for the next ``cfg.horizon_days`` sittings after ``after``."""
    import pulp

    days = horizon_days(after, sittings, max(1, cfg.horizon_days))
    if not days:
        return HorizonResult(days, {}, solver="empty")
    rank = {d: i for i, d in enumerate(days)}
    last = days[-1]
    pending = [c for c in cases if c.status == "pending"]
    earliest = {c.case_id: earliest_date(c, days[0], cfg) for c in pending}
    due = [c for c in pending if earliest[c.case_id] is not None and earliest[c.case_id] <= last]
    cand = _candidates(due, days[0], cfg, types)
    for cid, cd in cand.items():
        cd.case.meta["exp_min_est"] = round(cd.exp_min, 2)

    published = {c.case_id: c.published_date for c in pending
                 if c.published_date is not None and c.published_date in rank}
    # best value per expected minute first (the daily planner's own ordering): a pool ranked by raw
    # value is biased to long hearings and lists fewer, slower matters per day
    ranked = sorted(cand.values(), key=lambda x: (-x.efficiency, x.case.case_id))
    limit = int(POOL_PER_DAY * cfg.max_listed * len(days))
    keep = {cid for cid in published if cid in cand}
    pool: list[Candidate] = []
    for cd in ranked:
        if len(pool) < limit or cd.case.case_id in keep:
            pool.append(cd)
    if not pool:
        return HorizonResult(days, {}, solver="empty")

    caps = {d: planning_capacity(cfg, pool, d) for d in days}
    cap = caps[days[0]]
    old_all = sum(c.exp_min for c in cand.values() if c.old)
    tot_all = sum(c.exp_min for c in cand.values())
    alpha = effective_ageing_share(cfg, old_all / max(tot_all, 1e-6))
    lam = FLOOR_PENALTY_MULT * max(c.efficiency for c in pool)

    prob = pulp.LpProblem("horizon", pulp.LpMaximize)
    x: dict[tuple[int, int], pulp.LpVariable] = {}
    for i, cd in enumerate(pool):
        e = earliest[cd.case.case_id]
        for d in days:
            if d >= e:
                x[i, rank[d]] = pulp.LpVariable(f"x_{i}_{rank[d]}", cat="Binary")
    s = {k: pulp.LpVariable(f"s_{k}", lowBound=0) for k in range(len(days))}

    obj = []
    for (i, k), v in x.items():
        cd = pool[i]
        coef = cd.value * (1.0 - EARLY_PENALTY * k)
        if published.get(cd.case.case_id) == days[k]:
            coef += STABILITY_BONUS * cd.value
        obj.append(coef * v)
    prob += pulp.lpSum(obj) - lam * pulp.lpSum(s.values())

    by_case: dict[int, list] = {}
    by_day: dict[int, list[tuple[int, pulp.LpVariable]]] = {k: [] for k in range(len(days))}
    for (i, k), v in x.items():
        by_case.setdefault(i, []).append(v)
        by_day[k].append((i, v))
    for i, vs in by_case.items():
        if len(vs) > 1:
            prob += pulp.lpSum(vs) <= 1
    adv_of = [cd.case.advocate_id for cd in pool]
    adv_count: dict[str, int] = {}
    for a in adv_of:
        adv_count[a] = adv_count.get(a, 0) + 1
    K = getattr(cfg, "advocate_daily_cap", ADVOCATE_DAILY_CAP) or ADVOCATE_DAILY_CAP
    busy = sorted(a for a, n in adv_count.items() if n > K)
    for k, items in by_day.items():
        if not items:
            continue
        load = pulp.lpSum(pool[i].exp_min * v for i, v in items)
        prob += load <= caps[days[k]]
        prob += pulp.lpSum(v for _, v in items) <= cfg.max_listed
        old_load = pulp.lpSum(pool[i].exp_min * v for i, v in items if pool[i].old)
        if alpha > 0:
            prob += old_load + s[k] >= alpha * caps[days[k]]
        for a in busy:
            vs = [v for i, v in items if adv_of[i] == a]
            if len(vs) > K:
                prob += pulp.lpSum(vs) <= K

    solver = pulp.PULP_CBC_CMD(msg=False, threads=1, timeLimit=TIME_LIMIT_S, gapRel=GAP_REL,
                               options=["randomSeed 42", f"maxNodes {MAX_NODES}"])
    status = prob.solve(solver)
    label = pulp.LpStatus[status]
    assigned: dict[str, date] = {}
    load_by_day = {d: 0.0 for d in days}
    if label == "Optimal" or any((v.value() or 0) > 0.5 for v in x.values()):
        for (i, k), v in sorted(x.items()):
            if (v.value() or 0) > 0.5:
                cid = pool[i].case.case_id
                assigned[cid] = days[k]
                load_by_day[days[k]] += pool[i].exp_min
    else:
        assigned, load_by_day = _greedy(pool, earliest, days, caps, cfg)
        label = f"greedy({label})"

    moved = [(cid, old, assigned.get(cid)) for cid, old in sorted(published.items())
             if assigned.get(cid) != old]
    return HorizonResult(days, assigned, moved, load_by_day, f"horizon/cbc:{label}", len(pool), cap)


def _greedy(pool: list[Candidate], earliest: dict[str, date], days: list[date], cap,
            cfg: JudgeConfig) -> tuple[dict[str, date], dict[date, float]]:
    """Fallback: best value first, earliest day with room."""
    load = {d: 0.0 for d in days}
    count = {d: 0 for d in days}
    adv: dict[tuple[str, date], int] = {}
    out: dict[str, date] = {}
    for cd in sorted(pool, key=lambda c: (-c.value, c.case.case_id)):
        for d in days:
            key = (cd.case.advocate_id, d)
            if d < earliest[cd.case.case_id] or load[d] + cd.exp_min > (cap[d] if isinstance(cap, dict) else cap) or count[d] >= cfg.max_listed \
                    or adv.get(key, 0) >= (getattr(cfg, "advocate_daily_cap", ADVOCATE_DAILY_CAP) or ADVOCATE_DAILY_CAP):
                continue
            out[cd.case.case_id] = d
            load[d] += cd.exp_min
            count[d] += 1
            adv[key] = adv.get(key, 0) + 1
            break
    return out, load


def publish(res: HorizonResult, by_id: dict[str, Case], today: date, events: list[Event],
            audit=None) -> None:
    """Write the evening's horizon onto the cases; record every published date that moves.

    ``audit`` (an ``audit.AuditLog``) gets one ``rescheduled`` entry per moved date with its cause."""
    for cid, old, new in res.moved:
        c = by_id[cid]
        c.meta["reschedules"] = c.meta.get("reschedules", 0) + 1
        events.append(Event(today, "rescheduled", cid,
                            {"from": old.isoformat(), "to": new.isoformat() if new else None}))
        if audit is not None:
            item = c.meta.get("checklist_item") if c.meta.get("prereq_pending") and c.meta.get("prereq_visible") else None
            if item:
                rule, why = "checklist", f"checklist: {item} not met"
            elif new is None:
                rule, why = "horizon", "dropped from the horizon (capacity / higher-value matters)"
            else:
                rule, why = "horizon", "horizon re-solve moved the date"
            audit.add(today, cid, "rescheduled", rule, why, before=old, after=new, actor="court")
        if new is None:
            c.published_date = None
    for cid, d in sorted(res.assigned.items()):
        c = by_id[cid]
        if c.published_date is None:
            events.append(Event(today, "published", cid, {"date": d.isoformat()}))
        c.published_date = d
        c.meta.setdefault("first_published", d)
    events.append(Event(today, "horizon", None, {"solver": res.solver, "pool": res.pool,
                                                  "assigned": len(res.assigned), "moved": len(res.moved),
                                                  "load": {d.isoformat(): round(v, 1) for d, v in res.load.items()}}))


# --- booked-load diary used by the capacity-aware next-date recommendation ---------------------
def booked_load(cases: list[Case], today: date) -> dict[date, float]:
    """Expected minutes already booked per future date: published date if any, else next date."""
    out: dict[date, float] = {}
    for c in cases:
        if c.status != "pending":
            continue
        d = c.published_date if c.published_date and c.published_date > today else c.next_date
        if d and d > today:
            out[d] = out.get(d, 0.0) + float(c.meta.get("exp_min_est", 0.0))
    return out


def first_day_with_room(target: date, exp_min: float, load: dict[date, float], cap,
                        sittings: list[date], search: int = 20) -> date | None:
    """First sitting day on/after ``target`` whose booked load leaves room for this case.
    ``cap`` is a number or a function of the day (per-day capacity under a day profile)."""
    later = [d for d in sittings if d >= target][:search]
    for d in later:
        if load.get(d, 0.0) + exp_min <= (cap(d) if callable(cap) else cap):
            return d
    return None
