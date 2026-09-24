"""Load the organisers' reference data and build rosters.

Everything here is deterministic given a seed. No scheduling logic lives here.
"""

from __future__ import annotations

import csv
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

import numpy as np

def _find_data_dir() -> Path:
    """The organisers' data/ folder: nearest ancestor containing data/hearing_type_reference.csv
    (works both standalone and from submissions/<team>/ inside their repo)."""
    for p in Path(__file__).resolve().parents:
        if (p / "data" / "hearing_type_reference.csv").exists():
            return p / "data"
    raise FileNotFoundError("could not find data/hearing_type_reference.csv above this package")


DATA_DIR = _find_data_dir()

# The fixed 11-stage sequence (brief §5.1). Appearance and Warrant both lead to Plea:
# Warrant is the escalation when the accused doesn't appear on summons.
STAGES = [
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
NEXT_STAGE = {
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
    "JUDGEMENT": "DISPOSED",
}
# Out-of-sequence purposes: after one, the case returns to its current stage.
SIDE_PURPOSES = {"BAIL", "REPORTS", "APPLICATION_REVIEW"}
AWAITING_PROCESS = "Awaiting Process / Summons / Warrant Return"
NON_SITTING_REASON = "Court Holiday / No Sitting"


def norm(purpose: str) -> str:
    return purpose.strip().upper().replace(" ", "_")


@dataclass(frozen=True)
class HearingType:
    purpose: str
    minutes: int
    gap_days: int
    mean_hearings: float
    p_sub: float  # P(substantive), unconditional — as published
    reason_counts: dict[str, int]  # adjournment reasons, excluding non-sitting days

    @property
    def p_awaiting_process(self) -> float:
        """Share of *all* hearings of this type lost to outstanding process."""
        failures = sum(self.reason_counts.values())
        if failures == 0:
            return 0.0
        total = failures / (1 - self.p_sub) if self.p_sub < 1 else failures
        return min(0.95, self.reason_counts.get(AWAITING_PROCESS, 0) / total)

    @property
    def p_sub_ready(self) -> float:
        """P(substantive) for a case whose process has returned."""
        return min(1.0, self.p_sub / (1 - self.p_awaiting_process))


def load_hearing_types(data_dir: Path = DATA_DIR) -> dict[str, HearingType]:
    ref = {r["Hearing Purpose"]: r for r in _rows(data_dir / "hearing_type_reference.csv")}
    sub = {
        r["hearingType"]: float(r["Substantive Hearings (percentage probability)"]) / 100
        for r in _rows(data_dir / "substantiveness_by_hearing_type.csv")
    }
    reasons: dict[str, dict[str, int]] = {}
    for r in _rows(data_dir / "hearing_failure_reasons.csv"):
        reasons[r["hearingType"]] = {
            k: int(v)
            for k, v in r.items()
            if k not in ("hearingType", "total_no", "source", NON_SITTING_REASON) and v
        }
    out = {}
    for purpose, r in ref.items():
        out[purpose] = HearingType(
            purpose=purpose,
            minutes=int(r["Time it takes for hearing (mins) - estimated"]),
            gap_days=int(r["Time to next hearing given this is the purpose (days)"]),
            mean_hearings=float(r["Mean Hearings per Case"]),
            p_sub=sub[purpose],
            reason_counts=reasons[purpose],
        )
    return out


def load_sitting_days(start: date, end: date, leave: set[date] = frozenset(),
                      data_dir: Path = DATA_DIR) -> list[date]:
    days = []
    for r in _rows(data_dir / "court_calendar.csv"):
        d = date.fromisoformat(r["date"])
        if start <= d <= end and r["is_working_day"] == "Yes" and d not in leave:
            days.append(d)
    return days


@dataclass
class CaseRecord:
    """A roster row, as the organisers provide it (plus our advocate reassignment)."""

    case_id: str
    filing_date: date
    advocate: str
    stage: str
    purpose: str
    hearings_so_far: int
    extra: dict = field(default_factory=dict)


def load_sample_roster(data_dir: Path = DATA_DIR) -> list[CaseRecord]:
    out = []
    for r in _rows(data_dir / "roster_sample_100.csv"):
        out.append(
            CaseRecord(
                case_id=r["case_number"],
                filing_date=date.fromisoformat(r["filing_date"]),
                advocate=r["advocate_id"],
                stage=norm(r["current_stage"]),
                purpose=norm(r["purpose_of_next_hearing"]),
                hearings_so_far=int(r["total_hearings_held"]),
                extra={
                    "last_hearing_summary": r["last_hearing_summary"],
                    "hearings_by_type": {k[len("hearings_"):].upper(): int(v) for k, v in r.items()
                                         if k.startswith("hearings_") and v},
                },
            )
        )
    return out


def generate_roster(n: int, seed: int, advocates: str = "uniform",
                    base: list[CaseRecord] | None = None) -> list[CaseRecord]:
    """Scale the 100-case sample up to n cases.

    "uniform" mirrors the organisers' generate_roster.py (bootstrap rows, advocates drawn
    uniformly at the sample's cases-per-advocate ratio). "lopsided" is ours: advocate load
    follows a Zipf-like curve, so a few advocates carry many cases, as in real courts.
    """
    base = base or load_sample_roster()
    rng = np.random.default_rng(seed)
    picks = rng.integers(0, len(base), size=n)
    per_adv = len(base) / len({c.advocate for c in base})
    n_adv = max(1, round(n / per_adv))
    if advocates == "uniform":
        adv_ids = rng.integers(1, n_adv + 1, size=n)
    elif advocates == "lopsided":
        n_adv = max(1, n_adv // 4)
        weights = 1 / np.arange(1, n_adv + 1) ** 1.1
        adv_ids = rng.choice(np.arange(1, n_adv + 1), size=n, p=weights / weights.sum())
    else:
        raise ValueError(f"unknown advocate distribution {advocates!r}")
    out = []
    for i, (p, a) in enumerate(zip(picks, adv_ids)):
        b = base[p]
        out.append(
            CaseRecord(
                case_id=f"ST/{i + 1}/{b.filing_date.year}",
                filing_date=b.filing_date,
                advocate=f"ADV-{a:04d}",
                stage=b.stage,
                purpose=b.purpose,
                hearings_so_far=b.hearings_so_far,
                extra=b.extra,
            )
        )
    return out


def _rows(path: Path) -> list[dict[str, str]]:
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))



# --------------------------------------------------------------------------------------------
# Importing a judge's own roster (CSV)
# --------------------------------------------------------------------------------------------
REQUIRED_COLUMNS = ["case_number", "filing_date", "current_stage", "purpose_of_next_hearing"]
OPTIONAL_COLUMNS = ["advocate_id", "party_id", "total_hearings_held", "last_hearing_summary", "hearings_<type>…"]
ALIASES = {  # friendlier spellings people use
    "case_no": "case_number", "case": "case_number", "case number": "case_number",
    "filed_on": "filing_date", "filing date": "filing_date", "date_of_filing": "filing_date",
    "stage": "current_stage", "current stage": "current_stage",
    "next_purpose": "purpose_of_next_hearing", "purpose": "purpose_of_next_hearing", "next hearing purpose": "purpose_of_next_hearing",
    "advocate": "advocate_id", "advocate id": "advocate_id", "hearings": "total_hearings_held",
}


def parse_roster_csv(text: str, known_purposes: set[str], today: date | None = None) -> dict:
    """Parse and validate a roster CSV. Returns {"cases": [CaseRecord], "errors": [...], "warnings": [...]}.

    Accepts the organisers' roster format; column names are case-insensitive and a few common
    alternatives are understood. Rows with errors are skipped and reported with their line number.
    """
    import io

    text = text.lstrip("\ufeff")
    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        return {"cases": [], "errors": [{"row": 1, "message": "The file is empty or has no header row."}], "warnings": []}
    colmap = {}
    for f in reader.fieldnames:
        k = (f or "").strip().lower()
        colmap[f] = ALIASES.get(k, k.replace(" ", "_"))
    have = set(colmap.values())
    missing = [c for c in REQUIRED_COLUMNS if c not in have]
    if missing:
        return {"cases": [], "errors": [{"row": 1, "message": f"Missing column(s): {', '.join(missing)}. "
                                                   f"Required: {', '.join(REQUIRED_COLUMNS)}."}], "warnings": []}
    today = today or date.today()
    cases, errors, warnings, seen = [], [], [], set()
    for i, raw in enumerate(reader, start=2):
        r = {colmap[k]: (v or "").strip() for k, v in raw.items() if k is not None}
        problems = []
        cid = r.get("case_number", "")
        if not cid:
            problems.append("case_number is empty")
        elif cid in seen:
            problems.append(f"duplicate case_number {cid}")
        try:
            filed = date.fromisoformat(r.get("filing_date", ""))
            if filed > today:
                problems.append(f"filing_date {filed} is in the future")
        except ValueError:
            filed = None
            problems.append(f"filing_date '{r.get('filing_date', '')}' is not a date (use YYYY-MM-DD)")
        stage, purpose = norm(r.get("current_stage", "")), norm(r.get("purpose_of_next_hearing", ""))
        if stage not in STAGES:
            problems.append(f"current_stage '{r.get('current_stage', '')}' is not one of the 11 stages")
        if purpose not in known_purposes:
            problems.append(f"purpose_of_next_hearing '{r.get('purpose_of_next_hearing', '')}' is not a known hearing type")
        try:
            held = int(r.get("total_hearings_held") or 0)
        except ValueError:
            held = 0
            warnings.append({"row": i, "message": "total_hearings_held isn't a number; treated as 0"})
        if problems:
            errors.append({"row": i, "case": cid, "message": "; ".join(problems)})
            continue
        seen.add(cid)
        adv = r.get("advocate_id") or f"ADV-UNKNOWN-{i}"
        if not r.get("advocate_id"):
            warnings.append({"row": i, "message": "no advocate_id; advocate grouping can't use this case"})
        cases.append(CaseRecord(
            case_id=cid, filing_date=filed, advocate=adv, stage=stage, purpose=purpose, hearings_so_far=held,
            extra={"last_hearing_summary": r.get("last_hearing_summary", ""),
                   "hearings_by_type": {k[len("hearings_"):].upper(): int(v) for k, v in r.items()
                                        if k.startswith("hearings_") and str(v).isdigit()}},
        ))
    if len(warnings) > 50:
        warnings = warnings[:50] + [{"row": None, "message": f"…and {len(warnings) - 50} more warnings"}]
    return {"cases": cases, "errors": errors, "warnings": warnings}
