"""Hearing rows."""
from __future__ import annotations

from datetime import date

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..models import HearingRow

ACTIVE = ("DRAFT", "PUBLISHED")


def get(s: Session, hearing_id: int) -> HearingRow | None:
    return s.get(HearingRow, hearing_id)


def on_date(s: Session, d: date, statuses: tuple[str, ...] | None = None) -> list[HearingRow]:
    q = select(HearingRow).where(HearingRow.date == d)
    if statuses:
        q = q.where(HearingRow.status.in_(statuses))
    return list(s.scalars(q.order_by(HearingRow.seq, HearingRow.id)))


def in_range(s: Session, start: date, end: date, statuses: tuple[str, ...] | None = None) -> list[HearingRow]:
    q = select(HearingRow).where(HearingRow.date >= start, HearingRow.date <= end)
    if statuses:
        q = q.where(HearingRow.status.in_(statuses))
    return list(s.scalars(q.order_by(HearingRow.date, HearingRow.seq, HearingRow.id)))


def active_from(s: Session, start: date) -> list[HearingRow]:
    """Future DRAFT/PUBLISHED hearings on or after `start`."""
    q = select(HearingRow).where(HearingRow.date >= start, HearingRow.status.in_(ACTIVE))
    return list(s.scalars(q.order_by(HearingRow.date, HearingRow.seq)))


def all_active(s: Session) -> list[HearingRow]:
    return list(s.scalars(select(HearingRow).where(HearingRow.status.in_(ACTIVE))))


def for_case(s: Session, case_id: str) -> list[HearingRow]:
    return list(s.scalars(select(HearingRow).where(HearingRow.case_id == case_id)
                          .order_by(HearingRow.date, HearingRow.id)))


def active_for_case(s: Session, case_id: str) -> list[HearingRow]:
    return list(s.scalars(select(HearingRow).where(HearingRow.case_id == case_id,
                                                   HearingRow.status.in_(ACTIVE)).order_by(HearingRow.date)))


def done(s: Session, start: date | None = None, end: date | None = None) -> list[HearingRow]:
    q = select(HearingRow).where(HearingRow.status == "DONE")
    if start:
        q = q.where(HearingRow.date >= start)
    if end:
        q = q.where(HearingRow.date <= end)
    return list(s.scalars(q.order_by(HearingRow.date, HearingRow.seq)))


def add(s: Session, **values) -> HearingRow:
    row = HearingRow(**values)
    s.add(row)
    s.flush()
    return row


def delete_rows(s: Session, rows: list[HearingRow]) -> None:
    for r in rows:
        s.delete(r)


def delete_all(s: Session) -> None:
    s.execute(delete(HearingRow))
