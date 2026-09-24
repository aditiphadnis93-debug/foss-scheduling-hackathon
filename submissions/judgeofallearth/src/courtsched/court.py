"""Simulated Court: plays a causelist out from pre-drawn outcomes.

Outcomes are drawn up front per (case, listing number) and per (case, process issue), on
separate RNG streams. Every strategy therefore meets the same "reality": the k-th time a
case is called, the dice read the same, whatever order the planner chose.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta

import numpy as np

from .data import AWAITING_PROCESS, NEXT_STAGE, SIDE_PURPOSES, HearingType
from .scenario import Scenario

MAX_LISTINGS = 200
MAX_PROCESS = 64


def adjust(p: float, offset: float) -> float:
    """Shift a probability by an offset on the log-odds scale."""
    if offset == 0.0:
        return p
    p = min(0.995, max(0.005, p))
    return 1 / (1 + np.exp(-(np.log(p / (1 - p)) + offset)))


def p_advance(ht: HearingType, rule: str) -> float:
    """Die 2: P(stage advance | substantive), calibrated so 1/(p_sub*p_adv) = mean hearings."""
    if rule == "literal":
        return 1.0
    if rule == "matched":
        return min(1.0, 1.0 / (ht.mean_hearings * ht.p_sub))
    raise ValueError(f"unknown advance rule {rule!r}")


@dataclass
class CaseState:
    idx: int
    case_id: str
    filing_date: date
    advocate: str
    stage: str
    purpose: str
    old: bool
    listings: int = 0  # times called so far in the posting (indexes the outcome trace)
    process_issues: int = 0
    process_back: date | None = None  # outstanding process returns on this date
    last_heard: date | None = None
    disposed: bool = False
    history_z: float = 0.0  # public: standardised log(hearings so far / expected for its stage)
    latent: float = 0.0  # world-only: hidden reliability offset (planner must not read)

    def process_outstanding(self, day: date) -> bool:
        return self.process_back is not None and self.process_back > day


@dataclass
class Outcome:
    case: int
    reached: bool
    start_min: float | None
    minutes: float
    substantive: bool
    advanced_to: str | None  # new purpose if the case moved on (or "DISPOSED")
    reason: str | None  # adjournment reason when reached but not substantive
    process_outstanding: bool
    purpose_before: str = ""


class Court:
    def __init__(self, scenario: Scenario, hts: dict[str, HearingType], n_cases: int, seed: int):
        self.sc = scenario
        self.hts = hts
        self.n_cases, self.seed = n_cases, seed
        self._draw(n_cases, seed)

    # Pre-drawn outcomes are a pure function of the seed: snapshots skip them (tens of MB).
    def __getstate__(self):
        return {"sc": self.sc, "hts": self.hts, "n_cases": self.n_cases, "seed": self.seed}

    def __setstate__(self, st):
        self.__dict__.update(st)
        self._draw(self.n_cases, self.seed)

    def _draw(self, n_cases: int, seed: int) -> None:
        streams = np.random.SeedSequence(seed).spawn(6)
        g = [np.random.default_rng(s) for s in streams]
        self.u_sub = g[0].random((n_cases, MAX_LISTINGS))
        self.u_reason = g[1].random((n_cases, MAX_LISTINGS))
        self.u_adv = g[2].random((n_cases, MAX_LISTINGS))
        self.z_dur = g[3].standard_normal((n_cases, MAX_LISTINGS))
        self.u_proc = g[4].random((n_cases, MAX_PROCESS, 2))  # [is issued?, delay]
        self.z_case = g[5].standard_normal(n_cases)

    def assign_latent(self, cases: list[CaseState]) -> None:
        """Hidden reliability: correlated with past adjournment-heaviness, plus noise."""
        s, r = self.sc.case_heterogeneity, self.sc.history_signal
        for c in cases:
            c.latent = -s * (r * c.history_z + (1 - r * r) ** 0.5 * self.z_case[c.idx])

    # --- process (summons / warrant) -------------------------------------------------------
    def maybe_issue_process(self, c: CaseState, day: date, force: bool = False) -> None:
        """On entering a purpose (or after an 'awaiting process' adjournment), draw whether
        process is outstanding and when it returns."""
        k = min(c.process_issues, MAX_PROCESS - 1)
        c.process_issues += 1
        u_issue, u_delay = self.u_proc[c.idx, k]
        p = self.hts[c.purpose].p_awaiting_process if c.purpose in self.hts else 0.0
        if force or u_issue < p:
            delay = -np.log(1 - u_delay) * self.sc.process_return_mean_days  # exponential
            c.process_back = day + timedelta(days=max(1, int(round(delay))))
        else:
            c.process_back = None

    # --- a sitting day ---------------------------------------------------------------------
    def play(self, day: date, order: list[CaseState]) -> list[Outcome]:
        t = 0.0
        out = []
        for c in order:
            outstanding = c.process_outstanding(day)
            if t >= self.sc.minutes_per_day:
                out.append(Outcome(c.idx, False, None, 0.0, False, None, None, outstanding, c.purpose))
                continue
            k = min(c.listings, MAX_LISTINGS - 1)
            c.listings += 1
            ht = self.hts[c.purpose]
            if outstanding:
                sub, reason = False, AWAITING_PROCESS
            else:
                since = (day - c.last_heard).days if c.last_heard else None
                p = adjust(ht.p_sub_ready * self.sc.ramp(since, ht.gap_days), c.latent)
                sub = self.u_sub[c.idx, k] < p
                reason = None if sub else self._reason(ht, self.u_reason[c.idx, k])
            minutes = self._minutes(ht, sub, self.z_dur[c.idx, k])
            advanced_to = None
            if sub and self.u_adv[c.idx, k] < p_advance(ht, self.sc.advance_rule):
                advanced_to = c.stage if c.purpose in SIDE_PURPOSES else NEXT_STAGE[c.purpose]
            out.append(Outcome(c.idx, True, t, minutes, sub, advanced_to, reason, outstanding, c.purpose))
            t += minutes
            self._apply(c, day, sub, advanced_to, reason)
        return out

    def _apply(self, c: CaseState, day: date, sub: bool, advanced_to: str | None, reason) -> None:
        c.last_heard = day
        if advanced_to == "DISPOSED":
            c.disposed, c.purpose, c.process_back = True, "DISPOSED", None
            return
        if advanced_to:
            if c.purpose not in SIDE_PURPOSES:
                c.stage = advanced_to
            c.purpose = advanced_to
            self.maybe_issue_process(c, day)
        elif reason == AWAITING_PROCESS:
            self.maybe_issue_process(c, day, force=True)

    def _reason(self, ht: HearingType, u: float) -> str:
        items = [(k, v) for k, v in ht.reason_counts.items() if k != AWAITING_PROCESS and v > 0]
        total = sum(v for _, v in items)
        if total == 0:
            return "Unclear"
        acc = 0.0
        for k, v in items:
            acc += v / total
            if u < acc:
                return k
        return items[-1][0]

    def _minutes(self, ht: HearingType, sub: bool, z: float) -> float:
        if not sub:
            return self.sc.adjourn_minutes
        if self.sc.duration_cv <= 0:
            return float(ht.minutes)
        s = np.sqrt(np.log(1 + self.sc.duration_cv**2))
        return float(ht.minutes * np.exp(s * z - s * s / 2))
