"""Presets, rulesets and the active rules (spec v3 8.2)."""
from __future__ import annotations

import json
from datetime import date

from vihitha.rules import PRESET_DESCRIPTIONS, PRESET_IDS, preset, rules_from_dict, validate

from ..db import session_scope
from ..errors import Conflict, ValidationFailed
from ..repositories import rulesets as rulesets_repo
from . import context


def _ruleset(row) -> dict:
    return {"id": row.id, "name": row.name, "preset": row.preset, "is_active": bool(row.is_active),
            "rules": json.loads(row.body_json),
            "created_at": row.created_at.isoformat() if row.created_at else None,
            "updated_at": row.updated_at.isoformat() if row.updated_at else None}


def _validated(rules: dict, name: str | None = None) -> tuple[dict, list[dict]]:
    try:
        r = rules_from_dict(rules)
    except (TypeError, ValueError) as e:
        raise ValidationFailed(f"Invalid rules: {e}")
    if name:
        r.name = name
    r, warnings = validate(r)
    return r.to_dict(), warnings


def presets() -> dict:
    out = []
    for pid in PRESET_IDS:
        r, warnings = validate(preset(pid))
        out.append({"id": pid, "name": r.name, "description": PRESET_DESCRIPTIONS[pid],
                    "rules": r.to_dict(), "warnings": warnings})
    return {"presets": out}


def list_() -> dict:
    with session_scope() as s:
        return {"items": [{"id": r.id, "name": r.name, "preset": r.preset, "is_active": bool(r.is_active),
                           "updated_at": r.updated_at.isoformat() if r.updated_at else None}
                          for r in rulesets_repo.all_(s)]}


def create(name: str, rules: dict) -> dict:
    with context.LOCK, session_scope() as s:
        body, warnings = _validated(rules, name)
        row = rulesets_repo.add(s, name=name, preset=body.get("preset") or "custom", body_json=json.dumps(body))
        return {"ruleset": _ruleset(row), "warnings": warnings}


def get(rid: int) -> dict:
    with session_scope() as s:
        return {"ruleset": _ruleset(context.get_ruleset(s, rid))}


def update(rid: int, name: str | None, rules: dict) -> dict:
    from . import schedule_service
    with context.LOCK, session_scope() as s:
        row = context.get_ruleset(s, rid)
        body, warnings = _validated(rules, name or row.name)
        row.name = name or row.name
        row.body_json = json.dumps(body)
        row.preset = body.get("preset") or row.preset
        s.flush()
        if row.is_active and context.roster_loaded(s):
            schedule_service._plan(s)
        context.bump()
        return {"ruleset": _ruleset(row), "warnings": warnings}


def delete(rid: int) -> None:
    with context.LOCK, session_scope() as s:
        row = context.get_ruleset(s, rid)
        if row.is_active:
            raise Conflict("The active ruleset cannot be deleted; activate another one first")
        s.delete(row)


def activate(ruleset_id: int, replan_from: date | None = None) -> dict:
    from . import schedule_service
    with context.LOCK, session_scope() as s:
        row = context.get_ruleset(s, ruleset_id)
        rulesets_repo.set_active(s, row.id)
        s.flush()
        _, warnings = context.rules_of(row)
        plan = schedule_service._plan(s, replan_from) if context.roster_loaded(s) else None
        context.bump()
        return {"active": _ruleset(row), "plan": plan, "warnings": warnings}


def save_and_activate(s, name: str, rules: dict, ruleset_id: int | None, from_date: date | None) -> dict:
    """Used by what-if apply: reuse an existing ruleset or save inline rules, then activate and re-plan."""
    from . import schedule_service
    if ruleset_id is not None:
        row = context.get_ruleset(s, ruleset_id)
    else:
        body, _ = _validated(rules, name)
        row = rulesets_repo.add(s, name=name, preset=body.get("preset") or "custom", body_json=json.dumps(body))
    rulesets_repo.set_active(s, row.id)
    s.flush()
    _, warnings = context.rules_of(row)
    plan = schedule_service._plan(s, from_date)
    return {"active_ruleset": _ruleset(row), "plan": plan, "warnings": warnings}
