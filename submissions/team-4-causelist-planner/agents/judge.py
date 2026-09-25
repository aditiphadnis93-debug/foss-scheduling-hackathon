"""The judge agent: lists cases, rules on adjournment requests, fixes the next-date gap.

Listing replaces stage 2 (scoring) only. The rule score pre-ranks the eligible pool and keeps a
shortlist of about twice what the day can hold; the judge agent's P(list today) then orders that
shortlist. Booked cases, the starvation guard and the locked ageing quota are placed by `assign`
before any score is read, and the listing-factor ceiling bounds the day, so the agent cannot
break a locked rule however it answers.
"""
from __future__ import annotations

from datetime import date

from scheduler.capacity import block_budget, expected_cost
from scheduler.models import Case, JudgeConfig
from scheduler.scoring import score

from .decide import Decision
from .situation import Situation, adj_bucket, count_bucket, days_bucket

SHORTLIST_FACTOR = 2.0  # shortlist ≈ twice the day's expected-minute budget


def style_text(cfg: JudgeConfig) -> str:
    """The judge's own words, else a description built from their preset."""
    if cfg.style:
        return cfg.style
    parts = [f"{b.name} {b.start:%H:%M}-{b.end:%H:%M} for {', '.join(p.replace('_', ' ') for p in b.purposes)}"
             for b in cfg.blocks]
    extra = [s for s, on in [("I group an advocate's matters together.", cfg.clustering),
                             ("Unheard cases roll to the same weekday next week.", cfg.rollover)] if on]
    return "My day: " + "; ".join(parts) + ". " + " ".join(extra)


def listing_situation(c: Case, day: date, style: str, advocate_matters: int) -> Situation:
    since = (day - c.last_heard).days if c.last_heard else None
    return Situation.of("judge_list", style=style, purpose=c.purpose, age=c.age_bucket(day),
                        adjournments=adj_bucket(c.adjournment_count), since_heard=days_bucket(since),
                        urgent=c.urgent, fresh=c.is_fresh(day), advocate_matters=count_bucket(advocate_matters))


def ruling_situation(c: Case, day: date, style: str, request: str, costed_before: bool) -> Situation:
    return Situation.of("judge_rule", style=style, purpose=c.purpose, age=c.age_bucket(day),
                        adjournments=adj_bucket(c.adjournment_count), request=request,
                        costed_before=costed_before)


def next_date_situation(c: Case, day: date, style: str, outcome: str) -> Situation:
    return Situation.of("judge_next", style=style, purpose=c.purpose, age=c.age_bucket(day),
                        adjournments=adj_bucket(c.adjournment_count), outcome=outcome)


def judge_scorer(decider, log: list[dict] | None = None):
    """A `scheduler.assign.Scorer` that asks the judge agent. `log` collects one row per decision."""

    def scorer(pool: list[Case], day: date, cfg: JudgeConfig) -> dict[str, tuple[float, list[str]]]:
        rule = {c.id: score(c, day, cfg) for c in pool}
        ranked = sorted(pool, key=lambda c: (-rule[c.id][0], c.filing_date))
        budget = SHORTLIST_FACTOR * sum(block_budget(b, cfg) for b in cfg.blocks_on(day))
        shortlist, used = [], 0.0
        for c in ranked:
            if used >= budget:
                break
            shortlist.append(c)
            used += expected_cost(c)
        per_adv: dict[str, int] = {}
        for c in shortlist:
            per_adv[c.advocate_ids[0]] = per_adv.get(c.advocate_ids[0], 0) + 1
        style = style_text(cfg)
        sits = [listing_situation(c, day, style, per_adv[c.advocate_ids[0]] - 1) for c in shortlist]
        decisions: list[Decision] = decider.decide(sits)

        out: dict[str, tuple[float, list[str]]] = {}
        for c, d in zip(shortlist, decisions):
            p = d.probs["list_today"]
            out[c.id] = (round(100 * p + rule[c.id][0] / 1000, 3),
                         [f"judge agent ({d.source}): list today {p:.0%} — {d.why}"] + rule[c.id][1])
            if log is not None:
                log.append({"day": day, "agent": "judge", "decision": "list" if p >= 0.5 else "defer",
                            "p": p, "source": d.source, "why": d.why, "case_id": c.id})
        for c in ranked[len(shortlist):]:
            out[c.id] = (rule[c.id][0] / 1000 - 1, ["not on the judge's shortlist"] + rule[c.id][1])
        return out

    return scorer
