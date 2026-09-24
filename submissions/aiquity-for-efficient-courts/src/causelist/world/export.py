"""Export a finished world + court run as one JSON document for an external (3D) renderer.

    PYTHONPATH=src python -m causelist.world.export --out out/world_export.json

``export_world(world, sim_result) -> dict`` is JSON-serialisable. Coordinates are on a
0..1000 plane (x right, y up). Every person, place and business is synthetic.

Schema (``schema == "town-world/1"``)
------------------------------------
funnel         dispute funnel from population: {config (every rate with its source), stages,
               window_days, sitting_days_per_year, expected_filings_per_sitting_day,
               observed_filings_per_sitting_day, expected_per_year {kind: {stage: n}},
               observed_in_window {kind: {stage: n}} (other-forum kinds are a background_sample),
               table [rows from funnel.funnel_table]}
meta           seed, roster, config, start, end, plane (1000), person_states, dispute_states,
               funnel_keys, event_types, filings (complaints filed from the town), sitting_days
places         court {id, name, x, y}
               neighbourhoods [{name, x, y, radius}]
               businesses [{id, name, kind, owner_id, x, y}]
people         [{id, name, x, y, neighbourhood, occupation, household, wage, dispute_ids, case_ids}]
advocates      [{id, name, x, y, adopted}]      adopted = id taken from the pre-existing docket
relationships  [{id, kind, creditor_id, debtor_id, amount_scale, dispute_ids}]
               who owes whom. kind: lender_borrower | supplier_shop | employer_worker |
               landlord_tenant | family_property | other | docket (edge for an adopted docket case)
days           [ISO date] -- the court's sitting days, same order as ``timeline``
prelude        {events: [...]}  world events dated before the first sitting day (disputes already
               under way when the window opens, and adopted docket cases at their filing date)
timeline       one entry per sitting day:
  day            ISO date
  people_state   {person_id: state}. timeline[0] lists EVERY person; later days list only people
                 whose state changed that day (delta encoding -- carry the previous value forward)
  deltas         {person_id: [trips_added, wages_lost_added]} for people who went to court that day
  disputes       [{id, parties: [complainant_id, accused_id], kind, state, case_id}] disputes whose
                 state changed since the previous sitting day (latest state of the day)
  events         [{type, day, person_ids, dispute_id, case_id, text}] world events after the
                 previous sitting day up to and including this day (non-sitting days roll forward)
  court          {listed, filed, lines: [{case_id, dispute_id, origin, window, purpose,
                 advocate_id, outcome, reason, next_date}]}  that day's causelist and outcomes
  funnel         cumulative counts of town cheque disputes by funnel step (keys: meta.funnel_keys)
  totals         {people_by_state, trips, wages_lost}  running totals for the whole town
disputes       [{id, kind (funnel kind), kind_label, forum, relationship, money_at_stake, origin, complainant_id, accused_id, amount, case_id, advocate_id,
               started, filed_on, resolved_on, resolution, final_state, court_stage, hearings,
               adjournments, story, timeline: [{day, source, type, text, outcome, reason}]}]
               ``story`` is a one-paragraph plain-language summary; ``timeline`` runs from the first
               quarrel through notice, filing, each hearing (outcome + reason) to resolution,
               joining world events (source "world") with simulator events (source "court").
"""
from __future__ import annotations

import argparse
import json
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

from .config import sitting_days_per_year
from .funnel import STAGES, funnel_table
from .model import DISPUTE_STATES, FUNNEL, PERSON_STATES, TownWorld
from .town import COURT_XY, KIND_TEXT, NEIGHBOURHOODS

SCHEMA = "town-world/1"

# world event type -> dispute state it puts the dispute in
EVENT_STATE = {
    "quarrel": "arisen", "legal_notice": "notice", "negotiation": "negotiating",
    "notice_expired": "awaiting_filing", "complaint_filed": "in_court", "adopted": "in_court",
    "settled_pre_court": "settled_pre_court", "dropped": "dropped",
    "settled_in_court": "settled_in_court", "judgement": "judgement", "withdrawn": "withdrawn",
    "complaint_returned": "dropped", "other_forum": "other_forum",
}
EVENT_TYPES = sorted(set(EVENT_STATE) | {"hearing", "settled_pre_court"})


def _hhmm(day_start: str, minutes: float) -> str:
    h, m = map(int, day_start.split(":"))
    t = h * 60 + m + int(minutes)
    return f"{t // 60:02d}:{t % 60:02d}"


def _event(e: dict[str, Any]) -> dict[str, Any]:
    out = {"type": e["kind"], "day": e["day"], "person_ids": e.get("people", []),
           "dispute_id": e.get("dispute_id"), "case_id": e.get("case_id"), "text": e["text"]}
    for k in ("purpose", "outcome", "reason", "next_date", "wages_lost", "advocate_id", "amount"):
        if e.get(k) is not None:
            out[k] = e[k]
    return out


def _story(world: TownWorld, d, rows: list[dict[str, Any]]) -> str:
    comp, acc = world.person(d.complainant).name, world.person(d.accused).name
    if d.origin == "roster":
        parts = [f"A case already on the docket: {comp} v. {acc}, filed {d.filed_on}."]
    else:
        what, trigger = KIND_TEXT.get(d.relationship or d.kind, ("knows", "a quarrel over money broke out"))
        parts = [f"{comp} {what} {acc}; on {d.started} {trigger} ({d.amount:,.0f} at stake)."]
        notice = next((r for r in rows if r["type"] == "legal_notice"), None)
        if notice:
            parts.append(f"A legal notice went out on {notice['day']}.")
    if d.case_id and d.origin == "world":
        parts.append(f"The complaint was filed on {d.filed_on} as {d.case_id} (advocate {d.advocate_id}).")
    hearings = [r for r in rows if r["type"] == "hearing"]
    if hearings:
        heard = sum(1 for r in hearings if r["outcome"] == "substantive")
        reasons = Counter(r["reason"] for r in hearings if r["reason"])
        s = f"{len(hearings)} hearing(s) in the window: {heard} moved the case forward"
        if len(hearings) > heard:
            s += f", {len(hearings) - heard} did not"
            if reasons:
                s += f" (most often: {reasons.most_common(1)[0][0]})"
        parts.append(s + ".")
    end = {"settled_pre_court": "It settled before reaching court.", "dropped": "The claim was dropped.",
           "judgement": "Judgement was delivered.",
           "settled_in_court": "The parties settled mid-trial; the complainant wants to withdraw.",
           "withdrawn": "The parties settled mid-trial and the case was withdrawn.",
           "other_forum": "The claim went to another forum.",
           "in_court": f"Still pending at {d.court_stage} when the window closes.",
           }.get(d.state, f"Still {d.state.replace('_', ' ')} when the window closes.")
    final = next((r for r in reversed(rows) if r["type"] in ("judgement", "settled_in_court", "withdrawn",
                                                             "settled_pre_court", "dropped", "other_forum",
                                                             "complaint_returned")), None)
    parts.append(final["text"] + "." if final and d.state != "in_court" else end)
    return " ".join(parts)


def export_world(world: TownWorld, sim_result: Any) -> dict[str, Any]:
    res = sim_result
    days = [dr.day for dr in res.days]
    iso = [d.isoformat() for d in days]
    first = iso[0] if iso else "9999-12-31"

    # --- static layer --------------------------------------------------------
    people = []
    for p in world.people:
        ds = [world.disputes[did] for did in p.disputes]
        people.append({"id": p.pid, "name": p.name, "x": p.x, "y": p.y, "neighbourhood": p.neighbourhood,
                       "occupation": p.occupation, "household": p.household, "wage": p.wage,
                       "dispute_ids": [d.did for d in ds], "case_ids": [d.case_id for d in ds if d.case_id]})
    places = {
        "court": {"id": "COURT", "name": "Town court complex", "x": COURT_XY[0], "y": COURT_XY[1]},
        "neighbourhoods": [{"name": n[0], "x": n[1], "y": n[2], "radius": round(2 * n[3], 1)}
                           for n in NEIGHBOURHOODS],
        "businesses": [{"id": b.bid, "name": b.name, "kind": b.kind, "owner_id": b.owner, "x": b.x, "y": b.y}
                       for b in world.town.businesses],
    }
    advocates = [{"id": a.aid, "name": a.name, "x": a.x, "y": a.y, "adopted": a.adopted}
                 for a in sorted(world.advocates.values(), key=lambda a: a.aid)]
    rel_disputes: dict[int, list[str]] = defaultdict(list)
    relationships = []
    for d in world.disputes.values():
        if d.rid is not None:
            rel_disputes[d.rid].append(d.did)
    for r in world.town.relationships:
        relationships.append({"id": f"R-{r.rid:05d}", "kind": r.kind, "creditor_id": r.creditor,
                              "debtor_id": r.debtor, "amount_scale": r.scale,
                              "dispute_ids": rel_disputes.get(r.rid, [])})
    for d in world.disputes.values():
        if d.rid is None:
            relationships.append({"id": f"R-{d.did}", "kind": "docket", "creditor_id": d.complainant,
                                  "debtor_id": d.accused, "amount_scale": d.amount, "dispute_ids": [d.did]})

    # --- per-day layer -------------------------------------------------------
    events = world.events
    prelude = [_event(e) for e in events if e["day"] < first]
    buckets: dict[str, list[dict[str, Any]]] = defaultdict(list)
    j = 0
    for e in sorted((e for e in events if e["day"] >= first), key=lambda e: e["day"]):
        while j < len(iso) - 1 and e["day"] > iso[j]:
            j += 1
        if e["day"] <= iso[j]:
            buckets[iso[j]].append(e)

    disp_by_case = {cid: did for cid, did in world.by_case.items()}
    prev_state: list[int] | None = None
    prev_trips: list[int] | None = None
    prev_wages: list[float] | None = None
    timeline = []
    for dr, day_iso in zip(res.days, iso):
        rec = world._record_for(dr.day)
        st, tr, wl = rec["person_state"], rec["trips"], rec["wages_lost"]
        if prev_state is None:
            ps = {p.pid: PERSON_STATES[st[i]] for i, p in enumerate(world.people)}
            base_t, base_w = [0] * len(tr), [0.0] * len(wl)
        else:
            ps = {p.pid: PERSON_STATES[st[i]] for i, p in enumerate(world.people) if st[i] != prev_state[i]}
            base_t, base_w = prev_trips, prev_wages
        deltas = {p.pid: [tr[i] - base_t[i], round(wl[i] - base_w[i], 1)]
                  for i, p in enumerate(world.people) if tr[i] != base_t[i] or wl[i] != base_w[i]}
        prev_state, prev_trips, prev_wages = st, tr, wl

        day_events = buckets.get(day_iso, [])
        changed: dict[str, str] = {}
        for e in day_events:
            if e["kind"] in EVENT_STATE and e.get("dispute_id"):
                changed[e["dispute_id"]] = EVENT_STATE[e["kind"]]
        dchg = []
        for did, state in changed.items():
            d = world.disputes[did]
            dchg.append({"id": did, "parties": [d.complainant, d.accused], "kind": d.kind, "state": state,
                         "case_id": d.case_id if state in ("in_court", "settled_in_court", "judgement") else None})

        outs = {o.case_id: o for o in dr.outcomes}
        lines = []
        for l in sorted(dr.plan.listings, key=lambda l: (l.start_min, l.case_id)):
            o = outs.get(l.case_id)
            did = disp_by_case.get(l.case_id)
            lines.append({"case_id": l.case_id, "dispute_id": did,
                          "origin": world.disputes[did].origin if did else "roster",
                          "window": f"{_hhmm(res.config.day_start, l.start_min)}-{_hhmm(res.config.day_start, l.end_min)}",
                          "purpose": l.purpose, "advocate_id": l.advocate_id,
                          "outcome": o.kind if o else None, "reason": o.reason if o else None,
                          "next_date": o.next_date.isoformat() if o and o.next_date else None})
        counts = Counter(PERSON_STATES[s] for s in st)
        timeline.append({
            "day": day_iso, "people_state": ps, "deltas": deltas, "disputes": dchg,
            "events": [_event(e) for e in day_events],
            "court": {"listed": len(lines), "filed": dr.new_filings, "lines": lines},
            "funnel": rec["funnel"],
            "totals": {"people_by_state": {s: counts.get(s, 0) for s in PERSON_STATES},
                       "trips": sum(tr), "wages_lost": round(sum(wl), 1)},
        })

    # --- dispute stories -----------------------------------------------------
    sim_by_case: dict[str, list] = defaultdict(list)
    for ev in res.events:
        if ev.case_id:
            sim_by_case[ev.case_id].append(ev)
    disputes = []
    for d in world.disputes.values():
        f = world.follow(d.did, sim_by_case.get(d.case_id or "", []))
        rows = [{"day": r["day"], "source": r["source"], "type": r["kind"], "text": r["text"],
                 "outcome": r["outcome"], "reason": r["reason"]} for r in f["timeline"]]
        k = world.funnel.kinds.get(d.kind)
        disputes.append({"id": d.did, "kind": d.kind, "kind_label": k.label if k else d.kind,
                         "forum": k.forum if k else "this_court", "relationship": d.relationship,
                         "money_at_stake": d.amount, "origin": d.origin, "complainant_id": d.complainant,
                         "accused_id": d.accused, "amount": d.amount, "case_id": d.case_id,
                         "advocate_id": d.advocate_id, "started": d.started.isoformat(),
                         "filed_on": d.filed_on.isoformat() if d.filed_on else None,
                         "resolved_on": d.resolved_on.isoformat() if d.resolved_on else None,
                         "resolution": d.resolution, "final_state": d.state, "court_stage": d.court_stage,
                         "hearings": d.hearings, "adjournments": d.adjournments,
                         "story": _story(world, d, rows), "timeline": rows})

    window_days = (res.end - res.start).days + 1
    observed = world.observed_funnel(res.start, res.end)
    spy = sitting_days_per_year()
    funnel = {
        "config": world.funnel.as_config(),
        "stages": STAGES,
        "window_days": window_days,
        "sitting_days_per_year": round(spy, 1),
        "expected_filings_per_sitting_day": round(world.funnel.court_filings_per_year() / spy, 2),
        "observed_filings_per_sitting_day": round(sum(1 for c in res.cases if c.origin == "world") / max(1, len(days)), 2),
        "expected_per_year": {k.kind: {s: round(v, 1) for s, v in k.expected(world.funnel.city_population).items()}
                              for k in world.funnel.kinds.values()},
        "observed_in_window": observed,
        "table": funnel_table(world.funnel, window_days=window_days, observed=observed,
                              sitting_days_per_year=spy),
    }

    return {
        "schema": SCHEMA,
        "funnel": funnel,
        "meta": {"seed": world.seed, "config": res.config.name, "start": res.start.isoformat(),
                 "end": res.end.isoformat(), "plane": 1000, "person_states": PERSON_STATES,
                 "dispute_states": sorted(DISPUTE_STATES), "funnel_keys": FUNNEL, "event_types": EVENT_TYPES,
                 "filings": sum(1 for c in res.cases if c.origin == "world"), "sitting_days": len(days),
                 "withdrawal_intents": world.withdrawal_intents},
        "places": places, "people": people, "advocates": advocates, "relationships": relationships,
        "days": iso, "prelude": {"events": prelude}, "timeline": timeline, "disputes": disputes,
    }


def main() -> None:
    from .runner import OUT_DIR, run_world
    ap = argparse.ArgumentParser(description="Run the town + court and write the world export JSON.")
    ap.add_argument("--roster", default=None, help="roster CSV (default: the 100-case sample)")
    ap.add_argument("--config", default="optimal")
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--out", default=str(OUT_DIR / "world_export.json"))
    args = ap.parse_args()
    run = run_world(args.roster, args.config, args.seed)
    doc = export_world(run["world"], run["res"])
    doc["meta"]["roster"] = Path(args.roster).name if args.roster else "roster_sample_100.csv"
    doc["meta"]["runtime_s"] = run["runtime_s"]
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(doc, separators=(",", ":"))
    out.write_text(text)
    print(f"wrote {out.name}: {len(text) / 1e6:.2f} MB, {len(doc['people'])} people, "
          f"{len(doc['disputes'])} disputes, {doc['meta']['filings']} filings, {len(doc['days'])} days")


if __name__ == "__main__":
    main()
