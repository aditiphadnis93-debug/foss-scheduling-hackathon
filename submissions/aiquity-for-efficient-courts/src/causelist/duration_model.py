"""How long a hearing takes depends on who is hearing it and how fresh the file is, not only
on its type and stage.

    minutes = reference_minutes(type) × judge_factor(judge, type) × recency_factor(days since last hearing, case age)

* **Judge background.** A judge from the criminal bar knows the trial stages cold; one from the
  civil bar or the judicial service is slower on them at first. Background factors apply per stage.
* **Judge experience.** New benches are slower. The penalty decays with years on the bench:
  ``1 + NEW_BENCH_PENALTY · exp(−years / EXPERIENCE_HALF_LIFE_Y)``.
* **Recency.** A matter heard two days ago needs less time, because the facts are in everyone's head:
  ``1 − RECENT_DISCOUNT · exp(−days / RECENT_DECAY_D)``. A file untouched for many months needs
  re-reading, and an old case even more: ``+ STALE_PENALTY`` (more for 4+ year cases).
  This is the effect the case study describes ("re-reading an old file every twenty minutes exhausts a bench").

All constants are stated assumptions; replace them with the court's timestamps when available.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import date

TRIAL_STAGES = {"PLEA", "EXAMINATION_UNDER_S351_BNSS", "EVIDENCE_COMPLAINANT", "EVIDENCE_ACCUSED", "ARGUMENTS", "JUDGEMENT"}
PRE_TRIAL = {"ADMISSION", "DELAY_CONDONATION_HEARING", "COGNIZANCE", "APPEARANCE", "WARRANT", "BAIL"}

# background -> {stage group: factor}
BACKGROUND_FACTORS = {
    "criminal_bar":      {"trial": 0.85, "pre_trial": 0.95, "other": 1.00},
    "civil_bar":         {"trial": 1.10, "pre_trial": 1.00, "other": 0.95},
    "judicial_service":  {"trial": 1.00, "pre_trial": 0.90, "other": 1.00},   # career judges: procedure is routine
    "academic":          {"trial": 1.10, "pre_trial": 1.05, "other": 1.00},
}
NEW_BENCH_PENALTY = 0.20        # a brand-new judge takes ~20% longer
EXPERIENCE_HALF_LIFE_Y = 2.0    # ...decaying with years on the bench
RECENT_DISCOUNT = 0.25          # heard yesterday: up to ~25% faster
RECENT_DECAY_D = 6.0            # ...fading over about a week
STALE_AFTER_D = 120             # untouched this long -> re-reading needed
STALE_PENALTY = 0.10            # +10%
STALE_PENALTY_OLD_CASE = 0.20   # +20% when the case is 4+ years old
BOUNDS = (0.6, 1.6)


@dataclass
class JudgeProfile:
    background: str = "judicial_service"
    years_on_bench: float = 5.0
    specialisations: list[str] = field(default_factory=list)   # hearing types the judge is especially quick at (×0.9)


def _group(purpose: str) -> str:
    if purpose in TRIAL_STAGES:
        return "trial"
    if purpose in PRE_TRIAL:
        return "pre_trial"
    return "other"


def judge_factor(judge: JudgeProfile | None, purpose: str) -> float:
    if judge is None:
        return 1.0
    f = BACKGROUND_FACTORS.get(judge.background, BACKGROUND_FACTORS["judicial_service"])[_group(purpose)]
    f *= 1 + NEW_BENCH_PENALTY * math.exp(-max(0.0, judge.years_on_bench) / EXPERIENCE_HALF_LIFE_Y)
    if purpose in judge.specialisations:
        f *= 0.9
    return f


def recency_factor(last_heard_on: date | None, today: date, case_age_years: float) -> float:
    if last_heard_on is None:
        return 1.0 + (STALE_PENALTY_OLD_CASE if case_age_years >= 4 else 0.0) * 0.5
    days = max(0, (today - last_heard_on).days)
    f = 1 - RECENT_DISCOUNT * math.exp(-days / RECENT_DECAY_D)
    if days >= STALE_AFTER_D:
        f += STALE_PENALTY_OLD_CASE if case_age_years >= 4 else STALE_PENALTY
    return f


def duration_multiplier(judge: JudgeProfile | None, purpose: str, last_heard_on: date | None,
                        today: date, case_age_years: float) -> float:
    """Multiplier on the reference minutes for this hearing, bounded to BOUNDS."""
    m = judge_factor(judge, purpose) * recency_factor(last_heard_on, today, case_age_years)
    return min(BOUNDS[1], max(BOUNDS[0], m))


def judge_from_config(cfg) -> JudgeProfile | None:
    raw = getattr(cfg, "judge", None)
    if not raw:
        return None
    if isinstance(raw, JudgeProfile):
        return raw
    return JudgeProfile(**raw)
