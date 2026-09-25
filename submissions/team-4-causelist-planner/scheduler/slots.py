"""Stage 5: appointment windows inside each block, advocate matters kept together."""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta

from .models import Block, Listing

WINDOW_MINUTES = 30


def _fmt(t: datetime) -> str:
    return t.strftime("%H:%M")


def assign_windows(listings: list[Listing], blocks: list[Block]) -> list[Listing]:
    out: list[Listing] = []
    for b in blocks:
        rows = [l for l in listings if l.block == b.name]
        groups: dict[str, list[Listing]] = defaultdict(list)
        for l in rows:
            groups[l.advocate].append(l)
        for g in groups.values():
            g.sort(key=lambda l: l.expected_minutes)
        ordered = [l for g in sorted(groups.values(), key=lambda g: g[0].expected_minutes) for l in g]

        start = datetime.combine(listings[0].day if listings else datetime.today(), b.start)
        end_of_block = datetime.combine(start.date(), b.end)
        # An overbooked block (listing factor > 1) holds more expected minutes than it lasts. Squeeze the
        # expected-time cursor so the overbooking spreads across every window instead of piling into the last.
        total = sum(l.expected_minutes for l in ordered)
        squeeze = min(1.0, b.minutes / total) if total else 1.0
        # The block's final half hour gets its own (shorter) window rather than sharing the last full hour.
        last_window = max(start, end_of_block - timedelta(minutes=WINDOW_MINUTES))
        cursor = 0.0
        for pos, l in enumerate(ordered, 1):
            t = start + timedelta(minutes=cursor * squeeze)
            w0 = t - timedelta(minutes=t.minute % WINDOW_MINUTES, seconds=t.second, microseconds=t.microsecond)
            clamped = w0 > last_window
            w0 = min(w0, last_window)
            w1 = min(w0 + timedelta(minutes=WINDOW_MINUTES * 2), end_of_block)
            l.window = f"{_fmt(w0)}–{_fmt(w1)}"
            l.window_start, l.window_end = w0, w1
            mates = len(groups[l.advocate]) - 1
            l.window_why = (
                f"{pos} of {len(ordered)} in {b.name}: matters are grouped by advocate and shorter ones go first"
                + (f" (kept with this advocate's {mates} other matter{'s' if mates > 1 else ''} here)" if mates else "")
                + f"; {cursor:.0f} expected minutes of hearings come before it"
                + (f", squeezed ×{squeeze:.2f} because the block is overbooked" if squeeze < 1 else "")
                + f", so it is expected from about {t:%H:%M}; "
                + ("it gets the block's final window" if clamped else
                   f"the window opens at the half hour before and runs up to {WINDOW_MINUTES * 2} minutes"))
            cursor += l.expected_minutes
            out.append(l)
    return out
