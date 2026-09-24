"""Advocate and party profiles: who turns up, who is ready, who seeks time, and what it costs.

``build(res, learning=None) -> dict`` is JSON-serialisable and feeds the profiles page and the
judge's recommendation panel. Actors:

* ``advocates``  -- the advocate on record (petitioner side) across all their cases
* ``parties``    -- the petitioner party of a case
* ``respondents``-- the respondent side of a case (``<case_id>/respondent``)

Time-seeking is compared with what the organiser tables expect for the hearings the actor
actually had (``learning.p_exceed``): with a ``LearningBehaviour`` its running tallies are used
(they include the case multipliers at the time of each hearing); without one, the expectation
is rebuilt from the outcomes at the table rate.
"""
from __future__ import annotations

import math
from collections import Counter, defaultdict

from .attribution import request_side
from .behaviour import SIDE_SHARE_PETITIONER, SOUGHT_TIME, conditional_probs
from .learning import MIN_REQUESTS, P_FLAG, p_exceed, respondent_actor
from .reference import load_hearing_types

_ABSENT = {
    "petitioner": {"Petitioner Absence / Non-Compliance", "Both Parties Unready / Absent"},
    "respondent": {"Respondent Absence / Non-Compliance", "Both Parties Unready / Absent"},
}
_COURT = {"Court Administrative Issue", "Court Holiday / No Sitting", "Unclear"}


def _blank(side: str) -> dict:
    return {"side": side, "listed": 0, "hearings": 0, "decided": 0, "appeared": 0, "ready": 0,
            "requests": 0.0, "expected_requests": 0.0, "adjournments_by_reason": Counter(),
            "days": set(), "cases": set(), "delay_court_minutes": 0.0, "delay_slot_minutes": 0.0}


def _clean(x):
    if isinstance(x, float) and math.isnan(x):
        return None
    return x


def build(res, learning=None) -> dict:
    if learning is not None and not (hasattr(learning, "posterior") and hasattr(learning, "req")):
        learning = None                    # any other behaviour object: profile from the outcomes alone
    types = load_hearing_types()
    cases = {c.case_id: c for c in res.cases}
    actors: dict[str, dict[str, dict]] = {"advocates": {}, "parties": {}, "respondents": {}}

    def get(group: str, key: str, side: str) -> dict:
        d = actors[group].get(key)
        if d is None:
            d = actors[group][key] = _blank(side)
        return d

    for day in res.days:
        slot = {l.case_id: l.expected_minutes
                for l in list(day.plan.listings) + list(getattr(day.plan, "standby", []) or [])}
        for o in day.outcomes:
            c = cases.get(o.case_id)
            if c is None:
                continue
            rows = [(get("advocates", c.advocate_id, "petitioner"), "petitioner"),
                    (get("parties", c.party_id, "petitioner"), "petitioner"),
                    (get("respondents", respondent_actor(c.case_id), "respondent"), "respondent")]
            asked = request_side(c, o.day.isoformat()) if o.reason == SOUGHT_TIME else None
            ht = types.get(o.purpose)
            seek = conditional_probs(ht)["seek"] if ht else 0.0
            for r, side in rows:
                r["listed"] += 1
                r["cases"].add(c.case_id)
                r["days"].add(o.day.isoformat())
                if o.kind == "not_reached":
                    continue
                r["hearings"] += 1
                if o.kind == "not_ready":
                    continue
                decided = o.kind == "substantive" or (o.kind == "adjourned" and o.reason is not None
                                                      and not str(o.reason).startswith("Judge emergency"))
                if not decided:
                    continue
                r["decided"] += 1
                absent = o.reason in _ABSENT[side]
                r["appeared"] += 0 if absent else 1
                if o.kind == "substantive" or o.reason in _COURT:
                    r["ready"] += 1
                share = SIDE_SHARE_PETITIONER if side == "petitioner" else 1.0 - SIDE_SHARE_PETITIONER
                r["expected_requests"] += share * seek
                mine = False
                if o.reason == SOUGHT_TIME:
                    if asked:
                        mine = asked == side
                        r["requests"] += 1.0 if mine else 0.0
                    else:
                        r["requests"] += share
                if o.kind == "adjourned" and o.reason:
                    r["adjournments_by_reason"][o.reason] += 1
                if (absent and o.reason != "Both Parties Unready / Absent") or mine:
                    r["delay_court_minutes"] += float(o.minutes_used)
                    r["delay_slot_minutes"] += float(slot.get(o.case_id, 0.0))

    req = learning.req if learning is not None and hasattr(learning, "req") else {}
    out: dict[str, dict] = {}
    for group, table in actors.items():
        rows = {}
        for key, r in table.items():
            lr = req.get(key)
            requests = lr.requests if lr else r["requests"]
            expected = lr.expected if lr else r["expected_requests"]
            n = lr.hearings if lr else r["decided"]
            pe = p_exceed(requests, n, expected)
            flag = None
            for cid in r["cases"]:
                f = cases[cid].meta.get("gaming_flag")
                if f and f.get("actor") == key:
                    flag = f
                    break
            post = learning.posterior(key) if learning is not None and group != "respondents" else None
            rows[key] = {
                "side": r["side"],
                "listed": r["listed"],
                "hearings": r["hearings"],
                "appearance_rate": round(r["appeared"] / r["decided"], 3) if r["decided"] else None,
                "readiness_rate": round(r["ready"] / r["decided"], 3) if r["decided"] else None,
                "time_requests": round(requests, 2),
                "expected_requests": round(expected, 3),
                "time_seeking_ratio": round(requests / expected, 2) if expected > 0 else None,
                "p_exceed": round(pe, 4),
                "adjournments_by_reason": dict(r["adjournments_by_reason"]),
                "trips": len(r["days"]),
                "posterior": ({"mean": _clean(post[0]), "lo90": _clean(post[1]), "hi90": _clean(post[2]),
                               "n": post[3]} if post else None),
                "gaming_flag": bool(flag),
                "gaming_evidence": flag.get("evidence") if flag else None,
                "would_flag": bool(requests >= MIN_REQUESTS and pe > P_FLAG),
                "cases": sorted(r["cases"]),
                "delay_court_minutes": round(r["delay_court_minutes"], 1),
                "delay_slot_minutes": round(r["delay_slot_minutes"], 1),
            }
        if group == "respondents":           # one per case: keep the ones that were ever heard
            rows = {k: v for k, v in rows.items() if v["hearings"]}
        out[group] = rows
    out["summary"] = {
        "advocates": len(out["advocates"]),
        "parties": len(out["parties"]),
        "respondents": len(out["respondents"]),
        "flagged": sorted(k for g in ("advocates", "parties", "respondents") for k, v in out[g].items()
                          if v["gaming_flag"]),
    }
    if learning is not None and hasattr(learning, "brier"):
        out["summary"]["brier"] = learning.brier()
    return out
