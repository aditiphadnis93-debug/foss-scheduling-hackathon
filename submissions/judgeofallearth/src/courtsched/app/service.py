"""Workspace operations: create, draft, approve, run, and the read models behind each screen.

Screens only ever see planner-visible knowledge. World State (hidden reliability, process return
dates, pre-drawn outcomes) never leaves this module.
"""

from __future__ import annotations

import math
import re
import uuid
from dataclasses import replace
from datetime import date, timedelta
from statistics import NormalDist

from ..court import p_advance
from ..data import SIDE_PURPOSES, generate_roster, load_sample_roster
from ..scenario import Scenario
from ..sim import Simulation
from ..strategies import AdaptiveParams, AdaptivePlanner, CurrentPractice, CurrentPracticeParams
from .store import WorkspaceStore

BUCKETS = ["<1", "1-2", "2-3", "3-4", "4-5", "5+"]
# Scheduling styles. The three non-default ones mirror the brief's example judges (oldest first,
# batching by advocate, quick wins first) but are named for what they do.
PRESETS = {
    "balanced": ("Balanced (default)", lambda: AdaptivePlanner(AdaptiveParams())),
    "oldest_first": ("Oldest first", lambda: AdaptivePlanner(replace(AdaptiveParams(), age_weight=3.0, old_share=0.45))),
    "advocate_batching": ("Batch by advocate", lambda: AdaptivePlanner(replace(AdaptiveParams(), adv_bonus=2.0))),
    "quick_wins": ("Quick wins first", lambda: AdaptivePlanner(replace(AdaptiveParams(), old_share=0, age_weight=0,
                                                                        old_max_wait=10**6, old_cap_share=0))),
    "current_practice": ("Current practice (list what's due, 60-day dates)",
                         lambda: CurrentPractice(CurrentPracticeParams())),
}
LEGACY_PRESETS = {"ours": "balanced", "sehgal": "oldest_first", "dimakar": "advocate_batching", "joshi": "quick_wins",
                  "today": "current_practice"}


class Forbidden(Exception):
    pass


class Conflict(Exception):
    pass


def title(purpose: str) -> str:
    return purpose.replace("_", " ").title().replace("S351 Bnss", "u/s 351 BNSS")


def age_years(filing: date, on: date) -> float:
    return (on - filing).days / 365.25


def bucket(age: float) -> str:
    return BUCKETS[min(5, int(age))]


# --------------------------------------------------------------------------------------------
_cache: dict[str, Simulation] = {}


def _sim(store: WorkspaceStore) -> Simulation:
    if store.id not in _cache:
        _cache[store.id] = store.load_latest()
    return _cache[store.id]


def list_workspaces() -> list[dict]:
    out = []
    for ws in WorkspaceStore.list_ids():
        st = WorkspaceStore(ws)
        if st.exists():
            m = st.get_meta()
            row = {"id": ws, **{k: m.get(k) for k in ("name", "preset", "roster", "cases", "created",
                                                         "clock", "status", "days_total", "days_played")}}
            row["preset"] = LEGACY_PRESETS.get(row["preset"], row["preset"])
            row["preset_label"] = PRESETS.get(row["preset"], (row["preset"],))[0]
            out.append(row)
    return out


def create_workspace(name: str, roster: str = "generated", size: int = 3000, advocates: str = "uniform",
                     preset: str = "balanced", seed: int = 0, role: str = "Analyst", csv_text: str | None = None) -> dict:
    preset = LEGACY_PRESETS.get(preset, preset)
    if preset not in PRESETS:
        raise ValueError(f"unknown preset {preset}")
    imported = None
    if roster == "csv":
        imported = parse_roster(csv_text or "")
        if not imported["cases"]:
            raise ValueError("No valid cases in the file: " + "; ".join(e["message"] for e in imported["errors"][:3]))
    ws_id = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:40] or "court"
    ws_id = f"{ws_id}-{uuid.uuid4().hex[:6]}"
    sc = Scenario(name="default", roster_size=size, advocates=advocates)
    if imported:
        rows = imported["cases"]
    else:
        rows = load_sample_roster() if roster == "sample" else generate_roster(size, seed=seed, advocates=advocates)
    sim = Simulation(sc, PRESETS[preset][1](), seed, rows)
    store = WorkspaceStore(ws_id)
    store.set_meta(name=name, preset=preset, preset_label=PRESETS[preset][0], roster=roster, cases=len(rows),
                   advocates=advocates, seed=seed, created=str(date.today()), clock=str(sim.today),
                   status="draft", days_total=len(sim.days), days_played=0, scenario=sc.describe())
    store.save_snapshot(0, str(sim.today), sim)
    store.save_stats(0, str(sim.today), _buckets(sim, sim.today), {})
    store.log(role, "workspace.created", {"name": name, "preset": preset, "roster": roster, "cases": len(rows),
                                          "skipped_rows": len(imported["errors"]) if imported else 0})
    _cache[ws_id] = sim
    return summary(ws_id)


def summary(ws_id: str) -> dict:
    store = WorkspaceStore(ws_id)
    m = store.get_meta()
    sim = _sim(store)
    pending = sum(not c.disposed for c in sim.cases)
    preset = LEGACY_PRESETS.get(m.get("preset"), m.get("preset"))
    return {"id": ws_id, **m, "preset": preset, "preset_label": PRESETS.get(preset, (preset,))[0],
            "pending": pending, "finished": sim.today is None}


# --------------------------------------------------------------------------------------------
def today(ws_id: str) -> dict:
    """Today's draft (or approved) causelist, capacity, and what's held back."""
    store = WorkspaceStore(ws_id)
    sim = _sim(store)
    m = store.get_meta()
    if sim.today is None:
        return {"day": None, "finished": True, "listings": []}
    listings, meta = sim.draft()
    day = sim.today
    rows = []
    for i, l in enumerate(listings, 1):
        c = sim.cases[l.case]
        rows.append({
            "day_idx": sim.day_idx, "day": str(day), "ord": i, "case_idx": c.idx, "case_id": c.case_id,
            "advocate": c.advocate, "purpose": c.purpose, "age_years": round(age_years(c.filing_date, day), 2),
            "old": bool(c.old), "why": l.why, "slot_start": l.slot_start, "exp_minutes": round(l.exp_minutes, 1),
            "status": m.get("status", "draft"), "reached": None, "substantive": None, "advanced_to": None,
            "reason": None, "minutes": None, "start_min": None, "next_gap": None,
        })
    store.replace_listings(sim.day_idx, rows)
    cap = sim.scenario.minutes_per_day
    mean = sum(l.exp_minutes for l in listings)
    sd = math.sqrt(sum(l.exp_var for l in listings)) or 1e-9
    p_over = 1 - NormalDist(mean, sd).cdf(cap) if listings else 0.0
    blocked = [c for c in sim.cases if not c.disposed and not sim.ctx.ready(c, day)]
    return {
        "day": str(day), "day_idx": sim.day_idx, "days_total": len(sim.days), "status": m.get("status"),
        "capacity": {"minutes": cap, "expected": round(mean, 1), "p80": round(mean + 0.8416 * sd, 1),
                     "p_overrun": round(p_over, 3), "count": len(listings),
                     "old_minutes": round(sum(l.exp_minutes for l in listings if sim.cases[l.case].old), 1)},
        "blocked_by_process": len(blocked),
        "listings": [{**r, "purpose_label": title(r["purpose"]), "slot": _slot(r["slot_start"])} for r in rows],
    }


def approve(ws_id: str, role: str) -> dict:
    if role != "Judge":
        raise Forbidden("Only the Judge can approve the causelist.")
    store = WorkspaceStore(ws_id)
    sim = _sim(store)
    if sim.today is None:
        raise Conflict("The posting has finished.")
    today(ws_id)  # make sure the draft is stored
    store.set_listing_status(sim.day_idx, "approved")
    store.set_meta(status="approved")
    store.log(role, "causelist.approved", {"day": str(sim.today), "count": len(sim.draft()[0])})
    return today(ws_id)


def run_day(ws_id: str, role: str) -> dict:
    if role not in ("Judge", "Court Master"):
        raise Forbidden("Only the Court Master or Judge can run the day.")
    store = WorkspaceStore(ws_id)
    sim = _sim(store)
    m = store.get_meta()
    if sim.today is None:
        raise Conflict("The posting has finished.")
    if m.get("status") != "approved":
        raise Conflict("The Judge must approve today's causelist first.")
    day, idx = sim.today, sim.day_idx
    planned = store.listings(day_idx=idx)
    recs = sim.play()
    by_case = {r.case: r for r in recs}
    rows = []
    for p in planned:
        r = by_case.get(p["case_idx"])
        if r:
            p.update(status="played", reached=bool(r.reached), substantive=bool(r.substantive),
                     advanced_to=r.advanced_to, reason=r.reason, minutes=float(r.minutes),
                     start_min=None if r.start_min is None else float(r.start_min),
                     next_gap=None if r.next_gap is None else int(r.next_gap))
        rows.append({k: v for k, v in p.items() if k != "id"})
    store.replace_listings(idx, rows)
    day_metrics = _day_metrics(recs, sim.scenario.minutes_per_day)
    store.save_snapshot(sim.day_idx, str(sim.today) if sim.today else None, sim)
    store.save_stats(sim.day_idx, str(sim.today or day), _buckets(sim, sim.today or day), day_metrics)
    store.set_meta(clock=str(sim.today) if sim.today else None, status="draft", days_played=sim.day_idx)
    store.log(role, "day.run", {"day": str(day), **day_metrics})
    return {"played": str(day), "metrics": day_metrics,
            "outcomes": [{**p, "purpose_label": title(p["purpose"]), "slot": _slot(p["slot_start"])} for p in rows],
            "next_day": str(sim.today) if sim.today else None}


def run_days(ws_id: str, n: int, role: str) -> dict:
    """Convenience for demos: approve-and-run n days (logged as the Judge approving each)."""
    last = {}
    for _ in range(n):
        if _sim(WorkspaceStore(ws_id)).today is None:
            break
        approve(ws_id, "Judge")
        last = run_day(ws_id, role)
    return last


# --------------------------------------------------------------------------------------------
def health(ws_id: str) -> dict:
    store = WorkspaceStore(ws_id)
    sim = _sim(store)
    on = sim.today or (sim.days[-1] if sim.days else sim.scenario.start)
    stats = store.stats()
    totals = sim.result().scorecard() if sim.records else {}
    return {
        "as_of": str(on), "days_played": sim.day_idx, "days_total": len(sim.days),
        "buckets_over_time": [{"day": s["day"], **s["buckets"]} for s in stats],
        "daily": [{"day": s["day"], **s["metrics"]} for s in stats if s["metrics"]],
        "totals": {k: totals.get(k) for k in ("utilisation", "reach_rate", "substantiveness", "old_heard",
                                              "old_advanced", "predictability_days", "appearances_per_advance",
                                              "disposals", "stage_advances", "slot_kept", "adjournment_heavy_advanced")},
        "at_risk": _at_risk(sim, on),
        "repeated_adjournments": _repeated(sim),
        "stage_pileup": _stages(sim),
    }


def _at_risk(sim: Simulation, on: date, window: int = 30) -> list[dict]:
    out = []
    next_date = getattr(sim.strategy, "next_date", None)
    for c in sim.cases:
        if c.disposed:
            continue
        a = age_years(c.filing_date, on)
        y = int(a) + 1
        if y < 3:
            continue
        cross = _add_years(c.filing_date, y)
        days_to = (cross - on).days
        if days_to > window:
            continue
        nd = next_date[c.idx] if isinstance(next_date, list) else (next_date or {}).get(c.idx)
        if nd is not None and nd != date.max and nd <= cross:
            continue  # a hearing is already planned before it ages
        out.append({"case_idx": c.idx, "case_id": c.case_id, "age_years": round(a, 2), "crosses_into": f"{y}+ yrs",
                    "days_to_cross": days_to, "stage": title(c.stage), "purpose": title(c.purpose),
                    "ready": sim.ctx.ready(c, on), "next_listing": None if nd in (None, date.max) else str(nd)})
    return sorted(out, key=lambda r: (r["days_to_cross"], -r["age_years"]))[:200]


def _repeated(sim: Simulation) -> list[dict]:
    hist: dict[int, list] = {}
    for r in sim.records:
        if r.reached:
            hist.setdefault(r.case, []).append(r)
    out = []
    for c in sim.cases:
        rs = hist.get(c.idx, [])
        streak = 0
        for r in reversed(rs):
            if r.substantive:
                break
            streak += 1
        historic = c.history_z > 1.0
        if streak >= 3 or (historic and not c.disposed):
            out.append({"case_idx": c.idx, "case_id": c.case_id, "stage": title(c.stage),
                        "streak_this_posting": streak, "historically_heavy": historic,
                        "last_reason": rs[-1].reason if rs else None,
                        "age_years": round(age_years(c.filing_date, sim.today or sim.days[-1]), 2)})
    return sorted(out, key=lambda r: (-r["streak_this_posting"], -r["age_years"]))[:200]


def _stages(sim: Simulation) -> list[dict]:
    counts: dict[str, int] = {}
    for c in sim.cases:
        if not c.disposed:
            counts[c.stage] = counts.get(c.stage, 0) + 1
    from ..data import STAGES
    return [{"stage": title(s), "pending": counts.get(s, 0)} for s in STAGES]


# --------------------------------------------------------------------------------------------
def case_view(ws_id: str, case_idx: int) -> dict:
    store = WorkspaceStore(ws_id)
    sim = _sim(store)
    c = sim.cases[case_idx]
    on = sim.today or sim.days[-1]
    ht = sim.hts.get(c.purpose)
    extra = sim.roster[case_idx].extra
    ready = sim.ctx.ready(c, on) if not c.disposed else None
    p_sub_type = (ht.p_sub_ready if sim.scenario.process_tracking else ht.p_sub) if ht else None
    p_case = sim.strategy.p_success(c, sim.ctx) if (ht and hasattr(sim.strategy, "p_success")) else p_sub_type
    nd = getattr(sim.strategy, "next_date", None)
    next_listing = nd[c.idx] if isinstance(nd, list) else (nd or {}).get(c.idx)
    timeline = [{k: r[k] for k in ("day", "ord", "purpose", "why", "reached", "substantive", "advanced_to",
                                    "reason", "next_gap", "status")} | {"purpose_label": title(r["purpose"])}
                for r in store.listings(case_idx=case_idx)]
    last = next((t for t in reversed(timeline) if t["status"] == "played"), None)
    return {
        "case_idx": c.idx, "case_id": c.case_id, "advocate": c.advocate, "filing_date": str(c.filing_date),
        "as_of": str(on), "disposed": c.disposed,
        "chain": {
            "age_years": round(age_years(c.filing_date, on), 2), "age_bucket": bucket(age_years(c.filing_date, on)),
            "old": c.old, "stage": title(c.stage), "purpose": title(c.purpose),
            "side_purpose": c.purpose in SIDE_PURPOSES,
            "expected_minutes": ht.minutes if ht else None,
            "can_happen": ready, "can_happen_note": None if ready in (None, True) else "summons/warrant not yet returned",
            "p_substantive_type": round(p_sub_type, 3) if p_sub_type is not None else None,
            "p_substantive_case": round(p_case, 3) if p_case is not None else None,
            "p_move_on": round(p_advance(ht, sim.scenario.advance_rule), 3) if ht else None,
            "published_gap_days": ht.gap_days if ht else None,
            "next_listing": None if next_listing in (None, date.max) else str(next_listing),
            "next_reason": _next_reason(last),
        },
        "history": {
            "hearings_so_far": sim.roster[case_idx].hearings_so_far,
            "hearings_by_type": {title(k): v for k, v in extra.get("hearings_by_type", {}).items() if v},
            "last_hearing_summary": extra.get("last_hearing_summary"),
            "adjournment_heavy": c.history_z > 1.0,
        },
        "timeline": timeline,
    }


def _next_reason(last: dict | None) -> str | None:
    if not last:
        return "Not yet heard in this posting; waiting its turn by priority."
    if last["advanced_to"] == "DISPOSED":
        return "Disposed."
    if last["advanced_to"] and last["purpose"] in SIDE_PURPOSES:
        return f"{title(last['purpose'])} done: back to {title(last['advanced_to'])} ({last['next_gap']} days)."
    if last["advanced_to"]:
        return f"Moved on to {title(last['advanced_to'])}: next type's published gap ({last['next_gap']} days)."
    if last["substantive"]:
        return f"Useful hearing, same stage: published gap ({last['next_gap']} days)."
    if last["reason"] and "Awaiting Process" in last["reason"]:
        return "Summons/warrant not back: listed once it returns."
    if last["reached"] is False:
        return "Not reached (ran out of time): carried over to the next sitting day."
    return f"Adjourned ({last['reason']}): short gap ({last['next_gap']} days)."


# --------------------------------------------------------------------------------------------
def days(ws_id: str) -> list[dict]:
    store = WorkspaceStore(ws_id)
    return [{"day": s["day"], **s["metrics"]} for s in store.stats() if s["metrics"]]


def day_detail(ws_id: str, day_idx: int) -> list[dict]:
    rows = WorkspaceStore(ws_id).listings(day_idx=day_idx)
    return [{**r, "purpose_label": title(r["purpose"]), "slot": _slot(r["slot_start"])} for r in rows]


def events(ws_id: str) -> list[dict]:
    return WorkspaceStore(ws_id).events()


def _buckets(sim: Simulation, on: date) -> dict:
    out = {b: 0 for b in BUCKETS}
    for c in sim.cases:
        if not c.disposed:
            out[bucket(age_years(c.filing_date, on))] += 1
    return out


def _day_metrics(recs, cap: int) -> dict:
    reached = [r for r in recs if r.reached]
    used = min(cap, sum(r.minutes for r in reached))
    return {"listed": len(recs), "reached": len(reached), "substantive": int(sum(bool(r.substantive) for r in reached)),
            "advanced": int(sum(bool(r.advanced_to) for r in reached)),
            "disposed": int(sum(r.advanced_to == "DISPOSED" for r in reached)),
            "minutes_used": round(float(used), 1), "utilisation": round(float(used) / cap, 3),
            "old_heard": int(sum(bool(r.old) for r in reached))}


def _slot(slot_start) -> str | None:
    if slot_start is None:
        return None
    h = 10 + int(slot_start // 60)
    return f"{h:02d}:00–{h + 1:02d}:00"


def _add_years(d: date, y: int) -> date:
    try:
        return d.replace(year=d.year + y)
    except ValueError:  # 29 Feb
        return d.replace(year=d.year + y, day=28)


# ============================================================================================
# Slice 2: overrides, options, forecasts, rules, calendar
# ============================================================================================
import pickle as _pickle  # noqa: E402

from ..forecast import Option, apply as apply_option, forecast as run_forecast, hindsight  # noqa: E402

RULES = [  # (param, label, help, min, max, step, policy)
    ("fill", "How full to pack a day", "Chance the day fits in 420 minutes. Higher = safer days, more idle time.", 0.5, 0.97, 0.01, None),
    ("old_share", "Time guaranteed to 4+ yr cases", "Minimum share of each day's minutes for ready old cases.", 0.0, 0.6, 0.05, (">=", 0.30)),
    ("old_max_wait", "Longest an old case may wait", "Sitting days a ready 4+ yr case may wait before it jumps the queue.", 3, 30, 1, ("<=", 10)),
    ("age_weight", "Weight on age when ranking", "Priority boost per year of age.", 0.0, 3.0, 0.05, None),
    ("adv_bonus", "Group an advocate's cases on a day", "Preference for advocates already listed that day (0 = off).", 0.0, 2.0, 0.1, None),
    ("short_gap", "Gap after an absence", "Days before re-listing when a party was absent or asked for time.", 3, 21, 1, None),
    ("gap_mult", "Spacing of next dates", "Multiplier on the published gap for each hearing type.", 0.5, 2.0, 0.05, None),
    ("due_share", "Share of a day that can be promised", "How much of a future day next dates may book in advance.", 0.2, 0.6, 0.05, None),
]


def _check_policy(params: dict) -> None:
    for key, label, _h, _lo, _hi, _st, pol in RULES:
        if pol and key in params:
            op, bound = pol
            v = params[key]
            if (op == ">=" and v < bound) or (op == "<=" and v > bound):
                raise Forbidden(f"'{label}' is locked by policy ({op} {bound}); judges can tighten it, not loosen it.")


def rules(ws_id: str) -> dict:
    sim = _sim(WorkspaceStore(ws_id))
    p = getattr(sim.strategy, "p", None)
    items = []
    for key, label, help_, lo, hi, step, pol in RULES:
        if p is None or not hasattr(p, key):
            continue
        v = getattr(p, key)
        ok = True
        if pol:
            ok = v >= pol[1] if pol[0] == ">=" else v <= pol[1]
        items.append({"key": key, "label": label, "help": help_, "value": v, "min": lo, "max": hi, "step": step,
                      "policy": None if not pol else {"op": pol[0], "bound": pol[1]}, "within_policy": ok})
    return {"strategy": sim.strategy.name, "editable": p is not None, "rules": items,
            "presets": [{"id": k, "label": v[0]} for k, v in PRESETS.items() if k != "current_practice"]}


def preset_params(preset: str) -> dict:
    s = PRESETS[LEGACY_PRESETS.get(preset, preset)][1]()
    p = getattr(s, "p", None)
    return {k: getattr(p, k) for k, *_ in RULES if p is not None and hasattr(p, k)}


def _option(d: dict) -> Option:
    params = dict(d.get("params") or {})
    if d.get("preset"):
        params = {**preset_params(d["preset"]), **params}
    return Option(
        label=d.get("label") or "Option",
        params=params,
        remove=[int(x) for x in d.get("remove", [])],
        add=[int(x) for x in d.get("add", [])],
        extra=int(d.get("extra", 0) or 0),
        move={int(k): date.fromisoformat(v) for k, v in (d.get("move") or {}).items()},
        leave=[date.fromisoformat(x) for x in d.get("leave", [])],
    )


def candidates(ws_id: str, limit: int = 40, q: str | None = None) -> list[dict]:
    sim = _sim(WorkspaceStore(ws_id))
    if sim.today is None:
        return []
    ids = sim.candidates(limit=3000 if q else limit)
    out = []
    for i in ids:
        c = sim.cases[i]
        if q and q.lower() not in c.case_id.lower():
            continue
        out.append({"case_idx": i, "case_id": c.case_id, "advocate": c.advocate, "purpose_label": title(c.purpose),
                    "age_years": round(age_years(c.filing_date, sim.today), 2)})
        if len(out) >= limit:
            break
    return out


def forecast(ws_id: str, options: list[dict], weeks: int = 4, samples: int = 3) -> dict:
    sim = _sim(WorkspaceStore(ws_id))
    opts = [_option(o) for o in options]
    return run_forecast(sim, opts, weeks=weeks, samples=samples)


def apply(ws_id: str, option: dict, role: str) -> dict:
    if role != "Judge":
        raise Forbidden("Only the Judge can change the plan or the rules.")
    store = WorkspaceStore(ws_id)
    sim = _sim(store)
    if sim.today is None:
        raise Conflict("The posting has finished.")
    opt = _option(option)
    reason = (option.get("reason") or "").strip()
    if not reason:
        raise Conflict("Say why: every change to the plan or the rules needs a reason.")
    if opt.params:
        _check_policy(opt.params)
    impact = run_forecast(sim, [opt], weeks=int(option.get("weeks", 4)), samples=3)
    delta = impact["options"][1]["delta"] if len(impact["options"]) > 1 else {}
    before = _pickle.dumps(sim)
    store.add_change(role, sim.day_idx, str(sim.today), opt.label, reason,
                     {k: v for k, v in option.items() if k != "reason"},
                     {"weeks": impact.get("weeks"), "delta": {k: v["mean"] for k, v in delta.items()},
                      "affected": impact["options"][1].get("affected", {}).get("counts") if len(impact["options"]) > 1 else None},
                     before)
    apply_option(sim, opt)
    store.save_snapshot(sim.day_idx, str(sim.today), sim)
    leave = sorted(set(store.get_meta().get("leave", [])) | {str(d) for d in opt.leave})
    store.set_meta(leave=leave, days_total=len(sim.days))
    store.log(role, "plan.changed", {
        "day": str(sim.today), "label": opt.label, "params": opt.params, "removed": opt.remove, "added": opt.add,
        "overbooked": opt.extra, "moved": {sim.cases[c].case_id: str(d) for c, d in opt.move.items()},
        "leave": [str(d) for d in opt.leave], "reason": reason,
        "cost": {k: round(v["mean"], 3) for k, v in delta.items() if v["mean"] is not None}})
    return today(ws_id)


def calendar(ws_id: str, weeks: int = 6) -> dict:
    from ..data import DATA_DIR
    import csv as _csv
    store = WorkspaceStore(ws_id)
    sim = _sim(store)
    start = sim.today or sim.days[-1]
    end = start + timedelta(days=7 * weeks)
    leave = set(store.get_meta().get("leave", []))
    sitting = {str(d) for d in sim.days}
    promised = getattr(sim.strategy, "promised", {}) or {}
    budget = getattr(getattr(sim.strategy, "p", None), "due_share", 0.35) * sim.scenario.minutes_per_day
    cal = {}
    with open(DATA_DIR / "court_calendar.csv", newline="") as f:
        for r in _csv.DictReader(f):
            cal[r["date"]] = r
    days_out = []
    d = start - timedelta(days=start.weekday())
    while d < end:
        ds = str(d)
        r = cal.get(ds, {})
        days_out.append({
            "date": ds, "past": d < start, "today": d == start, "sitting": ds in sitting and d >= start,
            "leave": ds in leave, "holiday": r.get("holiday_name") or None, "weekly_off": r.get("is_weekly_off") == "Yes",
            "promised": round(promised.get(d, 0.0), 1), "budget": round(budget, 1),
        })
        d += timedelta(days=1)
    return {"from": str(start), "weeks": weeks, "capacity": sim.scenario.minutes_per_day, "days": days_out,
            "moves": {sim.cases[c].case_id: str(dd) for c, dd in sim.moves.items()}}


def pending_overrides(ws_id: str) -> dict:
    sim = _sim(WorkspaceStore(ws_id))
    o = sim.overrides
    cid = lambda i: {"case_idx": i, "case_id": sim.cases[i].case_id}
    return {"removed": [cid(i) for i in o["remove"]], "added": [cid(i) for i in o["add"]], "extra": o["extra"],
            "moved": [{**cid(i), "to": str(d)} for i, d in sim.moves.items()]}


_review_cache: dict[tuple, dict] = {}
REVIEW_KEYS = ["utilisation", "substantive_per_day", "carried_over", "days_late", "stage_advances",
               "backlog_3+_end", "backlog_4+_end", "backlog_5+_end", "disposals"]


def changes(ws_id: str) -> list[dict]:
    """The change journal: what was changed, why, what was expected, and (after some days) what happened."""
    store = WorkspaceStore(ws_id)
    sim = _sim(store)
    out = []
    for ch in store.changes():
        played = sim.day_idx - ch["day_idx"]
        review = None
        if played >= 1:
            key = (ws_id, ch["id"], sim.day_idx)
            if key not in _review_cache:
                before = _pickle.loads(ch["before"])
                opt = _option({**ch["option"], "label": ch["label"]})
                until = sim.days[sim.day_idx - 1] if sim.day_idx - 1 < len(sim.days) else sim.days[-1]
                exp = run_forecast(before, [opt], until=until, samples=3)
                h = hindsight(before, opt, until)
                _review_cache[key] = {
                    "days": h["days"], "until": str(until),
                    "expected": {k: exp["options"][1]["delta"][k]["mean"] for k in REVIEW_KEYS} if len(exp["options"]) > 1 else {},
                    "actual": {k: h["delta"][k] for k in REVIEW_KEYS}, "affected": h["affected"],
                }
            review = _review_cache[key]
        out.append({"id": ch["id"], "ts": ch["ts"], "role": ch["role"], "day": ch["day"], "label": ch["label"],
                    "reason": ch["reason"], "option": ch["option"], "forecast_at_time": ch["expected"],
                    "sitting_days_since": played, "review": review})
    return out



def parse_roster(csv_text: str) -> dict:
    from ..data import load_hearing_types, parse_roster_csv
    return parse_roster_csv(csv_text, set(load_hearing_types()), today=Scenario().start)


def preview_roster(csv_text: str) -> dict:
    """Check a CSV before creating a court: counts, age mix, stage mix, and every problem row."""
    on = Scenario().start
    res = parse_roster(csv_text)
    cs = res["cases"]
    ages = {b: 0 for b in BUCKETS}
    stages: dict[str, int] = {}
    for c in cs:
        ages[bucket(age_years(c.filing_date, on))] += 1
        stages[title(c.stage)] = stages.get(title(c.stage), 0) + 1
    return {"valid": len(cs), "errors": res["errors"][:100], "error_count": len(res["errors"]),
            "warnings": res["warnings"], "age_buckets": ages, "stages": stages,
            "advocates": len({c.advocate for c in cs}), "as_of": str(on),
            "sample": [{"case_id": c.case_id, "filing_date": str(c.filing_date), "stage": title(c.stage),
                        "purpose": title(c.purpose), "advocate": c.advocate} for c in cs[:5]]}
