"""Persistence + party/registry action orchestration."""

from __future__ import annotations

import json
import sqlite3
import uuid
from typing import Any

from .catalog import (
    DEFECT_DESCRIPTIONS,
    DEFECT_PRIMARY_ACTION,
    DEFECT_SEVERITY,
    PARTY_COUNSEL_ACTIONS,
    ROLE_OWNERS,
    action_label_for,
    can_act,
    default_blocking,
    duration_mins_for,
    is_locked,
    owner_for,
    severity_for,
)
from .db import connect, init_db
from .readiness import (
    age_days,
    blocking_open_count,
    now_iso,
    open_defect_count,
    open_soft_defect_count,
    recompute_readiness,
)


def _row_to_dict(row: sqlite3.Row | None) -> dict[str, Any] | None:
    if row is None:
        return None
    return dict(row)


def _audit(
    conn: sqlite3.Connection,
    *,
    case_number: str | None,
    defect_id: str | None,
    actor_role: str,
    action: str,
    from_status: str | None,
    to_status: str | None,
    note: str | None = None,
) -> None:
    conn.execute(
        """
        INSERT INTO audit_log (case_number, defect_id, actor_role, action, from_status, to_status, note, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (case_number, defect_id, actor_role, action, from_status, to_status, note, now_iso()),
    )



def get_policy(conn: sqlite3.Connection) -> dict[str, dict[str, bool]]:
    """Return {code: {blocking, locked_by_law}} for all known defect codes."""
    rows = conn.execute(
        "SELECT code, blocking, locked_by_law FROM defect_policy ORDER BY code"
    ).fetchall()
    out: dict[str, dict[str, bool]] = {}
    for r in rows:
        out[r["code"]] = {
            "blocking": bool(r["blocking"]),
            "locked_by_law": bool(r["locked_by_law"]),
        }
    # ensure catalog codes present even if seed missed one
    for code in DEFECT_SEVERITY:
        if code not in out:
            out[code] = {
                "blocking": default_blocking(code),
                "locked_by_law": is_locked(code),
            }
    return out


def policy_blocking_map(conn: sqlite3.Connection) -> dict[str, bool]:
    return {code: info["blocking"] for code, info in get_policy(conn).items()}


def enrich_defect(
    d: dict[str, Any],
    *,
    policy: dict[str, dict[str, bool]] | None = None,
    role: str | None = None,
) -> dict[str, Any]:
    """Attach blocking / locked_by_law (and optional action fields) to a defect."""
    item = dict(d)
    code = item.get("code") or ""
    item["description"] = DEFECT_DESCRIPTIONS.get(code, "")
    if policy and code in policy:
        item["blocking"] = bool(policy[code]["blocking"])
        item["locked_by_law"] = bool(policy[code]["locked_by_law"])
    else:
        item["blocking"] = default_blocking(code)
        item["locked_by_law"] = is_locked(code)
    if "severity" not in item or not item["severity"]:
        item["severity"] = severity_for(code)
    if role is not None:
        item["action_label"] = action_label_for(item.get("owner") or "", role)
        item["can_act"] = can_act(
            item.get("owner") or "", role, item.get("status") or "open", code
        )
        item["primary_action"] = DEFECT_PRIMARY_ACTION.get(code, "")
    return item


def recompute_all_cases(conn: sqlite3.Connection) -> dict[str, int]:
    """Recompute readiness_status for every case using live policy."""
    policy_map = policy_blocking_map(conn)
    rows = conn.execute("SELECT case_number FROM cases").fetchall()
    for r in rows:
        defects = get_defects(conn, r["case_number"])
        status = recompute_readiness(defects, policy=policy_map)
        set_case_status(conn, r["case_number"], status)
    # return fresh stats
    stats_rows = conn.execute(
        "SELECT readiness_status, COUNT(*) AS n FROM cases GROUP BY readiness_status"
    ).fetchall()
    counts = {"READY": 0, "BLOCKED": 0, "HEALING": 0}
    for sr in stats_rows:
        counts[sr["readiness_status"]] = sr["n"]
    return counts


def set_policy(
    conn: sqlite3.Connection, code: str, blocking: bool, role: str
) -> dict[str, Any]:
    """Update blocking for a toggleable code; reject locked-by-law. Recomputes all cases."""
    code = (code or "").strip().upper()
    if code not in DEFECT_SEVERITY:
        raise KeyError(f"Unknown defect code: {code}")
    policy = get_policy(conn)
    info = policy.get(code) or {
        "blocking": default_blocking(code),
        "locked_by_law": is_locked(code),
    }
    if info["locked_by_law"] or is_locked(code):
        raise PermissionError(f"Defect code {code} is locked by law and cannot be softened")
    # locked codes must stay blocking; for toggleable, honour request
    new_blocking = bool(blocking)
    ts = now_iso()
    conn.execute(
        """
        INSERT INTO defect_policy (code, blocking, locked_by_law, updated_at, updated_by)
        VALUES (?, ?, 0, ?, ?)
        ON CONFLICT(code) DO UPDATE SET
            blocking=excluded.blocking,
            updated_at=excluded.updated_at,
            updated_by=excluded.updated_by
        """,
        (code, 1 if new_blocking else 0, ts, role),
    )
    _audit(
        conn,
        case_number=None,
        defect_id=None,
        actor_role=role,
        action="set_policy",
        from_status="blocking" if info["blocking"] else "soft",
        to_status="blocking" if new_blocking else "soft",
        note=f"policy {code}",
    )
    counts = recompute_all_cases(conn)
    conn.commit()
    updated = get_policy(conn)[code]
    return {
        "code": code,
        "blocking": updated["blocking"],
        "locked_by_law": updated["locked_by_law"],
        "severity": severity_for(code),
        "stats": {"total": sum(counts.values()), **counts},
    }


def get_defects(conn: sqlite3.Connection, case_number: str) -> list[dict[str, Any]]:
    rows = conn.execute(
        "SELECT * FROM defects WHERE case_number = ? ORDER BY code",
        (case_number,),
    ).fetchall()
    return [dict(r) for r in rows]


def get_defect(conn: sqlite3.Connection, defect_id: str) -> dict[str, Any] | None:
    return _row_to_dict(
        conn.execute("SELECT * FROM defects WHERE id = ?", (defect_id,)).fetchone()
    )


def set_case_status(conn: sqlite3.Connection, case_number: str, status: str) -> None:
    conn.execute(
        "UPDATE cases SET readiness_status = ?, updated_at = ? WHERE case_number = ?",
        (status, now_iso(), case_number),
    )


def refresh_case_status(conn: sqlite3.Connection, case_number: str) -> str:
    defects = get_defects(conn, case_number)
    status = recompute_readiness(defects, policy=policy_blocking_map(conn))
    set_case_status(conn, case_number, status)
    return status


def list_cases(
    conn: sqlite3.Connection,
    *,
    status: str | None = None,
    purpose: str | None = None,
    q: str | None = None,
) -> list[dict[str, Any]]:
    sql = "SELECT * FROM cases WHERE 1=1"
    params: list[Any] = []
    if status:
        sql += " AND readiness_status = ?"
        params.append(status.upper())
    if purpose:
        sql += " AND (purpose_norm = ? OR upper(purpose_of_next_hearing) = upper(?))"
        params.extend([purpose.upper(), purpose])
    if q:
        sql += " AND (case_number LIKE ? OR filing_number LIKE ? OR last_hearing_summary LIKE ?)"
        like = f"%{q}%"
        params.extend([like, like, like])
    sql += " ORDER BY filing_date ASC, case_number ASC"
    rows = conn.execute(sql, params).fetchall()
    policy = get_policy(conn)
    policy_map = {c: info["blocking"] for c, info in policy.items()}
    out: list[dict[str, Any]] = []
    for r in rows:
        d = dict(r)
        defects = get_defects(conn, d["case_number"])
        d["open_defect_count"] = open_defect_count(defects)
        d["blocking_open_count"] = blocking_open_count(defects, policy=policy_map)
        d["open_soft_defect_count"] = open_soft_defect_count(defects, policy=policy_map)
        d["age_days"] = age_days(d.get("filing_date"))
        d["purpose"] = d.get("purpose_norm") or d.get("purpose_of_next_hearing")
        d["stage"] = d.get("current_stage_norm") or d.get("current_stage")
        out.append(d)
    return out


def get_case_detail(
    conn: sqlite3.Connection, case_number: str, role: str = "counsel"
) -> dict[str, Any] | None:
    row = conn.execute(
        "SELECT * FROM cases WHERE case_number = ?", (case_number,)
    ).fetchone()
    if not row:
        return None
    case = dict(row)
    defects = get_defects(conn, case_number)
    policy = get_policy(conn)
    policy_map = {c: info["blocking"] for c, info in policy.items()}
    enriched = [enrich_defect(d, policy=policy, role=role) for d in defects]
    case["defects"] = enriched
    case["open_defect_count"] = open_defect_count(defects)
    case["blocking_open_count"] = blocking_open_count(defects, policy=policy_map)
    case["open_soft_defect_count"] = open_soft_defect_count(defects, policy=policy_map)
    case["age_days"] = age_days(case.get("filing_date"))
    case["purpose"] = case.get("purpose_norm")
    case["stage"] = case.get("current_stage_norm")
    return case


def apply_party_action(
    conn: sqlite3.Connection,
    *,
    case_number: str,
    defect_id: str,
    action: str,
    role: str = "counsel",
    note: str | None = None,
    evidence_uri: str | None = None,
    window: str | None = None,
) -> dict[str, Any]:
    action = (action or "").strip().lower()
    role = (role or "counsel").lower()
    if action not in PARTY_COUNSEL_ACTIONS:
        raise ValueError(f"Unknown action: {action}")

    case = conn.execute(
        "SELECT * FROM cases WHERE case_number = ?", (case_number,)
    ).fetchone()
    if not case:
        raise KeyError(f"Case not found: {case_number}")

    # flag_adjournment creates/opens ADJOURNMENT_PREDECLARED (may ignore defect_id)
    if action == "flag_adjournment":
        return _flag_adjournment(conn, case_number=case_number, role=role, note=note)

    defect = get_defect(conn, defect_id)
    if not defect or defect["case_number"] != case_number:
        raise KeyError(f"Defect not found: {defect_id}")

    if defect["code"] == "COURT_ADMIN_BLOCK" and role != "registry":
        raise PermissionError("Party/counsel cannot clear COURT_ADMIN_BLOCK")

    owner = defect["owner"]
    if role != "registry" and owner not in ROLE_OWNERS.get(role, frozenset()):
        # process_ack: seed owner is COURT but party may act as process-taker
        if not (action == "process_ack" and defect["code"] == "PROCESS_RETURN_PENDING"):
            if not (action == "eta_report" and defect["code"] == "EXTERNAL_REPORT_PENDING"):
                raise PermissionError(
                    f"Role {role} cannot act on defect owned by {owner}"
                )

    if action == "withdraw_adjournment":
        if defect["code"] != "ADJOURNMENT_PREDECLARED":
            raise ValueError("withdraw_adjournment only applies to ADJOURNMENT_PREDECLARED")
        return _update_defect(
            conn,
            defect=defect,
            new_status="cleared",
            role=role,
            action=action,
            note=note or "Adjournment flag withdrawn",
        )

    if action == "eta_report":
        # note only — stays open
        ts = now_iso()
        eta_note = note or "ETA provided"
        merged = (defect.get("note") or "")
        merged = f"{merged}\nETA: {eta_note}".strip() if merged else f"ETA: {eta_note}"
        conn.execute(
            "UPDATE defects SET note = ?, updated_at = ?, updated_by = ? WHERE id = ?",
            (merged, ts, role, defect_id),
        )
        _audit(
            conn,
            case_number=case_number,
            defect_id=defect_id,
            actor_role=role,
            action=action,
            from_status=defect["status"],
            to_status=defect["status"],
            note=eta_note,
        )
        status = refresh_case_status(conn, case_number)
        conn.commit()
        d = get_defect(conn, defect_id)
        return {
            "defect": enrich_defect(d, policy=get_policy(conn)) if d else None,
            "readiness_status": status,
        }

    if action == "rsvp":
        # L1: auto-clear RSVP_SHOW_INTENT
        if defect["code"] != "RSVP_SHOW_INTENT":
            raise ValueError("rsvp only clears RSVP_SHOW_INTENT")
        if window:
            conn.execute(
                "UPDATE cases SET show_intent_window = ?, updated_at = ? WHERE case_number = ?",
                (window, now_iso(), case_number),
            )
        return _update_defect(
            conn,
            defect=defect,
            new_status="cleared",
            role=role,
            action=action,
            note=note or (f"RSVP window={window}" if window else "RSVP: court date OK"),
            evidence_uri=evidence_uri,
        )

    # upload / confirm_* / process_ack / undertake → submitted
    submit_actions = {
        "upload",
        "confirm_evidence",
        "confirm_counsel",
        "process_ack",
        "undertake",
    }
    if action in submit_actions:
        return _update_defect(
            conn,
            defect=defect,
            new_status="submitted",
            role=role,
            action=action,
            note=note,
            evidence_uri=evidence_uri,
        )

    raise ValueError(f"Unhandled action: {action}")


def _flag_adjournment(
    conn: sqlite3.Connection,
    *,
    case_number: str,
    role: str,
    note: str | None,
) -> dict[str, Any]:
    existing = conn.execute(
        "SELECT * FROM defects WHERE case_number = ? AND code = ?",
        (case_number, "ADJOURNMENT_PREDECLARED"),
    ).fetchone()
    ts = now_iso()
    if existing:
        defect = dict(existing)
        conn.execute(
            """
            UPDATE defects SET status = 'open', note = ?, updated_at = ?, updated_by = ?,
                   source = COALESCE(source, 'manual')
            WHERE id = ?
            """,
            (note or "Adjournment predeclared", ts, role, defect["id"]),
        )
        _audit(
            conn,
            case_number=case_number,
            defect_id=defect["id"],
            actor_role=role,
            action="flag_adjournment",
            from_status=defect["status"],
            to_status="open",
            note=note,
        )
        defect_id = defect["id"]
    else:
        defect_id = str(uuid.uuid4())
        purpose = conn.execute(
            "SELECT purpose_norm FROM cases WHERE case_number = ?", (case_number,)
        ).fetchone()
        purpose_val = purpose["purpose_norm"] if purpose else None
        conn.execute(
            """
            INSERT INTO defects
            (id, case_number, code, purpose, owner, severity, status, source, note, updated_at, updated_by)
            VALUES (?, ?, 'ADJOURNMENT_PREDECLARED', ?, 'COUNSEL', 'HARD', 'open', 'manual', ?, ?, ?)
            """,
            (
                defect_id,
                case_number,
                purpose_val,
                note or "Adjournment predeclared",
                ts,
                role,
            ),
        )
        _audit(
            conn,
            case_number=case_number,
            defect_id=defect_id,
            actor_role=role,
            action="flag_adjournment",
            from_status=None,
            to_status="open",
            note=note,
        )
    status = refresh_case_status(conn, case_number)
    conn.commit()
    d = get_defect(conn, defect_id)
    return {
        "defect": enrich_defect(d, policy=get_policy(conn)) if d else None,
        "readiness_status": status,
    }


def _update_defect(
    conn: sqlite3.Connection,
    *,
    defect: dict[str, Any],
    new_status: str,
    role: str,
    action: str,
    note: str | None = None,
    evidence_uri: str | None = None,
    reject_reason: str | None = None,
) -> dict[str, Any]:
    ts = now_iso()
    from_status = defect["status"]
    conn.execute(
        """
        UPDATE defects
        SET status = ?, note = COALESCE(?, note), evidence_uri = COALESCE(?, evidence_uri),
            reject_reason = COALESCE(?, reject_reason),
            updated_at = ?, updated_by = ?
        WHERE id = ?
        """,
        (
            new_status,
            note,
            evidence_uri,
            reject_reason,
            ts,
            role,
            defect["id"],
        ),
    )
    _audit(
        conn,
        case_number=defect["case_number"],
        defect_id=defect["id"],
        actor_role=role,
        action=action,
        from_status=from_status,
        to_status=new_status,
        note=note or reject_reason,
    )
    status = refresh_case_status(conn, defect["case_number"])
    conn.commit()
    d = get_defect(conn, defect["id"])
    return {
        "defect": enrich_defect(d, policy=get_policy(conn)) if d else None,
        "readiness_status": status,
    }


def registry_verify(
    conn: sqlite3.Connection, defect_id: str, role: str = "registry", note: str | None = None
) -> dict[str, Any]:
    if role != "registry":
        raise PermissionError("Only registry can verify")
    defect = get_defect(conn, defect_id)
    if not defect:
        raise KeyError(f"Defect not found: {defect_id}")
    if defect["status"] != "submitted":
        raise ValueError(f"Defect must be submitted to verify (got {defect['status']})")
    return _update_defect(
        conn,
        defect=defect,
        new_status="cleared",
        role=role,
        action="verify",
        note=note or "Verified by registry",
    )


def registry_reject(
    conn: sqlite3.Connection, defect_id: str, reason: str, role: str = "registry"
) -> dict[str, Any]:
    if role != "registry":
        raise PermissionError("Only registry can reject")
    if not reason or not reason.strip():
        raise ValueError("Reject reason is required")
    defect = get_defect(conn, defect_id)
    if not defect:
        raise KeyError(f"Defect not found: {defect_id}")
    if defect["status"] != "submitted":
        raise ValueError(f"Defect must be submitted to reject (got {defect['status']})")
    return _update_defect(
        conn,
        defect=defect,
        new_status="rejected",
        role=role,
        action="reject",
        note=reason,
        reject_reason=reason,
    )


def registry_waive(
    conn: sqlite3.Connection, defect_id: str, note: str, role: str = "registry"
) -> dict[str, Any]:
    if role != "registry":
        raise PermissionError("Only registry can waive")
    if not note or not note.strip():
        raise ValueError("Waive note is mandatory")
    defect = get_defect(conn, defect_id)
    if not defect:
        raise KeyError(f"Defect not found: {defect_id}")
    return _update_defect(
        conn,
        defect=defect,
        new_status="waived",
        role=role,
        action="waive",
        note=note,
    )


def registry_queue(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    rows = conn.execute(
        """
        SELECT d.*, c.purpose_norm, c.advocate_id, c.party_id, c.readiness_status
        FROM defects d
        JOIN cases c ON c.case_number = d.case_number
        WHERE d.status = 'submitted'
        ORDER BY d.updated_at ASC
        """
    ).fetchall()
    policy = get_policy(conn)
    return [enrich_defect(dict(r), policy=policy) for r in rows]


def eligibility(conn: sqlite3.Connection, as_of: str = "2026-09-22") -> dict[str, Any]:
    rows = conn.execute(
        "SELECT * FROM cases WHERE readiness_status = 'READY' ORDER BY filing_date ASC"
    ).fetchall()
    cases_out = []
    for r in rows:
        case = dict(r)
        defects = get_defects(conn, case["case_number"])
        cleared = [
            d["code"]
            for d in defects
            if d["status"] in ("cleared", "waived")
        ]
        cases_out.append(
            {
                "case_number": case["case_number"],
                "filing_number": case["filing_number"],
                "filing_date": case["filing_date"],
                "current_stage": case["current_stage"],
                "purpose_of_next_hearing": case["purpose_norm"],
                "advocate_id": case["advocate_id"],
                "party_id": case["party_id"],
                "readiness_status": "READY",
                "cleared_defect_codes": cleared,
                "show_intent_window": case.get("show_intent_window"),
                "duration_mins_estimate": case.get("duration_mins_estimate")
                or duration_mins_for(case.get("purpose_norm") or ""),
            }
        )
    return {"as_of": as_of, "cases": cases_out}



def wipe_demo(conn: sqlite3.Connection) -> dict[str, Any]:
    """Clear cases/defects/drafts/audit; leave schema + policy/prefs intact."""
    # Order matters under FK: defects → cases; drafts/audit independent
    conn.execute("DELETE FROM defects")
    conn.execute("DELETE FROM cases")
    conn.execute("DELETE FROM drafts")
    conn.execute("DELETE FROM audit_log")
    conn.commit()
    return {"ok": True, "total": 0}


def stats(conn: sqlite3.Connection) -> dict[str, Any]:
    rows = conn.execute(
        """
        SELECT readiness_status, COUNT(*) AS n
        FROM cases
        GROUP BY readiness_status
        """
    ).fetchall()
    counts = {"READY": 0, "BLOCKED": 0, "HEALING": 0}
    for r in rows:
        counts[r["readiness_status"]] = r["n"]
    total = sum(counts.values())
    return {"total": total, **counts}


class Store:
    """Thin wrapper holding a DB path."""

    def __init__(self, db_path: str | None = None):
        self.db_path = db_path
        init_db(db_path)

    def connect(self) -> sqlite3.Connection:
        return connect(self.db_path)
