"""Evaluation harness: play a policy forward over N sitting days with seeded outcomes.

Behaviour "fixed" plays the per-purpose rates of the hearing-type table. Behaviour "agents" (pass
`agents=`) lets advocates and litigants decide whether to come and be ready (agents/). Policy "l3" is
the L1 pipeline with the judge agent listing, ruling and fixing next dates; it needs `agents`.
"""
from __future__ import annotations

import copy
import random
from dataclasses import dataclass
from datetime import date, timedelta
from typing import TYPE_CHECKING

import pandas as pd

from scheduler.assign import plan_day
from scheduler.capacity import duration, p_heard
from scheduler.data import HEARING_TYPES, NEXT_PURPOSE, is_sitting_day, sitting_days
from scheduler.models import AGE_BUCKETS, Case, JudgeConfig, Listing
from scheduler.next_date import Ledger, recommend

if TYPE_CHECKING:
    from agents.outcomes import Agents

BASELINE_LISTED_PER_DAY = 60
BASELINE_GAP_DAYS = 60
PREREQ_RESOLVE_RATE = 0.05  # daily chance a pending prerequisite (e.g. warrant) is completed
READY_LIFT = 0.25  # agents: a hearing with counsel ready is this much likelier to be effective than the table rate


@dataclass
class SimResult:
    hearings: pd.DataFrame  # one row per listing
    days: pd.DataFrame  # one row per sitting day
    backlog: pd.DataFrame  # pending cases per age bucket per day


def _baseline_day(cases: list[Case], day: date, cfg: JudgeConfig) -> list[Listing]:
    """Status quo: booked cases first, then the pool in filing order, 60 a day, no filters."""
    live = [c for c in cases if not c.disposed and (not cfg.case_types or c.case_type in cfg.case_types)]
    booked = [c for c in live if c.next_date == day]
    pool = sorted((c for c in live if c.next_date is None), key=lambda c: c.filing_date)
    chosen = booked + pool[: max(0, BASELINE_LISTED_PER_DAY - len(booked))]
    return [Listing(c.id, day, "all day", c.purpose, c.advocate_ids[0], round(c.age_years(day), 1),
                    0.0, 0.0, ["baseline"]) for c in chosen]


def _baseline_next(day: date, cfg: JudgeConfig) -> date:
    d = day + timedelta(days=BASELINE_GAP_DAYS)
    while not is_sitting_day(d, cfg.leave):
        d += timedelta(days=1)
    return d


def simulate(cases: list[Case], cfg: JudgeConfig, start: date, n_days: int,
             policy: str = "l1", seed: int = 11, agents: Agents | None = None) -> SimResult:
    if policy == "l3" and agents is None:
        raise ValueError("policy 'l3' needs agents (the judge agent lists and rules)")
    behaviour = "agents" if agents else "fixed"
    cases = copy.deepcopy(cases)
    by_id = {c.id: c for c in cases}
    rng = random.Random(seed)
    ledger = Ledger()
    hearings, day_rows, backlog = [], [], []

    for day in sitting_days(start, n_days, cfg.leave):
        if policy in ("l1", "l3"):
            plan = plan_day(cases, day, cfg, agents.scorer() if policy == "l3" else None)
            listings = plan.listings
            listed = {l.case_id for l in listings}
            for cid in plan.near_miss:
                by_id[cid].consecutive_skips += 1
            for cid in listed:
                by_id[cid].consecutive_skips = 0
        else:
            listings = _baseline_day(cases, day, cfg)

        if agents:
            agents.begin_day(listings, by_id, day, cfg, policy, rng)
        sitting = sum(b.minutes for b in cfg.blocks_on(day))
        used = 0.0
        for l in listings:
            c = by_id[l.case_id]
            purpose = c.purpose
            p_eff = HEARING_TYPES[purpose].p_effective
            if agents:
                att = agents.attendance(c.id)
                showed, prepared = att.showed, att.prepared
                p_eff = min(0.95, p_eff + READY_LIFT)
            else:
                att = None
                showed, prepared = rng.random() < p_heard(c), True
            reached = used + duration(c) <= sitting
            heard = showed and reached
            effective = heard and prepared and c.prerequisites_met and rng.random() < p_eff
            if heard:
                used += duration(c)
                c.last_heard = day
            else:
                c.adjournment_count += 1

            if effective:
                nxt = NEXT_PURPOSE[purpose]
                if purpose == "evidence" and rng.random() < 0.5:
                    nxt = "evidence"  # evidence often spans several hearings
                if nxt is None:
                    c.disposed = True
                else:
                    c.purpose = nxt
            elif heard:
                c.adjournment_count += 1

            c.next_date, c.next_block, gap, why = None, None, None, ""
            if not c.disposed:
                if policy in ("l1", "l3"):
                    band = "ideal"
                    if policy == "l3":
                        outcome = ("effective: the case moved on" if effective else
                                   "heard but not effective" if heard else "not heard")
                        band, _ = agents.next_band(c, day, cfg, outcome, rng)
                    r = recommend(c, day, heard, cfg, ledger, band)
                    if r:
                        c.next_date, c.next_block, why = r[0], r[1].name, r[2]
                        gap = (r[0] - day).days
                else:
                    c.next_date = _baseline_next(day, cfg)
                    gap = (c.next_date - day).days
                    why = "flat default"
            if agents:
                agents.after_hearing(c, day, heard)

            hearings.append({
                "policy": policy, "behaviour": behaviour, "day": day, "case_id": c.id, "block": l.block, "window": l.window,
                "purpose": purpose, "advocate": l.advocate, "age_years": l.age_years,
                "showed": showed, "reached": reached, "heard": heard, "effective": effective,
                "minutes": duration(c) if heard else 0.0, "disposed": c.disposed,
                "next_gap_days": gap, "ideal_gap_days": HEARING_TYPES[c.purpose].ideal_gap_days,
                "next_date_reason": why,
                "advocate_action": att.advocate if att else "", "litigant_action": att.litigant if att else "",
                "ruling": att.ruling if att else "", "decision_source": att.source if att else "fixed",
                "agent_why": att.why if att else "",
            })

        for c in cases:
            if not c.prerequisites_met and rng.random() < PREREQ_RESOLVE_RATE:
                c.prerequisites_met = True
        day_rows.append({"policy": policy, "behaviour": behaviour, "day": day, "sitting_minutes": sitting, "used_minutes": used})
        counts = dict.fromkeys(AGE_BUCKETS, 0)
        for c in cases:
            if not c.disposed and (not cfg.case_types or c.case_type in cfg.case_types):
                counts[c.age_bucket(day)] += 1
        backlog.append({"policy": policy, "behaviour": behaviour, "day": day, **counts})

    return SimResult(pd.DataFrame(hearings), pd.DataFrame(day_rows), pd.DataFrame(backlog))
