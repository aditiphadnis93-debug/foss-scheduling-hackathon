"""Ruleset rows."""
from __future__ import annotations

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..models import RulesetRow


def get(s: Session, rid: int) -> RulesetRow | None:
    return s.get(RulesetRow, rid)


def all_(s: Session) -> list[RulesetRow]:
    return list(s.scalars(select(RulesetRow).order_by(RulesetRow.id)))


def active(s: Session) -> RulesetRow | None:
    return s.scalars(select(RulesetRow).where(RulesetRow.is_active.is_(True))).first()


def add(s: Session, **values) -> RulesetRow:
    row = RulesetRow(**values)
    s.add(row)
    s.flush()
    return row


def set_active(s: Session, rid: int) -> None:
    for r in all_(s):
        r.is_active = r.id == rid


def delete_all(s: Session) -> None:
    s.execute(delete(RulesetRow))
