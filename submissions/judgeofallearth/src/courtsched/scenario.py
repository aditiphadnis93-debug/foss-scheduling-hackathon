"""Scenario: every assumption about the world, in one named, swappable place."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import date


@dataclass(frozen=True)
class Scenario:
    name: str = "default"
    start: date = date(2026, 10, 1)  # posting window: ~2.5 months (brief)
    end: date = date(2026, 12, 15)
    leave: tuple[date, ...] = ()  # judge's personal leave
    minutes_per_day: int = 420  # the brief's 7-hour day
    adjourn_minutes: float = 2.0  # time a non-substantive hearing takes (our assumption)
    duration_cv: float = 0.0  # 0 = fixed table durations; >0 = lognormal spread
    advance_rule: str = "matched"  # "matched" (two dice, calibrated) | "literal"
    process_tracking: bool = True  # does the planner know whether process has returned?
    process_return_mean_days: float = 21.0  # our assumption; Warrant's published gap
    # Preparation ramp: P(substantive) is scaled from ramp_floor (listed the day after) up to 1
    # (listed at or after the published gap). ramp_floor=1 switches the effect off.
    ramp_floor: float = 0.2
    # Case heterogeneity (varied cases): each case has a hidden reliability offset on the log-odds of a
    # substantive hearing, with this standard deviation. history_signal is how strongly it
    # correlates with the case's past hearings-per-stage (from the roster). 0 = identical cases.
    case_heterogeneity: float = 0.8
    history_signal: float = 0.6
    roster_size: int = 3000
    advocates: str = "uniform"  # "uniform" (organisers' generator) | "lopsided" (ours)

    def describe(self) -> dict:
        return {k: (str(v) if isinstance(v, date) else v) for k, v in asdict(self).items()}

    def ramp(self, days_since_last: int | None, gap_days: int) -> float:
        if days_since_last is None or gap_days <= 0:
            return 1.0
        return self.ramp_floor + (1 - self.ramp_floor) * min(1.0, days_since_last / gap_days)
