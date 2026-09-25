"""iCalendar (RFC 5545) export of court events: stdlib only, times in UTC."""
from __future__ import annotations

from collections.abc import Callable
from datetime import datetime, timedelta, timezone

from .events import CourtEvent

IST = timezone(timedelta(hours=5, minutes=30))


def _utc(t: datetime) -> str:
    return t.replace(tzinfo=IST).astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def _escape(s: str) -> str:
    return s.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")


def _fold(line: str) -> list[str]:
    """Split at 75 octets without breaking a UTF-8 character; continuation lines start with a space."""
    out, cur, limit = [], "", 75
    for ch in line:
        if len((cur + ch).encode()) > limit:
            out.append(cur)
            cur, limit = " " + ch, 75
        else:
            cur += ch
    return out + [cur]


def describe(e: CourtEvent) -> str:
    return "\n".join([
        f"Purpose: {e.purpose.replace('_', ' ')}",
        f"Court: {e.courtroom}, {e.judge} ({e.block})",
        f"Window: {e.window}. The case may be called at any time within it.",
        "Parties: " + " v. ".join(e.party_names[:2]),
        "Advocates: " + ", ".join(e.advocate_names or e.advocates),
        "Why listed: " + " | ".join(e.reasons),
    ])


def to_ics(events: list[CourtEvent], name: str,
           extra: Callable[[CourtEvent], str] | None = None, now: datetime | None = None) -> str:
    stamp = (now or datetime.now(timezone.utc)).astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Scheduling Justice//Causelist//EN",
             "CALSCALE:GREGORIAN", "METHOD:PUBLISH", f"X-WR-CALNAME:{_escape(name)}"]
    for e in events:
        desc = describe(e) + (f"\n\n{extra(e)}" if extra else "")
        lines += ["BEGIN:VEVENT", f"UID:{e.uid}@scheduling-justice", f"DTSTAMP:{stamp}",
                  f"DTSTART:{_utc(e.start)}", f"DTEND:{_utc(e.end)}",
                  f"SUMMARY:{_escape(e.title)}", f"LOCATION:{_escape(e.courtroom)}",
                  f"DESCRIPTION:{_escape(desc)}", "TRANSP:OPAQUE", "END:VEVENT"]
    lines.append("END:VCALENDAR")
    return "\r\n".join(folded for line in lines for folded in _fold(line)) + "\r\n"
