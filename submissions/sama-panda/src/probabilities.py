"""Load purpose-level P_show / P_substantive / gap_days / system durations from hackathon CSVs.

P_show formula (L1):
  absence_share = (Respondent Absence + Petitioner Absence + Both Parties Unready/Absent) / total_no
  P_show = 1 - absence_share
  Clamped to [0.05, 1.0]. Falls back to 0.7 if total_no is 0.
"""

from __future__ import annotations

import csv
from functools import lru_cache
from pathlib import Path
from typing import Any

from .normalize import to_upper_snake

HACKATHON_DATA = (
    Path(__file__).resolve().parent.parent.parent.parent / "data"
).resolve()

ABSENCE_COLUMNS = (
    "Respondent Absence / Non-Compliance",
    "Petitioner Absence / Non-Compliance",
    "Both Parties Unready / Absent",
)

_FALLBACK_DURATION = {
    "ADMISSION": 5,
    "COGNIZANCE": 10,
    "DELAY_CONDONATION_HEARING": 5,
    "APPEARANCE": 10,
    "WARRANT": 10,
    "PLEA": 15,
    "EXAMINATION_UNDER_S351_BNSS": 30,
    "EVIDENCE_COMPLAINANT": 30,
    "EVIDENCE_ACCUSED": 30,
    "ARGUMENTS": 30,
    "JUDGEMENT": 30,
    "BAIL": 15,
    "REPORTS": 10,
    "APPLICATION_REVIEW": 10,
}

_FALLBACK_GAP = {
    "ADMISSION": 5,
    "COGNIZANCE": 14,
    "DELAY_CONDONATION_HEARING": 5,
    "APPEARANCE": 21,
    "WARRANT": 21,
    "PLEA": 14,
    "EXAMINATION_UNDER_S351_BNSS": 14,
    "EVIDENCE_COMPLAINANT": 14,
    "EVIDENCE_ACCUSED": 14,
    "ARGUMENTS": 14,
    "JUDGEMENT": 21,
    "BAIL": 14,
    "REPORTS": 45,
    "APPLICATION_REVIEW": 5,
}


def _data_path(name: str) -> Path:
    p = HACKATHON_DATA / name
    if not p.exists():
        alt = Path("/Users/paulthottan/foss-scheduling-hackathon/data") / name
        if alt.exists():
            return alt
    return p


def _norm_purpose(value: str | None) -> str:
    return to_upper_snake(value or "")


@lru_cache(maxsize=1)
def _load_tables() -> dict[str, Any]:
    durations: dict[str, int] = dict(_FALLBACK_DURATION)
    gaps: dict[str, int] = dict(_FALLBACK_GAP)
    p_sub: dict[str, float] = {}
    p_show: dict[str, float] = {}

    ref = _data_path("hearing_type_reference.csv")
    if ref.exists():
        with ref.open(newline="", encoding="utf-8") as f:
            for row in csv.DictReader(f):
                purpose = _norm_purpose(row.get("Hearing Purpose"))
                if not purpose:
                    continue
                try:
                    durations[purpose] = int(
                        float(row.get("Time it takes for hearing (mins) - estimated") or 15)
                    )
                except (TypeError, ValueError):
                    pass
                try:
                    gaps[purpose] = int(
                        float(
                            row.get(
                                "Time to next hearing given this is the purpose (days)"
                            )
                            or 14
                        )
                    )
                except (TypeError, ValueError):
                    pass

    sub = _data_path("substantiveness_by_hearing_type.csv")
    if sub.exists():
        with sub.open(newline="", encoding="utf-8") as f:
            for row in csv.DictReader(f):
                purpose = _norm_purpose(row.get("hearingType"))
                if not purpose:
                    continue
                try:
                    pct = float(
                        row.get("Substantive Hearings (percentage probability)") or 50
                    )
                    p_sub[purpose] = max(0.01, min(1.0, pct / 100.0))
                except (TypeError, ValueError):
                    p_sub[purpose] = 0.5

    fail = _data_path("hearing_failure_reasons.csv")
    if fail.exists():
        with fail.open(newline="", encoding="utf-8") as f:
            for row in csv.DictReader(f):
                purpose = _norm_purpose(row.get("hearingType"))
                if not purpose:
                    continue
                try:
                    total = float(row.get("total_no") or 0)
                except (TypeError, ValueError):
                    total = 0
                if total <= 0:
                    p_show[purpose] = 0.7
                    continue
                absence = 0.0
                for col in ABSENCE_COLUMNS:
                    try:
                        absence += float(row.get(col) or 0)
                    except (TypeError, ValueError):
                        pass
                share = absence / total
                p_show[purpose] = max(0.05, min(1.0, 1.0 - share))

    # Fill missing purposes with defaults
    for purpose in durations:
        p_sub.setdefault(purpose, 0.5)
        p_show.setdefault(purpose, 0.7)

    holidays: set[str] = set()
    working: set[str] = set()
    cal = _data_path("court_calendar.csv")
    if cal.exists():
        with cal.open(newline="", encoding="utf-8") as f:
            for row in csv.DictReader(f):
                date = (row.get("date") or "").strip()
                if not date:
                    continue
                is_working = (row.get("is_working_day") or "").strip().lower() == "yes"
                is_holiday = (row.get("is_holiday") or "").strip().lower() == "yes"
                is_off = (row.get("is_weekly_off") or "").strip().lower() == "yes"
                if is_working and not is_holiday and not is_off:
                    working.add(date)
                else:
                    holidays.add(date)

    return {
        "durations": durations,
        "gaps": gaps,
        "p_sub": p_sub,
        "p_show": p_show,
        "holidays": holidays,
        "working": working,
    }


def calendar_rows(
    from_date: str | None = None, to_date: str | None = None
) -> list[dict[str, Any]]:
    """Return court-calendar rows, optionally filtered inclusively by ISO date."""
    cal = _data_path("court_calendar.csv")
    if not cal.exists():
        return []

    def yes(value: str | None) -> bool:
        return (value or "").strip().lower() == "yes"

    rows: list[dict[str, Any]] = []
    with cal.open(newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            date = (row.get("date") or "").strip()
            if not date or (from_date and date < from_date) or (to_date and date > to_date):
                continue
            rows.append(
                {
                    "date": date,
                    "day_of_week": (row.get("day_of_week") or "").strip(),
                    "is_weekly_off": yes(row.get("is_weekly_off")),
                    "is_holiday": yes(row.get("is_holiday")),
                    "holiday_name": (row.get("holiday_name") or "").strip(),
                    "is_working_day": yes(row.get("is_working_day")),
                }
            )
    return rows


def reload() -> None:
    """Clear cached CSV tables (tests)."""
    _load_tables.cache_clear()


def p_show(purpose: str) -> float:
    tables = _load_tables()
    key = _norm_purpose(purpose)
    return float(tables["p_show"].get(key, 0.7))


def p_substantive(purpose: str) -> float:
    tables = _load_tables()
    key = _norm_purpose(purpose)
    return float(tables["p_sub"].get(key, 0.5))


def gap_days(purpose: str) -> int:
    tables = _load_tables()
    key = _norm_purpose(purpose)
    return int(tables["gaps"].get(key, 14))


def system_duration_mins(purpose: str) -> int:
    tables = _load_tables()
    key = _norm_purpose(purpose)
    return int(tables["durations"].get(key, 15))


def all_purposes() -> list[str]:
    return sorted(_load_tables()["durations"].keys())


def is_working_day(date: str) -> bool:
    """True if calendar marks working day (not holiday / weekly off)."""
    tables = _load_tables()
    d = (date or "").strip()
    if d in tables["working"]:
        return True
    if d in tables["holidays"]:
        return False
    # Unknown date: allow (don't hard-refuse)
    return True


def holiday_name(date: str) -> str | None:
    cal = _data_path("court_calendar.csv")
    if not cal.exists():
        return None
    d = (date or "").strip()
    with cal.open(newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            if (row.get("date") or "").strip() == d:
                name = (row.get("holiday_name") or "").strip()
                is_off = (row.get("is_weekly_off") or "").strip().lower() == "yes"
                is_holiday = (row.get("is_holiday") or "").strip().lower() == "yes"
                if is_holiday and name:
                    return name
                if is_off:
                    return "Weekly off"
                if is_holiday:
                    return "Holiday"
                return None
    return None
