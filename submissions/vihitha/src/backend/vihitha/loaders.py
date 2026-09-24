"""Read the organisers' data files (section 2). The only engine module that touches disk for inputs."""
from __future__ import annotations

import os
from pathlib import Path

import pandas as pd

ROSTER_FILE = "roster_sample_100.csv"
CALENDAR_FILE = "court_calendar.csv"
REFERENCE_FILE = "hearing_type_reference.csv"
SUBSTANTIVENESS_FILE = "substantiveness_by_hearing_type.csv"
FAILURES_FILE = "hearing_failure_reasons.csv"
CAUSELIST_FILE = "sample_causelist_2026-09-22.csv"

ROSTER_COLUMNS = [
    "case_number", "filing_number", "filing_date", "advocate_id", "party_id", "current_stage",
    "last_hearing_summary", "purpose_of_next_hearing", "hearings_admission",
    "hearings_delay_condonation_hearing", "hearings_cognizance", "hearings_appearance",
    "hearings_warrant", "hearings_plea", "hearings_examination_under_s351_bnss",
    "hearings_evidence_complainant", "hearings_evidence_accused", "hearings_arguments",
    "hearings_judgement", "hearings_bail", "hearings_reports", "hearings_application_review",
    "total_hearings_held",
]

_BACKEND_DIR = Path(__file__).resolve().parent.parent


def default_data_dir() -> Path:
    """VIHITHA_DATA_DIR, else the repo's data/ folder (walking up from submissions/<team>/src/backend)."""
    env = os.environ.get("VIHITHA_DATA_DIR")
    if env:
        return Path(env)
    candidates = [p / "data" for p in _BACKEND_DIR.parents]
    for c in candidates:
        if (c / CALENDAR_FILE).exists():
            return c
    return _BACKEND_DIR.parents[2] / "data"  # submissions/<team>/src/backend -> repo/data


def _dir(data_dir: str | Path | None) -> Path:
    return Path(data_dir) if data_dir else default_data_dir()


def missing_roster_columns(columns) -> list[str]:
    have = set(columns)
    return [c for c in ROSTER_COLUMNS if c not in have]


def read_roster(path: str | Path) -> pd.DataFrame:
    df = pd.read_csv(path, dtype={"case_number": str, "filing_number": str})
    missing = missing_roster_columns(df.columns)
    if missing:
        raise ValueError(f"Roster is missing columns: {', '.join(missing)}")
    return df


def load_sample_roster(data_dir=None) -> pd.DataFrame:
    return read_roster(_dir(data_dir) / ROSTER_FILE)


def load_calendar(data_dir=None) -> pd.DataFrame:
    return pd.read_csv(_dir(data_dir) / CALENDAR_FILE, keep_default_na=False)


def load_reference_tables(data_dir=None) -> dict[str, pd.DataFrame]:
    d = _dir(data_dir)
    return {
        "reference": pd.read_csv(d / REFERENCE_FILE),
        "substantiveness": pd.read_csv(d / SUBSTANTIVENESS_FILE),
        "failures": pd.read_csv(d / FAILURES_FILE),
    }


def sample_roster_path(data_dir=None) -> Path:
    return _dir(data_dir) / ROSTER_FILE
