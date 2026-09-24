"""SQLite schema and connection helpers for readiness + scheduler store."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

DEFAULT_DB_PATH = Path(__file__).resolve().parent.parent / "data" / "readiness.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS cases (
    case_number TEXT PRIMARY KEY,
    filing_number TEXT,
    filing_date TEXT,
    advocate_id TEXT,
    party_id TEXT,
    current_stage TEXT,
    current_stage_norm TEXT,
    purpose_of_next_hearing TEXT,
    purpose_norm TEXT,
    last_hearing_summary TEXT,
    total_hearings_held INTEGER DEFAULT 0,
    readiness_status TEXT NOT NULL DEFAULT 'BLOCKED',
    duration_mins_estimate INTEGER,
    show_intent_window TEXT,
    updated_at TEXT
);

CREATE TABLE IF NOT EXISTS defects (
    id TEXT PRIMARY KEY,
    case_number TEXT NOT NULL,
    code TEXT NOT NULL,
    purpose TEXT,
    owner TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'HARD',
    status TEXT NOT NULL DEFAULT 'open',
    source TEXT,
    evidence_uri TEXT,
    note TEXT,
    reject_reason TEXT,
    due_at TEXT,
    updated_at TEXT,
    updated_by TEXT,
    UNIQUE(case_number, code),
    FOREIGN KEY (case_number) REFERENCES cases(case_number)
);

CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    case_number TEXT,
    defect_id TEXT,
    actor_role TEXT,
    action TEXT,
    from_status TEXT,
    to_status TEXT,
    note TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS defect_policy (
    code TEXT PRIMARY KEY,
    blocking INTEGER NOT NULL,
    locked_by_law INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT,
    updated_by TEXT
);

CREATE TABLE IF NOT EXISTS duration_table (
    judge_id TEXT NOT NULL,
    purpose TEXT NOT NULL,
    stage TEXT NOT NULL DEFAULT '',
    minutes INTEGER NOT NULL,
    updated_at TEXT,
    PRIMARY KEY (judge_id, purpose, stage)
);

CREATE TABLE IF NOT EXISTS judge_prefs (
    judge_id TEXT PRIMARY KEY,
    overbook_buffer_pct REAL NOT NULL DEFAULT 0.25,
    age_weight REAL NOT NULL DEFAULT 2.0,
    prefer_same_advocate_cluster INTEGER NOT NULL DEFAULT 0,
    virtual_hybrid_default INTEGER NOT NULL DEFAULT 1,
    strict_adjournment_band INTEGER NOT NULL DEFAULT 1,
    max_cases_per_block INTEGER,
    capacity_mins_default INTEGER NOT NULL DEFAULT 420,
    updated_at TEXT
);

CREATE TABLE IF NOT EXISTS sitting_templates (
    judge_id TEXT PRIMARY KEY,
    capacity_mins INTEGER NOT NULL DEFAULT 420,
    blocks_json TEXT NOT NULL,
    updated_at TEXT
);

CREATE TABLE IF NOT EXISTS drafts (
    judge_id TEXT NOT NULL,
    date TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    updated_at TEXT,
    PRIMARY KEY (judge_id, date)
);

CREATE INDEX IF NOT EXISTS idx_defects_case ON defects(case_number);
CREATE INDEX IF NOT EXISTS idx_defects_status ON defects(status);
CREATE INDEX IF NOT EXISTS idx_cases_status ON cases(readiness_status);
CREATE INDEX IF NOT EXISTS idx_audit_case ON audit_log(case_number);
CREATE INDEX IF NOT EXISTS idx_duration_judge ON duration_table(judge_id);
CREATE INDEX IF NOT EXISTS idx_drafts_judge ON drafts(judge_id);
"""


def get_db_path(path: str | Path | None = None) -> Path:
    p = Path(path) if path else DEFAULT_DB_PATH
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


def connect(path: str | Path | None = None) -> sqlite3.Connection:
    db_path = get_db_path(path)
    conn = sqlite3.connect(str(db_path), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def seed_defect_policy(conn: sqlite3.Connection) -> None:
    """INSERT OR IGNORE policy rows from catalog defaults."""
    from datetime import datetime
    from zoneinfo import ZoneInfo

    from .catalog import DEFECT_SEVERITY, default_blocking, is_locked

    ts = datetime.now(ZoneInfo("Asia/Calcutta")).isoformat(timespec="seconds")
    for code in DEFECT_SEVERITY:
        conn.execute(
            """
            INSERT OR IGNORE INTO defect_policy
                (code, blocking, locked_by_law, updated_at, updated_by)
            VALUES (?, ?, ?, ?, 'system')
            """,
            (
                code,
                1 if default_blocking(code) else 0,
                1 if is_locked(code) else 0,
                ts,
            ),
        )


def seed_scheduler_defaults(conn: sqlite3.Connection, judge_id: str = "J-SEHGAL") -> None:
    """Seed duration table, prefs, and KA-like sitting template for default judge."""
    from datetime import datetime
    from zoneinfo import ZoneInfo

    from .packer import DEFAULT_BLOCKS
    from .probabilities import all_purposes, system_duration_mins

    ts = datetime.now(ZoneInfo("Asia/Calcutta")).isoformat(timespec="seconds")

    for purpose in all_purposes():
        mins = system_duration_mins(purpose)
        conn.execute(
            """
            INSERT OR IGNORE INTO duration_table
                (judge_id, purpose, stage, minutes, updated_at)
            VALUES (?, ?, '', ?, ?)
            """,
            (judge_id, purpose, mins, ts),
        )

    conn.execute(
        """
        INSERT OR IGNORE INTO judge_prefs (
            judge_id, overbook_buffer_pct, age_weight,
            prefer_same_advocate_cluster, virtual_hybrid_default,
            strict_adjournment_band, max_cases_per_block,
            capacity_mins_default, updated_at
        ) VALUES (?, 0.25, 2.0, 0, 1, 1, NULL, 420, ?)
        """,
        (judge_id, ts),
    )

    conn.execute(
        """
        INSERT OR IGNORE INTO sitting_templates
            (judge_id, capacity_mins, blocks_json, updated_at)
        VALUES (?, 420, ?, ?)
        """,
        (judge_id, json.dumps(DEFAULT_BLOCKS), ts),
    )


def init_db(path: str | Path | None = None) -> Path:
    db_path = get_db_path(path)
    conn = connect(db_path)
    try:
        conn.executescript(SCHEMA)
        seed_defect_policy(conn)
        seed_scheduler_defaults(conn)
        conn.commit()
    finally:
        conn.close()
    return db_path


def case_count(path: str | Path | None = None) -> int:
    conn = connect(path)
    try:
        row = conn.execute("SELECT COUNT(*) AS n FROM cases").fetchone()
        return int(row["n"]) if row else 0
    except sqlite3.OperationalError:
        return 0
    finally:
        conn.close()
