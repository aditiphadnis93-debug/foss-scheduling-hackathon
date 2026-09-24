"""The five scoring dimensions from the case study, plus supporting counts."""
from __future__ import annotations

import statistics
from collections import Counter, defaultdict

from .config import OLD_CASE_YEARS, Weights
from .planning import ProgressTable, justice_weight
from .reference import INTERRUPT_TYPES, NEXT_PURPOSE_ON_SUCCESS, load_hearing_types
from .simulate import SimResult
from .attribution import STAKEHOLDERS, summarise

_ATTEND = {"Respondent Absence / Non-Compliance", "Petitioner Absence / Non-Compliance",
           "Both Parties Unready / Absent", "Party Sought Time / Adjournment"}
_COURT = {"Court Administrative Issue", "Court Holiday / No Sitting", "Unclear"}


def is_heard(o) -> bool:
    """Called and both sides present: substantive, or adjourned for a non-absence reason."""
    return o.kind == "substantive" or (o.kind == "adjourned" and bool(o.reason) and "Absence" not in o.reason)


def justice_weighted_progress(res: SimResult, types=None) -> float:
    """Sum over substantive hearings of progress x justice weight, measured the same way for
    every configuration: the justice weight uses the neutral default ``Weights()`` (not the
    judge's preset) and each case's state as it stood when the hearing was called, replayed
    from the outcome log (stage, hearings at stage, times listed for the purpose, last heard)."""
    types = types or load_hearing_types()
    progress = ProgressTable(types)
    neutral = Weights()
    filed = {c.case_id: c.filing_date for c in res.cases}
    state: dict[str, list] = {c.case_id: [c.stage, c.hearings_at_stage, c.listed_count_current, c.last_heard_on]
                              for c in res.initial}
    total = 0.0
    for d in res.days:
        for o in d.outcomes:
            st = state.setdefault(o.case_id, ["ADMISSION", 0, 0, None])
            stage, has, listed, last = st
            if o.kind == "substantive":
                ht = types.get(stage)
                age = (o.day - filed[o.case_id]).days / 365.25 if o.case_id in filed else 0.0
                jw = justice_weight(age, has, ht.median_hearings if ht else 1.0, listed, neutral,
                                    (o.day - last).days if last else None)
                total += progress(o.purpose, stage) * jw
            st[2] = listed + 1
            if o.kind != "not_reached":
                st[1] = has + 1
                st[3] = o.day
            if o.kind == "substantive":
                st[2] = 0
                if o.purpose not in INTERRUPT_TYPES and NEXT_PURPOSE_ON_SUCCESS.get(o.purpose):
                    st[0] = NEXT_PURPOSE_ON_SUCCESS[o.purpose]
                    st[1] = 0
    return total


def score(res: SimResult) -> dict[str, float]:
    types = load_hearing_types()
    cap = sum(d.plan.capacity_minutes for d in res.days) or 1
    listed = called = heard = substantive = 0
    minutes_on_hearings = 0.0
    substantive_minutes = 0.0
    used_minutes = old_used_minutes = 0.0
    idle = overrun = 0.0
    filed = {c.case_id: c.filing_date for c in res.cases}
    next_gaps: list[int] = []
    gap_ok = 0
    adv_days: dict[str, set] = defaultdict(set)
    adv_hearings: Counter = Counter()
    reasons: Counter = Counter()

    for d in res.days:
        idle += max(0.0, d.plan.capacity_minutes - d.minutes_used)
        overrun += max(0.0, d.minutes_used - d.plan.capacity_minutes)
        for o in d.outcomes:
            used_minutes += o.minutes_used
            if o.case_id in filed and (o.day - filed[o.case_id]).days / 365.25 >= OLD_CASE_YEARS:
                old_used_minutes += o.minutes_used
            listed += 1
            if o.kind != "not_reached":
                called += 1
            if is_heard(o):
                heard += 1
            if o.kind == "substantive":
                substantive += 1
                minutes_on_hearings += o.minutes_used
                substantive_minutes += o.minutes_used
            elif o.kind == "adjourned":
                minutes_on_hearings += o.minutes_used if o.reason and "Absence" not in o.reason else 0
            if o.reason:
                reasons[o.reason] += 1
            if o.next_date:
                g = (o.next_date - o.day).days
                next_gaps.append(g)
                ht = types.get(o.next_purpose or o.purpose)
                if ht and (o.kind == "not_reached" or ht.ideal_gap_days * 0.5 <= g <= ht.ideal_gap_days * 2 + 3):
                    gap_ok += 1
        for l in d.plan.listings:
            adv_days[l.advocate_id].add(l.day)
            adv_hearings[l.advocate_id] += 1

    old_ids = {c.case_id for c in res.initial if c.age_years(res.start) >= OLD_CASE_YEARS}
    old_heard = {o.case_id for d in res.days for o in d.outcomes if o.case_id in old_ids and is_heard(o)}
    five_before = sum(1 for c in res.initial if c.age_years(res.start) >= 5)
    five_after = sum(1 for c in res.cases if c.status == "pending" and c.age_years(res.end) >= 5)
    gaps = [g for c in res.cases for g in c.meta.get("heard_gaps", [])]
    trips = sum(len(v) for v in adv_days.values())
    n_days = max(len(res.days), 1)

    return {
        "utilisation_pct": round(100 * min(minutes_on_hearings, cap) / cap, 1),
        "reach_rate_pct": round(100 * called / max(listed, 1), 1),
        "substantive_pct_of_heard": round(100 * substantive / max(heard, 1), 1),
        "backlog_4y_heard_pct": round(100 * len(old_heard) / max(len(old_ids), 1), 1),
        "predictability_gap_days": round(statistics.mean(gaps), 1) if gaps else 0.0,
        "heard_on_first_listing_pct": round(100 * sum(1 for g in gaps if g == 0) / max(len(gaps), 1), 1),
        "next_date_mean_gap_days": round(statistics.mean(next_gaps), 1) if next_gaps else 0.0,
        "next_date_sane_pct": round(100 * gap_ok / max(len(next_gaps), 1), 1),
        "listed_total": listed,
        "listed_per_day": round(listed / max(len(res.days), 1), 1),
        "heard_total": heard,
        "substantive_total": substantive,
        "disposed": sum(1 for c in res.cases if c.status == "disposed"),
        "cases_5y_pending_start": five_before,
        "cases_5y_pending_end": five_after,
        "advocate_trips": trips,
        "hearings_per_advocate_trip": round(sum(adv_hearings.values()) / max(trips, 1), 2),
        "sitting_days": len(res.days),
        # --- north star and time accounting ---------------------------------------------
        "eju_pct": round(100 * substantive_minutes / cap, 1),
        "justice_weighted_progress_per_hour": round(justice_weighted_progress(res, types) / (cap / 60), 3),
        "idle_minutes_per_day": round(idle / n_days, 1),
        "overrun_minutes_per_day": round(overrun / n_days, 1),
        "old_minutes_share_pct": round(100 * old_used_minutes / max(used_minutes, 1e-9), 1),
        **delay_and_learning(res),
    }


def brier(res: SimResult) -> tuple[float | None, int]:
    """Brier score of the planner's p_goes_ahead against what happened, over called hearings whose
    prerequisites were met (the event p_goes_ahead predicts): 1 = the sides went ahead (substantive,
    or adjourned for a court-side reason), 0 = an attendance failure (absent / unready / time sought)."""
    tot, n = 0.0, 0
    for d in res.days:
        p = {l.case_id: l.p_goes_ahead for l in list(d.plan.listings) + list(getattr(d.plan, "standby", []) or [])}
        for o in d.outcomes:
            if o.case_id not in p:
                continue
            if o.kind == "substantive" or (o.kind == "adjourned" and o.reason in _COURT):
                y = 1.0
            elif o.kind == "adjourned" and o.reason in _ATTEND:
                y = 0.0
            else:
                continue
            tot += (p[o.case_id] - y) ** 2
            n += 1
    return (tot / n if n else None), n


def gaming_detection(res: SimResult) -> dict:
    """Flagged actors (from ``case.meta["gaming_flag"]``) scored against ``strategic_truth``.

    An advocate flag is correct when the advocate is strategic; a petitioner-party flag when that
    case's advocate is strategic; a respondent flag never is (only advocates game in the model).
    Recall is over strategic advocates that had at least one called hearing in the run.
    """
    case_adv = {c.case_id: c.advocate_id for c in res.cases}
    flags: dict[str, tuple[str, str]] = {}
    truth_known = False
    strategic: set[str] = set()
    for c in res.cases:
        t = c.meta.get("strategic_truth")
        if t is not None:
            truth_known = True
            if t.get("strategic"):
                strategic.add(c.advocate_id)
        f = c.meta.get("gaming_flag")
        if f:
            flags[f["actor"]] = (f.get("side", ""), c.case_id)
    out: dict[str, float] = {"gaming_flags": len(flags)}
    if not truth_known:
        return out
    active = {case_adv.get(o.case_id) for d in res.days for o in d.outcomes if o.kind != "not_reached"}
    tp = 0
    caught: set[str] = set()
    for actor, (side, cid) in flags.items():
        adv = actor if side == "advocate" else (case_adv.get(cid) if side == "petitioner" else None)
        if adv in strategic:
            tp += 1
            caught.add(adv)
    denom = strategic & active
    out["gaming_precision"] = round(tp / len(flags), 3) if flags else 0.0
    out["gaming_recall"] = round(len(caught & denom) / len(denom), 3) if denom else 0.0
    out["gaming_strategic_active"] = len(denom)
    return out


def delay_and_learning(res: SimResult) -> dict[str, float]:
    """Delay attribution shares, strategic-delay detection, and the calibration of p_goes_ahead.

    ``delay_share_<stakeholder>_pct``: share of non-substantive outcomes owned by the stakeholder.
    ``state_agency_delay_pct``: share of *all* listed hearings lost to state agencies.
    """
    att = summarise(res)
    ns = max(att["non_substantive"], 1)
    out: dict[str, float] = {f"delay_share_{s}_pct": round(100 * att["by_stakeholder"][s]["count"] / ns, 1)
                             for s in STAKEHOLDERS}
    out["state_agency_delay_pct"] = round(100 * att["by_stakeholder"]["state_agencies"]["count"]
                                          / max(att["listed"], 1), 1)
    out.update(gaming_detection(res))
    b, _ = brier(res)
    if b is not None:
        out["learning_brier"] = round(b, 4)
    return out


def flags(res: SimResult, top: int = 20) -> dict[str, list[dict]]:
    """Goal 7: ageing cases at risk, repeat adjournments, stuck-at-stage."""
    pend = [c for c in res.cases if c.status == "pending"]
    ageing = sorted(pend, key=lambda c: -c.age_years(res.end))[:top]
    repeat = sorted([c for c in pend if c.adjournments_in_row >= 2], key=lambda c: -c.adjournments_in_row)[:top]
    types = load_hearing_types()
    stuck = [c for c in pend if types.get(c.stage) and c.hearings_at_stage > types[c.stage].median_hearings * 2]
    row = lambda c: {"case_id": c.case_id, "age_years": round(c.age_years(res.end), 1), "stage": c.stage,
                     "purpose": c.purpose, "adjournments_in_row": c.adjournments_in_row,
                     "hearings_at_stage": c.hearings_at_stage, "advocate": c.advocate_id}
    return {"ageing": [row(c) for c in ageing], "repeat_adjournments": [row(c) for c in repeat],
            "stuck_at_stage": [row(c) for c in stuck[:top]]}
