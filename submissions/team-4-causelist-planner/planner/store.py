"""The desk's own DuckDB file (data/causelist.duckdb, or $CAUSELIST_DB): the hearing day, the judge's
decisions and the published causelists, per roster. Nothing here touches the synthetic court.duckdb.

The forecast is never stored: it is re-derived from the roster plus this state (DeskState), so a
decision is the only thing that has to survive a restart.
"""
from __future__ import annotations

import os
from datetime import date, datetime
from pathlib import Path

import duckdb

from .desk import earliest_date
from .forecast import DeskState, Fixed, forecast
from .reference import DISPOSED, PLAN_MINUTES, hearing_types, sitting_days
from .roster import PCase

SCHEMA = """
CREATE TABLE IF NOT EXISTS desk (roster TEXT PRIMARY KEY, start_day DATE NOT NULL, current_day DATE NOT NULL);
CREATE TABLE IF NOT EXISTS decision (
    roster TEXT NOT NULL, case_number TEXT NOT NULL, hearing_day DATE NOT NULL,
    outcome TEXT NOT NULL, next_purpose TEXT NOT NULL, next_date DATE, note TEXT,
    decided_at TIMESTAMP NOT NULL, PRIMARY KEY (roster, case_number, hearing_day));
CREATE TABLE IF NOT EXISTS published (
    roster TEXT NOT NULL, day DATE NOT NULL, seq INTEGER NOT NULL, case_number TEXT NOT NULL,
    purpose TEXT NOT NULL, expected_minutes DOUBLE, score DOUBLE, why TEXT, published_at TIMESTAMP,
    PRIMARY KEY (roster, day, case_number));
-- The judge's estimate of the hearing time, when it differs from the table's (added later).
ALTER TABLE decision ADD COLUMN IF NOT EXISTS minutes INTEGER;
ALTER TABLE published ADD COLUMN IF NOT EXISTS minutes INTEGER;
"""
AUTO_NOTE = "not taken up; booked at the nearest date with room when the day closed"


def _own(purpose: str, minutes: int | None) -> int | None:
    """Keep the judge's estimate only when it differs from the table's time for the purpose."""
    ht = hearing_types().get(purpose)
    return None if minutes is None or ht is None or minutes == ht.minutes else int(minutes)


def default_path() -> Path:
    return Path(os.environ.get("CAUSELIST_DB", Path(__file__).resolve().parent.parent / "data" / "causelist.duckdb"))


class DeskStore:
    def __init__(self, path: Path | str | None = None):
        self.path = Path(path) if path else default_path()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self._con() as con:
            con.execute(SCHEMA)

    def _con(self) -> duckdb.DuckDBPyConnection:
        return duckdb.connect(str(self.path))  # short-lived: opened per call, closed by `with`

    def _rows(self, sql: str, params: list) -> list[dict]:
        with self._con() as con:
            cur = con.execute(sql, params)
            cols = [d[0] for d in cur.description]
            return [dict(zip(cols, r)) for r in cur.fetchall()]

    # ------------------------------------------------------------ reads
    def desk(self, roster: str) -> dict | None:
        rows = self._rows("SELECT * FROM desk WHERE roster = ?", [roster])
        return rows[0] if rows else None

    def decisions(self, roster: str, hearing_day: date | None = None) -> list[dict]:
        sql = "SELECT * FROM decision WHERE roster = ?" + (" AND hearing_day = ?" if hearing_day else "")
        return self._rows(sql + " ORDER BY hearing_day, decided_at", [roster] + ([hearing_day] if hearing_day else []))

    def published(self, roster: str, day: date | None = None) -> list[dict]:
        sql = "SELECT * FROM published WHERE roster = ?" + (" AND day = ?" if day else "")
        return self._rows(sql + " ORDER BY day, seq", [roster] + ([day] if day else []))

    def state(self, roster: str) -> DeskState:
        """Replay the decisions: the latest one per case sets its purpose and its judge-fixed date."""
        d = self.desk(roster)
        if d is None:
            raise LookupError(f"no desk for roster {roster}")
        today = d["current_day"]
        purposes: dict[str, str] = {}
        disposed: set[str] = set()
        judge: dict[str, tuple[date, str, int | None]] = {}
        for r in self.decisions(roster):
            cid = r["case_number"]
            judge.pop(cid, None)
            if r["next_purpose"] == DISPOSED:
                disposed.add(cid)
                continue
            disposed.discard(cid)
            purposes[cid] = r["next_purpose"]
            if r["next_date"]:
                judge[cid] = (r["next_date"], r["next_purpose"], r["minutes"])
        pub = {(r["case_number"], r["day"]): Fixed(r["case_number"], r["day"], r["purpose"], "published",
                                                   _own(r["purpose"], r["minutes"]))
               for r in self.published(roster) if r["day"] >= today}
        fixed = list(pub.values()) + [Fixed(c, day, p, "judge", _own(p, m)) for c, (day, p, m) in judge.items()
                                      if day >= today and (c, day) not in pub]
        return DeskState(today, tuple(sorted(purposes.items())), frozenset(disposed),
                         tuple(sorted(fixed, key=lambda f: (f.day, f.case))))

    # ------------------------------------------------------------ writes
    def decide(self, roster: str, case: str, hearing_day: date, outcome: str, next_purpose: str,
               next_date: date | None, note: str = "", minutes: int | None = None) -> None:
        with self._con() as con:
            con.execute("INSERT OR REPLACE INTO decision (roster, case_number, hearing_day, outcome, next_purpose, "
                        "next_date, note, decided_at, minutes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                        [roster, case, hearing_day, outcome, next_purpose, next_date, note, datetime.now(),
                         _own(next_purpose, minutes)])

    def undo(self, roster: str, case: str, hearing_day: date) -> None:
        with self._con() as con:
            con.execute("DELETE FROM decision WHERE roster = ? AND case_number = ? AND hearing_day = ?",
                        [roster, case, hearing_day])

    def publish(self, roster: str, cases: tuple[PCase, ...], day: date) -> int:
        """The 7 PM step: freeze the draft's list for `day`."""
        draft = forecast(cases, self.state(roster))
        rows = [[roster, day, i, b.case, b.purpose, b.expected, b.score, " | ".join(b.why), datetime.now(),
                 _own(b.purpose, b.minutes)] for i, b in enumerate(draft.on(day), 1)]
        with self._con() as con:
            con.execute("DELETE FROM published WHERE roster = ? AND day = ?", [roster, day])
            if rows:
                con.executemany("INSERT INTO published (roster, day, seq, case_number, purpose, expected_minutes, "
                                "score, why, published_at, minutes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", rows)
        return len(rows)

    def reset(self, roster: str, cases: tuple[PCase, ...], start: date) -> None:
        """Start over: forget decisions and published lists, and publish the start day's list."""
        with self._con() as con:
            for t in ("decision", "published", "desk"):
                con.execute(f"DELETE FROM {t} WHERE roster = ?", [roster])
            con.execute("INSERT INTO desk VALUES (?, ?, ?)", [roster, start, start])
        self.publish(roster, cases, start)

    def ensure(self, roster: str, cases: tuple[PCase, ...], start: date) -> None:
        if self.desk(roster) is None:
            self.reset(roster, cases, start)

    def undecided(self, roster: str, day: date) -> list[dict]:
        done = {r["case_number"] for r in self.decisions(roster, day)}
        return [r for r in self.published(roster, day) if r["case_number"] not in done]

    def close_day(self, roster: str, cases: tuple[PCase, ...]) -> date:
        """End the hearing day: book every case not taken up at its nearest date with room, publish
        the next sitting day's list, and make that day the hearing day."""
        state = self.state(roster)
        day = state.start
        nxt = next((d for d in sitting_days() if d > day), None)
        if nxt is None:
            raise ValueError("the court calendar ends here")
        draft = forecast(cases, state)
        loads = {d: draft.load(d) for d in draft.days}
        purpose_of = {c.number: c.purpose for c in cases} | state.purpose_of
        for r in self.undecided(roster, day):
            cid, p = r["case_number"], purpose_of[r["case_number"]]
            for b in draft.of(cid):
                if b.kind == "tentative" and b.day in loads:
                    loads[b.day] -= b.expected
            cost = hearing_types()[p].expected_minutes
            e = earliest_date(day, p)
            to = next((d for d in draft.days if e and d >= e and PLAN_MINUTES - loads[d] >= cost), e)
            if to in loads:
                loads[to] += cost
            self.decide(roster, cid, day, "Not reached", p, to, AUTO_NOTE)
        with self._con() as con:
            con.execute("UPDATE desk SET current_day = ? WHERE roster = ?", [nxt, roster])
        self.publish(roster, cases, nxt)
        return nxt
