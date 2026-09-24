"""Priors master list: what the court believes about each hearing type before it sees today's data.

Three layers, each overriding the one below, all inspectable:

1. **Organiser tables** (``data/``): duration, ideal gap, P(substantive), and the failure-reason mix.
2. **Court master list** (``config/priors/court_default.yaml``): the court's own defaults per hearing
   type. Generated from layer 1 with ``python -m causelist.priors --write``; staff edit it as their
   own records improve. Every row carries a ``source``.
3. **Judge overrides** (``priors:`` in a judge preset): e.g. ``EVIDENCE_COMPLAINANT: {minutes: 45}``
   or ``{minutes_mult: 1.2}``. A judge knows their own bench.

The **effective** table feeds both the planner and the simulator. Online learning, when on, starts
from it as a Beta prior and reports what it learned per type, so a judge can see prior vs learned.

Editable fields: ``minutes``, ``minutes_mult``, ``ideal_gap_days``, ``p_substantive``.
Guardrails: minutes 1–240, gap 1–120 days, P(substantive) 0.01–1.0. If P(substantive) is changed,
the non-substantive reason shares are kept and rescaled.
"""
from __future__ import annotations

import argparse
import dataclasses
from pathlib import Path

import yaml

from .behaviour import conditional_probs
from .reference import HearingType, load_hearing_types

COURT_PRIORS = Path(__file__).resolve().parents[2] / "config" / "priors" / "court_default.yaml"
EDITABLE = {"minutes", "minutes_mult", "ideal_gap_days", "p_substantive"}
BOUNDS = {"minutes": (1, 240), "ideal_gap_days": (1, 120), "p_substantive": (0.01, 1.0)}


def _row(ht: HearingType, source: str) -> dict:
    p = conditional_probs(ht)
    return {"minutes": ht.minutes, "ideal_gap_days": ht.ideal_gap_days, "p_substantive": round(ht.p_substantive, 4),
            "p_prerequisite_unmet": round(ht.p_prereq, 4), "p_absent_if_ready": round(p["absent"], 4),
            "p_seek_time_if_ready": round(p["seek"], 4), "p_court_side_if_ready": round(p["court"], 4),
            "median_hearings_at_stage": ht.median_hearings, "source": source}


def _clamp(k: str, v: float) -> float:
    lo, hi = BOUNDS.get(k, (None, None))
    return v if lo is None else min(hi, max(lo, v))


def _apply(ht: HearingType, over: dict) -> HearingType:
    kw = {}
    if "minutes" in over:
        kw["minutes"] = _clamp("minutes", float(over["minutes"]))
    if "minutes_mult" in over:
        kw["minutes"] = _clamp("minutes", float(kw.get("minutes", ht.minutes)) * float(over["minutes_mult"]))
    if "ideal_gap_days" in over:
        kw["ideal_gap_days"] = int(_clamp("ideal_gap_days", float(over["ideal_gap_days"])))
    if "p_substantive" in over:
        ps = _clamp("p_substantive", float(over["p_substantive"]))
        old_non = max(1e-9, 1 - ht.p_substantive)
        scale = (1 - ps) / old_non
        kw.update(p_substantive=ps, p_prereq=ht.p_prereq * scale, p_attend=ht.p_attend * scale, p_court=ht.p_court * scale)
    return dataclasses.replace(ht, **kw) if kw else ht


def load_court_priors(path: Path | None = None) -> dict[str, dict]:
    path = path or COURT_PRIORS
    if not path.exists():
        return {}
    return (yaml.safe_load(path.read_text()) or {}).get("hearing_types", {})


def effective_types(cfg=None, base: dict[str, HearingType] | None = None) -> dict[str, HearingType]:
    """Organiser tables → court master list → judge overrides."""
    types = dict(base or load_hearing_types())
    for code, row in load_court_priors().items():
        if code in types:
            types[code] = _apply(types[code], {k: v for k, v in row.items() if k in EDITABLE})
    for code, over in ((getattr(cfg, "priors", None) or {}) if cfg is not None else {}).items():
        if code in types and isinstance(over, dict):
            types[code] = _apply(types[code], {k: v for k, v in over.items() if k in EDITABLE})
    return types


# --- By dispute type ---------------------------------------------------------------------------
# Hearings in different kinds of dispute run differently: a supplier dispute has more documents to
# prove, a wages dispute's worker can least afford a day off. Factors multiply the hearing-type
# values. All are stated assumptions (source "assumed") until the court's own records replace them.
DISPUTE_KIND_DEFAULTS = {
    "unspecified":     {"label": "Not recorded in the roster (reference)", "minutes_mult": 1.00, "absent_mult": 1.00, "source": "reference: the organiser tables are per hearing type, not per dispute type"},
    "cheque_loan":     {"label": "Cheque / loan repayment", "minutes_mult": 1.00, "absent_mult": 1.00, "source": "assumed"},
    "supplier":        {"label": "Supplier credit", "minutes_mult": 1.15, "absent_mult": 0.90, "source": "assumed: more documents, businesses attend"},
    "wages":           {"label": "Unpaid wages", "minutes_mult": 0.90, "absent_mult": 1.25, "source": "assumed: a day in court costs the worker a day's pay"},
    "rent":            {"label": "Rent / tenancy", "minutes_mult": 1.00, "absent_mult": 1.10, "source": "assumed"},
    "family_property": {"label": "Family / property", "minutes_mult": 1.30, "absent_mult": 1.15, "source": "assumed: contested facts, more parties"},
    "other":           {"label": "Other", "minutes_mult": 1.00, "absent_mult": 1.00, "source": "assumed"},
}
DEFAULT_KIND = "unspecified"      # the organiser roster carries no dispute-type column: no adjustment
_KIND_CACHE: dict | None = None


def dispute_kinds(cfg=None) -> dict[str, dict]:
    """Organiser-free defaults → court master list (``dispute_kinds:``) → judge overrides (``priors.dispute_kinds``)."""
    global _KIND_CACHE
    if _KIND_CACHE is None:
        court = {}
        if COURT_PRIORS.exists():
            court = (yaml.safe_load(COURT_PRIORS.read_text()) or {}).get("dispute_kinds", {}) or {}
        _KIND_CACHE = {k: {**v, **(court.get(k) or {})} for k, v in DISPUTE_KIND_DEFAULTS.items()}
        for k, v in court.items():
            _KIND_CACHE.setdefault(k, {"label": k, "minutes_mult": 1.0, "absent_mult": 1.0, "source": "court"} | v)
    kinds = {k: dict(v) for k, v in _KIND_CACHE.items()}
    judge = ((getattr(cfg, "priors", None) or {}).get("dispute_kinds") or {}) if cfg is not None else {}
    for k, v in judge.items():
        kinds.setdefault(k, {"label": k, "minutes_mult": 1.0, "absent_mult": 1.0})
        kinds[k].update({kk: vv for kk, vv in v.items() if kk in ("minutes_mult", "absent_mult")}, source="judge")
    for v in kinds.values():
        v["minutes_mult"] = min(2.0, max(0.5, float(v.get("minutes_mult", 1.0))))
        v["absent_mult"] = min(2.0, max(0.5, float(v.get("absent_mult", 1.0))))
    return kinds


def case_kind(case) -> str:
    return (getattr(case, "meta", {}) or {}).get("kind") or DEFAULT_KIND


def kind_factors(case, cfg=None) -> tuple[float, float]:
    k = dispute_kinds(cfg).get(case_kind(case)) or {}
    return float(k.get("minutes_mult", 1.0)), float(k.get("absent_mult", 1.0))


def master_list(cfg=None, learned: dict | None = None) -> dict:
    """The full table for the web: organiser, court, judge override, effective, and learned per type."""
    org = load_hearing_types()
    court = load_court_priors()
    judge = (getattr(cfg, "priors", None) or {}) if cfg is not None else {}
    eff = effective_types(cfg, org)
    rows = []
    for code in org:
        rows.append({"hearing_type": code, "organiser": _row(org[code], "organiser tables"),
                     "court": court.get(code), "judge_override": judge.get(code),
                     "effective": _row(eff[code], "effective"),
                     "learned": (learned or {}).get(code)})
    return {"layers": ["organiser", "court", "judge_override", "effective", "learned"],
            "editable": sorted(EDITABLE), "bounds": BOUNDS, "rows": rows,
            "dispute_kinds": [{"kind": k, **v} for k, v in dispute_kinds(cfg).items()]}


def write_court_default(path: Path | None = None) -> Path:
    path = path or COURT_PRIORS
    path.parent.mkdir(parents=True, exist_ok=True)
    rows = {code: {"minutes": ht.minutes, "ideal_gap_days": ht.ideal_gap_days,
                   "p_substantive": round(ht.p_substantive, 4),
                   "source": "organiser tables (hearing_type_reference, substantiveness_by_hearing_type)"}
            for code, ht in load_hearing_types().items()}
    header = ("# Court master list of priors per hearing type. Edit as the court's own records improve;\n"
              "# keep `source` honest. Judge presets can override any row under `priors:`.\n"
              "# Editable: minutes, minutes_mult, ideal_gap_days, p_substantive (see causelist/priors.py).\n")
    path.write_text(header + yaml.safe_dump({"hearing_types": rows}, sort_keys=True))
    return path


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--write", action="store_true", help="(re)generate config/priors/court_default.yaml")
    a = ap.parse_args()
    if a.write:
        print("wrote", write_court_default())
    for r in master_list()["rows"]:
        e = r["effective"]
        print(f"{r['hearing_type']:30} {e['minutes']:>6} min  gap {e['ideal_gap_days']:>3} d  P(sub) {e['p_substantive']:.2f}")
