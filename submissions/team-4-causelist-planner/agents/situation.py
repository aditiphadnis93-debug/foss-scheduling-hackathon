"""What an agent knows when it decides, rounded into buckets so identical situations share one decision.

A `Situation` is the cache key for Laya and the input to the rule fallback. `to_state()` renders it as
the JSON state Laya reads: the facts plus a plain-English narrative of them.
"""
from __future__ import annotations

from dataclasses import dataclass

# role -> (instructions, {option: what it means}). Laya answers each as a `choice` with per-option
# probabilities (a `noul` question can follow its option labels instead of the state; see Laya #156).
QUESTIONS: dict[str, tuple[str, dict[str, str]]] = {
    "judge_list": (
        "You are the judge described in the state. Given your way of working and this case, "
        "do you list the case on tomorrow's causelist?",
        {"list_today": "list it: it should be heard now",
         "defer": "leave it for another day"},
    ),
    "judge_rule": (
        "You are the judge described in the state, in open court. How do you rule on this request?",
        {"grant": "adjourn the hearing without costs",
         "refuse_proceed": "refuse and proceed with the hearing now",
         "grant_with_costs": "adjourn but impose costs on the party that caused it"},
    ),
    "judge_next": (
        "You are the judge described in the state, fixing the next date after this hearing. "
        "How long a gap do you give?",
        {"short": "the shortest gap the procedure allows",
         "ideal": "the usual gap for the next step",
         "long": "a long gap"},
    ),
    "advocate": (
        "You are the advocate described in the state. What do you do about this listed hearing?",
        {"ready": "appear on time, prepared to argue",
         "unprepared": "appear but not prepared, so the hearing will not move the case",
         "seek_adjournment": "ask the court for an adjournment",
         "absent": "do not appear"},
    ),
    "litigant": (
        "You are the litigant described in the state. Do you travel to court for this hearing?",
        {"appear": "go to court for the hearing",
         "stay_away": "do not go"},
    ),
}


@dataclass(frozen=True)
class Situation:
    role: str
    facts: tuple[tuple[str, object], ...]

    @classmethod
    def of(cls, role: str, **facts: object) -> Situation:
        return cls(role, tuple(sorted(facts.items())))

    @property
    def f(self) -> dict[str, object]:
        return dict(self.facts)

    def key(self) -> str:
        return self.role + "|" + "|".join(f"{k}={v}" for k, v in self.facts)

    def to_state(self) -> dict:
        return {"situation": narrative(self), **{k: v for k, v in self.facts if k != "style"}}


# ---------------------------------------------------------------- buckets

def adj_bucket(n: int) -> str:
    return "none" if n == 0 else "1-2" if n <= 2 else "3-5" if n <= 5 else "6+"


def count_bucket(n: int) -> str:
    return "none" if n == 0 else "1-2" if n <= 2 else "3+"


def days_bucket(days: int | None) -> str:
    if days is None:
        return "never"
    return "under a month" if days < 30 else "1-6 months" if days < 180 else "over 6 months"


def notice_bucket(days: int | None) -> str:
    if days is None:
        return "unknown"
    return "under a week" if days < 7 else "1-4 weeks" if days <= 30 else "over a month"


# ---------------------------------------------------------------- narratives

def _p(purpose: object) -> str:
    return str(purpose).replace("_", " ")


def narrative(s: Situation) -> str:
    f = s.f
    if s.role == "judge_list":
        return (f"Judge's way of working: {f['style']} "
                f"The case is {f['age']} old, next for {_p(f['purpose'])}, adjourned {f['adjournments']} times, "
                f"last heard {f['since_heard']}{' ago' if f['since_heard'] != 'never' else ''}. "
                f"{'It is marked urgent. ' if f['urgent'] else ''}{'It is a fresh matter. ' if f['fresh'] else ''}"
                f"Its advocate has {f['advocate_matters']} other matters that could be heard the same day.")
    if s.role == "judge_rule":
        return (f"Judge's way of working: {f['style']} "
                f"In a {_p(f['purpose'])} hearing of a case {f['age']} old, adjourned {f['adjournments']} times, "
                f"{f['request']}. "
                f"{'This advocate has been ordered to pay costs before. ' if f['costed_before'] else ''}")
    if s.role == "judge_next":
        return (f"Judge's way of working: {f['style']} "
                f"Today's hearing: {f['outcome']}. The next hearing is for {_p(f['purpose'])}. "
                f"The case is {f['age']} old and has been adjourned {f['adjournments']} times.")
    if s.role == "advocate":
        return (f"You are {f['persona']}. Your client's case, {f['age']} old and adjourned {f['adjournments']} times, "
                f"is listed for {_p(f['purpose'])}. "
                + ("You were given a one-hour appearance window. " if f["window"]
                   else "No time is given: the matter could be called any time in the day. ")
                + ("You received a reminder with the hearing checklist. " if f["reminder"] else "")
                + ("The judge requires a cover page summarising the agreed facts before this hearing. "
                   if f["cover_page"] else "")
                + ("You have another matter in a different courtroom at the same time. " if f["clash"] else "")
                + (f"You have {f['same_court_matters']} other matters in this courtroom today. "
                   if f["same_court_matters"] != "none" else "")
                + ("This court orders costs for unjustified adjournments. " if f["costs_risk"] else "")
                + ("" if f["prereq_met"] else "A step the hearing depends on (e.g. service of notice) is still pending. "))
    if s.role == "litigant":
        return (f"You are {f['persona']}. Your case is listed for {_p(f['purpose'])}; you heard about it {f['notice']} "
                f"ahead. "
                + ("You were given a one-hour window for the hearing. " if f["window"]
                   else "No time is given: you may wait all day. ")
                + ("You received an SMS reminder telling you what to bring. " if f["reminder"] else "")
                + (f"On {f['wasted_trips']} earlier trips your case was not heard. "
                   if f["wasted_trips"] != "none" else ""))
    raise ValueError(f"unknown role {s.role}")
