"""Deciders turn Situations into Decisions: calibrated probabilities over a role's options.

`RuleDecider` is the explainable fallback: a softmax over hand-set logits, each term named in the why.
`LayaDecider` asks the Laya sidecar (POST /v1/systemone, Jev wire protocol) and memoises every answer
by situation, on disk, so a repeat run makes no calls. Any failure, or a spent call budget, falls back
to the rules for that situation and says so in `source`.
"""
from __future__ import annotations

import json
import math
import os
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path

from .situation import QUESTIONS, Situation

CACHE_PATH = Path(__file__).resolve().parent.parent / "data" / "laya_decisions.json"
DEFAULT_URL = "http://localhost:8000"


@dataclass(frozen=True)
class Decision:
    probs: dict[str, float]
    source: str  # "rules" | "laya" | "rules (laya unavailable)" | "rules (budget spent)"
    why: str

    @property
    def top(self) -> str:
        return max(self.probs, key=self.probs.get)

    def sample(self, u: float) -> str:
        acc = 0.0
        for k, p in self.probs.items():
            acc += p
            if u < acc:
                return k
        return list(self.probs)[-1]


def _softmax(logits: dict[str, float]) -> dict[str, float]:
    m = max(logits.values())
    e = {k: math.exp(v - m) for k, v in logits.items()}
    z = sum(e.values())
    return {k: round(v / z, 4) for k, v in e.items()}


# ---------------------------------------------------------------- rules

OLD = {"4-5y", "5y+", "4y+"}


def _rules(s: Situation) -> tuple[dict[str, float], list[str]]:
    """Logits per option and the named terms that moved them."""
    f = s.f
    why: list[str] = []

    def nudge(logits: dict[str, float], cond: object, label: str, **deltas: float) -> None:
        if cond:
            for k, d in deltas.items():
                logits[k] += d
            why.append(label)

    if s.role == "advocate":
        lg = {"ready": 0.9, "unprepared": 0.0, "seek_adjournment": -0.3, "absent": -0.1}
        t = f["trait"]
        nudge(lg, t == "diligent", "diligent", ready=1.0, seek_adjournment=-1.0)
        nudge(lg, t == "overstretched", "overstretched", absent=0.8, unprepared=0.5)
        nudge(lg, t == "habitual adjourner", "habitual adjourner", seek_adjournment=1.6)
        nudge(lg, f["age"] in OLD, "old case: facts forgotten", unprepared=0.7)
        nudge(lg, f["cover_page"], "cover page required", ready=0.8, unprepared=-0.6)
        nudge(lg, f["reminder"], "reminder with checklist", ready=0.4, absent=-0.5)
        nudge(lg, f["window"], "has a time window", absent=-0.6)
        nudge(lg, f["clash"], "clash in another court", absent=1.0 if f["window"] else 1.8,
              seek_adjournment=0.5)
        nudge(lg, f["same_court_matters"] != "none", "other matters here today", absent=-0.5)
        nudge(lg, f["costs_risk"], "costs for adjournments", seek_adjournment=-1.2)
        nudge(lg, f["adjournments"] in ("3-5", "6+", "3+"), "adjourned often", seek_adjournment=0.4)
        nudge(lg, not f["prereq_met"], "prerequisite pending", seek_adjournment=1.5)
        nudge(lg, f["purpose"] in ("mention", "admission"), "short matter", unprepared=-0.5)
        return lg, why
    if s.role == "litigant":
        lg = {"appear": 1.4, "stay_away": 0.0}
        t = f["trait"]
        nudge(lg, t == "organisation", "organisation", appear=0.8)
        nudge(lg, t == "travels far", "travels far", appear=-0.8)
        nudge(lg, t == "daily-wage earner", "loses a day's pay", appear=-0.6 if f["window"] else -1.2)
        nudge(lg, f["window"], "has a time window", appear=0.6)
        nudge(lg, f["reminder"], "reminder", appear=0.5)
        nudge(lg, f["notice"] == "under a week", "short notice", appear=-0.5)
        nudge(lg, f["wasted_trips"] != "none", "earlier wasted trips",
              appear=-0.4 if f["wasted_trips"] == "1-2" else -0.9)
        return lg, why
    if s.role == "judge_list":
        style = str(f["style"]).lower()
        lg = {"list_today": 0.0, "defer": 0.5}
        likes_old = "old" in style and "wait" not in style
        nudge(lg, f["age"] in OLD, "old case", list_today=1.2 if likes_old else 0.2)
        nudge(lg, f["fresh"], "fresh matter", list_today=1.5 if "fresh" in style else 0.3)
        nudge(lg, f["urgent"], "urgent", list_today=2.5)
        nudge(lg, f["since_heard"] == "over 6 months", "not heard for 6+ months", list_today=0.8)
        nudge(lg, f["since_heard"] == "under a month", "heard recently", list_today=-0.6)
        nudge(lg, f["purpose"] == "final_arguments", "final arguments", list_today=0.5)
        nudge(lg, f["adjournments"] == "6+", "adjourned 6+ times", list_today=0.4)
        nudge(lg, f["advocate_matters"] != "none" and "group" in style, "advocate's matters can be grouped",
              list_today=0.6)
        return lg, why
    if s.role == "judge_rule":
        style = str(f["style"]).lower()
        lg = {"grant": 1.0, "refuse_proceed": 0.0, "grant_with_costs": -0.5}
        strict = "not tolerate" in style or "unprepared" in style
        nudge(lg, strict, "strict on unpreparedness", refuse_proceed=0.8, grant_with_costs=1.0)
        nudge(lg, "readily grant" in style, "grants adjournments readily", grant=1.5)
        nudge(lg, f["age"] in OLD, "old case", refuse_proceed=0.6, grant_with_costs=0.4)
        nudge(lg, f["adjournments"] in ("3-5", "6+"), "adjourned often", grant_with_costs=0.8, grant=-0.5)
        nudge(lg, f["costed_before"], "costed before", refuse_proceed=0.6)
        nudge(lg, "unprepared" in str(f["request"]), "counsel unprepared", refuse_proceed=0.3)
        return lg, why
    if s.role == "judge_next":
        lg = {"short": 0.0, "ideal": 1.2, "long": -0.8}
        out = str(f["outcome"])
        nudge(lg, "effective" in out and "not" not in out, "hearing moved the case", ideal=0.4)
        nudge(lg, f["age"] in OLD, "old case", short=1.0)
        nudge(lg, "not heard" in out, "not heard", short=0.5)
        nudge(lg, "fresh" in str(f["style"]).lower() and f["age"] in OLD, "old files wait", long=1.4)
        return lg, why
    raise ValueError(f"unknown role {s.role}")


class RuleDecider:
    name = "rules"

    def decide(self, situations: list[Situation]) -> list[Decision]:
        out = []
        for s in situations:
            lg, why = _rules(s)
            out.append(Decision(_softmax(lg), "rules", ", ".join(why) or "baseline disposition"))
        return out

    def status(self) -> dict:
        return {"decider": "rules", "reachable": False}


# ---------------------------------------------------------------- Laya

def laya_questions(role: str) -> dict:
    instructions, options = QUESTIONS[role]
    return {"decision": {"type": "choice", "instructions": instructions, "criteria": options}}


class LayaDecider:
    """Laya sidecar with an on-disk memo. `budget` caps new calls per instance (a simulation run)."""

    name = "laya"

    def __init__(self, url: str | None = None, budget: int = 400, cache_path: Path | None = CACHE_PATH,
                 timeout: float = 10.0, model: str = "english") -> None:
        self.url = (url or os.environ.get("LAYA_URL") or DEFAULT_URL).rstrip("/")
        self.budget = budget
        self.cache_path = cache_path
        self.timeout = timeout
        self.model = model
        self.calls = 0
        self.hits = 0
        self.seconds = 0.0
        self.fallback = RuleDecider()
        self._reachable: bool | None = None
        self.cache: dict[str, dict[str, float]] = {}
        if cache_path and cache_path.exists():
            try:
                self.cache = json.loads(cache_path.read_text())
            except (OSError, ValueError):
                self.cache = {}

    # -- transport (tests replace _post)
    def _post(self, payload: dict) -> dict:
        req = urllib.request.Request(self.url + "/v1/systemone", data=json.dumps(payload).encode(),
                                     headers={"content-type": "application/json"})
        with urllib.request.urlopen(req, timeout=self.timeout) as r:
            return json.loads(r.read())

    def _health(self) -> bool:
        try:
            with urllib.request.urlopen(self.url + "/health", timeout=2) as r:
                return json.loads(r.read()).get("status") == "ok"
        except (OSError, ValueError):
            return False

    def reachable(self) -> bool:
        if self._reachable is None:
            self._reachable = self._health()
        return self._reachable

    def ask(self, s: Situation) -> dict[str, float]:
        res = self._post({"state": s.to_state(), "questions": laya_questions(s.role), "model": self.model})
        probs = res["answers"]["decision"]["probabilities"]
        options = QUESTIONS[s.role][1]
        probs = {k: float(probs.get(k, 0.0)) for k in options}
        z = sum(probs.values())
        if z <= 0:
            raise ValueError("empty distribution")
        return {k: round(v / z, 4) for k, v in probs.items()}

    def decide(self, situations: list[Situation]) -> list[Decision]:
        out: list[Decision] = []
        for s in situations:
            k = s.key()
            if k in self.cache:
                self.hits += 1
                out.append(Decision(self.cache[k], "laya", _laya_why(self.cache[k])))
                continue
            if self.calls >= self.budget:
                d = self.fallback.decide([s])[0]
                out.append(Decision(d.probs, "rules (budget spent)", d.why))
                continue
            if not self.reachable():
                d = self.fallback.decide([s])[0]
                out.append(Decision(d.probs, "rules (laya unavailable)", d.why))
                continue
            t0 = time.perf_counter()
            try:
                probs = self.ask(s)
            except (OSError, ValueError, KeyError, TypeError):
                self._reachable = False  # stop trying for this run; rules take over
                d = self.fallback.decide([s])[0]
                out.append(Decision(d.probs, "rules (laya unavailable)", d.why))
                continue
            finally:
                self.seconds += time.perf_counter() - t0
            self.calls += 1
            self.cache[k] = probs
            out.append(Decision(probs, "laya", _laya_why(probs)))
        return out

    def save(self) -> None:
        if not self.cache_path:
            return
        tmp = self.cache_path.with_suffix(".tmp")
        tmp.parent.mkdir(parents=True, exist_ok=True)
        tmp.write_text(json.dumps(self.cache))
        tmp.replace(self.cache_path)

    def status(self) -> dict:
        return {"decider": "laya", "url": self.url, "reachable": self.reachable(), "new_calls": self.calls,
                "cache_hits": self.hits, "cached_situations": len(self.cache),
                "seconds_in_laya": round(self.seconds, 1)}


def _laya_why(probs: dict[str, float]) -> str:
    return "Laya: " + ", ".join(f"{k} {v:.0%}" for k, v in sorted(probs.items(), key=lambda x: -x[1]))


def make_decider(kind: str = "auto", **kw) -> RuleDecider | LayaDecider:
    """'rules', 'laya', or 'auto' (Laya when the sidecar answers its health check)."""
    if kind == "rules":
        return RuleDecider()
    d = LayaDecider(**kw)
    if kind == "auto" and not d.reachable():
        return RuleDecider()
    return d
