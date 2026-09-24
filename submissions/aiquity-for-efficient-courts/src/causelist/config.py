"""Judge configuration: every scheduling preference a judge can change without code.

Some goals are deliberately NOT configurable (case study goal 6): see ``enforce_floors``.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

import yaml

CONFIG_DIR = Path(__file__).resolve().parents[2] / "config"

# --- Non-configurable floors -------------------------------------------------
MIN_AGEING_SHARE = 0.20   # hard floor: >= 20% of listed expected minutes go to 4+ year cases when any are eligible
DEFAULT_AGEING_SHARE = 0.25
OLD_CASE_YEARS = 4.0
MIN_AGE_WEIGHT = 1.0      # an old case's priority weight can never drop below neutral
# Day-profile guardrails: a judge shapes the day (sittings, lunch, administrative blocks) but
# cannot configure the court away.
MIN_WEEKLY_SITTING_MINUTES = 5 * 210   # average of at least 3.5 hours of hearings per sitting day
MIN_SITTING_DAY_MINUTES = 120          # a day the court sits is at least 2 hours of hearings
MAX_SITTING_DAY_MINUTES = 420          # and at most 7 hours
NORM_SITTING_MINUTES = 360             # reference "6-hour day" used to show a profile's cost
WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]


@dataclass
class Slot:
    name: str
    start: str                    # "10:30"
    end: str                      # "13:30"
    purposes: list[str] = field(default_factory=list)  # empty = any purpose
    min_age_years: float = 0.0    # e.g. 4.0 for an "oldest matters" block

    def minutes(self) -> tuple[int, int]:
        def m(t: str) -> int:
            h, mm = t.split(":")
            return int(h) * 60 + int(mm)
        return m(self.start), m(self.end)


@dataclass
class Weights:
    substantive: float = 1.0      # value of a hearing that moves the case forward
    age: float = 1.0              # extra value per year of case age
    wait: float = 0.5             # extra value per listing already missed (carry-over fairness)
    fresh: float = 0.0            # extra value for early-stage matters (the 'new matters first' style)
    cluster: float = 0.3          # bonus per extra case of the same advocate on the same day


@dataclass
class JudgeConfig:
    name: str = "optimal"
    planner: str = "milp"         # "milp" | "greedy" | "baseline"
    day_start: str = "10:30"
    day_minutes: int = 420        # 7 hours of judicial time
    fill_target: float = 1.0      # fraction of day_minutes to fill with *expected* court time
    max_listed: int = 60
    overbook: float = 1.0         # >1 lists beyond expected capacity (airline-style)
    risk_kappa: float = 1.0       # safety buffer: extra expected minutes booked, in standard deviations of the day's uncertainty
    slots: list[Slot] = field(default_factory=list)
    weights: Weights = field(default_factory=Weights)
    ageing_share: float | str = DEFAULT_AGEING_SHARE   # a number, or "auto" (derived from the roster's age mix)
    carry_over: str = "priority"  # "priority" | "same_weekday" | "none"
    next_date_policy: str = "procedural"   # "procedural" | "flat"
    flat_gap_days: int = 60
    use_readiness: bool = True    # skip cases whose prerequisites are known to be unmet
    readiness_visibility: float = 0.8      # share of unmet prerequisites the court can see in advance
    give_appointments: bool = True
    use_horizon: bool = True       # rolling multi-day date assignment, publishes provisional dates
    horizon_days: int = 10
    advocate_correlation: bool = True      # an absent advocate misses all their matters that day
    advocate_daily_cap: int = 6            # most matters of one advocate on one day's date plan
    # --- founder additions (design-02) ---
    reserve_minutes: int = 30      # held back every day for urgent / emergency matters
    urgent_per_day: float = 1.5    # mean urgent arrivals per sitting day (bail, stay, urgent mention)
    judge_emergency_p: float = 0.03        # P(the judge loses part of a day); tail re-planned, rolled with priority
    learning: bool = True          # online Bayesian update of attendance/readiness per advocate, party, type x stage
    gaming_share: float = 0.08     # share of advocates who seek time strategically as the case nears evidence/judgement
    gaming_response: bool = True   # flagged strategic delay -> last chance, firm short date, other side not penalised
    agency_delay_mult: float = 1.0 # multiplier on state-agency delays (process service, police, forensics)
    checklists: str = "default"    # prerequisite checklist template (config/checklists.yaml key)
    # Day profile: {"default": {"sittings": [["10:30","13:30"],["14:30","17:30"]], "admin": [["13:30","14:30"]]},
    #               "fri": {...}}. None = one sitting from day_start for day_minutes (backward compatible).
    day_profile: dict | None = None
    # Who is hearing: {"background": "criminal_bar"|"civil_bar"|"judicial_service"|"academic",
    #                  "years_on_bench": 1.5, "specialisations": ["BAIL"]}  (see duration_model.py)
    judge: dict | None = None
    # Judge-level overrides of the court's priors master list, per hearing type (see priors.py):
    # {"EVIDENCE_COMPLAINANT": {"minutes": 45}, "ARGUMENTS": {"minutes_mult": 1.2}}
    priors: dict | None = None
    leave: list[date] = field(default_factory=list)

    def enforce_floors(self) -> "JudgeConfig":
        if self.ageing_share != "auto":
            self.ageing_share = max(float(self.ageing_share), MIN_AGEING_SHARE)
        self.weights.age = max(self.weights.age, MIN_AGE_WEIGHT)
        return self


def _m(t: str) -> int:
    h, mm = str(t).split(":")
    return int(h) * 60 + int(mm)


def _profile_for(cfg: "JudgeConfig", weekday: int) -> dict:
    prof = cfg.day_profile or {}
    return prof.get(WEEKDAYS[weekday]) or prof.get("default") or {}


def sitting_windows(cfg: "JudgeConfig", day: date) -> list[tuple[int, int]]:
    """Absolute minutes-after-midnight windows in which the court hears matters on ``day``."""
    p = _profile_for(cfg, day.weekday())
    if not cfg.day_profile or not p.get("sittings"):
        start = _m(cfg.day_start)
        return [(start, start + cfg.day_minutes)]
    return [(_m(a), _m(b)) for a, b in p["sittings"]]


def admin_windows(cfg: "JudgeConfig", day: date) -> list[tuple[int, int]]:
    return [(_m(a), _m(b)) for a, b in _profile_for(cfg, day.weekday()).get("admin", [])]


def sitting_minutes(cfg: "JudgeConfig", day: date) -> int:
    """Judicial minutes available for hearings on ``day`` (before the emergency reserve)."""
    return sum(b - a for a, b in sitting_windows(cfg, day))


def profile_report(cfg: "JudgeConfig") -> dict:
    """How this judge's week is structured, against the guardrails and the 6-hour norm."""
    ref = date(2026, 9, 28)  # a Monday
    days = []
    for i in range(5):
        d = ref.fromordinal(ref.toordinal() + i)
        sit = sitting_minutes(cfg, d)
        adm = sum(b - a for a, b in admin_windows(cfg, d))
        days.append({"weekday": WEEKDAYS[i], "sitting_minutes": sit, "admin_minutes": adm,
                     "sittings": sitting_windows(cfg, d), "admin": admin_windows(cfg, d)})
    weekly = sum(x["sitting_minutes"] for x in days)
    return {"days": days, "weekly_sitting_minutes": weekly,
            "vs_norm_pct": round(100 * weekly / (5 * NORM_SITTING_MINUTES), 1),
            "guardrails": {"min_weekly": MIN_WEEKLY_SITTING_MINUTES, "min_day": MIN_SITTING_DAY_MINUTES,
                           "max_day": MAX_SITTING_DAY_MINUTES}}


def check_day_profile(cfg: "JudgeConfig") -> list[str]:
    """Guardrail violations (empty = valid). Baseline is exempt (it models today's practice)."""
    if not cfg.day_profile:
        return []
    rep = profile_report(cfg)
    errs = []
    for d in rep["days"]:
        windows = sorted(d["sittings"])
        if any(b <= a for a, b in windows) or any(windows[i][1] > windows[i + 1][0] for i in range(len(windows) - 1)):
            errs.append(f"{d['weekday']}: sittings overlap or end before they start")
        if not (MIN_SITTING_DAY_MINUTES <= d["sitting_minutes"] <= MAX_SITTING_DAY_MINUTES):
            errs.append(f"{d['weekday']}: {d['sitting_minutes']} sitting minutes (allowed "
                        f"{MIN_SITTING_DAY_MINUTES}-{MAX_SITTING_DAY_MINUTES})")
    if rep["weekly_sitting_minutes"] < MIN_WEEKLY_SITTING_MINUTES:
        errs.append(f"week: {rep['weekly_sitting_minutes']} sitting minutes < minimum {MIN_WEEKLY_SITTING_MINUTES}")
    return errs


def load_config(name_or_path: str) -> JudgeConfig:
    p = Path(name_or_path)
    if not p.exists():
        p = CONFIG_DIR / f"{name_or_path}.yaml"
    raw = yaml.safe_load(p.read_text()) or {}
    slots = [Slot(**s) for s in raw.pop("slots", [])]
    weights = Weights(**raw.pop("weights", {}))
    leave = [date.fromisoformat(str(d)) for d in raw.pop("leave", [])]
    cfg = JudgeConfig(slots=slots, weights=weights, leave=leave, **raw)
    if cfg.planner != "baseline":
        cfg.enforce_floors()
        errs = check_day_profile(cfg)
        if errs:
            raise ValueError(f"day profile for '{cfg.name}' breaks the guardrails: " + "; ".join(errs))
    if cfg.day_profile:   # keep day_start / day_minutes consistent with the profile (every planner, incl. baseline)
        mon = date(2026, 9, 28)
        cfg.day_minutes = max(sitting_minutes(cfg, date.fromordinal(mon.toordinal() + i)) for i in range(5))
        first = min(a for i in range(5) for a, _ in sitting_windows(cfg, date.fromordinal(mon.toordinal() + i)))
        cfg.day_start = f"{first // 60:02d}:{first % 60:02d}"
    return cfg


NON_JUDGE_CONFIGS = {"world", "checklists", "court_default"}   # other layers keep their settings here too


def list_presets() -> list[str]:
    return sorted(p.stem for p in CONFIG_DIR.glob("*.yaml") if p.stem not in NON_JUDGE_CONFIGS)


def effective_ageing_share(cfg: JudgeConfig, old_share_of_eligible_minutes: float) -> float:
    """Resolve the ageing floor for one planning run.

    "auto": track the roster -- old cases get at least their share of the eligible workload
    (slightly boosted so the backlog shrinks), bounded to [MIN_AGEING_SHARE, 0.6].
    Baseline (today's practice) has no floor.
    """
    if cfg.planner == "baseline":
        return 0.0
    if cfg.ageing_share == "auto":
        return min(0.6, max(MIN_AGEING_SHARE, 1.2 * old_share_of_eligible_minutes))
    return max(float(cfg.ageing_share), MIN_AGEING_SHARE)
