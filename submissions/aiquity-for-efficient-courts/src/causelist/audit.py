"""Append-only audit log of every planner / simulator decision.

Each entry is a plain dict (JSON-ready)::

    {"day": "YYYY-MM-DD", "case_id": str | None, "action": str, "rule": str, "why": str,
     "before": Any, "after": Any, "actor": str | None}

``actor`` is the stakeholder the decision is attributed to (``attribution.stakeholder_for``) where
one applies, else the deciding body ("court", "planner", "judge").

Actions (``ACTIONS``): listed, held_back, rolled_over, rescheduled, next_date, urgent_heard,
judge_emergency, last_chance, standby_called, withdrawn.
Rules used for next dates: procedural, absence-short, prerequisite, capacity-aware, flat,
carry-next-day, carry-same-weekday, gaming-firm-short, emergency-roll.
"""
from __future__ import annotations

from collections import Counter
from datetime import date
from typing import Any

ACTIONS = ("listed", "held_back", "rolled_over", "rescheduled", "next_date", "urgent_heard",
           "judge_emergency", "last_chance", "standby_called", "withdrawn", "interrupt_filed")


def _j(x: Any) -> Any:
    if isinstance(x, date):
        return x.isoformat()
    if isinstance(x, dict):
        return {k: _j(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [_j(v) for v in x]
    return x


class AuditLog:
    """Append-only: entries are only ever added, never edited or removed."""

    def __init__(self) -> None:
        self._entries: list[dict[str, Any]] = []

    def add(self, day: date, case_id: str | None, action: str, rule: str, why: str,
            before: Any = None, after: Any = None, actor: str | None = None, **extra: Any) -> None:
        if action not in ACTIONS:
            raise ValueError(f"unknown audit action {action}")
        e = {"day": _j(day), "case_id": case_id, "action": action, "rule": rule, "why": why,
             "before": _j(before), "after": _j(after), "actor": actor}
        if extra:
            e.update(_j(extra))
        self._entries.append(e)

    @property
    def entries(self) -> list[dict[str, Any]]:
        return self._entries

    def __len__(self) -> int:
        return len(self._entries)


def counts(entries: list[dict[str, Any]]) -> dict[str, int]:
    c = Counter(e["action"] for e in entries)
    return {a: c.get(a, 0) for a in ACTIONS}


def capped(entries: list[dict[str, Any]], limit: int) -> list[dict[str, Any]]:
    """At most ``limit`` entries, keeping every rare decision (everything except listed / next_date /
    held_back) and filling the rest in time order."""
    if len(entries) <= limit:
        return entries
    common = {"listed", "next_date", "held_back"}
    rare = [i for i, e in enumerate(entries) if e["action"] not in common]
    keep = set(rare[:limit])
    for i, e in enumerate(entries):
        if len(keep) >= limit:
            break
        keep.add(i)
    return [entries[i] for i in sorted(keep)]
