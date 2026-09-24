"""Normalize Title Case roster stage/purpose strings to UPPER_SNAKE."""

from __future__ import annotations

import re


def to_upper_snake(value: str | None) -> str:
    """Convert Title Case / mixed text to UPPER_SNAKE.

    Examples:
        "Evidence Accused" → "EVIDENCE_ACCUSED"
        "Examination Under S351 Bnss" → "EXAMINATION_UNDER_S351_BNSS"
        "EVIDENCE_ACCUSED" → "EVIDENCE_ACCUSED"
    """
    if not value:
        return ""
    text = value.strip()
    if not text:
        return ""
    # Already UPPER_SNAKE (allow digits glued to letters, e.g. S351)
    if re.fullmatch(r"[A-Z0-9_]+", text):
        return text
    # Spaces / hyphens → underscore
    text = re.sub(r"[\s\-]+", "_", text)
    # camelCase boundaries only (do NOT split letter↔digit: S351 stays S351)
    text = re.sub(r"([a-z])([A-Z])", r"\1_\2", text)
    text = re.sub(r"_+", "_", text)
    return text.upper().strip("_")


def to_title_case(upper_snake: str | None) -> str:
    """Best-effort reverse: UPPER_SNAKE → Title Case for display."""
    if not upper_snake:
        return ""
    parts = upper_snake.strip().split("_")
    out = []
    for p in parts:
        if re.fullmatch(r"S?\d+[A-Z]*", p, re.I):
            out.append(p.upper() if p[0].upper() == "S" else p)
        else:
            out.append(p.capitalize())
    return " ".join(out)
