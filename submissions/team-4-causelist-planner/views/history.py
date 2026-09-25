"""Case timeline, summary and per-hearing checklist (docs/court-domain-model.md §12).

History comes from the dataset: the `case_timeline` and `case_summary_facts` views in
docs/scheduler-schema.sql. The summary is a fixed template over those facts, so every clause traces
back to a row.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from scheduler.data import PURPOSE_CHECKLIST
from scheduler.models import Case
from scheduler.store import Store

from .events import CourtEvent

HEARING_OUTCOME = {  # case_timeline.event_type -> outcome label used by the timeline chart
    "hearing_effective": "effective",
    "hearing_not_effective": "heard, not effective",
    "hearing_not_heard": "not heard",
}


@dataclass(frozen=True)
class TimelineEntry:
    day: date
    kind: str  # filed | registered | stage_change | hearing | order | application_* | task_* | disposed | upcoming
    purpose: str | None
    outcome: str  # hearings: effective | heard, not effective | not heard | listed; otherwise the event title
    detail: str


def _label(purpose: str | None) -> str:
    return (purpose or "").replace("_", " ")


def timeline(store: Store, case_id: str) -> list[TimelineEntry]:
    out = []
    for r in store.timeline(case_id):
        if r["source_table"] == "hearing":
            outcome = HEARING_OUTCOME.get(r["event_type"], r["event_type"].removeprefix("hearing_"))
            out.append(TimelineEntry(r["event_date"], "hearing", r["hearing_type_code"], outcome, r["detail"] or ""))
        else:
            out.append(TimelineEntry(r["event_date"], r["event_type"], None, r["title"], r["detail"] or ""))
    return out


def upcoming(events: list[CourtEvent]) -> list[TimelineEntry]:
    return [TimelineEntry(e.day, "upcoming", e.purpose, "listed", f"{e.window}, {e.courtroom} ({e.judge})")
            for e in sorted(events, key=lambda e: e.start)]


@dataclass(frozen=True)
class CaseFacts:
    case_number: str
    title: str
    age_years: float
    hearings: int
    effective: int
    not_heard: int
    heard_not_effective: int
    top_reason: str | None
    last_effective_date: date | None
    last_effective_purpose: str | None
    stage: str | None
    stage_since: date | None
    open_tasks: tuple[str, ...]
    pending_ias: int
    last_order_date: date | None
    last_order: str | None
    next_listing: CourtEvent | None


def facts_from_row(row: dict, case: Case, today: date, events: list[CourtEvent] | None = None) -> CaseFacts:
    future = sorted((e for e in events or [] if e.day >= today), key=lambda e: e.start)
    tasks = tuple(t for t in (row["open_task_list"] or "").split("; ") if t)
    return CaseFacts(
        case_number=row["court_case_number"] or case.id, title=row["case_title"] or "",
        age_years=round(case.age_years(today), 1),  # the view uses current_date; the dataset has its own today
        hearings=row["hearings"], effective=row["effective"], not_heard=row["not_heard"],
        heard_not_effective=row["heard"] - row["effective"], top_reason=row["top_adjournment_reason"],
        last_effective_date=row["last_effective_date"], last_effective_purpose=row["last_effective_purpose"],
        stage=row["stage_code"], stage_since=row["stage_since"], open_tasks=tasks, pending_ias=row["pending_ias"],
        last_order_date=row["last_order_date"], last_order=row["last_order_summary"],
        next_listing=future[0] if future else None,
    )


def summary_facts(store: Store, case: Case, today: date, events: list[CourtEvent] | None = None) -> CaseFacts:
    return facts_from_row(store.facts(case.id), case, today, events)


def summary_text(case: Case, f: CaseFacts) -> str:
    parts = [f"{f.case_number}, a {case.case_type} matter filed {case.filing_date:%b %Y} ({f.age_years} y)."]
    if f.hearings:
        stalled = f.hearings - f.effective
        parts.append(f"{f.hearings} hearings so far: {f.effective} effective, {stalled} adjourned or ineffective"
                     + (f" (most often: {f.top_reason.lower()})." if f.top_reason else "."))
    else:
        parts.append("Not heard yet.")
    if f.last_effective_date:
        parts.append(f"Last effective hearing: {_label(f.last_effective_purpose)}, {f.last_effective_date:%d %b %Y}.")
    if f.stage_since:
        parts.append(f"Now at {_label(case.purpose)} since {f.stage_since:%d %b %Y}.")
    if f.open_tasks:
        parts.append(f"Pending: {'; '.join(f.open_tasks)}.")
    if f.pending_ias:
        parts.append(f"{f.pending_ias} interim application(s) pending.")
    if f.last_order:
        parts.append(f"Last order ({f.last_order_date:%d %b %Y}): {f.last_order}")
    if f.next_listing:
        e = f.next_listing
        parts.append(f"Next: {e.day:%a %d %b}, {e.window}, {e.courtroom}.")
    return " ".join(parts)


@dataclass(frozen=True)
class ChecklistItem:
    text: str
    status: str  # pending | to_confirm | done | info


def checklist(case: Case, event: CourtEvent, cover_page_for: tuple[str, ...] = (),
              open_tasks: tuple[str, ...] = ()) -> list[ChecklistItem]:
    items = [ChecklistItem(f"Attend {event.day:%a %d %b}, {event.window}, {event.courtroom} ({event.judge})", "info")]
    if open_tasks:
        items += [ChecklistItem(f"{t}: not complete, the hearing may not be effective", "pending") for t in open_tasks]
    elif case.prerequisites_met:
        items.append(ChecklistItem("Prerequisites complete (service of notice, records)", "done"))
    else:
        items.append(ChecklistItem("Service of notice / prerequisite not complete: the hearing may not be effective", "pending"))
    items += [ChecklistItem(t, "to_confirm") for t in PURPOSE_CHECKLIST.get(event.purpose, [])]
    if event.purpose in cover_page_for:
        items.append(ChecklistItem(f"Cover page summarising the facts (required by {event.judge})", "to_confirm"))
    if case.adjournment_count >= 5:
        items.append(ChecklistItem(f"Adjourned {case.adjournment_count} times: the court may treat this as a last opportunity", "info"))
    return items
