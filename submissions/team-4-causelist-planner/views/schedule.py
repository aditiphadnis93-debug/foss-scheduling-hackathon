"""Generate, save, reopen and compare schedules (scheduler/runs.py) from the UI.

Session state owned here:
  plan_start, plan_days  - the live plan's horizon
  overrides              - judge id -> preset keys replaced for the live plan (locked rules still clamp)
  schedule               - what every view shows: "live" or a saved batch id (the sidebar selector)
"""
from __future__ import annotations

from collections.abc import Callable

import pandas as pd
import streamlit as st

from scheduler import config as locked
from scheduler.assign import MAX_CLUSTER_PULL
from scheduler.runs import batch_label, delete_batch, list_batches, save_batch
from scheduler.store import Store

from .court import CALENDAR_DAYS, Courtroom
from .events import CourtEvent, clashes

LIVE = "live"
Court = tuple[list[Courtroom], list[CourtEvent]]


def init_state(store: Store) -> None:
    st.session_state.setdefault("plan_start", store.today)
    st.session_state.setdefault("plan_days", CALENDAR_DAYS)
    st.session_state.setdefault("overrides", {})
    st.session_state.setdefault("schedule", LIVE)


def options(store: Store) -> list[str]:
    return [LIVE] + list_batches(store)["batch"].tolist()


def label(store: Store, key: str) -> str:
    return "Live plan (unsaved)" if key == LIVE else batch_label(store, key)


# ------------------------------------------------------------------ summaries

def summarise(rooms: list[Courtroom], events: list[CourtEvent]) -> pd.DataFrame:
    all_clashes = clashes(events)
    rows = []
    for r in rooms:
        listings = [l for p in r.plans for l in p.listings]
        minutes = sum(l.expected_minutes for l in listings)
        old = sum(l.expected_minutes for l in listings if l.age_years >= locked.AGE_QUOTA_MIN_YEARS)
        rows.append({"Court": r.name, "Judge": r.judge, "Sitting days": len(r.days), "Listed": len(listings),
                     "Distinct cases": len({l.case_id for l in listings}), "Expected minutes": round(minutes),
                     "4y+ share of time": f"{old / minutes:.0%}" if minutes else "—",
                     "Advocate clashes": sum(r.name in (c.a.courtroom, c.b.courtroom) for c in all_clashes),
                     "Overrides": ", ".join(sorted(r.overrides)) or "—"})
    return pd.DataFrame(rows)


def compare(a: Court, b: Court) -> pd.DataFrame:
    rooms_b = {r.judge_id: r for r in b[0]}
    rows = []
    for ra in a[0]:
        rb = rooms_b.get(ra.judge_id)
        if rb is None:
            continue
        ca = {l.case_id for p in ra.plans for l in p.listings}
        cb = {l.case_id for p in rb.plans for l in p.listings}
        same_day = {(l.case_id, l.day) for p in ra.plans for l in p.listings} & \
                   {(l.case_id, l.day) for p in rb.plans for l in p.listings}
        rows.append({"Court": ra.name, "Judge": ra.judge, "Listed A": len(ca), "Listed B": len(cb),
                     "In both": len(ca & cb), "Same day in both": len(same_day),
                     "Only A": len(ca - cb), "Only B": len(cb - ca)})
    return pd.DataFrame(rows)


# ------------------------------------------------------------------ panels

def _open(key: str) -> None:
    st.session_state["schedule"] = key


def _save(store: Store, rooms: list[Courtroom], on_change: Callable[[], None]) -> None:
    name = (st.session_state.get("save-label") or "").strip() or "Untitled schedule"
    batch = save_batch(store, rooms, label=name, overrides=st.session_state["overrides"])
    on_change()
    st.session_state["schedule"] = batch
    st.session_state["save-label"] = ""
    st.toast(f"Saved “{name}” ({len(rooms)} courtrooms)")


def _delete(store: Store, batch: str, on_change: Callable[[], None]) -> None:
    delete_batch(store, batch)
    on_change()
    if st.session_state.get("schedule") == batch:
        st.session_state["schedule"] = LIVE


def _copy(src: str, dst: str) -> None:
    st.session_state[dst] = st.session_state[src]
    st.session_state["schedule"] = LIVE


def horizon_controls(store: Store) -> None:
    # Widget keys differ from the state keys: Streamlit drops a widget's state on runs where it isn't drawn.
    c1, c2 = st.columns(2)
    c1.date_input("Live plan starts", st.session_state["plan_start"], min_value=store.today, key="w-plan_start",
                  on_change=_copy, args=("w-plan_start", "plan_start"),
                  help=f"The dataset's history runs to the day before {store.today:%d %b %Y}.")
    c2.slider("Sitting days to plan", 5, 44, st.session_state["plan_days"], key="w-plan_days",
              on_change=_copy, args=("w-plan_days", "plan_days"))


def _base(store: Store, judge_id: str) -> dict:
    base = store.preset_dict(judge_id)
    return {**base, "weights": {**locked.DEFAULT_WEIGHTS, **base.get("weights", {})}}


def _apply(store: Store, judge_id: str) -> None:
    ss, base = st.session_state, _base(store, judge_id)
    proposed = {"weights": {k: ss[f"w-{judge_id}-{k}"] for k in base["weights"]},
                "max_cases_per_day": ss[f"max-{judge_id}"], "listing_factor": ss[f"factor-{judge_id}"],
                "clustering": ss[f"clust-{judge_id}"], "rollover": ss[f"roll-{judge_id}"]}
    diff = {k: v for k, v in proposed.items() if v != base.get(k)}
    ss["overrides"] = {**ss["overrides"], judge_id: diff}
    ss["schedule"] = LIVE


def _reset(judge_id: str) -> None:
    st.session_state["overrides"] = {k: v for k, v in st.session_state["overrides"].items() if k != judge_id}
    for k in [k for k in st.session_state if isinstance(k, str) and k.endswith(f"-{judge_id}") and k.startswith(
            ("w-", "max-", "factor-", "clust-", "roll-"))]:
        del st.session_state[k]
    st.session_state["schedule"] = LIVE


# What each score weight multiplies (scheduler/scoring.py). Every term shows up in a listing's "Why".
WEIGHT_HELP = {
    "age": "Weight on case age. Points by age: <1y 0, 1–3y 1, 3–4y 2, 4–5y 3, 5y+ 5. "
           f"Locked: never below {locked.W_AGE_FLOOR}, so old cases can't be pushed aside.",
    "purpose": "Weight on the purpose of the next hearing. Priority from the hearing-type table: "
               "mention 2, admission and interim application 3, evidence 4, final arguments 5.",
    "overdue": "Weight per day the case is past its ideal next-hearing date (last hearing + ideal gap for its purpose).",
    "urgent": "Bonus for cases marked urgent.",
    "adjournments": "Weight per adjournment the case has had, so repeatedly adjourned cases rise.",
    "fresh": "Bonus for fresh matters (filed within the last 90 days).",
}


def overrides_editor(store: Store, judge_id: str) -> None:
    """Per-judge what-ifs for the live plan. Locked rules are clamped on load, exactly as for a preset."""
    base = _base(store, judge_id)
    cur = st.session_state["overrides"].get(judge_id, {})
    weights = {**base["weights"], **cur.get("weights", {})}
    with st.form(f"overrides-{judge_id}"):
        st.markdown("**What-if settings for this judge** (live plan only; saved with the schedule)")
        for col, (k, v) in zip(st.columns(len(weights)), weights.items()):
            col.number_input(k, value=float(v), step=0.5, key=f"w-{judge_id}-{k}", help=WEIGHT_HELP.get(k))
        c1, c2, c3, c4 = st.columns(4)
        c1.number_input("Max cases / day", 10, 200, int(cur.get("max_cases_per_day", base["max_cases_per_day"])),
                        key=f"max-{judge_id}", help="Hard cap on how many cases can be listed on one day, "
                                                    "whatever time the blocks have left.")
        c2.number_input("Listing factor", 0.5, 2.0, float(cur.get("listing_factor", base["listing_factor"])), 0.1,
                        key=f"factor-{judge_id}",
                        help="How much to overbook each block. Each block is filled up to its minutes × this factor, "
                             "counting each case's expected minutes (duration × chance it is actually heard). "
                             "1.0 fills the day exactly; above 1 lists more than can be heard. "
                             f"Locked: capped at {locked.LISTING_FACTOR_MAX}.")
        c3.checkbox("Clustering", bool(cur.get("clustering", base["clustering"])), key=f"clust-{judge_id}",
                    help=f"Group an advocate's matters: when one is listed, pull up to {MAX_CLUSTER_PULL} of their "
                         "other matters into the same day and block, so they make one trip instead of several.")
        c4.checkbox("Rollover", bool(cur.get("rollover", base["rollover"])), key=f"roll-{judge_id}",
                    help="A case listed but not heard goes to the same weekday next week (Justice Sehgal's "
                         "practice), instead of getting a fresh next date by the ideal gap.")
        st.form_submit_button("Apply to live plan", type="primary", on_click=_apply, args=(store, judge_id))
    if cur:
        st.caption("Overriding: " + ", ".join(sorted(cur)))
        st.button("Reset to the judge's preset", key=f"reset-{judge_id}", on_click=_reset, args=(judge_id,))


def manager(store: Store, live: Court, court_for: Callable[[str], Court], on_change: Callable[[], None],
            judge_id: str | None = None) -> None:
    """Horizon + what-ifs, save the live plan, the saved list (open / delete) and a comparison."""
    st.markdown("#### Live plan")
    horizon_controls(store)
    if judge_id:
        overrides_editor(store, judge_id)
    st.dataframe(summarise(*live), hide_index=True)
    c1, c2 = st.columns([3, 1])
    c1.text_input("Save the live plan as", key="save-label", placeholder="e.g. Oct wk 1 · clustering on")
    c2.button("Save schedule", type="primary", on_click=_save, args=(store, live[0], on_change),
              use_container_width=True)

    st.markdown("#### Saved schedules")
    saved = list_batches(store)
    if saved.empty:
        st.caption("Nothing saved yet.")
    else:
        current = st.session_state.get("schedule")
        for r in saved.itertuples():
            c1, c2, c3, c4 = st.columns([4, 3, 1, 1])
            c1.markdown(f"**{r.label}**" + (" · *showing*" if r.batch == current else ""))
            c2.caption(f"saved {r.created:%d %b %H:%M} · from {r.horizon_start:%d %b} · {r.sitting_days} days · "
                       f"{r.courtrooms} courts · {r.listed or 0} listed")
            c3.button("Open", key=f"open-{r.batch}", on_click=_open, args=(r.batch,), disabled=r.batch == current)
            c4.button("Delete", key=f"del-{r.batch}", on_click=_delete, args=(store, r.batch, on_change))

    st.markdown("#### Compare")
    opts = options(store)
    if len(opts) < 2:
        st.caption("Save a schedule to compare it with the live plan or another saved one.")
        return
    c1, c2 = st.columns(2)
    a = c1.selectbox("A", opts, format_func=lambda k: label(store, k), key="cmp-a")
    b = c2.selectbox("B", opts, index=1, format_func=lambda k: label(store, k), key="cmp-b")
    ca, cb = court_for(a), court_for(b)
    left, right = st.columns(2)
    left.caption("A")
    left.dataframe(summarise(*ca).drop(columns=["Overrides"]), hide_index=True)
    right.caption("B")
    right.dataframe(summarise(*cb).drop(columns=["Overrides"]), hide_index=True)
    st.markdown("**Overlap of listed cases**")
    st.dataframe(compare(ca, cb), hide_index=True)
