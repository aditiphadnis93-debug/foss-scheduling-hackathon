"""Readiness state machine and defect transition helpers."""

from __future__ import annotations

from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from .catalog import (
    HARD_OPEN_STATUSES,
    SUBMITTED_STATUSES,
    default_blocking,
    is_locked,
)

PT = ZoneInfo("Asia/Calcutta")


def now_iso() -> str:
    return datetime.now(PT).isoformat(timespec="seconds")


def _as_dict(d: Any) -> dict[str, Any]:
    if isinstance(d, dict):
        return d
    try:
        return dict(d)
    except Exception:
        return {"status": getattr(d, "status", "open"), "code": getattr(d, "code", "")}


def defect_is_blocking(
    d: dict[str, Any] | Any, policy: dict[str, bool] | None = None
) -> bool:
    """Resolve whether a defect gates readiness (blocking vs soft warning)."""
    item = _as_dict(d)
    if "blocking" in item and item["blocking"] is not None:
        return bool(item["blocking"])
    code = str(item.get("code") or "")
    if policy is not None and code in policy:
        return bool(policy[code])
    sev = item.get("severity")
    if sev:
        return str(sev).upper() == "HARD" or is_locked(code)
    if code:
        return default_blocking(code)
    # bare status-only fixtures: treat as blocking HARD
    return True


def recompute_readiness(
    defects: list[dict[str, Any]] | list[Any],
    *,
    policy: dict[str, bool] | None = None,
) -> str:
    """Gating uses blocking defects only:
    - any blocking open|rejected|expired → BLOCKED
    - elif any blocking submitted → HEALING
    - else READY (soft open/submitted are warnings, not gates)
    """
    if not defects:
        return "READY"

    blocking_open = False
    blocking_submitted = False
    for d in defects:
        item = _as_dict(d)
        status = str(item.get("status", "open"))
        if not defect_is_blocking(item, policy):
            continue
        if status in HARD_OPEN_STATUSES:
            blocking_open = True
        elif status in SUBMITTED_STATUSES:
            blocking_submitted = True

    if blocking_open:
        return "BLOCKED"
    if blocking_submitted:
        return "HEALING"
    return "READY"


def open_defect_count(defects: list[dict[str, Any]] | list[Any]) -> int:
    """Count non-cleared defects of any severity (UI 'still open')."""
    n = 0
    for d in defects:
        item = _as_dict(d)
        status = item.get("status")
        if status in HARD_OPEN_STATUSES or status in SUBMITTED_STATUSES:
            n += 1
    return n


def blocking_open_count(
    defects: list[dict[str, Any]] | list[Any],
    *,
    policy: dict[str, bool] | None = None,
) -> int:
    """Count blocking defects in open|rejected|expired (gating display)."""
    n = 0
    for d in defects:
        item = _as_dict(d)
        status = item.get("status")
        if status in HARD_OPEN_STATUSES and defect_is_blocking(item, policy):
            n += 1
    return n


def open_soft_defect_count(
    defects: list[dict[str, Any]] | list[Any],
    *,
    policy: dict[str, bool] | None = None,
) -> int:
    """Count soft (non-blocking) defects still open|rejected|expired|submitted."""
    n = 0
    for d in defects:
        item = _as_dict(d)
        status = item.get("status")
        if status in HARD_OPEN_STATUSES or status in SUBMITTED_STATUSES:
            if not defect_is_blocking(item, policy):
                n += 1
    return n


def age_days(filing_date: str | None, as_of: str | None = None) -> int | None:
    if not filing_date:
        return None
    try:
        fd = datetime.strptime(filing_date[:10], "%Y-%m-%d").date()
        if as_of:
            ref = datetime.strptime(as_of[:10], "%Y-%m-%d").date()
        else:
            ref = datetime.now(PT).date()
        return (ref - fd).days
    except ValueError:
        return None
