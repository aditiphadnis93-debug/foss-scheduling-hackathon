"""Roster normalisation and generation (sections 2.1-2.2)."""
from __future__ import annotations

from datetime import date

import numpy as np
import pandas as pd

from .enums import SEQUENTIAL, STAGE_INDEX, HearingType, age_bucket, normalise_type, roster_column
from .models import RosterCase
from .parser import parse_summary


def generate(num_cases: int, seed: int, base: pd.DataFrame) -> pd.DataFrame:
    """Bootstrap-resample whole rows and mint fresh IDs.

    Logic copied from the repo's scripts/generate_roster.py (not modified there).
    Generated cases are "more of the same mix", not independently simulated cases.
    """
    rng = np.random.default_rng(seed)
    base = base.copy()
    base["filing_date"] = pd.to_datetime(base["filing_date"])

    picks = rng.integers(0, len(base), size=num_cases)
    out = base.iloc[picks].reset_index(drop=True).copy()

    years = out["filing_date"].dt.year.astype(str)
    out["case_number"] = [f"ST/{i + 1}/{y}" for i, y in enumerate(years)]
    out["filing_number"] = [f"KL-{i + 1:06d}-{y}" for i, y in enumerate(years)]
    out["party_id"] = [f"PARTY-{i + 1:05d}" for i in range(num_cases)]

    cases_per_advocate = len(base) / base["advocate_id"].nunique()
    n_advocates = max(1, round(num_cases / cases_per_advocate))
    out["advocate_id"] = [f"ADV-{a:03d}" for a in rng.integers(1, n_advocates + 1, size=num_cases)]

    out = out.sort_values("filing_date").reset_index(drop=True)
    out["filing_date"] = out["filing_date"].dt.strftime("%Y-%m-%d")
    return out


def _stage(value) -> HearingType:
    h = normalise_type(value)
    if h not in STAGE_INDEX:  # interrupt type as current stage: fall back to admission
        return HearingType.ADMISSION
    return h


def normalise(df: pd.DataFrame) -> list[RosterCase]:
    """DataFrame (roster columns) -> RosterCase list. Existing next dates are ignored by design."""
    cases: list[RosterCase] = []
    seen: set[str] = set()
    for i, r in enumerate(df.to_dict("records")):
        fn = str(r["filing_number"]).strip()
        if fn in seen:
            raise ValueError(f"Duplicate filing_number {fn}")
        seen.add(fn)
        counts = {}
        for h in HearingType:
            v = r.get(roster_column(h), 0)
            counts[h] = int(v) if pd.notna(v) else 0
        stage = _stage(r["current_stage"])
        try:
            purpose = normalise_type(r["purpose_of_next_hearing"])
        except ValueError:
            purpose = stage
        total = r.get("total_hearings_held")
        cases.append(
            RosterCase(
                case_number=str(r["case_number"]).strip(),
                filing_number=fn,
                filing_date=pd.Timestamp(r["filing_date"]).date(),
                advocate_id=str(r["advocate_id"]).strip(),
                party_id=str(r["party_id"]).strip(),
                stage=stage,
                next_purpose=purpose,
                hearing_counts=counts,
                total_hearings=int(total) if pd.notna(total) else sum(counts.values()),
                last_hearing_summary=str(r.get("last_hearing_summary") or ""),
                parsed=parse_summary(r.get("last_hearing_summary")),
                order=i,
            )
        )
    return cases


def summary(cases: list[RosterCase], on: date) -> dict:
    """RosterSummary numbers (section 9.2)."""
    n = len(cases)
    ages = [(on - c.filing_date).days / 365.25 for c in cases]
    by_stage = {h.value: 0 for h in SEQUENTIAL}
    for c in cases:
        by_stage[c.stage.value] += 1
    buckets = {b: 0 for b in ["0-1", "1-3", "3-4", "4-5", "5+"]}
    for a in ages:
        buckets[age_bucket(a)] += 1
    return {
        "cases": n,
        "advocates": len({c.advocate_id for c in cases}),
        "parties": len({c.party_id for c in cases}),
        "pct_4y_plus": round(100 * sum(a >= 4 for a in ages) / n, 1) if n else 0.0,
        "pct_5y_plus": round(100 * sum(a >= 5 for a in ages) / n, 1) if n else 0.0,
        "by_stage": [{"stage": k, "count": v} for k, v in by_stage.items()],
        "by_bucket": [{"bucket": k, "count": v} for k, v in buckets.items()],
    }
