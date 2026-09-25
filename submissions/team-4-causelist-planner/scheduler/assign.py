"""Stage 4: greedy assignment of cases to one day's blocks.

Order of placement (docs/L1-scheduling-algorithm.md §4, stage 4):
  booked cases → starvation guard → locked ageing quota → per-block fill (+ clustering)
The objective (maximise total score within expected-minute budgets) is the one
CP-SAT will optimise at L2; `plan_day` is the swap point.
"""
from __future__ import annotations

from collections import defaultdict
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import date

from . import config as locked
from .capacity import block_budget, expected_cost
from .eligibility import check
from .models import Block, Case, JudgeConfig, Listing
from .scoring import score
from .slots import assign_windows

MAX_CLUSTER_PULL = 4  # extra matters pulled in per advocate per day

# Swap point for stage 2: scores the whole eligible pool at once (so an agent can batch its calls).
# Returns {case_id: (score, reasons)}. The locked placements below never read the score.
Scorer = Callable[[list[Case], date, JudgeConfig], dict[str, tuple[float, list[str]]]]


def rule_scorer(pool: list[Case], day: date, cfg: JudgeConfig) -> dict[str, tuple[float, list[str]]]:
    return {c.id: score(c, day, cfg) for c in pool}


@dataclass
class DayPlan:
    day: date
    listings: list[Listing] = field(default_factory=list)
    excluded: dict[str, int] = field(default_factory=dict)
    near_miss: list[str] = field(default_factory=list)  # eligible, next in line, not listed
    # Lineage: what each stage decided about each case today (views/lineage.py reads these).
    rank: dict[str, int] = field(default_factory=dict)  # eligible pool, 1 = highest score
    pool_size: int = 0
    how: dict[str, str] = field(default_factory=dict)  # listed case -> how it got its place
    skipped: dict[str, str] = field(default_factory=dict)  # eligible, not listed -> why not

    def by_block(self) -> dict[str, list[Listing]]:
        out: dict[str, list[Listing]] = defaultdict(list)
        for l in self.listings:
            out[l.block].append(l)
        return out


def plan_day(cases: list[Case], day: date, cfg: JudgeConfig, scorer: Scorer | None = None) -> DayPlan:
    plan = DayPlan(day)
    blocks = cfg.blocks_on(day)
    if not blocks:
        return plan
    budget = {b.name: block_budget(b, cfg) for b in blocks}
    used = {b.name: 0.0 for b in blocks}
    total_budget = sum(budget.values())
    placed: dict[str, Listing] = {}
    adv_block: dict[str, str] = {}
    adv_pulled: dict[str, int] = defaultdict(int)
    excluded: dict[str, int] = defaultdict(int)

    def fits(c: Case, b: Block) -> bool:
        return c.purpose in b.purposes and used[b.name] + expected_cost(c) <= budget[b.name]

    def first_fit(c: Case) -> Block | None:
        # Prefer the block where this advocate already appears today.
        for b in blocks:
            if cfg.clustering and adv_block.get(c.advocate_ids[0]) == b.name and fits(c, b):
                return b
        return next((b for b in blocks if fits(c, b)), None)

    def room_note(b: Block, c: Case) -> str:
        return (f"{b.name} had {used[b.name]:.0f} of {budget[b.name]:.0f} expected minutes booked; "
                f"this case costs {expected_cost(c):.1f}")

    def block_why(c: Case, b: Block) -> str:
        if cfg.clustering and adv_block.get(c.advocate_ids[0]) == b.name:
            return f"{b.name}: the block where its advocate already appears today"
        return f"{b.name}: the first block today that hears {c.purpose.replace('_', ' ')} and had room"

    def place(c: Case, b: Block, s: float, reasons: list[str], how: str = "") -> None:
        cost = expected_cost(c)
        plan.how[c.id] = how + (" · " if how else "") + room_note(b, c)
        used[b.name] += cost
        placed[c.id] = Listing(c.id, day, b.name, c.purpose, c.advocate_ids[0],
                               round(c.age_years(day), 1), round(s, 1), round(cost, 1), reasons)
        for a in c.advocate_ids:
            adv_block.setdefault(a, b.name)

    def room() -> bool:
        return len(placed) < cfg.max_cases_per_day

    # 1. Cases booked for today at their last hearing (stage 6).
    pool = []
    for c in cases:
        if c.disposed:
            continue
        ok, why = check(c, day, cfg)
        if c.next_date == day:
            if not ok:
                excluded[why] += 1
                continue
            b = next((b for b in blocks if b.name == c.next_block and c.purpose in b.purposes), None)
            b = b or next((b for b in blocks if c.purpose in b.purposes), None)
            if b:
                s, r = score(c, day, cfg)
                how = ("booked for today at its last hearing, into its booked block " + b.name
                       if b.name == c.next_block else f"booked for today at its last hearing; placed in {b.name}")
                place(c, b, s, ["booked at last hearing"] + r, how)
            continue
        if ok:
            pool.append(c)
        else:
            excluded[why] += 1

    scores = (scorer or rule_scorer)(pool, day, cfg)
    scored = {c.id: (c, *scores[c.id]) for c in pool}
    by_score = sorted(scored.values(), key=lambda x: (-x[1], x[0].filing_date))
    plan.rank = {x[0].id: i for i, x in enumerate(by_score, 1)}
    plan.pool_size = len(by_score)

    # 2. Starvation guard (locked): near-missed K times in a row → forced in, capped share.
    forced_used = 0.0
    for c, s, r in sorted(by_score, key=lambda x: -x[0].consecutive_skips):
        if c.consecutive_skips < locked.STARVATION_K or not room():
            break
        b = first_fit(c)
        if b and forced_used + expected_cost(c) <= locked.FORCED_SHARE * total_budget:
            how = (f"locked starvation guard: passed over {c.consecutive_skips} days running (limit "
                   f"{locked.STARVATION_K}), so forced in ahead of the ranking; {block_why(c, b)}")
            forced_used += expected_cost(c)
            place(c, b, s, [f"starvation guard: passed over {c.consecutive_skips} times"] + r, how)
        elif c.consecutive_skips >= locked.STARVATION_K:
            plan.skipped[c.id] = (f"starvation guard wanted it in, but the forced share of the day "
                                  f"({locked.FORCED_SHARE:.0%}) was used up or no block had room")

    # 3. Locked ageing quota: reserve a share of the day for 4y+ cases, oldest first.
    quota = locked.AGE_QUOTA * total_budget
    old_used = sum(l.expected_minutes for l in placed.values() if l.age_years >= locked.AGE_QUOTA_MIN_YEARS)
    old = [x for x in by_score if x[0].age_years(day) >= locked.AGE_QUOTA_MIN_YEARS]
    for c, s, r in sorted(old, key=lambda x: x[0].filing_date):
        if old_used >= quota or not room():
            break
        if c.id in placed:
            continue
        b = first_fit(c)
        if b:
            how = (f"locked ageing quota: {locked.AGE_QUOTA:.0%} of the day ({quota:.0f} expected min) is reserved "
                   f"for cases {locked.AGE_QUOTA_MIN_YEARS:.0f}y+, filled oldest first; {old_used:.0f} min were "
                   f"taken before it; {block_why(c, b)}")
            old_used += expected_cost(c)
            place(c, b, s, ["locked ageing quota"] + r, how)

    # 4. Fill each block in its own order; clustering pulls an advocate's other matters in.
    by_adv: dict[str, list] = defaultdict(list)
    for x in by_score:
        by_adv[x[0].advocate_ids[0]].append(x)

    order_name = {"age": "oldest first", "newest": "newest first", "score": "highest score first"}
    for b in blocks:
        cands = [x for x in by_score if x[0].purpose in b.purposes]
        if b.sort_by == "age":
            cands.sort(key=lambda x: x[0].filing_date)
        elif b.sort_by == "newest":
            cands.sort(key=lambda x: x[0].filing_date, reverse=True)
        for pos, (c, s, r) in enumerate(cands, 1):
            if not room():
                for c_left, _, _ in cands[pos - 1:]:
                    if c_left.id not in placed:
                        plan.skipped.setdefault(c_left.id, f"the daily cap of {cfg.max_cases_per_day} cases "
                                                           f"was reached before its turn in {b.name}")
                break
            if c.id in placed:
                continue
            if not fits(c, b):
                plan.skipped[c.id] = (f"no room when its turn came in {b.name} (candidate {pos} of {len(cands)}, "
                                      f"{order_name[b.sort_by]}): " + room_note(b, c))
                continue
            place(c, b, s, r, f"block fill: {b.name} hears {', '.join(p.replace('_', ' ') for p in b.purposes)} "
                              f"and takes candidates {order_name[b.sort_by]}; this case was candidate {pos} of "
                              f"{len(cands)} and fitted")
            plan.skipped.pop(c.id, None)
            if not cfg.clustering:
                continue
            adv = c.advocate_ids[0]
            for c2, s2, r2 in by_adv[adv]:
                if adv_pulled[adv] >= MAX_CLUSTER_PULL or not room():
                    break
                if c2.id in placed:
                    continue
                b2 = first_fit(c2)
                if b2:
                    adv_pulled[adv] += 1
                    place(c2, b2, s2, [f"clustered with {adv}'s other matters"] + r2,
                          f"clustering: pulled in beside its advocate's matter {c.id} "
                          f"(pull {adv_pulled[adv]} of at most {MAX_CLUSTER_PULL}); {block_why(c2, b2)}")
                    plan.skipped.pop(c2.id, None)

    for c, _, _ in by_score:
        if c.id not in placed and c.id not in plan.skipped:
            hears = {p for b in blocks for p in b.purposes}
            plan.skipped[c.id] = (f"no block sits today for {c.purpose.replace('_', ' ')}" if c.purpose not in hears
                                  else "not reached")

    plan.listings = assign_windows(list(placed.values()), blocks)
    plan.excluded = dict(excluded)
    unplaced = [x[0].id for x in by_score if x[0].id not in placed]
    plan.near_miss = unplaced[: len(placed)]
    return plan


def plan_horizon(cases: list[Case], start_days: list[date], cfg: JudgeConfig) -> list[DayPlan]:
    """Plan several days ahead without outcomes: a case appears at most once."""
    listed: set[str] = set()
    plans = []
    for day in start_days:
        remaining = [c for c in cases if c.id not in listed]
        p = plan_day(remaining, day, cfg)
        listed.update(l.case_id for l in p.listings)
        plans.append(p)
    return plans
