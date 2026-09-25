"""Agents (L3) tab: the judge, advocates and litigants as agents, and what the court's levers change.

The simulation runs in app.py (cached); this module draws the controls and results. It never
changes the scheduler's output.
"""
from __future__ import annotations

import pandas as pd
import plotly.express as px
import streamlit as st

RUNS = {  # (policy, behaviour) -> label, colour (fixed categorical order, see views/charts.py)
    ("baseline", "fixed"): ("Status quo · fixed rates", "#c9b8a8"),
    ("l1", "fixed"): ("L1 · fixed rates", "#a9c4e6"),
    ("baseline", "agents"): ("Status quo · agents", "#eb6834"),
    ("l1", "agents"): ("L1 · agents", "#2a78d6"),
    ("l3", "agents"): ("L3 judge agent · agents", "#1baf7a"),
}
ACTIONS = ["ready", "unprepared", "seek_adjournment", "absent"]
LEVER_HELP = {
    "windows": "Publish a one-hour appearance window per hearing instead of 'all day'.",
    "reminders": "SMS each advocate and litigant a reminder with the hearing checklist.",
    "cover_pages": "Enforce the judge's cover-page rule (Dimakar) before listed purposes.",
    "costs": "The court orders costs for unjustified adjournment requests.",
}
METRIC_ROWS = ["listed_per_day", "heard", "effective", "disposed", "utilisation", "predictability",
               "substantiveness", "adjournment_request_rate", "litigant_wasted_trip_rate",
               "pending_5y_plus_start", "pending_5y_plus_end", "mean_next_gap_days", "matters_per_advocate_trip"]


def label(policy: str, behaviour: str) -> str:
    return RUNS[(policy, behaviour)][0]


def controls(laya_up: bool) -> dict:
    """The run settings. Levers apply to L1 and L3; the status quo never gets them."""
    st.markdown(
        "Each listed hearing is played by **agents**. The **judge** (L3 only) shortlists and lists cases "
        "in their own way of working, rules on adjournment requests and fixes the next-date gap. "
        "**Advocates** decide to come ready, come unprepared, seek an adjournment or stay away; "
        "**litigants** decide whether to travel. Locked rules still clamp every judge decision.")
    with st.form("agents_run"):
        c1, c2, c3 = st.columns([2, 2, 3])
        decider = c1.radio("Decisions from", ["Laya", "Rules"], index=0 if laya_up else 1, horizontal=True,
                           help="Laya: the FOSS System-One model in the sidecar (docker compose --profile agents). "
                                "Rules: the explainable fallback. Laya answers are cached per situation.")
        if not laya_up:
            c1.caption("Laya sidecar not reachable: runs use the rule fallback.")
        days = c2.slider("Sitting days", 5, 60, 10, step=5)
        budget = c2.number_input("Max new Laya calls", 0, 5000, 150, step=50,
                                 help="About 1.3 s each on CPU. Beyond this, new situations use rules. "
                                      "Warm the cache first with python -m agents warm.")
        levers = {k: c3.checkbox(k.replace("_", " ").capitalize(), value=k != "costs", help=h)
                  for k, h in LEVER_HELP.items()}
        run = st.form_submit_button("Run agents", type="primary")
    return {"decider": decider.lower(), "days": days, "budget": int(budget), "levers": levers, "run": run}


def results(res, log: pd.DataFrame, status: dict, metrics: pd.DataFrame, case_numbers: dict[str, str]) -> None:
    cols = st.columns(4)
    cols[0].metric("Decider", status.get("decider", "rules"))
    cols[1].metric("New Laya calls", status.get("new_calls", 0))
    cols[2].metric("Cache hits", status.get("cache_hits", 0))
    cols[3].metric("Seconds in Laya", status.get("seconds_in_laya", 0))
    src = log["source"].value_counts() if not log.empty else pd.Series(dtype=int)
    if len(src):
        st.caption("Decisions by source: " + " · ".join(f"{k} {v:,}" for k, v in src.items()))

    m = metrics.copy()
    m.index = [label(p, b) for p, b in zip(m["policy"], m["behaviour"])]
    order = [RUNS[k][0] for k in RUNS if RUNS[k][0] in m.index]
    st.markdown("**Judging metrics**: fixed per-purpose rates vs agents who respond to the schedule")
    st.dataframe(m.loc[order, [c for c in METRIC_ROWS if c in m.columns]].T.astype(str), width=900)

    h = res.hearings[res.hearings["behaviour"] == "agents"].copy()
    colors = {v[0]: v[1] for v in RUNS.values()}
    h["run"] = [label(p, b) for p, b in zip(h["policy"], h["behaviour"])]
    left, right = st.columns(2)
    acts = (h.groupby(["run", "advocate_action"]).size().rename("hearings").reset_index())
    acts["share"] = acts["hearings"] / acts.groupby("run")["hearings"].transform("sum")
    fig = px.bar(acts, x="share", y="run", color="advocate_action", orientation="h", text_auto=".0%",
                 category_orders={"advocate_action": ACTIONS},
                 color_discrete_sequence=["#1baf7a", "#eda100", "#eb6834", "#d03b3b"],
                 labels={"run": "", "share": "Share of listed hearings", "advocate_action": "Advocate"},
                 title="What advocates did")
    fig.update_xaxes(tickformat=".0%")
    left.plotly_chart(fig)
    daily = h.groupby(["run", "day"]).agg(listed=("case_id", "size"), heard=("heard", "sum")).reset_index()
    daily["heard / listed"] = daily["heard"] / daily["listed"]
    fig2 = px.line(daily, x="day", y="heard / listed", color="run", color_discrete_map=colors,
                   labels={"day": "", "run": ""}, title="Predictability per day under agents")
    fig2.update_yaxes(tickformat=".0%", rangemode="tozero")
    right.plotly_chart(fig2)

    st.markdown("**Agent decisions**: every sampled choice with its probability and why")
    if log.empty:
        st.info("No decisions logged.")
        return
    who = st.segmented_control("Agent", ["judge", "advocate", "litigant"], default="judge", key="agents_who")
    rows = log[log["agent"] == (who or "judge")].copy()
    rows["case"] = rows["case_id"].map(lambda c: case_numbers.get(c, c))
    rows["p"] = rows["p"].map(lambda p: f"{p:.0%}")
    st.dataframe(rows[["policy", "day", "case", "decision", "p", "source", "why"]].head(1000), hide_index=True)
    with st.expander("Hearing-level log (agents)"):
        st.dataframe(h.drop(columns=["run"]), hide_index=True)
