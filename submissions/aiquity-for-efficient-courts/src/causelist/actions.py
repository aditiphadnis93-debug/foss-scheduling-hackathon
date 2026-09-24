"""The three things a court does with this tool, as plain functions (the API and CLI wrap them):

1. **Create a roster**: upload a court's own roster (organiser schema) or generate a synthetic one.
2. **Generate the daily causelist**: for a roster, a court setup and a date.
3. **Suggest the next best date**: for one case and today's outcome, with the rule and alternatives.
"""
from __future__ import annotations

import copy
import csv
import io
import random
import re
from collections import Counter
from datetime import date, timedelta
from pathlib import Path
from typing import Any

from .config import load_config
from .reference import DATA_DIR, INTERRUPT_TYPES, NEXT_PURPOSE_ON_SUCCESS, load_hearing_types, working_days
from .roster import load_roster

ROSTER_DIR = Path(__file__).resolve().parents[2] / "out" / "rosters"
REQUIRED = ["case_number", "filing_number", "filing_date", "advocate_id", "party_id", "current_stage",
            "purpose_of_next_hearing"]

RULE_TEXT = {
    "procedural": "the next step normally needs this many days",
    "absence-short": "an absence gets a short, firm date (at most 14 days) so the absent side cannot stretch the case",
    "prerequisite": "listed on the day the summons, warrant or filing is expected to be ready",
    "capacity-aware": "the earliest day on or after the procedural date that still has room",
    "flat": "current practice: a flat 60 days",
    "not-reached": "not reached today: listed again on the next sitting day",
}


def _slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")[:40] or "roster"


def roster_path(key: str) -> Path | None:
    if key == "100":
        return DATA_DIR / "roster_sample_100.csv"
    if key == "3000":
        return Path(__file__).resolve().parents[2] / "data" / "roster_3000.csv"
    p = ROSTER_DIR / f"{_slug(key)}.csv"
    return p if p.exists() else None


def list_rosters() -> list[dict[str, Any]]:
    out = [{"key": "100", "label": "Sample docket (100 cases)", "source": "organiser"},
           {"key": "3000", "label": "Full docket (3,000 cases)", "source": "generated from the organiser script"}]
    if ROSTER_DIR.exists():
        for p in sorted(ROSTER_DIR.glob("*.csv")):
            out.append({"key": p.stem, "label": p.stem.replace("_", " "), "source": "uploaded or generated here"})
    return out


def summarise_roster(path: Path) -> dict[str, Any]:
    cases = load_roster(path)
    today = date(2026, 9, 28)
    ages = Counter(min(int(c.age_years(today)), 5) for c in cases)
    return {"cases": len(cases), "advocates": len({c.advocate_id for c in cases}),
            "by_stage": dict(Counter(c.stage for c in cases).most_common()),
            "by_age": {("5y+" if k == 5 else f"{k}-{k + 1}y"): v for k, v in sorted(ages.items())},
            "dispute_kinds": dict(Counter((c.meta or {}).get("kind", "not recorded") for c in cases))}


def upload_roster(name: str, text: str) -> dict[str, Any]:
    rows = list(csv.DictReader(io.StringIO(text)))
    if not rows:
        raise ValueError("the file has no rows")
    missing = [c for c in REQUIRED if c not in rows[0]]
    if missing:
        raise ValueError(f"missing columns: {', '.join(missing)}")
    ROSTER_DIR.mkdir(parents=True, exist_ok=True)
    key = _slug(name)
    p = ROSTER_DIR / f"{key}.csv"
    p.write_text(text)
    try:
        return {"key": key, **summarise_roster(p)}
    except Exception as exc:  # a bad row must not leave a broken roster behind
        p.unlink(missing_ok=True)
        raise ValueError(f"could not read the roster: {exc}") from exc


def generate_roster(num_cases: int, seed: int = 42, name: str | None = None) -> dict[str, Any]:
    """Bootstrap-resample whole rows of the organiser sample with fresh ids (same method as the
    organiser's script, no extra dependencies)."""
    num_cases = max(10, min(int(num_cases), 20000))
    with open(DATA_DIR / "roster_sample_100.csv", newline="", encoding="utf-8") as fh:
        base = list(csv.DictReader(fh))
    rng = random.Random(seed)
    per_adv = len(base) / len({r["advocate_id"] for r in base})
    n_adv = max(1, round(num_cases / per_adv))
    rows = []
    for i in range(num_cases):
        r = dict(rng.choice(base))
        y = r["filing_date"][:4]
        r["case_number"], r["filing_number"] = f"ST/{i + 1}/{y}", f"KL-{i + 1:06d}-{y}"
        r["party_id"], r["advocate_id"] = f"PARTY-{i + 1:05d}", f"ADV-{rng.randint(1, n_adv):03d}"
        rows.append(r)
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=list(base[0].keys()))
    w.writeheader()
    w.writerows(rows)
    return upload_roster(name or f"generated_{num_cases}_s{seed}", buf.getvalue())


def causelist_for(roster_key: str, config: str, day: date, seed: int = 42, overrides=None) -> dict[str, Any]:
    """Run the court forward to ``day`` and return that day's causelist (the plan is re-made each
    evening, so the list depends on everything before it)."""
    from .export import export_result
    from .simulate import DEFAULT_START, run
    p = roster_path(roster_key)
    if p is None:
        raise ValueError(f"unknown roster {roster_key}")
    cfg = load_config(config)
    if overrides is not None:
        from .api import _apply
        cfg = _apply(cfg, overrides)
    start = DEFAULT_START
    if day < start:
        raise ValueError(f"the simulated posting starts on {start.isoformat()}")
    res = run(load_roster(p), cfg, start=start, end=day, seed=seed)
    ex = export_result(res, include_cases=False, include_audit=False)
    d = next((x for x in ex["days"] if x["date"] == day.isoformat()), ex["days"][-1] if ex["days"] else None)
    if d is None:
        raise ValueError("no sitting day in that range")
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["window_start", "window_end", "case_number", "purpose", "advocate", "chance_it_goes_ahead", "why_listed"])
    for l in d["listings"]:
        w.writerow([l["start"], l["end"], l["case_id"], l["purpose"], l["advocate"], l["p_ahead"], "; ".join(l["why"])])
    return {"date": d["date"], "roster": roster_key, "config": config, "sitting_windows": d.get("sitting_windows"),
            "listings": d["listings"], "held_back": d.get("held_back", []), "held_back_capacity": d.get("held_back_capacity"),
            "expected_minutes": d.get("expected"), "capacity": d.get("capacity"), "csv": buf.getvalue()}


MAX_PREFERENCE_SLIP_DAYS = 14        # how far past the rule's date a party's preference may push a case
MAX_PREFERENCE_SLIP_DAYS_OLD = 7     # ...tighter for cases over 4 years old


def apply_preferences(rule_date: date, sittings: list[date], prefs: dict | None, age_years: float) -> tuple[date, str]:
    """Parties may name dates they prefer or want to avoid. Pick the first sitting day on/after the
    rule's date that no side has asked to avoid (a preferred day wins if it is within the limit);
    never earlier than the rule and never more than the slip limit later."""
    if not prefs:
        return rule_date, ""
    limit = MAX_PREFERENCE_SLIP_DAYS_OLD if age_years >= 4 else MAX_PREFERENCE_SLIP_DAYS
    last = rule_date + timedelta(days=limit)
    avoid = {date.fromisoformat(str(d)) for side in prefs.values() for d in (side or {}).get("avoid", [])}
    prefer = sorted({date.fromisoformat(str(d)) for side in prefs.values() for d in (side or {}).get("prefer", [])})
    window = [s for s in sittings if rule_date <= s <= last]
    for p in prefer:
        if p in window and p not in avoid:
            return p, f"a preferred date that fits the rule (within {limit} days)"
    for s in window:
        if s not in avoid:
            if s == rule_date:
                return s, "no side asked to avoid the rule's date"
            return s, f"moved past the dates a side asked to avoid (within {limit} days)"
    return rule_date, (f"the sides asked to avoid every day up to {last.isoformat()}; the case cannot wait longer "
                       f"than {limit} days past the rule, so the rule's date stands")


def suggest_next_date(roster_key: str, case_id: str, today: date, outcome: str, reason: str | None = None,
                      config: str = "optimal", preferences: dict | None = None) -> dict[str, Any]:
    """outcome: 'moved' | 'absent' | 'sought_time' | 'not_ready' | 'not_reached'.
    preferences: {"petitioner": {"prefer": [iso], "avoid": [iso]}, "respondent": {...}} (optional)."""
    from .simulate import next_date_with_rule
    p = roster_path(roster_key)
    if p is None:
        raise ValueError(f"unknown roster {roster_key}")
    case = next((c for c in load_roster(p) if c.case_id == case_id), None)
    if case is None:
        raise ValueError(f"case {case_id} is not on that roster")
    cfg = load_config(config)
    types = load_hearing_types()
    sittings = working_days(today, today + timedelta(days=200), set(cfg.leave))
    c = copy.deepcopy(case)
    kind, rsn = {"moved": ("substantive", None), "absent": ("adjourned", "Respondent Absence / Non-Compliance"),
                 "sought_time": ("adjourned", "Party Sought Time / Adjournment"),
                 "not_ready": ("not_ready", reason or "Awaiting Process / Summons / Warrant Return"),
                 "not_reached": ("not_reached", "Day ended before the matter was called")}.get(outcome, ("adjourned", reason))
    before = c.purpose
    if kind == "substantive":
        if c.purpose in INTERRUPT_TYPES:
            c.purpose = c.stage
        else:
            nxt = NEXT_PURPOSE_ON_SUCCESS.get(c.purpose)
            if nxt is None:
                return {"case_id": case_id, "disposed": True, "explanation": "Judgement delivered: the case is closed, no next date."}
            c.purpose = c.stage = nxt
    if kind == "not_ready":
        ht = types.get(c.purpose)
        c.ready_on = today + timedelta(days=max(1, (ht.ideal_gap_days if ht else 14) // 2))
    rule_date, rule = next_date_with_rule(c, kind, rsn, today, types, cfg, sittings)
    nd, pref_note = apply_preferences(rule_date, sittings, preferences, case.age_years(today))
    idx = sittings.index(nd) if nd in sittings else 0
    alts = [s for s in (sittings[idx - 1] if idx > 0 else None, sittings[idx + 1] if idx + 1 < len(sittings) else None)
            if s and s > today]
    ht = types.get(c.purpose)
    return {"case_id": case_id, "today": today.isoformat(), "outcome": outcome, "purpose_today": before,
            "next_purpose": c.purpose, "suggested": nd.isoformat(), "days_away": (nd - today).days, "rule": rule,
            "rule_in_words": RULE_TEXT.get(rule, rule),
            "rule_date": rule_date.isoformat(), "preferences_applied": pref_note,
            "procedural_gap_days": ht.ideal_gap_days if ht else None,
            "alternatives": [{"date": a.isoformat(), "days_away": (a - today).days,
                              "note": "earlier than the rule suggests" if a < nd else "later: more time to prepare"} for a in alts],
            "disposed": False}
