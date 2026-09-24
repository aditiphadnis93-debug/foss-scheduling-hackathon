"""The single, complete reference for how the scheduler works, written once here and rendered by the
web app's "How it works" page. Values are read from the code where they are defined, so this page
cannot drift from what the engine does.

    PYTHONPATH=src python -m causelist.how_it_works     # writes web/public/data/how_it_works.json
"""
from __future__ import annotations

import json
from pathlib import Path

from . import access, behaviour, config, duration_model, horizon, planning, priors, simulate
from .world import coupling

B, C, P, H, S = behaviour, config, planning, horizon, simulate


from .catalog import ADVOCATE_RULES, lawyer_check  # noqa: E402


def sections() -> list[dict]:
    return [
        {"id": "overview", "title": "1. What it does, in one minute",
         "plain": [
             "Every evening the scheduler looks at every pending case and decides which ones the judge should hear tomorrow, in which sitting, at what time, and gives every other matter a date in the next ten sitting days.",
             "It spends the judge's minutes where they move cases forward the most, never lets old cases starve, keeps time for emergencies, and tells every person when to come and why.",
             "During the day, what actually happens (who came, how long hearings took, emergencies) changes the plan; after each hearing it recommends the next date; every decision is logged with its reason."],
         "steps": ["Can it go ahead?", "What is it worth?", "Plan the next ten days", "Pack tomorrow's sittings", "Give time windows", "Run the day", "Recommend the next date", "Log and learn"]},

        {"id": "inputs", "title": "2. What goes in",
         "plain": ["The judge's roster (one row per case: filing date, stage, purpose of the next hearing, advocate, party, how many hearings of each type so far, what happened last time).",
                   "The court calendar (sitting days, holidays) and the judge's own day profile (sittings, lunch, administrative time, leave).",
                   "The court's own records per kind of hearing: how long it usually takes, the usual gap to the next date, how often it moves the case forward, and when it does not, why."],
         "table": {"head": ["Input", "Where", "Used for"], "rows": [
             ["Roster", "data/roster_*.csv (organiser schema)", "the cases, their age, stage and history"],
             ["Court calendar", "data/court_calendar.csv", "sitting days and holidays"],
             ["Hearing-type reference", "data/hearing_type_reference.csv", "usual minutes and usual gap per hearing type"],
             ["Substantiveness", "data/substantiveness_by_hearing_type.csv", "chance a hearing of that type moves the case"],
             ["Failure reasons", "data/hearing_failure_reasons.csv", "why hearings did not move: prerequisite, attendance, court-side"],
             ["Court master list of priors", "config/priors/court_default.yaml", "the court's own editable defaults, per hearing type and dispute type"],
             ["Judge setup", "config/<setup>.yaml", "every setting a judge can change"],
             ["Checklists", "config/checklists.yaml", "what must be ready before each kind of hearing"]]}},

        {"id": "chances", "title": "3. Can it go ahead? How the chances are estimated",
         "plain": ["We start from the court's own records: for each kind of hearing, how often it moved the case forward, and when it did not, why. Those shares are the starting chances.",
                   "Then each case is adjusted for its own situation, and prerequisites (summons, warrant, papers) are checked before listing: a matter that is known not to be ready is not listed at all."],
         "table": {"head": ["Adjustment", "Effect on the chance of not going ahead"], "rows": [
             ["The accused was absent last time", f"x{B.ACCUSED_ABSENT_LAST_MULT}"],
             ["Each adjournment in a row (up to 4)", f"x{B.REPEAT_ADJOURN_MULT} each"],
             ["Readiness confirmed in advance", f"x{B.CONFIRMED_READY_MULT}"],
             ["A real time window given", f"x{B.APPOINTMENT_MULT}"],
             ["Kind of dispute (court master list)", "e.g. unpaid wages x1.25, supplier x0.9"],
             ["The town (distance, frustration, wage, strikes)", "per person; strikes keep a share away"],
             ["An advocate unavailable all day", f"{B.ADVOCATE_DAY_ABSENCE:.0%} per advocate-day: all their matters together"]]},
         "technical": [
             "p_absent, p_seek_time, p_court = the table's reason shares, conditional on prerequisites being met",
             "P(goes ahead) = max(0.02, 1 - min(0.95, (p_absent + p_seek_time) x adjustments))",
             "P(moves forward) = P(goes ahead) x (1 - p_court)",
             "With learning on: a Beta-Bayesian estimate per advocate, per party and per hearing type x stage, starting from the table and updated after every hearing, replaces the table value."]},

        {"id": "prerequisites", "title": "4. Prerequisites and readiness",
         "plain": ["Each kind of hearing has a checklist (e.g. warrant executed or returned by police; written arguments filed by both sides). If an item is known to be unmet, the matter is held back, the item is named, and it loses any reserved date until the item clears.",
                   f"The court can see about {C.JudgeConfig().readiness_visibility:.0%} of missing prerequisites in advance (process tracking); the rest are only discovered in court, which is how they cost hearings today.",
                   "Two days ahead the court asks each advocate to confirm readiness; a confirmation lowers the chance of a failed hearing, and the Court master view records confirmations and checklist ticks."],
         "technical": ["Per attempt, a prerequisite is outstanding with the table's prerequisite share for that hearing type; if visible, the matter gets a re-check date (half the usual gap) and planners that use readiness hold it back."]},

        {"id": "value", "title": "5. What is it worth? The value of hearing a matter",
         "plain": ["A hearing is worth more when it is likely to move the case, when that move brings the case closer to judgment, and when the case is old, stuck at one stage, or has been passed over before.",
                   "Worked example: an evidence hearing, 6 in 10 such hearings move the case, moving it brings the case half-way to judgment, and the case is 6 years old so it counts double: 0.6 x 0.5 x 2 = 0.6 points."],
         "technical": ["value = P(moves forward) x progress x priority",
                       "progress (stage hearing) = 0.5 + 0.5 x cost(stage) / remaining cost to judgment; judgment = 1.0",
                       "cost(type) = usual minutes + (1 / P(substantive) - 1) x 2",
                       "priority = 1 + age weight x age/4 + 0.5 x max(0, hearings at stage / usual - 1) + passed-over weight x times passed over + 1 if 4+ years and unheard for 60 days; never below 1"]},

        {"id": "minutes", "title": "6. How long will it take? Hearing time",
         "plain": ["Each matter gets an estimated length, not a fixed time: the usual minutes for its kind of hearing, adjusted for the judge and for how fresh the file is.",
                   "A matter heard two days ago is quicker (the facts are fresh); a file untouched for months needs re-reading; a judge from the criminal bar is quicker on trial stages; a new judge is slower at first."],
         "table": {"head": ["Factor", "Effect"], "rows": [
             ["Judge background", "criminal bar: trial x0.85; civil bar: trial x1.10; judicial service: procedure x0.90"],
             ["Judge experience", f"+{duration_model.NEW_BENCH_PENALTY:.0%} for a brand-new judge, halving every {duration_model.EXPERIENCE_HALF_LIFE_Y:.0f} years"],
             ["Heard recently", f"up to {duration_model.RECENT_DISCOUNT:.0%} quicker, fading over about a week"],
             ["Untouched for 4+ months", f"+{duration_model.STALE_PENALTY:.0%} (+{duration_model.STALE_PENALTY_OLD_CASE:.0%} for a 4+ year case)"],
             ["Kind of dispute", "e.g. family / property x1.30, supplier x1.15"]]},
         "technical": [f"expected minutes = P(goes ahead) x estimated minutes + (1 - P(goes ahead)) x {P.CALLOVER_MIN:.0f} minute to call it",
                       f"on the day the actual length is drawn around the estimate (spread {S.DURATION_SIGMA}) and split into phases: call and appearance, submissions or evidence, the order"]},

        {"id": "overbooking", "title": "7. How full to list the day: overbooking and the safety buffer",
         "plain": ["Not everyone listed will go ahead, so the day is filled on expected minutes, not on the minutes everyone would take if they all came. That is deliberate, calculated overbooking.",
                   "On top, a safety buffer adds a little extra, sized each day by how uncertain that day's matters are; the judge sets how cautious to be, the data decides how many minutes that means.",
                   "If matters finish early, standby matters are called: only those whose advocate is already in court or who confirmed readiness, so nobody makes an extra trip."],
         "table": {"head": ["Setting", "Default", "Range", "Who"], "rows": [
             ["How full to list the day (overbook)", "1.0", "0.9-1.3", "judge"],
             ["Safety buffer (standard deviations)", str(P.RISK_KAPPA), "0-2", "judge"],
             ["Most matters on one day's list", str(C.JudgeConfig().max_listed), "10-60", "judge"],
             ["Standby: called when at least this many minutes remain", str(S.STANDBY_SLACK_MIN), "fixed", "-"]]},
         "technical": ["budget per sitting = sitting minutes x fill x overbook (minus the reserve), plus one shared buffer = safety buffer x sqrt(total expected minutes x variance ratio), split across sittings",
                       "On the 3,000 docket the recommended list books about 132% of the day if everyone came, 108% in expected minutes; current practice books 341%."]},

        {"id": "horizon", "title": "8. Planning dates ahead: the rolling ten-day plan",
         "plain": [f"Every evening the scheduler re-plans the next {C.JudgeConfig().horizon_days} sitting days: tomorrow's list is final, the rest are published as provisional dates people can plan around.",
                   "A published date is kept if at all possible; if it has to move, the move and its reason are logged. A matter with a known unmet prerequisite gets no date until the item clears."],
         "technical": ["x(c,d) = 1 if matter c is given day d. Maximise sum of value x (1 - 0.03 x days later) + a bonus for keeping an already-published date",
                       f"subject to: one date per matter; not before its earliest date; each day's expected minutes within capacity; at most {H.ADVOCATE_DAILY_CAP} matters per advocate per day; a soft old-case share per day"]},

        {"id": "packing", "title": "9. Packing tomorrow: the optimiser",
         "plain": ["From the matters dated for tomorrow, the optimiser picks the set that gives the most value, without going over each sitting's budget, giving old cases at least their guaranteed share of time, listing a matter at most once, and grouping each advocate's matters.",
                   "It checks every possible combination efficiently (integer programming) and returns the best list in about a second."],
         "technical": ["x(c,s) = 1 if matter c is listed in sitting s; u(a) = 1 if advocate a has a matter today; n(a) = their matters today",
                       "Maximise: sum of value(c) x x(c,s) + grouping weight x sum over advocates of (n(a) - u(a))",
                       "Subject to: each matter at most once; per sitting, sum of expected minutes <= budget; total listed <= most matters per day; old cases' expected minutes >= old-case share x all expected minutes",
                       "Solver: CBC (open source) through PuLP; one thread, fixed seed; greedy start and greedy fallback; pool trimmed to about 5x what fits, always including old cases"]},

        {"id": "windows", "title": "10. Time boxes and appointment windows",
         "plain": ["Each sitting is a time box with its own budget (e.g. 10:00-13:30 is 210 minutes; 14:00-16:30 is 150). Block scheduling can reserve boxes by purpose (fresh and notice matters in the morning, cases 3+ years old in the afternoon).",
                   "Inside a sitting, each advocate's matters sit together and the most valuable go first; every matter gets a one-hour window starting on the half hour, always inside its sitting."]},

        {"id": "day", "title": "11. What happens on the day",
         "plain": [f"{C.JudgeConfig().reserve_minutes} minutes are kept every day for urgent matters (bail, stays, urgent mentions); they are heard first from the reserve and unused reserve goes to standby.",
                   "If the judge is called away, the rest of the list rolls to the next sitting day with priority and nobody is blamed.",
                   "When urgent matters take more than the reserve, the extra time comes out of the day's list. Because the list runs most valuable first (each advocate's matters together), the minutes are lost from the end of the day, from the least valuable matters; old cases already have their guaranteed share. Matters not reached roll to the next sitting day with priority (their priority rises each time they are passed over, so they cannot be pushed back indefinitely); no standby is called that day; every one is logged with its new date. Not yet built: re-planning in the middle of the day to warn the last matters early.",
                   "Interrupting applications (bail, reports, applications) can arise at their usual rates; bail cannot be filed once complainant evidence has begun; afterwards the case returns to the step it was heading for.",
                   "Actual hearing times differ from the plan; the Court day view shows planned against actual and a log of every change and its impact."]},

        {"id": "nextdate", "title": "12. Recommending the next date",
         "plain": ["After every hearing the first rule that fits gives the date; it is then fitted to the ten-day plan (the first sitting day on or after that date with room) and to the parties' requests."],
         "table": {"head": ["What happened", "Rule", "Typical date"], "rows": [
             ["The hearing moved the case", "the gap the next step normally needs", "e.g. 14 days for evidence, 21 for appearance, 45 for reports"],
             ["Someone did not come / asked for time", "a short, firm date", "at most 14 days"],
             ["Summons, warrant or papers not ready", "the day it is expected back", "about half the usual gap"],
             ["Not reached today", "next sitting day, with priority (block scheduling: same weekday next week)", "tomorrow"],
             ["Time sought again by the same flagged side", "firm date, then a last chance", "within 7 days"],
             ["Judge called away", "next sitting day, with priority", "tomorrow"],
             ["The parties ask for dates", f"never earlier than the rule; at most 14 days later (7 for 4+ year cases); if no day fits, the rule stands", "shown with the reason"]]}},

        {"id": "fairness", "title": "13. Fairness: what cannot be configured away",
         "plain": ["Some protections are fixed so no setup can switch them off.",
                   "Lawyers: " + " ".join(f"{n}: {r}" for n, r in ADVOCATE_RULES),
                   *([_lc["takeaway"]] if (_lc := lawyer_check()) else [])],
         "table": {"head": ["Floor", "Rule"], "rows": [
             ["Old cases", f"at least {C.MIN_AGEING_SHARE:.0%} of the day's expected minutes for 4+ year cases when they are waiting (default {C.DEFAULT_AGEING_SHARE:.0%}, or 'auto')"],
             ["Age priority", f"never below {C.MIN_AGE_WEIGHT}"],
             ["Hearing time", f"an average of at least {C.MIN_WEEKLY_SITTING_MINUTES / 5 / 60:.1f} hours a sitting day; {C.MIN_SITTING_DAY_MINUTES // 60}-{C.MAX_SITTING_DAY_MINUTES // 60} hours on any sitting day"],
             ["Emergency reserve", "always taken out of planning capacity"],
             ["Checklists", "a matter with a known unmet item is never listed"],
             ["The other side", "a response to strategic delay never penalises the side that did not ask for time"]]}},

        {"id": "gaming", "title": "14. People who delay on purpose",
         "plain": ["Each advocate's and each side's requests for time are compared with what their hearings would normally see; only when the evidence is strong (at least 3 own requests, and a 90% chance the true rate is 1.5 times the usual) is the side flagged.",
                   "The response is a short, firm date, then a last chance; the judge sees the evidence, not an accusation. With 52 days of history this rarely triggers at 3,000 cases; it is built for a court's multi-year record."]},

        {"id": "delays", "title": "15. Who is the delay?",
         "plain": ["Every lost hearing is attributed: petitioner side, respondent side, both sides, state agencies (process service, police, forensics), the court, a judge emergency, or time running out; counted in hearings and in court minutes lost."]},

        {"id": "people", "title": "16. The people: AI agents",
         "plain": ["Every party and advocate can be an AI agent (a language model) with a persona (diligence, reliability, distance to court, a day's wage, trust, patience) and a memory (wasted trips, adjournments suffered, confirmations kept).",
                   "Each day it is given the court's policy (time windows, readiness asked), its matter and the court's average rates as a starting point, and decides: confirm readiness, turn up, be ready, ask for time, how long the hearing will take, and why. The simulation then draws the outcome from its stated chances, so runs repeat exactly.",
                   "Their decisions feed back: the plan re-dates, calls standby, and next time they remember. Limits: the AI runs on 100 cases x 18 days (recorded); the 3,000-case scores use the statistical model."]},

        {"id": "town", "title": "17. The town: where disputes come from",
         "plain": ["A synthetic town of 200,000 people produces disputes at stated yearly rates by kind (cheque/loan, supplier, wages, rent, family/property, other); notices, settlements and negotiation thin them down to the complaints that reach this court (about two a sitting day). All rates are marked 'assumed'.",
                   f"The town changes the court day: a person's distance, frustration and wage change whether they come; a transport strike keeps {coupling.SCENARIOS['transport_strike'][0].absent_share:.0%} of people away, heavy rain {coupling.SCENARIOS['monsoon_week'][0].absent_share:.0%}. The court changes the town: trips, lost wages, frustration, settlements."]},

        {"id": "assistant", "title": "18. The court assistant",
         "plain": ["An AI assistant the judge can ask; it reads the message itself (a greeting, a question or a problem), answers only from the day's record with case numbers, and for a problem proposes at most three changes to the judge's own settings, within the floors. The engine then re-runs the same court with the change and shows the effect before anything is applied. The judge decides."]},

        {"id": "people_see", "title": "19. What people see and what it costs them",
         "plain": [f"We measure whether the promise to people is kept: called on the day they were told, a time window, a missing item known before travelling, a reason shown; and the hours of their lives per hearing that moved the case (travel {access.TRAVEL_HOURS:.0f} h a trip; waiting {access.ALL_DAY_WAIT_HOURS:.0f} h without a window, half the window with one)."]},

        {"id": "priors", "title": "20. What the court assumes, and what is learned",
         "plain": ["Every starting value has three layers you can inspect: the organiser's tables, the court's own master list (editable, with a source on every row) and a judge's overrides. The effective values drive both planning and the simulation; when learning is on, it starts from them and shows prior against learned.",
                   "Kinds of dispute have their own factors; the organiser's roster does not record the kind, so roster cases get the neutral reference and a court's roster with a dispute_type column is read automatically."]},

        {"id": "setups", "title": "21. Judge setups",
         "table": {"head": ["Setup", "What it does"], "rows": [
             ["Recommended list", "the optimiser with every protection on"],
             ["Current practice", "list up to 60, attempt everything, flat 60-day date (the case study's baseline)"],
             ["Block scheduling", "fresh and notice matters in the morning, oldest after lunch, unheard matters return the same weekday"],
             ["Cluster by advocate", "stronger grouping of each advocate's matters, more weight on age"],
             ["Fresh matters first", "priority to early-stage matters (the floors still hold)"],
             ["Morning bench / Full-day bench", "different day profiles, same rules"],
             ["New judge (criminal bar)", "judge background and experience in hearing time"]]}},

        {"id": "log", "title": "22. The decision log",
         "plain": ["Every decision is logged with the rule that made it and why: listed, held back (and which item), rolled over, rescheduled (old and new date and cause), next date (which rule), urgent heard, judge emergency, last chance, standby called, interrupt filed, withdrawn. The Court master's changes are logged too."]},

        {"id": "measures", "title": "23. How we measure",
         "table": {"head": ["Measure", "Meaning"], "rows": [
             ["Progress per court hour", "value of the hearings that moved, per hour the court sat"],
             ["Court time on hearings that moved", "minutes of substantive hearings / minutes available"],
             ["Called on the day given", "listed matters that were actually called"],
             ["Matters that moved forward", "substantive hearings"],
             ["Cases over 4 years heard", "share of old cases heard at least once"],
             ["5+ year cases still pending", "at the end of the posting"],
             ["Next dates that fit the step", "within half to double the usual gap"],
             ["Hours of people's lives per hearing that moved", "travel + waiting, per substantive hearing"]]}},

        {"id": "limits", "title": "24. What is simulated, and the honest limits",
         "plain": ["Real: the planner, the date plan, the rules, the optimiser, the validator, the measures, the API and the web app.",
                   "Simulated: everything on the outcome side (who comes, how long hearings take, prerequisite status) is drawn from the organiser's tables with stated assumptions; there is no real court feed. A calibration test keeps the simulated rates within 12 points of the tables per hearing type.",
                   "Next: read the court's case system, check-in and cancellation by portal and SMS, learning from the court's own hearing log, and flags on a schedule."]},
    ]


if __name__ == "__main__":
    out = Path(__file__).resolve().parents[2] / "web" / "public" / "data" / "how_it_works.json"
    out.write_text(json.dumps({"sections": sections()}, indent=1, ensure_ascii=False))
    print("wrote", out.name, len(sections()), "sections")
