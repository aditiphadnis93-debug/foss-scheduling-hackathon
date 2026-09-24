"""L3 behaviour: every case is driven by two agents -- its advocate and its litigant.

``AgentBehaviour`` implements the ``Behaviour`` protocol:

* ``readiness_signal`` -- before listing, the court asks the advocate of every due matter to
  confirm preparedness. Each advocate agent decides; a confirmation sets
  ``case.confirmed_ready`` and the returned probability is the agent model's own
  P(hearing goes ahead), which the planner uses instead of the statistical estimate.
* ``decide`` -- on the day: does the side turn up, is it ready, does counsel seek time?
* ``observe`` -- memory: wasted trips, adjournments suffered, honoured appointments,
  kept / broken confirmations. Behaviour drifts with that memory.

Engines:

* ``rules``  -- transparent utility model (``rules.py``). Always available, no network;
  the default for tests and scorecards.
* ``sarvam`` -- an LLM decides for the people. To keep a whole simulation practical the
  calls are *batched*: in ``readiness_signal`` the day's due matters are sent in batches
  (``batch_size``, default 12) with at most 4 requests in flight. Each reply gives, per
  case, the advocate's confirmation answer plus probabilities for appearing / being ready /
  seeking time if the matter is called, a reason label, the expected minutes if heard, and a
  short rationale. ``decide`` then samples from those probabilities with the simulation rng,
  so outcomes are stochastic but reproducible. Calls are capped by ``budget`` (default 60 per
  run); anything missing, malformed, over budget or failed falls back to rules for that case.

Deterministic for a given seed; LLM replies are cached so replays are offline.
"""
from __future__ import annotations

import atexit
import json
import random
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any

import httpx

from ..behaviour import ABSENCE_REASONS, SOUGHT_TIME, conditional_probs
from ..domain import Case, HearingOutcome
from ..interfaces import AttendanceDecision, HearingContext
from ..reference import REASON_GROUPS, HearingType, load_hearing_types
from . import rules
from .engines import ResponseCache, SarvamClient, warn_once
from .personas import AdvocatePersona, LitigantPersona, make_advocate, make_litigant, stable_uniform

ENGINES = ("rules", "sarvam")
TRAVEL_KMPH = 20.0
TRAVEL_COST_PER_KM = 3.0         # rupees, one way
WORK_HOURS = 8.0
DAY_HOURS = 7.0                  # a matter never reached keeps people in court all day
ALL_REASONS = [r for grp in REASON_GROUPS.values() for r in grp]

# Sane ranges for model-supplied probabilities / durations.
P_APPEAR_RANGE = (0.05, 0.99)
P_SEEK_RANGE = (0.0, 0.8)
P_READY_RANGE = (0.5, 1.0)
MINUTES_RANGE = (1.0, 240.0)


@dataclass
class AgentDecision(AttendanceDecision):
    minutes: float | None = None     # model's estimate of how long the hearing would run if heard


def _clamp(x: Any, lo: float, hi: float) -> float | None:
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    if v != v:  # NaN
        return None
    return min(hi, max(lo, v))


def wait_hours(ctx: HearingContext, reached: bool) -> float:
    if not reached:
        return DAY_HOURS
    l = ctx.listing
    if ctx.was_given_appointment:
        return max(0.5, (l.end_min - l.start_min) / 60.0)
    return min(DAY_HOURS, l.start_min / 60.0 + 0.5)


REASON_CODES = {i + 1: r for i, r in enumerate(ALL_REASONS)}
OUTCOME_CODES = {"R": "ready", "S": "seeks time", "A": "absent", "N": "not ready"}
SIDE_CODES = {"L": "litigant", "V": "advocate", "B": "both"}

# Compact reply schema: the model writes ~50 tokens a second, so short keys keep a batch of
# a dozen matters well inside the request timeout.
SARVAM_SYSTEM = (
    "You simulate the people behind matters listed in a district criminal court (cheque-dishonour trials): "
    "for each matter, its advocate and its litigant, whose traits and experience are given. The court has asked "
    "each advocate to confirm preparedness before listing. Anchor on each matter's reference_rates (population "
    "averages) and move away from them only for reasons visible in the traits, memory and situation. "
    "Reply with compact JSON on one line, no code fences, nothing else: "
    '{"d":[{...one object per matter...}]}. Each object has exactly these keys: '
    '"id" (the case_id, copied), '
    '"c" (1 if the advocate confirms preparedness, else 0), '
    '"attend" (probability 0-1 that the needed side TURNS UP if called today; high = likely present; '
    'reference: 1 - reference_rates.p_absent), '
    '"ask_time" (probability 0-1 that counsel asks for time or an adjournment, given they turn up), '
    '"prepared" (probability 0-1 that they are prepared to proceed, given they turn up and do not ask for time), '
    '"o" (the single most likely outcome, consistent with the probabilities: "R" ready, "S" seeks time, '
    '"A" absent, "N" present but not ready), '
    '"side" (who would be absent: "L" litigant, "V" advocate, "B" both, or null), '
    '"r" (reason code if it does not go ahead, else null: '
    + "; ".join(f"{i} = {r}" for i, r in REASON_CODES.items()) + "), "
    '"m" (minutes this hearing would really take if it goes ahead), '
    '"why" (rationale, at most 15 words). Example: '
    '{"d":[{"id":"X/1/2020","c":1,"attend":0.85,"ask_time":0.1,"prepared":0.95,"o":"R","side":null,'
    '"r":null,"m":25,"why":"diligent counsel confirmed; litigant lives close and still trusts the court"}]}. '
    )


class AgentBehaviour:
    def __init__(self, engine: str = "rules", seed: int = 42, *, ask_confirmation: bool = True,
                 appointments: bool = True, neutral: bool = False, budget: int = 60, batch_size: int = 12,
                 cache_path: str | Path | None = None, read_only_cache: bool = False,
                 transport: httpx.BaseTransport | None = None, sarvam_model: str | None = None,
                 reasoning_effort: str | None = None):
        if engine not in ENGINES:
            raise ValueError(f"engine must be one of {ENGINES}")
        self.engine = engine
        self.name = f"agents-{engine}"
        self.seed = seed
        self.ask_confirmation = ask_confirmation
        self.appointments = appointments      # what the court promises when asking (time windows or not)
        self.neutral = neutral
        self.budget = budget if engine == "sarvam" else 0
        self.batch_size = max(1, batch_size)
        self.calls_used = 0                    # LLM batches issued (cache hits included -> replay-stable)
        self.fallbacks = 0
        self.advocates: dict[str, AdvocatePersona] = {}
        self.litigants: dict[str, LitigantPersona] = {}
        self.adv_mem: dict[str, rules.AdvocateMemory] = {}
        self.lit_mem: dict[str, rules.LitigantMemory] = {}
        self.decisions: list[dict[str, Any]] = []
        self.observations: list[dict[str, Any]] = []
        self._pending: dict[tuple[str, date], dict[str, Any]] = {}
        self._llm: dict[tuple[str, date], dict[str, Any]] = {}
        self._types: dict[str, HearingType] | None = None
        self._ref_absent: float | None = None
        self.client: SarvamClient | None = None
        if engine == "sarvam":
            self.client = SarvamClient(ResponseCache(cache_path, read_only=read_only_cache), transport,
                                       model=sarvam_model, reasoning_effort=reasoning_effort)
            if not self.client.available:
                warn_once("nokey-sarvam", f"{self.client.key_env} not set: sarvam engine replays cached replies "
                                          f"where present and uses the rules model otherwise")
            atexit.register(self.client.cache.flush)

    # ---------------------------------------------------------------- people
    def advocate(self, advocate_id: str) -> AdvocatePersona:
        if advocate_id not in self.advocates:
            self.advocates[advocate_id] = make_advocate(advocate_id, self.seed, self.neutral)
            self.adv_mem[advocate_id] = rules.AdvocateMemory()
        return self.advocates[advocate_id]

    def litigant(self, party_id: str) -> LitigantPersona:
        if party_id not in self.litigants:
            self.litigants[party_id] = make_litigant(party_id, self.seed, self.neutral)
            self.lit_mem[party_id] = rules.LitigantMemory()
        return self.litigants[party_id]

    def _prop(self, case: Case, ht: HearingType, appt: bool, confirmed: bool | None = None) -> rules.Propensity:
        a, l = self.advocate(case.advocate_id), self.litigant(case.party_id)
        return rules.propensity(case, ht, appt, a, l, self.adv_mem[a.advocate_id], self.lit_mem[l.party_id], confirmed)

    def types(self) -> dict[str, HearingType]:
        if self._types is None:
            self._types = load_hearing_types()
        return self._types

    def ref_absent(self) -> float:
        """Typical statistical absence rate (mean over hearing types), for the drift series."""
        if self._ref_absent is None:
            vals = [conditional_probs(ht)["absent"] for ht in self.types().values()]
            self._ref_absent = sum(vals) / len(vals)
        return self._ref_absent

    # ---------------------------------------------------------------- protocol
    def readiness_signal(self, cases: list[Case], day: date) -> dict[str, float]:
        types = self.types()
        due = [c for c in cases if c.purpose in types]
        if self.client is not None:
            self._llm_batch(due, day)
        if not self.ask_confirmation:
            return {}
        out: dict[str, float] = {}
        for case in due:
            ht = types[case.purpose]
            llm = self._llm.get((case.case_id, day))
            if llm is not None and llm.get("confirm") is not None:
                case.confirmed_ready = bool(llm["confirm"])
                out[case.case_id] = round(min(0.98, max(0.05, llm["p_ahead"])), 2)
                continue
            pr0 = self._prop(case, ht, self.appointments, confirmed=False)
            a = self.advocates[case.advocate_id]
            pc = rules.p_confirm(pr0, a, self.adv_mem[a.advocate_id])
            confirmed = stable_uniform("confirm", self.seed, case.case_id, day) < pc
            case.confirmed_ready = confirmed
            # rounded: coarse probabilities keep the MILP quick without changing its choices materially
            out[case.case_id] = round(self._prop(case, ht, self.appointments, confirmed).p_goes_ahead, 2)
        return out

    def decide(self, ctx: HearingContext, rng: random.Random) -> AttendanceDecision:
        pr = self._prop(ctx.case, ctx.hearing_type, ctx.was_given_appointment)
        dec: AgentDecision | None = None
        lit_attended: bool | None = None
        llm = self._llm.get((ctx.case.case_id, ctx.day))
        if llm is not None:
            dec, lit_attended = self._sample_llm(ctx, llm, rng)
        elif self.client is not None:
            self.fallbacks += 1
        if dec is None:
            dec, lit_attended = self._rules_decide(ctx, pr, rng)
            if self.client is not None:
                dec.rationale += " [rules fallback]"
        self._record(ctx, pr, dec, bool(lit_attended), llm)
        return dec

    def observe(self, ctx: HearingContext, outcome: HearingOutcome) -> None:
        case, day = ctx.case, ctx.day
        a, l = self.advocate(case.advocate_id), self.litigant(case.party_id)
        am, lm = self.adv_mem[a.advocate_id], self.lit_mem[l.party_id]
        pend = self._pending.pop((case.case_id, day), None)
        if pend is None:
            # not reached / prerequisite unmet: nobody was asked. Did the litigant make the trip anyway?
            pr = self._prop(case, ctx.hearing_type, ctx.was_given_appointment, confirmed=False)
            p_lit_abs = pr.p_absent * pr.litigant_share_of_absence()
            lit_came = stable_uniform("lit-came", self.seed, case.case_id, day) >= p_lit_abs
            adv_came, confirmed = True, False
        else:
            lit_came, adv_came, confirmed = pend["lit_attended"], pend["appears"], pend["confirmed"]

        reached = outcome.kind != "not_reached"
        wait = wait_hours(ctx, reached)
        substantive = outcome.kind == "substantive"
        attend_reasons = set(REASON_GROUPS["ATTEND"])

        # --- litigant memory ---
        lm.wasted *= rules.MEMORY_DECAY
        travel_h = wages = travel_cost = 0.0
        wasted = False
        if lit_came:
            travel_h = 2 * l.travel_km / TRAVEL_KMPH
            wages = l.daily_wage_loss * min(1.0, (wait + travel_h) / WORK_HOURS)
            travel_cost = 2 * TRAVEL_COST_PER_KM * l.travel_km
            lm.trips += 1
            lm.hours_lost += wait + travel_h
            lm.money_lost += wages + travel_cost
            if not substantive:
                wasted = True
                lm.wasted += 1.0
                lm.wasted_total += 1
            if outcome.kind == "adjourned":
                lm.adjournments_suffered += 1
            if substantive and ctx.was_given_appointment:
                lm.appointments_honoured += 1
        lit_mult = rules.propensity_litigant_mult(l, lm, ctx.was_given_appointment)
        lm.history.append((day, round(1.0 - min(0.9, self.ref_absent() * lit_mult), 4)))

        # --- advocate memory ---
        am.wasted *= rules.MEMORY_DECAY
        adv_wasted = False
        if adv_came:
            am.appearances += 1
            am.trip_days.add(day)
            am.hours_waited += wait
            if not substantive and outcome.reason not in attend_reasons:
                adv_wasted = True
                am.wasted += 1.0
                am.wasted_total += 1
        if confirmed:
            am.confirmations += 1
            if outcome.kind == "adjourned" and outcome.reason in attend_reasons:
                am.broken += 1
            elif reached:
                am.kept += 1
        am.history.append((day, round(rules.reliability_eff(a, am), 4)))

        self.observations.append({
            "day": day, "case_id": case.case_id, "advocate_id": a.advocate_id, "party_id": l.party_id,
            "purpose": outcome.purpose, "kind": outcome.kind, "reason": outcome.reason, "decided_by": outcome.decided_by,
            "window": [ctx.listing.start_min, ctx.listing.end_min], "slot": ctx.listing.slot,
            "litigant_came": lit_came, "advocate_came": adv_came,
            "wasted_trip": wasted, "advocate_wasted": adv_wasted,
            "minutes_waited": round(wait * 60) if (lit_came or adv_came) else 0,
            "travel_minutes": round(travel_h * 60), "wages_lost": round(wages), "travel_cost": round(travel_cost),
            "hours_lost": round(wait + travel_h, 2) if lit_came else 0.0, "money_lost": round(wages + travel_cost),
            "appointment": ctx.was_given_appointment, "confirmed": confirmed,
            "litigant_p_attend": lm.history[-1][1], "advocate_reliability": am.history[-1][1],
        })

    # ---------------------------------------------------------------- rules engine
    def _rules_decide(self, ctx: HearingContext, pr: rules.Propensity, rng: random.Random) -> tuple[AgentDecision, bool]:
        a, l = self.advocates[ctx.case.advocate_id], self.litigants[ctx.case.party_id]
        share_lit = pr.litigant_share_of_absence()
        p_adv = pr.p_absent * (1.0 - share_lit)
        # advocate-day latent: one uniform per advocate per day, so an advocate who is elsewhere
        # misses all their matters that day (the marginal probability per case is unchanged).
        adv_away = stable_uniform("advocate-day", self.seed, a.advocate_id, ctx.day) < p_adv
        p_lit = (pr.p_absent - p_adv) / max(1e-9, 1.0 - p_adv)
        lit_away = rng.random() < p_lit
        seek_draw = rng.random()
        if adv_away or lit_away:
            reason = self._absence_reason(ctx.hearing_type, rng)
            if lit_away:
                text = (f"litigant stayed away: {self._explain_litigant(l, pr)} "
                        f"(P absent {pr.p_absent:.0%} vs base {pr.base_absent:.0%})")
            else:
                text = (f"counsel unavailable: {self._explain(pr.adv_terms, a)} "
                        f"(P absent {pr.p_absent:.0%} vs base {pr.base_absent:.0%})")
            return AgentDecision(False, False, False, reason, text, "rules"), not lit_away
        p_seek_c = pr.p_seek / max(1e-9, 1.0 - pr.p_absent)
        if seek_draw < p_seek_c:
            text = f"counsel sought time: {self._explain(pr.seek_terms, a)} (P seek {pr.p_seek:.0%} vs base {pr.base_seek:.0%})"
            return AgentDecision(True, False, True, SOUGHT_TIME, text, "rules"), True
        text = f"present and ready (P goes ahead {pr.p_goes_ahead:.0%})"
        if ctx.case.confirmed_ready:
            text += ", confirmed in advance"
        return AgentDecision(True, True, False, None, text, "rules"), True

    @staticmethod
    def _absence_reason(ht: HearingType, rng: random.Random) -> str:
        shares = [ht.reason_shares.get(r, 0.0) for r in ABSENCE_REASONS]
        return rng.choices(ABSENCE_REASONS, weights=shares if sum(shares) else None)[0]

    def _explain(self, terms: dict[str, float], a: AdvocatePersona) -> str:
        t = rules.top_term(terms, +1)
        if t is None:
            return "ordinary day"
        am = self.adv_mem[a.advocate_id]
        vals = {"caseload": f"caseload pressure {a.caseload_pressure:.2f}",
                "reliability": f"reliability {rules.reliability_eff(a, am):.2f}",
                "diligence": f"diligence {a.diligence:.2f}",
                "appointment": f"little use for time windows ({a.responds_to_appointment:.2f})",
                "wasted appearances": f"{am.wasted_total} wasted appearances"}
        return vals.get(t[0], t[0])

    def _explain_litigant(self, l: LitigantPersona, pr: rules.Propensity) -> str:
        m = self.lit_mem[l.party_id]
        t = rules.top_term(pr.lit_terms, +1)
        if t is None:
            return "ordinary day"
        if t[0] == "distance":
            return f"{l.travel_km:.0f} km from court"
        if t[0] in ("wage loss", "appointment"):
            return f"loses Rs {l.daily_wage_loss:.0f} a day in court"
        extra = f" after {m.wasted_total} wasted trips" if m.wasted_total else ""
        return f"trust in court {rules.trust_eff(l, m):.2f}{extra}"

    # ---------------------------------------------------------------- sarvam engine
    def _matter(self, case: Case, ht: HearingType, day: date) -> dict[str, Any]:
        a, l = self.advocate(case.advocate_id), self.litigant(case.party_id)
        am, lm = self.adv_mem[a.advocate_id], self.lit_mem[l.party_id]
        pr = self._prop(case, ht, self.appointments, confirmed=False)
        return {
            "case_id": case.case_id,
            "hearing": {"purpose": ht.code, "stage": case.stage, "case_age_years": round(case.age_years(day), 1),
                        "adjournments_in_a_row": case.adjournments_in_row, "hearings_so_far": case.total_hearings,
                        "days_since_last_hearing": (day - case.last_heard_on).days if case.last_heard_on else None,
                        "accused_absent_last_time": case.accused_absent_last,
                        "typical_minutes_if_heard": ht.minutes},
            "advocate": {"id": a.advocate_id, "diligence": a.diligence, "caseload_pressure": a.caseload_pressure,
                         "reliability_now": round(rules.reliability_eff(a, am), 2),
                         "responds_to_appointment": a.responds_to_appointment, "cost_sensitivity": a.cost_sensitivity,
                         "wasted_appearances": am.wasted_total, "confirmations_kept": am.kept,
                         "confirmations_broken": am.broken},
            "litigant": {"travel_km": l.travel_km, "daily_wage_loss_rupees": l.daily_wage_loss,
                         "trust_in_court_now": round(rules.trust_eff(l, lm), 2), "patience": l.patience,
                         "trips_made": lm.trips, "wasted_trips": lm.wasted_total,
                         "adjournments_suffered": lm.adjournments_suffered,
                         "appointments_honoured": lm.appointments_honoured},
            "reference_rates": {"p_absent": round(pr.base_absent, 3), "p_attend": round(1 - pr.base_absent, 3),
                                "p_seek_time": round(pr.base_seek, 3)},
        }

    def _llm_batch(self, due: list[Case], day: date) -> None:
        remaining = self.budget - self.calls_used
        if remaining <= 0 or not due:
            return
        types = self.types()
        chunks = [due[i:i + self.batch_size] for i in range(0, len(due), self.batch_size)][:remaining]
        self.calls_used += len(chunks)
        policy = {"sitting_day": day.isoformat(), "court_gives_time_windows": self.appointments,
                  "court_asked_advocates_to_confirm_preparedness": self.ask_confirmation}
        prompts = []
        for chunk in chunks:
            user = json.dumps({"court_policy": policy,
                               "matters": [self._matter(c, types[c.purpose], day) for c in chunk]},
                              sort_keys=True, separators=(",", ":"))
            prompts.append((SARVAM_SYSTEM, user))
        replies = self.client.ask_many(prompts)
        for chunk, reply in zip(chunks, replies):
            rows = (reply or {}).get("d", (reply or {}).get("decisions"))
            by_id = {str(r.get("id", r.get("case_id"))): r for r in rows if isinstance(r, dict)} if isinstance(rows, list) else {}
            for c in chunk:
                parsed = self._parse_row(by_id.get(c.case_id))
                if parsed is not None:
                    self._llm[(c.case_id, day)] = parsed

    @staticmethod
    def _parse_row(r: dict[str, Any] | None) -> dict[str, Any] | None:
        if not r:
            return None
        p_appear = _clamp(r.get("attend", r.get("pa")), *P_APPEAR_RANGE)
        p_seek = _clamp(r.get("ask_time", r.get("ps")), *P_SEEK_RANGE)
        p_ready = _clamp(r.get("prepared", r.get("pr", 1.0)), *P_READY_RANGE)
        if p_appear is None or p_seek is None or p_ready is None:
            return None
        try:
            reason = REASON_CODES.get(int(r.get("r"))) if r.get("r") is not None else None
        except (TypeError, ValueError):
            reason = r.get("r") if r.get("r") in ALL_REASONS else None
        choice = r.get("o")
        # an answer whose headline outcome contradicts its own probabilities is not trusted
        if (choice == "R" and p_appear < 0.4) or (choice == "A" and p_appear > 0.8):
            return None
        conf = r.get("c")
        minutes = r.get("m")
        minutes = _clamp(minutes, *MINUTES_RANGE) if isinstance(minutes, (int, float)) and minutes > 0 else None
        return {
            "confirm": bool(conf) if conf in (0, 1, True, False) else None,
            "p_appear": p_appear, "p_seek": p_seek, "p_ready": p_ready,
            "p_ahead": p_appear * (1 - p_seek) * p_ready,
            "choice": OUTCOME_CODES.get(choice),
            "absent_side": SIDE_CODES.get(r.get("side")),
            "reason": reason, "minutes": minutes,
            "rationale": str(r.get("why") or "").strip()[:200],
        }

    def _sample_llm(self, ctx: HearingContext, llm: dict[str, Any], rng: random.Random) -> tuple[AgentDecision, bool]:
        u1, u2, u3 = rng.random(), rng.random(), rng.random()
        minutes = llm["minutes"]
        if minutes:
            ctx.case.meta["agent_minutes_estimate"] = minutes
        tail = f"P appear {llm['p_appear']:.0%}, P seek {llm['p_seek']:.0%}"
        if minutes:
            tail += f"; ~{minutes:g} min if heard"
        why = llm["rationale"] or "no rationale given"
        if llm["choice"]:
            why = f"{why}; model's most likely outcome: {llm['choice']}"
        if u1 >= llm["p_appear"]:
            reason = llm["reason"] if llm["reason"] in ABSENCE_REASONS else self._absence_reason(ctx.hearing_type, rng)
            lit_came = llm["absent_side"] == "advocate" or (
                llm["absent_side"] is None and stable_uniform("lit-came", self.seed, ctx.case.case_id, ctx.day) < 0.5)
            return AgentDecision(False, False, False, reason, f"absent: {why} ({tail})", "sarvam", minutes), lit_came
        if u2 < llm["p_seek"]:
            return AgentDecision(True, False, True, SOUGHT_TIME, f"seeks time: {why} ({tail})", "sarvam", minutes), True
        if u3 >= llm["p_ready"]:
            reason = llm["reason"] if llm["reason"] and llm["reason"] not in ABSENCE_REASONS else SOUGHT_TIME
            return AgentDecision(True, False, False, reason, f"not ready: {why} ({tail})", "sarvam", minutes), True
        return AgentDecision(True, True, False, None, f"ready: {why} ({tail})", "sarvam", minutes), True

    # ---------------------------------------------------------------- journal
    def _record(self, ctx: HearingContext, pr: rules.Propensity, dec: AgentDecision, lit_attended: bool,
                llm: dict[str, Any] | None) -> None:
        c = ctx.case
        self._pending[(c.case_id, ctx.day)] = {"appears": dec.appears, "lit_attended": lit_attended,
                                               "confirmed": c.confirmed_ready}
        row = {
            "day": ctx.day, "case_id": c.case_id, "advocate_id": c.advocate_id, "party_id": c.party_id,
            "purpose": ctx.hearing_type.code, "appears": dec.appears, "ready": dec.ready,
            "seeks_adjournment": dec.seeks_adjournment, "reason": dec.reason, "rationale": dec.rationale,
            "source": dec.source, "confirmed": c.confirmed_ready, "appointment": ctx.was_given_appointment,
            "litigant_came": lit_attended, "minutes_estimate": dec.minutes,
            "base_absent": round(pr.base_absent, 4), "base_seek": round(pr.base_seek, 4),
        }
        if dec.source == "sarvam" and llm is not None:
            row.update({"p_absent": round(1 - llm["p_appear"], 4), "p_seek": round(llm["p_appear"] * llm["p_seek"], 4),
                        "p_ready": llm["p_ready"], "model_choice": llm["choice"]})
        else:
            row.update({"p_absent": round(pr.p_absent, 4), "p_seek": round(pr.p_seek, 4), "p_ready": 1.0})
        self.decisions.append(row)

    def close(self) -> None:
        if self.client is not None:
            self.client.close()

    def summary(self) -> dict[str, Any]:
        n = len(self.decisions) or 1
        obs = self.observations
        cl = self.client
        return {
            "engine": self.engine,
            "model": cl.model if cl else None,
            "decisions": len(self.decisions),
            "appear_pct": round(100 * sum(d["appears"] for d in self.decisions) / n, 1),
            "ready_pct": round(100 * sum(d["ready"] for d in self.decisions) / n, 1),
            "seek_time_pct": round(100 * sum(d["seeks_adjournment"] for d in self.decisions) / n, 1),
            "mean_p_absent_agent": round(sum(d["p_absent"] for d in self.decisions) / n, 4),
            "mean_p_absent_statistical": round(sum(d["base_absent"] for d in self.decisions) / n, 4),
            "confirmed_share_of_decisions_pct": round(100 * sum(d["confirmed"] for d in self.decisions) / n, 1),
            "litigant_trips": sum(o["litigant_came"] for o in obs),
            "litigant_wasted_trips": sum(o["wasted_trip"] for o in obs),
            "litigant_hours_lost": round(sum(o["hours_lost"] for o in obs)),
            "litigant_money_lost": round(sum(o["money_lost"] for o in obs)),
            "llm_batches": self.calls_used,
            "llm_live_calls": cl.live_calls if cl else 0,
            "llm_cache_hits": cl.cache_hits if cl else 0,
            "llm_errors": cl.errors if cl else 0,
            "llm_mean_latency_s": round(sum(cl.latencies) / len(cl.latencies), 2) if cl and cl.latencies else None,
            "llm_fallback_decisions": self.fallbacks,
            "by_source": {s: sum(1 for d in self.decisions if d["source"] == s)
                          for s in sorted({d["source"] for d in self.decisions})},
        }
