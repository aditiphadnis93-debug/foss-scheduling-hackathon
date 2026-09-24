"""Parse `last_hearing_summary` (section 5.3). Parser failures never stop a run."""
from __future__ import annotations

import math
import re
from datetime import date, timedelta

from . import rng
from .enums import STAGE_INDEX, HearingType
from .models import Attendance, ParsedSummary

_PARTIES = {
    "complainant": "complainant",
    "complainant's advocate": "complainant_advocate",
    "complainant advocate": "complainant_advocate",
    "accused": "accused",
    "accused advocate": "accused_advocate",
    "accused's advocate": "accused_advocate",
}
_RETURN_OF = re.compile(r"for return of (warrant|summons|notice)", re.I)
_ISSUE = re.compile(r"\bissue\b[^.\n]*?\b(nbw|summons|notice|warrant)", re.I)
_MEDIATION = re.compile(r"mediation", re.I)
_LAST_CHANCE = re.compile(r"last chance", re.I)


def _tokens(line: str) -> list[str]:
    return [t.strip().lower() for t in line.split(",") if t.strip()]


def parse_summary(text: str | None) -> ParsedSummary:
    if not isinstance(text, str) or not text.strip():
        return ParsedSummary(Attendance(), False, False, False, ok=False)
    try:
        present: set[str] = set()
        absent: set[str] = set()
        order_lines: list[str] = []
        for raw in text.splitlines():
            line = raw.strip()
            low = line.lower()
            if low.startswith("present:"):
                present.update(_tokens(line.split(":", 1)[1]))
            elif low.startswith("absent:"):
                absent.update(_tokens(line.split(":", 1)[1]))
            elif line:
                order_lines.append(line)

        def status(field: str) -> bool | None:
            names = [k for k, v in _PARTIES.items() if v == field]
            if any(n in present for n in names):
                return True
            if any(n in absent for n in names):
                return False
            return None

        order = " ".join(order_lines)
        return ParsedSummary(
            attendance=Attendance(
                complainant=status("complainant"),
                complainant_advocate=status("complainant_advocate"),
                accused=status("accused"),
                accused_advocate=status("accused_advocate"),
            ),
            pending_process=bool(_RETURN_OF.search(order) or _ISSUE.search(order)),
            mediation=bool(_MEDIATION.search(order)),
            last_chance=bool(_LAST_CHANCE.search(order)),
        )
    except Exception:  # pragma: no cover - defensive: never stop a run
        return ParsedSummary(Attendance(), False, False, False, ok=False)


def accused_seen(parsed: ParsedSummary, stage: HearingType) -> bool:
    return parsed.attendance.accused is True or STAGE_INDEX[stage] >= STAGE_INDEX[HearingType.PLEA]


def initial_pending_until(
    parsed: ParsedSummary,
    filing_number: str,
    next_purpose: HearingType,
    start: date,
    seed: int,
    gap_of,
) -> tuple[date | None, str | None]:
    """Pending process / mediation report at roster start: start + U(0, reference gap). [ASSUMPTION: issue date unknown]"""
    if parsed.pending_process:
        gap, why = gap_of(next_purpose), "Awaiting return of process"
    elif parsed.mediation:
        gap, why = gap_of(HearingType.REPORTS), "Awaiting mediation report"
    else:
        return None, None
    u = rng.uniform(seed, filing_number, start, next_purpose.value, "pending_until")
    return start + timedelta(days=math.floor(u * (gap + 1))), why
