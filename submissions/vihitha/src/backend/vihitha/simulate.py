"""Forward simulation over the real planner (used by what-if, forecasts of KPIs and the CLI).

Each sitting day: top up the planning horizon with `planner.assign_pool`, pack the day into
windows (`windows.pack_day`), walk it with the outcome sampler, then apply lifecycle, next
dates and carry-forward. The API's schedule uses the same planner and packer, so a
simulation from the stored state is "what would happen if the court kept these rules".
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date

from . import day_runner
from .calendar import CourtCalendar
from .enums import BUCKETS
from .estimates import expected_minutes
from .models import Case, DayRecord, HearingRecord, Outcome, RosterCase
from .next_date import LoadBook, Scheduler
from .parser import accused_seen, initial_pending_until
from .planner import assign_pool, commit, held_back
from .priority import score as priority_score
from .reference import Reference
from .rules import Rules
from .windows import PackItem, pack_day

PRIOR_STRENGTH = 10.0  # Beta prior pseudo-count for learned show-up (v2 section 6.8)
DEFAULT_HORIZON_WORKING_DAYS = 20  # [ASSUMPTION] about a month is kept planned


def build_cases(roster: list[RosterCase], ref: Reference, start: date, seed: int) -> dict[str, Case]:
    """Roster rows -> engine cases at `start` (existing next dates are ignored by design)."""
    cases: dict[str, Case] = {}
    for r in roster:
        pending_until, why = initial_pending_until(r.parsed, r.filing_number, r.next_purpose, start, seed, ref.gap)
        p = ref.p_show_base(r.next_purpose)
        alpha, beta = PRIOR_STRENGTH * p, PRIOR_STRENGTH * (1 - p)
        if r.parsed.attendance.accused is True:
            alpha += 2
        cases[r.filing_number] = Case(
            filing_number=r.filing_number, case_number=r.case_number, advocate_id=r.advocate_id,
            party_id=r.party_id, filing_date=r.filing_date, stage=r.stage, next_purpose=r.next_purpose,
            hearing_counts=dict(r.hearing_counts), order=r.order,
            hearings_at_stage=r.hearing_counts.get(r.stage, 0),
            pending_until=pending_until, pending_reason=why,
            last_chance=r.parsed.last_chance, accused_seen=accused_seen(r.parsed, r.stage),
            posterior_show=(alpha, beta),
        )
    return cases


def pending_by_bucket(cases: dict[str, Case], on: date) -> dict[str, int]:
    out = {b: 0 for b in BUCKETS}
    for c in cases.values():
        if not c.disposed:
            out[c.age_bucket(on)] += 1
    return out


@dataclass
class SimState:
    """Cases plus committed future hearings (in the load book)."""
    cases: dict[str, Case]
    sched: Scheduler
    carried: set[str] = field(default_factory=set)  # hearings already marked carried forward
    reasons: dict[str, str] = field(default_factory=dict)  # case id -> reason of its committed listing


@dataclass
class SimResult:
    seed: int
    start: date
    end: date
    sitting_days: list[date]
    capacity_minutes: int
    days: list[DayRecord]
    cases: dict[str, Case]
    start_ages: dict[str, float]
    initial_pending_by_bucket: dict[str, int]
    show_rate: float | None
    rules_name: str


def new_state(cases: dict[str, Case], calendar: CourtCalendar, rules: Rules, ref: Reference,
              horizon_start: date) -> SimState:
    sched = Scheduler(calendar=calendar, rules=rules, ref=ref, book=LoadBook(), horizon_start=horizon_start)
    return SimState(cases=cases, sched=sched)


def horizon_days(calendar: CourtCalendar, d: date, n: int) -> list[date]:
    out, cur = [], d
    while len(out) < n:
        cur = calendar.next_working_day(cur)
        out.append(cur)
        cur = date.fromordinal(cur.toordinal() + 1)
    return out


PUBLISH_LEAD_DAYS = 5  # [ASSUMPTION] lists are published (firm) about a week ahead


def top_up(state: SimState, d: date, n_days: int, seed: int, horizon_start: date) -> None:
    """Re-plan the soft (tentative) listings every day, as the API does after every change.

    Listings within the publish lead become firm; later ones go back to the pool so court orders
    (next dates, carry-forwards) come first and the planner fills the time left around them.
    """
    sched = state.sched
    days = horizon_days(sched.calendar, d, n_days)
    firm_until = days[min(PUBLISH_LEAD_DAYS, len(days)) - 1]
    for fn in list(sched.book.soft):
        c = state.cases[fn]
        if c.scheduled_date is not None and c.scheduled_date <= firm_until:
            sched.book.harden(fn)  # published
        else:
            sched.book.uncommit(fn)
            c.scheduled_date = None
            c.first_scheduled_date = None
    pool = [c for c in state.cases.values() if not c.disposed and c.scheduled_date is None]
    if not pool:
        return
    soft_from = days[PUBLISH_LEAD_DAYS] if len(days) > PUBLISH_LEAD_DAYS else None
    assigned, _ = assign_pool(pool, days, sched, today=d, seed=seed, horizon_start=horizon_start,
                              soft_from=soft_from)
    for a in assigned:
        state.reasons[a.case_id] = a.reason


def day_items(state: SimState, d: date, horizon_start: date) -> tuple[list[PackItem], list[dict]]:
    """Pack items for everything committed on `d`; prerequisite holds go back to the pool."""
    sched = state.sched
    rules, ref = sched.rules, sched.ref
    items: list[PackItem] = []
    holds: list[dict] = []
    fns = sorted(sched.book.by_date.get(d, {}).items(), key=lambda kv: kv[1])
    for i, (fn, _) in enumerate(fns):
        c = state.cases[fn]
        if c.disposed:
            sched.book.uncommit(fn)
            c.scheduled_date = None
            continue
        if rules.prerequisite_check and c.pending_until and c.pending_until > d:
            sched.book.uncommit(fn)
            c.scheduled_date = None
            holds.append({"case_id": fn, "case_number": c.case_number, "hearing_type": c.next_purpose.value,
                          "reason": c.pending_reason or "Awaiting prerequisite", "eligible_from": c.pending_until})
            continue
        minutes, p = expected_minutes(c, c.next_purpose, d, rules, ref)
        pr = priority_score(c, d, p, rules, horizon_start)
        items.append(PackItem(
            key=fn, purpose=c.next_purpose.value, age_years=c.age_years(d), advocate_id=c.advocate_id,
            carried_forward=c.carried_forward, score=pr.score, expected_minutes=minutes,
            duration_min=ref.duration(c.next_purpose), p_substantive=p, order_hint=i,
        ))
        state.reasons.setdefault(fn, pr.reason)
    return items, holds


def run_day(state: SimState, d: date, seed: int, horizon_start: date, window_minutes: int | None,
            keep_held_back: bool = False) -> DayRecord:
    sched = state.sched
    items, holds = day_items(state, d, horizon_start)
    packed = pack_day(d, items, sched.rules, window_minutes)
    order = packed.ordered()
    walk_items = [day_runner.WalkItem(state.cases[p.key], state.cases[p.key].next_purpose, p.block_id,
                                      p.est_start, p.est_end) for p in order]
    outcomes = day_runner.walk(walk_items, d, sched, seed)

    records: list[HearingRecord] = []
    for p, w, o in zip(order, walk_items, outcomes):
        c = w.case
        rec = HearingRecord(
            date=d, case_id=c.filing_number, case_number=c.case_number, advocate_id=c.advocate_id,
            party_id=c.party_id, purpose=w.purpose, age_years=round(c.age_years(d), 2), block_id=p.block_id,
            window_start=p.window_start, window_end=p.window_end, est_start=p.est_start, est_end=p.est_end,
            expected_minutes=p.expected_minutes, p_substantive=p.p_substantive,
            reason=state.reasons.pop(c.filing_number, ""), carried_forward=c.carried_forward,
            first_promised_date=c.first_scheduled_date, outcome=o,
        )
        records.append(rec)
        sched.book.uncommit(c.filing_number)
        day_runner.apply_outcome(c, w.purpose, o, d, sched)
        if o.reached:
            if c.disposed:
                continue
            s = day_runner.next_date(c, d, sched)
            m, _ = expected_minutes(c, c.next_purpose, s.date, sched.rules, sched.ref)
            commit(sched, c, s.date, m, d, first=True)
            rec.next_date, rec.next_date_reason = s.date, s.reason
            rec.next_date_gap_ok = day_runner.gap_ok(c, d, s.date, sched)
            state.reasons[c.filing_number] = s.reason
        else:
            nd, reason, m = day_runner.carry_forward(c, d, sched)
            commit(sched, c, nd, m, d)  # keeps first_scheduled_date (predictability)
            rec.next_date, rec.next_date_reason = nd, reason
            state.reasons[c.filing_number] = reason
    used = sum(o.duration for o in outcomes if o.reached)
    hb = holds
    if keep_held_back:
        hb = holds + held_back(list(state.cases.values()), d, sched)
    return DayRecord(date=d, packed=packed, records=records, minutes_used=used, held_back=hb)


def simulate_state(state: SimState, start: date, end: date, seed: int, *,
                   horizon_working_days: int = DEFAULT_HORIZON_WORKING_DAYS,
                   window_minutes: int | None = None, horizon_start: date | None = None,
                   focus_dates: set[date] | None = None) -> SimResult:
    """Simulate from an existing state (fresh roster or a snapshot of the real schedule)."""
    horizon_start = horizon_start or start
    cal = state.sched.calendar
    start_ages = {fn: c.age_years(start) for fn, c in state.cases.items() if not c.disposed}
    initial = pending_by_bucket(state.cases, start)
    days = cal.working_days(start, end)
    records: list[DayRecord] = []
    for d in days:
        top_up(state, d, horizon_working_days, seed, horizon_start)
        rec = run_day(state, d, seed, horizon_start, window_minutes,
                      keep_held_back=bool(focus_dates and d in focus_dates))
        rec.pending_by_bucket = pending_by_bucket(state.cases, d)
        records.append(rec)
    shown = [r.outcome.shown for day in records for r in day.records
             if r.outcome.reached and r.outcome.shown is not None]
    return SimResult(
        seed=seed, start=start, end=end, sitting_days=days, capacity_minutes=state.sched.rules.capacity_minutes,
        days=records, cases=state.cases, start_ages=start_ages, initial_pending_by_bucket=initial,
        show_rate=(sum(shown) / len(shown)) if shown else None, rules_name=state.sched.rules.name,
    )


def simulate_roster(roster: list[RosterCase], calendar: CourtCalendar, ref: Reference, rules: Rules,
                    start: date, end: date, seed: int, *, horizon_working_days: int = DEFAULT_HORIZON_WORKING_DAYS,
                    window_minutes: int | None = None) -> SimResult:
    """Fresh run from the roster (the CLI and the official scoring)."""
    cases = build_cases(roster, ref, start, seed)
    state = new_state(cases, calendar, rules, ref, start)
    return simulate_state(state, start, end, seed, horizon_working_days=horizon_working_days,
                          window_minutes=window_minutes)


def simulate_many(roster, calendar, ref, rules, start, end, seed, runs, **kw) -> list[SimResult]:
    """--runs N uses seeds seed..seed+N-1."""
    return [simulate_roster(roster, calendar, ref, rules, start, end, seed + k, **kw) for k in range(runs)]


def outcome_from_result(result: str, reason_group=None, minutes: int = 0) -> Outcome:
    """A recorded result (Court Master) as an engine outcome."""
    from .enums import ReasonGroup
    if result == "NOT_REACHED":
        return Outcome(reached=False)
    if result == "MOVED_FORWARD":
        return Outcome(reached=True, substantive=True, duration=minutes, shown=True)
    if result == "ADJOURNED":
        g = ReasonGroup(reason_group) if reason_group else ReasonGroup.UNCLEAR
        return Outcome(reached=True, substantive=False, reason_group=g, duration=minutes,
                       shown=(g != ReasonGroup.ABSENCE))
    # DISPOSED: handled by the caller (disposal type); counts as reached
    return Outcome(reached=True, substantive=False, duration=minutes, shown=True)
