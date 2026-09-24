"""JSON bridge for the supplied stdlib scheduler.

Receives one request on stdin and returns one JSON result on stdout. No policy or
case data is read from the browser; the API supplies the validated roster/rules.
"""
from __future__ import annotations

import datetime as dt
import json
import random
import sys
from pathlib import Path

import engine as E

DATA = Path(__file__).resolve().parent.parent / "data"
TYPES = E.load_reference(DATA)


def policy(rule, settings):
    start = lambda key: int(settings[key][:2]) * 60 + int(settings[key][3:])
    usable = start("morningEnd") - start("morningStart") + start("afternoonEnd") - start("afternoonStart")
    priority = {
        "balanced": "value_per_minute",
        "block": "value_per_minute",
        "advocate": "cluster_purpose",
        "new": "fresh_first",
    }[rule["preset"]]
    p = E.Policy(
        name=rule["name"],
        priority=priority,
        day_minutes=usable,
        old_case_quota=rule["oldCaseShare"] / 100,
        fill_factor={"light": .8, "balanced": 1.1, "packed": 1.4}[rule["fullness"]],
        short_block_share=(start("morningEnd") - start("morningStart")) / usable,
        levers=E.Levers(
            readiness_gate=False,  # The CSV cannot confirm service or filings.
            appointment_slots=True,
            advocate_cluster=rule["groupAdvocates"] or rule["preset"] in ("block", "advocate"),
        ),
    )
    return p


def period_days(request, settings):
    start = dt.date.fromisoformat(request["start_date"])
    length = {"day": 1, "week": 7, "month": 30}[request["period"]]
    days = E.load_calendar(DATA, start, start + dt.timedelta(days=length - 1), settings["leaveDays"])
    return days


def mins(time):
    h, m = map(int, time.split(":"))
    return h * 60 + m


def hhmm(value):
    return f"{value // 60:02d}:{value % 60:02d}"


def serialize_case(c, listing, day, start, end, adjacent):
    age = c.age_years(day)
    reasons = []
    if age >= 4:
        reasons.append({"code": "OLD_CASE", "detail": f"Waiting {int(age)} years since filing; older matters get priority"})
    if c.purpose == "JUDGEMENT":
        reasons.append({"code": "NEAR_DISPOSAL", "detail": "Judgment is the next listed purpose"})
    if adjacent:
        reasons.append({"code": "SAME_ADVOCATE", "detail": "Another matter for this advocate is listed today"})
    reasons.append({"code": "ENGINE_PRIORITY", "detail": "Selected using the supplied hearing reference and expected sitting time; confirm readiness with the registry"})
    m0 = start // 30 * 30
    chance = listing.p_sub
    return {
        "caseId": c.case_number,
        "date": day.isoformat(),
        "start": hhmm(start),
        "end": hhmm(end),
        "window": f"{hhmm(m0)}–{hhmm(m0 + 30)}",
        "block": "Morning" if listing.slot == 0 else "Afternoon",
        "likelihood": "High" if chance >= .65 else "Medium" if chance >= .4 else "Low",
        "duration": end - start,
        "reasons": reasons,
        "advocateId": c.advocate,
        "purpose": c.purpose.replace("_", " ").title(),
    }


def planned(request, rows, settings, moves, waiting):
    dates = period_days(request, settings)
    if not dates:
        return {"days": [], "recommendedCount": 0,
                "explanation": "No sitting days found in the supplied calendar for this period. Check the date or leave.",
                "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat()}
    p = policy(request["rules"], settings)
    cases = E.build_cases(rows, dates[0])
    lookup = {c.case_number: c for c in cases}
    advocates = E.make_advocates(cases, 42, 0.0)
    sched = E.Scheduler(p, TYPES, advocates)
    rng = random.Random(42)
    selected = set()
    forced_ids = {m["caseId"] for m in moves}
    waiting_ids = {item["id"] for item in waiting}
    days = []
    for date in dates:
        current = [m for m in moves if m["date"] == date.isoformat()]
        pool = [c for c in cases if c.case_number not in selected and c.case_number not in forced_ids
                and c.case_number not in waiting_ids]
        proposed = sched.build(date, pool, rng)
        forced = []
        for m in sorted(current, key=lambda item: item["order"]):
            c = lookup.get(m["caseId"])
            if not c or c.case_number in selected or c.case_number in waiting_ids:
                continue
            ht, hazards, full = sched.estimate(c, date)
            estimated = E.expected_minutes(hazards, full)
            forced.append((m, E.Listing(c, ht, estimated, full, E.p_substantive(hazards), 0.0,
                                        slot=0 if ht.minutes <= 15 else 1)))
        # Engine selects the rest. Overrides take precedence, rather than being
        # silently dropped when its recommended list filled the capacity.
        chosen = [item for item in proposed if item.case.case_number not in {l.case.case_number for _, l in forced}]
        for move, item in forced:
            chosen.insert(min(move["order"], len(chosen)), item)
        if request["rules"]["order"] == "complex-first":
            chosen.sort(key=lambda item: item.slot == 0)
        else:
            chosen.sort(key=lambda item: item.slot)
        # Preserve explicit manual ordering within the selected block.
        for move, item in forced:
            chosen.remove(item)
            chosen.insert(min(move["order"], len(chosen)), item)
        morning = mins(settings["morningStart"])
        morning_end = mins(settings["morningEnd"])
        afternoon = mins(settings["afternoonStart"])
        afternoon_end = mins(settings["afternoonEnd"])
        clock = morning
        scheduled = []
        overflow = []
        for item in chosen:
            c = item.case
            length = max(5, round(item.est_minutes))
            if clock + length > morning_end and clock < afternoon:
                clock = afternoon
            if clock + length > afternoon_end:
                overflow.append(c.case_number)
                continue
            begin = clock
            clock += length
            item.slot = 0 if begin < afternoon else 1
            scheduled.append(serialize_case(c, item, date, begin, clock,
                                            any(s["advocateId"] == c.advocate for s in scheduled)))
            selected.add(c.case_number)
        next_day = next((d.isoformat() for d in dates if d > date), "Later sitting")
        held = [
            {"caseId": c["id"], "reason": {"code": "WAITING_WARRANT", "detail": c["waitingOn"]},
             "readyDate": "Confirm with registry"}
            for c in waiting
        ]
        held += [
            {"caseId": c.case_number, "reason": {"code": "DAY_FULL", "detail": "Held for a later sitting"},
             "readyDate": next_day}
            for c in cases if c.case_number not in selected and c.case_number not in forced_ids
            and c.case_number not in waiting_ids
        ]
        used = sum(s["duration"] for s in scheduled)
        days.append({"date": date.isoformat(), "cases": scheduled, "held": held,
                     "fullness": min(100, round(used / p.day_minutes * 100)), "overflow": overflow})
    first = days[0]["cases"]
    return {"days": days, "recommendedCount": len(first),
            "explanation": f"{len(first)} matters listed using the supplied engine and hearing references. Confirm readiness before finalising.",
            "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat()}


def project(request, rows, settings, moves):
    start = dt.date.fromisoformat(request["start_date"])
    end = start + dt.timedelta(days=83)
    dates = E.load_calendar(DATA, start, end, settings["leaveDays"])
    if not dates:
        return {"metrics": {"heard": 0, "forward": 0, "unheard": 0, "oldTouched": 0, "hours": 0}, "daily": []}
    p = policy(request["rules"], settings)
    sim = E.Simulation(p, TYPES, rows, dates, seed=42, advocate_spread=0, log=True)
    if moves:
        original_build = sim.sched.build
        by_id = {c.case_number: c for c in sim.cases}
        overrides = {m["caseId"]: m for m in moves}

        def build(on, active, rng):
            pool = [c for c in active if c.case_number not in overrides
                    or on.isoformat() > overrides[c.case_number]["date"]]
            chosen = original_build(on, pool, rng)
            for move in sorted(moves, key=lambda item: item["order"]):
                if move["date"] != on.isoformat():
                    continue
                c = by_id.get(move["caseId"])
                if not c or c.disposed_on is not None:
                    continue
                ht, hazards, full = sim.sched.estimate(c, on)
                item = E.Listing(c, ht, E.expected_minutes(hazards, full), full,
                                 E.p_substantive(hazards), 0, slot=0 if ht.minutes <= 15 else 1)
                chosen.insert(min(move["order"], len(chosen)), item)
            return chosen

        sim.sched.build = build
    sim.run()
    last = start + dt.timedelta(days={"day": 0, "week": 6, "month": 29}[request["period"]])
    selected = [r for r in sim.rows_log if dt.date.fromisoformat(r["date"]) <= last]
    old_ids = {r["case_number"] for r in selected if r["outcome"] in E.HEARD_OUTCOMES and r["age_years"] >= 4}
    return {"metrics": {
        "heard": sum(r["outcome"] in E.HEARD_OUTCOMES for r in selected),
        "forward": sum(r["outcome"] == "substantive" for r in selected),
        "unheard": sum(r["outcome"] == "not_reached" for r in selected),
        "oldTouched": len(old_ids),
        "hours": round(sum(r["bench_minutes"] for r in selected) / 60, 1),
    }, "daily": sim.daily}


def main():
    payload = json.load(sys.stdin)
    rows = payload["rows"]
    waiting = payload.get("waiting", [])
    excluded = {c["id"] for c in waiting}
    active = [r for r in rows if r["case_number"] not in excluded]
    settings = payload["settings"]
    if payload["action"] == "preview":
        result = planned(payload["request"], active, settings, payload.get("moves", []), waiting)
    elif payload["action"] == "project":
        result = project(payload["request"], active, settings, payload.get("moves", []))
    else:
        raise ValueError("Unknown engine operation")
    json.dump(result, sys.stdout, allow_nan=False)


if __name__ == "__main__":
    main()