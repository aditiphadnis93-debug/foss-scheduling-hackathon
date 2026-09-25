"""CLI: python -m datagen generate | load | export (see --help)."""
from __future__ import annotations

import argparse
import sys
from datetime import date
from pathlib import Path

import duckdb

from . import DEFAULT_TODAY, schema


def cmd_generate(a: argparse.Namespace) -> None:
    from . import build

    _clear(a.db, a.force)
    counts = build(a.out, a.cases_per_judge, a.seed, a.today, a.horizon_days, a.presets, a.db)
    _report(counts, f"wrote {len(counts)} parquet files to {a.out}" + (f" and {a.db}" if a.db else ""))


def cmd_load(a: argparse.Namespace) -> None:
    _clear(a.db, a.force)
    con = schema.connect(a.db)
    counts = schema.load_parquet(con, a.parquet)
    con.close()
    _report(counts, f"loaded {a.parquet} into {a.db}")


def cmd_export(a: argparse.Namespace) -> None:
    """The app's working DB (dataset + saved schedules) back to Parquet. Stop the app first: it holds the lock."""
    con = duckdb.connect(a.db, read_only=True)
    counts = schema.export_parquet(con, a.out)
    con.close()
    _report(counts, f"exported {a.db} to {a.out}")


def _clear(db: str | None, force: bool) -> None:
    if db and Path(db).exists():
        if not force:
            sys.exit(f"{db} exists; pass --force to replace it")
        Path(db).unlink()


def _report(counts: dict[str, int], msg: str) -> None:
    w = max(map(len, counts))
    for t, n in counts.items():
        print(f"  {t:<{w}}  {n:>8,}")
    print(msg)


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(prog="python -m datagen", description=__doc__)
    sub = p.add_subparsers(dest="cmd", required=True)

    g = sub.add_parser("generate", help="generate synthetic data and write one parquet per table")
    g.add_argument("--out", type=Path, default=Path("data/synthetic"), help="parquet output directory")
    g.add_argument("--cases-per-judge", type=int, default=1000)
    g.add_argument("--seed", type=int, default=7)
    g.add_argument("--today", type=date.fromisoformat, default=DEFAULT_TODAY,
                   help="history ends the day before; the L1 horizon starts here")
    g.add_argument("--horizon-days", type=int, default=10, help="sitting days of future causelists")
    g.add_argument("--presets", type=lambda s: s.split(","), default=None,
                   help="comma-separated preset names (default: all in presets/)")
    g.add_argument("--db", help="also keep the populated DuckDB file here")
    g.add_argument("--force", action="store_true", help="replace an existing --db file")
    g.set_defaults(func=cmd_generate)

    ld = sub.add_parser("load", help="create the schema in a DuckDB file and load a parquet directory")
    ld.add_argument("--parquet", type=Path, default=Path("data/synthetic"))
    ld.add_argument("--db", required=True)
    ld.add_argument("--force", action="store_true", help="replace an existing --db file")
    ld.set_defaults(func=cmd_load)

    ex = sub.add_parser("export", help="write a DuckDB file (e.g. the app's, with saved schedules) to parquet")
    ex.add_argument("--db", default="data/court.duckdb")
    ex.add_argument("--out", type=Path, default=Path("data/export"))
    ex.set_defaults(func=cmd_export)

    a = p.parse_args(argv)
    a.func(a)


if __name__ == "__main__":
    main()
