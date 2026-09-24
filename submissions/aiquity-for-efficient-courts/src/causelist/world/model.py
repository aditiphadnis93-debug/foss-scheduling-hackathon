"""``TownWorld`` -- the L4 world model, an ``InflowSource`` for the simulator.

Story: people in a synthetic town owe each other money -> a payment is missed and the cheque
bounces -> legal notice -> negotiation (may settle) -> complaint filed -> a ``Case`` enters the
court at ADMISSION -> every hearing costs the parties a trip and a day's wages -> adjournments
raise frustration (some settle) -> judgement resolves the dispute and moves the money.

Randomness comes from the world's own ``random.Random(seed)``, so the world is deterministic
for a seed and never perturbs the simulator's random stream.
"""
from __future__ import annotations

import math
import random
import zlib
from collections import Counter
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Any, Iterable

from ..domain import Case, Event, HearingOutcome
from ..reference import STAGE_ORDER
from .config import WorldConfig, load_world_config
from .funnel import STAGES
from .town import COURT_XY, KIND_TEXT, Advocate, Person, Relationship, Town, build_town, synthetic_name

PERSON_STATES = ["calm", "in_dispute", "in_court", "resolved"]
_STATE_CODE = {s: i for i, s in enumerate(PERSON_STATES)}
# priority when a person is part of several disputes
_STATE_RANK = {"calm": 0, "resolved": 1, "in_dispute": 2, "in_court": 3}

# dispute states -> the person state they imply
DISPUTE_STATES = {
    "arisen": "in_dispute",
    "notice": "in_dispute",
    "negotiating": "in_dispute",
    "awaiting_filing": "in_dispute",
    "in_court": "in_court",
    "settled_in_court": "in_court",     # compromise reached; withdrawal not yet possible (see report)
    "settled_pre_court": "resolved",
    "dropped": "resolved",
    "judgement": "resolved",
    "withdrawn": "resolved",           # settled mid-trial, case taken off the docket
    "other_forum": "resolved",         # taken to another forum (resolved as far as this court goes)
}
# per-day funnel keys (court-heard kinds only): summary states, then the funnel stages
FUNNEL = ["arisen", "notice_sent", "settled_pre_court", "dropped", "filed", "in_court_now",
          "settled_in_court", "withdrawn", "judgement",
          "legal_notice", "paid_on_notice", "negotiation", "settled_in_negotiation", "complaint_filed",
          "reaches_court"]

ABSENT_ACCUSED = "Respondent Absence / Non-Compliance"
ABSENT_COMPLAINANT = "Petitioner Absence / Non-Compliance"
ABSENT_BOTH = "Both Parties Unready / Absent"


@dataclass
class Dispute:
    did: str
    kind: str
    complainant: str
    accused: str
    amount: float
    started: date
    state: str = "arisen"
    origin: str = "world"           # "world" (arose in the town) | "roster" (adopted docket case)
    rid: int | None = None
    relationship: str | None = None   # the town link it grew out of (lender_borrower, ...)
    case_id: str | None = None
    advocate_id: str | None = None
    filed_on: date | None = None
    court_stage: str | None = None
    hearings: int = 0
    adjournments: int = 0
    frustration: float = 0.0
    resolved_on: date | None = None
    resolution: str | None = None
    plan: list[tuple[date, str]] = field(default_factory=list)   # future pre-court milestones
    event_idx: list[int] = field(default_factory=list)

    @property
    def active_pre_court(self) -> bool:
        return self.state in ("arisen", "notice", "negotiating", "awaiting_filing")


def _poisson(rng: random.Random, lam: float) -> int:
    if lam <= 0:
        return 0
    l, k, p = math.exp(-lam), 0, 1.0
    while True:
        p *= rng.random()
        if p <= l:
            return k
        k += 1


def _money(v: float) -> str:
    return f"{v:,.0f}"


class TownWorld:
    """Synthetic town that files complaints into the court and reacts to hearing outcomes."""

    name = "town_world"

    def __init__(self, seed: int = 42, config: str | dict | WorldConfig | None = None,
                 roster: Iterable[Case] | None = None) -> None:
        self.seed = seed
        self.cfg = load_world_config(config)
        self.rng = random.Random(seed)
        roster = list(roster) if roster is not None else []
        population = self.cfg.population
        if roster and self.cfg.adopt_roster:
            population = max(population, int(2.2 * len(roster)))
        self.town: Town = build_town(self.rng, population, tuple(self.cfg.household_size),
                                     self.cfg.businesses, self.cfg.advocates)
        self.people = self.town.people
        self.advocates: dict[str, Advocate] = {a.aid: a for a in self.town.advocates}
        self.disputes: dict[str, Dispute] = {}
        self.by_case: dict[str, str] = {}
        self.events: list[dict[str, Any]] = []
        self.history: dict[date, dict[str, Any]] = {}
        self.filed_on_day: Counter = Counter()
        self.withdrawal_intents: list[dict[str, Any]] = []
        self._pending: list[Case] = []
        self._party_map: dict[str, str] = {}
        self._party_used: set[str] = set()
        self._first_day: date | None = None
        self._clock: date | None = None          # last calendar day the world has lived
        self._current: date | None = None        # sitting day currently in progress
        self._case_seq = 0
        self.funnel = self.cfg.funnel
        self.court_kinds = [k.kind for k in self.funnel.kinds.values() if k.this_court]
        self.stage_log: list[tuple[str, str, str]] = []
        self.stage_counts: Counter = Counter()
        self._rels_by_kind: dict[str, list[Relationship]] = {}
        for r in self.town.relationships:
            self._rels_by_kind.setdefault(r.kind, []).append(r)
        if roster and self.cfg.adopt_roster:
            self.adopt(roster)

    # ------------------------------------------------------------------ helpers
    def person(self, pid: str) -> Person:
        return self.town.person(pid)

    def _emit(self, day: date, kind: str, text: str, dispute: Dispute | None = None,
              people: list[str] | None = None, **data: Any) -> None:
        ev = {"day": day.isoformat(), "kind": kind, "text": text,
              "dispute_id": dispute.did if dispute else None,
              "case_id": dispute.case_id if dispute else None,
              "people": people or ([dispute.complainant, dispute.accused] if dispute else []), **data}
        if dispute is not None:
            dispute.event_idx.append(len(self.events))
        self.events.append(ev)

    def _pick_advocate(self, near: Person) -> Advocate:
        pool = sorted(self.advocates.values(), key=lambda a: a.aid)
        w = [1.0 / (1.0 + math.hypot(a.x - near.x, a.y - near.y) / 10) + 0.01 * a.matters for a in pool]
        return self.rng.choices(pool, weights=w)[0]

    def _new_dispute(self, kind: str, creditor: str, debtor: str, amount: float, day: date,
                     origin: str = "world", rid: int | None = None) -> Dispute:
        d = Dispute(f"D-{len(self.disputes) + 1:05d}", kind, creditor, debtor, round(amount, -2), day,
                    origin=origin, rid=rid)
        self.disputes[d.did] = d
        for pid in (creditor, debtor):
            self.person(pid).disputes.append(d.did)
        return d

    # ------------------------------------------------------------------ adoption
    def _person_for_party(self, key: str) -> str:
        if key not in self._party_map:
            n = len(self.people)
            i = zlib.crc32(key.encode()) % n
            while self.people[i].pid in self._party_used and len(self._party_used) < n:
                i = (i + 1) % n
            self._party_map[key] = self.people[i].pid
            self._party_used.add(self.people[i].pid)
        return self._party_map[key]

    def _adopt_advocate(self, aid: str) -> None:
        if aid and aid not in self.advocates:
            h = zlib.crc32(aid.encode())
            ang, dist = (h % 360) * math.pi / 180, 20 + (h >> 9) % 120
            self.advocates[aid] = Advocate(aid, "Adv. " + synthetic_name(random.Random(h)),
                                           round(COURT_XY[0] + dist * math.cos(ang), 1),
                                           round(COURT_XY[1] + dist * math.sin(ang), 1), adopted=True)

    def adopt(self, cases: Iterable[Case]) -> None:
        """Map pre-existing docket cases onto synthetic people/advocates so the board shows them."""
        for c in sorted(cases, key=lambda c: c.case_id):
            if c.case_id in self.by_case:
                continue
            self._adopt_advocate(c.advocate_id)
            comp = self._person_for_party(c.party_id)
            acc = self._person_for_party("accused:" + c.case_id)
            kind = self.rng.choices(self.court_kinds,
                                    weights=[self.funnel.kinds[k].per_1000_per_year for k in self.court_kinds])[0]
            amount = self.person(acc).wage * self.rng.uniform(20, 150)
            d = self._new_dispute(kind, comp, acc, amount, c.filing_date - timedelta(days=45), origin="roster")
            d.state, d.case_id, d.advocate_id = "in_court", c.case_id, c.advocate_id
            d.relationship = self.funnel.kinds[kind].relationship
            d.filed_on, d.court_stage = c.filing_date, c.stage
            self.by_case[c.case_id] = d.did
            if c.advocate_id in self.advocates:
                self.advocates[c.advocate_id].matters += 1
            self._emit(c.filing_date, "adopted",
                       f"Pending docket case {c.case_id} (stage {c.stage}) mapped to {self.person(comp).name} "
                       f"v. {self.person(acc).name}", d)

    def _adopt_unknown(self, case_id: str, stage: str, day: date) -> Dispute:
        comp = self._person_for_party("party:" + case_id)
        acc = self._person_for_party("accused:" + case_id)
        d = self._new_dispute(self.court_kinds[0], comp, acc, self.person(acc).wage * 60,
                              day, origin="roster")
        d.state, d.case_id = "in_court", case_id
        d.court_stage = stage if stage in STAGE_ORDER else None
        self.by_case[case_id] = d.did
        return d

    # ------------------------------------------------------------------ pre-court lifecycle
    def _stage(self, d: Dispute, day: date, stage: str) -> None:
        """Count a dispute passing a funnel stage (drives the observed funnel)."""
        self.stage_log.append((day.isoformat(), d.kind, stage))
        self.stage_counts[(d.kind, stage)] += 1

    def _plan(self, kind: str, day: date) -> tuple[list[tuple[date, str]], date]:
        """Pre-sample every pre-court milestone from the funnel's conversion rates."""
        c, k = self.cfg, self.funnel.kinds[kind]
        p, r = k.stages, self.rng
        if r.random() >= p["legal_notice"]:
            end = day + timedelta(days=r.randint(10, 40))
            return [(end, "drop_quiet")], end
        notice = day + timedelta(days=r.randint(*c.notice_delay_days))
        plan = [(notice, "notice")]
        if r.random() < p["paid_on_notice"]:
            paid = notice + timedelta(days=r.randint(2, max(2, c.notice_period_days)))
            return plan + [(paid, "paid")], paid
        t = notice + timedelta(days=c.notice_period_days)
        plan.append((t, "expired"))
        if r.random() < p["negotiation"]:
            t = t + timedelta(days=r.randint(1, 10))
            plan.append((t, "negotiating"))
            if r.random() < p["settled_in_negotiation"]:
                t2 = t + timedelta(days=r.randint(3, 20))
                return plan + [(t2, "settle_neg")], t2
        if r.random() < p["complaint_filed"]:
            f = t + timedelta(days=r.randint(*c.file_delay_days))
            if k.this_court:
                step = "file" if r.random() < p["reaches_court"] else "returned"
            else:
                step = "other_forum"
            return plan + [(f, step)], f
        end = t + timedelta(days=r.randint(5, 30))
        return plan + [(end, "drop")], end

    def _parties(self, kind: str) -> Relationship | None:
        """Pick (or create) the relationship a new dispute of ``kind`` grows out of."""
        k = self.funnel.kinds[kind]
        rel_kind = k.relationship or kind
        free = [r for r in self._rels_by_kind.get(rel_kind, []) if not r.busy]
        if free:
            w = [1.0 / max(200.0, self.person(r.debtor).wage) for r in free]   # poorer debtors default more
            return self.rng.choices(free, weights=w)[0]
        # no free pre-built link (or kinds without one): two people who plausibly know each other
        a = self.rng.choice(self.people)
        if kind == "family_property":
            pool = [p for p in self.people if p.household == a.household and p.pid != a.pid]
        else:
            pool = []
        pool = pool or [p for p in self.people if p.neighbourhood == a.neighbourhood and p.pid != a.pid]
        if not pool:
            return None
        b = self.rng.choice(pool)
        scale = {"family_property": b.wage * self.rng.uniform(50, 400), "other": b.wage * self.rng.uniform(5, 40)
                 }.get(kind, b.wage * self.rng.uniform(20, 120))
        rel = Relationship(len(self.town.relationships), rel_kind, a.pid, b.pid, round(scale, -2))
        self.town.relationships.append(rel)
        self._rels_by_kind.setdefault(rel_kind, []).append(rel)
        return rel

    def _spawn(self, day: date, kind: str) -> None:
        plan, exit_day = self._plan(kind, day)
        if self._first_day is not None and exit_day < self._first_day:
            return          # warm-up: finished before the window opens -> part of history, not modelled
        rel = self._parties(kind)
        if rel is None:
            return
        amount = rel.scale * self.rng.uniform(0.3, 1.0)
        rel.busy = True
        d = self._new_dispute(kind, rel.creditor, rel.debtor, amount, day, rid=rel.rid)
        d.relationship, d.plan = rel.kind, plan
        cred, debt = self.person(rel.creditor), self.person(rel.debtor)
        what, trigger = KIND_TEXT.get(rel.kind, ("knows", "a quarrel over money broke out"))
        self._stage(d, day, "arisen")
        self._emit(day, "quarrel", f"{cred.name} {what} {debt.name}; {trigger} ({_money(d.amount)} at stake)", d,
                   amount=d.amount)

    def _milestone(self, d: Dispute, day: date, step: str) -> None:
        comp, acc = self.person(d.complainant), self.person(d.accused)
        forum = self.funnel.kinds[d.kind].forum
        if step == "notice":
            d.state = "notice"
            self._stage(d, day, "legal_notice")
            self._emit(day, "legal_notice", f"{comp.name} sends a legal notice demanding {_money(d.amount)} "
                       f"within {self.cfg.notice_period_days} days", d)
        elif step == "paid":
            self._stage(d, day, "paid_on_notice")
            self._settle_money(d, d.amount)
            self._close(d, day, "settled_pre_court", f"{acc.name} pays {_money(d.amount)} on notice; settled without court",
                        stage="paid_on_notice")
        elif step == "expired":
            d.state = "awaiting_filing"
            self._emit(day, "notice_expired", f"Notice period over, {acc.name} has not paid", d)
        elif step == "negotiating":
            d.state = "negotiating"
            self._stage(d, day, "negotiation")
            self._emit(day, "negotiation", f"{comp.name} and {acc.name} try to settle", d)
        elif step == "settle_neg":
            self._stage(d, day, "settled_in_negotiation")
            paid = d.amount * self.cfg.compromise_share
            self._settle_money(d, paid)
            self._close(d, day, "settled_pre_court", f"{comp.name} and {acc.name} settle for {_money(paid)}",
                        stage="settled_in_negotiation")
        elif step in ("drop", "drop_quiet"):
            self._close(d, day, "dropped", f"{comp.name} gives up on the claim" if step == "drop"
                        else f"{comp.name} lets it go without a notice")
        elif step == "returned":
            self._stage(d, day, "complaint_filed")
            self._close(d, day, "dropped", f"{comp.name}'s complaint is returned at filing and not refiled",
                        event="complaint_returned")
        elif step == "other_forum":
            self._stage(d, day, "complaint_filed")
            self._close(d, day, "other_forum", f"{comp.name} takes the claim to the {forum}", event="other_forum")
        elif step == "file":
            self._stage(d, day, "complaint_filed")
            self._stage(d, day, "reaches_court")
            self._file(d, day)

    def _file(self, d: Dispute, day: date) -> None:
        comp = self.person(d.complainant)
        adv = self._pick_advocate(comp)
        adv.matters += 1
        self._case_seq += 1
        case_id = f"WST/{self._case_seq:04d}/{day.year}"
        d.state, d.case_id, d.advocate_id, d.filed_on, d.court_stage = "in_court", case_id, adv.aid, day, "ADMISSION"
        self.by_case[case_id] = d.did
        self._release(d)
        self._pending.append(Case(
            case_id=case_id, filing_number=f"TW-{self._case_seq:06d}-{day.year}", filing_date=day,
            advocate_id=adv.aid, party_id=d.complainant, stage="ADMISSION", purpose="ADMISSION",
            origin="world", meta={"dispute_id": d.did, "amount": d.amount, "kind": d.kind}))
        self._emit(day, "complaint_filed", f"{adv.name} files complaint {case_id} for {comp.name} "
                   f"against {self.person(d.accused).name}", d, advocate_id=adv.aid)

    def _release(self, d: Dispute) -> None:
        if d.rid is not None:
            self.town.relationships[d.rid].busy = False

    def _settle_money(self, d: Dispute, amount: float) -> None:
        self.person(d.complainant).balance += amount
        self.person(d.accused).balance -= amount

    def _close(self, d: Dispute, day: date, state: str, text: str, event: str | None = None, **data: Any) -> None:
        d.state, d.resolved_on, d.resolution, d.plan = state, day, event or data.get("stage") or state, []
        self._release(d)
        self._emit(day, event or state, text, d, **data)

    def _live_day(self, day: date) -> None:
        """One calendar day of town life (runs on non-sitting days too)."""
        for kind in self.funnel.kinds:
            for _ in range(_poisson(self.rng, self.funnel.arrivals_per_day(kind))):
                self._spawn(day, kind)
        for d in [d for d in self.disputes.values() if d.plan]:
            while d.plan and d.plan[0][0] <= day:
                _, step = d.plan.pop(0)
                self._milestone(d, day, step)

    # ------------------------------------------------------------------ InflowSource
    def new_filings(self, day: date, rng: random.Random | None = None) -> list[Case]:
        """Advance the town to ``day`` and hand over complaints filed since the last sitting."""
        if self._current is not None:
            self._record(self._current)
        if self._first_day is None:
            self._first_day = day
            self._clock = day - timedelta(days=self.cfg.warmup_days + 1)
        while self._clock < day:
            self._clock += timedelta(days=1)
            self._live_day(self._clock)
        self._current = day
        out, self._pending = self._pending, []
        for c in out:
            if c.filing_date < day:         # lodged on a non-sitting day: registered today
                c.filing_date = day
                self.disputes[c.meta["dispute_id"]].filed_on = day
        self.filed_on_day[day] = len(out)
        self.history.pop(day, None)
        return out

    def on_outcome(self, outcome: HearingOutcome) -> None:
        did = self.by_case.get(outcome.case_id)
        if did is None:
            if not self.cfg.adopt_roster:
                return
            d = self._adopt_unknown(outcome.case_id, outcome.purpose, outcome.day)
        else:
            d = self.disputes[did]
        day = outcome.day
        self.history.pop(day, None)
        comp, acc = self.person(d.complainant), self.person(d.accused)
        attend = []
        if outcome.reason not in (ABSENT_COMPLAINANT, ABSENT_BOTH):
            attend.append(comp)
        if outcome.reason not in (ABSENT_ACCUSED, ABSENT_BOTH) and outcome.kind != "not_ready":
            attend.append(acc)
        frac = self.cfg.wage_fraction_heard if outcome.kind == "substantive" else self.cfg.wage_fraction_waiting
        lost = 0.0
        for p in attend:
            p.trips += 1
            p.wages_lost += p.wage * frac
            lost += p.wage * frac
        adv = self.advocates.get(d.advocate_id or "")
        if adv:
            adv.trips += 1
        d.hearings += 1

        bump = {"adjourned": self.cfg.frustration_adjourned, "not_reached": self.cfg.frustration_not_reached,
                "not_ready": self.cfg.frustration_not_ready}.get(outcome.kind, -self.cfg.frustration_relief_heard)
        for p in (comp, acc):
            p.frustration = max(0.0, p.frustration + bump)
        d.frustration = max(0.0, d.frustration + bump)

        if outcome.kind == "substantive":
            if outcome.next_purpose in STAGE_ORDER:
                d.court_stage = outcome.next_purpose
            label = f"heard; next: {outcome.next_purpose}" if outcome.next_purpose else "judgement delivered"
        else:
            d.adjournments += 1
            label = outcome.kind.replace("_", " ") + (f" ({outcome.reason})" if outcome.reason else "")
        self._emit(day, "hearing", f"{outcome.purpose}: {label}; {len(attend)} travelled, "
                   f"{_money(lost)} wages lost", d, people=[p.pid for p in attend],
                   purpose=outcome.purpose, outcome=outcome.kind, reason=outcome.reason,
                   next_date=outcome.next_date.isoformat() if outcome.next_date else None,
                   wages_lost=round(lost, 1), advocate_id=d.advocate_id)

        if outcome.kind == "substantive" and outcome.next_purpose is None:
            if self.rng.random() < self.cfg.p_conviction:
                self._settle_money(d, d.amount)
                text = f"Judgement for {comp.name}: {acc.name} ordered to pay {_money(d.amount)}"
            else:
                text = f"Judgement: {acc.name} acquitted, {comp.name} recovers nothing"
            if d.state == "settled_in_court":
                text += " (the earlier compromise stands)"
            d.state, d.resolved_on, d.resolution = "judgement", day, "judgement"
            self._release(d)
            self._emit(day, "judgement", text, d)
        elif outcome.kind != "substantive" and d.state == "in_court":
            p = self.cfg.p_settle_per_frustration * d.frustration
            if self.rng.random() < p:
                paid = d.amount * self.cfg.compromise_share
                self._settle_money(d, paid)
                d.state = "settled_in_court"
                self.withdrawal_intents.append({"day": day.isoformat(), "case_id": d.case_id, "dispute_id": d.did})
                self._emit(day, "settled_in_court",
                           f"Worn out after {d.adjournments} adjournments, {acc.name} pays {_money(paid)}; "
                           f"{comp.name} wants to withdraw {d.case_id}", d)

    # ------------------------------------------------------------------ views
    def _person_states(self) -> list[int]:
        rank = [0] * len(self.people)
        for d in self.disputes.values():
            s = _STATE_RANK[DISPUTE_STATES[d.state]]
            for pid in (d.complainant, d.accused):
                i = int(pid.split("-")[1]) - 1
                if s > rank[i]:
                    rank[i] = s
        inv = {v: k for k, v in _STATE_RANK.items()}
        return [_STATE_CODE[inv[r]] for r in rank]

    def _funnel(self) -> dict[str, int]:
        f = Counter()
        court = set(self.court_kinds)
        for (kind, stage), n in self.stage_counts.items():
            if kind in court:
                f[stage] += n
        f["notice_sent"] = f["legal_notice"]
        f["settled_pre_court"] = f["paid_on_notice"] + f["settled_in_negotiation"]
        f["filed"] = f["reaches_court"]
        for d in self.disputes.values():
            if d.origin == "world" and d.kind in court:
                if d.state == "dropped":
                    f["dropped"] += 1
                elif d.state == "in_court":
                    f["in_court_now"] += 1
                elif d.state in ("settled_in_court", "withdrawn", "judgement"):
                    f[d.state] += 1
        return {k: f.get(k, 0) for k in FUNNEL}

    def observed_funnel(self, start: date | None = None, end: date | None = None) -> dict[str, dict[str, int]]:
        """Stage passages per kind with dates in [start, end] (whole history if omitted)."""
        lo = start.isoformat() if start else ""
        hi = end.isoformat() if end else "9999"
        out: dict[str, dict[str, int]] = {k: dict.fromkeys(STAGES, 0) for k in self.funnel.kinds}
        for day, kind, stage in self.stage_log:
            if lo <= day <= hi:
                out[kind][stage] += 1
        return out

    def _record(self, day: date) -> dict[str, Any]:
        states = Counter()
        pending_by_stage = Counter()
        origin_in_court = Counter()
        for d in self.disputes.values():
            states[f"{d.origin}:{d.state}"] += 1
            if d.state in ("in_court", "settled_in_court"):
                pending_by_stage[d.court_stage or "UNKNOWN"] += 1
                origin_in_court[d.origin] += 1
        rec = {
            "day": day.isoformat(),
            "person_state": self._person_states(),
            "trips": [p.trips for p in self.people],
            "wages_lost": [round(p.wages_lost, 1) for p in self.people],
            "frustration": [round(p.frustration, 2) for p in self.people],
            "funnel": self._funnel(),
            "disputes_by_state": dict(sorted(states.items())),
            "pending_by_stage": {s: pending_by_stage[s] for s in STAGE_ORDER + ["UNKNOWN"] if pending_by_stage[s]},
            "in_court_by_origin": dict(origin_in_court),
            "filed_today": self.filed_on_day.get(day, 0),
            "event_count": len(self.events),
            "withdrawal_intents": len(self.withdrawal_intents),
        }
        self.history[day] = rec
        return rec

    def _record_for(self, day: date) -> dict[str, Any] | None:
        if day in self.history:
            return self.history[day]
        if day == self._current:
            return self._record(day)
        earlier = [d for d in self.history if d <= day]
        return self.history[max(earlier)] if earlier else None

    def sitting_days(self) -> list[date]:
        days = set(self.history)
        if self._current:
            days.add(self._current)
        return sorted(days)

    def withdrawals(self, day: date) -> list[str]:
        """Cases whose parties settled out of court since the last call (simulator takes them off the docket)."""
        start = getattr(self, "_withdrawn_upto", 0)
        self._withdrawn_upto = len(self.withdrawal_intents)
        out = []
        for w in self.withdrawal_intents[start:]:
            d = self.disputes.get(w.get("dispute_id", ""))
            if not w.get("case_id") or d is None:
                continue
            out.append(w["case_id"])
            if d.state == "settled_in_court":
                d.state, d.resolved_on, d.resolution = "withdrawn", day, "withdrawn"
                self._release(d)
                self._emit(day, "withdrawn", f"{d.case_id} is withdrawn on the compromise and leaves the docket", d)
        return out

    def on_day_end(self, day: date) -> None:
        self._record(day)

    def snapshot(self, day: date) -> dict[str, Any]:
        """JSON-serialisable state of the town at the end of ``day`` (history is kept per sitting day)."""
        rec = self._record_for(day)
        if rec is None:
            rec = self._record(day)
        states = rec["person_state"]
        people = [{"id": p.pid, "name": p.name, "x": p.x, "y": p.y, "neighbourhood": p.neighbourhood,
                   "occupation": p.occupation, "wage": p.wage, "state": PERSON_STATES[states[i]],
                   "trips": rec["trips"][i], "wages_lost": rec["wages_lost"][i],
                   "frustration": rec["frustration"][i], "balance": round(p.balance, 1)}
                  for i, p in enumerate(self.people)]
        involved = [p for p in people if p["trips"] > 0]
        top = sorted(involved, key=lambda p: (-p["trips"], -p["wages_lost"], p["id"]))[:5]
        top_w = sorted(involved, key=lambda p: (-p["wages_lost"], -p["trips"], p["id"]))[:5]
        feed = [e for e in self.events[: rec["event_count"]] if e["kind"] not in ("hearing", "adopted")]
        feed = feed[-self.cfg.history_events:][::-1]
        return {
            "day": rec["day"],
            "people": people,
            "person_state_counts": dict(Counter(p["state"] for p in people)),
            "advocates": [{"id": a.aid, "name": a.name, "x": a.x, "y": a.y, "adopted": a.adopted}
                          for a in sorted(self.advocates.values(), key=lambda a: a.aid)],
            "court_xy": list(COURT_XY),
            "funnel": rec["funnel"],
            "disputes_by_state": rec["disputes_by_state"],
            "court": {"pending_by_stage": rec["pending_by_stage"], "filed_today": rec["filed_today"],
                      "in_court_by_origin": rec["in_court_by_origin"],
                      "withdrawal_intents": rec["withdrawal_intents"]},
            "top_by_trips": top,
            "top_by_wages_lost": top_w,
            "events": feed,
        }

    def series(self) -> list[dict[str, Any]]:
        """Per-sitting-day counts for time charts."""
        out = []
        for day in self.sitting_days():
            rec = self._record_for(day)
            c = Counter(PERSON_STATES[s] for s in rec["person_state"])
            out.append({"day": rec["day"], **{s: c.get(s, 0) for s in PERSON_STATES},
                        "filed_today": rec["filed_today"], "wages_lost": round(sum(rec["wages_lost"]), 1)})
        return out

    def as_sim_events(self) -> list[Event]:
        """World events in the simulator's ``Event`` shape (kind='world')."""
        return [Event(date.fromisoformat(e["day"]), "world", e["case_id"], dict(e)) for e in self.events]

    # ------------------------------------------------------------------ follow one dispute
    def dispute_for_case(self, case_id: str) -> Dispute | None:
        did = self.by_case.get(case_id)
        return self.disputes.get(did) if did else None

    def followable(self) -> list[Dispute]:
        """Disputes that arose in the town and reached the court, most hearings first."""
        ds = [d for d in self.disputes.values() if d.origin == "world" and d.case_id]
        return sorted(ds, key=lambda d: (-(d.state == "judgement"), -d.hearings, d.did))

    def follow(self, dispute_id: str, sim_events: Iterable[Event] | None = None) -> dict[str, Any]:
        """Full timeline of one dispute: first quarrel -> notice -> filing -> hearings -> resolution.

        Joins the world's own events with the simulator's ``SimResult.events`` for the case id.
        """
        d = self.disputes[dispute_id]
        rank = {"quarrel": 0, "legal_notice": 1, "negotiation": 2, "notice_expired": 3, "complaint_filed": 4,
                "adopted": 4, "filed": 5, "listed": 6, "agent_decision": 7, "hearing": 8, "outcome": 8,
                "settled_in_court": 9, "settled_pre_court": 9, "dropped": 9, "judgement": 10}
        rows = []
        heard_days = set()
        for i in d.event_idx:
            e = self.events[i]
            rows.append({"day": e["day"], "source": "world", "kind": e["kind"], "text": e["text"],
                         "outcome": e.get("outcome"), "reason": e.get("reason")})
            if e["kind"] == "hearing":
                heard_days.add(e["day"])
        if d.case_id and sim_events is not None:
            for ev in sim_events:
                if ev.case_id != d.case_id or ev.kind == "world":
                    continue
                day = ev.day.isoformat()
                if ev.kind == "filed":
                    text = f"Registered by the court at {ev.data.get('purpose', 'ADMISSION')}"
                elif ev.kind == "listed":
                    w = ev.data.get("window") or [None, None]
                    text = f"Listed in the '{ev.data.get('slot')}' slot, window +{w[0]}..+{w[1]} min"
                elif ev.kind == "agent_decision":
                    text = f"Party decision: {ev.data.get('rationale', '')}"
                elif ev.kind == "outcome":
                    if day in heard_days:
                        continue
                    text = f"Outcome: {ev.data.get('kind')}" + (f" ({ev.data['reason']})" if ev.data.get("reason") else "")
                else:
                    text = ev.kind
                rows.append({"day": day, "source": "court", "kind": ev.kind, "text": text,
                             "outcome": ev.data.get("kind"), "reason": ev.data.get("reason")})
        rows.sort(key=lambda r: (r["day"], rank.get(r["kind"], 8)))
        return {
            "dispute": {"id": d.did, "kind": d.kind, "origin": d.origin, "state": d.state,
                        "complainant": {"id": d.complainant, "name": self.person(d.complainant).name},
                        "accused": {"id": d.accused, "name": self.person(d.accused).name},
                        "amount": d.amount, "case_id": d.case_id, "advocate_id": d.advocate_id,
                        "started": d.started.isoformat(), "filed_on": d.filed_on.isoformat() if d.filed_on else None,
                        "court_stage": d.court_stage, "hearings": d.hearings, "adjournments": d.adjournments,
                        "resolved_on": d.resolved_on.isoformat() if d.resolved_on else None,
                        "resolution": d.resolution},
            "timeline": rows,
        }
