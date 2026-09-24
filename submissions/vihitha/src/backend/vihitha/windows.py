"""Slot windows and packing hearings into them (spec v3 section 3).

A court day (10:00-17:30, lunch 13:30-14:00). Every hearing gets its own slot in calling
order on one continuous clock of expected minutes (v3.1), so there are no gaps and no
overlaps. Expected minutes are the safe "overbooking": a hearing likely to be adjourned
takes a few minutes, one likely to go ahead takes its full time. Blocks from the rules set
the calling order, not reserved time. Published hearings keep their promised start.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from .enums import GROUPS, group_of
from .models import PackedDay, Placement, WindowPlan
from .rules import Block, DayTimes, Rules

DEFAULT_WINDOW_MINUTES = 30  # [ASSUMPTION]


# ------------------------------------------------------------ clock helpers

def hhmm_to_min(s: str) -> int:
    h, m = s.split(":")
    return int(h) * 60 + int(m)


def min_to_hhmm(m: float) -> str:
    m = int(round(m))
    return f"{m // 60:02d}:{m % 60:02d}"


def to_elapsed(hhmm: str, day: DayTimes) -> int:
    """Wall-clock HH:MM -> judicial minutes since day start (lunch excluded)."""
    t = hhmm_to_min(hhmm)
    start, ls, le = hhmm_to_min(day.start), hhmm_to_min(day.lunch_start), hhmm_to_min(day.lunch_end)
    if t <= ls:
        return max(0, t - start)
    if t <= le:
        return ls - start
    return t - start - (le - ls)


def to_wall(elapsed: float, day: DayTimes) -> str:
    """Judicial minutes since day start -> wall-clock HH:MM (lunch skipped)."""
    start, ls, le = hhmm_to_min(day.start), hhmm_to_min(day.lunch_start), hhmm_to_min(day.lunch_end)
    t = start + elapsed
    if t >= ls:
        t += le - ls
    return min_to_hhmm(t)


def add_minutes(hhmm: str, minutes: float, day: DayTimes) -> str:
    """HH:MM + judicial minutes, skipping lunch."""
    return to_wall(to_elapsed(hhmm, day) + minutes, day)


# ------------------------------------------------------------ windows

@dataclass
class _Win:
    start: int  # wall minutes
    end: int
    block_id: str
    capacity: float
    used: float = 0.0
    keys: list | None = None

    def __post_init__(self):
        self.keys = []

    @property
    def length(self) -> int:
        return self.end - self.start

    def has_room(self) -> bool:
        return self.used < self.capacity - 1e-9



def block_windows(block: Block, day: DayTimes, window_minutes: int, slots: bool, fill: float) -> list[_Win]:
    """Cut one block into windows; never cross lunch."""
    s, e = hhmm_to_min(block.start), hhmm_to_min(block.end)
    ls, le = hhmm_to_min(day.lunch_start), hhmm_to_min(day.lunch_end)
    out: list[_Win] = []
    t = s
    while t < e:
        if ls <= t < le:
            t = le
            continue
        if slots:
            end = min(t + window_minutes, e)
        else:
            end = e
        if t < ls < end:
            end = ls
        if end <= t:
            break
        out.append(_Win(t, end, block.id, max(1.0, (end - t) * fill)))
        t = end
    return out


def day_blocks(rules: Rules) -> list[Block]:
    return rules.blocks or [Block("all", "Full day", rules.day.start, rules.day.end)]


def matches(block: Block, purpose: str, age: float, carried_forward: bool) -> bool:
    """A restricted block takes a hearing when any of its conditions holds (types, age, carried forward)."""
    if not block.restricted:
        return False
    if block.carried_forward_only:
        return carried_forward
    if block.hearing_types and purpose in block.hearing_types:
        return True
    if block.min_age_years is not None and age >= block.min_age_years:
        return True
    return False


@dataclass
class PackItem:
    key: str
    purpose: str
    age_years: float
    advocate_id: str
    carried_forward: bool
    score: float
    expected_minutes: float
    duration_min: float
    p_substantive: float
    locked_window: str | None = None  # keep in the window starting here (published / judge-placed)
    order_hint: int = 0  # position among locked hearings in their window


def _order_within(items: list[PackItem], rules: Rules) -> list[PackItem]:
    if rules.is_baseline:
        return sorted(items, key=lambda x: (x.order_hint, x.key))
    by_score = sorted(items, key=lambda x: (-x.score, x.key))
    if rules.clustering.by_advocate:
        groups: dict[str, list[PackItem]] = {}
        for x in by_score:
            groups.setdefault(x.advocate_id, []).append(x)
        by_score = [x for g in sorted(groups.values(), key=lambda g: (-g[0].score, g[0].key)) for x in g]
    if rules.carry_forward_same_weekday:
        by_score = [x for x in by_score if x.carried_forward] + [x for x in by_score if not x.carried_forward]
    return by_score


def _order(items: list[PackItem], rules: Rules, block: Block | None = None) -> list[PackItem]:
    """Calling order inside a block. Unrestricted blocks call short matters first, then trial,
    then final hearings (quick calls let parties leave early); priority order inside each group."""
    if rules.is_baseline or not rules.order_by_group or (block is not None and block.restricted):
        return _order_within(items, rules)
    out: list[PackItem] = []
    for g in GROUPS:
        out += _order_within([x for x in items if group_of(x.purpose) == g], rules)
    return out


def pack_day(d: date, items: list[PackItem], rules: Rules, window_minutes: int | None = None) -> PackedDay:
    """Give every hearing its own slot in calling order: one continuous clock, no gaps, no overlaps.

    - Blocks (when the rules define them) set the calling order, not reserved time: a block with
      few matters hands its time to the next one.
    - The clock advances by expected minutes / fill target, so the day's plan ends at closing time.
    - A hearing's slot runs from its start to the next hearing's start (its share of the day).
    - Locked hearings (published, or placed by the judge) keep their promised start time.
    """
    day = rules.day
    fill = rules.fill_target if rules.fill_target is not None else 1.0
    blocks = day_blocks(rules)
    ls, le = hhmm_to_min(day.lunch_start), hhmm_to_min(day.lunch_end)

    free = [x for x in items if not x.locked_window]
    unrestricted = [b for b in blocks if not b.restricted]
    by_block: dict[str, list[PackItem]] = {b.id: [] for b in blocks}
    for x in free:
        target = next((b for b in blocks if matches(b, x.purpose, x.age_years, x.carried_forward)), None)
        if target is None:
            target = unrestricted[-1] if unrestricted else blocks[-1]
        by_block[target.id].append(x)
    queue = [(x, b.id) for b in blocks for x in _order(by_block[b.id], rules, b)]
    locked = sorted((x for x in items if x.locked_window),
                    key=lambda x: (hhmm_to_min(x.locked_window), x.order_hint, x.key))

    def skip_lunch(t: float) -> float:
        return float(le) if ls <= t < le else t

    def block_at(t: float) -> str:
        return next((b.id for b in blocks if hhmm_to_min(b.start) <= t < hhmm_to_min(b.end)), blocks[-1].id)

    step = 1.0 / fill if fill > 0 else 1.0
    clock = float(hhmm_to_min(day.start))
    timeline: list[tuple[PackItem, str, int, int]] = []  # item, block, promised start, est start
    qi = 0
    while qi < len(queue) or locked:
        clock = skip_lunch(clock)
        if locked and (qi >= len(queue) or hhmm_to_min(locked[0].locked_window) <= clock):
            x = locked.pop(0)
            promised = hhmm_to_min(x.locked_window)
            start = skip_lunch(max(clock, float(promised)))
            timeline.append((x, block_at(promised), promised, int(round(start))))
        else:
            x, bid = queue[qi]
            qi += 1
            start = clock
            timeline.append((x, bid, int(round(start)), int(round(start))))
        clock = start + x.expected_minutes * step

    placements: dict[str, Placement] = {}
    windows: list[WindowPlan] = []
    for i, (x, bid, promised, t) in enumerate(timeline):
        nxt = timeline[i + 1][3] if i + 1 < len(timeline) else int(round(t + x.expected_minutes * step))
        if ls <= nxt <= le and t < ls:  # slot ends at lunch, not after it
            nxt = ls
        end = max(nxt, t + 1)
        slot_start = min(promised, t)
        placements[x.key] = Placement(
            key=x.key, block_id=bid,
            window_start=min_to_hhmm(slot_start), window_end=min_to_hhmm(end),
            est_start=min_to_hhmm(t), est_end=min_to_hhmm(t + x.duration_min),
            seq=i + 1, expected_minutes=round(x.expected_minutes, 2), duration_min=x.duration_min,
            p_substantive=round(x.p_substantive, 4),
        )
        windows.append(WindowPlan(start=min_to_hhmm(slot_start), end=min_to_hhmm(end), block_id=bid,
                                  keys=[x.key], expected_minutes=round(x.expected_minutes, 1),
                                  capacity_minutes=float(end - slot_start)))
    return PackedDay(date=d, placements=placements, windows=windows)


def block_bounds(rules: Rules) -> list[dict]:
    return [{"id": b.id, "label": b.label, "start": b.start, "end": b.end, "color_key": b.color_key}
            for b in day_blocks(rules)]
