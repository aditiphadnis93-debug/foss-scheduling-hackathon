"""Stage 5: appointment windows. Overbooking spreads across the block instead of piling into the last window."""
from collections import Counter
from datetime import date, datetime, time

from scheduler.models import Block, Listing
from scheduler.slots import WINDOW_MINUTES, assign_windows

DAY = date(2026, 10, 5)
BLOCK = Block("Morning", time(11, 0), time(13, 30), ("mention",))


def _listings(n: int, minutes: float) -> list[Listing]:
    return [Listing(f"C{i:03d}", DAY, BLOCK.name, "mention", f"ADV{i:03d}", 1.0, 0.0, minutes, [])
            for i in range(n)]


def test_windows_are_one_hour_and_inside_the_block():
    for l in assign_windows(_listings(40, 5.0), [BLOCK]):
        assert datetime.combine(DAY, BLOCK.start) <= l.window_start < l.window_end <= datetime.combine(DAY, BLOCK.end)
        assert (l.window_end - l.window_start).total_seconds() <= 2 * WINDOW_MINUTES * 60


def test_overbooked_block_spreads_across_every_window():
    # 2x the block's minutes in expected time: without the squeeze, half the cases share the last window.
    out = assign_windows(_listings(60, BLOCK.minutes * 2 / 60), [BLOCK])
    per_window = Counter(l.window_start for l in out)
    starts = BLOCK.minutes // WINDOW_MINUTES  # 11:00 ... 13:00; the last is the half-hour window 13:00–13:30
    assert len(per_window) == starts
    assert max(per_window.values()) <= 1.5 * len(out) / starts


def test_underbooked_block_keeps_real_expected_times():
    out = assign_windows(_listings(6, 10.0), [BLOCK])  # 60 of 150 minutes: no squeeze
    assert [l.window_start.time() for l in out] == [time(11, 0)] * 3 + [time(11, 30)] * 3
