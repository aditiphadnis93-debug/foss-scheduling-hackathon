"""Convert stored state <-> engine state (spec v3 section 5).

Duck-typed: works on any object with the case/hearing column attributes (the API's ORM rows),
so the engine never imports the database layer.
"""
from __future__ import annotations

import json
from datetime import date

from .enums import HearingType, ReasonGroup
from .models import Case, RosterCase

CASE_FIELDS = (
    "stage", "next_purpose", "hearing_counts_json", "hearings_at_stage", "consecutive_adjourned",
    "consecutive_absence", "pending_until", "pending_reason", "last_chance", "accused_seen", "show_alpha",
    "show_beta", "status", "disposal_type", "disposed_on", "not_reached_count", "carried_forward",
    "priority_boost", "last_listed_on", "last_reached_on", "stage_entered_on",
)


def counts_to_json(counts: dict[HearingType, int]) -> str:
    return json.dumps({h.value: int(n) for h, n in counts.items()})


def counts_from_json(text: str | None) -> dict[HearingType, int]:
    raw = json.loads(text or "{}")
    out = {h: 0 for h in HearingType}
    for k, v in raw.items():
        out[HearingType(k)] = int(v)
    return out


def case_from_row(row) -> Case:
    return Case(
        filing_number=row.id, case_number=row.case_number, advocate_id=row.advocate_id,
        party_id=row.party_id, filing_date=row.filing_date,
        stage=HearingType(row.stage), next_purpose=HearingType(row.next_purpose),
        hearing_counts=counts_from_json(row.hearing_counts_json), order=row.roster_order or 0,
        consecutive_non_substantive=row.consecutive_adjourned or 0,
        consecutive_absence=row.consecutive_absence or 0,
        hearings_at_stage=row.hearings_at_stage or 0, stage_entered_on=row.stage_entered_on,
        pending_until=row.pending_until, pending_reason=row.pending_reason,
        last_chance=bool(row.last_chance), accused_seen=bool(row.accused_seen),
        disposed_on=row.disposed_on if row.status == "DISPOSED" else None,
        disposal_type=row.disposal_type,
        not_reached_count=row.not_reached_count or 0, carried_forward=bool(row.carried_forward),
        priority_boost=row.priority_boost or 0.0,
        last_listed_on=row.last_listed_on, last_reached_on=row.last_reached_on,
        posterior_show=(row.show_alpha or 1.0, row.show_beta or 1.0),
    )


def case_to_row(case: Case, row) -> None:
    """Write the mutable engine fields back onto a stored row."""
    row.stage = case.stage.value
    row.next_purpose = case.next_purpose.value
    row.hearing_counts_json = counts_to_json(case.hearing_counts)
    row.hearings_at_stage = case.hearings_at_stage
    row.consecutive_adjourned = case.consecutive_non_substantive
    row.consecutive_absence = case.consecutive_absence
    row.stage_entered_on = case.stage_entered_on
    row.pending_until = case.pending_until
    row.pending_reason = case.pending_reason
    row.last_chance = case.last_chance
    row.accused_seen = case.accused_seen
    row.show_alpha, row.show_beta = case.posterior_show
    row.not_reached_count = case.not_reached_count
    row.carried_forward = case.carried_forward
    row.priority_boost = case.priority_boost
    row.last_listed_on = case.last_listed_on
    row.last_reached_on = case.last_reached_on
    if case.disposed:
        row.status = "DISPOSED"
        row.disposed_on = case.disposed_on
        row.disposal_type = row.disposal_type or case.disposal_type


def row_values_from_roster(r: RosterCase, c: Case) -> dict:
    """Column values for a new stored case (roster row + its initial engine state)."""
    return {
        "id": r.filing_number, "case_number": r.case_number, "filing_date": r.filing_date,
        "advocate_id": r.advocate_id, "party_id": r.party_id, "stage": c.stage.value,
        "next_purpose": c.next_purpose.value, "status": "PENDING",
        "hearing_counts_json": counts_to_json(c.hearing_counts), "hearings_at_stage": c.hearings_at_stage,
        "consecutive_adjourned": 0, "consecutive_absence": 0, "pending_until": c.pending_until,
        "pending_reason": c.pending_reason, "last_chance": c.last_chance, "accused_seen": c.accused_seen,
        "show_alpha": c.posterior_show[0], "show_beta": c.posterior_show[1],
        "last_hearing_summary": r.last_hearing_summary, "roster_order": r.order,
    }


def reason_group(value: str | None) -> ReasonGroup | None:
    return ReasonGroup(value) if value else None


def as_date(v) -> date | None:
    if v is None or isinstance(v, date):
        return v
    return date.fromisoformat(str(v))
