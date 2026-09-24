"""CSV exports (spec v3 8.9)."""
from __future__ import annotations

from datetime import date

from vihitha import export

from ..db import session_scope
from ..errors import ValidationFailed
from ..repositories import cases as cases_repo
from ..repositories import hearings as hearings_repo
from . import context


def _rows(hs, case_rows) -> list[dict]:
    out = []
    for h in sorted(hs, key=lambda h: (h.date, h.window_start or "99", h.est_start or "99", h.seq)):
        c = case_rows[h.case_id]
        out.append({
            "Case Number": c.case_number, "Filing Number": c.id, "Hearing Type": h.hearing_type,
            "Hearing Date": h.date.isoformat(), "window_start": h.window_start, "window_end": h.window_end,
            "est_start": h.est_start, "est_end": h.est_end, "advocate_id": c.advocate_id,
            "case_age_years": f"{(h.date - c.filing_date).days / 365.25:.2f}", "reason": h.reason,
            "status": h.result or ("TENTATIVE" if h.tentative else h.status),
        })
    return out


def cause_list(d: date) -> str:
    with session_scope() as s:
        hs = [h for h in hearings_repo.on_date(s, d) if h.status != "CANCELLED"]
        return export.to_csv(_rows(hs, {c.id: c for c in cases_repo.all_(s)}))


def proposed_schedule(start: date | None, end: date | None) -> str:
    with session_scope() as s:
        t, h_end = context.horizon(s)
        start, end = start or t, end or h_end
        if end < start:
            raise ValidationFailed("'to' must be on or after 'from'")
        hs = [h for h in hearings_repo.in_range(s, start, end) if h.status != "CANCELLED"]
        return export.to_csv(_rows(hs, {c.id: c for c in cases_repo.all_(s)}))
