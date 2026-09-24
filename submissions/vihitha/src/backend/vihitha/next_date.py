"""Next-date suggestion, capacity and clustering aware (section 6.6)."""
from __future__ import annotations

import math
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import date, timedelta

from .calendar import CourtCalendar, fmt_day, weekday_code
from .models import Case
from .reference import Reference
from .rules import Rules

MAX_SEARCH_DAYS = 400


@dataclass
class LoadBook:
    """Planned expected minutes already committed per day (updated on every commit/uncommit)."""
    minutes: dict[date, float] = field(default_factory=lambda: defaultdict(float))
    count: dict[date, int] = field(default_factory=lambda: defaultdict(int))
    aged_minutes: dict[date, float] = field(default_factory=lambda: defaultdict(float))
    advocates: dict[date, Counter] = field(default_factory=lambda: defaultdict(Counter))
    entries: dict[str, tuple[date, float, bool, str]] = field(default_factory=dict)
    by_date: dict[date, dict[str, int]] = field(default_factory=lambda: defaultdict(dict))  # fn -> commit seq
    # Soft listings: the planner's own tentative placements. Court orders (next dates,
    # carry-forwards, judge edits) may take their place; the planner then moves them.
    soft: set[str] = field(default_factory=set)
    soft_minutes: dict[date, float] = field(default_factory=lambda: defaultdict(float))
    soft_count: dict[date, int] = field(default_factory=lambda: defaultdict(int))
    _seq: int = 0

    def commit(self, fn: str, d: date, minutes: float, aged: bool, advocate: str, soft: bool = False) -> None:
        self.uncommit(fn)
        if soft:
            self.soft.add(fn)
            self.soft_minutes[d] += minutes
            self.soft_count[d] += 1
        self._seq += 1
        self.by_date[d][fn] = self._seq
        self.minutes[d] += minutes
        self.count[d] += 1
        if aged:
            self.aged_minutes[d] += minutes
        self.advocates[d][advocate] += 1
        self.entries[fn] = (d, minutes, aged, advocate)

    def uncommit(self, fn: str) -> None:
        e = self.entries.pop(fn, None)
        if e is None:
            return
        d, minutes, aged, advocate = e
        if fn in self.soft:
            self.soft.discard(fn)
            self.soft_minutes[d] -= minutes
            self.soft_count[d] -= 1
        self.by_date[d].pop(fn, None)
        self.minutes[d] -= minutes
        self.count[d] -= 1
        if aged:
            self.aged_minutes[d] -= minutes
        self.advocates[d][advocate] -= 1
        if self.advocates[d][advocate] <= 0:
            del self.advocates[d][advocate]

    def harden(self, fn: str) -> None:
        """A soft listing becomes firm (e.g. its day is published)."""
        e = self.entries.get(fn)
        if e is not None and fn in self.soft:
            self.soft.discard(fn)
            self.soft_minutes[e[0]] -= e[1]
            self.soft_count[e[0]] -= 1

    def date_of(self, fn: str) -> date | None:
        e = self.entries.get(fn)
        return e[0] if e else None


@dataclass
class Suggestion:
    date: date
    reason: str
    alternatives: list[dict]
    window: dict
    load_after: dict
    vs_flat_default_days: int
    clustered: bool = False


@dataclass
class Scheduler:
    """Everything next-date needs: calendar, rules, reference tables and the load book."""
    calendar: CourtCalendar
    rules: Rules
    ref: Reference
    book: LoadBook
    horizon_start: date
    firm_only: bool = False  # court orders (next dates) see only firm listings: they outrank soft ones

    def _minutes(self, d: date) -> float:
        return self.book.minutes[d] - (self.book.soft_minutes[d] if self.firm_only else 0.0)

    def _count(self, d: date) -> int:
        return self.book.count[d] - (self.book.soft_count[d] if self.firm_only else 0)

    # ------------------------------------------------------------ capacity
    def budget(self, fill_share: float = 1.0) -> float | None:
        b = self.rules.budget_minutes
        return None if b is None else b * fill_share

    def room(self, d: date, minutes: float, aged: bool, today: date, fill_share: float = 1.0) -> bool:
        r = self.rules
        if r.max_listed_per_day is not None and self._count(d) + 1 > r.max_listed_per_day:
            return False
        budget = self.budget(fill_share)
        if budget is None:
            return True
        cap = budget
        if not aged and r.ageing_quota_pct > 0 and (d - today).days > r.ageing_reserve_release_days:
            reserve = budget * r.ageing_quota_pct / 100.0
            cap = budget - max(0.0, reserve - self.book.aged_minutes[d])
        return self._minutes(d) + minutes <= cap + 1e-9

    def load_ratio(self, d: date, extra: float = 0.0) -> float:
        budget = self.budget()
        if budget:
            return (self._minutes(d) + extra) / budget
        cap = self.rules.max_listed_per_day or 60
        return (self._count(d) + (1 if extra else 0)) / cap

    def purpose_allowed(self, case: Case, d: date) -> bool:
        pdays = self.rules.clustering.purpose_days
        if not pdays:
            return True
        p = case.next_purpose.value
        if not any(p in types for types in pdays.values()):
            return True
        return p in pdays.get(weekday_code(d), [])

    # ------------------------------------------------------------ suggest
    def suggest(
        self,
        case: Case,
        from_date: date,
        minutes: float,
        today: date | None = None,
        target_gap: int | None = None,
        fill_share: float = 1.0,
        label: str | None = None,
    ) -> Suggestion:
        r = self.rules
        today = today or from_date
        aged = case.age_years(from_date) >= 4
        flat = from_date + timedelta(days=r.flat_gap_days)

        if r.next_date_mode == "FLAT_60" and target_gap is None:
            d = self.calendar.next_working_day(flat)
            for _ in range(MAX_SEARCH_DAYS):
                if self.room(d, minutes, aged, today, fill_share):
                    break
                d = self.calendar.next_working_day(d + timedelta(days=1))
            return Suggestion(
                date=d,
                reason=f"Flat {r.flat_gap_days}-day next date ({fmt_day(d)})",
                alternatives=[],
                window={"min": d, "target": d, "max": d},
                load_after=self._load_after(d, minutes),
                vs_flat_default_days=(flat - d).days,
            )

        gap = self.ref.gap(case.next_purpose) if target_gap is None else target_gap
        lo = from_date + timedelta(days=gap)
        hi = from_date + timedelta(days=math.ceil(gap * r.next_date_window_factor))
        pending_note = None
        if r.prerequisite_check and case.pending_until and case.pending_until > lo:
            width = (hi - lo).days
            lo, hi = case.pending_until, case.pending_until + timedelta(days=width)
            pending_note = case.pending_reason or "Awaiting prerequisite"
        target = lo
        deadline = None
        if aged and r.ageing_quota_pct > 0:
            deadline = (case.last_listed_on or self.horizon_start) + timedelta(days=r.max_wait_days_4y)

        scored: list[tuple[float, date, bool]] = []
        d = lo
        found = False
        end = hi
        while d <= lo + timedelta(days=MAX_SEARCH_DAYS):
            if d > end:
                if found:
                    break
                end = end + timedelta(days=7)
                continue
            if self.calendar.is_working(d):
                has_room = self.room(d, minutes, aged, today, fill_share)
                found = found or has_room
                scored.append((self._cost(case, d, target, minutes, aged, has_room, deadline), d, has_room))
            d += timedelta(days=1)
        if not scored:  # pragma: no cover - calendar with no working days
            d = self.calendar.next_working_day(lo)
            scored = [(0.0, d, False)]
        scored.sort(key=lambda t: (t[0], t[1]))
        best = scored[0][1]
        clustered = bool(r.clustering.by_advocate and self.book.advocates[best].get(case.advocate_id))
        return Suggestion(
            date=best,
            reason=self._reason(case, best, gap, minutes, clustered, pending_note, label),
            alternatives=[
                {"date": alt, "reason": self._reason(case, alt, gap, minutes,
                                                     bool(r.clustering.by_advocate and self.book.advocates[alt].get(case.advocate_id)),
                                                     pending_note, label)}
                for _, alt, _ in scored[1:3]
            ],
            window={"min": lo, "target": target, "max": max(hi, best)},
            load_after=self._load_after(best, minutes),
            vs_flat_default_days=(flat - best).days,
            clustered=clustered,
        )

    def _cost(self, case: Case, d: date, target: date, minutes: float, aged: bool, has_room: bool,
              deadline: date | None) -> float:
        r = self.rules
        cost = abs((d - target).days) + 10 * self.load_ratio(d, minutes)
        if not has_room:
            cost += 100
        if r.clustering.by_advocate and self.book.advocates[d].get(case.advocate_id):
            cost -= 3
        if not self.purpose_allowed(case, d):
            cost += 20
        if aged and self.budget():
            reserve = self.budget() * r.ageing_quota_pct / 100.0
            if reserve > 0 and self.book.aged_minutes[d] >= reserve:
                cost += 5
        if deadline is not None and d > deadline:
            cost += 50  # guardrail: 4+ year cases should be listed within max_wait_days_4y
        return cost

    def _load_after(self, d: date, minutes: float) -> dict:
        budget = self.budget()
        return {"planned": round(self._minutes(d) + minutes, 1),
                "budget": round(budget, 1) if budget is not None else None,
                "listed": self._count(d) + 1}

    def _reason(self, case: Case, d: date, gap: int, minutes: float, clustered: bool,
                pending_note: str | None, label: str | None) -> str:
        budget = self.budget()
        load = self._minutes(d) + minutes
        room = (f"{fmt_day(d)} has room ({load:.0f} of {budget:.0f} min)" if budget
                else f"{fmt_day(d)} ({self._count(d) + 1} listed)")
        head = label or f"{case.next_purpose.label} → reference gap {gap} days"
        text = f"{head}. {room}"
        if pending_note:
            text = f"{pending_note} until {fmt_day(case.pending_until)}. {room}"
        if clustered:
            text += f"; {case.advocate_id} already listed"
        return text
