"""Every setting and rule in one place, generated from the code so it cannot drift.

    PYTHONPATH=src python -m causelist.catalog      # writes web/public/data/settings_catalog.json
"""
from __future__ import annotations

import dataclasses
import json
from pathlib import Path

from . import behaviour, config, planning, simulate
from .config import JudgeConfig, Weights

JUDGE, COURT, NOBODY = "judge (per setup)", "court (master list)", "nobody: a fixed floor"

META = {
    # group, plain name, what it does, range, who can change, learned?
    "planner": ("Court day", "How the list is made", "milp (the optimiser), greedy (a fast fallback) or baseline (current practice).", "3 options", JUDGE, "no"),
    "day_start": ("Court day", "When the court starts", "First sitting time when no day profile is set.", "HH:MM", JUDGE, "no"),
    "slots": ("Court day", "Sittings", "Named sittings of the day (built from the day profile when one is set).", "guardrails below", JUDGE, "no"),
    "leave": ("Court day", "Judge on leave", "Dates the judge does not sit; no list is made and dates avoid them.", "any dates", JUDGE, "no"),
    "day_minutes": ("Court day", "Hearing minutes in a day", "Capacity of the day (follows the day profile).", "120-420", JUDGE, "no"),
    "day_profile": ("Court day", "Day profile", "Sittings, lunch and administrative time per weekday.", "guardrails below", JUDGE, "no"),
    "reserve_minutes": ("Court day", "Minutes kept for urgent matters", "Held back every day for bail, stays, urgent mentions.", "0-120", JUDGE, "no"),
    "urgent_per_day": ("Court day", "Urgent matters expected per day", "Simulation: how many urgent matters arrive.", "0-10", JUDGE, "no"),
    "judge_emergency_p": ("Court day", "Chance the judge is called away", "Simulation: part of a day lost; the rest rolled with priority.", "0-1", JUDGE, "no"),
    "fill_target": ("Overbooking", "Fill target", "Share of hearing time to plan for.", "0.5-1.0", JUDGE, "no"),
    "overbook": ("Overbooking", "How full to list the day", "Lists this multiple of the expected minutes (1.0 = to capacity).", "0.9-1.3", JUDGE, "no"),
    "risk_kappa": ("Overbooking", "Safety buffer", "Extra expected minutes, in standard deviations of the day's uncertainty. The minutes are recomputed daily from that day's matters.", "0-2", JUDGE, "the minutes adapt daily; with learning on, the chances behind them are learned"),
    "max_listed": ("Overbooking", "Most matters on one day's list", "Hard cap on listings.", "10-60", JUDGE, "no"),
    "ageing_share": ("Fairness", "Minimum time for old cases", "Share of the day's expected minutes for cases over 4 years old; 'auto' follows the roster.", f"{config.MIN_AGEING_SHARE:.0%}-60% or auto", "judge above the floor; the floor is fixed", "no"),
    "weights.age": ("Fairness", "Priority for age", "How much older cases are raised.", f">= {config.MIN_AGE_WEIGHT}", "judge above the floor; the floor is fixed", "no"),
    "weights.wait": ("Priority", "Priority for being passed over", "Raises a matter each time it is listed and not reached.", "0-3", JUDGE, "no"),
    "weights.fresh": ("Priority", "Priority for fresh matters", "Raises early-stage matters (the fresh-first style).", "0-3", JUDGE, "no"),
    "weights.cluster": ("Advocates", "Group each advocate's matters", "Small reward for each matter beyond an advocate's first on the same day (worth this share of a typical matter), so a lawyer is not sent between days for one matter each.", "0-2", JUDGE, "no"),
    "advocate_daily_cap": ("Advocates", "Most matters of one advocate on one day", "The date plan never gives one advocate more than this many matters on one day, so a busy lawyer cannot crowd a day.", "1-20", JUDGE, "no"),
    "weights.substantive": ("Priority", "Value of a hearing that moves", "Scale of the value of progress.", "fixed at 1 by default", JUDGE, "no"),
    "use_readiness": ("Readiness", "Hold back matters that are not ready", "Do not list while a summons, warrant or filing is known to be outstanding.", "on/off", JUDGE, "no"),
    "readiness_visibility": ("Readiness", "Share of missing prerequisites the court can see", "How many unmet prerequisites are known before listing (process tracking).", "0-1", COURT, "no"),
    "checklists": ("Readiness", "Checklist template", "Which prerequisite checklist per purpose of hearing applies.", "config/checklists.yaml", JUDGE, "no"),
    "give_appointments": ("People", "Give every matter a time window", "An appointment window instead of an all-day wait.", "on/off", JUDGE, "no"),
    "carry_over": ("Dates", "What happens to a matter not reached", "priority (next day, raised) / same weekday next week / none.", "3 options", JUDGE, "no"),
    "next_date_policy": ("Dates", "Next-date rule", "procedural (matched to the next step) or flat (a fixed gap).", "2 options", JUDGE, "no"),
    "flat_gap_days": ("Dates", "Flat gap", "Used only by the flat rule (current practice: 60).", "1-120", JUDGE, "no"),
    "use_horizon": ("Dates", "Plan dates ahead", "Rolling 10-day date plan, re-planned nightly.", "on/off", JUDGE, "no"),
    "horizon_days": ("Dates", "Days planned ahead", "Length of the rolling date plan.", "5-20", JUDGE, "no"),
    "learning": ("Learning", "Learn as the court runs", "Updates each advocate's, party's and hearing type's chance of going ahead after every hearing.", "on/off", JUDGE, "yes: this is the learning"),
    "advocate_correlation": ("Advocates", "An absent advocate misses all their matters", f"Simulation: correlated absence ({behaviour.ADVOCATE_DAY_ABSENCE:.0%} per advocate-day), so the plan is tested against a lawyer's whole day failing.", "on/off", COURT, "no"),
    "gaming_share": ("Simulation", "Share of advocates who seek time strategically", "Simulation only.", "0-0.5", COURT, "no"),
    "gaming_response": ("Fairness", "Respond to strategic delay", "Firm short date and a last chance for the requesting side; the other side is never penalised.", "on/off", JUDGE, "flags are learned from the record"),
    "absence_mult": ("Simulation", "How often people stay away", "Simulation only: multiplies every chance of absence.", "0.5-3", COURT, "no"),
    "agency_delay_mult": ("Simulation", "State-agency delays", "Multiplies delays from process service, police and forensics.", "0.5-3", COURT, "no"),
    "judge": ("Judge", "Judge background and experience", "Background (criminal bar, civil bar, judicial service, academic), years on the bench, specialisations: changes hearing time.", "see duration model", JUDGE, "no"),
    "priors": ("Judge", "Judge overrides of the court's master list", "Per hearing type: minutes, gap, chance it moves; per dispute type.", "bounded", JUDGE, "the effective values are the prior for learning"),
}

FLOORS = [
    ("Minimum time for old cases", f"never below {config.MIN_AGEING_SHARE:.0%} of the day's expected minutes when old cases are waiting"),
    ("Priority for age", f"never below {config.MIN_AGE_WEIGHT} (an old case is never ranked below neutral)"),
    ("Hearing time per week", f"an average of at least {config.MIN_WEEKLY_SITTING_MINUTES // 5 / 60:.1f} hours a sitting day"),
    ("Hearing time per sitting day", f"between {config.MIN_SITTING_DAY_MINUTES // 60} and {config.MAX_SITTING_DAY_MINUTES // 60} hours"),
    ("Emergency reserve", "always taken out of planning capacity when set"),
    ("Prerequisite checklists", "a matter with a known unmet item is never listed and loses its reserved date"),
    ("The other side", "a strategic-delay response never penalises the side that did not ask for time"),
]

ESTIMATION = [
    ("Where the chances start", "From the court's own records. For each kind of hearing (evidence, arguments, warrant...) we know how often it actually moved the case forward, and when it did not, why: papers or a summons were not ready, someone did not come or asked for time, or the court itself could not take it. Those shares are the starting chances for every matter of that kind."),
    ("Chance it goes ahead", f"1 - (chance of absence + chance time is sought) x case adjustments; absence x{behaviour.ACCUSED_ABSENT_LAST_MULT} if absent last time, x{behaviour.REPEAT_ADJOURN_MULT} per adjournment in a row (up to 4), x{behaviour.CONFIRMED_READY_MULT} if readiness confirmed, x{behaviour.APPOINTMENT_MULT} with a time window; dispute type and town conditions also multiply."),
    ("Chance it moves forward", "chance it goes ahead x (1 - chance of a court-side problem)."),
    ("Expected minutes", f"chance it goes ahead x usual length (hearing type x judge x recency x dispute type) + otherwise {planning.CALLOVER_MIN:.0f} minute to call it."),
    ("Uncertainty for the buffer", "each matter's minutes are uncertain (it may not go ahead, and its length varies); the day's total spread sets the buffer."),
    ("Learning (when on)", "Beta-Bayesian estimates per advocate, party and hearing type x stage, starting from the tables and updated after every hearing; the planner then uses the learned chance."),
    ("On the day (simulation)", f"hearing length is drawn around the usual length (spread {simulate.DURATION_SIGMA}); attendance from the chances above, or from the AI agent's own stated chances."),
]

ADVOCATE_RULES = [
    ("Who the lawyer is never counts", "A matter's value is its chance of moving forward x how far a hearing takes it x the justice weight (age, time stuck, times passed over). No advocate's name, seniority, firm or number of cases enters it."),
    ("Grouping is a small bonus, not a priority", "Each matter beyond an advocate's first on the same day earns the grouping reward (default 0.3 of a typical matter). It saves the lawyer a trip. It can only break near-ties: a matter worth more than 0.3 of a typical matter above another always wins, whoever the lawyers are."),
    ("A cap per advocate per day", "The date plan never gives one advocate more than the daily cap of matters (default 6), so a busy practice cannot crowd out a day."),
    ("Called back to back", "Within a sitting, an advocate's matters are called one after another, so no lawyer waits all day between two matters."),
    ("An absent lawyer does not cost the other side", "If an advocate is absent or seeks time, the case gets a short, firm date; the side that came is never pushed back."),
    ("Strategic delay is answered at the requester", "An advocate whose time requests cluster before evidence or judgement is flagged from the record; the response (firm short date, last chance) applies only to the side that asked."),
    ("Learning is per advocate, and bounded", "With learning on, an advocate's own record of turning up adjusts the chance their matters go ahead, starting from the court's tables and never below 2% or above 99.9%. The client's matter is still listed by its value and still protected by the ageing floor."),
    ("The same rules for every lawyer", "Every rule above applies identically to every advocate; nothing is set per name."),
]


def _bucket(n: int) -> str:
    return "1 case" if n == 1 else "2 cases" if n == 2 else "3-4 cases" if n <= 4 else "5+ cases"


def lawyer_check(size: int = 3000) -> dict | None:
    """Measured: per case, how often a matter was listed and moved forward, grouped by how many
    cases its advocate carries. Read from the precomputed runs; None if they are not there."""
    from collections import Counter
    import csv
    root = Path(__file__).resolve().parents[2]
    roster = root / "data" / f"roster_{size}.csv"
    runs = {"Current practice": "baseline", "Recommended list": "optimal"}
    if not roster.exists():
        return None
    with open(roster, newline="", encoding="utf-8") as fh:
        adv = [r["advocate_id"] for r in csv.DictReader(fh)]
    load = Counter(adv)
    cases = Counter(_bucket(load[a]) for a in adv)
    order = ["1 case", "2 cases", "3-4 cases", "5+ cases"]
    rows = {b: {"bucket": b, "cases": cases[b]} for b in order}
    for label, preset in runs.items():
        p = root / "web" / "public" / "data" / f"run_{size}_{preset}.json"
        if not p.exists():
            return None
        listed, moved = Counter(), Counter()
        for day in json.loads(p.read_text())["days"]:
            for l in day["listings"]:
                b = _bucket(load.get(l["advocate"], 1))
                listed[b] += 1
                moved[b] += (l.get("outcome") or {}).get("kind") == "substantive"
        for b in order:
            rows[b][label] = {"listed_per_case": round(listed[b] / max(cases[b], 1), 2),
                              "moved_per_case": round(moved[b] / max(cases[b], 1), 3)}
    rec = [rows[b]["Recommended list"]["moved_per_case"] for b in order]
    return {"roster": size, "rows": [rows[b] for b in order],
            "takeaway": ("Matters of advocates with many cases are not favoured: per case they move forward "
                         f"{rec[-1]:.2f} times against {rec[0]:.2f} for a lawyer with a single case, a slight tilt the other way that we watch.")}


def _simulation_keys() -> set[str]:
    from .api import Overrides
    return set(getattr(Overrides, "model_fields", None) or Overrides.__fields__)


def build() -> dict:
    d = JudgeConfig()
    sim = _simulation_keys()
    defaults = dataclasses.asdict(d)
    rows = []
    for key, (group, name, what, rng, who, learned) in META.items():
        if key.startswith("weights."):
            val = getattr(Weights(), key.split(".")[1])
        else:
            val = defaults.get(key, 1.0 if key == "absence_mult" else None)
        short = key.split(".")[-1]
        rows.append({"key": key, "in_simulation": short in sim,
                     "set_in": "Simulation page or the setup file" if short in sim else "the setup file (config/<setup>.yaml)", "group": group, "name": name, "what": what, "default": val, "range": rng,
                     "who_can_change": who, "learned": learned})
    return {"settings": rows, "floors": [{"name": n, "rule": r} for n, r in FLOORS],
            "estimation": [{"step": s, "how": h} for s, h in ESTIMATION],
            "advocate_rules": [{"name": n, "rule": r} for n, r in ADVOCATE_RULES],
            "lawyer_check": lawyer_check(),
            "presets": config.list_presets(),
            "where": "Settings live in config/<setup>.yaml; the court master list in config/priors/court_default.yaml; checklists in config/checklists.yaml."}


if __name__ == "__main__":
    out = Path(__file__).resolve().parents[2] / "web" / "public" / "data" / "settings_catalog.json"
    out.write_text(json.dumps(build(), indent=1, default=str))
    print("wrote", out.name, len(build()["settings"]), "settings")
