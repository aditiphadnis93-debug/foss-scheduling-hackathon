"""The court for the role views: one courtroom per judge in the dataset, each with its cases and plan.

The scheduler still plans one judge's roster at a time; this only runs it once per courtroom so the
Court Master and advocates can see the whole court. A court is either a live plan (computed now from
the store's cases and presets) or a saved schedule (scheduler/runs.py) rebuilt into the same objects.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date

from scheduler.assign import DayPlan, plan_horizon
from scheduler.data import sitting_days
from scheduler.models import Case, JudgeConfig
from scheduler.runs import load_batch
from scheduler.store import Store

CALENDAR_DAYS = 22  # about a month of sitting days


@dataclass
class Courtroom:
    judge_id: str
    cfg: JudgeConfig
    cases: list[Case]
    days: list[date]
    plans: list[DayPlan]
    store: Store
    overrides: dict = field(default_factory=dict)
    by_id: dict[str, Case] = field(default_factory=dict)

    def __post_init__(self) -> None:
        self.by_id = {c.id: c for c in self.cases}

    @property
    def name(self) -> str:
        return self.store.judge(self.judge_id).hall

    @property
    def judge(self) -> str:
        return self.store.judge(self.judge_id).name

    def plan_on(self, day: date) -> DayPlan | None:
        return self.plans[self.days.index(day)] if day in self.days else None

    def parties(self, case: Case) -> str:
        return self.store.directory.parties(case.parties)


def build_room(store: Store, judge_id: str, start: date, n_days: int = CALENDAR_DAYS,
               overrides: dict | None = None) -> Courtroom:
    cfg = store.config(judge_id, overrides)
    cases = store.cases(judge_id)
    days = sitting_days(start, n_days, cfg.leave)
    return Courtroom(judge_id, cfg, cases, days, plan_horizon(cases, days, cfg), store, overrides or {})


def build_court(store: Store, start: date, n_days: int = CALENDAR_DAYS,
                overrides: dict[str, dict] | None = None) -> list[Courtroom]:
    """A live plan for every courtroom. `overrides` maps judge id -> preset keys to replace."""
    return [build_room(store, j.id, start, n_days, (overrides or {}).get(j.id)) for j in store.judges]


def court_from_batch(store: Store, batch: str) -> list[Courtroom]:
    saved = {jid: (cfg, days, plans, ov) for jid, cfg, days, plans, ov in load_batch(store, batch)}
    return [Courtroom(j.id, cfg, store.cases(j.id), days, plans, store, ov)
            for j in store.judges if j.id in saved
            for cfg, days, plans, ov in [saved[j.id]]]
