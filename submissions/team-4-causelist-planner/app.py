"""Scheduling Justice — L1 proof of concept (Streamlit + DuckDB), with a view per persona.

Everything runs on the generated dataset (python -m datagen generate → data/synthetic/*.parquet), loaded
into data/court.duckdb by scheduler/store.py. Schedules are planned live and can be saved, reopened
and compared (scheduler/runs.py, views/schedule.py).
"""
from __future__ import annotations

import json
from datetime import date

import pandas as pd
import plotly.express as px
import streamlit as st
import yaml

from scheduler import config as locked
from scheduler.capacity import block_budget
from scheduler.store import open_store
from sim.metrics import combine, summary
from sim.simulate import simulate
from agents.decide import LayaDecider, make_decider
from agents.outcomes import Agents, Levers
from planner.roster import ROSTERS
from views import agents as agents_view
from views import lineage
from views import pages, schedule, theme
from views import planner as planner_view
from views.court import build_court, court_from_batch
from views.events import events_for_court

POLICY_COLORS = {"l1": "#2a78d6", "baseline": "#eb6834"}
POLICY_LABELS = {"l1": "L1 scheduler", "baseline": "Status quo"}
ROLES = theme.ROLES
# The Judge view shows only the Causelist planner (provided data). The older build's judge tabs
# (synthetic data) are hidden, not removed: set True to bring them back.
SHOW_OLD_JUDGE_TABS = False
# The Advocate view is the planner's read-only desk (provided data). The older advocate page (synthetic
# data: calendar, clashes, .ics) is hidden, not removed: set True to bring it back.
SHOW_OLD_ADVOCATE_PAGE = False

st.set_page_config(page_title="Scheduling Justice — L1", layout="wide")


@st.cache_resource(show_spinner="Loading the dataset…")
def get_store():
    return open_store()


def reset_caches() -> None:
    live_court.clear()
    saved_court.clear()
    run_sim.clear()
    run_agents.clear()


def reload_dataset() -> None:
    get_store().close()
    get_store.clear()
    reset_caches()
    st.cache_resource.clear()
    open_store(reload=True).close()
    st.session_state.clear()


@st.cache_resource(show_spinner="Planning every courtroom…")
def live_court(start: date, n_days: int, overrides_json: str):
    rooms = build_court(get_store(), start, n_days, json.loads(overrides_json))
    return rooms, events_for_court(rooms)


@st.cache_resource(show_spinner="Opening the saved schedule…")
def saved_court(batch: str):
    rooms = court_from_batch(get_store(), batch)
    return rooms, events_for_court(rooms)


@st.cache_data(show_spinner="Simulating…")
def run_sim(judge_id: str, overrides_json: str, start: date, n_days: int):
    s = get_store()
    c = s.config(judge_id, json.loads(overrides_json))
    roster = s.cases(judge_id)
    return combine(simulate(roster, c, start, n_days, "l1"), simulate(roster, c, start, n_days, "baseline"))


@st.cache_data(show_spinner="Agents at work (new Laya decisions take about a second each)…")
def run_agents(judge_id: str, overrides_json: str, start: date, n_days: int, levers_json: str,
               decider_kind: str, budget: int):
    s = get_store()
    c = s.config(judge_id, json.loads(overrides_json))
    roster = s.cases(judge_id)
    decider = make_decider(decider_kind, budget=budget)
    levers = Levers(**json.loads(levers_json))
    runs, logs = [simulate(roster, c, start, n_days, "l1"), simulate(roster, c, start, n_days, "baseline")], []
    for policy in ("baseline", "l1", "l3"):
        a = Agents(decider, levers if policy != "baseline" else Levers(False, False, False, False))
        runs.append(simulate(roster, c, start, n_days, policy, agents=a))
        logs.append(pd.DataFrame(a.log).assign(policy=policy))
    if isinstance(decider, LayaDecider):
        decider.save()
    res = combine(*runs)
    return res, pd.concat(logs, ignore_index=True), decider.status(), summary(res)


@st.cache_data(ttl=30, show_spinner=False)
def laya_up() -> bool:
    return LayaDecider(cache_path=None).reachable()


def court_for(key: str):
    if key == schedule.LIVE:
        return live_court(st.session_state["plan_start"], st.session_state["plan_days"],
                          json.dumps(st.session_state["overrides"], sort_keys=True))
    return saved_court(key)


# ---------------------------------------------------------------- sidebar: demo sign-in + data
with st.sidebar:
    st.header("Sign in (demo)")
    role = st.radio("Role", ROLES, horizontal=True)
    theme.apply(role)
    st.markdown(theme.badge(role), unsafe_allow_html=True)
    who = st.container()

# ---------------------------------------------------------------- advocate: the planner's desk, read-only
if role == "Advocate" and not SHOW_OLD_ADVOCATE_PAGE:
    with who:
        kind = st.radio("Roster", list(ROSTERS), format_func=ROSTERS.get, key="pl-roster")
        adv_opts = planner_view.advocate_options(kind, date.today())
        counts = {a: (n, t) for a, n, t in adv_opts}
        advocate = st.selectbox("Advocate", list(counts), format_func=lambda a: f"{a} · {counts[a][0]} case(s), "
                                f"{counts[a][1]} listed today")
    st.sidebar.caption("Demo sign-in only. Real login would come from DRISTI's user service.")
    st.markdown(theme.badge(role), unsafe_allow_html=True)
    st.title("Scheduling Justice · Causelist planner (advocate)")
    planner_view.render_advocate(date.today(), kind, advocate)
    st.stop()

store = get_store()
schedule.init_state(store)
today = store.today

with st.sidebar:
    opts = schedule.options(store)
    if st.session_state["schedule"] not in opts:
        st.session_state["schedule"] = schedule.LIVE
    st.selectbox("Schedule shown", opts, key="schedule", format_func=lambda k: schedule.label(store, k),
                 help="Every view shows this schedule. Generate and save schedules in the Schedule tab.")
    with st.expander("Dataset", expanded=store.stale):
        m = store.manifest
        st.caption(f"Seed {m['seed']} · history to {today:%d %b %Y} · {m['rows']['court_case']:,} cases · "
                   f"{len(store.judges)} courtrooms · generated with `python -m datagen generate`.")
        if store.stale:
            st.warning("The dataset on disk was regenerated. Reload to use it.")
        for w in store.hearing_type_mismatches():
            st.warning(f"Hearing types differ from the scheduler's table: {w}")
        confirm = st.checkbox("Reloading discards saved schedules")
        st.button("Reload dataset", disabled=not confirm, on_click=reload_dataset)
    st.caption("Demo sign-in only. Real login would come from DRISTI's user service.")

rooms, court_events = court_for(st.session_state["schedule"])
live = court_for(schedule.LIVE)
names = store.directory
room_by_judge = {r.judge_id: r for r in rooms}

with who:
    if role == "Judge":
        judge_id = st.selectbox("Judge", [r.judge_id for r in rooms],
                                format_func=lambda j: f"{store.judge(j).name} · {store.judge(j).hall}")
    elif role == "Advocate":
        adv_opts, typical = pages.advocate_options(court_events)
        advocate = st.selectbox("Advocate", [a for a, _ in adv_opts], index=typical,
                                format_func=lambda a: f"{names.advocate(a)} · {dict(adv_opts)[a]} listings")
    elif role == "Litigant":
        lit_opts = pages.litigant_options(rooms, court_events)
        info = {p: (n, k) for p, n, k in lit_opts}
        litigant = st.selectbox("Litigant", list(info),
                                format_func=lambda p: f"{names.person(p)} · {info[p][0]} case(s), {info[p][1]} listed")
    else:
        st.caption("Court Master: the whole court, every courtroom.")

# ---------------------------------------------------------------- non-judge personas
if role != "Judge":
    st.markdown(theme.badge(role), unsafe_allow_html=True)
    st.title(f"Scheduling Justice · {role}")
    st.caption(f"Showing: {schedule.label(store, st.session_state['schedule'])}")
    if role == "Court Master":
        tab_court, tab_sched = st.tabs(["Court", "Schedules"])
        with tab_court:
            pages.court_master_page(rooms, court_events, today)
        with tab_sched:
            schedule.manager(store, live, court_for, saved_court.clear)
    elif role == "Advocate":
        pages.advocate_page(advocate, rooms, court_events, today)
    else:
        pages.litigant_page(litigant, rooms, court_events, today)
    st.stop()

# ---------------------------------------------------------------- judge: the L1 tabs
room = room_by_judge[judge_id]
cfg = room.cfg
days = room.days[:10]


st.markdown(theme.badge(role), unsafe_allow_html=True)
if not SHOW_OLD_JUDGE_TABS:
    st.title("Scheduling Justice · Causelist planner")
    planner_view.render(date.today())
    st.stop()
st.title("Scheduling Justice — L1 fixed-rules scheduler")
st.caption(f"{room.judge} · {room.name} · {len(room.cases):,} pending cases · "
           f"showing: {schedule.label(store, st.session_state['schedule'])}")
tab_plan, tab_cl, tab_cal, tab_sched, tab_docket, tab_sim, tab_agents, tab_rules = st.tabs(
    ["Causelist planner", "Causelist", "Calendar", "Schedule", "Docket insights", "Simulation", "Agents (L3)", "Rules"])

# ---------------------------------------------------------------- causelist planner (provided data only)
with tab_plan:
    planner_view.render(date.today())

# ---------------------------------------------------------------- causelist
with tab_cl:
    day = st.select_slider("Day", options=days, value=days[0], format_func=lambda d: d.strftime("%a %d %b"))
    plan = room.plan_on(day)
    blocks = cfg.blocks_on(day)
    total_budget = sum(block_budget(b, cfg) for b in blocks)
    old_minutes = sum(l.expected_minutes for l in plan.listings if l.age_years >= locked.AGE_QUOTA_MIN_YEARS)

    c1, c2, c3, c4 = st.columns(4)
    c1.metric("Listed", len(plan.listings), help=f"Daily cap {cfg.max_cases_per_day}")
    c2.metric("Expected minutes", f"{sum(l.expected_minutes for l in plan.listings):.0f} / {total_budget:.0f}")
    c3.metric("4y+ share of time", f"{old_minutes / total_budget:.0%}" if total_budget else "—",
              help=f"Locked quota ≥ {locked.AGE_QUOTA:.0%}")
    c4.metric("Excluded", sum(plan.excluded.values()))

    if not blocks:
        st.info("No blocks sit on this weekday for this judge.")
    numbers = store.case_numbers

    def pick_case(key: str, ids: list[str]) -> None:
        sel = st.session_state[key].selection.rows
        if sel:
            st.session_state["lineage_case"] = ids[sel[0]]

    st.caption("Click a row to see its decision lineage below.")
    for b in blocks:
        rows = [l for l in plan.listings if l.block == b.name]
        used = sum(l.expected_minutes for l in rows)
        st.subheader(f"{b.name} · {b.start:%H:%M}–{b.end:%H:%M}")
        st.caption(f"{len(rows)} listed · {used:.0f} of {block_budget(b, cfg):.0f} expected minutes")
        key = f"cl-{judge_id}-{day}-{b.name}"
        st.dataframe(
            pd.DataFrame([{
                "Window": l.window, "Case": numbers.get(l.case_id, l.case_id),
                "Parties": room.parties(room.by_id[l.case_id]), "Purpose": l.purpose.replace("_", " "),
                "Advocate": names.advocate(l.advocate), "Age (y)": l.age_years, "Score": l.score,
                "Exp. min": l.expected_minutes, "Why": " | ".join(l.reasons),
            } for l in rows]),
            hide_index=True, key=key, on_select=lambda k=key, ids=[l.case_id for l in rows]: pick_case(k, ids),
            selection_mode="single-row",
        )

    briefs = pages.brief_rows(room, plan.listings, today)
    with st.expander(f"Pre-hearing briefs: {len(briefs)} cases aged 4y+ today"):
        st.caption("Summary of each old case from its recorded history, so the hearing doesn't start by "
                   "re-establishing the facts.")
        st.dataframe(briefs, hide_index=True)

    with st.expander("Why cases were left off this day"):
        st.dataframe(pd.DataFrame(sorted(plan.excluded.items(), key=lambda x: -x[1]),
                                  columns=["Reason", "Cases"]), hide_index=True)

    st.divider()
    # One source of truth for the case shown: a row click, the picker and the lookup all write it.
    by_number = {numbers.get(cid, cid): cid for cid in room.by_id}
    listed_today = [l.case_id for l in sorted(plan.listings, key=lambda l: (l.window_start or 0, l.block))]
    lookup_key, pick_key = f"lineage-lookup-{judge_id}", f"lineage-pick-{judge_id}-{day}"

    def look_up() -> None:
        cid = by_number.get(st.session_state[lookup_key].strip())
        if cid:
            st.session_state["lineage_case"] = cid

    chosen = st.session_state.get("lineage_case")
    if chosen not in room.by_id:
        chosen = listed_today[0] if listed_today else None
    left, right = st.columns([2, 1])
    right.text_input("…or look up any case number", key=lookup_key, on_change=look_up,
                     placeholder="e.g. " + (numbers.get(listed_today[0], "") if listed_today else ""))
    if st.session_state.get(lookup_key) and not by_number.get(st.session_state[lookup_key].strip()):
        right.warning("No pending case with that number on this judge's board.")
    if chosen:
        opts = listed_today if chosen in listed_today else [chosen, *listed_today]
        st.session_state[pick_key] = chosen
        left.selectbox("Decision lineage for", opts, key=pick_key,
                       on_change=lambda: st.session_state.update(lineage_case=st.session_state[pick_key]),
                       format_func=lambda cid: f"{numbers.get(cid, cid)} · {room.by_id[cid].purpose.replace('_', ' ')}"
                                               + ("" if cid in listed_today else " (not listed today)"))
        lineage.render(room, chosen, numbers.get(chosen, chosen))

# ---------------------------------------------------------------- calendar
with tab_cal:
    pages.judge_calendar(room, court_events, today)

# ---------------------------------------------------------------- schedules
with tab_sched:
    schedule.manager(store, live, court_for, saved_court.clear, judge_id=judge_id)

# ---------------------------------------------------------------- docket insights (DuckDB)
with tab_docket:
    d = store.docket(judge_id)
    order = ["<1y", "1-3y", "3-4y", "4-5y", "5y+"]
    fig = px.bar(d["ages"], x="bucket", y="cases", category_orders={"bucket": order},
                 labels={"bucket": "Case age", "cases": "Pending cases"}, title="Docket by age")
    fig.update_traces(marker_color=POLICY_COLORS["l1"])
    left, right = st.columns(2)
    left.plotly_chart(fig)
    left.markdown("**Why hearings failed** (all recorded adjournments before this judge)")
    left.dataframe(d["reasons"], hide_index=True)
    right.markdown("**By purpose of next hearing**")
    right.dataframe(d["stuck"], hide_index=True)
    right.markdown("**Busiest advocates** (clustering candidates)")
    right.dataframe(d["advocates"], hide_index=True)
    st.markdown(f"**Repeatedly adjourned (5+ times)** — {len(d['repeat'])} shown")
    st.dataframe(d["repeat"], hide_index=True)

# ---------------------------------------------------------------- simulation
with tab_sim:
    n_days = st.slider("Sitting days to simulate", 10, 90, 60, step=10)
    res = run_sim(judge_id, json.dumps(room.overrides, sort_keys=True), room.days[0], n_days)
    m = summary(res).drop(columns=["behaviour", "litigant_wasted_trip_rate", "adjournment_request_rate"])
    m["policy"] = m["policy"].map(POLICY_LABELS)
    st.markdown("**Judging metrics: L1 vs the status quo** (list 60 a day in filing order, flat +60-day next date)")
    if room.overrides:
        st.caption("With this schedule's what-if settings: " + ", ".join(sorted(room.overrides)))
    st.dataframe(m.set_index("policy").T.astype(str), width=700)

    backlog = res.backlog.assign(**{"4y+": res.backlog["4-5y"] + res.backlog["5y+"]})
    backlog["policy"] = backlog["policy"].map(POLICY_LABELS)
    colors = {POLICY_LABELS[k]: v for k, v in POLICY_COLORS.items()}
    fig = px.line(backlog, x="day", y="4y+", color="policy", color_discrete_map=colors,
                  labels={"day": "", "4y+": "Pending cases aged 4y+", "policy": ""},
                  title="4y+ backlog over time")
    fig.update_traces(line_width=2)

    daily = (res.hearings.groupby(["policy", "day"])
             .agg(listed=("case_id", "size"), heard=("heard", "sum")).reset_index())
    daily["heard / listed"] = daily["heard"] / daily["listed"]
    daily["policy"] = daily["policy"].map(POLICY_LABELS)
    fig2 = px.line(daily, x="day", y="heard / listed", color="policy", color_discrete_map=colors,
                   labels={"day": "", "policy": ""}, title="Predictability per day (heard ÷ listed)")
    fig2.update_traces(line_width=2)
    fig2.update_yaxes(tickformat=".0%", rangemode="tozero")

    left, right = st.columns(2)
    left.plotly_chart(fig)
    right.plotly_chart(fig2)
    with st.expander("Hearing-level log"):
        st.dataframe(res.hearings, hide_index=True)

# ---------------------------------------------------------------- agents (L3)
with tab_agents:
    ctl = agents_view.controls(laya_up())
    key = ("agents_ran", judge_id)
    if ctl["run"]:
        st.session_state[key] = ctl
    ran = st.session_state.get(key)
    if ran:
        res_a, log_a, status_a, m_a = run_agents(
            judge_id, json.dumps(room.overrides, sort_keys=True), room.days[0], ran["days"],
            json.dumps(ran["levers"], sort_keys=True), ran["decider"], ran["budget"])
        agents_view.results(res_a, log_a, status_a, m_a, store.case_numbers)
    else:
        st.info("Pick the levers and press **Run agents**.")

# ---------------------------------------------------------------- rules
with tab_rules:
    left, right = st.columns(2)
    left.markdown("**Judge preset** (from the dataset's `scheduling_preset` and `time_block` rows)")
    preset = store.preset_dict(judge_id)
    leave = preset.pop("leave", [])
    left.code(yaml.safe_dump(preset, sort_keys=False, allow_unicode=True), language="yaml")
    left.caption(f"{len(leave)} days of leave recorded in `judge_leave`.")
    if room.overrides:
        left.markdown("**What-if overrides in this schedule**")
        left.code(yaml.safe_dump(room.overrides, sort_keys=False), language="yaml")
    if cfg.clamped:
        left.warning("Locked rules overrode this preset:\n\n" + "\n".join(f"- {c}" for c in cfg.clamped))
    right.markdown("**Locked rules (not configurable)**")
    right.dataframe(pd.DataFrame([
        {"Rule": "Ageing quota: share of daily time for 4y+ cases", "Value": f"≥ {locked.AGE_QUOTA:.0%}"},
        {"Rule": "Minimum weight on case age", "Value": f"≥ {locked.W_AGE_FLOOR}"},
        {"Rule": "Starvation guard: near-misses before forced listing", "Value": str(locked.STARVATION_K)},
        {"Rule": "Max share of day for forced cases", "Value": f"{locked.FORCED_SHARE:.0%}"},
        {"Rule": "Listing factor ceiling (overbooking cap)", "Value": str(locked.LISTING_FACTOR_MAX)},
    ]), hide_index=True)
    right.markdown("**Effective weights**")
    right.code(yaml.safe_dump(cfg.weights), language="yaml")
    right.markdown("**Hearing-type reference table** (`hearing_type`, placeholder values)")
    right.dataframe(store.hearing_types_df(), hide_index=True)
