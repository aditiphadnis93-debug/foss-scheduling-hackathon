"""Online learning of attendance/readiness and strategic-delay detection.

CONTRACT (implemented by the learning build; this stub is a pass-through so everything runs):

    LearningBehaviour(inner: Behaviour, types, seed)       # wraps any Behaviour (statistical, agents)
        .readiness_signal(cases, day) -> {case_id: p_goes_ahead}   posterior mean, used by the planner
        .decide(ctx, rng)   -> inner.decide(...)
        .observe(ctx, outcome)  updates Beta posteriors per advocate, party, (type, stage); sets
                               case.meta["gaming_flag"] = {"actor": str, "side": "petitioner"|"respondent"|"advocate",
                                                       "p_exceed": float, "evidence": {...}} when flagged
        .profiles() -> dict     advocate / party profiles for the web

Additions (same object):
        .posterior(actor) -> (mean, lo90, hi90, n)   actor = advocate id, party id, "<TYPE>|<STAGE>"
        .brier() -> {"static", "learned", "n"}       both predictions scored on the same hearings
        .flags() -> {actor: flag}                    currently flagged actors

Model
-----
Go-ahead (the side turns up and is ready, given prerequisites met) is learned at three levels,
each a Beta posterior with ``PRIOR_STRENGTH`` pseudo-observations centred on what the level above
already predicts (hierarchical residuals, so the same hearing is not counted twice):

    p0      = behaviour.p_goes_ahead(case, type)            organiser tables x case multipliers
    e_cell  = p0                  ; cell     = (hearing type, stage)
    e_adv   = p0 * L_cell         ; advocate
    e_party = p0 * L_cell * L_adv ; party
    level posterior  Beta(K * ebar + S, K * (1 - ebar) + n - S)     (ebar = mean expected, S = went ahead)
    lift   L = posterior mean / ebar     -> 1 with no data, shrinks by n / (n + K)
    K starts at PRIOR_STRENGTH (8) and is re-estimated each day per level by empirical Bayes
    (method of moments on the groups' residuals): tau^2 = Var_g[(S_g - E_g) / n_g] - mean_g[v_g / n_g],
    K = mean v / tau^2 bounded to [8, K_MAX], v = ebar (1 - ebar). When the groups differ no more
    than binomial noise would explain, K grows and the level stops moving the prediction; when
    they really differ (strategic advocates, a stage that behaves unlike the table), K stays low.
    p_learned(case) = clip(p0 * L_cell * L_adv * L_party, 0.02, 0.999)   (COMBINE = "logit" adds logit shifts instead)

Strategic delay: each actor (advocate, petitioner party, respondent side of a case) has
    requests R (time sought by that side), expected E = sum over its decided hearings of
    SIDE_SHARE x table time-sought rate x case multiplier, hearings n.
    theta ~ Beta(K * e + R, K * (1 - e) + n - R), e = E / n
    p_exceed = P(theta > RATIO * e)            flag when p_exceed > P_FLAG and R >= MIN_REQUESTS
The requesting side is read from the court record of the request (``case.meta["last_request"]``);
only that side's counts move, so the opposite side is never flagged for it.
"""
from __future__ import annotations

import math
from collections import defaultdict
from dataclasses import dataclass

from .behaviour import SIDE_SHARE_PETITIONER, SOUGHT_TIME, case_multiplier, conditional_probs, p_goes_ahead
from .reference import REASON_GROUPS, load_hearing_types

PRIOR_STRENGTH = 8.0      # pseudo-observations behind every prior (the starting value)
K_MAX = 400.0             # empirical-Bayes cap on the prior strength of a go-ahead level
EB_MIN_GROUPS = 20        # re-estimate a level's prior strength once this many groups have data
RATIO = 1.5               # "seeks time materially more than expected"
P_FLAG = 0.9
MIN_REQUESTS = 3
MIN_EXPECTED_RATE = 0.005  # floor on the expected per-hearing request rate (table has zeros)
P_MIN, P_MAX = 0.02, 0.98
P_OUT_MAX = 0.999         # a learned estimate may approach certainty (the table has 100% types)
COMBINE = "ratio"         # how level residuals combine with the table estimate ("logit" | "ratio")

ATTEND = set(REASON_GROUPS["ATTEND"])
COURT = set(REASON_GROUPS["COURT"])


# --- Beta distribution helpers (stdlib only) ----------------------------------------------------
def _betacf(a: float, b: float, x: float) -> float:
    """Continued fraction for the incomplete beta (Lentz)."""
    tiny = 1e-300
    qab, qap, qam = a + b, a + 1.0, a - 1.0
    c, d = 1.0, 1.0 - qab * x / qap
    d = 1.0 / (d if abs(d) > tiny else tiny)
    h = d
    for m in range(1, 300):
        m2 = 2 * m
        aa = m * (b - m) * x / ((qam + m2) * (a + m2))
        d = 1.0 + aa * d
        d = 1.0 / (d if abs(d) > tiny else tiny)
        c = 1.0 + aa / c
        c = c if abs(c) > tiny else tiny
        h *= d * c
        aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2))
        d = 1.0 + aa * d
        d = 1.0 / (d if abs(d) > tiny else tiny)
        c = 1.0 + aa / c
        c = c if abs(c) > tiny else tiny
        de = d * c
        h *= de
        if abs(de - 1.0) < 1e-12:
            break
    return h


def beta_cdf(x: float, a: float, b: float) -> float:
    """Regularised incomplete beta I_x(a, b)."""
    if x <= 0.0:
        return 0.0
    if x >= 1.0:
        return 1.0
    lb = math.lgamma(a + b) - math.lgamma(a) - math.lgamma(b) + a * math.log(x) + b * math.log1p(-x)
    if x < (a + 1.0) / (a + b + 2.0):
        return math.exp(lb) * _betacf(a, b, x) / a
    return 1.0 - math.exp(lb) * _betacf(b, a, 1.0 - x) / b


def beta_ppf(q: float, a: float, b: float) -> float:
    lo, hi = 0.0, 1.0
    for _ in range(60):
        mid = 0.5 * (lo + hi)
        if beta_cdf(mid, a, b) < q:
            lo = mid
        else:
            hi = mid
    return 0.5 * (lo + hi)


def p_exceed(requests: float, hearings: float, expected: float, ratio: float = RATIO,
             k: float = PRIOR_STRENGTH) -> float:
    """P(true request rate > ratio x expected rate | data), Beta posterior with prior mean = expected."""
    if hearings <= 0:
        return 0.0
    e = min(0.95, max(MIN_EXPECTED_RATE, expected / hearings))
    a = k * e + requests
    b = k * (1.0 - e) + max(0.0, hearings - requests)
    return 1.0 - beta_cdf(min(0.999, ratio * e), a, b)


# --- tallies --------------------------------------------------------------------------------------
@dataclass
class Level:
    """Beta tally for go-ahead at one level (sum of expectations keeps the prior centred)."""
    n: float = 0.0
    s: float = 0.0            # went ahead
    e: float = 0.0            # sum of expected go-ahead at observation time

    @property
    def ebar(self) -> float:
        return self.e / self.n if self.n else 0.0

    def ab(self, k: float = PRIOR_STRENGTH) -> tuple[float, float]:
        m = min(P_MAX, max(P_MIN, self.ebar or 0.5))
        return k * m + self.s, k * (1.0 - m) + self.n - self.s

    def lift(self, k: float = PRIOR_STRENGTH) -> float:
        if not self.n:
            return 1.0
        a, b = self.ab(k)
        return (a / (a + b)) / max(P_MIN, min(P_MAX, self.ebar))

    def shift(self, k: float = PRIOR_STRENGTH) -> float:
        """Logit-scale residual: logit(posterior mean) - logit(mean expected)."""
        if not self.n:
            return 0.0
        a, b = self.ab(k)
        return _logit(a / (a + b)) - _logit(self.ebar)

    def adj(self, k: float = PRIOR_STRENGTH) -> float:
        return self.lift(k) if COMBINE == "ratio" else self.shift(k)


def _logit(p: float) -> float:
    p = min(P_MAX, max(P_MIN, p))
    return math.log(p / (1.0 - p))


def combine(p0: float, *adj: float) -> float:
    """Apply level adjustments to the table estimate (``COMBINE`` = "logit" shifts or "ratio" lifts)."""
    if COMBINE == "ratio":
        p = p0
        for a in adj:
            p *= a
        return min(P_OUT_MAX, max(P_MIN, p))
    z = _logit(p0) + sum(adj)
    return min(P_OUT_MAX, max(P_MIN, 1.0 / (1.0 + math.exp(-z))))


def eb_strength(levels) -> float:
    """Method-of-moments prior strength for a family of Beta groups (see module docstring)."""
    groups = [g for g in levels if g.n >= 2]
    if len(groups) < EB_MIN_GROUPS:
        return PRIOR_STRENGTH
    resid = [(g.s - g.e) / g.n for g in groups]
    noise = [max(1e-6, g.ebar * (1.0 - g.ebar)) / g.n for g in groups]
    mean_r = sum(resid) / len(resid)
    var_r = sum((r - mean_r) ** 2 for r in resid) / (len(resid) - 1)
    tau2 = var_r - sum(noise) / len(noise)
    v = sum(max(1e-6, g.ebar * (1.0 - g.ebar)) for g in groups) / len(groups)
    if tau2 <= v / K_MAX:
        return K_MAX
    return min(K_MAX, max(PRIOR_STRENGTH, v / tau2))


@dataclass
class Requests:
    """Time-seeking tally of one side."""
    side: str
    hearings: int = 0
    requests: float = 0.0
    expected: float = 0.0

    def evidence(self) -> dict:
        pe = p_exceed(self.requests, self.hearings, self.expected)
        return {"requests": round(self.requests, 2), "expected": round(self.expected, 3),
                "ratio": round(self.requests / self.expected, 2) if self.expected > 0 else None,
                "p_exceed": round(pe, 4), "hearings": self.hearings}

    def flagged(self) -> tuple[bool, dict]:
        ev = self.evidence()
        return (self.requests >= MIN_REQUESTS and ev["p_exceed"] > P_FLAG), ev


def went_ahead(kind: str, reason: str | None) -> bool | None:
    """True / False for a decided attendance outcome, None when it says nothing about the sides."""
    if kind == "substantive":
        return True
    if kind != "adjourned":
        return None
    if reason in ATTEND:
        return False
    if reason in COURT:
        return True
    return None


def respondent_actor(case_id: str) -> str:
    return f"{case_id}/respondent"


class LearningBehaviour:
    def __init__(self, inner, types=None, seed: int = 42):
        self.inner = inner
        self.types = types or load_hearing_types()
        self.seed = seed
        self.name = getattr(inner, "name", "statistical")
        self.appointment = True
        self.cells: dict[str, Level] = defaultdict(Level)
        self.advocates: dict[str, Level] = defaultdict(Level)
        self.parties: dict[str, Level] = defaultdict(Level)
        self.req: dict[str, Requests] = {}
        self._cases: dict[str, object] = {}
        self._actor_cases: dict[str, set[str]] = defaultdict(set)
        self._flags: dict[str, dict] = {}
        self._pending: dict[tuple[str, str], tuple] = {}
        self._brier = [0.0, 0.0, 0]          # static, learned, n
        self.k = {"cell": PRIOR_STRENGTH, "advocate": PRIOR_STRENGTH, "party": PRIOR_STRENGTH}

    # --- bookkeeping -------------------------------------------------------------------------
    def _register(self, c) -> None:
        if c.case_id in self._cases:
            return
        self._cases[c.case_id] = c
        self._actor_cases[c.advocate_id].add(c.case_id)
        self._actor_cases[c.party_id].add(c.case_id)
        self._actor_cases[respondent_actor(c.case_id)].add(c.case_id)
        for actor in (c.advocate_id, c.party_id, respondent_actor(c.case_id)):
            if actor in self._flags:
                self._apply_flag(actor)

    @staticmethod
    def _cell_key(ht_code: str, stage: str) -> str:
        return f"{ht_code}|{stage}"

    def _predict(self, c, ht_code: str, p0: float) -> tuple[float, float, float, float]:
        """(p_learned, L_cell, L_adv, L_party)."""
        ck = self._cell_key(ht_code, c.stage)
        none = 1.0 if COMBINE == "ratio" else 0.0
        lc = self.cells[ck].adj(self.k["cell"]) if ck in self.cells else none
        la = self.advocates[c.advocate_id].adj(self.k["advocate"]) if c.advocate_id in self.advocates else none
        lp = self.parties[c.party_id].adj(self.k["party"]) if c.party_id in self.parties else none
        return combine(p0, lc, la, lp), lc, la, lp

    def _has_data(self, c, ht_code: str) -> bool:
        return (self._cell_key(ht_code, c.stage) in self.cells or c.advocate_id in self.advocates
                or c.party_id in self.parties)

    # --- Behaviour protocol ------------------------------------------------------------------
    def readiness_signal(self, cases, day):
        inner = self.inner.readiness_signal(cases, day) or {}
        self.k = {"cell": eb_strength(self.cells.values()), "advocate": eb_strength(self.advocates.values()),
                  "party": eb_strength(self.parties.values())}
        out: dict[str, float] = {}
        for c in cases:
            self._register(c)
            ht = self.types.get(c.purpose)
            if ht is None or not self._has_data(c, ht.code):
                continue
            p, *_ = self._predict(c, ht.code, p_goes_ahead(c, ht, self.appointment))
            out[c.case_id] = round(p, 4)
        for cid, v in inner.items():          # an inner behaviour's own opinion is averaged in
            out[cid] = round(0.5 * (out[cid] + v), 4) if cid in out else v
        return out

    def decide(self, ctx, rng):
        c, ht = ctx.case, ctx.hearing_type
        self._register(c)
        self.appointment = ctx.was_given_appointment
        # the case state as it stands *before* the hearing (the simulator updates it before observe)
        p0 = p_goes_ahead(c, ht, ctx.was_given_appointment)
        pl, lc, la, _ = self._predict(c, ht.code, p0)
        m = case_multiplier(c, ctx.was_given_appointment)
        seek = min(0.9, conditional_probs(ht)["seek"] * m)
        self._pending[(c.case_id, ctx.day.isoformat())] = (p0, pl, lc, la, seek, c.stage)
        return self.inner.decide(ctx, rng)

    def observe(self, ctx, outcome):
        self.inner.observe(ctx, outcome)
        c = ctx.case
        rec = self._pending.pop((c.case_id, ctx.day.isoformat()), None)
        if rec is None:
            return None
        p0, pl, lc, la, seek, stage = rec
        y = went_ahead(outcome.kind, outcome.reason)
        if y is not None:
            yv = 1.0 if y else 0.0
            self._brier[0] += (p0 - yv) ** 2
            self._brier[1] += (pl - yv) ** 2
            self._brier[2] += 1
            for lvl, exp in ((self.cells[self._cell_key(ctx.hearing_type.code, stage)], p0),
                             (self.advocates[c.advocate_id], combine(p0, lc)),
                             (self.parties[c.party_id], combine(p0, lc, la))):
                lvl.n += 1
                lvl.s += yv
                lvl.e += exp
        # --- time-seeking by side --------------------------------------------------------------
        if outcome.kind not in ("substantive", "adjourned") or y is None:
            return None
        sought = outcome.kind == "adjourned" and outcome.reason == SOUGHT_TIME
        side = None
        if sought:
            lr = c.meta.get("last_request") or {}
            side = lr.get("side") if lr.get("day") == ctx.day.isoformat() else None
        share = {"petitioner": SIDE_SHARE_PETITIONER, "respondent": 1.0 - SIDE_SHARE_PETITIONER}
        actors = {"advocate": (c.advocate_id, "petitioner"), "party": (c.party_id, "petitioner"),
                  "respondent": (respondent_actor(c.case_id), "respondent")}
        for role, (actor, s) in actors.items():
            r = self.req.get(actor)
            if r is None:
                r = self.req[actor] = Requests("advocate" if role == "advocate" else s)
            r.hearings += 1
            r.expected += share[s] * seek
            if sought:
                r.requests += (1.0 if side == s else 0.0) if side else share[s]
            self._evaluate(actor)
        return None

    # --- detection ---------------------------------------------------------------------------
    def _evaluate(self, actor: str) -> None:
        r = self.req[actor]
        ok, ev = r.flagged()
        if ok:
            self._flags[actor] = {"actor": actor, "side": r.side, "p_exceed": ev["p_exceed"], "evidence": ev}
            self._apply_flag(actor)
        elif actor in self._flags:
            del self._flags[actor]
            for cid in self._actor_cases.get(actor, ()):
                c = self._cases[cid]
                if c.meta.get("gaming_flag", {}).get("actor") == actor:
                    del c.meta["gaming_flag"]
                    alt = [self._flags[a] for a in (c.advocate_id, c.party_id, respondent_actor(cid))
                           if a in self._flags]
                    if alt:
                        c.meta["gaming_flag"] = dict(max(alt, key=lambda f: f["p_exceed"]))

    def _apply_flag(self, actor: str) -> None:
        f = self._flags[actor]
        for cid in self._actor_cases.get(actor, ()):
            c = self._cases[cid]
            if getattr(c, "status", "pending") != "pending":
                continue
            cur = c.meta.get("gaming_flag")
            # the advocate-level flag wins (it covers all their matters); otherwise the stronger evidence
            if (cur is None or cur.get("actor") == actor or f["side"] == "advocate"
                    or (cur.get("side") != "advocate" and f["p_exceed"] >= cur.get("p_exceed", 0))):
                c.meta["gaming_flag"] = dict(f)

    # --- read-outs ---------------------------------------------------------------------------
    def posterior(self, actor: str) -> tuple[float, float, float, int]:
        """Posterior go-ahead probability for an actor: (mean, lo90, hi90, n)."""
        for fam, d in (("advocate", self.advocates), ("party", self.parties), ("cell", self.cells)):
            if actor in d:
                lvl, k = d[actor], self.k[fam]
                break
        else:
            return (float("nan"), float("nan"), float("nan"), 0)
        if not lvl.n:
            return (float("nan"), float("nan"), float("nan"), 0)
        a, b = lvl.ab(k)
        return (round(a / (a + b), 4), round(beta_ppf(0.05, a, b), 4), round(beta_ppf(0.95, a, b), 4), int(lvl.n))

    def learned_by_type(self) -> dict[str, dict]:
        """Per hearing type: prior (expected) vs observed go-ahead and the posterior, pooled over stages."""
        agg: dict[str, list[float]] = {}
        for key, lvl in self.cells.items():
            code = key.split("|")[0] if isinstance(key, str) else key[0]
            a = agg.setdefault(code, [0.0, 0.0, 0.0])
            a[0] += lvl.n; a[1] += lvl.s; a[2] += lvl.e
        out = {}
        k = self.k.get("cell", PRIOR_STRENGTH)
        for code, (n, s_, e) in agg.items():
            if not n:
                continue
            m = min(P_MAX, max(P_MIN, e / n))
            a_, b_ = k * m + s_, k * (1 - m) + n - s_
            out[code] = {"n": int(n), "prior_go_ahead": round(m, 4), "observed_go_ahead": round(s_ / n, 4),
                         "posterior_go_ahead": round(a_ / (a_ + b_), 4),
                         "lo90": round(beta_ppf(0.05, a_, b_), 4), "hi90": round(beta_ppf(0.95, a_, b_), 4)}
        return out

    def brier(self) -> dict:
        s, l, n = self._brier
        return {"static": round(s / n, 5) if n else None, "learned": round(l / n, 5) if n else None, "n": n}

    def flags(self) -> dict[str, dict]:
        return {k: dict(v) for k, v in self._flags.items()}

    def profiles(self) -> dict:
        """Learner-side state per actor (the full profile page is ``profiles.build``)."""
        def lvl(d):
            return {k: {"n": int(v.n), "went_ahead": int(v.s), "expected": round(v.e, 2),
                        "lift": round(v.lift(kk), 3), "logit_shift": round(v.shift(kk), 3)}
                    for k, v in d.items()}
        kk = 0.0

        def fam(d, name):
            nonlocal kk
            kk = self.k[name]
            return lvl(d)
        return {"advocates": fam(self.advocates, "advocate"), "parties": fam(self.parties, "party"),
                "cells": fam(self.cells, "cell"), "prior_strength": dict(self.k),
                "requests": {k: {"side": v.side, **v.evidence()} for k, v in self.req.items()},
                "flags": self.flags(), "brier": self.brier()}

    def __getattr__(self, item):          # pass through optional hooks (on_plan, ...)
        if item == "inner":
            raise AttributeError(item)
        return getattr(self.inner, item)
