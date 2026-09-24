"""Case rows."""
from __future__ import annotations

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from ..models import CaseRow


def get(s: Session, case_id: str) -> CaseRow | None:
    return s.get(CaseRow, case_id)


def find_by_number(s: Session, case_no: str) -> CaseRow | None:
    row = s.get(CaseRow, case_no)
    if row is not None:
        return row
    return s.scalars(select(CaseRow).where(func.upper(CaseRow.case_number) == case_no.upper())).first()


def all_(s: Session) -> list[CaseRow]:
    return list(s.scalars(select(CaseRow).order_by(CaseRow.roster_order)))


def pending(s: Session) -> list[CaseRow]:
    return list(s.scalars(select(CaseRow).where(CaseRow.status == "PENDING").order_by(CaseRow.roster_order)))


def count(s: Session) -> int:
    return s.scalar(select(func.count()).select_from(CaseRow)) or 0


def add_many(s: Session, values: list[dict]) -> None:
    s.add_all(CaseRow(**v) for v in values)


def delete_all(s: Session) -> None:
    s.execute(delete(CaseRow))


def by_ids(s: Session, ids) -> dict[str, CaseRow]:
    ids = list(set(ids))
    out: dict[str, CaseRow] = {}
    for i in range(0, len(ids), 500):
        out.update({r.id: r for r in s.scalars(select(CaseRow).where(CaseRow.id.in_(ids[i:i + 500])))})
    return out


def pending_without_hearing(s: Session) -> list[CaseRow]:
    """Pending cases with no DRAFT/PUBLISHED hearing (normally only those waiting on process)."""
    from ..models import HearingRow
    active = select(HearingRow.id).where(HearingRow.case_id == CaseRow.id,
                                         HearingRow.status.in_(("DRAFT", "PUBLISHED")))
    return list(s.scalars(select(CaseRow).where(CaseRow.status == "PENDING", ~active.exists())
                          .order_by(CaseRow.roster_order)))
