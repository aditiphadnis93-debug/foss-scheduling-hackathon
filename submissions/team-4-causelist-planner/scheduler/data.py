"""Placeholder reference tables, the calendar and the synthetic roster that datagen builds the dataset from.

The app reads its data from the generated dataset through scheduler/store.py, not from here.
"""
from __future__ import annotations

import random
from datetime import date, timedelta

from .models import Case, HearingType

# Placeholder hearing-type reference table (docs/L1-scheduling-algorithm.md §3)
HEARING_TYPES: dict[str, HearingType] = {
    h.purpose: h
    for h in [
        HearingType("mention", 2, 5, 0.40, 0.50, 14, 3),
        HearingType("admission", 3, 5, 0.45, 0.60, 21, 7),
        HearingType("interim_application", 3, 10, 0.40, 0.50, 14, 3),
        HearingType("evidence", 4, 30, 0.50, 0.50, 28, 14),
        HearingType("final_arguments", 5, 60, 0.60, 0.60, 21, 14),
    ]
}

# What an effective hearing moves the case on to; None means disposed.
NEXT_PURPOSE = {
    "admission": "interim_application",
    "mention": "evidence",
    "interim_application": "evidence",
    "evidence": "final_arguments",
    "final_arguments": None,
}

CASE_TYPES = ["civil", "criminal", "writ", "arbitration"]

# Placeholder hearing-failure reasons and weights (docs/court-domain-model.md §6) until the
# organisers' distribution is released. Used for synthetic case history only.
ADJOURNMENT_REASONS = {
    "party_absent": ("Party absent", 30),
    "advocate_absent": ("Advocate absent", 20),
    "accommodation_sought": ("Accommodation sought", 20),
    "not_reached": ("Not reached", 20),
    "prerequisite_pending": ("Service / prerequisite pending", 10),
}

# Placeholder checklist per purpose: what the parties should have ready before the hearing.
PURPOSE_CHECKLIST = {
    "admission": ["Petition, annexures and court fee complete", "Caveat, if any, served"],
    "mention": ["Mention memo filed with grounds for urgency"],
    "interim_application": ["IA and supporting affidavit filed", "Copy served on the other side"],
    "evidence": ["Witnesses informed and available", "Documents to be exhibited ready", "Affidavit in lieu of chief filed"],
    "final_arguments": ["Pleadings complete (counter and rejoinder)", "Written submissions filed", "Case law compilation ready"],
}

# Synthetic parties (placeholders until the roster dataset shows what party data exists). datagen names them.
INSTITUTIONS = {
    "ORG01": "State Government",
    "ORG02": "Union of India",
    "ORG03": "Municipal Corporation",
    "ORG04": "State Transport Corporation",
    "ORG05": "National Insurance Co. Ltd.",
    "ORG06": "State Bank",
    "ORG07": "Electricity Board",
    "ORG08": "Development Authority",
}
FREQUENT_LITIGANTS = [f"LIT{k:03d}" for k in range(40)]  # individuals with matters in several courtrooms


def _parties(case_type: str, prefix: str, i: int, rng: random.Random) -> list[str]:
    """Petitioner first, then respondents. Criminal matters have the State as respondent."""
    pet = rng.choice(FREQUENT_LITIGANTS) if rng.random() < 0.015 else f"{prefix}-P{i:05d}"
    org = rng.choices(list(INSTITUTIONS), [8, 5, 4, 3, 3, 2, 2, 1])[0]
    if case_type == "criminal":
        resp = ["ORG01"]
    elif case_type == "writ":
        resp = [org] if rng.random() < 0.8 else [f"{prefix}-R{i:05d}"]
    else:
        resp = [f"{prefix}-R{i:05d}"] if rng.random() < 0.6 else [org]
    if rng.random() < 0.2 and org not in resp:
        resp.append(org)
    return [pet, *resp]

# Age mix from the case study: a quarter under 1 year, 1 in 6 over 4 years.
AGE_MIX = [((0, 1), 0.25), ((1, 3), 0.35), ((3, 4), 0.233), ((4, 5), 0.08), ((5, 12), 0.087)]


def _purpose_for_age(years: float, rng: random.Random) -> str:
    if years < 0.25:
        return rng.choice(["admission", "admission", "mention"])
    if years < 1:
        return rng.choices(["mention", "interim_application", "admission"], [5, 4, 1])[0]
    if years < 3:
        return rng.choices(["mention", "interim_application", "evidence"], [4, 3, 2])[0]
    return rng.choices(["mention", "interim_application", "evidence", "final_arguments"], [3, 2, 3, 1])[0]


def generate_roster(n: int = 3000, today: date = date(2026, 10, 5), seed: int = 7,
                    case_types: tuple[str, ...] | None = None, id_prefix: str = "HC") -> list[Case]:
    """case_types restricts the mix, e.g. an arbitration-only bench.

    id_prefix keeps case IDs unique when several courtrooms are generated. Parties come from a
    separate RNG, so adding them leaves the rest of the roster unchanged.
    """
    rng = random.Random(seed)
    party_rng = random.Random(f"parties-{seed}-{id_prefix}")
    types = list(case_types) if case_types else CASE_TYPES
    type_weights = [4, 3, 2, 1] if not case_types else [1] * len(types)
    # Advocates follow a long tail, so a few carry many matters (clustering matters).
    advocates = [f"ADV{i:03d}" for i in range(300)]
    adv_weights = [1 / (i + 1) ** 0.8 for i in range(len(advocates))]
    cases = []
    for i in range(n):
        (lo, hi), = rng.choices([r for r, _ in AGE_MIX], [w for _, w in AGE_MIX])
        years = rng.uniform(lo, hi)
        filing = today - timedelta(days=int(years * 365.25))
        purpose = _purpose_for_age(years, rng)
        advs = rng.choices(advocates, adv_weights, k=1 if rng.random() < 0.8 else 2)
        last_heard = None
        if years > 0.1:
            last_heard = today - timedelta(days=rng.randint(10, min(180, int(years * 365))))
        case_type = rng.choices(types, type_weights)[0]
        cases.append(
            Case(
                id=f"{id_prefix}/{filing.year}/{i:05d}",
                filing_date=filing,
                case_type=case_type,
                purpose=purpose,
                advocate_ids=sorted(set(advs)),
                last_heard=last_heard,
                adjournment_count=min(int(rng.expovariate(1 / max(1.0, years * 1.5))), 25),
                prerequisites_met=rng.random() > 0.10,
                urgent=rng.random() < 0.03,
                parties=_parties(case_type, id_prefix, i, party_rng),
            )
        )
    return cases


def holidays(year: int) -> set[date]:
    """Placeholder court holidays until the real calendar is released."""
    fixed = [(1, 26), (8, 15), (10, 2), (10, 20), (10, 21), (11, 5), (12, 25)]
    return {date(year, m, d) for m, d in fixed}


def is_sitting_day(day: date, leave: tuple[date, ...] = ()) -> bool:
    return day.weekday() < 5 and day not in holidays(day.year) and day not in leave


def sitting_days(start: date, n: int, leave: tuple[date, ...] = ()) -> list[date]:
    days, d = [], start
    while len(days) < n:
        if is_sitting_day(d, leave):
            days.append(d)
        d += timedelta(days=1)
    return days
