"""Streamlit pages for each persona (ideas/user-personas.md, ideas/causelist-as-a-calendar.md)."""
from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta

import pandas as pd
import streamlit as st

from scheduler import config as locked
from scheduler.capacity import block_budget
from scheduler.models import Case

from . import charts
from .court import Courtroom
from .events import CourtEvent, clashes, for_advocate, for_courtroom, for_party, on_day
from .theme import theme_mode  # noqa: F401  (re-exported for callers)
from .history import checklist, facts_from_row, summary_facts, summary_text, timeline, upcoming
from .ics import to_ics

STATUS_LABEL = {"pending": "⚠ Pending", "to_confirm": "☐ To confirm", "done": "✓ Done", "info": "ℹ Info"}


def _parties(names: tuple[str, ...] | list[str]) -> str:
    return f"{names[0]} v. {', '.join(names[1:])}" if len(names) > 1 else (names[0] if names else "")


def _room_of(rooms: list[Courtroom], case_id: str) -> Courtroom:
    return next(r for r in rooms if case_id in r.by_id)


def _events_table(events: list[CourtEvent], *, with_court: bool = False) -> pd.DataFrame:
    rows = []
    for e in sorted(events, key=lambda e: (e.day, e.start, e.courtroom)):
        row = {"Day": f"{e.day:%a %d %b}", "Window": e.window}
        if with_court:
            row["Court"] = e.courtroom
        row |= {"Case": e.case_id, "Number": e.case_number, "Purpose": e.purpose.replace("_", " "),
                "Parties": _parties(e.party_names), "Advocates": ", ".join(e.advocate_names),
                "Age (y)": e.age_years, "Why": " | ".join(e.reasons)}
        rows.append(row)
    return pd.DataFrame(rows)


def _pick_row(df: pd.DataFrame, key: str) -> int | None:
    event = st.dataframe(df, hide_index=True, on_select="rerun", selection_mode="single-row", key=key)
    rows = event.selection.rows
    return rows[0] if rows else None


def _download(events: list[CourtEvent], name: str, file_name: str, rooms: list[Courtroom], today: date) -> None:
    facts = rooms[0].store.facts_many([e.case_id for e in events]) if rooms and events else {}

    def extra(e: CourtEvent) -> str:
        room = _room_of(rooms, e.case_id)
        case = room.by_id[e.case_id]
        f = facts_from_row(facts[e.case_id], case, today, [e])
        items = checklist(case, e, room.cfg.cover_page_for, f.open_tasks)
        return summary_text(case, f) + "\n\nChecklist:\n" + "\n".join(
            f"- {STATUS_LABEL[i.status]}: {i.text}" for i in items)

    st.download_button(f"Download {len(events)} hearings as calendar invites (.ics)",
                       to_ics(events, name, extra), file_name=file_name, mime="text/calendar",
                       disabled=not events, help="Opens in Outlook, Google Calendar or any phone calendar.")


# ------------------------------------------------------------------ shared case panel

def case_panel(case: Case, room: Courtroom, court_events: list[CourtEvent], today: date) -> None:
    """Case details, summary, checklist for the next hearing, and the timeline from the dataset."""
    store = room.store
    mine = [e for e in court_events if e.case_id == case.id]
    facts = summary_facts(store, case, today, mine)
    meta = store.case_meta(case.id)
    st.markdown(f"#### {facts.case_number}")
    st.caption(f"{facts.title} · {case.id} · CNR {meta['cnr_number'] or '—'}")
    c1, c2, c3, c4 = st.columns(4)
    c1.metric("Filed", f"{case.filing_date:%d %b %Y}")
    c2.metric("Age", f"{facts.age_years} y")
    c3.metric("Court", room.name, help=room.judge)
    c4.metric("Hearings so far", facts.hearings, help=f"{facts.effective} effective")
    st.info(summary_text(case, facts), icon="📄")

    left, right = st.columns([2, 3])
    with left:
        if facts.next_listing:
            e = facts.next_listing
            st.markdown(f"**Checklist for {e.day:%a %d %b}** ({e.purpose.replace('_', ' ')})")
            st.dataframe(pd.DataFrame([{"Status": STATUS_LABEL[i.status], "Item": i.text}
                                       for i in checklist(case, e, room.cfg.cover_page_for, facts.open_tasks)]),
                         hide_index=True)
            st.caption("Why listed: " + " | ".join(e.reasons))
        else:
            st.markdown("**Not listed in this schedule.**")
            st.caption(f"Next purpose: {case.purpose.replace('_', ' ')}. "
                       + ("Prerequisite pending, so not yet eligible. " if not case.prerequisites_met else "")
                       + (f"Registry date: {meta['next_hearing_date']:%d %b %Y}." if meta["next_hearing_date"] else ""))
        names = store.directory
        st.markdown("**Advocates:** " + ", ".join(names.advocate(a) for a in case.advocate_ids))
        st.markdown("**Parties:** " + room.parties(case))
    with right:
        history = timeline(store, case.id)
        entries = history + upcoming(mine)
        st.plotly_chart(charts.timeline_strip([t for t in entries if t.kind in ("filed", "hearing", "upcoming")],
                                              "Timeline"), key=f"strip-{case.id}")
        st.dataframe(pd.DataFrame([{"Date": f"{t.day:%d %b %Y}", "Event": t.kind.replace("_", " "),
                                    "Purpose": (t.purpose or "").replace("_", " "), "Outcome": t.outcome,
                                    "Detail": t.detail} for t in reversed(entries)]),
                     hide_index=True, height=260)


def brief_rows(room: Courtroom, listings, today: date) -> pd.DataFrame:
    """Pre-hearing briefs for the day's 4y+ cases: the judge's 're-establishing facts' pain point."""
    old = sorted((l for l in listings if l.age_years >= locked.AGE_QUOTA_MIN_YEARS), key=lambda l: -l.age_years)
    facts = room.store.facts_many([l.case_id for l in old])
    rows = []
    for l in old:
        c = room.by_id[l.case_id]
        f = facts_from_row(facts[c.id], c, today)
        rows.append({"Window": l.window, "Case": f.case_number, "Age (y)": l.age_years, "Brief": summary_text(c, f)})
    return pd.DataFrame(rows)


# ------------------------------------------------------------------ judge

def _block_rows(room: Courtroom, day: date, events: list[CourtEvent], y: str) -> list[dict]:
    rows = []
    for b in room.cfg.blocks_on(day):
        evs = [e for e in events if e.block == b.name]
        used = sum(e.expected_minutes for e in evs)
        rows.append({"row": y, "block": b.name,
                     "start": charts.on_base_day(pd.Timestamp.combine(day, b.start)),
                     "end": charts.on_base_day(pd.Timestamp.combine(day, b.end)),
                     "label": f"{b.name}: {len(evs)} cases · {used:.0f}/{block_budget(b, room.cfg):.0f} min",
                     "cases": len(evs)})
    return rows


def _expected_load(room: Courtroom, day: date, events: list[CourtEvent]) -> tuple[pd.DataFrame, dict[str, float]]:
    """Expected minutes per half hour if the day's cases are taken one after another in roll-call order
    (window, then advocate), from each block's start. Also each block's expected overrun past its end."""
    rows, overrun = [], {}
    for b in room.cfg.blocks_on(day):
        evs = sorted((e for e in events if e.block == b.name), key=lambda e: (e.start, e.advocates[0], e.case_id))
        slots: dict[int, float] = defaultdict(float)
        cursor = 0.0
        for e in evs:
            left, t = e.expected_minutes, cursor
            while left > 1e-9:  # split each case's minutes across the half hours it spans
                k = int(t // 30)
                take = min(left, (k + 1) * 30 - t)
                slots[k] += take
                left, t = left - take, t + take
            cursor += e.expected_minutes
        overrun[b.name] = max(0.0, cursor - b.minutes)
        start = pd.Timestamp.combine(day, b.start)
        for k, m in sorted(slots.items()):
            late = k * 30 >= b.minutes
            rows.append({"slot": charts.on_base_day(start + pd.Timedelta(minutes=30 * k)), "block": b.name,
                         "minutes": round(m, 1), "label": "past end" if late else ""})
    return pd.DataFrame(rows), overrun


def judge_calendar(room: Courtroom, court_events: list[CourtEvent], today: date) -> None:
    mode = theme_mode()
    events = for_courtroom(court_events, room.name)
    blocks = list(dict.fromkeys(b.name for b in room.cfg.blocks))
    view = st.segmented_control("View", ["Day", "Week", "Month"], default="Day", key="judge-view") or "Day"

    if view == "Day":
        day = st.select_slider("Day", options=room.days, value=room.days[0], format_func=lambda d: d.strftime("%a %d %b"),
                               key="judge-day")
        todays = on_day(events, day)
        groups: dict[tuple, list[CourtEvent]] = defaultdict(list)
        for e in todays:
            groups[(e.block, e.start, e.end)].append(e)
        df = pd.DataFrame([{"row": f"{s:%H:%M}–{t:%H:%M}", "block": b, "start": s, "end": t,
                            "label": f"{len(g)} cases", "purposes": ", ".join(sorted({x.purpose for x in g}))}
                           for (b, s, t), g in sorted(groups.items(), key=lambda kv: kv[0][1])])
        if df.empty:
            st.info("No sitting on this day.")
            return
        st.plotly_chart(charts.gantt(df, "row", "block", blocks, mode, hover=["purposes"], time_only=True,
                                     title=f"{room.name} · {day:%A %d %B}: arrival windows"),
                        key="judge-day-chart")
        st.caption("Each case gets a one-hour window to be in court; windows overlap by half an hour. "
                   "The judge still takes the cases one at a time, in roll-call order. The chart below shows "
                   "that queue: expected minutes of hearing per half hour. Only about half of the cases "
                   "listed are heard, so each counts as its duration × chance of being heard.")
        load, overrun = _expected_load(room, day, todays)
        st.plotly_chart(charts.window_load(load, blocks, mode, title="Expected hearing time per half hour"),
                        key="judge-day-load")
        late = {b: m for b, m in overrun.items() if m >= 1}
        if late:
            st.warning("Overbooked on purpose (listing factor "
                       f"{room.cfg.listing_factor:g}): expected to run past the end of "
                       + ", ".join(f"{b} by {m:.0f} min" for b, m in late.items())
                       + ". Some listed cases won't be reached; the starvation guard brings them back.", icon="⏱️")
        st.markdown(f"**{len(todays)} listed.** Select a case to see its summary, checklist and timeline.")
        table = _events_table(todays)
        i = _pick_row(table, "judge-day-table")
        if i is not None:
            case_id = table.iloc[i]["Case"]
            case_panel(room.by_id[case_id], room, court_events, today)

    elif view == "Week":
        weeks = sorted({d - timedelta(days=d.weekday()) for d in room.days})
        wk = st.selectbox("Week", weeks, format_func=lambda w: f"Week of {w:%d %b %Y}", key="judge-week")
        days = [d for d in room.days if wk <= d < wk + timedelta(days=7)]
        rows = [r for d in days for r in _block_rows(room, d, on_day(events, d), f"{d:%a %d %b}")]
        df = pd.DataFrame(rows)
        st.plotly_chart(charts.gantt(df, "row", "block", blocks, mode, time_only=True,
                                     title=f"{room.name}: week of {wk:%d %b}, load per block"), key="judge-week-chart")
        st.dataframe(df[["row", "block", "cases", "label"]].rename(columns={"row": "Day", "block": "Block", "cases": "Listed",
                                                                          "label": "Load"}), hide_index=True)

    else:
        counts = {d: len(on_day(events, d)) for d in room.days}
        st.plotly_chart(charts.month_grid(counts, f"{room.name}: cases listed per sitting day"), key="judge-month-chart")
        st.dataframe(pd.DataFrame([{"Day": f"{d:%a %d %b}", "Listed": n,
                                    "Expected minutes": round(sum(e.expected_minutes for e in on_day(events, d))),
                                    "4y+ cases": sum(e.age_years >= locked.AGE_QUOTA_MIN_YEARS for e in on_day(events, d))}
                                   for d, n in counts.items()]), hide_index=True)


# ------------------------------------------------------------------ court master

def court_master_page(rooms: list[Courtroom], court_events: list[CourtEvent], today: date) -> None:
    mode = theme_mode()
    names = rooms[0].store.directory
    days = sorted({d for r in rooms for d in r.days})
    day = st.select_slider("Day", options=days, value=days[0], format_func=lambda d: d.strftime("%a %d %b"), key="cm-day")
    todays = on_day(court_events, day)
    day_clashes = clashes(todays)
    clash_ids = {(c.advocate, e.uid): (c.b if e is c.a else c.a) for c in day_clashes for e in (c.a, c.b)}

    cols = st.columns(len(rooms) + 1)
    for col, r in zip(cols, rooms):
        evs = for_courtroom(todays, r.name)
        budget = sum(block_budget(b, r.cfg) for b in r.cfg.blocks_on(day))
        col.metric(f"{r.name} · {r.judge}", f"{len(evs)} listed")
        col.caption(f"{sum(e.expected_minutes for e in evs):.0f} of {budget:.0f} expected minutes")
    cols[-1].metric("⚠ Advocate clashes", len(day_clashes))
    cols[-1].caption("Same advocate, overlapping windows, different courtrooms")

    room_names = [r.name for r in rooms]
    rows = [dict(x, room=r.name) for r in rooms for x in _block_rows(r, day, for_courtroom(todays, r.name), r.name)]
    if rows:
        st.plotly_chart(charts.gantt(pd.DataFrame(rows), "row", "room", room_names, mode, time_only=True,
                                     title=f"Whole court · {day:%A %d %B}"), key="cm-chart")

    if day_clashes:
        with st.expander(f"⚠ {len(day_clashes)} advocate clashes across courtrooms today", expanded=False):
            st.dataframe(pd.DataFrame([{"Advocate": names.advocate(c.advocate), "Court A": c.a.courtroom,
                                        "Window A": c.a.window, "Case A": c.a.case_number, "Court B": c.b.courtroom,
                                        "Window B": c.b.window, "Case B": c.b.case_number}
                                       for c in day_clashes]), hide_index=True)
            st.caption("The scheduler plans each judge's roster on its own, so it can't see these yet. "
                       "Cross-court clash avoidance is an L2 candidate.")

    for tab, r in zip(st.tabs(room_names), rooms):
        with tab:
            evs = sorted(for_courtroom(todays, r.name), key=lambda e: (e.start, e.advocates[0], e.case_id))
            st.caption(f"{r.judge} · roll-call order (by window, advocate's matters together)")
            st.dataframe(pd.DataFrame([{
                "Item": i + 1, "Window": e.window, "Case": e.case_number, "Purpose": e.purpose.replace("_", " "),
                "Parties": _parties(e.party_names), "Advocates": ", ".join(e.advocate_names),
                "Clash": "; ".join(f"⚠ {names.advocate(a)} also in {o.courtroom} {o.window}"
                                   for a in e.advocates if (o := clash_ids.get((a, e.uid)))),
            } for i, e in enumerate(evs)]), hide_index=True)


# ------------------------------------------------------------------ advocate

def advocate_options(court_events: list[CourtEvent]) -> tuple[list[tuple[str, int]], int]:
    """Advocates by listings, busiest first, and the index of a typical one to start with:
    the brief's persona has about 15 matters across courtrooms, so pick the first with <= 20
    listings and at least one cross-court clash."""
    counts: dict[str, int] = defaultdict(int)
    for e in court_events:
        for a in e.advocates:
            counts[a] += 1
    ranked = sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))
    typical = next((i for i, (a, n) in enumerate(ranked) if n <= 20 and clashes(for_advocate(court_events, a), a)), 0)
    return ranked, typical


def advocate_page(adv: str, rooms: list[Courtroom], court_events: list[CourtEvent], today: date) -> None:
    mode = theme_mode()
    name = rooms[0].store.directory.advocate(adv)
    mine = for_advocate(court_events, adv)
    my_clashes = clashes(mine, adv)
    cases = [(r, c) for r in rooms for c in r.cases if adv in c.advocate_ids and not c.disposed]

    st.markdown(f"### {name}")
    c1, c2, c3, c4 = st.columns(4)
    c1.metric("Matters", len(cases))
    c2.metric("Listed (horizon)", len(mine), help=f"Next {len(rooms[0].days)} sitting days")
    c3.metric("Court days", len({e.day for e in mine}), help="Trips to court")
    c4.metric("⚠ Clashes", len(my_clashes), help="Overlapping windows in different courtrooms")
    for c in my_clashes[:5]:
        st.warning(f"**Clash {c.a.day:%a %d %b}:** {c.a.courtroom} {c.a.window} ({c.a.case_number}) overlaps "
                   f"{c.b.courtroom} {c.b.window} ({c.b.case_number}).", icon="⚠️")

    room_names = [r.name for r in rooms]
    view = st.segmented_control("View", ["Week", "Month", "All cases"], default="Week", key="adv-view") or "Week"
    if view == "Week":
        weeks = sorted({e.day - timedelta(days=e.day.weekday()) for e in mine}) or [today - timedelta(days=today.weekday())]
        wk = st.selectbox("Week", weeks, format_func=lambda w: f"Week of {w:%d %b %Y}", key="adv-week")
        week = [e for e in mine if wk <= e.day < wk + timedelta(days=7)]
        groups: dict[tuple, list[CourtEvent]] = defaultdict(list)
        for e in week:
            groups[(e.day, e.courtroom, e.start, e.end)].append(e)
        df = pd.DataFrame([{"row": f"{d:%a %d %b} · {r}", "room": r, "start": charts.on_base_day(s),
                            "end": charts.on_base_day(t), "label": ", ".join(x.case_number for x in g),
                            "window": f"{s:%H:%M}–{t:%H:%M}", "purposes": ", ".join(sorted({x.purpose for x in g}))}
                           for (d, r, s, t), g in sorted(groups.items())])
        if df.empty:
            st.info("Nothing listed this week.")
        else:
            st.plotly_chart(charts.gantt(df, "row", "room", room_names, mode, hover=["window", "purposes"], time_only=True,
                                         title=f"{name}: week of {wk:%d %b}, one row per day and courtroom"),
                            key="adv-week-chart")
            st.caption("Rows on the same day that overlap in time are clashes.")
        table = _events_table(week, with_court=True)
        i = _pick_row(table, "adv-week-table")
        if i is not None:
            cid = table.iloc[i]["Case"]
            room = _room_of(rooms, cid)
            case_panel(room.by_id[cid], room, court_events, today)
    elif view == "Month":
        counts = defaultdict(int)
        for e in mine:
            counts[e.day] += 1
        days = sorted({d for r in rooms for d in r.days})
        st.plotly_chart(charts.month_grid({d: counts.get(d, 0) for d in days}, f"{name}: hearings per day"),
                        key="adv-month-chart")
        st.dataframe(_events_table(mine, with_court=True), hide_index=True)
    else:
        facts = rooms[0].store.facts_many([c.id for _, c in cases])
        rows = []
        for r, c in cases:
            nxt = min((e for e in mine if e.case_id == c.id), key=lambda e: e.start, default=None)
            f = facts_from_row(facts[c.id], c, today, [nxt] if nxt else [])
            rows.append({"Case": c.id, "Number": f.case_number, "Court": r.name, "Parties": r.parties(c),
                         "Next purpose": c.purpose.replace("_", " "), "Age (y)": f.age_years,
                         "Next listing": f"{nxt.day:%a %d %b} {nxt.window}" if nxt else "—",
                         "Summary": summary_text(c, f)})
        table = pd.DataFrame(rows).sort_values("Age (y)", ascending=False, ignore_index=True)
        st.caption("All matters, oldest first. Select one for the full timeline and checklist.")
        i = _pick_row(table, "adv-cases-table")
        if i is not None:
            cid = table.iloc[i]["Case"]
            room = _room_of(rooms, cid)
            case_panel(room.by_id[cid], room, court_events, today)
    _download(mine, f"{name} · court hearings", f"{adv}-hearings.ics", rooms, today)


# ------------------------------------------------------------------ litigant

def litigant_options(rooms: list[Courtroom], court_events: list[CourtEvent], limit: int = 400) -> list[tuple[str, int, int]]:
    """Parties (by person key) with a listing in the horizon, plus multi-case litigants, most cases first."""
    orgs = rooms[0].store.directory.organisations
    n_cases: dict[str, int] = defaultdict(int)
    for r in rooms:
        for c in r.cases:
            for p in c.parties:
                n_cases[p] += 1
    listed: dict[str, int] = defaultdict(int)
    for e in court_events:
        for p in e.parties:
            listed[p] += 1
    keys = set(listed) | {p for p, n in n_cases.items() if n > 1}
    # Individuals first (the persona), most cases first; institutions last.
    ranked = sorted(keys, key=lambda p: (p in orgs, -n_cases[p], -listed[p], p))
    return [(p, n_cases[p], listed[p]) for p in ranked[:limit]]


def litigant_page(pid: str, rooms: list[Courtroom], court_events: list[CourtEvent], today: date) -> None:
    name = rooms[0].store.directory.person(pid)
    numbers = rooms[0].store.case_numbers
    mine = for_party(court_events, pid)
    cases = [(r, c) for r in rooms for c in r.cases if pid in c.parties]
    st.markdown(f"### {name}")
    c1, c2, c3 = st.columns(3)
    c1.metric("Your cases", len(cases))
    c2.metric("Hearings coming up", len(mine), help=f"Next {len(rooms[0].days)} sitting days")
    c3.metric("Days in court", len({e.day for e in mine}))

    rows = []
    for r, c in cases:
        nxt = min((e for e in mine if e.case_id == c.id), key=lambda e: e.start, default=None)
        rows.append({"Case": c.id, "Number": numbers.get(c.id, c.id),
                     "You are": "Petitioner" if c.parties[0] == pid else "Respondent",
                     "Parties": r.parties(c), "Court": f"{r.name} ({r.judge})",
                     "Filed": f"{c.filing_date:%d %b %Y}", "Next purpose": c.purpose.replace("_", " "),
                     "Next hearing": f"{nxt.day:%a %d %b}, {nxt.window}" if nxt else "Not listed yet"})
    table = pd.DataFrame(rows)
    st.caption("Select a case for its timeline, summary and the checklist for the next hearing.")
    i = _pick_row(table, "lit-cases-table")
    if i is None and len(table) == 1:
        i = 0
    if i is not None:
        cid = table.iloc[i]["Case"]
        room = _room_of(rooms, cid)
        case_panel(room.by_id[cid], room, court_events, today)
    _download(mine, f"{name} · court hearings", "my-hearings.ics", rooms, today)
