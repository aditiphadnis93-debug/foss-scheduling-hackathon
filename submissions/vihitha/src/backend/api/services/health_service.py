"""Health check."""
from __future__ import annotations

from sqlalchemy import text

from .. import config
from ..db import session_scope
from . import context


def health() -> dict:
    with session_scope() as s:
        s.execute(text("SELECT 1"))
        _, row = context.active_rules(s)
        return {"status": "ok", "db": "ok", "today": context.today(s).isoformat(),
                "roster_loaded": context.roster_loaded(s),
                "active_ruleset": {"id": row.id, "name": row.name} if row else None,
                "court_name": config.COURT_NAME}
