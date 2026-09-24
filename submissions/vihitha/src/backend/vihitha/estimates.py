"""Per-listing planning estimates (section 5.4)."""
from __future__ import annotations

from datetime import date

from .enums import HearingType, ReasonGroup
from .models import Case
from .reference import Reference
from .rules import Rules


def p_show(case: Case, h: HearingType, rules: Rules, ref: Reference) -> float:
    """Planner's show-up estimate: posterior mean when learning is on, else the table value."""
    if rules.learning:
        a, b = case.posterior_show
        return a / (a + b)
    return ref.p_show_base(h)


def summary_applies(case: Case, on: date, rules: Rules) -> bool:
    return rules.require_case_summary_4y and case.age_years(on) >= 4


def q_given_show(h: HearingType, ref: Reference) -> float:
    """P(substantive | shown) from the tables."""
    t = ref[h]
    return min(1.0, t.p_substantive / t.p_show_base) if t.p_show_base > 0 else 0.0


def prep_share(h: HearingType, ref: Reference) -> float:
    """Share of non-absence failures that are PREP failures."""
    t = ref[h]
    non_absence = 1.0 - t.group_shares[ReasonGroup.ABSENCE]
    return t.group_shares[ReasonGroup.PREP] / non_absence if non_absence > 0 else 0.0


def base_prep(h: HearingType, ref: Reference) -> float:
    """P(advocate prepared | shown) = 1 - P(PREP failure | shown)."""
    return 1.0 - (1.0 - q_given_show(h, ref)) * prep_share(h, ref)


def prep_with_summary(h: HearingType, ref: Reference, reduction: float) -> float:
    """A required case summary removes `reduction` of PREP failures."""
    b = base_prep(h, ref)
    return b + reduction * (1.0 - b)


def p_sub_given_show(h: HearingType, ref: Reference, prep_reduction: float = 0.0) -> float:
    """P(substantive | shown) = P(prepared) x P(substantive | shown, prepared)."""
    key = ("p_sub_given_show", h, prep_reduction)
    v = ref.cache.get(key)
    if v is None:
        b = base_prep(h, ref)
        v = prep_with_summary(h, ref, prep_reduction) * q_given_show(h, ref) / b if b > 0 else 0.0
        ref.cache[key] = v
    return v


def p_sub_est(case: Case, h: HearingType, d: date, rules: Rules, ref: Reference) -> float:
    if case.pending_until is not None and case.pending_until > d:
        return 0.0
    # = p_sub(h) * p_show(case) / p_show_base(h), with the case-summary PREP reduction when it applies.
    reduction = rules.summary_prep_reduction if summary_applies(case, d, rules) else 0.0
    est = p_show(case, h, rules, ref) * p_sub_given_show(h, ref, reduction)
    return min(0.99, max(0.02, est))


def expected_minutes(case: Case, h: HearingType, d: date, rules: Rules, ref: Reference) -> tuple[float, float]:
    """(expected minutes, p_sub_est) for listing `case` for `h` on `d`."""
    p = p_sub_est(case, h, d, rules, ref)
    return p * ref.duration(h) + (1 - p) * rules.adjourn_call_minutes, p
