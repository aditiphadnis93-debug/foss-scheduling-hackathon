"""Agent behaviour inside the simulator: advocates and litigants act on the published causelist, the
judge rules on what happens in court, and everyone remembers.

Per sitting day `begin_day` builds every listed hearing's situations, asks the decider in one batch,
then samples the answers with the simulation's seeded rng. The simulator reads the result per case
through `attendance()`, and reports back through `after_hearing()` so the next day's situations carry
the memory (wasted trips, costs ordered, how much notice the next date gave).
"""
from __future__ import annotations

import random
from dataclasses import dataclass, field
from datetime import date

from scheduler.models import Case, JudgeConfig, Listing
from scheduler.next_date import GAP_BANDS

from .decide import Decision, RuleDecider
from .judge import judge_scorer, next_date_situation, ruling_situation, style_text
from .personas import advocate_trait, clash_chance, litigant_trait
from .situation import Situation, count_bucket, notice_bucket

LITIGANT_NEEDED = {"evidence"}  # hearings that cannot go ahead without the party (witness in the box)


@dataclass(frozen=True)
class Levers:
    """What the court does to shape behaviour. The status-quo baseline gets none of them."""
    windows: bool = True  # publish each hearing's appearance window (else "all day")
    reminders: bool = True  # SMS reminder with the hearing checklist
    cover_pages: bool = True  # enforce the judge's cover-page rule before listed purposes
    costs: bool = False  # the court orders costs for unjustified adjournments


@dataclass
class Attendance:
    showed: bool  # the hearing can go ahead
    prepared: bool  # and can move the case forward
    advocate: str
    litigant: str
    ruling: str
    why: str
    source: str


@dataclass
class Agents:
    decider: object = field(default_factory=RuleDecider)
    levers: Levers = field(default_factory=Levers)
    seed: int = 0
    log: list[dict] = field(default_factory=list)  # one row per agent decision, for the UI
    wasted_trips: dict[str, int] = field(default_factory=dict)  # party -> trips with no hearing
    costed: set[str] = field(default_factory=set)  # advocates ordered to pay costs
    booked_on: dict[str, date] = field(default_factory=dict)  # case -> day its next date was fixed
    _today: dict[str, Attendance] = field(default_factory=dict)

    # ------------------------------------------------------------ the judge
    def scorer(self):
        return judge_scorer(self.decider, self.log)

    def next_band(self, c: Case, day: date, cfg: JudgeConfig, outcome: str, rng: random.Random) -> tuple[str, str]:
        d = self.decider.decide([next_date_situation(c, day, style_text(cfg), outcome)])[0]
        band = d.sample(rng.random())
        self._log(day, "judge", band, d, c.id)
        return (band if band in GAP_BANDS else "ideal"), f"judge agent ({d.source}) chose a {band} gap"

    # ------------------------------------------------------------ a court day
    def begin_day(self, listings: list[Listing], by_id: dict[str, Case], day: date, cfg: JudgeConfig,
                  policy: str, rng: random.Random) -> None:
        on = policy != "baseline"
        lv = self.levers
        per_adv: dict[str, int] = {}
        for l in listings:
            per_adv[l.advocate] = per_adv.get(l.advocate, 0) + 1
        clash = {a: rng.random() < clash_chance(advocate_trait(a, self.seed)[0]) for a in sorted(per_adv)}

        adv_sits, lit_sits = [], []
        for l in listings:
            c = by_id[l.case_id]
            window = on and lv.windows and l.window not in ("", "all day")
            trait, persona = advocate_trait(l.advocate, self.seed)
            adv_sits.append(Situation.of(
                "advocate", trait=trait, persona=persona, purpose=c.purpose,
                # coarse on purpose: advocate situations are the most numerous, and each new one is a Laya call
                age="4y+" if c.age_years(day) >= 4 else "under 4y",
                adjournments="3+" if c.adjournment_count >= 3 else "0-2", window=window, reminder=on and lv.reminders,
                cover_page=on and lv.cover_pages and c.purpose in cfg.cover_page_for, clash=clash[l.advocate],
                same_court_matters=count_bucket(per_adv[l.advocate] - 1),
                costs_risk=(on and lv.costs) or l.advocate in self.costed, prereq_met=c.prerequisites_met))
            party = c.parties[0] if c.parties else f"{c.id}-P"
            ltrait, lpersona = litigant_trait(party, self.seed)
            booked = self.booked_on.get(c.id)
            lit_sits.append(Situation.of(
                "litigant", trait=ltrait, persona=lpersona, purpose=c.purpose, window=window,
                reminder=on and lv.reminders,
                notice=notice_bucket((day - booked).days if booked and c.next_date == day else 1),
                wasted_trips=count_bucket(self.wasted_trips.get(party, 0))))

        decisions = self.decider.decide(adv_sits + lit_sits)
        adv_d, lit_d = decisions[: len(listings)], decisions[len(listings):]

        style = style_text(cfg)
        self._today = {}
        pending: list[tuple[Listing, str, str, Decision, Decision]] = []
        for l, ad, ld in zip(listings, adv_d, lit_d):
            a, p = ad.sample(rng.random()), ld.sample(rng.random())
            self._log(day, "advocate", a, ad, l.case_id)
            self._log(day, "litigant", p, ld, l.case_id)
            pending.append((l, a, p, ad, ld))

        # The judge rules where counsel asks for time or is not ready: the L3 judge agent under `l3`,
        # the status-quo court (adjourn, or proceed with the unready) otherwise.
        asks = [(i, by_id[x[0].case_id], x[1]) for i, x in enumerate(pending) if x[1] in ("seek_adjournment", "unprepared")]
        rulings: dict[int, tuple[str, str]] = {}
        if policy == "l3" and asks:
            sits = [ruling_situation(c, day, style, "counsel asks for an adjournment" if a == "seek_adjournment"
                                     else "counsel is not prepared to argue", pending[i][0].advocate in self.costed)
                    for i, c, a in asks]
            for (i, c, a), d in zip(asks, self.decider.decide(sits)):
                r = d.sample(rng.random())
                self._log(day, "judge", r, d, c.id)
                rulings[i] = (r, f"judge agent ({d.source}): {r.replace('_', ' ')}")
        else:
            for i, c, a in asks:
                if a == "seek_adjournment":
                    r = "grant_with_costs" if on and self.levers.costs and c.adjournment_count >= 3 else "grant"
                else:
                    r = "refuse_proceed"
                rulings[i] = (r, f"court: {r.replace('_', ' ')}")

        for i, (l, a, p, ad, ld) in enumerate(pending):
            c = by_id[l.case_id]
            ruling, rwhy = rulings.get(i, ("", ""))
            if ruling == "grant_with_costs":
                self.costed.add(l.advocate)
            party_ok = p == "appear" or c.purpose not in LITIGANT_NEEDED
            if a == "absent":
                showed, prepared = False, False
            elif a in ("seek_adjournment", "unprepared"):
                showed, prepared = ruling == "refuse_proceed", False
            else:
                showed, prepared = True, True
            showed = showed and party_ok
            why = f"advocate {a.replace('_', ' ')} ({ad.why}); litigant {p.replace('_', ' ')} ({ld.why})"
            if rwhy:
                why += f"; {rwhy}"
            if not party_ok:
                why += "; evidence cannot proceed without the party"
            self._today[l.case_id] = Attendance(showed, prepared, a, p, ruling, why,
                                                ad.source if ad.source == ld.source else f"{ad.source}/{ld.source}")

    def attendance(self, case_id: str) -> Attendance:
        return self._today[case_id]

    def after_hearing(self, c: Case, day: date, heard: bool) -> None:
        att = self._today.get(c.id)
        party = c.parties[0] if c.parties else f"{c.id}-P"
        if att and att.litigant == "appear" and not heard:
            self.wasted_trips[party] = self.wasted_trips.get(party, 0) + 1
        if c.next_date:
            self.booked_on[c.id] = day

    def _log(self, day: date, agent: str, choice: str, d: Decision, case_id: str) -> None:
        self.log.append({"day": day, "agent": agent, "decision": choice, "p": d.probs.get(choice, 0.0),
                         "source": d.source, "why": d.why, "case_id": case_id})
