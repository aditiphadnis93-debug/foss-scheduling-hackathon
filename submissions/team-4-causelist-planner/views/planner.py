"""Causelist planner: the judge's desk on the organisers' dataset only (provided/data), no synthetic data.

- Hearing day: the causelist published at 7 PM the evening before. For each case the judge records
  what happened and fixes the next date. Next to that: the earliest date the purpose allows, the
  nearest date with room, the model's best fit, and the impact of whichever date is chosen.
- Forecast: the draft causelist for the next 60 days, re-derived after every decision.

State (hearing day, decisions, published lists) lives in data/causelist.duckdb via planner/store.py.
"""
from __future__ import annotations

from datetime import date, timedelta

import pandas as pd
import plotly.express as px
import streamlit as st

from planner import desk
from planner.forecast import DeskState, Draft, current_stage, forecast
from planner.reference import BUFFER_MINUTES, DAY_MINUTES, DISPOSED, PLAN_MINUTES, calendar, calendar_end, \
    hearing_types, label, sample_causelist, sitting_days
from planner.roster import ROSTERS, PCase, load_roster, synth_csv, version
from planner.store import DeskStore

from . import charts
from .theme import theme_mode

KIND_LABEL = {"published": "Published", "judge": "Set by the judge", "tentative": "Tentative"}


@st.cache_resource
def desk_store() -> DeskStore:
    return DeskStore()


@st.cache_resource(show_spinner="Forecasting the next 60 days…", max_entries=16)
def draft_for(kind: str, state: DeskState, ver: float = 0.0) -> Draft:
    return forecast(load_roster(kind), state)


@st.cache_data(show_spinner="Trying candidate dates…", max_entries=64)
def best_for(kind: str, state: DeskState, case: str, purpose: str, earliest: date, minutes: int | None,
             ver: float = 0.0):
    return desk.best_fit(load_roster(kind), state, draft_for(kind, state, ver), case, purpose, earliest, minutes)


@st.cache_data(show_spinner="Working out the impact…", max_entries=64)
def impact_for(kind: str, state: DeskState, case: str, purpose: str, day: date, earliest: date,
               minutes: int | None, ver: float = 0.0):
    return desk.impact(load_roster(kind), state, draft_for(kind, state, ver), case, purpose, day, earliest, minutes)


def _d(d: date | None) -> str:
    return f"{d:%a %d %b}" if d else "—"


def _holidays(after: date, until: date) -> str:
    """Holidays on weekdays in (after, until], from court_calendar.csv."""
    return ", ".join(f"{r['holiday_name']} {r['date']:%d %b}" for r in calendar()
                     if after < r["date"] <= until and r["holiday_name"] and not r["sitting"]
                     and r["date"].weekday() < 5)


def _default_start(today: date) -> date:
    days = sitting_days()
    return next((d for d in days if d > today), days[0])


def _status(r: dict | None) -> str:
    """A judge's decision on the hearing day, in one line."""
    if not r:
        return "—"
    if r["next_purpose"] == DISPOSED:
        return f"{r['outcome']} · disposed"
    return f"{r['outcome']} → {label(r['next_purpose'])} on {_d(r['next_date'])}"


# ---------------------------------------------------------------- callbacks (write, then Streamlit reruns)
def _save(kind: str, case: str, day: date, outcome: str, purpose: str, next_date: date | None, note_key: str,
          minutes: int | None = None) -> None:
    desk_store().decide(kind, case, day, outcome, purpose, next_date, st.session_state.get(note_key, ""), minutes)


def _undo(kind: str, case: str, day: date) -> None:
    desk_store().undo(kind, case, day)


def _close(kind: str, confirm_key: str) -> None:
    try:
        nxt = desk_store().close_day(kind, load_roster(kind))
        st.session_state["pl-flash"] = f"Day closed. The causelist for {nxt:%a %d %b} is published."
    except ValueError as e:
        st.session_state["pl-flash"] = str(e)
    st.session_state[confirm_key] = False


def _reset(kind: str, key: str) -> None:
    start = st.session_state[key]
    desk_store().reset(kind, load_roster(kind), start)
    st.session_state["pl-flash"] = f"Started over: hearing day {start:%a %d %b}, its causelist published."


def _pick(key: str, target: str, ids: list[str]) -> None:
    rows = st.session_state[key].selection.rows
    if rows:
        st.session_state[target] = ids[rows[0]]


# ---------------------------------------------------------------- page
def render(today: date) -> None:
    store = desk_store()
    days = sitting_days()
    default_start = _default_start(today)

    top, reset_col = st.columns([3, 2])
    kind = top.radio("Roster", list(ROSTERS), format_func=ROSTERS.get, horizontal=True, key="pl-roster")
    cases = load_roster(kind)
    store.ensure(kind, cases, default_start)
    state = store.state(kind)
    draft = draft_for(kind, state, version(kind))
    with reset_col.expander("Start over"):
        key = f"pl-start-{kind}"
        st.selectbox("First hearing day", days, index=days.index(default_start), format_func=_d, key=key,
                     help="Sitting days only, from court_calendar.csv")
        st.button("Start over from this day", key=f"pl-reset-{kind}", on_click=_reset, args=(kind, key))
        st.caption("Forgets this roster's decisions and published lists.")
    st.caption("Runs on the organisers' dataset only (`provided/data`): one courtroom, "
               f"{PLAN_MINUTES} of {DAY_MINUTES} minutes planned a day ({BUFFER_MINUTES} kept free for ad-hoc work), "
               "the court calendar to {calendar_end():%d %b %Y}. "
               "It does not use the synthetic dataset or the judge picked in the sidebar. Existing next dates "
               "in the roster are ignored, as the brief allows.")
    if kind == "synth":
        st.caption(f"Synthetic roster: `{synth_csv()}`, simulated case lifecycles calibrated on `provided/` only. "
                   "Regenerate with `python -m planner.synth --num-cases N --seed S`, then **Start over**, "
                   "since decisions are kept by case number.")
    if msg := st.session_state.pop("pl-flash", None):
        st.success(msg)

    hearing, fc = st.tabs([f"Hearing day · {state.start:%a %d %b}", "Forecast · next 60 days"])
    with hearing:
        _hearing_day(kind, cases, store, state, draft)
    with fc:
        _forecast(kind, cases, state, draft)


# ---------------------------------------------------------------- hearing day
def _hearing_day(kind: str, cases: tuple[PCase, ...], store: DeskStore, state: DeskState, draft: Draft) -> None:
    ref = hearing_types()
    by_id = {c.number: c for c in cases}
    day = state.start
    listed = store.published(kind, day)
    decided = {r["case_number"]: r for r in store.decisions(kind, day)}
    before = [d for d in sitting_days() if d < day]
    st.caption(f"Causelist published at 7 PM on {_d(before[-1] if before else None)} for today. Take each case, "
               "record what happened and fix its next date. The forecast re-plans after every decision.")
    c1, c2, c3, c4 = st.columns(4)
    c1.metric("Listed", len(listed))
    c2.metric("Decided", len(decided))
    c3.metric("To decide", len(listed) - len(decided))
    c4.metric("Expected minutes", f"{sum(r['expected_minutes'] for r in listed):.0f} / {PLAN_MINUTES}")
    if not listed:
        st.info("Nothing is listed today.")
        return

    ids = [r["case_number"] for r in listed]
    table_key, pick_key = f"pl-list-{kind}-{day}", f"pl-case-{kind}-{day}"
    st.dataframe(pd.DataFrame([{
        "#": r["seq"], "Case": r["case_number"], "Listed for": label(r["purpose"]),
        "Stage": label(by_id[r["case_number"]].stage), "Age (y)": round(by_id[r["case_number"]].age_years(day), 1),
        "Advocate": by_id[r["case_number"]].advocate,
        "Min": f"{r['minutes']} (judge)" if r.get("minutes") else str(ref[r["purpose"]].minutes),
        "Exp. min": round(r["expected_minutes"], 1),
        "Decision": _status(decided.get(r["case_number"])),
    } for r in listed]), hide_index=True, key=table_key, on_select=lambda: _pick(table_key, pick_key, ids),
        selection_mode="single-row")
    if st.session_state.get(pick_key) not in ids:
        st.session_state[pick_key] = next((i for i in ids if i not in decided), ids[0])
    st.selectbox("Case at the bench (or click a row above)", ids, key=pick_key,
                 format_func=lambda i: f"{i} · {label(listed[ids.index(i)]['purpose'])}"
                                       + (" · decided" if i in decided else ""))
    cid = st.session_state[pick_key]
    row = listed[ids.index(cid)]
    st.divider()
    left, right = st.columns([1, 1.2], gap="large")
    with left:
        _facts(by_id[cid], row["purpose"], state, draft, by_id)
    with right:
        _decide(kind, by_id[cid], row["purpose"], state, draft, decided.get(cid))

    st.divider()
    undecided = len(listed) - len(decided)
    confirm_key = f"pl-close-ok-{kind}-{day}"
    st.checkbox(f"Today's list is done: close {_d(day)} and publish the next sitting day's causelist"
                + (f". The {undecided} case(s) not taken up go to their nearest date with room." if undecided else "."),
                key=confirm_key)
    st.button("Close the day", type="primary", disabled=not st.session_state.get(confirm_key),
              on_click=_close, args=(kind, confirm_key))


def _facts(c: PCase, purpose: str, state: DeskState, draft: Draft, by_id: dict[str, PCase]) -> None:
    ref = hearing_types()
    day = state.start
    stage = current_stage(c, state)
    st.markdown(f"#### {c.number}")
    st.caption(f"Filing {c.filing_number} · filed {c.filing_date:%d %b %Y} · advocate {c.advocate} · party {c.party}")
    a, b, d = st.columns(3)
    a.metric("Age", f"{c.age_years(day):.1f} y", help=f"Bucket {c.age_bucket(day)}")
    b.metric("Stage", label(stage))
    d.metric("Listed for", label(purpose))
    a, b, d = st.columns(3)
    a.metric("Hearings so far", c.total_hearings)
    med = ref[c.stage].hearings_median
    b.metric("At this stage", c.hearings_at_stage, f"{c.hearings_at_stage - med:+g} vs median", delta_color="inverse",
             help=f"Median for {label(c.stage)}: {med:g} hearings per case (roster stage)")
    ht = ref[purpose]
    d.metric("Goes ahead", f"{ht.p_substantive:.0%}", help=f"Share of {label(purpose)} hearings that move the case "
             f"forward ({'real' if ht.source == 'real' else 'estimated'} data)")
    if c.process_hint:
        st.warning("The last summary mentions process that may still be out (warrant, summons or notice). "
                   "If it hasn't come back, this hearing is unlikely to go ahead.")
    st.markdown("**Last hearing**")
    st.info(c.summary.replace("\n", "  \n") or "No summary recorded.")
    fails = ", ".join(f"{k.split(' / ')[0].lower()} {v:.0%}" for k, v in ht.top_failures())
    if fails:
        st.caption(f"When {label(purpose)} hearings don't move the case on, it is mostly: {fails}.")

    counts = pd.DataFrame([{"Hearing type": label(p), "Hearings": c.hearings.get(p, 0)} for p in ref
                           if c.hearings.get(p, 0)])
    if not counts.empty:
        fig = px.bar(counts, x="Hearings", y="Hearing type", orientation="h", text="Hearings",
                     title="Hearings held, by type")
        fig.update_traces(marker_color=charts.SERIES[theme_mode()][0], textposition="outside")
        fig.update_yaxes(autorange="reversed", title=None)
        fig.update_layout(height=70 + 24 * len(counts), margin=dict(l=10, r=10, t=40, b=10))
        st.plotly_chart(fig, key=f"pl-hist-{c.number}")

    same = [b for b in draft.bookings if b.case != c.number and by_id[b.case].advocate == c.advocate
            and b.day > day]
    st.markdown(f"**{c.advocate}'s other listings in the forecast**")
    if same:
        st.dataframe(pd.DataFrame([{"Date": _d(b.day), "Case": b.case, "Purpose": label(b.purpose),
                                    "Status": KIND_LABEL[b.kind]} for b in same[:12]]), hide_index=True)
        st.caption("A next date on one of these days saves the advocate a trip.")
    else:
        st.caption("None in the next 60 days.")


def _decide(kind: str, c: PCase, purpose: str, state: DeskState, draft: Draft, decision: dict | None,
            readonly: bool = False) -> None:
    """The decision panel. Read-only (the advocate's view): the next purpose is the only input, the
    dates and impact are shown as for the judge, and nothing is saved."""
    ref = hearing_types()
    day, cid = state.start, c.number
    k = "pl-adv" if readonly else "pl"
    st.markdown("#### Decided by the judge" if readonly and decision else
                "#### Discuss a next date" if readonly else "#### Decision")
    if decision:
        what = ("Disposed" if decision["next_purpose"] == DISPOSED else
                f"Next: {label(decision['next_purpose'])} on {_d(decision['next_date'])}"
                + (f", {decision['minutes']} min (judge's estimate)" if decision.get("minutes") else ""))
        st.success(f"**{decision['outcome']}**. {what}." + (f" Note: {decision['note']}" if decision["note"] else ""))
        if not readonly:
            st.button("Change this decision", key=f"pl-undo-{kind}-{day}-{cid}", on_click=_undo, args=(kind, cid, day))
        return

    base = f"{kind}-{day}-{cid}"
    note_key = f"pl-note-{base}"
    if readonly:
        st.caption("For discussion with the judge. Only the judge records the decision.")
        outcome = "Heard, moved on"
        nxt = desk.default_next_purpose(current_stage(c, state), purpose, outcome)
        nxt = purpose if nxt == DISPOSED else nxt
    else:
        outcome = st.radio("What happened", desk.OUTCOMES, horizontal=True, key=f"pl-out-{base}")
        nxt = desk.default_next_purpose(current_stage(c, state), purpose, outcome)
    if nxt == DISPOSED:
        st.info("The case leaves the docket, and its tentative listings free up for others."
                if outcome == "Disposed" else "Judgement delivered: the case is disposed.")
        st.text_input("Note (optional)", key=note_key)
        st.button("Confirm", type="primary", key=f"pl-ok-{base}", on_click=_save,
                  args=(kind, cid, day, outcome, DISPOSED, None, note_key))
        return

    purposes = list(ref)
    nxt = st.selectbox("Next purpose", purposes, index=purposes.index(nxt), format_func=label,
                       key=f"{k}-purpose-{base}-{outcome}")
    ht = ref[nxt]
    mins = ht.minutes if readonly else int(st.number_input(
        "Hearing time (minutes)", min_value=1, max_value=DAY_MINUTES, value=ht.minutes, step=5,
        key=f"pl-mins-{base}-{nxt}",
        help=f"Filled from the reference table ({ht.minutes} min for {label(nxt)}). Change it if you expect this "
             "hearing to run shorter or longer; the dates below are worked out again with your figure."))
    minutes = None if mins == ht.minutes else mins
    cost = ht.expected_for(minutes)
    st.caption(f"{label(nxt)}: {mins} min when heard"
               + (f" (your estimate; the table says {ht.minutes})" if minutes else " (reference table)")
               + f", {cost:.0f} expected as {ht.p_heard:.0%} go ahead; usual gap {ht.gap_days} days; "
               f"{ht.p_substantive:.0%} move the case forward{'' if ht.source == 'real' else ' (estimated)'}.")
    earliest = desk.earliest_date(day, nxt)
    if earliest is None:
        st.error("The court calendar ends before the earliest date for this purpose.")
        return
    nearest = desk.nearest_fit(draft, cid, nxt, earliest, minutes)
    best, rows = best_for(kind, state, cid, nxt, earliest, minutes, version(kind))

    m1, m2, m3 = st.columns(3)
    m1.metric("Earliest", _d(earliest), help=f"{day:%d %b} + {ht.gap_days} days for {label(nxt)}, on a sitting day")
    m2.metric("Nearest with room", _d(nearest) if nearest else "none",
              help="First sitting day from the earliest with enough expected minutes free, without moving anyone")
    m3.metric("Model's best fit", _d(best.day) if best else "—",
              help="The candidate date with the least delay overall: days this case waits past its earliest, "
                   "plus days it pushes other cases, each weighted by 1 + age points")
    if best:
        st.caption(f"Best fit: this case waits {best.own_delay} day(s) past the earliest and "
                   f"{len(best.later)} other case(s) move later (cost {best.cost:.0f}).")

    late_after = day + timedelta(days=2 * ht.gap_days)
    strip = st.container()  # drawn above the date choice, filled once the chosen date is known

    choices: dict[str, date | None] = {}
    for name, d in (("Nearest with room", nearest), ("Model's best fit", best.day if best else None),
                    ("Earliest", earliest)):
        if d and d not in choices.values():
            choices[f"{name} · {_d(d)}"] = d
    choices["Propose another date"] = None
    pick = st.radio("Next date", list(choices), key=f"{k}-pick-{base}-{nxt}")
    proposed = choices[pick]
    if proposed is None:
        options = [d for d in sitting_days() if d > day]

        def option(d: date) -> str:
            if d > draft.end:
                return f"{_d(d)} · beyond the forecast"
            free = draft.free(d, excluding=cid)
            room = "room" if free >= cost else "full"
            return (f"{_d(d)} · {max(0.0, free):.0f} min free ({room})" + (" · before the usual gap" if d < earliest else "")
                    + (" · more than 2× the usual gap" if d > late_after else ""))

        proposed = st.selectbox("Proposed date", options, index=options.index(nearest or earliest), format_func=option,
                                key=f"{k}-date-{base}-{nxt}")
        if skipped := _holidays(day, options[-1]):
            st.caption(f"Only sitting days from the court calendar are offered: no weekends, and no {skipped}.")
    with strip:
        _availability(draft, c, day, cost, earliest, late_after, ht.gap_days, best.day if best else None, nearest,
                      proposed, {i.day: i for i in rows}, {x.number: x for x in load_roster(kind)})
    if proposed > late_after:
        st.warning(f"More than twice the usual {ht.gap_days}-day gap for {label(nxt)}.")
    if proposed < earliest:
        st.warning(f"Earlier than the usual {ht.gap_days}-day gap for {label(nxt)} (earliest {_d(earliest)}).")

    if proposed > draft.end:
        st.info(f"{_d(proposed)} is beyond the 60-day forecast, so no impact is worked out. The case is booked there.")
    else:
        _impact(impact_for(kind, state, cid, nxt, proposed, earliest, minutes, version(kind)), cost)

    if rows:
        with st.expander(f"Every candidate date the model tried ({len(rows)})"):
            st.dataframe(pd.DataFrame([{
                "Date": _d(i.day), "Free min": round(max(0.0, i.free_before)), "Fits": "yes" if i.fits else "no",
                "Moved later": len(i.later), "Days of delay caused": sum(m.delay for m in i.later),
                "4y+ delayed": i.old_delayed, "This case waits (d)": i.own_delay, "Cost": round(i.cost),
                "Best": "★" if best and i.day == best.day else "",
            } for i in rows]), hide_index=True)

    if readonly:
        return
    st.text_input("Note (optional)", key=note_key)
    st.button("Confirm decision", type="primary", key=f"pl-ok-{base}",
              on_click=_save, args=(kind, cid, day, outcome, nxt, proposed, note_key, minutes))


def _availability(draft: Draft, case: PCase, day: date, cost: float, earliest: date, late_after: date, gap: int,
                  best: date | None, nearest: date | None, selected: date | None,
                  tried: dict[date, desk.Impact], by_id: dict[str, PCase]) -> None:
    """30 sitting days in one row around the model's best fit: room left, and dates off the usual gap.
    Hovering a day shows what is booked there and what choosing it would do."""
    cid = case.number
    days = [d for d in draft.days if d > day]
    if not days:
        return
    centre = best or nearest or earliest
    i = next((k for k, d in enumerate(days) if d >= centre), len(days) - 1)
    lo = max(0, min(i - 15, len(days) - 30))
    window = days[lo:lo + 30]
    rows = []
    for d in window:
        free = draft.free(d, excluding=cid)
        early, late = d < earliest, d > late_after
        others = [b for b in draft.on(d) if b.case != cid]
        marks = [n for n, x in (("model's best fit", best), ("nearest with room", nearest), ("earliest", earliest),
                                ("selected", selected)) if x == d]
        lines = [f"<b>{d:%a %d %b %Y}</b>" + (f" · {', '.join(marks)}" if marks else ""),
                 f"{len(others)} listed, {PLAN_MINUTES - free:.0f} of {PLAN_MINUTES} expected min booked",
                 f"{max(0.0, free):.0f} min free; this hearing needs {cost:.0f} → "
                 + ("fits" if free >= cost else "full: others would move"),
                 f"{(d - day).days} days from today (usual gap {gap})"
                 + (" · <b>before the usual gap</b>" if early else " · <b>more than 2× the usual gap</b>" if late else "")]
        if d in tried:
            i = tried[d]
            lines.append(f"Model: cost {i.cost:.0f} · {len(i.later)} case(s) later"
                         + (f", {i.old_delayed} aged 4y+" if i.old_delayed else ""))
        same = [b.case for b in others if by_id[b.case].advocate == case.advocate]
        if same:
            lines.append(f"{case.advocate} already has {len(same)} matter(s) here: saves a trip")
        rows.append({"day": d, "free": free, "need": cost, "early": early, "late": late,
                     "hover": "<br>".join(lines)})
    st.markdown("**Availability around the model's best fit**")
    st.plotly_chart(charts.availability_strip(pd.DataFrame(rows), {"Best fit": best, "Nearest": nearest,
                                                                   "Earliest": earliest},
                                              selected, theme_mode()), key=f"pl-strip-{cid}")
    st.caption(f"{len(window)} sitting days, {_d(window[0])} to {_d(window[-1])}, for this hearing ({cost:.0f} expected "
               f"min): ✕ full · ! fits with under {charts.TIGHT_MINUTES} min to spare · ✓ room. ★ best fit · ◆ nearest with room · "
               f"▲ earliest · ◀ before the usual {gap}-day gap · ▶ more than twice it ({_d(late_after)} on). "
               "Hover a day for details.")


def _impact(imp: desk.Impact, cost: float) -> None:
    if imp.fits:
        st.success(f"Fits. {imp.free_before:.0f} of {PLAN_MINUTES} expected minutes are free on {_d(imp.day)}; this "
                   f"case takes {cost:.0f}, leaving {imp.free_after:.0f}.")
    else:
        st.warning(f"Not enough time on {_d(imp.day)}: {max(0.0, imp.free_before):.0f} expected minutes free, this "
                   f"case needs {cost:.0f}. The draft makes room by moving lower-priority listings to later dates.")
    if imp.later:
        st.markdown(f"**Impact:** {len(imp.later)} case(s) move later, {sum(m.delay for m in imp.later)} days in "
                    f"total; {imp.old_delayed} of them aged 4y+.")
        st.dataframe(pd.DataFrame([{
            "Case": m.case, "Purpose": label(m.purpose), "Age (y)": m.age_years, "Was": _d(m.old),
            "Now": _d(m.new) if m.new else desk.BEYOND, "Days later": m.delay,
        } for m in imp.later]), hide_index=True)
    elif imp.fits:
        st.caption("No other case moves later.")
    if imp.earlier:
        st.caption(f"{len(imp.earlier)} case(s) move earlier into time this change frees up.")
    if imp.own_delay:
        st.caption(f"This case waits {imp.own_delay} day(s) past its earliest date.")


# ---------------------------------------------------------------- advocate (read-only)
def advocate_options(kind: str, today: date) -> list[tuple[str, int, int]]:
    """(advocate, pending cases, listed on the hearing day), those with a listing today first."""
    store, cases = desk_store(), load_roster(kind)
    store.ensure(kind, cases, _default_start(today))
    state = store.state(kind)
    listed = {r["case_number"] for r in store.published(kind, state.start)}
    counts: dict[str, list[int]] = {}
    for c in cases:
        if c.number not in state.disposed:
            n = counts.setdefault(c.advocate, [0, 0])
            n[0] += 1
            n[1] += c.number in listed
    return sorted(((a, n, t) for a, (n, t) in counts.items()), key=lambda x: (-x[2], -x[1], x[0]))


def render_advocate(today: date, kind: str, advocate: str) -> None:
    """The advocate's view of the judge's desk: their own cases, the same dates and impact, no writes."""
    store, cases = desk_store(), load_roster(kind)
    store.ensure(kind, cases, _default_start(today))
    state = store.state(kind)
    draft = draft_for(kind, state, version(kind))
    st.caption(f"Signed in as {advocate}. The judge's causelist planner on the organisers' dataset "
               f"(`provided/data`), for your cases only. You can look at the dates and their impact to "
               "discuss them with the judge; only the judge records decisions.")
    mine, other = st.tabs([f"My cases · hearing day {state.start:%a %d %b}", "Forecast · my cases"])
    with mine:
        _my_cases(kind, cases, advocate, store, state, draft)
    with other:
        _forecast(kind, cases, state, draft, advocate)


def _my_cases(kind: str, cases: tuple[PCase, ...], advocate: str, store: DeskStore, state: DeskState,
              draft: Draft) -> None:
    by_id = {c.number: c for c in cases}
    day = state.start
    own = [c for c in cases if c.advocate == advocate]
    listed = {r["case_number"]: r for r in store.published(kind, day) if by_id[r["case_number"]].advocate == advocate}
    decided = {r["case_number"]: r for r in store.decisions(kind, day) if r["case_number"] in listed}
    c1, c2, c3, c4 = st.columns(4)
    c1.metric("My cases", sum(c.number not in state.disposed for c in own))
    c2.metric("Listed today", len(listed))
    c3.metric("Decided by the judge", len(decided))
    c4.metric("Awaiting the judge", len(listed) - len(decided))

    def status(c: PCase) -> tuple[str, str]:
        if c.number in listed:
            return "Listed today", _status(decided.get(c.number)) if c.number in decided else "awaiting the judge"
        if c.number in state.disposed:
            return "Disposed", ""
        if c.awaiting_disposal:
            return "Awaiting a disposal entry", ""
        nxt = next((b for b in draft.of(c.number) if b.day > day), None)
        return (f"{KIND_LABEL[nxt.kind]} · {_d(nxt.day)}", label(nxt.purpose)) if nxt else ("No date in 60 days", "")

    own.sort(key=lambda c: (c.number not in listed, c.number))
    ids = [c.number for c in own]
    rows = []
    for c in own:
        s, detail = status(c)
        rows.append({"Case": c.number, "Stage": label(current_stage(c, state)),
                     "Purpose": label(state.purpose_of.get(c.number, c.purpose)),
                     "Age (y)": round(c.age_years(day), 1), "Status": s, "Detail": detail})
    today_ids = [i for i in ids if i in listed]
    table_key, pick_key = f"pl-adv-list-{kind}-{advocate}-{day}", f"pl-adv-case-{kind}-{advocate}-{day}"

    def pick() -> None:
        sel = st.session_state[table_key].selection.rows
        if sel and ids[sel[0]] in listed:
            st.session_state[pick_key] = ids[sel[0]]

    st.dataframe(pd.DataFrame(rows), hide_index=True, key=table_key, on_select=pick, selection_mode="single-row")
    if not today_ids:
        st.info(f"None of your cases is listed on {_d(day)}. Their forecast dates are above and in the Forecast tab.")
        return
    if st.session_state.get(pick_key) not in today_ids:
        st.session_state[pick_key] = next((i for i in today_ids if i not in decided), today_ids[0])
    st.selectbox("Case listed today (or click its row above)", today_ids, key=pick_key,
                 format_func=lambda i: f"{i} · {label(listed[i]['purpose'])}" + (" · decided" if i in decided else ""))
    cid = st.session_state[pick_key]
    st.divider()
    left, right = st.columns([1, 1.2], gap="large")
    with left:
        _facts(by_id[cid], listed[cid]["purpose"], state, draft, by_id)
    with right:
        _decide(kind, by_id[cid], listed[cid]["purpose"], state, draft, decided.get(cid), readonly=True)


# ---------------------------------------------------------------- forecast
def _forecast(kind: str, cases: tuple[PCase, ...], state: DeskState, draft: Draft, advocate: str | None = None) -> None:
    by_id = {c.number: c for c in cases}
    start = state.start
    listings = [b for b in draft.bookings if b.day <= draft.end]
    if advocate:
        mine = [b for b in listings if by_id[b.case].advocate == advocate]
        st.markdown(f"**{len(mine)} listing(s) of your cases in the next {len(draft.days)} sitting days**")
        if mine:
            st.dataframe(pd.DataFrame([{
                "Date": _d(b.day), "Case": b.case, "Purpose": label(b.purpose), "Status": KIND_LABEL[b.kind],
                "Exp. min": round(b.expected, 1), "Why": " | ".join(b.why),
            } for b in mine]), hide_index=True)
        st.caption("Published lists are frozen. Dates set by the judge hold. Tentative dates move as the judge "
                   "decides cases, so they can change after every hearing day.")
        return
    dated = {b.case for b in listings}
    active = [c for c in cases if c.number not in state.disposed and not c.awaiting_disposal]
    old = [c for c in active if c.age_years(start) >= 4]
    over = [d for d in draft.days if draft.load(d) > PLAN_MINUTES + 0.5]
    m = st.columns(5)
    m[0].metric("Listings", f"{len(listings):,}", help=f"Over {len(draft.days)} sitting days")
    m[1].metric("Cases with a date", f"{len(dated):,} / {len(active):,}")
    m[2].metric("No date in 60 days", f"{len(draft.unplaced):,}")
    m[3].metric("4y+ listed at least once", f"{sum(c.number in dated for c in old) / len(old):.0%}" if old else "—",
                help=f"{len(old):,} pending cases aged 4 years or more")
    m[4].metric("Overbooked days", len(over), help=f"Days booked past {PLAN_MINUTES} min, into the "
                f"{BUFFER_MINUTES}-min ad-hoc buffer. Only fixed bookings (published lists and judge-set dates) can "
                "overbook a day; the forecast never does")
    notes = [f"{sum(c.awaiting_disposal for c in cases)} case(s) whose last summary records a conviction and sentence "
             "are left out as awaiting a disposal entry."]
    if draft.cut_by_calendar:
        notes.append(f"The court calendar ends on {calendar_end():%d %b %Y}, so the forecast stops there.")
    st.caption(" ".join(notes))

    df = pd.DataFrame([{"day": b.day, "age": by_id[b.case].age_bucket(start), "kind": KIND_LABEL[b.kind],
                        "minutes": b.expected} for b in listings])
    if not df.empty:
        df = df.groupby(["day", "age", "kind"], as_index=False).agg(minutes=("minutes", "sum"),
                                                                   listings=("minutes", "size"))
        st.plotly_chart(charts.day_load(df, draft.days, theme_mode(), PLAN_MINUTES, DAY_MINUTES,
                                        title="Expected hearing minutes per sitting day, by case age"),
                        key=f"pl-load-{kind}")
        with st.expander("Table view"):
            st.dataframe(df.pivot_table(index="day", columns="age", values="minutes", aggfunc="sum", fill_value=0)
                         .reindex(columns=[a for a in charts.AGE_BUCKETS if a in set(df["age"])])
                         .assign(Total=lambda t: t.sum(axis=1)).round(0)
                         .rename(index=_d), key=f"pl-load-table-{kind}")
    st.caption("A listing costs its hearing time × the chance it goes ahead (from the failure-reason data), so about "
               "30 fill a 420-minute day. Up to a third of each day goes first to short procedural matters. "
               "After a listing the case comes back no earlier than the usual gap for its purpose, which is held "
               "because the outcome isn't known ahead.")

    if not draft.days:
        return
    pick = st.select_slider("Day", options=draft.days, value=start, format_func=_d, key=f"pl-day-{kind}-{start}")
    rows = draft.on(pick)
    st.markdown(f"**{_d(pick)}**: {len(rows)} listed, {draft.load(pick):.0f} of {PLAN_MINUTES} expected minutes")
    st.dataframe(pd.DataFrame([{
        "#": i, "Case": b.case, "Purpose": label(b.purpose), "Stage": label(current_stage(by_id[b.case], state)),
        "Age (y)": round(by_id[b.case].age_years(start), 1), "Advocate": by_id[b.case].advocate,
        "Exp. min": round(b.expected, 1), "Score": b.score, "Status": KIND_LABEL[b.kind], "Why": " | ".join(b.why),
    } for i, b in enumerate(rows, 1)]), hide_index=True)

    out = pd.DataFrame([{
        "Case Number": b.case, "Filing Number": by_id[b.case].filing_number, "Hearing Type": b.purpose,
        "Hearing Date": b.day.isoformat(), "status": b.kind, "expected_minutes": round(b.expected, 1),
        "score": b.score, "why": " | ".join(b.why), "advocate_id": by_id[b.case].advocate,
        "age_years": round(by_id[b.case].age_years(start), 1),
    } for b in listings])
    st.download_button("Download the draft causelist (CSV)", out.to_csv(index=False).encode(),
                       file_name=f"draft_causelist_{kind}_{start}.csv", mime="text/csv", key=f"pl-dl-{kind}")

    with st.expander("Compare with the real causelist of 22 Sep 2026"):
        real = pd.DataFrame(sample_causelist())
        mix_real = real["Hearing Type"].value_counts(normalize=True)
        mix_ours = pd.Series([b.purpose for b in listings]).value_counts(normalize=True)
        per_day = len(listings) / max(1, len(draft.days))
        st.caption(f"The real day lists {len(real)} matters; this draft averages {per_day:.0f} a day "
                   f"(the case study: 30 listed, 10 heard, 5 effective).")
        st.dataframe(pd.DataFrame({"Real 22 Sep": mix_real, "This draft": mix_ours}).fillna(0)
                     .rename(index=label).sort_values("Real 22 Sep", ascending=False)
                     .map(lambda v: f"{v:.0%}"), hide_index=False)
