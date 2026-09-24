"""Rules, presets and guardrails (sections 6.1-6.3).

Every tunable number lives here (never hard-coded in logic). Values marked
[ASSUMPTION] are listed in SUBMISSION.md.
"""
from __future__ import annotations

import copy
from dataclasses import asdict, dataclass, field, fields
from typing import Any

from .enums import HearingType as H

PRESET_IDS = ["optimal", "sehgal", "dimakar", "joshi", "baseline"]


@dataclass
class DayTimes:
    start: str = "10:00"
    lunch_start: str = "13:30"
    lunch_end: str = "14:00"
    end: str = "17:30"


@dataclass
class Block:
    id: str
    label: str
    start: str
    end: str
    hearing_types: list[str] | None = None
    min_age_years: float | None = None
    carried_forward_only: bool = False  # Sehgal: block reserved for carried-forward matters
    color_key: str = "any"  # frontend colour band: short|evidence|old|carry|fresh|any

    @property
    def restricted(self) -> bool:
        return bool(self.hearing_types) or self.min_age_years is not None or self.carried_forward_only


@dataclass
class PriorityWeights:
    age: float = 0.35
    p_substantive: float = 0.30
    waiting: float = 0.20
    near_disposal: float = 0.15
    fresh: float = 0.0


@dataclass
class Clustering:
    by_advocate: bool = False
    purpose_days: dict[str, list[str]] | None = None  # {"MON": [types]}


@dataclass
class Agents:
    enabled: bool = False
    trait_sd: float = 0.08
    slot_bonus: float = 0.06
    notice_bonus: float = 0.04
    notice_min_days: int = 14
    cluster_bonus: float = 0.04
    fatigue_per_miss: float = 0.03
    fatigue_cap: float = 0.15
    last_chance_bonus: float = 0.05


@dataclass
class Rules:
    name: str = "Vihitha optimal"
    preset: str = "optimal"
    capacity_minutes: int = 420
    day: DayTimes = field(default_factory=DayTimes)
    fill_target: float | None = 1.0  # planned expected minutes / capacity; None = no minutes cap
    max_listed_per_day: int | None = None
    blocks: list[Block] = field(default_factory=list)
    priority_weights: PriorityWeights = field(default_factory=PriorityWeights)
    clustering: Clustering = field(default_factory=Clustering)
    ageing_quota_pct: float = 25
    max_wait_days_4y: int = 30
    carry_forward_same_weekday: bool = False
    prerequisite_check: bool = True
    next_date_mode: str = "REFERENCE"  # "REFERENCE" | "FLAT_60"
    next_date_window_factor: float = 1.5
    slots: bool = True
    require_case_summary_4y: bool = False
    summary_prep_reduction: float = 0.3  # [ASSUMPTION]
    settlement_prob: float = 0.02  # [ASSUMPTION] per reached hearing
    duration_sigma: float = 0.35  # [ASSUMPTION]
    adjourn_call_minutes: float = 3  # [ASSUMPTION]
    learning: bool = False
    # v3.1: share each day across SHORT / TRIAL / FINAL hearings in proportion to the backlog,
    # and order a day short calls -> trial -> final inside unrestricted blocks. [ASSUMPTION]
    mix_by_group: bool = True
    order_by_group: bool = True
    agents: Agents = field(default_factory=Agents)
    # Engine tunables beyond the v2 RulesBody (documented as assumptions):
    window_minutes: int | None = None  # slot window size; None = use the court setting (default 30) [ASSUMPTION]
    ageing_reserve_release_days: int = 7  # [ASSUMPTION] unused ageing reserve opens to others this close to the day
    carry_forward_boost: float = 0.5
    flat_gap_days: int = 60

    @property
    def is_baseline(self) -> bool:
        return self.preset == "baseline"

    @property
    def budget_minutes(self) -> float | None:
        return None if self.fill_target is None else self.capacity_minutes * self.fill_target

    def to_dict(self) -> dict:
        return asdict(self)

    def copy(self) -> "Rules":
        return copy.deepcopy(self)


def _build(cls, data: dict | None):
    if data is None:
        return cls()
    names = {f.name for f in fields(cls)}
    return cls(**{k: v for k, v in data.items() if k in names})


def _block(data: dict) -> Block:
    d = dict(data)
    if "carried_forward" in d and "carried_forward_only" not in d:  # v2 name
        d["carried_forward_only"] = d.pop("carried_forward")
    return _build(Block, d)


def rules_from_dict(data: dict[str, Any]) -> Rules:
    d = dict(data)
    base = Rules()
    kw: dict[str, Any] = {}
    for f in fields(Rules):
        if f.name not in d:
            continue
        v = d[f.name]
        if f.name == "day":
            v = _build(DayTimes, v)
        elif f.name == "blocks":
            v = [b if isinstance(b, Block) else _block(b) for b in (v or [])]
        elif f.name == "priority_weights":
            v = _build(PriorityWeights, v)
        elif f.name == "clustering":
            v = _build(Clustering, v)
        elif f.name == "agents":
            v = _build(Agents, v)
        kw[f.name] = v
    r = Rules(**{**{f.name: getattr(base, f.name) for f in fields(Rules)}, **kw})
    if not r.blocks:
        r.blocks = whole_day_block(r.day)
    return r


# ---------------------------------------------------------------- presets

SHORT = [H.ADMISSION, H.COGNIZANCE, H.APPEARANCE, H.WARRANT, H.REPORTS, H.APPLICATION_REVIEW,
         H.BAIL, H.DELAY_CONDONATION_HEARING]
EVIDENCE_PLEA = [H.PLEA, H.EXAMINATION_UNDER_S351_BNSS, H.EVIDENCE_COMPLAINANT, H.EVIDENCE_ACCUSED]
FINAL = [H.ARGUMENTS, H.JUDGEMENT]


def _v(types) -> list[str]:
    return [t.value for t in types]


def whole_day_block(day: DayTimes) -> list[Block]:
    return [Block(id="all", label="Full day", start=day.start, end=day.end, color_key="any")]


def _optimal() -> Rules:
    return Rules(
        name="Vihitha optimal",
        preset="optimal",
        # No reserved time bands: one continuous list, short calls first, then trial, then final.
        blocks=whole_day_block(DayTimes()),
        priority_weights=PriorityWeights(age=0.35, p_substantive=0.30, waiting=0.20, near_disposal=0.15, fresh=0.0),
        clustering=Clustering(by_advocate=True),
        ageing_quota_pct=30,
        prerequisite_check=True,
        next_date_mode="REFERENCE",
        slots=True,
        fill_target=0.92,  # [ASSUMPTION] ~8% buffer: days end on time, ~96% of listed matters reached
        learning=True,
    )


def _sehgal() -> Rules:
    return Rules(
        name="Justice Sehgal (block scheduler)",
        preset="sehgal",
        carry_forward_same_weekday=True,
        blocks=[
            Block("carried", "Carried-forward matters", "10:00", "11:00", carried_forward_only=True, color_key="carry"),
            Block("fresh", "Fresh & notice matters", "11:00", "13:30",
                  _v([H.ADMISSION, H.DELAY_CONDONATION_HEARING, H.COGNIZANCE, H.APPEARANCE, H.WARRANT, H.BAIL]),
                  color_key="fresh"),
            Block("oldest", "Oldest matters", "14:00", "17:30", min_age_years=4, color_key="old"),
        ],
        priority_weights=PriorityWeights(age=0.5, p_substantive=0.2, waiting=0.3, near_disposal=0.0, fresh=0.0),
        ageing_quota_pct=40,
        next_date_mode="REFERENCE",
        slots=True,
    )


def _dimakar() -> Rules:
    early = _v([H.APPEARANCE, H.WARRANT, H.ADMISSION, H.COGNIZANCE, H.DELAY_CONDONATION_HEARING])
    middle = _v([H.EVIDENCE_COMPLAINANT, H.EVIDENCE_ACCUSED, H.PLEA, H.EXAMINATION_UNDER_S351_BNSS])
    final = _v(FINAL)
    return Rules(
        name="Justice Dimakar (clusterer)",
        preset="dimakar",
        blocks=[
            Block("morning", "Morning list", "10:00", "13:30"),
            Block("afternoon", "Afternoon list", "14:00", "17:30"),
        ],
        clustering=Clustering(
            by_advocate=True,
            purpose_days={"MON": early, "TUE": early, "WED": middle, "THU": middle, "FRI": final},
        ),
        ageing_quota_pct=40,
        require_case_summary_4y=True,
        priority_weights=PriorityWeights(age=0.5, p_substantive=0.25, waiting=0.15, near_disposal=0.10, fresh=0.0),
        next_date_mode="REFERENCE",
        slots=True,
    )


def _joshi() -> Rules:
    return Rules(
        name="Justice Joshi (new matters first)",
        preset="joshi",
        blocks=[
            Block("fresh", "New matters", "10:00", "13:30",
                  _v([H.ADMISSION, H.DELAY_CONDONATION_HEARING, H.COGNIZANCE, H.APPEARANCE, H.WARRANT]),
                  color_key="fresh"),
            Block("rest", "Other matters", "14:00", "17:30"),
        ],
        priority_weights=PriorityWeights(age=0.1, p_substantive=0.3, waiting=0.0, near_disposal=0.0, fresh=0.6),
        ageing_quota_pct=0,
        next_date_mode="REFERENCE",
        slots=True,
    )


def _baseline() -> Rules:
    day = DayTimes()
    return Rules(
        name="Case-study baseline",
        preset="baseline",
        fill_target=None,
        max_listed_per_day=60,
        blocks=whole_day_block(day),
        priority_weights=PriorityWeights(age=0, p_substantive=0, waiting=0, near_disposal=0, fresh=0),
        clustering=Clustering(by_advocate=False),
        ageing_quota_pct=0,
        max_wait_days_4y=10_000,
        prerequisite_check=False,
        next_date_mode="FLAT_60",
        slots=False,
        learning=False,
        agents=Agents(enabled=False, slot_bonus=0, notice_bonus=0, cluster_bonus=0),
    )


_PRESETS = {"optimal": _optimal, "sehgal": _sehgal, "dimakar": _dimakar, "joshi": _joshi, "baseline": _baseline}

PRESET_DESCRIPTIONS = {
    "optimal": "Vihitha's recommended rules: no fixed time bands; every day is a mix of short matters, trial and final hearings (short calls first), oldest and most-likely-to-proceed first, advocate clustering, reference next dates.",
    "sehgal": "Fixed blocks: carried-forward matters first, fresh and notice matters mid-morning, oldest matters after lunch.",
    "dimakar": "Clusters by advocate and fixes purpose days (appearance early week, evidence mid-week, arguments Friday).",
    "joshi": "New matters first. Clamped by the ageing guardrails.",
    "baseline": "The case study's current practice: 60 listed per day, heard in list order, flat 60-day next date.",
}


def preset(name: str, agents: bool | None = None) -> Rules:
    """A fresh copy of a preset (before guardrails)."""
    if name not in _PRESETS:
        raise KeyError(f"Unknown preset '{name}'. Choose from: {', '.join(PRESET_IDS)}")
    r = _PRESETS[name]()
    if agents is not None:
        r.agents.enabled = agents
    return r


# ---------------------------------------------------------------- guardrails

AGEING_QUOTA_MIN = 25
AGE_WEIGHT_MIN = 0.2
MAX_WAIT_4Y_MAX = 30


def validate(rules: Rules) -> tuple[Rules, list[dict]]:
    """Clamp locked guardrails (never reject). Baseline is exempt: it is the reference, not a judge setting."""
    r = rules.copy()
    warnings: list[dict] = []
    if r.is_baseline:
        return r, warnings
    if r.ageing_quota_pct < AGEING_QUOTA_MIN:
        warnings.append(_warn("ageing_quota_pct", r.ageing_quota_pct, AGEING_QUOTA_MIN,
                              "Ageing cases can never be deprioritised below the minimum quota."))
        r.ageing_quota_pct = AGEING_QUOTA_MIN
    if r.priority_weights.age < AGE_WEIGHT_MIN:
        warnings.append(_warn("priority_weights.age", r.priority_weights.age, AGE_WEIGHT_MIN,
                              "Case age always carries at least this much weight in the priority."))
        r.priority_weights.age = AGE_WEIGHT_MIN
    if r.max_wait_days_4y > MAX_WAIT_4Y_MAX:
        warnings.append(_warn("max_wait_days_4y", r.max_wait_days_4y, MAX_WAIT_4Y_MAX,
                              "A 4+ year case must be listed at least once every 30 days."))
        r.max_wait_days_4y = MAX_WAIT_4Y_MAX
    if r.fill_target is not None and r.fill_target <= 0:
        warnings.append(_warn("fill_target", r.fill_target, 1.0, "Fill target must be positive."))
        r.fill_target = 1.0
    if not r.blocks:
        r.blocks = whole_day_block(r.day)
    return r, warnings


def _warn(field_name: str, requested, applied, message: str) -> dict:
    return {"field": field_name, "requested": requested, "applied": applied, "message": message}


def resolve(preset_name: str | None = None, rules: Rules | dict | None = None,
            agents: bool | None = None) -> tuple[Rules, list[dict]]:
    """Preset or custom rules -> validated rules + warnings."""
    if rules is not None:
        r = rules if isinstance(rules, Rules) else rules_from_dict(rules)
        if agents is not None:
            r = r.copy()
            r.agents.enabled = agents
    else:
        r = preset(preset_name or "optimal", agents)
    return validate(r)
