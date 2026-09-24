"""Seed readiness DB from roster CSV (idempotent upsert).

Usage:
  python -m src.seed
  python -m src.seed --roster /path/to/roster_sample_100.csv
"""

from __future__ import annotations

import argparse
import csv
import re
import sys
import uuid
from pathlib import Path
from typing import Any

from .catalog import (
    LOW_SUBSTANTIVENESS,
    PURPOSE_REQUIRED_CODES,
    duration_mins_for,
    owner_for,
    severity_for,
)
from .db import connect, init_db
from .normalize import to_upper_snake
from .readiness import now_iso, recompute_readiness

PROJECT_ROOT = Path(__file__).resolve().parent.parent

# Prefer the submission-local 3k demo roster, then the hackathon-level copy.
# Keep the sample roster as a final fallback for older checkouts.
DEFAULT_ROSTER = PROJECT_ROOT / "data" / "roster_3000.csv"
ALT_ROSTER = PROJECT_ROOT / ".." / ".." / "data" / "roster_3000.csv"
SAMPLE_ROSTERS = (
    PROJECT_ROOT / "data" / "roster_sample_100.csv",
    PROJECT_ROOT / ".." / ".." / "data" / "roster_sample_100.csv",
)
# Local demo roster (submissions/sama-panda/data/roster_3000.csv)
ROSTER_3000 = Path(__file__).resolve().parent.parent / "data" / "roster_3000.csv"
HEARING_TYPE_REF = (
    Path(__file__).resolve().parent.parent.parent.parent
    / "data"
    / "hearing_type_reference.csv"
)

CLEARLY_READY_PATTERNS = [
    re.compile(r"ready\s+for\s+(cross|arguments|evidence|hearing)", re.I),
    re.compile(r"matter\s+is\s+ready", re.I),
    re.compile(r"for\s+orders?\s*$", re.I),
]


def load_duration_map(path: Path | None = None) -> dict[str, int]:
    ref = path or HEARING_TYPE_REF
    if not ref.exists():
        return {}
    out: dict[str, int] = {}
    with ref.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            purpose = to_upper_snake(row.get("Hearing Purpose") or "")
            raw = row.get("Time it takes for hearing (mins) - estimated") or ""
            try:
                out[purpose] = int(float(raw))
            except (TypeError, ValueError):
                continue
    return out


def summary_suggests_process_pending(summary: str) -> bool:
    s = summary or ""
    patterns = [
        r"return of warrant",
        r"\bNBW\b",
        r"summons",
        r"take steps",
        r"await(?:ing)?\s+process",
        r"process\s+pending",
        r"issue\s+(?:nbw|summons|warrant)",
        r"for\s+return",
    ]
    return any(re.search(p, s, re.I) for p in patterns)


# Purposes where an Absent: line meaningfully raises attendance risk
_ABSENCE_SENSITIVE: frozenset[str] = frozenset(
    {
        "APPEARANCE",
        "WARRANT",
        "PLEA",
        "EVIDENCE_COMPLAINANT",
        "EVIDENCE_ACCUSED",
        "BAIL",
        "EXAMINATION_UNDER_S351_BNSS",
    }
)


def keyword_overlays(summary: str, purpose: str | None = None) -> set[str]:
    """PRD §6 keyword rules on last_hearing_summary."""
    s = summary or ""
    codes: set[str] = set()
    if re.search(r"return of warrant|\bNBW\b|summons|take steps", s, re.I):
        codes.add("PROCESS_RETURN_PENDING")
    if re.search(r"not ready for cross|counsel not ready", s, re.I):
        codes.add("COUNSEL_NOT_READY")
    if re.search(r"last chance", s, re.I) and re.search(
        r"absent|absence", s, re.I
    ):
        codes.add("PARTY_ABSENCE_RISK")
    # Roster lines often include an Absent: header; only raise risk on
    # presence-sensitive purposes so soft RSVP can leave many cases READY.
    if re.search(r"Absent:", s):
        if purpose is None or purpose in _ABSENCE_SENSITIVE:
            codes.add("PARTY_ABSENCE_RISK")
    if re.search(r"produce the order|mediation report|\bagency\b", s, re.I):
        if re.search(r"mediation report|\bagency\b|produce the order", s, re.I):
            if re.search(r"report|agency|order", s, re.I):
                codes.add("EXTERNAL_REPORT_PENDING")
            codes.add("FILING_NOT_READY")
    if re.search(r"file objections", s, re.I):
        codes.add("OBJECTION_PENDING")
    return codes


def clearly_ready(summary: str) -> bool:
    s = summary or ""
    return any(p.search(s) for p in CLEARLY_READY_PATTERNS)


def required_codes_for(purpose: str, summary: str) -> list[str]:
    base = list(PURPOSE_REQUIRED_CODES.get(purpose, ["RSVP_SHOW_INTENT"]))
    if purpose == "ADMISSION":
        # only add PROCESS if summary suggests
        if summary_suggests_process_pending(summary) and "PROCESS_RETURN_PENDING" not in base:
            base.insert(0, "PROCESS_RETURN_PENDING")
    # overlays
    for code in keyword_overlays(summary, purpose):
        if code not in base:
            base.append(code)
    return base


def ensure_hard_open_bias(
    purpose: str, codes: list[str], summary: str
) -> list[str]:
    """For low-substantiveness purposes ensure ≥1 hard defect unless clearly ready."""
    if purpose not in LOW_SUBSTANTIVENESS:
        return codes
    if clearly_ready(summary):
        return codes
    hard = {
        "PROCESS_RETURN_PENDING",
        "PARTY_ABSENCE_RISK",
        "FILING_NOT_READY",
        "EVIDENCE_NOT_READY",
        "COUNSEL_NOT_READY",
        "EXTERNAL_REPORT_PENDING",
        "OBJECTION_PENDING",
    }
    if any(c in hard for c in codes):
        return codes
    # inject a purpose-appropriate hard defect
    fallback = {
        "WARRANT": "PROCESS_RETURN_PENDING",
        "REPORTS": "EXTERNAL_REPORT_PENDING",
        "ARGUMENTS": "COUNSEL_NOT_READY",
        "EVIDENCE_ACCUSED": "EVIDENCE_NOT_READY",
    }
    inject = fallback.get(purpose, "FILING_NOT_READY")
    if inject not in codes:
        codes = list(codes) + [inject]
    return codes


def upsert_case(conn, row: dict[str, str], duration_map: dict[str, int]) -> str:
    case_number = row["case_number"].strip()
    purpose_raw = row.get("purpose_of_next_hearing") or ""
    stage_raw = row.get("current_stage") or ""
    purpose = to_upper_snake(purpose_raw)
    stage = to_upper_snake(stage_raw)
    duration = duration_map.get(purpose) or duration_mins_for(purpose)
    ts = now_iso()
    conn.execute(
        """
        INSERT INTO cases (
            case_number, filing_number, filing_date, advocate_id, party_id,
            current_stage, current_stage_norm, purpose_of_next_hearing, purpose_norm,
            last_hearing_summary, total_hearings_held, readiness_status,
            duration_mins_estimate, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'BLOCKED', ?, ?)
        ON CONFLICT(case_number) DO UPDATE SET
            filing_number=excluded.filing_number,
            filing_date=excluded.filing_date,
            advocate_id=excluded.advocate_id,
            party_id=excluded.party_id,
            current_stage=excluded.current_stage,
            current_stage_norm=excluded.current_stage_norm,
            purpose_of_next_hearing=excluded.purpose_of_next_hearing,
            purpose_norm=excluded.purpose_norm,
            last_hearing_summary=excluded.last_hearing_summary,
            total_hearings_held=excluded.total_hearings_held,
            duration_mins_estimate=excluded.duration_mins_estimate,
            updated_at=excluded.updated_at
        """,
        (
            case_number,
            row.get("filing_number"),
            row.get("filing_date"),
            row.get("advocate_id"),
            row.get("party_id"),
            stage_raw,
            stage,
            purpose_raw,
            purpose,
            row.get("last_hearing_summary") or "",
            int(row.get("total_hearings_held") or 0),
            duration,
            ts,
        ),
    )
    return case_number


def upsert_defect(
    conn,
    *,
    case_number: str,
    code: str,
    purpose: str,
    source: str = "seeded_from_prior",
) -> str:
    existing = conn.execute(
        "SELECT id, status FROM defects WHERE case_number = ? AND code = ?",
        (case_number, code),
    ).fetchone()
    ts = now_iso()
    if existing:
        # idempotent: do not clobber non-open statuses from prior demo actions
        if existing["status"] in ("cleared", "waived", "submitted", "rejected"):
            return existing["id"]
        conn.execute(
            """
            UPDATE defects SET purpose=?, owner=?, severity=?, source=?,
                   updated_at=?, updated_by='system'
            WHERE id=?
            """,
            (purpose, owner_for(code), severity_for(code), source, ts, existing["id"]),
        )
        return existing["id"]
    defect_id = str(uuid.uuid4())
    conn.execute(
        """
        INSERT INTO defects (
            id, case_number, code, purpose, owner, severity, status, source,
            updated_at, updated_by
        ) VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, 'system')
        """,
        (
            defect_id,
            case_number,
            code,
            purpose,
            owner_for(code),
            severity_for(code),
            source,
            ts,
        ),
    )
    return defect_id


def seed_roster(
    roster_path: Path,
    db_path: Path | str | None = None,
    *,
    reset_defects: bool = False,
) -> dict[str, Any]:
    roster_path = Path(roster_path).resolve()
    if not roster_path.exists():
        raise FileNotFoundError(f"Roster not found: {roster_path}")

    init_db(db_path)
    duration_map = load_duration_map()
    conn = connect(db_path)
    try:
        if reset_defects:
            conn.execute("DELETE FROM audit_log")
            conn.execute("DELETE FROM defects")
            conn.execute("DELETE FROM cases")
            conn.execute("DELETE FROM drafts")
            conn.commit()

        with roster_path.open(newline="", encoding="utf-8") as f:
            rows = list(csv.DictReader(f))

        policy_map = {
            r["code"]: bool(r["blocking"])
            for r in conn.execute("SELECT code, blocking FROM defect_policy").fetchall()
        }
        seeded = 0
        for row in rows:
            case_number = upsert_case(conn, row, duration_map)
            summary = row.get("last_hearing_summary") or ""
            purpose = to_upper_snake(row.get("purpose_of_next_hearing") or "")
            codes = required_codes_for(purpose, summary)
            codes = ensure_hard_open_bias(purpose, codes, summary)

            # mark overlay codes
            overlays = keyword_overlays(summary, purpose)
            for code in codes:
                source = (
                    "seeded_from_summary" if code in overlays else "seeded_from_prior"
                )
                upsert_defect(
                    conn,
                    case_number=case_number,
                    code=code,
                    purpose=purpose,
                    source=source,
                )

            defects = [
                dict(r)
                for r in conn.execute(
                    "SELECT * FROM defects WHERE case_number = ?",
                    (case_number,),
                ).fetchall()
            ]
            status = recompute_readiness(defects, policy=policy_map)
            conn.execute(
                "UPDATE cases SET readiness_status = ?, updated_at = ? WHERE case_number = ?",
                (status, now_iso(), case_number),
            )
            seeded += 1

        conn.commit()

        # stats
        stats_rows = conn.execute(
            "SELECT readiness_status, COUNT(*) AS n FROM cases GROUP BY readiness_status"
        ).fetchall()
        counts = {"READY": 0, "BLOCKED": 0, "HEALING": 0}
        for row in stats_rows:
            counts[row["readiness_status"]] = row["n"]
        counts = {"total": sum(counts.values()), **counts}
        return {
            "seeded_cases": seeded,
            "roster_path": str(roster_path),
            "counts": counts,
        }
    finally:
        conn.close()



def resolve_roster_3000() -> Path:
    """Resolve the 3k roster local to the submission, then hackathon-level."""
    for candidate in (DEFAULT_ROSTER, ALT_ROSTER):
        path = candidate.resolve()
        if path.exists():
            return path
    raise FileNotFoundError(f"Roster not found: {DEFAULT_ROSTER.resolve()}")


def seed_demo(db_path: Path | str | None = None) -> dict[str, Any]:
    """One-shot demo reset: wipe cases/defects/drafts/audit, then seed roster_3000."""
    from . import store as store_mod

    init_db(db_path)
    conn = connect(db_path)
    try:
        store_mod.wipe_demo(conn)
    finally:
        conn.close()

    result = seed_roster(resolve_roster_3000(), db_path, reset_defects=False)
    conn = connect(db_path)
    try:
        counts = store_mod.stats(conn)
    finally:
        conn.close()
    return {
        "ok": True,
        "seeded_cases": result["seeded_cases"],
        "roster_path": result["roster_path"],
        "counts": counts,
        "message": "Demo roster seeded; onboarding data is ready.",
    }


def resolve_default_roster() -> Path:
    """Resolve the onboarding roster in product-local-to-legacy order."""
    candidates = (DEFAULT_ROSTER, ALT_ROSTER, *SAMPLE_ROSTERS)
    for candidate in candidates:
        candidate = candidate.resolve()
        if candidate.exists():
            return candidate
    # Preserve the old failure mode: seed_roster will provide the useful 404.
    return DEFAULT_ROSTER.resolve()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Seed readiness DB from roster CSV")
    parser.add_argument(
        "--roster",
        type=Path,
        default=None,
        help="Path to roster CSV (default: ../../data/roster_sample_100.csv)",
    )
    parser.add_argument(
        "--db",
        type=Path,
        default=None,
        help="SQLite DB path (default: submissions/sama-panda/data/readiness.db)",
    )
    parser.add_argument(
        "--reset",
        action="store_true",
        help="Wipe cases/defects/audit before seeding",
    )
    args = parser.parse_args(argv)
    roster = args.roster or resolve_default_roster()
    result = seed_roster(roster, args.db, reset_defects=args.reset)
    print(json_dumps(result))
    return 0


def json_dumps(obj: Any) -> str:
    import json

    return json.dumps(obj, indent=2)


if __name__ == "__main__":
    sys.exit(main())
