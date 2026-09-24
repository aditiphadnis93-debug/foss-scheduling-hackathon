"""What the people in the case can see, and what they can do about it.

A schedule is also a promise to litigants and advocates. Two plain questions:

**Visibility — does each person know what is happening to their matter?**
* date certainty: was the matter actually called on the day they were told to come?
* time window: were they given a real appointment window instead of an all-day wait?
* prerequisites known in advance: when something was missing (summons, warrant, filing), was the
  matter held back with the missing item named, or did people travel only to find out in court?
* reason shown: every listing carries a stated reason and every next date a stated rule.

**Possibility — what can they do, and what does it cost them?**
* hours of life per hearing that moved the case (travel + waiting), and hours saved vs today's practice
* wasted trips (came to court, nothing moved)
* actions open to them: confirm readiness ahead (check-in), be told of a missing prerequisite
  before travelling, get a short firm date after a time request instead of an open-ended one.

Assumptions (stated): a round trip to court costs ``TRAVEL_HOURS``; without a window a person
waits ``ALL_DAY_WAIT_HOURS``; with a window they wait on average half of it.
"""
from __future__ import annotations

from collections import defaultdict

TRAVEL_HOURS = 2.0          # round trip to court, per person per listing
ALL_DAY_WAIT_HOURS = 5.0    # waiting without a time window (called at an unknown point of the day)
PEOPLE_PER_LISTING = 2      # one person for each side attends (litigant or their representative)


def _window_hours(listing) -> float:
    return max(0.25, (listing.end_min - listing.start_min) / 60.0)


def summarise(res) -> dict:
    """Visibility and possibility numbers for one simulated run (JSON-serialisable)."""
    cfg = res.config
    windows = bool(cfg.give_appointments) and cfg.planner != "baseline"
    listed = called = with_window = 0
    prereq_on_day = prereq_foreseen = 0
    wasted_trips = trips = 0
    wait_hours = 0.0
    moved = 0
    by_party: dict[str, dict] = defaultdict(lambda: {"trips": 0, "wasted": 0, "hours": 0.0, "moved": 0})
    party_of = {c.case_id: c.party_id for c in res.initial}
    party_of.update({c.case_id: c.party_id for c in res.cases})

    for d in res.days:
        outs = {o.case_id: o for o in d.outcomes}
        prereq_foreseen += sum(1 for _, why in d.plan.held_back
                               if why.startswith("prerequisite") or why.startswith("checklist"))
        for l in d.plan.listings:
            o = outs.get(l.case_id)
            if o is None:
                continue
            listed += 1
            trips += PEOPLE_PER_LISTING
            called += o.kind != "not_reached"
            wait = (_window_hours(l) / 2) if windows else ALL_DAY_WAIT_HOURS
            with_window += windows
            wait_hours += wait * PEOPLE_PER_LISTING
            if o.kind == "not_ready":
                prereq_on_day += 1
            if o.kind == "substantive":
                moved += 1
            else:
                wasted_trips += PEOPLE_PER_LISTING
            p = by_party[party_of.get(l.case_id, l.case_id)]
            p["trips"] += 1
            p["wasted"] += o.kind != "substantive"
            p["hours"] += TRAVEL_HOURS + wait
            p["moved"] += o.kind == "substantive"

    # prerequisite problems caught before anyone travelled: counted by the simulator per attempt
    counted = sum(int(c.meta.get("prereq_foreseen", 0)) for c in res.cases)
    estimated = False
    if counted:
        prereq_foreseen = max(prereq_foreseen, counted)
    elif cfg.use_readiness and cfg.planner != "baseline" and prereq_on_day:
        vis = cfg.readiness_visibility
        prereq_foreseen = round(prereq_on_day * vis / max(1e-6, 1 - vis))
        estimated = True
    life_hours = trips * TRAVEL_HOURS + wait_hours
    prereq_total = prereq_on_day + prereq_foreseen
    parties = sorted(({"party": k, **v, "hours": round(v["hours"], 1)} for k, v in by_party.items()),
                     key=lambda r: -r["hours"])
    return {
        "visibility": {
            "date_certainty_pct": round(100 * called / max(listed, 1), 1),
            "time_window_pct": round(100 * with_window / max(listed, 1), 1),
            "prerequisites_known_in_advance_pct": round(100 * prereq_foreseen / max(prereq_total, 1), 1),
            "reason_shown_pct": 100.0 if cfg.planner != "baseline" else 0.0,
            "prerequisites_foreseen": prereq_foreseen,
            "prerequisites_failed_on_the_day": prereq_on_day,
            "prerequisites_count_estimated": estimated,
        },
        "possibility": {
            "life_hours_total": round(life_hours),
            "life_hours_per_hearing_moved": round(life_hours / max(moved, 1), 1),
            "wasted_trips": wasted_trips,
            "wasted_trip_pct": round(100 * wasted_trips / max(trips, 1), 1),
            "mean_wait_hours": round(wait_hours / max(trips, 1), 2),
            "actions_open": [a for a, on in [
                ("confirm readiness ahead (check-in)", cfg.planner != "baseline"),
                ("told of a missing prerequisite before travelling", cfg.use_readiness and cfg.planner != "baseline"),
                ("real appointment window", windows),
                ("short, firm date after a time request", cfg.planner != "baseline"),
                ("date published days ahead", bool(getattr(cfg, "use_horizon", False)) and cfg.planner != "baseline"),
            ] if on],
        },
        "assumptions": {"travel_hours": TRAVEL_HOURS, "all_day_wait_hours": ALL_DAY_WAIT_HOURS,
                        "people_per_listing": PEOPLE_PER_LISTING},
        "parties_most_burdened": parties[:25],
    }


def compare(ours: dict, baseline: dict) -> dict:
    """Headline differences vs today's practice."""
    o, b = ours["possibility"], baseline["possibility"]
    return {
        "life_hours_saved": b["life_hours_total"] - o["life_hours_total"],
        "life_hours_per_hearing_moved": [b["life_hours_per_hearing_moved"], o["life_hours_per_hearing_moved"]],
        "wasted_trips_avoided": b["wasted_trips"] - o["wasted_trips"],
        "date_certainty_pct": [baseline["visibility"]["date_certainty_pct"], ours["visibility"]["date_certainty_pct"]],
    }
