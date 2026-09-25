"""Stage 6: next-date rule. Ideal gap per purpose, snapped to a day with room.

Bookings are tracked in a Ledger so future days are never overbooked. Young cases
may only book up to (1 − AGE_QUOTA) of a block, leaving room for the locked quota.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta

from . import config as locked
from .capacity import block_budget, expected_cost
from .data import HEARING_TYPES, is_sitting_day
from .models import Block, Case, JudgeConfig

SEARCH_DAYS = 120
ADVOCATE_WINDOW = 3  # days either side of target to look for the advocate's other matters


class Ledger:
    def __init__(self) -> None:
        self.minutes: dict[tuple[date, str], float] = defaultdict(float)
        self.count: dict[date, int] = defaultdict(int)
        self.advocate_days: dict[str, set[date]] = defaultdict(set)

    def book(self, case: Case, day: date, block: Block) -> None:
        self.minutes[(day, block.name)] += expected_cost(case)
        self.count[day] += 1
        for a in case.advocate_ids:
            self.advocate_days[a].add(day)


def _free_block(case: Case, day: date, cfg: JudgeConfig, ledger: Ledger) -> Block | None:
    if not is_sitting_day(day, cfg.leave) or ledger.count[day] >= cfg.max_cases_per_day:
        return None
    old = case.age_years(day) >= locked.AGE_QUOTA_MIN_YEARS
    share = 1.0 if old else 1.0 - locked.AGE_QUOTA
    for b in cfg.blocks_on(day):
        if case.purpose in b.purposes and ledger.minutes[(day, b.name)] + expected_cost(case) <= block_budget(b, cfg) * share:
            return b
    return None


GAP_BANDS = ("short", "ideal", "long")


def target_gap(purpose: str, band: str = "ideal") -> int:
    """A judge's chosen gap band in days. Never below the procedural minimum."""
    ht = HEARING_TYPES[purpose]
    gap = {"short": ht.min_gap_days, "ideal": ht.ideal_gap_days, "long": 2 * ht.ideal_gap_days}[band]
    return max(gap, ht.min_gap_days)


def recommend(case: Case, today: date, heard: bool, cfg: JudgeConfig, ledger: Ledger,
              band: str = "ideal") -> tuple[date, Block, str] | None:
    """Pick and book the next date for a case whose purpose is already updated.

    `band` is the gap an L3 judge agent asked for; the default is the table's ideal gap (L1).
    """
    ht = HEARING_TYPES[case.purpose]
    if not heard and cfg.rollover:
        d = today + timedelta(days=7)
        for _ in range(SEARCH_DAYS // 7):
            b = _free_block(case, d, cfg, ledger)
            if b:
                ledger.book(case, d, b)
                return d, b, "rollover: same weekday next week"
            d += timedelta(days=7)

    gap = target_gap(case.purpose, band)
    target = today + timedelta(days=gap)
    earliest = today + timedelta(days=ht.min_gap_days)
    why_gap = f"ideal gap {ht.ideal_gap_days}d" if band == "ideal" else f"judge chose a {band} gap ({gap}d)"

    # Prefer a day near the target where the same advocate already has matters.
    adv_days = sorted({d for a in case.advocate_ids for d in ledger.advocate_days[a]
                       if abs((d - target).days) <= ADVOCATE_WINDOW and d >= earliest},
                      key=lambda d: abs((d - target).days))
    for d in adv_days:
        b = _free_block(case, d, cfg, ledger)
        if b:
            ledger.book(case, d, b)
            return d, b, f"{why_gap}, same day as advocate's other matters"

    d = target
    for _ in range(SEARCH_DAYS):
        b = _free_block(case, d, cfg, ledger)
        if b:
            ledger.book(case, d, b)
            return d, b, f"{why_gap} for {case.purpose.replace('_', ' ')}"
        d += timedelta(days=1)
    return None  # no room in the search window: case returns to the pool
