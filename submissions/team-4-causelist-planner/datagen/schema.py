"""DuckDB side of the generator: build the schema from the DDL, insert rows, export and load Parquet.

Rows go into a DuckDB created from docs/scheduler-schema.sql itself, so every PK, UNIQUE, NOT NULL,
CHECK and FK constraint is enforced on insert: a generator bug fails loudly instead of producing
files that won't load.
"""
from __future__ import annotations

import json
from datetime import date, datetime, time
from pathlib import Path

import duckdb
import pandas as pd

DDL_PATH = Path(__file__).resolve().parent.parent / "docs" / "scheduler-schema.sql"

# Parents before children, so both inserting and loading satisfy every foreign key.
TABLE_ORDER = [
    "judge", "court_hall", "hearing_type", "adjournment_reason", "advocate",
    "court_case", "party", "advocate_mapping",
    "court_calendar", "judge_leave", "scheduling_preset", "time_block",
    "scheduling_run", "causelist", "causelist_item", "listing_decision",
    "hearing", "hearing_outcome", "adjournment",
    "application", "court_order", "task", "case_stage_history",
]


def connect(db: str | Path = ":memory:") -> duckdb.DuckDBPyConnection:
    """A connection with the scheduler schema (tables and views) created."""
    con = duckdb.connect(str(db))
    con.execute(DDL_PATH.read_text())
    return con


def _plain(v):
    """Python value -> something pandas/DuckDB scan unambiguously; the INSERT casts it back."""
    if isinstance(v, (dict, list, tuple)):
        return json.dumps(v, default=str)
    if isinstance(v, (date, datetime, time)):
        return v.isoformat()
    return v


def _cast(col: str, typ: str) -> str:
    if typ == "JSON":
        return f"CAST({col} AS JSON)"
    if typ.endswith("[]"):
        return f"from_json({col}, '[\"{typ[:-2]}\"]')"
    return f"CAST({col} AS {typ})"


def insert(con: duckdb.DuckDBPyConnection, table: str, rows: list[dict]) -> None:
    cols = con.execute(f"DESCRIBE {table}").fetchall()
    names = [c[0] for c in cols]
    unknown = {k for r in rows for k in r} - set(names)
    if unknown:
        raise ValueError(f"{table}: columns not in the schema: {sorted(unknown)}")
    df = pd.DataFrame([[_plain(r.get(n)) for n in names] for r in rows], columns=names, dtype=object)
    con.register("_rows", df)
    try:
        select = ", ".join(_cast(f'"{n}"', t) for n, t, *_ in cols)
        con.execute(f"INSERT INTO {table} ({', '.join(names)}) SELECT {select} FROM _rows")
    finally:
        con.unregister("_rows")


def export_parquet(con: duckdb.DuckDBPyConnection, out: Path) -> dict[str, int]:
    out.mkdir(parents=True, exist_ok=True)
    counts = {}
    for t in TABLE_ORDER:
        con.execute(f"COPY (SELECT * FROM {t}) TO '{out / f'{t}.parquet'}' (FORMAT parquet)")
        counts[t] = con.execute(f"SELECT count(*) FROM {t}").fetchone()[0]
    return counts


def load_parquet(con: duckdb.DuckDBPyConnection, src: Path) -> dict[str, int]:
    """Load every <table>.parquet in `src` into the (already created) schema, in FK order."""
    counts = {}
    for t in TABLE_ORDER:
        path = src / f"{t}.parquet"
        if not path.exists():
            raise FileNotFoundError(path)
        con.execute(f"INSERT INTO {t} BY NAME SELECT * FROM read_parquet('{path}')")
        counts[t] = con.execute(f"SELECT count(*) FROM {t}").fetchone()[0]
    return counts
