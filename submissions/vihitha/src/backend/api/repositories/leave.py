"""Judge's leave rows."""
from __future__ import annotations

from datetime import date

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..models import LeaveRow


def all_(s: Session) -> dict[date, str]:
    return {r.date: (r.note or "Judge's leave") for r in s.scalars(select(LeaveRow))}


def add(s: Session, d: date, note: str | None) -> None:
    row = s.get(LeaveRow, d)
    if row is None:
        s.add(LeaveRow(date=d, note=note))
    else:
        row.note = note


def remove(s: Session, d: date) -> bool:
    return s.execute(delete(LeaveRow).where(LeaveRow.date == d)).rowcount > 0


def delete_all(s: Session) -> None:
    s.execute(delete(LeaveRow))
