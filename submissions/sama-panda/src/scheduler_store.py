"""Persistence helpers for duration table, prefs, sitting templates, drafts."""

from __future__ import annotations

import json
import sqlite3
from typing import Any

from .normalize import to_upper_snake
from .packer import (
    AGE_WEIGHT_DEFAULT,
    AGE_WEIGHT_MIN,
    DEFAULT_BLOCKS,
    DEFAULT_JUDGE_ID,
    build_duration_lookup,
    clamp_age_weight,
    clamp_buffer,
    pack,
)
from .probabilities import all_purposes, holiday_name, is_working_day, system_duration_mins
from .readiness import now_iso


def _ensure_judge(conn: sqlite3.Connection, judge_id: str) -> None:
    from .db import seed_scheduler_defaults

    seed_scheduler_defaults(conn, judge_id=judge_id)
    conn.commit()


def get_duration_table(conn: sqlite3.Connection, judge_id: str) -> dict[str, Any]:
    _ensure_judge(conn, judge_id)
    rows = conn.execute(
        """
        SELECT purpose, stage, minutes, updated_at
        FROM duration_table
        WHERE judge_id = ?
        ORDER BY purpose, stage
        """,
        (judge_id,),
    ).fetchall()
    items = []
    seen_purposes: set[str] = set()
    for r in rows:
        stage = r["stage"] or None
        if stage == "":
            stage = None
        items.append(
            {
                "purpose": r["purpose"],
                "stage": stage,
                "minutes": int(r["minutes"]),
                "source": "judge",
                "system_default": system_duration_mins(r["purpose"]),
                "updated_at": r["updated_at"],
            }
        )
        seen_purposes.add(r["purpose"])
    # Merge system defaults for any missing purpose
    for purpose in all_purposes():
        if purpose not in seen_purposes:
            items.append(
                {
                    "purpose": purpose,
                    "stage": None,
                    "minutes": system_duration_mins(purpose),
                    "source": "system",
                    "system_default": system_duration_mins(purpose),
                    "updated_at": None,
                }
            )
    items.sort(key=lambda x: (x["purpose"], x["stage"] or ""))
    return {"judge_id": judge_id, "count": len(items), "rows": items}


def put_duration_table(
    conn: sqlite3.Connection, judge_id: str, rows: list[dict[str, Any]]
) -> dict[str, Any]:
    _ensure_judge(conn, judge_id)
    ts = now_iso()
    for row in rows:
        purpose = to_upper_snake(row.get("purpose") or "")
        if not purpose:
            raise ValueError("purpose is required")
        stage_raw = row.get("stage")
        stage = "" if stage_raw is None or str(stage_raw).strip() == "" else to_upper_snake(str(stage_raw))
        try:
            minutes = int(row["minutes"])
        except (KeyError, TypeError, ValueError) as e:
            raise ValueError(f"minutes required for {purpose}") from e
        if minutes < 1 or minutes > 120:
            raise ValueError(f"minutes must be 1–120 (got {minutes} for {purpose})")
        conn.execute(
            """
            INSERT INTO duration_table (judge_id, purpose, stage, minutes, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(judge_id, purpose, stage) DO UPDATE SET
                minutes=excluded.minutes,
                updated_at=excluded.updated_at
            """,
            (judge_id, purpose, stage, minutes, ts),
        )
    conn.commit()
    return get_duration_table(conn, judge_id)


def reset_duration_table(conn: sqlite3.Connection, judge_id: str) -> dict[str, Any]:
    _ensure_judge(conn, judge_id)
    ts = now_iso()
    conn.execute("DELETE FROM duration_table WHERE judge_id = ?", (judge_id,))
    for purpose in all_purposes():
        conn.execute(
            """
            INSERT INTO duration_table (judge_id, purpose, stage, minutes, updated_at)
            VALUES (?, ?, '', ?, ?)
            """,
            (judge_id, purpose, system_duration_mins(purpose), ts),
        )
    conn.commit()
    return get_duration_table(conn, judge_id)


def get_prefs(conn: sqlite3.Connection, judge_id: str) -> dict[str, Any]:
    _ensure_judge(conn, judge_id)
    row = conn.execute(
        "SELECT * FROM judge_prefs WHERE judge_id = ?", (judge_id,)
    ).fetchone()
    if not row:
        return {
            "judge_id": judge_id,
            "overbook_buffer_pct": 0.25,
            "age_weight": AGE_WEIGHT_DEFAULT,
            "prefer_same_advocate_cluster": False,
            "virtual_hybrid_default": True,
            "strict_adjournment_band": True,
            "max_cases_per_block": None,
            "capacity_mins_default": 420,
        }
    return {
        "judge_id": judge_id,
        "overbook_buffer_pct": float(row["overbook_buffer_pct"]),
        "age_weight": float(row["age_weight"]),
        "prefer_same_advocate_cluster": bool(row["prefer_same_advocate_cluster"]),
        "virtual_hybrid_default": bool(row["virtual_hybrid_default"]),
        "strict_adjournment_band": bool(row["strict_adjournment_band"]),
        "max_cases_per_block": row["max_cases_per_block"],
        "capacity_mins_default": int(row["capacity_mins_default"]),
        "updated_at": row["updated_at"],
    }


def put_prefs(
    conn: sqlite3.Connection, judge_id: str, body: dict[str, Any]
) -> dict[str, Any]:
    _ensure_judge(conn, judge_id)
    current = get_prefs(conn, judge_id)
    buffer = clamp_buffer(
        body["overbook_buffer_pct"]
        if "overbook_buffer_pct" in body
        else current["overbook_buffer_pct"]
    )
    if "age_weight" in body:
        raw_age = body["age_weight"]
        if raw_age is not None and float(raw_age) < AGE_WEIGHT_MIN:
            # Reject zero / below floor (tests expect reject or clamp — we clamp)
            age_w = AGE_WEIGHT_MIN
        else:
            age_w = clamp_age_weight(raw_age)
    else:
        age_w = clamp_age_weight(current["age_weight"])

    prefer = (
        body["prefer_same_advocate_cluster"]
        if "prefer_same_advocate_cluster" in body
        else current["prefer_same_advocate_cluster"]
    )
    virtual = (
        body["virtual_hybrid_default"]
        if "virtual_hybrid_default" in body
        else current["virtual_hybrid_default"]
    )
    strict = (
        body["strict_adjournment_band"]
        if "strict_adjournment_band" in body
        else current["strict_adjournment_band"]
    )
    max_block = (
        body["max_cases_per_block"]
        if "max_cases_per_block" in body
        else current["max_cases_per_block"]
    )
    capacity = (
        int(body["capacity_mins_default"])
        if "capacity_mins_default" in body and body["capacity_mins_default"] is not None
        else int(current["capacity_mins_default"])
    )
    ts = now_iso()
    conn.execute(
        """
        INSERT INTO judge_prefs (
            judge_id, overbook_buffer_pct, age_weight,
            prefer_same_advocate_cluster, virtual_hybrid_default,
            strict_adjournment_band, max_cases_per_block,
            capacity_mins_default, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(judge_id) DO UPDATE SET
            overbook_buffer_pct=excluded.overbook_buffer_pct,
            age_weight=excluded.age_weight,
            prefer_same_advocate_cluster=excluded.prefer_same_advocate_cluster,
            virtual_hybrid_default=excluded.virtual_hybrid_default,
            strict_adjournment_band=excluded.strict_adjournment_band,
            max_cases_per_block=excluded.max_cases_per_block,
            capacity_mins_default=excluded.capacity_mins_default,
            updated_at=excluded.updated_at
        """,
        (
            judge_id,
            buffer,
            age_w,
            1 if prefer else 0,
            1 if virtual else 0,
            1 if strict else 0,
            max_block,
            capacity,
            ts,
        ),
    )
    conn.commit()
    return get_prefs(conn, judge_id)


def get_sitting_template(conn: sqlite3.Connection, judge_id: str) -> dict[str, Any]:
    _ensure_judge(conn, judge_id)
    row = conn.execute(
        "SELECT * FROM sitting_templates WHERE judge_id = ?", (judge_id,)
    ).fetchone()
    if not row:
        return {
            "judge_id": judge_id,
            "capacity_mins": 420,
            "blocks": DEFAULT_BLOCKS,
        }
    blocks = json.loads(row["blocks_json"])
    return {
        "judge_id": judge_id,
        "capacity_mins": int(row["capacity_mins"]),
        "blocks": blocks,
        "updated_at": row["updated_at"],
    }


def put_sitting_template(
    conn: sqlite3.Connection, judge_id: str, body: dict[str, Any]
) -> dict[str, Any]:
    _ensure_judge(conn, judge_id)
    blocks = body.get("blocks") or DEFAULT_BLOCKS
    capacity = int(body.get("capacity_mins") or 420)
    if not isinstance(blocks, list) or not blocks:
        raise ValueError("blocks must be a non-empty list")
    ts = now_iso()
    conn.execute(
        """
        INSERT INTO sitting_templates (judge_id, capacity_mins, blocks_json, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(judge_id) DO UPDATE SET
            capacity_mins=excluded.capacity_mins,
            blocks_json=excluded.blocks_json,
            updated_at=excluded.updated_at
        """,
        (judge_id, capacity, json.dumps(blocks), ts),
    )
    conn.commit()
    return get_sitting_template(conn, judge_id)


def ready_pool(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    """READY cases with fields the packer needs (from store, not re-gating)."""
    rows = conn.execute(
        """
        SELECT case_number, filing_number, filing_date, current_stage,
               purpose_norm, advocate_id, party_id, readiness_status,
               duration_mins_estimate, show_intent_window, total_hearings_held
        FROM cases
        WHERE readiness_status = 'READY'
        ORDER BY filing_date ASC, case_number ASC
        """
    ).fetchall()
    out = []
    for r in rows:
        out.append(
            {
                "case_number": r["case_number"],
                "filing_number": r["filing_number"],
                "filing_date": r["filing_date"],
                "current_stage": r["current_stage"],
                "purpose_of_next_hearing": r["purpose_norm"],
                "advocate_id": r["advocate_id"],
                "party_id": r["party_id"],
                "readiness_status": "READY",
                "duration_mins_estimate": r["duration_mins_estimate"],
                "show_intent_window": r["show_intent_window"],
                "total_hearings_held": int(r["total_hearings_held"] or 0),
            }
        )
    return out


def duration_lookup_for(conn: sqlite3.Connection, judge_id: str) -> dict:
    table = get_duration_table(conn, judge_id)
    return build_duration_lookup(table["rows"])


def save_draft(
    conn: sqlite3.Connection, judge_id: str, date: str, payload: dict[str, Any]
) -> dict[str, Any]:
    ts = now_iso()
    conn.execute(
        """
        INSERT INTO drafts (judge_id, date, payload_json, status, updated_at)
        VALUES (?, ?, ?, 'draft', ?)
        ON CONFLICT(judge_id, date) DO UPDATE SET
            payload_json=excluded.payload_json,
            status='draft',
            updated_at=excluded.updated_at
        """,
        (judge_id, date, json.dumps(payload), ts),
    )
    conn.commit()
    return payload


def get_draft(conn: sqlite3.Connection, judge_id: str, date: str) -> dict[str, Any] | None:
    row = conn.execute(
        "SELECT * FROM drafts WHERE judge_id = ? AND date = ?",
        (judge_id, date),
    ).fetchone()
    if not row:
        return None
    payload = json.loads(row["payload_json"])
    payload["_meta"] = {
        "status": row["status"],
        "updated_at": row["updated_at"],
    }
    return payload


def generate_causelist(
    conn: sqlite3.Connection,
    *,
    judge_id: str = DEFAULT_JUDGE_ID,
    sitting_date: str,
    overbook_buffer_pct: float | None = None,
    force_holiday: bool = False,
    blocks: list[dict[str, Any]] | None = None,
    exclude_case_numbers: list[str] | set[str] | None = None,
) -> dict[str, Any]:
    """Run packer on READY pool; persist draft. Raises ValueError on holiday."""
    _ensure_judge(conn, judge_id)

    if not is_working_day(sitting_date) and not force_holiday:
        name = holiday_name(sitting_date) or "non-working day"
        raise ValueError(
            f"Date {sitting_date} is a {name}. Pass force_holiday=true to override."
        )

    prefs = get_prefs(conn, judge_id)
    template = get_sitting_template(conn, judge_id)
    use_blocks = blocks if blocks else template["blocks"]
    capacity = int(template["capacity_mins"] or prefs["capacity_mins_default"] or 420)
    buffer = (
        clamp_buffer(overbook_buffer_pct)
        if overbook_buffer_pct is not None
        else clamp_buffer(prefs["overbook_buffer_pct"])
    )

    cases = ready_pool(conn)
    lookup = duration_lookup_for(conn, judge_id)
    draft = pack(
        judge_id=judge_id,
        sitting_date=sitting_date,
        ready_cases=cases,
        blocks=use_blocks,
        capacity_mins=capacity,
        overbook_buffer_pct=buffer,
        age_weight=prefs["age_weight"],
        duration_lookup=lookup,
        exclude_case_numbers=exclude_case_numbers,
        strict_adjournment_band=bool(prefs["strict_adjournment_band"]),
    )
    save_draft(conn, judge_id, sitting_date, draft)
    return draft
