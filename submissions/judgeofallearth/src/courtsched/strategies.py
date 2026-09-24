"""Strategies: how the Planner chooses and orders each sitting day's listings.

A strategy only sees what a real court would know before the day: the roster,
hearing history, published reference tables, and — if the scenario has process tracking —
whether a case's summons/warrant has come back. It never sees the Simulated Court's dice.
"""

from __future__ import annotations

from bisect import bisect_left
from dataclasses import dataclass, field
from datetime import date, timedelta
from statistics import NormalDist

import numpy as np

from .court import CaseState, Outcome, adjust
from .data import AWAITING_PROCESS, HearingType


def next_gap_days(purpose: str, *, advanced_to: str | None, substantive: bool, reason: str | None,
                  hts: dict[str, HearingType], params: "RuleParams") -> int | None:
    """Days until the next hearing, given what happened today. None = no date yet."""
    if advanced_to == "DISPOSED":
        return None
    if params.flat_gap:  # current practice: the same gap whatever happened
        return params.flat_gap
    if advanced_to:
        return round(hts[advanced_to].gap_days * params.gap_mult)
    if substantive:
        return round(hts[purpose].gap_days * params.gap_mult)
    if reason == AWAITING_PROCESS:
        return None  # listed once the process is back (readiness gate)
    return params.short_gap


@dataclass
class Listing:
    case: int
    exp_minutes: float
    exp_var: float
    why: str
    slot_start: float | None = None  # minutes after the court opens


@dataclass
class Context:
    """What the planner may see. `ready()` is the only window onto process status."""

    cases: list[CaseState]
    hts: dict[str, HearingType]
    days: list[date]
    minutes_per_day: int
    adjourn_minutes: float
    process_tracking: bool
    seed: int
    today: date | None = None
    first_scheduled: dict[int, date] = field(default_factory=dict)

    def ready(self, c: CaseState, day: date) -> bool:
        return (not self.process_tracking) or not c.process_outstanding(day)

    def p_success(self, c: CaseState) -> float:
        ht = self.hts[c.purpose]
        return ht.p_sub_ready if self.process_tracking else ht.p_sub

    def expected(self, c: CaseState, p: float | None = None) -> tuple[float, float]:
        """Planner's belief about the minutes this listing will take: (mean, variance)."""
        p = self.p_success(c) if p is None else p
        m, a = self.hts[c.purpose].minutes, self.adjourn_minutes
        return p * m + (1 - p) * a, p * (1 - p) * (m - a) ** 2

    def sitting_day_on_or_after(self, d: date) -> date | None:
        i = bisect_left(self.days, d)
        return self.days[i] if i < len(self.days) else None

    def day_index(self, d: date) -> int:
        return bisect_left(self.days, d)


# --------------------------------------------------------------------------------------------
@dataclass(frozen=True)
class CurrentPracticeParams:
    per_day: int = 30  # the brief: ~30 listed a day
    flat_gap: int = 60  # the brief: default gap to next date


class CurrentPractice:
    """How courts list today: whatever is due (~30/day), a flat 60-day next date, no process knowledge."""

    name = "current_practice"

    def __init__(self, params: CurrentPracticeParams = CurrentPracticeParams()):
        self.p = params

    def start(self, ctx: Context) -> None:
        rng = np.random.default_rng(ctx.seed + 7)
        order = rng.permutation(len(ctx.cases))
        self.rank = {int(i): r for r, i in enumerate(order)}
        self.next_date: dict[int, date] = {}
        self.booked: dict[date, int] = {}
        for r, i in enumerate(order):
            d = ctx.days[r // self.p.per_day] if r // self.p.per_day < len(ctx.days) else None
            if d:
                self._book(int(i), d, ctx)

    def _book(self, i: int, d: date, ctx: Context, keep_first: bool = False) -> None:
        self.next_date[i] = d
        if not keep_first or i not in ctx.first_scheduled:
            ctx.first_scheduled[i] = d
        self.booked[d] = self.booked.get(d, 0) + 1

    def plan_day(self, day: date, ctx: Context) -> tuple[list[Listing], dict]:
        due = [c for c in ctx.cases if not c.disposed and c.idx in self.next_date
               and self.next_date[c.idx] <= day]
        due.sort(key=lambda c: (self.next_date[c.idx], self.rank[c.idx]))
        out = []
        for c in due[: self.p.per_day]:
            m, v = ctx.expected(c)
            out.append(Listing(c.idx, m, v, "due"))
        return out, {"old_exhausted": True}

    def after_day(self, day: date, outcomes: list[Outcome], ctx: Context) -> dict[int, int | None]:
        gaps = {}
        for o in outcomes:
            if ctx.cases[o.case].disposed:
                self.next_date.pop(o.case, None)
                gaps[o.case] = None
                continue
            d = day + timedelta(days=self.p.flat_gap)
            nd = ctx.sitting_day_on_or_after(d)
            while nd and self.booked.get(nd, 0) >= self.p.per_day:
                nd = ctx.sitting_day_on_or_after(nd + timedelta(days=1))
            if nd:
                self._book(o.case, nd, ctx, keep_first=not o.reached)
                gaps[o.case] = (nd - day).days
            else:  # beyond the posting window
                self.next_date[o.case] = date.max
                gaps[o.case] = self.p.flat_gap
        return gaps


# --------------------------------------------------------------------------------------------
@dataclass(frozen=True)
class RuleParams:
    fill: float = 0.80  # chance the day fits in the judge's minutes
    old_years: float = 4.0
    old_share: float = 0.30  # old-case guarantee: minimum share of listed minutes
    old_max_wait: int = 10  # sitting days a ready old case may wait
    old_cap_share: float = 0.60  # overdue old cases may pre-empt up to this share of minutes
    due_share: float = 0.35  # share of expected minutes a day may promise as next dates
    any_max_wait: int = 20  # anti-starvation for every case: sitting days a ready case may wait
    any_cap_share: float = 0.0  # ...pre-empting at most this share of the day (0 = off; tested, small gain)
    age_weight: float = 0.25  # score boost per year of age
    adv_bonus: float = 0.30  # advocate grouping nudge (0 = off)
    slot_minutes: int = 60
    short_gap: int = 7  # after absence / time sought
    gap_mult: float = 1.0  # multiplier on the published gaps (spacing experiments)
    pool_size: int = 600  # candidates considered for the ranked fill each day
    flat_gap: int = 0  # >0: every next date is this many days out, whatever happened (0 = outcome-based)


class RulePlanner:
    """Rule-based planner. Fixed rules: ready-only, old-case guarantee, rank by success/minute × age,
    pack to a fill level, carry-overs first, advocate grouping, slots, outcome-based dates."""

    name = "rule_based"

    def __init__(self, params: RuleParams = RuleParams()):
        self.p = params

    def start(self, ctx: Context) -> None:
        n = len(ctx.cases)
        self.eligible_from = [ctx.days[0] if ctx.days else date.min] * n
        self.next_date: list[date | None] = [None] * n
        self.carry: list[bool] = [False] * n
        self.wait_start: list[int | None] = [None] * n
        self.max_old_wait = 0
        self.z = NormalDist().inv_cdf(self.p.fill)
        self.promised: dict[date, float] = {}  # expected minutes already promised per day

    # -- beliefs (the adaptive planner overrides these) ---------------------------------------------------------
    def p_success(self, c: CaseState, ctx: Context) -> float:
        return ctx.p_success(c)

    def expected(self, c: CaseState, ctx: Context) -> tuple[float, float]:
        return ctx.expected(c, self.p_success(c, ctx))

    # -- scoring ------------------------------------------------------------------------------
    def score(self, c: CaseState, ctx: Context) -> float:
        age = (ctx.days[0] - c.filing_date).days / 365.25
        return self.p_success(c, ctx) / ctx.hts[c.purpose].minutes * (1 + self.p.age_weight * age)

    def plan_day(self, day: date, ctx: Context) -> tuple[list[Listing], dict]:
        di = ctx.day_index(day)
        cap = ctx.minutes_per_day
        cands = [c for c in ctx.cases if not c.disposed and self.eligible_from[c.idx] <= day
                 and ctx.ready(c, day)]
        cand_ids = {c.idx for c in cands}
        # waiting clocks for the max-wait guarantee
        for c in ctx.cases:
            if not c.disposed:
                if c.idx in cand_ids:
                    if self.wait_start[c.idx] is None:
                        self.wait_start[c.idx] = di
                else:
                    self.wait_start[c.idx] = None

        chosen: list[tuple[CaseState, str]] = []
        taken: set[int] = set()
        mean = var = old_mean = 0.0

        def fits(c: CaseState) -> bool:
            m, v = self.expected(c, ctx)
            return not chosen or (mean + m) + self.z * (var + v) ** 0.5 <= cap

        def add(c: CaseState, why: str) -> None:
            nonlocal mean, var, old_mean
            m, v = self.expected(c, ctx)
            chosen.append((c, why))
            taken.add(c.idx)
            mean += m
            var += v
            if c.old:
                old_mean += m

        score = {c.idx: self.score(c, ctx) for c in cands}
        waited = lambda c: di - self.wait_start[c.idx] if self.wait_start[c.idx] is not None else 0

        # 1. carry-overs first
        for c in [c for c in cands if self.carry[c.idx]]:
            if fits(c):
                add(c, "carry-over")
        # 2. old-case guarantee: overdue waits first, then due dates, then score
        olds = sorted((c for c in cands if c.old and c.idx not in taken),
                      key=lambda c: (-(waited(c) > self.p.old_max_wait), -(waited(c)),
                                     self.next_date[c.idx] or date.max, -score[c.idx]))
        target = self.p.old_share * cap * 0.85
        for c in olds:
            if old_mean >= target:
                break
            if fits(c):
                add(c, "old-case guarantee")
        # 3. cases due today (their announced next date)
        due = sorted((c for c in cands if c.idx not in taken and self.next_date[c.idx]
                      and self.next_date[c.idx] <= day),
                     key=lambda c: (self.next_date[c.idx], -score[c.idx]))
        for c in due:
            if fits(c):
                add(c, "due")
        # 3b. old cases past the max wait, up to the cap share of the day
        for c in olds:
            if c.idx in taken or waited(c) <= self.p.old_max_wait:
                continue
            if old_mean >= self.p.old_cap_share * cap * 0.85:
                break
            if fits(c):
                add(c, "old case waited too long")
        # 3c. any case waiting too long (anti-starvation for all), up to its cap
        starved_mean = 0.0
        for c in sorted((c for c in cands if c.idx not in taken and waited(c) > self.p.any_max_wait),
                        key=lambda c: -waited(c)):
            if starved_mean >= self.p.any_cap_share * cap * 0.85:
                break
            if fits(c):
                m_, _ = self.expected(c, ctx)
                add(c, "waited too long")
                starved_mean += m_
        # 4. ranked fill with advocate grouping
        pool = sorted((c for c in cands if c.idx not in taken), key=lambda c: -score[c.idx])
        pool = pool[: self.p.pool_size]
        advs = {c.advocate for c, _ in chosen}
        while pool:
            best_i = max(range(len(pool)), key=lambda i: score[pool[i].idx]
                         * (1 + self.p.adv_bonus * (pool[i].advocate in advs)))
            c = pool.pop(best_i)
            if fits(c):
                add(c, "ranked" + (" (advocate already listed)" if c.advocate in advs else ""))
                advs.add(c.advocate)
        # 5. enforce the old-case floor on the final list: swap out lowest non-old if short
        total = mean
        spare_old = [c for c in olds if c.idx not in taken]
        while old_mean < self.p.old_share * total and spare_old:
            non_old = [(i, c) for i, (c, _) in enumerate(chosen) if not c.old
                       and not self.carry[c.idx]]
            if not non_old:
                break
            i, drop = non_old[-1]
            m, v = self.expected(drop, ctx)
            chosen.pop(i)
            taken.discard(drop.idx)
            mean, var, total = mean - m, var - v, total - m
            added = False
            while spare_old:
                c = spare_old.pop(0)
                if fits(c):
                    add(c, "old-case guarantee")
                    total = mean
                    added = True
                    break
            if not added:
                break
        old_exhausted = not any(c.idx not in taken and fits(c) for c in olds)

        listings = self._order_and_slot(chosen, ctx)
        for l in listings:
            c = ctx.cases[l.case]
            if c.old and self.wait_start[c.idx] is not None:
                self.max_old_wait = max(self.max_old_wait, di - self.wait_start[c.idx])
            self.wait_start[c.idx] = None
            ctx.first_scheduled.setdefault(c.idx, day)
        return listings, {"old_exhausted": old_exhausted}

    def _order_and_slot(self, chosen, ctx: Context) -> list[Listing]:
        key = {c.idx: (0 if self.carry[c.idx] else 1, i) for i, (c, _) in enumerate(chosen)}
        by_adv: dict[str, list] = {}
        for c, why in sorted(chosen, key=lambda x: key[x[0].idx]):
            by_adv.setdefault(c.advocate, []).append((c, why))
        out, t = [], 0.0
        for group in by_adv.values():  # dict order = first appearance in priority order
            slot = (t // self.p.slot_minutes) * self.p.slot_minutes
            for c, why in group:
                m, v = self.expected(c, ctx)
                out.append(Listing(c.idx, m, v, why, slot))
                t += m
        return out

    def after_day(self, day: date, outcomes: list[Outcome], ctx: Context) -> dict[int, int | None]:
        gaps = {}
        for o in outcomes:
            c = ctx.cases[o.case]
            if not o.reached:
                self.carry[o.case] = True
                continue
            self.carry[o.case] = False
            ctx.first_scheduled.pop(o.case, None)
            gap = self.gap_for(o, ctx)
            gaps[o.case] = gap
            if c.disposed:
                continue
            if gap is None:
                self.next_date[o.case] = None
                self.eligible_from[o.case] = day + timedelta(days=1)
            else:
                m, _ = self.expected(c, ctx)
                budget = self.p.due_share * ctx.minutes_per_day
                nd = ctx.sitting_day_on_or_after(day + timedelta(days=gap))
                while nd and self.promised.get(nd, 0.0) + m > budget:
                    nd = ctx.sitting_day_on_or_after(nd + timedelta(days=1))
                if nd:
                    self.promised[nd] = self.promised.get(nd, 0.0) + m
                nd = nd or date.max
                self.next_date[o.case] = nd
                self.eligible_from[o.case] = nd
                if nd != date.max:
                    ctx.first_scheduled[o.case] = nd
        return gaps

    def gap_for(self, o: Outcome, ctx: Context) -> int | None:
        return next_gap_days(o.purpose_before, advanced_to=o.advanced_to, substantive=o.substantive,
                             reason=o.reason, hts=ctx.hts, params=self.p)

    def final_waits(self, ctx: Context) -> int:
        last = len(ctx.days) - 1
        waits = [last - w for c, w in zip(ctx.cases, self.wait_start)
                 if c.old and not c.disposed and w is not None]
        return max(waits, default=0)


# --------------------------------------------------------------------------------------------
ABSENCE_REASONS = {"Petitioner Absence / Non-Compliance", "Respondent Absence / Non-Compliance",
                   "Both Parties Unready / Absent", "Party Sought Time / Adjournment"}


@dataclass(frozen=True)
class AdaptiveParams(RuleParams):
    history_weight: float = 0.5  # prior: log-odds shift per SD of past adjournment-heaviness
    prior_strength: float = 3.0  # pseudo-observations behind the prior
    unreliable_p: float = 0.30  # below this estimated chance, an absence earns the long gap
    long_gap: int = 14
    # Fairness guard: by default the case model sizes the day and spaces
    # hearings, but does NOT rank cases, so an unreliable party is never pushed down the queue.
    rank_with_case_model: bool = False


class AdaptivePlanner(RulePlanner):
    """Adaptive planner: the rule-based planner + a small per-case prediction model (empirical Bayes on the log-odds).

    Prior: the hearing type's published odds, shifted by the case's hearing history.
    Update: after every reached hearing with process back, a one-step Laplace update.
    Uses: ranking, day packing (expected minutes), and spacing after absences.
    Fairness: estimates change rank and spacing only; the old-case guarantee and the
    readiness rule are untouched, so no case is excluded on a prediction.
    """

    name = "adaptive"

    def __init__(self, params: AdaptiveParams = AdaptiveParams()):
        super().__init__(params)

    def start(self, ctx: Context) -> None:
        super().start(ctx)
        n = len(ctx.cases)
        self.resid = [0.0] * n  # sum(y - p)
        self.info = [0.0] * n  # sum p(1-p)

    def prior(self, c: CaseState) -> float:
        return -self.p.history_weight * c.history_z

    def offset(self, c: CaseState) -> float:
        return self.prior(c) + self.resid[c.idx] / (self.p.prior_strength + self.info[c.idx])

    def p_success(self, c: CaseState, ctx: Context) -> float:
        return float(adjust(ctx.p_success(c), self.offset(c)))

    def score(self, c: CaseState, ctx: Context) -> float:
        if self.p.rank_with_case_model:
            return super().score(c, ctx)
        age = (ctx.days[0] - c.filing_date).days / 365.25
        return ctx.p_success(c) / ctx.hts[c.purpose].minutes * (1 + self.p.age_weight * age)

    def after_day(self, day: date, outcomes: list[Outcome], ctx: Context) -> dict[int, int | None]:
        for o in outcomes:
            if not o.reached or o.process_outstanding or o.purpose_before not in ctx.hts:
                continue
            ht = ctx.hts[o.purpose_before]
            base = ht.p_sub_ready if ctx.process_tracking else ht.p_sub
            p = float(adjust(base, self.prior(ctx.cases[o.case])))
            self.resid[o.case] += (1.0 if o.substantive else 0.0) - p
            self.info[o.case] += p * (1 - p)
        return super().after_day(day, outcomes, ctx)

    def gap_for(self, o: Outcome, ctx: Context) -> int | None:
        gap = super().gap_for(o, ctx)
        c = ctx.cases[o.case]
        if (gap == self.p.short_gap and o.reason in ABSENCE_REASONS and not c.disposed
                and o.purpose_before in ctx.hts):
            ht = ctx.hts[o.purpose_before]
            base = ht.p_sub_ready if ctx.process_tracking else ht.p_sub
            if adjust(base, self.offset(c)) < self.p.unreliable_p:
                return self.p.long_gap
        return gap


# Legacy names (kept so saved courts and older scripts still load; the hackathon called these L1/L2).
Baseline, BaselineParams = CurrentPractice, CurrentPracticeParams
L1, L1Params = RulePlanner, RuleParams
L2, L2Params = AdaptivePlanner, AdaptiveParams
