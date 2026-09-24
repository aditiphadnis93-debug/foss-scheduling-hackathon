"""SQLite via SQLAlchemy 2.0 (state/vihitha.db). Tables are created on start."""
from __future__ import annotations

from contextlib import contextmanager

from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from . import config


class Base(DeclarativeBase):
    pass


config.STATE_DIR.mkdir(parents=True, exist_ok=True)
engine = create_engine(config.DB_URL, connect_args={"check_same_thread": False}, future=True)


@event.listens_for(engine, "connect")
def _pragmas(dbapi_conn, _):
    cur = dbapi_conn.cursor()
    cur.execute("PRAGMA journal_mode=WAL")
    cur.execute("PRAGMA synchronous=NORMAL")
    cur.close()


SessionLocal = sessionmaker(bind=engine, expire_on_commit=False, future=True)


@contextmanager
def session_scope():
    s: Session = SessionLocal()
    try:
        yield s
        s.commit()
    except Exception:
        s.rollback()
        raise
    finally:
        s.close()


def init_db() -> None:
    from . import models  # noqa: F401  (register tables)
    Base.metadata.create_all(engine)
    _add_missing_columns()


def _add_missing_columns() -> None:
    """Tiny forward-only migration: add columns introduced after a database was created."""
    from sqlalchemy import inspect, text
    insp = inspect(engine)
    with engine.begin() as conn:
        for table in Base.metadata.sorted_tables:
            have = {c["name"] for c in insp.get_columns(table.name)}
            for col in table.columns:
                if col.name in have:
                    continue
                ddl = col.type.compile(dialect=engine.dialect)
                default = col.default.arg if col.default is not None and not callable(col.default.arg) else None
                extra = ""
                if isinstance(default, bool):
                    extra = f" DEFAULT {int(default)}"
                elif isinstance(default, (int, float)):
                    extra = f" DEFAULT {default}"
                conn.execute(text(f"ALTER TABLE {table.name} ADD COLUMN {col.name} {ddl}{extra}"))


def drop_all() -> None:
    from . import models  # noqa: F401
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
