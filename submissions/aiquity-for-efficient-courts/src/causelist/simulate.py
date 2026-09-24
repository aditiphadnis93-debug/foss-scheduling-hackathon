"""Run a judge's court forward day by day: plan -> hold hearings -> recommend next dates -> repeat.

Deterministic for a given seed. The planner only ever sees what a court could know in
advance; the day itself is sampled from the behaviour model.
"""
from __future__ import annotations


def _kind_minutes(case, cfg) -> float:
    from .priors import kind_factors      # hearing time by dispute type (priors master list)
    return kind_factors(case, cfg)[0]

import copy
import dataclasses
import hashlib
import inspect
import math
import random
from dataclasses import dataclass, field
from datetime import date, timedelta
from functools import lru_cache
from typing import Any

import yaml

from . import attribution
from .audit import AuditLog
from .behaviour import SOUGHT_TIME, StatisticalBehaviour
from .config import CONFIG_DIR, JudgeConfig, sitting_minutes, sitting_windows
from .duration_model import duration_multiplier, judge_from_config
from .domain import Case, DayResult, Event, HearingOutcome, Listing
from .interfaces import Behaviour, HearingContext, InflowSource
from .horizon import booked_load, daily_capacity, first_day_with_room, plan_horizon, publish
from .planning import ADJOURN_MIN, CALLOVER_MIN, PLANNERS, build_candidates
from .reference import (INTERRUPT_TYPES, NEXT_PURPOSE_ON_SUCCESS, REASON_GROUPS, HearingType,
                        load_hearing_types, working_days)

DEFAULT_START = date(2026, 9, 28)
DEFAULT_END = date(2026, 12, 11)      # ~2.5 months of sittings
DURATION_SIGMA = 0.5                  # lognormal spread of hearing duration around the reference mean
STANDBY_BACKFILL = True               # call extra matters from a standby list when the day ends early
STANDBY_SLACK_MIN = 10                # ...only when at least this many minutes remain

# --- court operations (stated assumptions) ---------------------------------------------------
AGENCY_REASONS = ("Awaiting Process / Summons / Warrant Return", "External Dependency")
AGENCY_PURPOSES = {"APPEARANCE", "WARRANT", "REPORTS"}   # their checklist items are agency work
FALLBACK_AGENCY_ITEM = "process / report from the agency returned"
FALLBACK_PARTY_ITEM = "filing for {purpose} complete"
MAX_PREREQ_P = 0.95
URGENT_TYPES = (("BAIL", 0.6), ("APPLICATION_REVIEW", 0.4))   # urgent mentions: type and share
EMERGENCY_LOSS_MIN = (90, 240)        # a judge emergency takes this many minutes off the day (uniform)
EMERGENCY_REASON = "Judge emergency \u2014 rolled with priority"
GAMING_FIRM_GAP_DAYS = 7              # a flagged strategic adjournment gets at most this gap, firm
AUDIT_CAPACITY_SUMMARY = True         # capacity hold-backs: one aggregate entry per day, not one per case


@dataclass
class SimResult:
    config: JudgeConfig
    start: date
    end: date
    seed: int
    days: list[DayResult]
    cases: list[Case]
    initial: list[Case]
    events: list[Event] = field(default_factory=list)
    behaviour: str = "statistical"
    inflow: str | None = None
    audit: list[dict] = field(default_factory=list)
    day_ops: dict[date, dict] = field(default_factory=dict)   # reserve_used, urgent, judge_emergency per day
    learner: Any = None                                        # the behaviour object (for profiles)


def sample_duration(ht: HearingType, rng: random.Random, mult: float = 1.0) -> float:
    """Lognormal hearing length; ``mult`` (duration_model) scales the mean."""
    mu = math.log(ht.minutes * mult) - DURATION_SIGMA ** 2 / 2
    return max(1.0, rng.lognormvariate(mu, DURATION_SIGMA))


def next_working(d: date, days: list[date]) -> date:
    for x in days:
        if x >= d:
            return x
    return d


def _u(*keys: Any) -> float:
    """Deterministic uniform in [0, 1) keyed on the arguments (does not touch any random stream)."""
    h = hashlib.sha256("|".join(map(str, keys)).encode()).digest()
    return int.from_bytes(h[:8], "big") / 2 ** 64


@lru_cache(maxsize=8)
def load_checklists(key: str = "default") -> dict[str, list[str]]:
    p = CONFIG_DIR / "checklists.yaml"
    raw = yaml.safe_load(p.read_text()) if p.exists() else {}
    return dict((raw or {}).get(key) or (raw or {}).get("default") or {})


def agency_share(ht: HearingType) -> float:
    """Share of the purpose's prerequisite failures that are state-agency work."""
    pre = [ht.reason_shares.get(r, 0.0) for r in REASON_GROUPS["PREREQ"]]
    tot = sum(pre)
    return sum(ht.reason_shares.get(r, 0.0) for r in AGENCY_REASONS) / tot if tot > 0 else 0.0


def prereq_p(ht: HearingType, cfg: JudgeConfig) -> float:
    """P(prerequisite unmet at an attempt). ``agency_delay_mult`` scales only the agency share:
    p = p_prereq * ((1 - a) + a * mult), a = agency share of the purpose's prerequisite reasons."""
    mult = float(getattr(cfg, "agency_delay_mult", 1.0) or 0.0)
    if mult == 1.0:
        return ht.p_prereq
    a = agency_share(ht)
    return min(MAX_PREREQ_P, ht.p_prereq * ((1.0 - a) + a * mult))


def assign_checklist_item(case: Case, ht: HearingType, cfg: JudgeConfig, today: date, seed: Any) -> None:
    """Name the unmet checklist item behind a pending prerequisite (and the reason label it maps to).

    The reason is drawn from the purpose's prerequisite reason shares (agency reasons weighted by
    ``agency_delay_mult``). Agency purposes (APPEARANCE, WARRANT, REPORTS) always carry an agency
    reason; their items are the process / warrant / report the agency owes the court."""
    mult = float(getattr(cfg, "agency_delay_mult", 1.0) or 0.0)
    reasons = REASON_GROUPS["PREREQ"]
    w = [(ht.reason_shares.get(r, 0.0) + 1e-6) * (mult if r in AGENCY_REASONS else 1.0) for r in reasons]
    items = load_checklists(getattr(cfg, "checklists", "default") or "default").get(case.purpose) or []
    if case.purpose in AGENCY_PURPOSES:
        w = [x if r in AGENCY_REASONS else 0.0 for r, x in zip(reasons, w)]
        if sum(w) <= 0:
            w = [1.0 if r == AGENCY_REASONS[0] else 0.0 for r in reasons]
    u = _u(seed, case.case_id, today.isoformat(), "reason") * sum(w)
    reason = reasons[-1]
    for r, x in zip(reasons, w):
        if u < x:
            reason = r
            break
        u -= x
    by_state = reason in AGENCY_REASONS
    if items and (by_state == (case.purpose in AGENCY_PURPOSES) or not by_state):
        item = items[int(_u(seed, case.case_id, today.isoformat(), "item") * len(items))]
    else:
        item = FALLBACK_AGENCY_ITEM if by_state else FALLBACK_PARTY_ITEM.format(purpose=case.purpose.lower())
    case.meta["checklist_item"] = item
    case.meta["checklist_reason"] = reason
    case.meta["checklist_agency"] = by_state


def draw_attempt(case: Case, types: dict[str, HearingType], cfg: JudgeConfig, rng: random.Random,
                 today: date, seed: Any = 0, audit: AuditLog | None = None) -> None:
    """Per-attempt prerequisite latent for the case's NEXT hearing, calibrated by construction.

    With probability ``p_prereq`` of the purpose the prerequisite (process served, filing ready)
    will be unmet at the next attempt. A share ``readiness_visibility`` of those is known to the
    court in advance: they get a re-check date (``ready_on``) and readiness-aware planners hold
    them back; the rest are invisible and fail on the day as ``not_ready``.
    """
    ht = types.get(case.purpose)
    pending = bool(ht) and rng.random() < prereq_p(ht, cfg)
    case.meta["prereq_pending"] = pending
    if pending:
        visible = rng.random() < cfg.readiness_visibility
        case.meta["prereq_visible"] = visible
        case.ready_on = today + timedelta(days=max(1, ht.ideal_gap_days // 2)) if visible else None
        assign_checklist_item(case, ht, cfg, today, seed)
        if visible:
            # a prerequisite problem the court caught before anyone travelled
            case.meta["prereq_foreseen"] = case.meta.get("prereq_foreseen", 0) + 1
        if visible and cfg.use_readiness:
            # a visible unmet checklist item: no published date until it clears
            old = case.published_date
            case.published_date = None
            if audit is not None:
                item = case.meta["checklist_item"]
                audit.add(today, case.case_id, "held_back", "checklist", f"checklist: {item} not met",
                          before=old, after=None,
                          actor=attribution.stakeholder_for("not_ready", case.meta["checklist_reason"]),
                          recheck_on=case.ready_on)
    else:
        case.meta["prereq_visible"] = False
        case.ready_on = None


def recheck_prerequisites(cases: list[Case], types: dict[str, HearingType], rng: random.Random,
                          day: date, cfg: JudgeConfig | None = None, audit: AuditLog | None = None) -> None:
    """Morning re-check of visible pending prerequisites whose re-check date has come.

    A cleared item gives the case back to the horizon (it can be published again that evening)."""
    for c in cases:
        if c.status != "pending" or not c.meta.get("prereq_pending") or not c.ready_on or c.ready_on > day:
            continue
        ht = types.get(c.purpose)
        p = prereq_p(ht, cfg) if (ht and cfg is not None) else (ht.p_prereq if ht else 0.0)
        if ht and rng.random() < p:        # process re-served, still not back
            c.ready_on = day + timedelta(days=max(1, ht.ideal_gap_days // 2))
        else:
            c.meta["prereq_pending"] = False
            c.ready_on = None
            if audit is not None and c.meta.get("checklist_item"):
                audit.add(day, c.case_id, "held_back", "checklist-cleared",
                          f"checklist: {c.meta['checklist_item']} met; matter can be dated again",
                          before="unmet", after="met", actor="court")


def seed_prerequisites(cases: list[Case], types: dict[str, HearingType], start: date,
                       cfg: JudgeConfig, rng: random.Random, seed: Any = 0, audit: AuditLog | None = None) -> None:
    """Initial state: draw the prerequisite latent for each case's first attempt."""
    for c in cases:
        draw_attempt(c, types, cfg, rng, start, seed, audit)
        c.next_date = None


def recommend_next_date(case: Case, outcome_kind: str, reason: str | None, today: date,
                        types: dict[str, HearingType], cfg: JudgeConfig, sittings: list[date],
                        load: dict[date, float] | None = None, exp_min: float = 0.0) -> date:
    """Goal 5: match the gap to the procedural need instead of a flat default.

    With ``load`` (the booked expected minutes per date, horizon mode only) the date is the first
    sitting day on/after the procedural date that still has room for this case.
    """
    return next_date_with_rule(case, outcome_kind, reason, today, types, cfg, sittings, load, exp_min)[0]


def next_date_with_rule(case: Case, outcome_kind: str, reason: str | None, today: date,
                        types: dict[str, HearingType], cfg: JudgeConfig, sittings: list[date],
                        load: dict[date, float] | None = None, exp_min: float = 0.0) -> tuple[date, str]:
    """``recommend_next_date`` plus the rule that produced the date (for the audit log)."""
    if cfg.next_date_policy == "flat":
        return next_working(today + timedelta(days=cfg.flat_gap_days), sittings), "flat"
    ht = types.get(case.purpose)
    gap = ht.ideal_gap_days if ht else 14
    if outcome_kind == "not_reached":
        if cfg.carry_over == "same_weekday":
            return next_working(today + timedelta(days=7), sittings), "carry-same-weekday"
        return next_working(today + timedelta(days=1), sittings), "carry-next-day"
    if outcome_kind == "not_ready" and case.ready_on:
        base = next_working(max(case.ready_on, today + timedelta(days=1)), sittings)
        rule = "prerequisite"
    else:
        rule = "procedural"
        if reason in REASON_GROUPS["ATTEND"]:
            gap = min(gap, 14)          # absence / time sought: short, firm return date
            rule = "absence-short"
        base = next_working(today + timedelta(days=max(1, gap)), sittings)
    if load is not None:
        d = first_day_with_room(base, exp_min, load, lambda x: daily_capacity(cfg, x), sittings)
        if d is not None and d != base:
            return d, "capacity-aware"
        return d or base, rule
    return base, rule


def _poisson(mean: float, rng: random.Random) -> int:
    if mean <= 0:
        return 0
    lim, k, p = math.exp(-mean), 0, 1.0
    while True:
        p *= rng.random()
        if p <= lim:
            return k
        k += 1


def _accepts(cls: Any, name: str) -> bool:
    try:
        return name in inspect.signature(cls).parameters
    except (TypeError, ValueError):
        return False


def build_behaviour(cfg: JudgeConfig, seed: int, types: dict[str, HearingType],
                    behaviour: Behaviour | None = None, absence_mult: float | None = None) -> Behaviour:
    """Default behaviour = StatisticalBehaviour (with ``gaming_share`` / ``absence_mult`` when its
    constructor takes them); with ``cfg.learning`` any behaviour is wrapped in LearningBehaviour."""
    if behaviour is None:
        kw: dict[str, Any] = {}
        if _accepts(StatisticalBehaviour, "gaming_share"):
            kw["gaming_share"] = cfg.gaming_share
        if absence_mult is not None and _accepts(StatisticalBehaviour, "absence_mult"):
            kw["absence_mult"] = absence_mult
        behaviour = StatisticalBehaviour(cfg.advocate_correlation, seed, **kw)
        if absence_mult is not None and "absence_mult" not in kw and hasattr(behaviour, "absence_mult"):
            behaviour.absence_mult = absence_mult
    if getattr(cfg, "learning", False):
        from .learning import LearningBehaviour
        if not isinstance(behaviour, LearningBehaviour):
            behaviour = LearningBehaviour(behaviour, types, seed)
    return behaviour


def _flagged_side_sought(flag: dict, reason: str | None, dec: Any, case: Case | None = None) -> bool:
    """Was this adjournment sought by the side the learning model flagged?

    Time sought: yes, unless the decision names a different side. Absence: only an absence of the
    flagged side itself (the opposing side's absence is never treated as gaming)."""
    side = (flag or {}).get("side")
    if side == "advocate":            # an advocate flag stands for the side that advocate represents
        side = "petitioner"
    dec_side = getattr(dec, "side", None) if dec is not None else None
    if dec_side is None and case is not None:
        dec_side = ((case.meta.get("last_request") or {}).get("side"))
    if reason == SOUGHT_TIME:
        return dec_side is None or dec_side == side     # unknown requester: the flag's side (conservative on record)
    if reason == "Petitioner Absence / Non-Compliance":
        return side in ("petitioner", "advocate")
    if reason == "Respondent Absence / Non-Compliance":
        return side == "respondent"
    return False


# Interrupting hearing types (case study 5.1): they can arise between the fixed stages.
# Rates are each type's share of all hearings in the pilot court, estimated from the organiser's
# failure table (non-substantive count / (1 - P(substantive))): bail 5.0%, reports 4.6%,
# applications 1.5% of hearings.
INTERRUPT_RATES = {"BAIL": 0.050, "REPORTS": 0.046, "APPLICATION_REVIEW": 0.015}
BAIL_LAST_STAGE = "EXAMINATION_UNDER_S351_BNSS"   # bail cannot recur once complainant evidence begins


def bail_allowed(case: Case) -> bool:
    from .reference import STAGE_ORDER
    return (case.stage in STAGE_ORDER and STAGE_ORDER.index(case.stage) <= STAGE_ORDER.index(BAIL_LAST_STAGE))


def maybe_interrupt(case: Case, day: date, seed: int) -> str | None:
    """After a called hearing, an interrupting application may be filed before the next step.

    Uses a hashed draw (its own stream) so switching interrupts on or off does not reshuffle the
    rest of the simulation. The case returns to the purpose it was heading for once it is disposed of."""
    if case.status != "pending" or case.purpose in INTERRUPT_TYPES:
        return None
    import hashlib
    u = int.from_bytes(hashlib.sha256(f"{seed}|int|{case.case_id}|{day.isoformat()}".encode()).digest()[:8], "big") / 2 ** 64
    acc = 0.0
    for t, p in INTERRUPT_RATES.items():
        if t == "BAIL" and not bail_allowed(case):
            continue
        acc += p
        if u < acc:
            case.meta["return_purpose"] = case.purpose
            case.purpose = t
            case.meta.setdefault("interrupts", []).append([day.isoformat(), t])
            return t
    return None


def advance(case: Case, types: dict[str, HearingType], cfg: JudgeConfig, rng: random.Random, today: date) -> str | None:
    """Move a case forward after a substantive hearing. Returns the new purpose (None = disposed)."""
    purpose = case.purpose
    if purpose in INTERRUPT_TYPES:
        nxt = case.meta.pop("return_purpose", None) or case.stage
    else:
        nxt = NEXT_PURPOSE_ON_SUCCESS.get(purpose)
        if nxt is None:
            case.status = "disposed"
            return None
        case.stage = nxt
        case.hearings_at_stage = 0
    case.purpose = nxt
    return nxt


def _exp_min(case: Case, day: date, cfg: JudgeConfig, types: dict[str, HearingType]) -> float:
    """Planner's expected court minutes for the case's next hearing (for the booked-load diary)."""
    open_cfg = dataclasses.replace(cfg, use_readiness=False)
    cands, _ = build_candidates(day, [case], open_cfg, types, {})
    est = round(cands[0].exp_min, 2) if cands else 0.0
    case.meta["exp_min_est"] = est
    return est


def run(cases: list[Case], cfg: JudgeConfig, *, behaviour: Behaviour | None = None,
        inflow: InflowSource | None = None, start: date = DEFAULT_START, end: date = DEFAULT_END,
        seed: int = 42, types: dict[str, HearingType] | None = None,
        absence_mult: float | None = None) -> SimResult:
    """Simulate ``cfg`` over ``cases``.

    Court operations (all from the judge config):

    * ``reserve_minutes`` are left out of the planners' capacity every day (planning + horizon).
      Urgent matters (Poisson, mean ``urgent_per_day``; a BAIL or APPLICATION_REVIEW mention for a
      pending case) are heard first, from that reserve; whatever reserve is unused is released to
      the standby backfill at the end of the list.
    * With probability ``judge_emergency_p`` the judge loses EMERGENCY_LOSS_MIN minutes at the end of
      the day: the tail of the list is not heard, those matters roll to the next sitting day with
      priority (reason EMERGENCY_REASON; no change to any party's history).
    * Court-operation draws use their own random stream (``court-ops|seed``), so they do not shift
      the hearing outcomes' stream.
    """
    if types is None:
        from .priors import effective_types     # organiser tables -> court master list -> judge overrides
        types = effective_types(cfg)
    behaviour = build_behaviour(cfg, seed, types, behaviour, absence_mult)
    rng = random.Random(seed)
    ops = random.Random(f"court-ops|{seed}")
    audit = AuditLog()
    initial = copy.deepcopy(cases)
    cases = copy.deepcopy(cases)
    sittings = working_days(start, end + timedelta(days=120), set(cfg.leave))
    days = [d for d in sittings if d <= end]
    seed_prerequisites(cases, types, start, cfg, rng, seed, audit)
    planner = PLANNERS[cfg.planner]
    by_id = {c.case_id: c for c in cases}
    results: list[DayResult] = []
    events: list[Event] = []
    day_ops: dict[date, dict] = {}
    horizon = cfg.use_horizon
    gaming_on = bool(cfg.gaming_response) and cfg.planner != "baseline"
    reserve = max(0, int(cfg.reserve_minutes or 0))
    judge = judge_from_config(cfg)
    court_start = int(cfg.day_start.split(":")[0]) * 60 + int(cfg.day_start.split(":")[1])
    if horizon and days:
        # the evening before the first sitting: publish the first horizon
        publish(plan_horizon(cases, days[0] - timedelta(days=1), sittings, cfg, types), by_id,
                days[0] - timedelta(days=1), events, audit)

    for day in days:
        new = inflow.new_filings(day, rng) if inflow else []
        for c in new:
            c.origin = "world"
            cases.append(c)
            by_id[c.case_id] = c
            events.append(Event(day, "filed", c.case_id, {"purpose": c.purpose}))
            draw_attempt(c, types, cfg, rng, day, seed, audit)
        if inflow is not None and hasattr(inflow, "withdrawals"):
            # optional hook: parties settled out of court -> off the docket before planning
            for cid in inflow.withdrawals(day) or []:
                c = by_id.get(cid)
                if c is not None and c.status == "pending":
                    c.status = "disposed"
                    c.meta["withdrawn"] = True
                    old = c.published_date
                    c.published_date = None
                    events.append(Event(day, "withdrawn", cid, {}))
                    audit.add(day, cid, "withdrawn", "settled", "parties settled out of court",
                              before=old, after="disposed", actor="parties")
        if cfg.use_readiness:
            # a court that tracks readiness chases the known-unmet prerequisites; without that
            # check the latent simply stands until the attempt (so today's practice fails at p_prereq)
            recheck_prerequisites(cases, types, rng, day, cfg, audit)

        if horizon:
            # the day's list is drawn from the published dates, plus matters carried over unreached
            eligible = [c for c in cases if c.status == "pending" and (
                c.published_date == day
                or (c.meta.get("carried") and c.next_date is not None and c.next_date <= day))]
        else:
            eligible = [c for c in cases if c.status == "pending" and (c.next_date is None or c.next_date <= day)]
        signals = behaviour.readiness_signal(eligible, day)
        plan = planner(day, eligible, cfg, types, signals)
        # the planner planned the day less the reserve; the court day itself is the full day
        day_len = float(sitting_minutes(cfg, day))      # hearing minutes today (day profile; gaps skipped)
        windows = sitting_windows(cfg, day)
        plan.capacity_minutes = int(day_len)

        def wall(clock_min: float) -> int:
            """Minutes after ``cfg.day_start`` at which ``clock_min`` hearing minutes have been used."""
            left = clock_min
            for a, b in windows:
                if left <= b - a:
                    return int(a + left - court_start)
                left -= b - a
            return int(windows[-1][1] - court_start)
        if hasattr(behaviour, "on_plan"):
            behaviour.on_plan(plan)
        n_capacity = 0
        for cid, why in plan.held_back:
            if why == "capacity":
                n_capacity += 1
                if not AUDIT_CAPACITY_SUMMARY:
                    audit.add(day, cid, "held_back", "capacity", "above the day's capacity", actor="planner")
                continue
            c = by_id.get(cid)
            rule = "checklist" if why.startswith("checklist") else (
                "prerequisite" if why.startswith("prerequisite") else "planner")
            actor = (attribution.stakeholder_for("not_ready", c.meta.get("checklist_reason"))
                     if c is not None and rule != "planner" else "planner")
            audit.add(day, cid, "held_back", rule, why, actor=actor)
        if n_capacity:
            audit.add(day, None, "held_back", "capacity",
                      f"{n_capacity} eligible matters left for a later day (above the day's capacity)",
                      after=n_capacity, actor="planner")
        load = booked_load(cases, day) if horizon else None
        if horizon:
            listed_ids = {l.case_id for l in plan.listings}
            held = dict(plan.held_back)
            for c in eligible:
                if c.published_date == day and c.case_id not in listed_ids:
                    c.meta["reschedules"] = c.meta.get("reschedules", 0) + 1
                    events.append(Event(day, "rescheduled", c.case_id,
                                        {"from": day.isoformat(), "to": None,
                                         "reason": held.get(c.case_id, "not listed")}))
                    audit.add(day, c.case_id, "rescheduled", "day-plan", held.get(c.case_id, "not listed"),
                              before=day, after=None, actor="court")
                    c.published_date = None

        # --- urgent matters first, from the reserve; then the chance of a judge emergency ----------
        clock = 0.0
        urgent: list[dict] = []
        pend = [c for c in cases if c.status == "pending"]
        for _ in range(_poisson(float(cfg.urgent_per_day or 0.0), ops)):
            if not pend:
                break
            c = pend[int(ops.random() * len(pend))]
            u, acc, utype = ops.random(), 0.0, URGENT_TYPES[-1][0]
            for t, share in URGENT_TYPES:
                acc += share
                if u < acc:
                    utype = t
                    break
            if utype == "BAIL" and not bail_allowed(c):
                utype = "APPLICATION_REVIEW"      # bail is settled once complainant evidence begins
            ht_u = types.get(utype)
            mins = sample_duration(ht_u, ops) if ht_u else 10.0
            urgent.append({"case_id": c.case_id, "type": utype, "start_min": round(clock, 1),
                           "minutes": round(mins, 1), "from_reserve": clock + mins <= reserve + 1e-9})
            clock += mins
            c.meta["urgent_heard"] = c.meta.get("urgent_heard", 0) + 1
            audit.add(day, c.case_id, "urgent_heard", "reserve",
                      f"urgent {utype.replace('_', ' ').lower()} mention heard before the list, from the reserve",
                      after=round(mins, 1), actor="court")
        urgent_min = clock
        day_end = day_len
        emergency: dict | None = None
        if cfg.judge_emergency_p and ops.random() < cfg.judge_emergency_p:
            lost = ops.randint(*EMERGENCY_LOSS_MIN)
            day_end = float(max(0.0, day_len - lost))
            emergency = {"lost_minutes": lost, "sitting_until_min": day_end, "rolled": []}
            audit.add(day, None, "judge_emergency", "judge-emergency",
                      f"judge unavailable for the last {lost} minutes of the day; the unheard tail rolls to "
                      f"the next sitting with priority", before=day_len, after=day_end,
                      actor="judge_emergency")

        outcomes: list[HearingOutcome] = []
        present: set[str] = set()          # advocates who turned up for a matter today

        def hear(lst: Listing, standby: bool = False) -> None:
            nonlocal clock
            c = by_id[lst.case_id]
            ht = types[c.purpose]
            if c.first_listed_on is None:
                c.first_listed_on = day
            c.listed_count_current += 1
            if standby:
                events.append(Event(day, "standby_called", c.case_id,
                                    {"at_min": lst.start_min, "expected_minutes": lst.expected_minutes}))
                audit.add(day, c.case_id, "standby_called", "standby-backfill", "; ".join(lst.why),
                          after={"at_min": lst.start_min}, actor="planner", score=lst.score)
            else:
                events.append(Event(day, "listed", c.case_id, {"slot": lst.slot, "window": [lst.start_min, lst.end_min]}))
                audit.add(day, c.case_id, "listed", f"planner:{plan.solver}", "; ".join(lst.why),
                          after={"slot": lst.slot, "window": [lst.start_min, lst.end_min]}, actor="planner",
                          score=lst.score)
            ctx = HearingContext(c, lst, ht, day, (day - c.last_heard_on).days if c.last_heard_on else None,
                                 cfg.give_appointments)
            purpose_before = c.purpose
            next_before = c.next_date
            # who hears it and how fresh the file is (duration_model); agents' own minutes are kept as given
            dmult = duration_multiplier(judge, c.purpose, c.last_heard_on, day, c.age_years(day)) * _kind_minutes(c, cfg)
            decided_by = "court"
            dec = None
            rolled_by_emergency = False
            if emergency is not None and clock >= day_end:
                kind, reason, used = "not_reached", EMERGENCY_REASON, 0.0
                rolled_by_emergency = True
                emergency["rolled"].append(c.case_id)
            elif clock >= day_len:
                kind, reason, used = "not_reached", "Day ended before the matter was called", 0.0
            elif c.meta.get("prereq_pending"):
                kind, used = "not_ready", CALLOVER_MIN
                reason = c.meta.get("checklist_reason") or rng.choices(
                    REASON_GROUPS["PREREQ"],
                    weights=[ht.reason_shares.get(r, 0) + 1e-6 for r in REASON_GROUPS["PREREQ"]])[0]
            else:
                dec = behaviour.decide(ctx, rng)
                decided_by = dec.source
                if dec.rationale:
                    events.append(Event(day, "agent_decision", c.case_id,
                                        {"appears": dec.appears, "ready": dec.ready, "rationale": dec.rationale}))
                if dec.appears:
                    present.add(c.advocate_id)
                if not dec.appears:
                    kind, reason, used = "adjourned", dec.reason, CALLOVER_MIN
                elif dec.seeks_adjournment or not dec.ready:
                    kind, reason, used = "adjourned", dec.reason, ADJOURN_MIN
                else:
                    court_p = ht.p_court / max(1e-6, 1 - ht.p_prereq)
                    if rng.random() < court_p:
                        kind, used = "adjourned", ADJOURN_MIN
                        reason = rng.choices(REASON_GROUPS["COURT"],
                                             weights=[ht.reason_shares.get(r, 0) + 1e-6 for r in REASON_GROUPS["COURT"]])[0]
                    else:
                        mins = getattr(dec, "minutes", None)
                        used = max(1.0, mins) if mins is not None else sample_duration(ht, rng, dmult)
                        kind, reason = "substantive", None
            clock += used
            if rolled_by_emergency:
                c.meta["emergency_roll"] = True
            elif kind != "not_reached":
                c.meta.pop("emergency_roll", None)
            actor = ("judge_emergency" if rolled_by_emergency
                     else attribution.stakeholder_for(kind, reason))

            # --- gaming response: a flagged side's own adjournment gets a firm, short date ---------
            gaming = False
            flag = c.meta.get("gaming_flag") if gaming_on and kind == "adjourned" else None
            if flag and _flagged_side_sought(flag, reason, dec, c):
                gaming = True
                n_req = c.meta["gaming_requests"] = c.meta.get("gaming_requests", 0) + 1
                if n_req >= 2 and not c.meta.get("last_chance"):
                    c.meta["last_chance"] = True
                    audit.add(day, c.case_id, "last_chance", "gaming-response",
                              f"adjournment #{n_req} sought by the flagged {flag.get('side')} side: last chance, "
                              f"firm short date; the other side is not penalised",
                              before=False, after=True, actor=actor, flagged_actor=flag.get("actor"),
                              p_exceed=flag.get("p_exceed"), evidence=flag.get("evidence"))

            # --- predictability record: first published date vs the day it was actually called ---
            if horizon:
                if kind == "not_reached":
                    c.meta["carried"] = True
                else:
                    c.meta["carried"] = False
                    first = c.meta.pop("first_published", None)
                    if first is not None:
                        c.meta.setdefault("published_vs_heard", []).append((first, day))
                if kind != "not_reached" or c.published_date == day:
                    c.published_date = None

            # --- update case state -------------------------------------------------
            if kind != "not_reached":
                c.total_hearings += 1
                c.hearings_by_type[purpose_before] = c.hearings_by_type.get(purpose_before, 0) + 1
                c.hearings_at_stage += 1
                c.last_heard_on = day
            if kind == "substantive":
                c.adjournments_in_row = 0
                c.meta.setdefault("heard_gaps", []).append((day - (c.first_listed_on or day)).days)
                nxt = advance(c, types, cfg, rng, day)
                c.first_listed_on = None
                c.listed_count_current = 0
                c.confirmed_ready = False
            else:
                nxt = c.purpose
                if kind == "adjourned":
                    c.adjournments_in_row += 1
                    c.accused_absent_last = reason == "Respondent Absence / Non-Compliance"
                    # repeated non-appearance at summons stage escalates to a warrant
                    if c.purpose == "APPEARANCE" and c.accused_absent_last and c.adjournments_in_row >= 2:
                        c.purpose = nxt = "WARRANT"
                if kind == "adjourned" and reason and "Absence" not in reason:
                    c.meta.setdefault("heard_gaps", []).append((day - (c.first_listed_on or day)).days)
            # an interrupting application (bail / report / application) may be filed before the next step
            if kind != "not_reached" and c.status == "pending":
                itype = maybe_interrupt(c, day, seed)
                if itype:
                    nxt = c.purpose
                    audit.add(day, c.case_id, "interrupt_filed", "interrupt",
                              f"{itype.replace('_', ' ').lower()} filed; the case returns to "
                              f"{c.meta.get('return_purpose', '').replace('_', ' ').lower()} after it",
                              before=c.meta.get("return_purpose"), after=itype, actor=None)
            # an attempt was made (not merely unreached): draw the prerequisite latent for the next one
            if kind != "not_reached" and c.status == "pending":
                draw_attempt(c, types, cfg, rng, day, seed, audit)
            nd = None
            rule = "disposed"
            if c.status == "pending":
                if rolled_by_emergency:
                    nd, rule = next_working(day + timedelta(days=1), sittings), "emergency-roll"
                elif gaming:
                    gt = types.get(c.purpose)
                    gap = min(gt.ideal_gap_days if gt else GAMING_FIRM_GAP_DAYS, GAMING_FIRM_GAP_DAYS)
                    nd, rule = next_working(day + timedelta(days=max(1, gap)), sittings), "gaming-firm-short"
                    if load is not None:
                        load[nd] = load.get(nd, 0.0) + _exp_min(c, day, cfg, types)   # firm: booked regardless
                elif load is not None and kind != "not_reached":
                    est = _exp_min(c, day, cfg, types)
                    nd, rule = next_date_with_rule(c, kind, reason, day, types, cfg, sittings, load, est)
                    load[nd] = load.get(nd, 0.0) + est
                else:
                    nd, rule = next_date_with_rule(c, kind, reason, day, types, cfg, sittings)
                c.next_date = nd
                if cfg.carry_over == "same_weekday" and kind == "not_reached":
                    c.carry_weekday = day.weekday()
            out = HearingOutcome(c.case_id, day, purpose_before, kind, reason, round(used, 1), nxt, nd, decided_by)
            outcomes.append(out)
            events.append(Event(day, "outcome", c.case_id, {"kind": kind, "reason": reason, "next_date": nd.isoformat() if nd else None}))
            why = kind if not reason else f"{kind}: {reason}"
            if gaming:
                why += f" (sought by the flagged {flag.get('side')} side; firm date, other side not penalised)"
            extra = {"evidence": flag.get("evidence"), "flagged_actor": flag.get("actor")} if gaming else {}
            audit.add(day, c.case_id, "rolled_over" if kind == "not_reached" else "next_date", rule, why,
                      before=next_before, after=nd, actor=actor, purpose=purpose_before, next_purpose=nxt,
                      **extra)
            behaviour.observe(ctx, out)
            if inflow:
                inflow.on_outcome(out)

        for lst in sorted(plan.listings, key=lambda l: (l.start_min, -l.score)):
            hear(lst)

        standby: list[Listing] = []
        if STANDBY_BACKFILL and cfg.planner != "baseline" and clock < day_end - STANDBY_SLACK_MIN:
            listed_today = {l.case_id for l in plan.listings}
            pool = [c for c in cases if c.status == "pending" and c.case_id not in listed_today
                    and (c.next_date is None or c.next_date <= day)
                    and (c.advocate_id in present or c.confirmed_ready)]
            cands, _ = build_candidates(day, pool, cfg, types, {})
            for cd in sorted(cands, key=lambda x: (-x.efficiency, x.case.case_id)):
                left = day_end - STANDBY_SLACK_MIN - clock
                if left <= 0:
                    break
                if cd.exp_min > left:
                    continue
                at = wall(clock)
                lst = Listing(case_id=cd.case.case_id, day=day, slot="standby", start_min=at,
                              end_min=min(wall(day_len), at + 30), purpose=cd.case.purpose,
                              advocate_id=cd.case.advocate_id, expected_minutes=round(cd.exp_min, 1),
                              p_goes_ahead=round(cd.p_ahead, 3), p_substantive=round(cd.p_sub, 3),
                              score=round(cd.value, 4), why=["standby: advocate already in court"
                                                              if cd.case.advocate_id in present
                                                              else "standby: preparedness confirmed", *cd.why])
                lst.duration_mult = cd.duration_mult
                standby.append(lst)
                hear(lst, standby=True)
        # standby calls sit beside the morning list (the published causelist stays as it was)
        plan.standby = standby

        day_ops[day] = {"reserve_minutes": reserve, "reserve_used": round(min(reserve, urgent_min), 1),
                        "reserve_released": round(max(0.0, reserve - urgent_min), 1),
                        "urgent_minutes": round(urgent_min, 1), "urgent": urgent, "judge_emergency": emergency}
        results.append(DayResult(day, plan, outcomes, round(clock, 1), len(new)))
        if inflow is not None and hasattr(inflow, "on_day_end"):
            inflow.on_day_end(day)
        if horizon and day != days[-1]:
            publish(plan_horizon(cases, day, sittings, cfg, types), by_id, day, events, audit)

    return SimResult(cfg, start, end, seed, results, cases, initial, events, behaviour.name,
                     inflow.name if inflow else None, audit=audit.entries, day_ops=day_ops, learner=behaviour)
