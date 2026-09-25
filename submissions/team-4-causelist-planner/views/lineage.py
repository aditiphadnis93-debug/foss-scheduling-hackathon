"""Decision lineage: every decision that put a case on a given day, in the order the pipeline made them.

It reads what the stages recorded (DayPlan.rank / how / skipped, Listing.reasons / window_why) and
re-derives the rest from the case and the judge's config (eligibility gates, score terms). It never
changes the plan.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date

import pandas as pd
import streamlit as st

from scheduler.capacity import duration, expected_cost, p_heard
from scheduler.eligibility import gates
from scheduler.models import Listing
from scheduler.scoring import terms

from .court import Courtroom


@dataclass
class Lineage:
    case_id: str
    facts: list[tuple[str, str]]
    days: list[dict]  # one row per planned day up to (and including) the listed day
    listed_on: date | None = None
    listing: Listing | None = None
    gates: list[tuple[str, bool, str]] = field(default_factory=list)
    score_terms: list[tuple[float, str]] = field(default_factory=list)
    rank: int | None = None
    pool_size: int = 0
    how: str = ""
    recorded: bool = True  # False for saved schedules made before lineage was recorded


def _day_status(room: Courtroom, case_id: str, day: date) -> dict:
    plan = room.plan_on(day)
    c = room.by_id[case_id]
    listing = next((l for l in plan.listings if l.case_id == case_id), None) if plan else None
    row = {"Day": day.strftime("%a %d %b"), "Rank": "", "Outcome": "", "Why": ""}
    if listing:
        row.update(Outcome="✅ listed", Why=f"{listing.block} · {listing.window}")
        if case_id in plan.rank:
            row["Rank"] = f"{plan.rank[case_id]} of {plan.pool_size}"
        return row
    if plan and case_id in plan.rank:
        row.update(Rank=f"{plan.rank[case_id]} of {plan.pool_size}", Outcome="⏭ eligible, not listed",
                   Why=plan.skipped.get(case_id, ""))
        return row
    failed = next(((g, d) for g, ok, d in gates(c, day, room.cfg) if not ok), None)
    if failed:
        row.update(Outcome="⛔ not eligible", Why=f"{failed[0]}: {failed[1]}")
    else:
        row.update(Outcome="· eligible", Why="not recorded (saved schedules keep only listings and near-misses)")
    return row


def build(room: Courtroom, case_id: str) -> Lineage:
    c = room.by_id[case_id]
    listed_on, listing = None, None
    for d in room.days:
        plan = room.plan_on(d)
        listing = next((l for l in plan.listings if l.case_id == case_id), None) if plan else None
        if listing:
            listed_on = d
            break
    on = listed_on or room.days[0]
    facts = [
        ("Filed", f"{c.filing_date:%d %b %Y} ({c.age_bucket(on)} old on {on:%d %b})"),
        ("Case type", c.case_type),
        ("Next hearing for", c.purpose.replace("_", " ")),
        ("Last heard", f"{c.last_heard:%d %b %Y}" if c.last_heard else "never"),
        ("Adjournments so far", str(c.adjournment_count)),
        ("Passed over (days running)", str(c.consecutive_skips)),
        ("Urgent", "yes" if c.urgent else "no"),
        ("Prerequisites", "met" if c.prerequisites_met else "pending"),
        ("Advocate", room.store.directory.advocate(c.advocate_ids[0])),
        ("Expected time", f"{duration(c)} min × {p_heard(c):.0%} chance heard = {expected_cost(c):.1f} expected min"),
    ]
    upto = [d for d in room.days if listed_on is None or d <= listed_on]
    lin = Lineage(case_id, facts, [_day_status(room, case_id, d) for d in upto], listed_on, listing)
    if listed_on:
        plan = room.plan_on(listed_on)
        lin.gates = gates(c, listed_on, room.cfg)
        lin.score_terms = terms(c, listed_on, room.cfg)
        lin.rank, lin.pool_size = plan.rank.get(case_id), plan.pool_size
        lin.how = plan.how.get(case_id, "")
        lin.recorded = bool(plan.how)
    return lin


# Placement steps by the prefix of the recorded `how` (or, for older saves, of the first stored reason).
ROUTES = [(("booked",), "Booked at last hearing"),
          (("locked starvation guard", "starvation guard"), "Starvation guard (locked)"),
          (("locked ageing quota",), "Ageing quota (locked)"),
          (("clustering", "clustered"), "Clustering")]


def route_label(how: str, listing: Listing) -> str:
    """The placement step that listed the case."""
    text = (how or " ".join(listing.reasons[:1])).lower()
    return next((name for prefixes, name in ROUTES if text.startswith(prefixes)), "Block fill")


# ---------------------------------------------------------------- rendering

def _step(n: int, title: str) -> None:
    st.markdown(f"##### {n}. {title}")


def render(room: Courtroom, case_id: str, case_number: str) -> None:
    lin = build(room, case_id)
    c = room.by_id[case_id]
    st.markdown(f"#### Decision lineage · {case_number}")
    st.caption(room.parties(c))

    if lin.listed_on:
        booked = bool(lin.listing.reasons) and lin.listing.reasons[0] == "booked at last hearing"
        route = route_label(lin.how, lin.listing)
        chips = [("Eligible", "all gates passed"),
                 ("Ranked", f"{lin.rank} of {lin.pool_size}" if lin.rank else ("booked" if booked else "—")),
                 ("Placed by", route),
                 ("Block", lin.listing.block),
                 ("Window", lin.listing.window or "—")]
        for col, (k, v) in zip(st.columns(len(chips)), chips):
            col.markdown(f"<small>{k}</small><br>**{v}**", unsafe_allow_html=True)
    else:
        st.info("Not listed in this plan's horizon. The days below show why.")
    if not lin.recorded:
        st.caption("This saved schedule was made before lineage was recorded: placement and window details are "
                   "missing, the rest is re-derived from the case and the judge's rules.")

    _step(1, "The case going in")
    st.dataframe(pd.DataFrame(lin.facts, columns=["", "Value"]), hide_index=True)

    _step(2, "Day by day in this plan" + (f", up to {lin.listed_on:%a %d %b}" if lin.listed_on else ""))
    st.caption("Each sitting day the planner filters the roster, ranks the eligible pool and fills the blocks. "
               "A case is listed once in a plan; earlier days show why it waited.")
    st.dataframe(pd.DataFrame(lin.days), hide_index=True)
    if not lin.listed_on:
        return

    day = f"{lin.listed_on:%a %d %b}"
    _step(3, f"Eligibility on {day}")
    st.dataframe(pd.DataFrame([{"Gate": g, "": "✅" if ok else "⛔", "Detail": d} for g, ok, d in lin.gates]),
                 hide_index=True)

    _step(4, "Score and rank")
    agent = [r for r in lin.listing.reasons if r.startswith("judge agent")]
    if agent:
        st.markdown(f"The L3 judge agent ranked this case: {agent[0]}")
    total = sum(v for v, _ in lin.score_terms)
    rows = [{"Term": label, "Points": round(v, 1)} for v, label in sorted(lin.score_terms, reverse=True)]
    st.dataframe(pd.DataFrame(rows + [{"Term": "Total", "Points": round(total, 1)}]), hide_index=True)
    w = room.cfg.weights
    st.caption("Points = the judge's weight × the case's value. Weights: "
               + ", ".join(f"{k} {v:g}" for k, v in w.items())
               + (f". Ranked {lin.rank} of {lin.pool_size} eligible cases." if lin.rank else "."))

    _step(5, "How it got a place")
    if lin.how:
        for part in lin.how.split(" · "):
            st.markdown(f"- {part}")
    else:
        st.markdown(f"- {lin.listing.reasons[0] if lin.listing.reasons else 'listed'}")
    st.caption("Placement order each day: cases booked at their last hearing → the locked starvation guard → "
               "the locked ageing quota → each block filled in its own order (with clustering if on).")

    _step(6, f"Block and window: {lin.listing.block} · {lin.listing.window}")
    st.markdown(lin.listing.window_why or "Window reasoning not recorded for this saved schedule.")

    with st.expander("Full why-trail as stored on the listing"):
        st.markdown("\n".join(f"- {r}" for r in lin.listing.reasons))
