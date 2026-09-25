"""Calendar and persona views: events mirror the causelist exactly, filters are exact, exports are valid."""
from datetime import date, datetime, timezone

import pytest

from scheduler.data import generate_roster, is_sitting_day
from views.court import build_court
from views.events import clashes, events_for_court, for_advocate, for_courtroom, for_party
from views.history import checklist, summary_facts, summary_text, timeline
from views.ics import to_ics


@pytest.fixture(scope="module")
def court(store):
    return build_court(store, store.today, n_days=5)


@pytest.fixture(scope="module")
def events(court):
    return events_for_court(court)


def test_every_listing_is_exactly_one_event(court, events):
    listings = {(l.case_id, l.day, l.block, r.name) for r in court for p in r.plans for l in p.listings}
    assert len(events) == len(listings)
    assert {(e.case_id, e.day, e.block, e.courtroom) for e in events} == listings
    assert len({e.uid for e in events}) == len(events)


def test_case_ids_are_unique_across_courtrooms(court):
    ids = [c.id for r in court for c in r.cases]
    assert len(ids) == len(set(ids))


def test_windows_sit_inside_their_block_on_sitting_days(court, events):
    rooms = {r.name: r for r in court}
    for e in events:
        block = next(b for b in rooms[e.courtroom].cfg.blocks_on(e.day) if b.name == e.block)
        assert is_sitting_day(e.day, rooms[e.courtroom].cfg.leave)
        assert datetime.combine(e.day, block.start) <= e.start < e.end <= datetime.combine(e.day, block.end)


def test_role_filters_are_exact(court, events):
    room = court[0]
    assert all(e.courtroom == room.name for e in for_courtroom(events, room.name))
    assert len(for_courtroom(events, room.name)) == sum(len(p.listings) for p in room.plans)

    adv = events[0].advocates[0]
    mine = for_advocate(events, adv)
    assert mine and all(adv in e.advocates for e in mine)
    assert len(mine) == sum(adv in e.advocates for e in events)

    party = events[0].parties[0]
    theirs = for_party(events, party)
    assert theirs and all(party in e.parties for e in theirs)
    assert len(theirs) == sum(party in e.parties for e in events)


def test_clashes_are_overlapping_windows_in_different_courtrooms(events):
    found = clashes(events)
    for c in found:
        assert c.a.day == c.b.day and c.a.courtroom != c.b.courtroom
        assert c.advocate in c.a.advocates and c.advocate in c.b.advocates
        assert c.a.start < c.b.end and c.b.start < c.a.end
    # brute force over one busy advocate agrees with the grouped version
    adv = max({a for e in events for a in e.advocates}, key=lambda a: len(for_advocate(events, a)))
    mine = for_advocate(events, adv)
    brute = {(x.uid, y.uid) for x in mine for y in mine
             if x.uid < y.uid and x.day == y.day and x.courtroom != y.courtroom and x.start < y.end and y.start < x.end}
    assert {tuple(sorted((c.a.uid, c.b.uid))) for c in clashes(events, adv)} == brute


def test_timeline_matches_the_recorded_hearings(store, court):
    room = court[0]
    for case in room.cases[:60]:
        entries = timeline(store, case.id)
        assert entries[0].kind == "filed" and entries[0].day == case.filing_date
        hearings = [t for t in entries if t.kind == "hearing"]
        n = store.cursor().execute("SELECT count(*) FROM hearing WHERE case_id = ?", [case.id]).fetchone()[0]
        assert len(hearings) == n
        assert all(a.day <= b.day for a, b in zip(entries, entries[1:]))
        failed = sum(t.outcome in ("not heard", "heard, not effective") for t in hearings)
        assert failed == case.adjournment_count


def test_summary_and_checklist(store, court, events):
    e = next(x for x in events if x.age_years >= 4)
    room = next(r for r in court if r.name == e.courtroom)
    case = room.by_id[e.case_id]
    facts = summary_facts(store, case, store.today, [e])
    text = summary_text(case, facts)
    assert facts.case_number in text and e.window in text
    items = checklist(case, e, room.cfg.cover_page_for, facts.open_tasks)
    assert items[0].status == "info" and e.courtroom in items[0].text
    assert any(i.status == ("done" if case.prerequisites_met else "pending") for i in items)


def test_cover_page_rule_comes_from_the_preset(court, events):
    room = next(r for r in court if r.cfg.cover_page_for)
    e = next(x for x in for_courtroom(events, room.name) if x.purpose in room.cfg.cover_page_for)
    items = checklist(room.by_id[e.case_id], e, room.cfg.cover_page_for)
    assert any("Cover page" in i.text for i in items)


def test_litigants_span_cases_by_person_key(store, court):
    counts = {}
    for r in court:
        for c in r.cases:
            for p in c.parties:
                counts[p] = counts.get(p, 0) + 1
    multi = [p for p, n in counts.items() if n > 1]
    assert multi, "frequent litigants and institutions appear on several cases"
    assert all(store.directory.person(p) != p for p in multi)
    assert store.directory.organisations & set(multi)


def test_ics_is_well_formed(events):
    sample = events[:40]
    ics = to_ics(sample, "Test calendar", now=datetime(2026, 10, 1, tzinfo=timezone.utc))
    lines = ics.split("\r\n")
    assert ics.endswith("\r\n") and lines[0] == "BEGIN:VCALENDAR" and lines[-2] == "END:VCALENDAR"
    assert ics.count("BEGIN:VEVENT") == ics.count("END:VEVENT") == len(sample)
    uids = [l for l in lines if l.startswith("UID:")]
    assert len(uids) == len(set(uids)) == len(sample)
    assert all(len(l.encode()) <= 75 for l in lines)
    # 11:00 IST is 05:30 UTC
    first = sample[0]
    assert f"DTSTART:{first.start:%Y%m%d}T{(first.start.hour * 60 + first.start.minute - 330) // 60:02d}" in ics


def test_parties_do_not_change_the_roster():
    a = generate_roster(300, today=date(2026, 10, 5), seed=9)
    b = generate_roster(300, today=date(2026, 10, 5), seed=9, id_prefix="HC")
    assert [(c.id, c.purpose, c.advocate_ids, c.adjournment_count) for c in a] == \
           [(c.id, c.purpose, c.advocate_ids, c.adjournment_count) for c in b]
    assert all(c.parties for c in a)
