"""Day rows (DRAFT | PUBLISHED | CLOSED)."""
from __future__ import annotations

from datetime import date

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..models import DayRow


def get(s: Session, d: date) -> DayRow | None:
    return s.get(DayRow, d)


def ensure(s: Session, d: date, ruleset_id: int | None = None) -> DayRow:
    row = s.get(DayRow, d)
    if row is None:
        row = DayRow(date=d, status="DRAFT", ruleset_id=ruleset_id)
        s.add(row)
        s.flush()
    return row


def in_range(s: Session, start: date, end: date) -> dict[date, DayRow]:
    rows = s.scalars(select(DayRow).where(DayRow.date >= start, DayRow.date <= end))
    return {r.date: r for r in rows}


def all_(s: Session) -> list[DayRow]:
    return list(s.scalars(select(DayRow).order_by(DayRow.date)))


def remove(s: Session, d: date) -> None:
    s.execute(delete(DayRow).where(DayRow.date == d))


def delete_all(s: Session) -> None:
    s.execute(delete(DayRow))
