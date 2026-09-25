"""The docket from the organisers' roster: roster_sample_100.csv, 3,000 cases from their own
scripts/generate_roster.py (seed 42), imported and called rather than run, so no file is written, or our
synthetic roster (planner/synth.py) read from $SYNTH_ROSTER, written with its defaults if missing.

Existing next dates are ignored (the brief allows it): every case is available from the start day.
"""
from __future__ import annotations

import importlib.util
import os
import re
from dataclasses import dataclass, field
from datetime import date
from functools import lru_cache
from pathlib import Path

import pandas as pd

from .reference import PROVIDED_DIR, code

ROSTERS = {"3000": "3,000 cases (organisers' generate_roster.py, seed 42)", "100": "100 cases (roster_sample_100.csv)",
           "synth": "Synthetic (python -m planner.synth)"}
BASE = PROVIDED_DIR / "data" / "roster_sample_100.csv"
# Summary text that suggests process (warrant, summons, notice) is still out. Information only, not a gate.
PROCESS = re.compile(r"\bawait|return of (warrant|summons)|issue (nbw|warrant|summons|notice)|take steps|\bnotice\b",
                     re.IGNORECASE)
AGE_POINTS = [(1, 0), (3, 1), (4, 2), (5, 3)]  # (upper bound in years, points); 5y+ = 5


@dataclass(frozen=True)
class PCase:
    number: str
    filing_number: str
    filing_date: date
    advocate: str
    party: str
    stage: str
    purpose: str
    summary: str
    hearings: dict[str, int] = field(hash=False)
    total_hearings: int = 0

    @property
    def hearings_at_stage(self) -> int:
        return self.hearings.get(self.stage, 0)

    @property
    def awaiting_disposal(self) -> bool:
        """Summary records a conviction and sentence, yet the case is still pending: excluded."""
        s = self.summary.lower()
        return "convicted" in s and "sentenced" in s

    @property
    def process_hint(self) -> bool:
        return bool(PROCESS.search(self.summary))

    def age_years(self, on: date) -> float:
        return (on - self.filing_date).days / 365.25

    def age_points(self, on: date) -> int:
        a = self.age_years(on)
        return next((p for bound, p in AGE_POINTS if a < bound), 5)

    def age_bucket(self, on: date) -> str:
        a = self.age_years(on)
        return "<1y" if a < 1 else "1-3y" if a < 3 else "3-4y" if a < 4 else "4-5y" if a < 5 else "5y+"


def _generate(n: int, seed: int) -> pd.DataFrame:
    spec = importlib.util.spec_from_file_location("generate_roster", PROVIDED_DIR / "scripts" / "generate_roster.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.generate(n, seed, str(BASE))


def synth_csv() -> Path:
    return Path(os.environ.get("SYNTH_ROSTER", "data/roster_synthetic.csv"))


def frame(kind: str) -> pd.DataFrame:
    if kind == "100":
        return pd.read_csv(BASE, parse_dates=["filing_date"])
    if kind == "3000":
        return _generate(3000, 42)
    if kind == "synth":
        path = synth_csv()
        if not path.exists():
            from .synth import generate
            path.parent.mkdir(parents=True, exist_ok=True)
            generate().to_csv(path, index=False, date_format="%Y-%m-%d")
        return pd.read_csv(path, parse_dates=["filing_date"])
    raise ValueError(f"unknown roster {kind!r}")


def version(kind: str) -> float:
    """Changes when the roster's source does: the synthetic CSV's mtime (0 until written, or for the others)."""
    if kind == "synth" and synth_csv().exists():
        return synth_csv().stat().st_mtime
    return 0.0


def load_roster(kind: str = "3000") -> tuple[PCase, ...]:
    return _load(kind, version(kind))


@lru_cache(maxsize=4)
def _load(kind: str, _version: float) -> tuple[PCase, ...]:
    df = frame(kind)
    counts = [c for c in df.columns if c.startswith("hearings_")]
    return tuple(PCase(
        number=r["case_number"], filing_number=r["filing_number"], filing_date=r["filing_date"].date(),
        advocate=r["advocate_id"], party=r["party_id"], stage=code(r["current_stage"]),
        purpose=code(r["purpose_of_next_hearing"]), summary=str(r["last_hearing_summary"] or ""),
        hearings={c.removeprefix("hearings_").upper(): int(r[c]) for c in counts},
        total_hearings=int(r["total_hearings_held"]),
    ) for r in df.to_dict("records"))
