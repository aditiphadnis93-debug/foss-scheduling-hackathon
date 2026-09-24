"""Judge-annotation loop: append ``domain.Annotation`` records to a CSV and read them back.

A judge (or court staff) agrees or disagrees with a prediction -- P(goes ahead), expected
minutes, the recommended next date, or the decision to list at all -- and optionally gives
their own value. These rows are the training data for later behaviour modelling.

``predicted`` and ``judge_value`` can be any JSON-serialisable value; they are stored as JSON
text so numbers, dates and verdicts ("agree" / "disagree") round-trip.
"""
from __future__ import annotations

import csv
import json
from dataclasses import fields
from datetime import date
from pathlib import Path
from typing import Any

from ..domain import Annotation

DEFAULT_PATH = Path(__file__).resolve().parents[3] / "out" / "annotations.csv"
COLUMNS = [f.name for f in fields(Annotation)]


def _enc(v: Any) -> str:
    if isinstance(v, date):
        return json.dumps(v.isoformat())
    return json.dumps(v, default=str)


def _dec(s: str) -> Any:
    try:
        return json.loads(s)
    except (json.JSONDecodeError, TypeError):
        return s


def save_annotation(a: Annotation, path: str | Path | None = None) -> Path:
    """Append one annotation (creates the file with a header if needed). Returns the path."""
    p = Path(path) if path else DEFAULT_PATH
    p.parent.mkdir(parents=True, exist_ok=True)
    new = not p.exists() or p.stat().st_size == 0
    with open(p, "a", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        if new:
            w.writerow(COLUMNS)
        w.writerow([a.case_id, a.day.isoformat(), a.field, _enc(a.predicted), _enc(a.judge_value),
                    a.note, a.annotator])
    return p


def load_annotations(path: str | Path | None = None) -> list[Annotation]:
    p = Path(path) if path else DEFAULT_PATH
    if not p.exists():
        return []
    out: list[Annotation] = []
    with open(p, newline="", encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            out.append(Annotation(
                case_id=r["case_id"], day=date.fromisoformat(r["day"]), field=r["field"],
                predicted=_dec(r["predicted"]), judge_value=_dec(r["judge_value"]),
                note=r.get("note", "") or "", annotator=r.get("annotator", "") or "judge",
            ))
    return out


def agreement_rate(annotations: list[Annotation], field: str | None = None) -> float | None:
    """Share of verdict-style annotations that say "agree" (None if there are none)."""
    rows = [a for a in annotations if (field is None or a.field == field)
            and isinstance(a.judge_value, str) and a.judge_value.lower() in ("agree", "disagree")]
    if not rows:
        return None
    return sum(a.judge_value.lower() == "agree" for a in rows) / len(rows)
