"""The organisers' reference data (provided/data/*.csv), read through DuckDB, plus what we derive from it.

Derived per hearing type (docs/rebuild-spec.md §5): p_heard from the failure-reason mix, the booking
cost (minutes × p_heard) and an assumed priority. Computed here, never hand-copied, so a revised CSV
flows straight through.
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import date
from functools import lru_cache
from pathlib import Path

import duckdb

PROVIDED_DIR = Path(os.environ.get("PROVIDED_DIR", Path(__file__).resolve().parent.parent / "provided"))
DAY_MINUTES = 420  # the brief: 7 hours of judicial work a day
BUFFER_MINUTES = 30  # kept free every day for ad-hoc work (urgent mentions, fresh bail, etc.)
PLAN_MINUTES = DAY_MINUTES - BUFFER_MINUTES  # what the forecast, close-day and the desk may allocate

# Failure reasons grouped by what a scheduler can do about them (rebuild-spec §5).
PREREQUISITE = ("Awaiting Process / Summons / Warrant Return", "External Dependency")
NOT_HEARD = ("Petitioner Absence / Non-Compliance", "Respondent Absence / Non-Compliance",
             "Both Parties Unready / Absent", "Court Administrative Issue", "Court Holiday / No Sitting",
             "Unclear")
NOT_EFFECTIVE = ("Party Sought Time / Adjournment", "Evidence / Filing Not Ready")

# Assumed: later in the lifecycle = closer to disposal = more worth court time; Bail high (liberty);
# side types mid-table. Not in the data; stated in docs/causelist-planner.md.
PRIORITY = {
    "JUDGEMENT": 10, "BAIL": 9, "ARGUMENTS": 9, "EVIDENCE_ACCUSED": 8, "EVIDENCE_COMPLAINANT": 7,
    "EXAMINATION_UNDER_S351_BNSS": 6, "PLEA": 5, "APPLICATION_REVIEW": 5, "COGNIZANCE": 4,
    "APPEARANCE": 4, "REPORTS": 4, "WARRANT": 3, "ADMISSION": 3, "DELAY_CONDONATION_HEARING": 3,
}
SIDE_TYPES = ("BAIL", "REPORTS", "APPLICATION_REVIEW")  # return to current_stage when done
DISPOSED = "DISPOSED"
# Default "heard, moved on" transition (rebuild-spec §4). The judge can pick any purpose instead.
NEXT_STAGE = {
    "ADMISSION": "COGNIZANCE", "DELAY_CONDONATION_HEARING": "COGNIZANCE", "COGNIZANCE": "APPEARANCE",
    "APPEARANCE": "PLEA", "WARRANT": "PLEA", "PLEA": "EXAMINATION_UNDER_S351_BNSS",
    "EXAMINATION_UNDER_S351_BNSS": "EVIDENCE_COMPLAINANT", "EVIDENCE_COMPLAINANT": "EVIDENCE_ACCUSED",
    "EVIDENCE_ACCUSED": "ARGUMENTS", "ARGUMENTS": "JUDGEMENT", "JUDGEMENT": DISPOSED,
}


def code(label: str) -> str:
    """'Examination Under S351 Bnss' → 'EXAMINATION_UNDER_S351_BNSS' (the other files' spelling)."""
    return "_".join(str(label).strip().upper().split())


def label(purpose: str) -> str:
    return purpose.replace("_", " ").title().replace("S351 Bnss", "S351 BNSS")


@dataclass(frozen=True)
class HearingRef:
    purpose: str
    minutes: int
    gap_days: int
    p_substantive: float
    source: str  # "real" or the organisers' reasoning for an estimate
    hearings_min: int
    hearings_median: float
    hearings_mean: float
    hearings_max: int
    failures: dict[str, int]
    p_heard: float
    priority: int

    @property
    def expected_minutes(self) -> float:
        """What a listing costs the day: full duration when heard, nothing otherwise."""
        return self.minutes * self.p_heard

    def expected_for(self, minutes: int | None) -> float:
        """The cost with the judge's own estimate of the hearing time (None = the table's)."""
        return (self.minutes if minutes is None else minutes) * self.p_heard

    def top_failures(self, n: int = 3) -> list[tuple[str, float]]:
        total = sum(self.failures.values()) or 1
        return [(k, v / total) for k, v in sorted(self.failures.items(), key=lambda x: -x[1])[:n] if v]


def _csv(name: str) -> str:
    return str(PROVIDED_DIR / "data" / name)


def _rows(sql: str) -> list[dict]:
    con = duckdb.connect()
    try:
        cur = con.execute(sql)
        cols = [d[0] for d in cur.description]
        return [dict(zip(cols, r)) for r in cur.fetchall()]
    finally:
        con.close()


def p_heard(s: float, failures: dict[str, int]) -> float:
    """P(a listed hearing is heard) = (1 − pp − pn) / (1 − pp): prerequisite failures aside, absences
    and court issues are what stop a hearing going ahead."""
    total = sum(failures.values())
    if not total:
        return 1.0
    fail = 1 - s
    pp = fail * sum(failures.get(k, 0) for k in PREREQUISITE) / total
    pn = fail * sum(failures.get(k, 0) for k in NOT_HEARD) / total
    return (1 - pp - pn) / (1 - pp) if pp < 1 else 1.0


@lru_cache(maxsize=1)
def hearing_types() -> dict[str, HearingRef]:
    ref = _rows(f"SELECT * FROM read_csv('{_csv('hearing_type_reference.csv')}', header=true)")
    sub = {code(r["hearingType"]): r for r in
           _rows(f"SELECT * FROM read_csv('{_csv('substantiveness_by_hearing_type.csv')}', header=true)")}
    fails = {code(r.pop("hearingType")): r for r in
             _rows(f"SELECT * FROM read_csv('{_csv('hearing_failure_reasons.csv')}', header=true)")}
    out = {}
    for r in ref:
        p = code(r["Hearing Purpose"])
        f = {k: int(v) for k, v in fails[p].items() if k not in ("total_no", "source")}
        s = float(sub[p]["Substantive Hearings (percentage probability)"]) / 100
        out[p] = HearingRef(
            purpose=p,
            minutes=int(r["Time it takes for hearing (mins) - estimated"]),
            gap_days=int(r["Time to next hearing given this is the purpose (days)"]),
            p_substantive=s, source=str(sub[p]["source"]),
            hearings_min=int(r["Min Hearings per Case"]), hearings_median=float(r["Median Hearings per Case"]),
            hearings_mean=float(r["Mean Hearings per Case"]), hearings_max=int(r["Max Hearings per Case"]),
            failures=f, p_heard=p_heard(s, f), priority=PRIORITY.get(p, 5),
        )
    return out


@lru_cache(maxsize=1)
def calendar() -> list[dict]:
    return _rows(f"SELECT date, day_of_week, is_holiday = 'Yes' AS holiday, holiday_name, "
                 f"is_working_day = 'Yes' AS sitting FROM read_csv('{_csv('court_calendar.csv')}', header=true) "
                 f"ORDER BY date")


def sitting_days() -> list[date]:
    return [r["date"] for r in calendar() if r["sitting"]]


def calendar_end() -> date:
    return calendar()[-1]["date"]


def sample_causelist() -> list[dict]:
    return _rows(f"SELECT * FROM read_csv('{_csv('sample_causelist_2026-09-22.csv')}', header=true)")
