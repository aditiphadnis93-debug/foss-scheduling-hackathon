"""World-model settings. Defaults mirror ``config/world.yaml``; every rate is a stated assumption."""
from __future__ import annotations

from dataclasses import dataclass, field, fields
from pathlib import Path
from typing import Any

import yaml

from ..reference import load_calendar
from .funnel import DAYS_PER_YEAR, Funnel, parse_funnel

WORLD_CONFIG_PATH = Path(__file__).resolve().parents[3] / "config" / "world.yaml"


@dataclass
class WorldConfig:
    population: int = 600
    household_size: list[int] = field(default_factory=lambda: [1, 6])
    businesses: int = 40
    advocates: int = 24

    warmup_days: int = 60

    notice_delay_days: list[int] = field(default_factory=lambda: [3, 25])
    notice_period_days: int = 15
    file_delay_days: list[int] = field(default_factory=lambda: [1, 25])

    wage_fraction_waiting: float = 1.0
    wage_fraction_heard: float = 0.6
    frustration_adjourned: float = 0.15
    frustration_not_reached: float = 0.20
    frustration_not_ready: float = 0.10
    frustration_relief_heard: float = 0.05
    p_settle_per_frustration: float = 0.03
    compromise_share: float = 0.7
    p_conviction: float = 0.65

    adopt_roster: bool = True
    history_events: int = 30

    funnel: Funnel = field(default_factory=lambda: parse_funnel(None))

    def expected_filings_per_sitting_day(self) -> float:
        return self.funnel.court_filings_per_year() / sitting_days_per_year()


def sitting_days_per_year() -> float:
    """Derived from the court calendar in ``data/``: working share of days x 365."""
    try:
        cal = load_calendar()
        return DAYS_PER_YEAR * sum(d.is_working for d in cal) / max(1, len(cal))
    except (OSError, KeyError):
        return 250.0


def load_world_config(source: str | Path | dict[str, Any] | WorldConfig | None = None) -> WorldConfig:
    """Load from a dict, a YAML path, an existing config, or the default ``config/world.yaml``."""
    if isinstance(source, WorldConfig):
        return source
    if isinstance(source, dict):
        raw = dict(source)
    else:
        path = Path(source) if source else WORLD_CONFIG_PATH
        raw = yaml.safe_load(path.read_text()) if path.exists() else {}
        raw = raw or {}
    known = {f.name for f in fields(WorldConfig)}
    unknown = set(raw) - known
    if unknown:
        raise ValueError(f"unknown world config keys: {sorted(unknown)}")
    raw["funnel"] = parse_funnel(raw.get("funnel") or _default_funnel_raw())
    return WorldConfig(**raw)


def _default_funnel_raw() -> dict[str, Any] | None:
    if WORLD_CONFIG_PATH.exists():
        return (yaml.safe_load(WORLD_CONFIG_PATH.read_text()) or {}).get("funnel")
    return None
