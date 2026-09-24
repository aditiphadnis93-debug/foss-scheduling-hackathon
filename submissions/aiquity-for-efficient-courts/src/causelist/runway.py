"""Case runway: in this posting window, how many times can a case realistically come before the
judge, and can it be finished?

For each case at the start of the window:
* ``stages_left``         stages from the current one to judgement
* ``hearings_needed``     expected hearings to get through them (observed mean hearings per stage,
                          organiser reference table)
* ``fastest_days_needed`` the fastest possible path: one successful hearing per stage, each after its gap
* ``typical_days_needed`` at the observed pace: each typically-needed hearing waits its procedural gap
* ``max_appearances``     most listings the window allows if the case were listed at every procedural gap
* ``finishable``          can it reach judgement inside the window at all? (fastest path fits)
* ``finishable_typical``  ...at the typical pace?
And after the run: ``appearances`` (times actually called), ``stages_advanced``, ``disposed``.

The summary tells a judge on a fixed posting what is realistically closable, and whether the plan
actually closed it.
"""
from __future__ import annotations

from collections import Counter

from .reference import INTERRUPT_TYPES, STAGE_ORDER


def _path(stage: str) -> list[str]:
    if stage not in STAGE_ORDER:
        return STAGE_ORDER[:]
    i = STAGE_ORDER.index(stage)
    path = STAGE_ORDER[i:]
    # delay condonation is visited only by cases already in it
    return [s for s in path if s != "DELAY_CONDONATION_HEARING" or s == stage]


def case_runway(stage: str, purpose: str, types, window_days: int) -> dict:
    path = _path(stage)
    needed = 0.0
    min_days = 0.0
    fastest = 0.0          # one successful hearing per remaining stage, each after its gap
    if purpose in INTERRUPT_TYPES and purpose in types:        # an interrupt comes first
        needed += max(1.0, types[purpose].mean_hearings)
        min_days += types[purpose].ideal_gap_days
    for s in path:
        ht = types.get(s)
        if not ht:
            continue
        n = max(1.0, ht.mean_hearings)
        needed += n
        min_days += n * ht.ideal_gap_days
        fastest += ht.ideal_gap_days
    # the last hearing (judgement) does not need a following gap
    last = types.get(path[-1]) if path else None
    if last:
        min_days -= last.ideal_gap_days
        fastest -= last.ideal_gap_days
    gaps = [types[s].ideal_gap_days for s in path if s in types] or [14]
    mean_gap = sum(gaps) / len(gaps)
    return {"stages_left": len(path), "hearings_needed": round(needed, 1),
            "typical_days_needed": round(max(0.0, min_days)), "fastest_days_needed": round(max(0.0, fastest)),
            "max_appearances": int(window_days // max(1.0, mean_gap)) + 1,
            "finishable": fastest <= window_days,              # possible at all inside the window
            "finishable_typical": min_days <= window_days}     # at the observed typical pace


def summarise(res, types=None) -> dict:
    from .priors import effective_types
    types = types or effective_types(res.config)
    window = (res.end - res.start).days
    called: Counter = Counter()
    for d in res.days:
        for o in d.outcomes:
            if o.kind != "not_reached":
                called[o.case_id] += 1
    end = {c.case_id: c for c in res.cases}
    rows = []
    for c0 in res.initial:
        rw = case_runway(c0.stage, c0.purpose, types, window)
        c1 = end.get(c0.case_id, c0)
        i0 = STAGE_ORDER.index(c0.stage) if c0.stage in STAGE_ORDER else 0
        i1 = STAGE_ORDER.index(c1.stage) if c1.stage in STAGE_ORDER else i0
        rows.append({"case_id": c0.case_id, "age_years": round(c0.age_years(res.start), 1), "stage": c0.stage,
                     **rw, "appearances": called.get(c0.case_id, 0),
                     "stages_advanced": (len(STAGE_ORDER) - i0) if c1.status == "disposed" else max(0, i1 - i0),
                     "disposed": c1.status == "disposed"})
    fin = [r for r in rows if r["finishable"]]
    by_stage = {}
    for s in STAGE_ORDER:
        rs = [r for r in rows if r["stage"] == s]
        if rs:
            by_stage[s] = {"cases": len(rs), "finishable": sum(r["finishable"] for r in rs),
                           "disposed": sum(r["disposed"] for r in rs),
                           "mean_appearances": round(sum(r["appearances"] for r in rs) / len(rs), 2),
                           "mean_max_appearances": round(sum(r["max_appearances"] for r in rs) / len(rs), 1)}
    return {
        "window_days": window,
        "cases": len(rows),
        "finishable": len(fin),
        "finishable_disposed": sum(r["disposed"] for r in fin),
        "finishable_disposed_pct": round(100 * sum(r["disposed"] for r in fin) / max(len(fin), 1), 1),
        "finishable_typical": sum(r["finishable_typical"] for r in rows),
        "disposed": sum(r["disposed"] for r in rows),
        "never_called": sum(1 for r in rows if r["appearances"] == 0),
        "mean_appearances": round(sum(r["appearances"] for r in rows) / max(len(rows), 1), 2),
        "by_stage": by_stage,
        "finishable_not_disposed": sorted([r for r in fin if not r["disposed"]],
                                          key=lambda r: (-r["age_years"], r["fastest_days_needed"]))[:50],
        "rows": rows if len(rows) <= 500 else None,
    }
