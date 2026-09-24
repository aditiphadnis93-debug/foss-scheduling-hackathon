"""Sampling an outcome for a reached listing (section 5.5).

Order of draws: prerequisite -> show-up -> advocate prepared -> substantive -> settlement
-> duration. With agents and the case-summary rule off, show x prepared x substantive
reproduces the table's p_substantive exactly (tests/test_calibration.py).
"""
from __future__ import annotations

from datetime import date

from . import rng
from .agents import ListingContext, prep_prob, show_prob
from .enums import HearingType, ReasonGroup
from .estimates import base_prep, prep_with_summary, q_given_show, summary_applies
from .models import Case, Outcome
from .reference import Reference
from .rules import Rules

_OTHER_GROUPS = (ReasonGroup.PROCESS, ReasonGroup.COURT, ReasonGroup.UNCLEAR)


def _label(ref: Reference, h: HearingType, group: ReasonGroup, seed: int, key: tuple) -> str:
    return rng.choice(ref.labels(h, group), seed, *key, "label")


def sample(case: Case, h: HearingType, d: date, seed: int, rules: Rules, ref: Reference,
           ctx: ListingContext) -> Outcome:
    key = (case.filing_number, d.isoformat(), h.value)
    call = int(round(rules.adjourn_call_minutes))

    # 1. Prerequisite not met (process / report not back): fails whether or not the planner checked.
    if case.pending_until is not None and case.pending_until > d:
        return Outcome(reached=True, substantive=False, reason_group=ReasonGroup.PROCESS,
                       reason_label=_label(ref, h, ReasonGroup.PROCESS, seed, key + ("process",)),
                       duration=call, shown=None)

    # 2. Show-up.
    s = show_prob(ref.p_show_base(h), ctx, case.party_id, seed, rules)
    if not rng.bernoulli(s, seed, *key, "show"):
        return Outcome(reached=True, substantive=False, reason_group=ReasonGroup.ABSENCE,
                       reason_label=_label(ref, h, ReasonGroup.ABSENCE, seed, key), duration=call,
                       shown=False)

    # 3. Advocate prepared? Then substantive given prepared.
    b = base_prep(h, ref)
    reduction = rules.summary_prep_reduction if summary_applies(case, d, rules) else 0.0
    prep = prep_prob(prep_with_summary(h, ref, reduction), ctx, case.advocate_id, seed, rules)
    if not rng.bernoulli(prep, seed, *key, "prep"):
        return Outcome(reached=True, substantive=False, reason_group=ReasonGroup.PREP,
                       reason_label=_label(ref, h, ReasonGroup.PREP, seed, key), duration=call, shown=True)
    q_rest = min(1.0, q_given_show(h, ref) / b) if b > 0 else 0.0
    if not rng.bernoulli(q_rest, seed, *key, "sub"):
        shares = ref[h].group_shares
        weights = {g: shares[g] for g in _OTHER_GROUPS}
        if sum(weights.values()) <= 0:
            weights = {g: ref.pooled_group_shares[g] for g in _OTHER_GROUPS}
        group = rng.choice(weights, seed, *key, "group")
        return Outcome(reached=True, substantive=False, reason_group=group,
                       reason_label=_label(ref, h, group, seed, key), duration=call, shown=True)

    # 5. Duration (substantive): lognormal around the reference duration.
    dur = rng.lognormal_median(ref.duration(h), rules.duration_sigma, seed, *key, "duration")
    return Outcome(reached=True, substantive=True, duration=max(1, int(round(dur))), shown=True)


def settles(case: Case, h: HearingType, d: date, seed: int, rules: Rules) -> bool:
    """4. Settlement: independent per reached hearing. [ASSUMPTION]"""
    return rng.bernoulli(rules.settlement_prob, seed, case.filing_number, d.isoformat(), h.value, "settle")
