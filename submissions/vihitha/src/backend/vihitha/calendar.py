"""Court calendar and judge's leave (section 6.9)."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, timedelta

import pandas as pd

from .enums import WEEKDAYS


@dataclass
class CourtCalendar:
    working: dict[date, bool]
    holiday_names: dict[date, str]
    leave: dict[date, str] = field(default_factory=dict)  # date -> note

    @classmethod
    def from_frame(cls, df: pd.DataFrame, leave: dict[date, str] | None = None) -> "CourtCalendar":
        working: dict[date, bool] = {}
        names: dict[date, str] = {}
        for _, r in df.iterrows():
            d = date.fromisoformat(str(r["date"]))
            working[d] = str(r["is_working_day"]).strip().lower() == "yes"
            if str(r.get("holiday_name", "")).strip():
                names[d] = str(r["holiday_name"]).strip()
        return cls(working=working, holiday_names=names, leave=dict(leave or {}))

    def with_leave(self, leave: dict[date, str]) -> "CourtCalendar":
        return CourtCalendar(self.working, self.holiday_names, {**self.leave, **leave})

    @property
    def last_known(self) -> date:
        return max(self.working)

    def is_court_day(self, d: date) -> bool:
        """Working per the court calendar. Dates past the calendar: Mon-Fri. [ASSUMPTION]"""
        if d in self.working:
            return self.working[d]
        return d.weekday() < 5

    def is_working(self, d: date) -> bool:
        return self.is_court_day(d) and d not in self.leave

    def next_working_day(self, d: date) -> date:
        """First working day on or after d."""
        while not self.is_working(d):
            d += timedelta(days=1)
        return d

    def working_days(self, start: date, end: date) -> list[date]:
        out, d = [], start
        while d <= end:
            if self.is_working(d):
                out.append(d)
            d += timedelta(days=1)
        return out


def weekday_code(d: date) -> str:
    return WEEKDAYS[d.weekday()]


def fmt_day(d: date) -> str:
    """'Tue 29 Sep'"""
    return d.strftime("%a %d %b")
