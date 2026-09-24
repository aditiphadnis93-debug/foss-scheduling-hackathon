"""Run one strategy through the Simulated Court for a whole posting, and score it."""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date

from .court import CaseState, Court, p_advance
import math

from .data import NEXT_STAGE, SIDE_PURPOSES, STAGES, CaseRecord, generate_roster, load_hearing_types, load_sitting_days
from .scenario import Scenario
from .strategies import Context

OLD_YEARS = 4.0  # the README's backlog-age metric threshold


@dataclass
class ListingRecord:
    day: date
    case: int
    case_id: str
    advocate: str
    purpose: str
    old: bool
    why: str
    exp_minutes: float
    exp_var: float
    slot_start: float | None
    first_scheduled: date | None
    reached: bool
    start_min: float | None
    minutes: float
    substantive: bool
    advanced_to: str | None
    reason: str | None
    process_outstanding: bool
    next_gap: int | None = None


@dataclass
class RunResult:
    scenario_name: str
    strategy_name: str
    seed: int
    days: list[date]
    minutes_per_day: int
    listings: list[ListingRecord]
    day_meta: dict[date, dict]
    cases: list[CaseState]
    max_old_wait_sitting_days: int
    old_heard_by_day: list[float] = field(default_factory=list)
    old_advanced_by_day: list[float] = field(default_factory=list)

    def scorecard(self) -> dict[str, float]:
        L = self.listings
        n_days = max(1, len(self.days))
        reached = [r for r in L if r.reached]
        sub = [r for r in reached if r.substantive]
        adv = [r for r in reached if r.advanced_to]
        used = defaultdict(float)
        for r in reached:
            used[r.day] += r.minutes
        util = sum(min(v, self.minutes_per_day) for v in used.values()) / (self.minutes_per_day * n_days)
        old_ids = {c.idx for c in self.cases if c.old}
        old_heard = {r.case for r in reached if r.old}
        old_adv = {r.case for r in adv if r.old}
        pred = [(r.day - r.first_scheduled).days for r in reached if r.first_scheduled]
        slotted = [r for r in reached if r.slot_start is not None]
        kept = [r for r in slotted if r.slot_start <= r.start_min < r.slot_start + 60]
        adv_days = {(r.advocate, r.day) for r in L}
        hard = {c.idx for c in self.cases if c.history_z > 1.0}
        sc = {
            "utilisation": util,
            "reach_rate": len(reached) / max(1, len(L)),
            "substantiveness": len(sub) / max(1, len(reached)),
            "old_heard": len(old_heard) / max(1, len(old_ids)),
            "predictability_days": sum(pred) / max(1, len(pred)),
            # counter-metrics and case-life measures
            "listed_per_day": len(L) / n_days,
            "substantive_per_day": len(sub) / n_days,
            "stage_advances": float(len(adv)),
            "old_advanced": len(old_adv) / max(1, len(old_ids)),
            "appearances_per_advance": len(L) / max(1, len(adv)),
            "wasted_on_pending_process": sum(r.process_outstanding for r in L) / n_days,
            "slot_kept": len(kept) / len(slotted) if slotted else float("nan"),
            "trips_per_case": len(adv_days) / max(1, len(L)),
            "idle_minutes_per_day": self.minutes_per_day - sum(min(v, self.minutes_per_day) for v in used.values()) / n_days,
            "disposals": float(sum(1 for r in adv if r.advanced_to == "DISPOSED")),
            "projected_days_to_disposal": projected_days_to_disposal(self),
            # fairness guard: adjournment-heavy cases (top ~16% by past hearings-per-stage) heard at all
            "adjournment_heavy_heard": len({r.case for r in reached} & hard) / max(1, len(hard)),
            "adjournment_heavy_advanced": len({r.case for r in adv} & hard) / max(1, len(hard)),
        }
        return {k: round(v, 6) for k, v in sc.items()}


def projected_days_to_disposal(res: RunResult) -> float:
    """Absorbing-chain projection: expected days for pending cases to reach disposal, using the
    per-purpose advance rate and re-listing gap this strategy actually achieved."""
    hts = load_hearing_types()
    listed, advanced, gaps = defaultdict(int), defaultdict(int), defaultdict(list)
    last_seen: dict[int, date] = {}
    for r in sorted(res.listings, key=lambda r: r.day):
        listed[r.purpose] += 1
        if r.reached and r.advanced_to:
            advanced[r.purpose] += 1
        if r.case in last_seen:
            gaps[r.purpose].append((r.day - last_seen[r.case]).days)
        last_seen[r.case] = r.day
    all_gaps = [g for v in gaps.values() for g in v]
    fallback_gap = sum(all_gaps) / len(all_gaps) if all_gaps else 60.0

    def days_in(purpose: str) -> float:
        ht = hts[purpose]
        rate = advanced[purpose] / listed[purpose] if listed[purpose] >= 10 and advanced[purpose] else \
            ht.p_sub * p_advance(ht, "matched")
        gap = sum(gaps[purpose]) / len(gaps[purpose]) if len(gaps[purpose]) >= 5 else fallback_gap
        return gap / rate

    memo: dict[str, float] = {}

    def remaining(stage: str) -> float:
        if stage == "DISPOSED":
            return 0.0
        if stage not in memo:
            memo[stage] = days_in(stage) + remaining(NEXT_STAGE[stage])
        return memo[stage]

    pending = [c for c in res.cases if not c.disposed]
    if not pending:
        return 0.0
    total = 0.0
    for c in pending:
        side = days_in(c.purpose) if c.purpose in SIDE_PURPOSES else 0.0
        total += side + remaining(c.stage)
    return total / len(pending)


def _set_history_z(cases, roster, hts) -> None:
    """How adjournment-heavy has each case been? log(hearings so far / typical for its stage),
    standardised across the roster. Public information: the roster carries it."""
    logs = []
    for c, r in zip(cases, roster):
        i = STAGES.index(c.stage) if c.stage in STAGES else 0
        expected = sum(hts[s].mean_hearings for s in STAGES[:i]) + 0.5 * hts[STAGES[i]].mean_hearings
        logs.append(math.log(max(1, r.hearings_so_far) / max(1.0, expected)))
    m = sum(logs) / len(logs)
    sd = (sum((x - m) ** 2 for x in logs) / max(1, len(logs) - 1)) ** 0.5 or 1.0
    for c, x in zip(cases, logs):
        c.history_z = (x - m) / sd


class Simulation:
    """A posting you can step through one sitting day at a time (draft → play), and pickle.

    `run()` is just `Simulation(...).run_all()`, so the batch results and the app share one path.
    """

    def __init__(self, scenario: Scenario, strategy, seed: int, roster: list[CaseRecord] | None = None):
        self.scenario, self.strategy, self.seed = scenario, strategy, seed
        self.hts = load_hearing_types()
        if roster is None:
            roster = generate_roster(scenario.roster_size, seed=seed, advocates=scenario.advocates)
        self.roster = roster
        self.days = load_sitting_days(scenario.start, scenario.end, set(scenario.leave))
        old_years = getattr(getattr(strategy, "p", None), "old_years", OLD_YEARS)
        self.cases = [
            CaseState(i, r.case_id, r.filing_date, r.advocate, r.stage, r.purpose,
                      old=(scenario.start - r.filing_date).days / 365.25 >= old_years)
            for i, r in enumerate(roster)
        ]
        _set_history_z(self.cases, roster, self.hts)
        self.court = Court(scenario, self.hts, len(self.cases), seed)
        self.court.assign_latent(self.cases)
        for c in self.cases:
            self.court.maybe_issue_process(c, scenario.start)
        self.ctx = Context(self.cases, self.hts, self.days, scenario.minutes_per_day,
                           scenario.adjourn_minutes, scenario.process_tracking, seed)
        strategy.start(self.ctx)
        self.day_idx = 0
        self.records: list[ListingRecord] = []
        self.meta: dict[date, dict] = {}
        self._old_total = max(1, sum(c.old for c in self.cases))
        self._heard_old: set[int] = set()
        self._adv_old: set[int] = set()
        self.old_heard_by_day: list[float] = []
        self.old_adv_by_day: list[float] = []
        self._draft = None  # (listings, meta, firsts) for today, computed once
        # Overrides (slice 2): today's manual changes, applied on top of the planner's draft.
        self.overrides: dict = {"remove": [], "add": [], "extra": 0}
        self.moves: dict[int, date] = {}  # case -> the sitting day it was moved to

    def __setstate__(self, st):
        self.__dict__.update(st)
        self.__dict__.setdefault("overrides", {"remove": [], "add": [], "extra": 0})
        self.__dict__.setdefault("moves", {})

    @property
    def today(self) -> date | None:
        return self.days[self.day_idx] if self.day_idx < len(self.days) else None

    def base_draft(self):
        """The planner's own list for today. Planning mutates strategy state: computed once a day."""
        if self._draft is None:
            day = self.today
            if day is None:
                return [], {}
            self.ctx.today = day
            listings, m = self.strategy.plan_day(day, self.ctx)
            firsts = {l.case: self.ctx.first_scheduled.get(l.case) for l in listings}
            self._draft = (listings, m, firsts)
        return self._draft[0], self._draft[1]

    def draft(self):
        """Today's list: the planner's draft with today's overrides applied (a pure transform)."""
        base, m = self.base_draft()
        day = self.today
        if day is None:
            return [], {}
        o = self.overrides
        remove = set(o["remove"]) | {c for c, d in self.moves.items() if d != day}
        out = [l for l in base if l.case not in remove]
        listed = {l.case for l in out}
        forced = [c for c in o["add"] + [c for c, d in self.moves.items() if d == day] if c not in listed]
        for c in forced:
            out.append(self._listing(c, "added by the judge"))
            listed.add(c)
        if o["extra"]:
            for c in self.next_best(o["extra"], exclude=listed):
                out.append(self._listing(c, "overbooked by the judge"))
                listed.add(c)
        return self._reslot(out), m

    def _listing(self, idx: int, why: str):
        from .strategies import Listing
        c = self.cases[idx]
        if hasattr(self.strategy, "expected"):
            mean, var = self.strategy.expected(c, self.ctx)
        else:
            mean, var = self.ctx.expected(c)
        return Listing(idx, mean, var, why)

    @staticmethod
    def _reslot(listings):
        """Keep the planner's slots; give appended cases the slot their expected start falls in."""
        t = 0.0
        for l in listings:
            if l.slot_start is None or l.why.endswith("by the judge"):
                l.slot_start = (t // 60) * 60
            t += l.exp_minutes
        return listings

    def candidates(self, limit: int = 50) -> list[int]:
        """Ready cases not on today's list, best first (what 'Add' and 'overbook' draw from)."""
        listed = {l.case for l in self.draft()[0]}
        return self.next_best(limit, exclude=listed)

    def next_best(self, n: int, exclude: set[int]) -> list[int]:
        day = self.today
        elig = getattr(self.strategy, "eligible_from", None)
        pool = [c for c in self.cases if not c.disposed and c.idx not in exclude and self.ctx.ready(c, day)
                and (elig is None or elig[c.idx] <= day) and c.idx not in self.moves]
        score = getattr(self.strategy, "score", None)
        key = (lambda c: -score(c, self.ctx)) if score else (lambda c: c.filing_date)
        return [c.idx for c in sorted(pool, key=key)[:n]]

    def move(self, idx: int, to: date) -> None:
        """Move a case to a later sitting day: it's promised that date and not listed before it."""
        self.moves[idx] = to
        if hasattr(self.strategy, "eligible_from"):
            self.strategy.eligible_from[idx] = to
            self.strategy.next_date[idx] = to
        elif hasattr(self.strategy, "next_date"):
            self.strategy.next_date[idx] = to
        self.ctx.first_scheduled[idx] = to

    def add_leave(self, d: date) -> None:
        """Judge's leave: that sitting day disappears; anything due then becomes due the next day."""
        if d in self.days and (self.today is None or d > self.today):
            self.days.remove(d)  # shared with ctx.days

    def play(self) -> list[ListingRecord]:
        """Play today's draft through the Simulated Court and advance the clock."""
        day = self.today
        if day is None:
            return []
        listings, m = self.draft()
        firsts = {l.case: self._draft[2].get(l.case, self.ctx.first_scheduled.get(l.case, day)) for l in listings}
        self.meta[day] = m
        outcomes = self.court.play(day, [self.cases[l.case] for l in listings])
        gaps = self.strategy.after_day(day, outcomes, self.ctx)
        new = []
        for l, o in zip(listings, outcomes):
            c = self.cases[l.case]
            rec = ListingRecord(
                day, c.idx, c.case_id, c.advocate, o.purpose_before, c.old, l.why, l.exp_minutes,
                l.exp_var, l.slot_start, firsts[l.case], o.reached, o.start_min, o.minutes,
                o.substantive, o.advanced_to, o.reason, o.process_outstanding, gaps.get(c.idx))
            new.append(rec)
            if o.reached and c.old:
                self._heard_old.add(c.idx)
                if o.advanced_to:
                    self._adv_old.add(c.idx)
        self.records.extend(new)
        self.old_heard_by_day.append(len(self._heard_old) / self._old_total)
        self.old_adv_by_day.append(len(self._adv_old) / self._old_total)
        self.day_idx += 1
        self._draft = None
        self.overrides = {"remove": [], "add": [], "extra": 0}
        self.moves = {c: d for c, d in self.moves.items() if d > day}
        return new

    def run_all(self) -> "Simulation":
        while self.today is not None:
            self.play()
        return self

    def result(self) -> RunResult:
        max_wait = getattr(self.strategy, "max_old_wait", 0)
        if hasattr(self.strategy, "final_waits"):
            max_wait = max(max_wait, self.strategy.final_waits(self.ctx))
        return RunResult(self.scenario.name, self.strategy.name, self.seed, self.days[: self.day_idx],
                         self.scenario.minutes_per_day, self.records, self.meta, self.cases, max_wait,
                         self.old_heard_by_day, self.old_adv_by_day)


def run(scenario: Scenario, strategy, seed: int, roster: list[CaseRecord] | None = None) -> RunResult:
    return Simulation(scenario, strategy, seed, roster).run_all().result()
