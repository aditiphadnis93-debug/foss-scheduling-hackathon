"""Load a roster CSV (organiser schema) into ``Case`` objects."""
from __future__ import annotations

import csv
import re
from datetime import date
from pathlib import Path

from .domain import Case
from .reference import DATA_DIR, STAGE_ORDER, norm_type

HEARING_COLS = {
    "hearings_admission": "ADMISSION",
    "hearings_delay_condonation_hearing": "DELAY_CONDONATION_HEARING",
    "hearings_cognizance": "COGNIZANCE",
    "hearings_appearance": "APPEARANCE",
    "hearings_warrant": "WARRANT",
    "hearings_plea": "PLEA",
    "hearings_examination_under_s351_bnss": "EXAMINATION_UNDER_S351_BNSS",
    "hearings_evidence_complainant": "EVIDENCE_COMPLAINANT",
    "hearings_evidence_accused": "EVIDENCE_ACCUSED",
    "hearings_arguments": "ARGUMENTS",
    "hearings_judgement": "JUDGEMENT",
    "hearings_bail": "BAIL",
    "hearings_reports": "REPORTS",
    "hearings_application_review": "APPLICATION_REVIEW",
}

_ABSENT = re.compile(r"^Absent:\s*(.*)$", re.MULTILINE | re.IGNORECASE)


def _absentees(summary: str) -> tuple[bool, bool]:
    """(accused_absent, complainant_absent) from the 'Present/Absent' header of the last hearing."""
    m = _ABSENT.search(summary or "")
    if not m:
        return False, False
    who = [w.strip().lower() for w in m.group(1).split(",")]
    return ("accused" in who), ("complainant" in who)


def norm_kind(v: str | None) -> str:
    """'Cheque bounce' / 'NI Act 138' -> 'cheque_loan', etc.; unknown kinds keep their own slug."""
    t = (v or "").strip().lower()
    for key, words in {"cheque_loan": ("cheque", "138", "loan"), "supplier": ("supplier", "goods"),
                       "wages": ("wage", "salary"), "rent": ("rent", "tenan", "lease"),
                       "family_property": ("family", "property", "partition", "maintenance")}.items():
        if any(w in t for w in words):
            return key
    return "_".join(t.split()) or "unspecified"


def load_roster(path: str | Path | None = None) -> list[Case]:
    path = Path(path) if path else DATA_DIR / "roster_sample_100.csv"
    cases: list[Case] = []
    with open(path, newline="", encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            stage = norm_type(r["current_stage"])
            if stage not in STAGE_ORDER:
                stage = "ADMISSION"
            counts = {code: int(r.get(col) or 0) for col, code in HEARING_COLS.items()}
            acc_abs, comp_abs = _absentees(r.get("last_hearing_summary", ""))
            purpose = norm_type(r["purpose_of_next_hearing"])
            cases.append(Case(
                case_id=r["case_number"],
                filing_number=r["filing_number"],
                filing_date=date.fromisoformat(r["filing_date"][:10]),
                advocate_id=r["advocate_id"],
                party_id=r["party_id"],
                stage=stage,
                purpose=purpose,
                hearings_by_type=counts,
                total_hearings=int(r.get("total_hearings_held") or sum(counts.values())),
                hearings_at_stage=counts.get(stage, 0),
                accused_absent_last=acc_abs,
                complainant_absent_last=comp_abs,
                meta={"last_hearing_summary": r.get("last_hearing_summary", ""),
                      # optional: a court's own data may carry the kind of dispute; the organiser roster does not
                      **({"kind": norm_kind(r.get("dispute_type") or r.get("case_type"))}
                         if (r.get("dispute_type") or r.get("case_type")) else {})},
            ))
    return cases
