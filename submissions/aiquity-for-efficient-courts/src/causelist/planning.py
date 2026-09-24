"""Daily causelist planners.

* ``baseline`` -- today's practice: list up to 60, whatever is due, no slots, flat gap.
* ``greedy``   -- value-density knapsack with the ageing floor.
* ``milp``     -- mixed-integer programme: choose cases x slots to maximise expected
                  justice-weighted progress, subject to slot capacity (in expected court
                  minutes plus a small risk buffer), the ageing floor, max listings, and an
                  advocate-clustering bonus.

What a listing is worth
-----------------------
``value = w.substantive * P(substantive) * progress * justice_weight``

*progress* -- the share of the case's remaining journey to disposal that one substantive
hearing completes, with the journey measured in expected court minutes:

    cost(t)   = minutes(t) + (1 / p_sub(t) - 1) * NONSUB_MIN     (reference tables)
    R(s)      = sum of cost(t) along the lifecycle from stage s to JUDGEMENT
    progress  = cost(s) / R(s)                  for a stage hearing (JUDGEMENT -> 1.0 = disposal)
    progress  = cost(i) / (cost(i) + R(stage))  for an interrupt i (bail, reports, review):
                                                it adds one step in front of the stage

Because ``P(sub) * cost(s)`` is roughly the expected minutes of one listing, the value per
expected minute is about ``1 / R(s)``: the rule prefers matters with the *least remaining
judicial work*, i.e. shortest-remaining-processing-time, the textbook rule for maximising
completions per unit of server time. Cheap early-stage hearings are no longer preferred
merely because they are short; a 30-minute judgement (which disposes a case) ranks first.

*justice_weight* -- counters starvation, never below neutral (1.0):

    J = 1 + w.age * age_years / OLD_CASE_YEARS           (a 4-year case: +w.age)
          + STUCK_WEIGHT * max(0, hearings_at_stage / median_hearings(stage) - 1)
          + w.wait * listed_count_current                (bypassed / carried over)
          + UNHEARD_WEIGHT * [old case not heard for UNHEARD_DAYS]

``w.fresh`` adds ``FRESH_PROGRESS`` to the progress of early-stage matters (the
'new matters first' preset); it does not lower anyone's justice weight.
"""
from __future__ import annotations


def _kind_minutes(case, cfg) -> float:
    from .priors import kind_factors      # hearing time by dispute type (priors master list)
    return kind_factors(case, cfg)[0]

import dataclasses
import math
from dataclasses import dataclass
from datetime import date

from .behaviour import case_multiplier, conditional_probs, p_goes_ahead
from .config import (OLD_CASE_YEARS, JudgeConfig, Slot, Weights, effective_ageing_share, sitting_minutes,
                     sitting_windows)
from .duration_model import duration_multiplier, judge_from_config
from .domain import Case, DayPlan, Listing
from .reference import INTERRUPT_TYPES, NEXT_PURPOSE_ON_SUCCESS, STAGE_ORDER, HearingType

CALLOVER_MIN = 1.0    # court time used calling a case that does not go ahead
ADJOURN_MIN = 3.0     # court time used when a case is called, appears, and is adjourned
NONSUB_MIN = 0.5 * (CALLOVER_MIN + ADJOURN_MIN)   # average cost of a hearing that does not move
DURATION_CV2 = math.exp(0.5 ** 2) - 1.0           # squared coeff. of variation of a hearing's length

STUCK_WEIGHT = 0.5    # extra weight per 'median hearings' a case has already spent at its stage
UNHEARD_WEIGHT = 1.0  # old case not heard recently (or never within the planning window)
UNHEARD_DAYS = 60
PROGRESS_BASE = 0.5  # every substantive hearing is worth this much; the rest is closeness to disposal
FRESH_PROGRESS = 0.1  # progress credit per unit of weights.fresh for early-stage matters
FRESH_STAGES = set(STAGE_ORDER[:4])

RISK_KAPPA = 1.0      # plan expected minutes to capacity + KAPPA standard deviations
POOL_MULT = 5.0       # MILP pool holds ~5x the day's capacity (in expected minutes)
POOL_MAX = 300
CBC_TIME_LIMIT = 10   # seconds; a safety net only -- the node limit keeps runs deterministic
CBC_MAX_NODES = 400
CBC_GAP = 0.002
PROFILE_REF_MONDAY = date(2026, 9, 28)
EMERGENCY_ROLL_WEIGHT = 1.5   # justice-weight bonus for a matter rolled over by a judge emergency:
                              # it keeps its place at the head of the next sitting's list


def _hhmm(m: int) -> str:
    return f"{m // 60:02d}:{m % 60:02d}"


def profile_slots(cfg: JudgeConfig, day: date | None = None) -> list[Slot]:
    """One slot per sitting window ("sitting_1", "sitting_2", ...). Without a day: the envelope of
    each sitting over the working week (used where no day is known, e.g. the validator)."""
    if day is not None:
        windows = sitting_windows(cfg, day)
    else:
        per_day = [sitting_windows(cfg, date.fromordinal(PROFILE_REF_MONDAY.toordinal() + i)) for i in range(5)]
        n = max(len(w) for w in per_day)
        windows = []
        for i in range(n):
            ws = [w[i] for w in per_day if len(w) > i]
            windows.append((min(a for a, _ in ws), max(b for _, b in ws)))
    return [Slot(f"sitting_{i + 1}", _hhmm(a), _hhmm(b)) for i, (a, b) in enumerate(windows)]


def with_reserve(cfg: JudgeConfig, day: date | None = None) -> JudgeConfig:
    """The judge config the planners plan against on ``day``.

    * Day profile: capacity is that day's sitting minutes (``config.sitting_minutes``); without
      explicit slots the day gets one slot per sitting window, so appointment windows never fall in
      lunch or administrative blocks.
    * ``reserve_minutes`` of the day are held back for urgent / emergency matters and not planned.
    Idempotent: the returned config has no profile and no reserve left to apply."""
    if day is not None and getattr(cfg, "day_profile", None):
        cfg = dataclasses.replace(cfg, day_minutes=sitting_minutes(cfg, day),
                                  slots=list(cfg.slots) or profile_slots(cfg, day), day_profile=None)
    r = int(getattr(cfg, "reserve_minutes", 0) or 0)
    if r <= 0:
        return cfg
    return dataclasses.replace(cfg, day_minutes=max(30, cfg.day_minutes - r), reserve_minutes=0)


# ---------------------------------------------------------------------------
# Progress and justice weight (shared with metrics.py)
# ---------------------------------------------------------------------------
def stage_cost(ht: HearingType) -> float:
    """Expected court minutes to obtain one substantive hearing of this type."""
    return ht.minutes + (1.0 / max(ht.p_substantive, 0.05) - 1.0) * NONSUB_MIN


def remaining_cost(stage: str, types: dict[str, HearingType]) -> float:
    total, s, seen = 0.0, stage, set()
    while s is not None and s not in seen:
        seen.add(s)
        ht = types.get(s)
        total += stage_cost(ht) if ht else 0.0
        s = NEXT_PURPOSE_ON_SUCCESS.get(s)
    return total


class ProgressTable:
    """progress(purpose, stage) from the reference tables, memoised."""

    def __init__(self, types: dict[str, HearingType], base: float | None = None):
        self.types = types
        self.base = PROGRESS_BASE if base is None else base
        self.R = {s: remaining_cost(s, types) for s in NEXT_PURPOSE_ON_SUCCESS}
        self._memo: dict[tuple[str, str], float] = {}

    def __call__(self, purpose: str, stage: str) -> float:
        key = (purpose, stage)
        v = self._memo.get(key)
        if v is None:
            ht = self.types.get(purpose)
            if ht is None:
                v = 0.0
            elif purpose in INTERRUPT_TYPES:
                ci = stage_cost(ht)
                v = self.base + (1.0 - self.base) * ci / (ci + self.R.get(stage, 0.0))
            else:
                v = self.base + (1.0 - self.base) * stage_cost(ht) / max(self.R.get(purpose, 0.0), 1e-6)
            self._memo[key] = v
        return v


def justice_weight(age_years: float, hearings_at_stage: int, stage_median: float,
                   listed_count: int, w: Weights, days_since_heard: int | None = None) -> float:
    j = 1.0 + max(w.age, 0.0) * age_years / OLD_CASE_YEARS
    j += STUCK_WEIGHT * max(0.0, hearings_at_stage / max(stage_median, 1.0) - 1.0)
    j += max(w.wait, 0.0) * listed_count
    if age_years >= OLD_CASE_YEARS and (days_since_heard is None or days_since_heard >= UNHEARD_DAYS):
        j += UNHEARD_WEIGHT
    return max(1.0, j)


# ---------------------------------------------------------------------------
@dataclass
class Candidate:
    case: Case
    ht: HearingType
    p_ahead: float
    p_sub: float
    exp_min: float        # expected court-clock minutes (what the day's clock will consume)
    var_min: float        # variance of those minutes
    value: float
    old: bool
    why: list[str]
    duration_mult: float = 1.0   # duration_model multiplier on the reference minutes (judge, recency)

    @property
    def efficiency(self) -> float:
        return self.value / max(self.exp_min, 0.5)


def default_slots(cfg: JudgeConfig) -> list[Slot]:
    if cfg.slots:
        return cfg.slots
    if getattr(cfg, "day_profile", None):
        return profile_slots(cfg)
    h, m = map(int, cfg.day_start.split(":"))
    end = h * 60 + m + cfg.day_minutes
    return [Slot("day", cfg.day_start, f"{end // 60:02d}:{end % 60:02d}")]


def slot_fits(slot: Slot, c: Candidate, day: date) -> bool:
    if slot.purposes and c.case.purpose not in slot.purposes:
        return False
    return c.case.age_years(day) >= slot.min_age_years


def clock_moments(c: Case, ht: HearingType, p_ahead: float, appointment: bool,
                  minutes: float | None = None) -> tuple[float, float, float]:
    """(P(substantive), E[clock minutes], Var[clock minutes]) for one listing, mirroring the
    outcomes the court can observe: absent -> call-over, time sought / court side -> short
    adjournment, otherwise the full hearing (lognormal length around the reference mean)."""
    p = conditional_probs(ht)
    m = case_multiplier(c, appointment)
    p_abs, p_seek = p["absent"] * m, p["seek"] * m
    share_abs = p_abs / (p_abs + p_seek) if p_abs + p_seek > 0 else 0.5
    p_court = min(0.9, p["court"])
    p_fail = 1.0 - p_ahead
    p_sub = p_ahead * (1.0 - p_court)
    p_adj = p_ahead * p_court + p_fail * (1.0 - share_abs)
    p_call = p_fail * share_abs
    hm = ht.minutes if minutes is None else minutes
    e1 = p_sub * hm + p_adj * ADJOURN_MIN + p_call * CALLOVER_MIN
    e2 = (p_sub * hm ** 2 * (1.0 + DURATION_CV2) + p_adj * ADJOURN_MIN ** 2
          + p_call * CALLOVER_MIN ** 2)
    return p_sub, e1, max(0.0, e2 - e1 * e1)


def build_candidates(day: date, eligible: list[Case], cfg: JudgeConfig,
                     types: dict[str, HearingType], signals: dict[str, float],
                     progress: ProgressTable | None = None) -> tuple[list[Candidate], list[tuple[str, str]]]:
    cands: list[Candidate] = []
    held: list[tuple[str, str]] = []
    w = cfg.weights
    progress = progress or ProgressTable(types)
    judge = judge_from_config(cfg)
    for c in eligible:
        ht = types.get(c.purpose)
        if ht is None:
            held.append((c.case_id, f"unknown purpose {c.purpose}"))
            continue
        if cfg.use_readiness and c.ready_on and c.ready_on > day and c.meta.get("prereq_visible"):
            item = c.meta.get("checklist_item")
            held.append((c.case_id, f"checklist: {item} not met" if item
                         else f"prerequisite pending until {c.ready_on.isoformat()}"))
            continue
        p_ahead = signals.get(c.case_id, p_goes_ahead(c, ht, cfg.give_appointments))
        age = c.age_years(day)
        dmult = duration_multiplier(judge, c.purpose, c.last_heard_on, day, age) * _kind_minutes(c, cfg)
        p_sub, exp_min, var_min = clock_moments(c, ht, p_ahead, cfg.give_appointments, ht.minutes * dmult)
        prog = progress(c.purpose, c.stage)
        if c.stage in FRESH_STAGES and w.fresh:
            prog += w.fresh * FRESH_PROGRESS
        st = types.get(c.stage)
        since = (day - c.last_heard_on).days if c.last_heard_on else None
        jw = justice_weight(age, c.hearings_at_stage, st.median_hearings if st else 1.0,
                            c.listed_count_current, w, since)
        if c.meta.get("emergency_roll"):
            jw += EMERGENCY_ROLL_WEIGHT
        value = max(w.substantive, 1e-3) * p_sub * prog * jw
        why = [f"P(moves forward) {p_sub:.0%}", f"progress {prog:.2f}", f"justice weight {jw:.2f}",
               f"age {age:.1f}y"]
        if c.listed_count_current:
            why.append(f"carried over x{c.listed_count_current}")
        if c.confirmed_ready:
            why.append("preparedness confirmed")
        if c.meta.get("emergency_roll"):
            why.append("rolled with priority (judge emergency)")
        cands.append(Candidate(c, ht, p_ahead, p_sub, exp_min, var_min, value, age >= OLD_CASE_YEARS, why,
                               round(dmult, 3)))
    return cands, held


def _windows(day: date, chosen: list[tuple[Candidate, Slot]], cfg: JudgeConfig, solver: str,
             held: list[tuple[str, str]], order: str = "value") -> DayPlan:
    """Sequence each slot and give appointment windows.

    ``order="value"`` (planners): advocates' matters sit together; groups and matters run in
    descending value density, so the matters most worth the court's time are called first and
    the low-value, short, uncertain ones form the tail that absorbs the day's variance
    (a not-reached tail matter is carried over with priority). ``order="given"`` keeps the
    incoming order; ``order="legacy"`` reproduces the original sequencing (baseline only)."""
    h, m = map(int, cfg.day_start.split(":"))
    court_start = h * 60 + m
    listings: list[Listing] = []
    for slot in default_slots(cfg):
        in_slot = [c for c, s in chosen if s.name == slot.name]
        if order == "value":
            by_adv: dict[str, list[Candidate]] = {}
            for c in in_slot:
                by_adv.setdefault(c.case.advocate_id, []).append(c)
            groups = [sorted(g, key=lambda x: (-x.efficiency, x.case.case_id)) for g in by_adv.values()]
            groups.sort(key=lambda g: (-g[0].efficiency, g[0].case.case_id))
            seq = [c for g in groups for c in g]
        elif order == "legacy":
            by_adv = {}
            for c in in_slot:
                by_adv.setdefault(c.case.advocate_id, []).append(c)
            groups = sorted(by_adv.values(), key=lambda g: (-sum(x.efficiency for x in g)))
            seq = [c for g in groups for c in sorted(g, key=lambda x: -x.efficiency)]
        else:
            seq = in_slot
        s0, s1 = slot.minutes()
        t = float(s0 - court_start)
        for c in seq:
            # the risk buffer can push the running clock past the slot end: the last window is
            # always the final half hour of the slot, never after it
            start = max(min(int(t // 30 * 30), int(s1 - court_start) - 30), int(s0 - court_start))
            end = min(int(s1 - court_start), start + 60) if cfg.give_appointments else int(s1 - court_start)
            if not cfg.give_appointments:
                start = int(s0 - court_start)
            lst = Listing(
                case_id=c.case.case_id, day=day, slot=slot.name, start_min=start, end_min=max(end, start + 30),
                purpose=c.case.purpose, advocate_id=c.case.advocate_id, expected_minutes=round(c.exp_min, 1),
                p_goes_ahead=round(c.p_ahead, 3), p_substantive=round(c.p_sub, 3), score=round(c.value, 3 if order == "legacy" else 4),
                why=c.why)
            lst.duration_mult = c.duration_mult      # exported per listing (not part of the domain contract)
            listings.append(lst)
            t += c.exp_min
    exp = sum(x.expected_minutes for x in listings)
    return DayPlan(day, listings, cfg.day_minutes, round(exp, 1), held, solver)


def _slot_caps(cfg: JudgeConfig, cands: list[Candidate] | None = None) -> dict[str, float]:
    """Expected-minute budget per slot: capacity x fill x overbook, plus a risk buffer of
    RISK_KAPPA standard deviations, where the standard deviation is estimated from the
    variance-per-expected-minute of the most valuable candidates (so a day of long, uncertain
    hearings gets a larger buffer than a day of short, certain ones)."""
    slots = default_slots(cfg)
    raw = {}
    for s in slots:
        a, b = s.minutes()
        raw[s.name] = float(b - a)
    total = sum(raw.values())
    base_total = cfg.day_minutes * cfg.fill_target * cfg.overbook
    scale = min(1.0, cfg.day_minutes / total) if total else 1.0
    caps = {k: v * scale * cfg.fill_target * cfg.overbook for k, v in raw.items()}
    if cands:
        top = sorted(cands, key=lambda c: -c.efficiency)
        e = v = 0.0
        for c in top:
            if e >= base_total:
                break
            e += c.exp_min
            v += c.var_min
        if e > 0:
            ratio = v / e
            # variances add across the day: one buffer for the whole day, shared by the slots
            tot = sum(max(c, 0.0) for c in caps.values())
            buf = getattr(cfg, "risk_kappa", RISK_KAPPA) * math.sqrt(tot * ratio)
            for k in caps:
                caps[k] += buf * (max(caps[k], 0.0) / tot if tot else 0.0)
    return caps


# ---------------------------------------------------------------------------
def plan_baseline(day: date, eligible: list[Case], cfg: JudgeConfig,
                  types: dict[str, HearingType], signals: dict[str, float]) -> DayPlan:
    """Today's practice: list whatever is due, oldest next-date first, up to max_listed; no slots."""
    cfg = with_reserve(cfg, day)
    base_cfg = JudgeConfig(**{**cfg.__dict__, "use_readiness": False, "give_appointments": False, "slots": []})
    cands, held = _legacy_candidates(day, eligible, base_cfg, types)
    cands.sort(key=lambda c: (c.case.next_date or date.min, c.case.case_id))
    slot = default_slots(base_cfg)[0]
    chosen = [(c, slot) for c in cands[: cfg.max_listed]]
    return _windows(day, chosen, base_cfg, "baseline", held, order="legacy")


def _legacy_candidates(day: date, eligible: list[Case], cfg: JudgeConfig,
                       types: dict[str, HearingType]) -> tuple[list[Candidate], list[tuple[str, str]]]:
    """The baseline's scoring, unchanged from the first version of this module.

    The simulator calls an un-timed list in descending ``score`` order, so the baseline's
    score must stay as it was for the comparison to remain a fixed yardstick."""
    cands: list[Candidate] = []
    held: list[tuple[str, str]] = []
    w = cfg.weights
    for c in eligible:
        ht = types.get(c.purpose)
        if ht is None:
            held.append((c.case_id, f"unknown purpose {c.purpose}"))
            continue
        p_ahead = p_goes_ahead(c, ht, cfg.give_appointments)
        p_sub = p_ahead * (1.0 - min(0.9, conditional_probs(ht)["court"]))
        exp_min = p_ahead * ht.minutes + (1 - p_ahead) * CALLOVER_MIN
        age = c.age_years(day)
        stage_idx = STAGE_ORDER.index(c.stage) if c.stage in STAGE_ORDER else 0
        value = p_sub * (w.substantive + w.age * age + w.wait * c.listed_count_current
                         + w.fresh * (1.0 if stage_idx <= 3 else 0.0))
        why = [f"P(moves forward) {p_sub:.0%}", f"age {age:.1f}y"]
        if c.listed_count_current:
            why.append(f"carried over x{c.listed_count_current}")
        cands.append(Candidate(c, ht, p_ahead, p_sub, exp_min, 0.0, value, age >= OLD_CASE_YEARS, why))
    return cands, held


def _old_target(cfg: JudgeConfig, cands: list[Candidate], budget: float) -> tuple[float, float]:
    old_frac = sum(c.exp_min for c in cands if c.old) / max(sum(c.exp_min for c in cands), 1e-6)
    alpha = effective_ageing_share(cfg, old_frac)
    return alpha, alpha * budget


def _greedy_select(day: date, cands: list[Candidate], cfg: JudgeConfig,
                   caps: dict[str, float]) -> list[tuple[Candidate, Slot]]:
    slots = default_slots(cfg)
    used = {s.name: 0.0 for s in slots}
    chosen: list[tuple[Candidate, Slot]] = []
    alpha, old_target = _old_target(cfg, cands, sum(caps.values()))

    def place(c: Candidate) -> bool:
        for s in slots:
            if slot_fits(s, c, day) and used[s.name] + c.exp_min <= caps[s.name]:
                used[s.name] += c.exp_min
                chosen.append((c, s))
                return True
        return False

    order = sorted(cands, key=lambda c: (-c.efficiency, c.case.case_id))
    taken: set[str] = set()
    old_used = 0.0
    for c in order:
        if not c.old:
            continue
        if old_used >= old_target or len(chosen) >= cfg.max_listed:
            break
        if place(c):
            old_used += c.exp_min
            taken.add(c.case.case_id)
    for c in order:
        if len(chosen) >= cfg.max_listed:
            break
        if c.case.case_id not in taken and place(c):
            taken.add(c.case.case_id)
    return chosen


def plan_greedy(day: date, eligible: list[Case], cfg: JudgeConfig,
                types: dict[str, HearingType], signals: dict[str, float]) -> DayPlan:
    cfg = with_reserve(cfg, day)
    cands, held = build_candidates(day, eligible, cfg, types, signals)
    caps = _slot_caps(cfg, cands)
    chosen = _greedy_select(day, cands, cfg, caps)
    ids = {c.case.case_id for c, _ in chosen}
    held += [(c.case.case_id, "capacity") for c in cands if c.case.case_id not in ids]
    return _windows(day, chosen, cfg, "greedy", held)


def select_pool(day: date, cands: list[Candidate], cfg: JudgeConfig, caps: dict[str, float],
                alpha: float) -> list[Candidate]:
    """Candidates the MILP chooses from: the most valuable ~POOL_MULT x capacity, plus enough
    of the best old cases to satisfy the ageing floor twice over, plus enough candidates that
    fit each restricted slot. Deterministic (ties broken by case id)."""
    order = sorted(cands, key=lambda c: (-c.efficiency, c.case.case_id))
    budget = sum(caps.values())
    picked: dict[str, Candidate] = {}
    acc = 0.0
    for c in order:
        if acc >= POOL_MULT * budget or len(picked) >= POOL_MAX:
            break
        picked[c.case.case_id] = c
        acc += c.exp_min
    acc = 0.0
    for c in order:
        if acc >= 2.0 * alpha * budget:
            break
        if c.old:
            picked.setdefault(c.case.case_id, c)
            acc += c.exp_min
    for s in default_slots(cfg):
        if not (s.purposes or s.min_age_years):
            continue
        acc = 0.0
        for c in order:
            if acc >= 3.0 * caps[s.name]:
                break
            if slot_fits(s, c, day):
                picked.setdefault(c.case.case_id, c)
                acc += c.exp_min
    return sorted(picked.values(), key=lambda c: (-c.efficiency, c.case.case_id))


def plan_milp(day: date, eligible: list[Case], cfg: JudgeConfig,
              types: dict[str, HearingType], signals: dict[str, float],
              time_limit: int = CBC_TIME_LIMIT) -> DayPlan:
    import pulp

    cfg = with_reserve(cfg, day)
    cands, held = build_candidates(day, eligible, cfg, types, signals)
    if not cands:
        return _windows(day, [], cfg, "milp(empty)", held)
    caps = _slot_caps(cfg, cands)
    budget = sum(caps.values())
    alpha, _ = _old_target(cfg, cands, budget)
    pool = select_pool(day, cands, cfg, caps, alpha)
    slots = default_slots(cfg)

    prob = pulp.LpProblem("causelist", pulp.LpMaximize)
    x = {(i, s.name): pulp.LpVariable(f"x_{i}_{k}", cat="Binary")
         for i, c in enumerate(pool) for k, s in enumerate(slots) if slot_fits(s, c, day)}
    by_case: dict[int, list] = {}
    for (i, _), v in x.items():
        by_case.setdefault(i, []).append(v)
    listed = {i: pulp.lpSum(vs) for i, vs in by_case.items()}

    # Advocate clustering: bonus for every matter beyond the first an advocate has that day.
    # Aggregated linking  M_a * u_a >= n_a  (one row per advocate, not one per case).
    by_adv: dict[str, list[int]] = {}
    for i in listed:
        by_adv.setdefault(pool[i].case.advocate_id, []).append(i)
    multi = {a: ix for a, ix in sorted(by_adv.items()) if len(ix) >= 2}
    u = {a: pulp.LpVariable(f"u_{j}", cat="Binary") for j, a in enumerate(multi)}
    n_by_adv = {a: pulp.lpSum(listed[i] for i in ix) for a, ix in multi.items()}

    # Scale the clustering bonus to the value scale so its meaning survives the new objective:
    # one extra same-advocate matter is worth `cluster` x the median candidate value.
    vals = sorted(c.value for c in pool)
    unit = vals[len(vals) // 2] if vals else 1.0
    prob += (pulp.lpSum(pool[i].value * v for (i, _), v in x.items())
             + cfg.weights.cluster * unit * pulp.lpSum(n_by_adv[a] - u[a] for a in multi))

    for i, expr in listed.items():
        if len(by_case[i]) > 1:
            prob += expr <= 1
    for s in slots:
        prob += pulp.lpSum(pool[i].exp_min * v for (i, sn), v in x.items() if sn == s.name) <= caps[s.name]
    prob += pulp.lpSum(listed.values()) <= cfg.max_listed
    for a, ix in multi.items():
        prob += len(ix) * u[a] >= n_by_adv[a]
    # Non-configurable ageing floor (only when old cases are available to list).
    old_min = pulp.lpSum(pool[i].exp_min * v for (i, _), v in x.items() if pool[i].old)
    all_min = pulp.lpSum(pool[i].exp_min * v for (i, _), v in x.items())
    old_supply = sum(c.exp_min for c in pool if c.old)
    if old_supply > 0 and alpha > 0:
        if old_supply >= alpha * budget:
            prob += old_min >= alpha * all_min
        else:
            prob += old_min >= 0.999 * old_supply

    # Warm start from the greedy selection on the same pool.
    greedy = {(c.case.case_id, s.name) for c, s in _greedy_select(day, pool, cfg, caps)}
    for (i, sn), v in x.items():
        v.setInitialValue(1 if (pool[i].case.case_id, sn) in greedy else 0)
    for a, ix in multi.items():
        u[a].setInitialValue(1 if any((pool[i].case.case_id, s.name) in greedy for i in ix for s in slots) else 0)

    solver = pulp.PULP_CBC_CMD(msg=False, timeLimit=time_limit, threads=1, gapRel=CBC_GAP, warmStart=True,
                               options=["randomSeed 42", f"maxNodes {CBC_MAX_NODES}"])
    status = prob.solve(solver)
    if pulp.LpStatus[status] != "Optimal" or all((v.value() or 0) < 0.5 for v in x.values()):
        plan = plan_greedy(day, eligible, cfg, types, signals)
        plan.solver = f"greedy(fallback:{pulp.LpStatus[status]})"
        return plan

    slot_by_name = {s.name: s for s in slots}
    chosen = [(pool[i], slot_by_name[sn]) for (i, sn), v in x.items() if (v.value() or 0) > 0.5]
    ids = {c.case.case_id for c, _ in chosen}
    held += [(c.case.case_id, "capacity") for c in cands if c.case.case_id not in ids]
    return _windows(day, chosen, cfg, f"milp/cbc:{pulp.LpStatus[status]}", held)


PLANNERS = {"baseline": plan_baseline, "greedy": plan_greedy, "milp": plan_milp}
