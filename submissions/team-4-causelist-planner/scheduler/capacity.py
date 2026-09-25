"""Stage 3: capacity in expected minutes. p_heard and duration are the L2 swap points."""
from __future__ import annotations

from .data import HEARING_TYPES
from .models import Block, Case, JudgeConfig


def p_heard(case: Case) -> float:
    return HEARING_TYPES[case.purpose].p_heard


def duration(case: Case) -> float:
    return HEARING_TYPES[case.purpose].est_minutes


def expected_cost(case: Case) -> float:
    return duration(case) * p_heard(case)


def block_budget(block: Block, cfg: JudgeConfig) -> float:
    return block.minutes * cfg.listing_factor
