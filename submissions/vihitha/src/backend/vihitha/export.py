"""proposed_schedule.csv / cause-list CSV (spec v3 section 8.9)."""
from __future__ import annotations

import csv
import io
from pathlib import Path

COLUMNS = [
    "Case Number", "Filing Number", "Hearing Type", "Hearing Date",
    "window_start", "window_end", "est_start", "est_end", "advocate_id", "case_age_years", "reason", "status",
]


def to_csv(rows: list[dict]) -> str:
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=COLUMNS, lineterminator="\n", extrasaction="ignore")
    w.writeheader()
    w.writerows(rows)
    return buf.getvalue()


def rows_from_sim(run) -> list[dict]:
    """One row per listing in a simulation (the CLI's proposed schedule)."""
    rows = []
    for day in run.days:
        for r in sorted(day.records, key=lambda r: (r.window_start, r.est_start)):
            rows.append({
                "Case Number": r.case_number, "Filing Number": r.case_id, "Hearing Type": r.purpose.value,
                "Hearing Date": r.date.isoformat(), "window_start": r.window_start, "window_end": r.window_end,
                "est_start": r.est_start, "est_end": r.est_end, "advocate_id": r.advocate_id,
                "case_age_years": f"{r.age_years:.2f}", "reason": r.reason, "status": r.result,
            })
    return rows


def write(rows: list[dict], path: str | Path) -> int:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(to_csv(rows), encoding="utf-8", newline="")
    return len(rows)
