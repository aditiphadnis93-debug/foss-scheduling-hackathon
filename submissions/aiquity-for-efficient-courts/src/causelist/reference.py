"""Reference tables from ``data/``: hearing types, lifecycle order, calendar.

Everything the model knows about *how hearings behave* comes from here, so the
rest of the code never parses the organiser CSVs directly.
"""
from __future__ import annotations

import csv
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]
DATA_DIR = REPO_ROOT / "data"

# The 11 substantive stages, in order (case study, section 5.1).
STAGE_ORDER = [
    "ADMISSION",
    "DELAY_CONDONATION_HEARING",
    "COGNIZANCE",
    "APPEARANCE",
    "WARRANT",
    "PLEA",
    "EXAMINATION_UNDER_S351_BNSS",
    "EVIDENCE_COMPLAINANT",
    "EVIDENCE_ACCUSED",
    "ARGUMENTS",
    "JUDGEMENT",
]
# Types that interrupt a case at any point instead of occupying a slot in the sequence.
INTERRUPT_TYPES = {"BAIL", "REPORTS", "APPLICATION_REVIEW"}

# Where a case goes after a *substantive* hearing of this purpose.
# Delay condonation is only visited by cases already in it; warrant is only
# visited when the accused fails to appear (see simulate.py).
NEXT_PURPOSE_ON_SUCCESS = {
    "ADMISSION": "COGNIZANCE",
    "DELAY_CONDONATION_HEARING": "COGNIZANCE",
    "COGNIZANCE": "APPEARANCE",
    "APPEARANCE": "PLEA",
    "WARRANT": "PLEA",
    "PLEA": "EXAMINATION_UNDER_S351_BNSS",
    "EXAMINATION_UNDER_S351_BNSS": "EVIDENCE_COMPLAINANT",
    "EVIDENCE_COMPLAINANT": "EVIDENCE_ACCUSED",
    "EVIDENCE_ACCUSED": "ARGUMENTS",
    "ARGUMENTS": "JUDGEMENT",
    "JUDGEMENT": None,  # disposed
}

# Non-substantive reasons grouped by *when they could have been known*.
# PREREQ: knowable before listing (process not served, filing not ready) -> the
#         scheduler can avoid listing these at all.
# ATTEND: decided by parties/advocates on the day (absence, seeking time).
# COURT:  the court's own side, or unexplained.
REASON_GROUPS = {
    "PREREQ": [
        "Awaiting Process / Summons / Warrant Return",
        "Evidence / Filing Not Ready",
        "External Dependency",
    ],
    "ATTEND": [
        "Respondent Absence / Non-Compliance",
        "Petitioner Absence / Non-Compliance",
        "Both Parties Unready / Absent",
        "Party Sought Time / Adjournment",
    ],
    "COURT": [
        "Court Administrative Issue",
        "Court Holiday / No Sitting",
        "Unclear",
    ],
}


def norm_type(name: str) -> str:
    """'Examination Under S351 Bnss' -> 'EXAMINATION_UNDER_S351_BNSS'."""
    return "_".join(name.strip().upper().replace("/", " ").split())


@dataclass(frozen=True)
class HearingType:
    code: str
    minutes: float                 # estimated duration of a hearing that goes ahead
    ideal_gap_days: int            # procedural gap to next hearing for this purpose
    p_substantive: float           # 0..1, observed
    mean_hearings: float
    median_hearings: float
    max_hearings: int
    # Probability mass of each non-substantive group (sums with p_substantive to ~1).
    p_prereq: float
    p_attend: float
    p_court: float
    reason_shares: dict[str, float] = field(default_factory=dict)  # reason -> share of non-substantive


@dataclass(frozen=True)
class CalendarDay:
    day: date
    is_working: bool
    holiday: str


def _read(name: str) -> list[dict[str, str]]:
    with open(DATA_DIR / name, newline="", encoding="utf-8") as fh:
        return list(csv.DictReader(fh))


def load_hearing_types() -> dict[str, HearingType]:
    ref = {norm_type(r["Hearing Purpose"]): r for r in _read("hearing_type_reference.csv")}
    sub = {norm_type(r["hearingType"]): float(r["Substantive Hearings (percentage probability)"]) / 100
           for r in _read("substantiveness_by_hearing_type.csv")}
    fail = {norm_type(r["hearingType"]): r for r in _read("hearing_failure_reasons.csv")}

    out: dict[str, HearingType] = {}
    for code, r in ref.items():
        p_sub = sub[code]
        f = fail[code]
        counts = {reason: float(f[reason]) for grp in REASON_GROUPS.values() for reason in grp}
        total = sum(counts.values()) or 1.0
        shares = {k: v / total for k, v in counts.items()}
        non_sub = 1.0 - p_sub
        grp_mass = {g: non_sub * sum(shares[r_] for r_ in reasons) for g, reasons in REASON_GROUPS.items()}
        out[code] = HearingType(
            code=code,
            minutes=float(r["Time it takes for hearing (mins) - estimated"]),
            ideal_gap_days=int(r["Time to next hearing given this is the purpose (days)"]),
            p_substantive=p_sub,
            mean_hearings=float(r["Mean Hearings per Case"]),
            median_hearings=float(r["Median Hearings per Case"]),
            max_hearings=int(r["Max Hearings per Case"]),
            p_prereq=grp_mass["PREREQ"],
            p_attend=grp_mass["ATTEND"],
            p_court=grp_mass["COURT"],
            reason_shares=shares,
        )
    return out


def load_calendar() -> list[CalendarDay]:
    return [
        CalendarDay(date.fromisoformat(r["date"]), r["is_working_day"] == "Yes", r["holiday_name"])
        for r in _read("court_calendar.csv")
    ]


def working_days(start: date, end: date, leave: set[date] | None = None) -> list[date]:
    leave = leave or set()
    return [d.day for d in load_calendar() if d.is_working and start <= d.day <= end and d.day not in leave]
