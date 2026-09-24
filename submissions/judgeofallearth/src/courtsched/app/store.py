"""Workspace store: one SQLite file per workspace, append-only events, daily snapshots."""

from __future__ import annotations

import json
import os
import pickle
import threading
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import (Boolean, Column, Float, Integer, LargeBinary, MetaData, String, Table, Text,
                        create_engine, delete, insert, select, update)

def _jsonable(o):
    return o.item() if hasattr(o, "item") else str(o)


def dumps(v) -> str:
    return json.dumps(v, default=_jsonable)


md = MetaData()
meta_t = Table("meta", md, Column("key", String, primary_key=True), Column("value", Text))
snapshot_t = Table("snapshot", md, Column("day_idx", Integer, primary_key=True), Column("day", String),
                   Column("blob", LargeBinary))
listing_t = Table(
    "listing", md,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("day_idx", Integer, index=True), Column("day", String), Column("ord", Integer),
    Column("case_idx", Integer, index=True), Column("case_id", String), Column("advocate", String),
    Column("purpose", String), Column("age_years", Float), Column("old", Boolean), Column("why", String),
    Column("slot_start", Float), Column("exp_minutes", Float), Column("status", String),
    Column("reached", Boolean), Column("substantive", Boolean), Column("advanced_to", String),
    Column("reason", String), Column("minutes", Float), Column("start_min", Float), Column("next_gap", Integer),
)
stats_t = Table("daily_stats", md, Column("day_idx", Integer, primary_key=True), Column("day", String),
                Column("buckets", Text), Column("metrics", Text))
change_t = Table("change", md, Column("id", Integer, primary_key=True, autoincrement=True),
                 Column("ts", String), Column("role", String), Column("day_idx", Integer), Column("day", String),
                 Column("label", String), Column("reason", Text), Column("option", Text), Column("expected", Text),
                 Column("before", LargeBinary))
event_t = Table("event", md, Column("id", Integer, primary_key=True, autoincrement=True),
                Column("ts", String), Column("role", String), Column("kind", String), Column("payload", Text))


def workspaces_dir() -> Path:
    d = Path(os.environ.get("COURT_WORKSPACES", Path.cwd() / "workspaces"))
    d.mkdir(parents=True, exist_ok=True)
    return d


_engines: dict[str, object] = {}
_engines_lock = threading.Lock()


def _engine(path: Path):
    """One engine per court file, created (and its tables set up) once, even under concurrent requests."""
    key = str(path)
    with _engines_lock:
        if key not in _engines:
            eng = create_engine(f"sqlite:///{path}", connect_args={"timeout": 30})
            md.create_all(eng)
            _engines[key] = eng
        return _engines[key]


class WorkspaceStore:
    def __init__(self, ws_id: str):
        self.id = ws_id
        self.path = workspaces_dir() / f"{ws_id}.db"
        self.engine = _engine(self.path)

    @staticmethod
    def list_ids() -> list[str]:
        return sorted(p.stem for p in workspaces_dir().glob("*.db"))

    def exists(self) -> bool:
        with self.engine.connect() as c:
            return c.execute(select(meta_t).where(meta_t.c.key == "name")).first() is not None

    # --- meta ---------------------------------------------------------------------------------
    def get_meta(self) -> dict:
        with self.engine.connect() as c:
            return {r.key: json.loads(r.value) for r in c.execute(select(meta_t))}

    def set_meta(self, **kv) -> None:
        with self.engine.begin() as c:
            for k, v in kv.items():
                c.execute(delete(meta_t).where(meta_t.c.key == k))
                c.execute(insert(meta_t).values(key=k, value=dumps(v)))

    # --- snapshots ----------------------------------------------------------------------------
    def save_snapshot(self, day_idx: int, day: str | None, sim) -> None:
        with self.engine.begin() as c:
            c.execute(delete(snapshot_t).where(snapshot_t.c.day_idx == day_idx))
            c.execute(insert(snapshot_t).values(day_idx=day_idx, day=day, blob=pickle.dumps(sim)))

    def load_latest(self):
        with self.engine.connect() as c:
            row = c.execute(select(snapshot_t).order_by(snapshot_t.c.day_idx.desc()).limit(1)).first()
        return pickle.loads(row.blob) if row else None

    # --- listings -----------------------------------------------------------------------------
    def replace_listings(self, day_idx: int, rows: list[dict]) -> None:
        with self.engine.begin() as c:
            c.execute(delete(listing_t).where(listing_t.c.day_idx == day_idx))
            if rows:
                c.execute(insert(listing_t), rows)

    def set_listing_status(self, day_idx: int, status: str) -> None:
        with self.engine.begin() as c:
            c.execute(update(listing_t).where(listing_t.c.day_idx == day_idx).values(status=status))

    def listings(self, day_idx: int | None = None, case_idx: int | None = None) -> list[dict]:
        q = select(listing_t)
        if day_idx is not None:
            q = q.where(listing_t.c.day_idx == day_idx)
        if case_idx is not None:
            q = q.where(listing_t.c.case_idx == case_idx)
        with self.engine.connect() as c:
            return [dict(r._mapping) for r in c.execute(q.order_by(listing_t.c.day_idx, listing_t.c.ord))]

    # --- stats and events ---------------------------------------------------------------------
    def save_stats(self, day_idx: int, day: str | None, buckets: dict, metrics: dict) -> None:
        with self.engine.begin() as c:
            c.execute(delete(stats_t).where(stats_t.c.day_idx == day_idx))
            c.execute(insert(stats_t).values(day_idx=day_idx, day=day, buckets=dumps(buckets),
                                             metrics=dumps(metrics)))

    def stats(self) -> list[dict]:
        with self.engine.connect() as c:
            return [{"day_idx": r.day_idx, "day": r.day, "buckets": json.loads(r.buckets),
                     "metrics": json.loads(r.metrics)}
                    for r in c.execute(select(stats_t).order_by(stats_t.c.day_idx))]

    def log(self, role: str, kind: str, payload: dict) -> None:
        with self.engine.begin() as c:
            c.execute(insert(event_t).values(ts=datetime.now(timezone.utc).isoformat(), role=role, kind=kind,
                                             payload=dumps(payload)))

    def events(self, limit: int = 50) -> list[dict]:
        with self.engine.connect() as c:
            rows = c.execute(select(event_t).order_by(event_t.c.id.desc()).limit(limit))
            return [{"ts": r.ts, "role": r.role, "kind": r.kind, "payload": json.loads(r.payload)} for r in rows]


    # --- change journal -----------------------------------------------------------------------
    def add_change(self, role: str, day_idx: int, day: str, label: str, reason: str, option: dict, expected: dict,
                   before: bytes) -> None:
        with self.engine.begin() as c:
            c.execute(insert(change_t).values(ts=datetime.now(timezone.utc).isoformat(), role=role, day_idx=day_idx,
                                              day=day, label=label, reason=reason, option=dumps(option),
                                              expected=dumps(expected), before=before))

    def changes(self) -> list[dict]:
        with self.engine.connect() as c:
            rows = c.execute(select(change_t).order_by(change_t.c.id.desc()))
            return [{"id": r.id, "ts": r.ts, "role": r.role, "day_idx": r.day_idx, "day": r.day, "label": r.label,
                     "reason": r.reason, "option": json.loads(r.option), "expected": json.loads(r.expected),
                     "before": r.before} for r in rows]
