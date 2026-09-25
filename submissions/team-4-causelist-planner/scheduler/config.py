"""Judge config loading. Locked rules live here and are clamped, never configurable."""
from __future__ import annotations

from datetime import date, time
from pathlib import Path

import yaml

from .models import Block, JudgeConfig

# Locked rules (see docs/L1-scheduling-algorithm.md §5)
AGE_QUOTA = 0.30  # min share of a day's expected-minute budget reserved for 4y+ cases
AGE_QUOTA_MIN_YEARS = 4.0
W_AGE_FLOOR = 3.0
STARVATION_K = 3  # near-miss skips before a case is forced in
FORCED_SHARE = 0.20  # max share of the day forced cases may take
LISTING_FACTOR_MAX = 1.3

DEFAULT_WEIGHTS = {
    "age": 5.0,
    "purpose": 2.0,
    "overdue": 0.1,
    "urgent": 20.0,
    "adjournments": 1.0,
    "fresh": 0.0,
}

PRESETS_DIR = Path(__file__).resolve().parent.parent / "presets"


def _time(s: str) -> time:
    h, m = s.split(":")
    return time(int(h), int(m))


def from_dict(d: dict) -> JudgeConfig:
    clamped: list[str] = []
    weights = {**DEFAULT_WEIGHTS, **(d.get("weights") or {})}
    if weights["age"] < W_AGE_FLOOR:
        clamped.append(f"weights.age {weights['age']} raised to locked floor {W_AGE_FLOOR}")
        weights["age"] = W_AGE_FLOOR
    factor = float(d.get("listing_factor", 1.0))
    if factor > LISTING_FACTOR_MAX:
        clamped.append(f"listing_factor {factor} capped at locked ceiling {LISTING_FACTOR_MAX}")
        factor = LISTING_FACTOR_MAX

    blocks = [
        Block(
            name=b["name"],
            start=_time(b["start"]),
            end=_time(b["end"]),
            purposes=tuple(b["purposes"]),
            weekdays=tuple(b.get("weekdays", [0, 1, 2, 3, 4])),
            sort_by=b.get("sort_by", "score"),
        )
        for b in d["blocks"]
    ]
    return JudgeConfig(
        name=d["name"],
        blocks=blocks,
        max_cases_per_day=int(d.get("max_cases_per_day", 60)),
        listing_factor=factor,
        clustering=bool(d.get("clustering", False)),
        rollover=bool(d.get("rollover", False)),
        case_types=tuple(d["case_types"]) if d.get("case_types") else None,
        weights=weights,
        leave=tuple(date.fromisoformat(str(x)) for x in d.get("leave", [])),
        courtroom=str(d.get("courtroom", "Court 1")),
        cover_page_for=tuple(d.get("cover_page_for", [])),
        style=str(d.get("style") or "").strip(),
        clamped=clamped,
    )


def load_preset(name: str) -> JudgeConfig:
    return from_dict(yaml.safe_load((PRESETS_DIR / f"{name}.yaml").read_text()))


def list_presets() -> list[str]:
    return sorted(p.stem for p in PRESETS_DIR.glob("*.yaml"))
