"""Key/value settings (roster source, horizon, window size, today)."""
from __future__ import annotations

import json

from sqlalchemy import delete
from sqlalchemy.orm import Session

from ..models import SettingRow


def get(s: Session, key: str, default=None):
    row = s.get(SettingRow, key)
    return json.loads(row.value_json) if row else default


def put(s: Session, key: str, value) -> None:
    row = s.get(SettingRow, key)
    text = json.dumps(value, default=str)
    if row is None:
        s.add(SettingRow(key=key, value_json=text))
    else:
        row.value_json = text


def delete_all(s: Session) -> None:
    s.execute(delete(SettingRow))
