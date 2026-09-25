"""Synthetic test data for every table in docs/scheduler-schema.sql, written as Parquet."""
from __future__ import annotations

import json
from datetime import date
from pathlib import Path

DEFAULT_TODAY = date(2026, 10, 5)


def build(out: Path, cases_per_judge: int = 1000, seed: int = 7, today: date = DEFAULT_TODAY,
          horizon_days: int = 10, presets: list[str] | None = None, db: str | None = None) -> dict[str, int]:
    """Generate, insert into a DuckDB built from the DDL (constraints checked), export Parquet + manifest."""
    from . import schema
    from .generate import generate

    rows = generate(cases_per_judge, seed, today, horizon_days, presets)
    con = schema.connect(db or ":memory:")
    try:
        for t in schema.TABLE_ORDER:
            schema.insert(con, t, rows.get(t, []))
        counts = schema.export_parquet(con, out)
    finally:
        con.close()
    (out / "manifest.json").write_text(json.dumps({
        "seed": seed, "today": today.isoformat(), "cases_per_judge": cases_per_judge,
        "horizon_days": horizon_days, "presets": presets, "ddl": "docs/scheduler-schema.sql",
        "load_order": schema.TABLE_ORDER, "rows": counts,
    }, indent=2))
    return counts
