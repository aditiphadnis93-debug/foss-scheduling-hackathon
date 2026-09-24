"""L1 greedy minute packer (scheduler-light PRD §6)."""

from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any

from .normalize import to_upper_snake
from .probabilities import gap_days, p_show, p_substantive, system_duration_mins

AGE_WEIGHT_MIN = 0.5
AGE_WEIGHT_DEFAULT = 2.0
W_STUCK_DEFAULT = 0.15
MAX_LISTED_SOFT_CAP = 40
BUFFER_MIN = 0.10
BUFFER_MAX = 0.30
FALLBACK_DURATION = 15

DEFAULT_JUDGE_ID = "J-SEHGAL"

# Cover all 14 purposes so READY cases can place
DEFAULT_BLOCKS: list[dict[str, Any]] = [
    {
        "block_id": "B1",
        "label": "List 2 — Interlocutory / Bail / Applications",
        "list_section": 2,
        "sequence": 1,
        "allowed_purposes": [
            "BAIL",
            "APPLICATION_REVIEW",
            "REPORTS",
            "ADMISSION",
            "COGNIZANCE",
            "DELAY_CONDONATION_HEARING",
            "APPEARANCE",
            "WARRANT",
            "PLEA",
        ],
        "minute_budget": 90,
    },
    {
        "block_id": "B2",
        "label": "List 1 — Evidence / Examination / Arguments / Judgement",
        "list_section": 1,
        "sequence": 2,
        "allowed_purposes": [
            "EXAMINATION_UNDER_S351_BNSS",
            "EVIDENCE_COMPLAINANT",
            "EVIDENCE_ACCUSED",
            "ARGUMENTS",
            "JUDGEMENT",
        ],
        "minute_budget": 330,
    },
]


def clamp_buffer(pct: float | None) -> float:
    if pct is None:
        return 0.25
    return max(BUFFER_MIN, min(BUFFER_MAX, float(pct)))


def clamp_age_weight(w: float | None) -> float:
    if w is None:
        return AGE_WEIGHT_DEFAULT
    return max(AGE_WEIGHT_MIN, float(w))


def _parse_date(value: str | None) -> date | None:
    if not value:
        return None
    try:
        return datetime.strptime(value[:10], "%Y-%m-%d").date()
    except (TypeError, ValueError):
        return None


def age_years(filing_date: str | None, as_of: str) -> float:
    fd = _parse_date(filing_date)
    as_d = _parse_date(as_of) or date.today()
    if not fd:
        return 0.0
    days = max(0, (as_d - fd).days)
    return days / 365.25


def stuckness(total_hearings: int | None) -> float:
    n = int(total_hearings or 0)
    return float(min(n, 30))


def score_case(
    case: dict[str, Any],
    *,
    as_of: str,
    age_weight: float,
    w_stuck: float = W_STUCK_DEFAULT,
) -> float:
    w_age = clamp_age_weight(age_weight)
    return (
        age_years(case.get("filing_date"), as_of) * w_age
        + stuckness(case.get("total_hearings_held")) * w_stuck
    )


def resolve_duration(
    case: dict[str, Any],
    duration_lookup: dict[tuple[str, str | None], int],
) -> int:
    """Lookup order: (purpose, stage) → (purpose, None) → system → case estimate → 15."""
    purpose = to_upper_snake(
        case.get("purpose_of_next_hearing") or case.get("purpose") or ""
    )
    stage_raw = case.get("current_stage") or case.get("stage") or ""
    stage = to_upper_snake(stage_raw) if stage_raw else None

    if purpose and stage is not None and (purpose, stage) in duration_lookup:
        return int(duration_lookup[(purpose, stage)])
    if purpose and (purpose, None) in duration_lookup:
        return int(duration_lookup[(purpose, None)])
    if purpose and (purpose, "") in duration_lookup:
        return int(duration_lookup[(purpose, "")])
    sys_d = system_duration_mins(purpose) if purpose else None
    if sys_d:
        return int(sys_d)
    est = case.get("duration_mins_estimate")
    if est:
        try:
            return int(est)
        except (TypeError, ValueError):
            pass
    return FALLBACK_DURATION


def expected_load(duration_mins: int, purpose: str) -> float:
    return float(duration_mins) * p_show(purpose) * p_substantive(purpose)


def build_duration_lookup(
    rows: list[dict[str, Any]],
) -> dict[tuple[str, str | None], int]:
    """Build (purpose, stage|None) → minutes from duration_table rows."""
    out: dict[tuple[str, str | None], int] = {}
    for r in rows:
        purpose = to_upper_snake(r.get("purpose") or "")
        if not purpose:
            continue
        stage_raw = r.get("stage")
        stage: str | None
        if stage_raw is None or str(stage_raw).strip() == "":
            stage = None
        else:
            stage = to_upper_snake(str(stage_raw))
        try:
            mins = int(r["minutes"])
        except (KeyError, TypeError, ValueError):
            continue
        out[(purpose, stage)] = mins
    return out


def pack(
    *,
    judge_id: str,
    sitting_date: str,
    ready_cases: list[dict[str, Any]],
    blocks: list[dict[str, Any]],
    capacity_mins: int,
    overbook_buffer_pct: float,
    age_weight: float,
    duration_lookup: dict[tuple[str, str | None], int],
    exclude_case_numbers: set[str] | list[str] | None = None,
    max_listed: int = MAX_LISTED_SOFT_CAP,
    strict_adjournment_band: bool = True,
) -> dict[str, Any]:
    """Greedy pack READY cases into blocks. Returns draft payload shape."""
    buffer = clamp_buffer(overbook_buffer_pct)
    w_age = clamp_age_weight(age_weight)

    excluded = {
        str(value).strip()
        for value in (exclude_case_numbers or [])
        if str(value).strip()
    }

    # Normalize blocks
    norm_blocks: list[dict[str, Any]] = []
    for b in sorted(blocks, key=lambda x: int(x.get("sequence") or 0)):
        allowed = [
            to_upper_snake(p) for p in (b.get("allowed_purposes") or []) if p
        ]
        norm_blocks.append(
            {
                "block_id": b.get("block_id") or f"B{len(norm_blocks)+1}",
                "label": b.get("label") or "",
                "list_section": int(b.get("list_section") or 1),
                "sequence": int(b.get("sequence") or len(norm_blocks) + 1),
                "allowed_purposes": allowed,
                "minute_budget": int(b.get("minute_budget") or 0),
                "used_expected_mins": 0.0,
                "entries": [],
            }
        )

    allowed_anywhere = {p for b in norm_blocks for p in b["allowed_purposes"]}

    candidates: list[dict[str, Any]] = []
    ready_pool = len(
        [c for c in ready_cases if (c.get("readiness_status") or "READY") == "READY"]
    )
    excluded_count = 0
    for case in ready_cases:
        if (case.get("readiness_status") or "READY") != "READY":
            continue
        # case_number is the primary key, but accept filing_number too for
        # callers that accidentally send that identifier.
        case_number = str(case.get("case_number") or "").strip()
        filing_number = str(case.get("filing_number") or "").strip()
        if case_number in excluded or filing_number in excluded:
            excluded_count += 1
            continue
        purpose = to_upper_snake(
            case.get("purpose_of_next_hearing") or case.get("purpose") or ""
        )
        if not purpose:
            continue
        # adjournment_cap: skip filter if field missing
        if "adjournment_cap_exceeded" in case:
            if (
                strict_adjournment_band
                and case.get("adjournment_cap_exceeded")
                and not case.get("adjournment_waiver")
            ):
                continue
        candidates.append({**case, "_purpose": purpose})

    scored: list[dict[str, Any]] = []
    for case in candidates:
        purpose = case["_purpose"]
        dur = resolve_duration(case, duration_lookup)
        load = expected_load(dur, purpose)
        sc = score_case(case, as_of=sitting_date, age_weight=w_age)
        scored.append(
            {
                **case,
                "_duration": dur,
                "_expected_load": load,
                "_score": sc,
            }
        )

    scored.sort(
        key=lambda c: (
            -c["_score"],
            c.get("filing_date") or "9999-99-99",
            c.get("case_number") or "",
        )
    )

    waitlist: list[dict[str, Any]] = []
    listed_count = 0
    for case in scored:
        purpose = case["_purpose"]
        if purpose not in allowed_anywhere:
            waitlist.append(_wait_entry(case, sitting_date, "no_matching_block"))
            continue
        if listed_count >= max_listed:
            waitlist.append(_wait_entry(case, sitting_date, "no_capacity"))
            continue

        placed = False
        for block in norm_blocks:
            if purpose not in block["allowed_purposes"]:
                continue
            cap_eff = block["minute_budget"] * (1.0 + buffer)
            if block["used_expected_mins"] + case["_expected_load"] <= cap_eff + 1e-9:
                serial = len(block["entries"]) + 1
                block["entries"].append(
                    {
                        "serial": serial,
                        "case_number": case.get("case_number"),
                        "filing_number": case.get("filing_number"),
                        "purpose": purpose,
                        "current_stage": case.get("current_stage"),
                        "score": round(case["_score"], 2),
                        "duration_mins": case["_duration"],
                        "expected_load_mins": round(case["_expected_load"], 2),
                        "advocate_id": case.get("advocate_id"),
                        "badges": list(case.get("badges") or []),
                    }
                )
                block["used_expected_mins"] = round(
                    block["used_expected_mins"] + case["_expected_load"], 4
                )
                listed_count += 1
                placed = True
                break
        if not placed:
            waitlist.append(_wait_entry(case, sitting_date, "no_capacity"))

    total_expected = sum(b["used_expected_mins"] for b in norm_blocks)
    nominal_sum = sum(
        e["duration_mins"] for b in norm_blocks for e in b["entries"]
    )

    # Round used for output
    for b in norm_blocks:
        b["used_expected_mins"] = round(b["used_expected_mins"], 2)
        # drop internal allowed list from response? keep for debug — PRD sample omits it
        # Keep allowed_purposes out of stable Coco shape — strip
    out_blocks = []
    for b in norm_blocks:
        out_blocks.append(
            {
                "block_id": b["block_id"],
                "label": b["label"],
                "list_section": b["list_section"],
                "sequence": b["sequence"],
                "minute_budget": b["minute_budget"],
                "used_expected_mins": b["used_expected_mins"],
                "entries": b["entries"],
            }
        )

    return {
        "judge_id": judge_id,
        "date": sitting_date,
        "capacity_mins": int(capacity_mins),
        "overbook_buffer_pct": buffer,
        "totals": {
            "cases_listed": listed_count,
            "expected_load_mins": round(total_expected, 2),
            "nominal_duration_sum_mins": int(nominal_sum),
            "waitlisted": len(waitlist),
            "ready_pool": ready_pool,
            "excluded": excluded_count,
            "after_exclude": len(candidates),
        },
        "excluded_case_numbers": sorted(excluded),
        "blocks": out_blocks,
        "waitlist": waitlist,
    }


def _wait_entry(case: dict[str, Any], sitting_date: str, reason: str) -> dict[str, Any]:
    purpose = case.get("_purpose") or to_upper_snake(
        case.get("purpose_of_next_hearing") or ""
    )
    gap = gap_days(purpose)
    base = _parse_date(sitting_date) or date.today()
    suggested = (base + timedelta(days=gap)).isoformat()
    return {
        "case_number": case.get("case_number"),
        "filing_number": case.get("filing_number"),
        "purpose": purpose,
        "reason": reason,
        "suggested_next_date": suggested,
        "score": round(float(case.get("_score") or 0), 2),
    }
