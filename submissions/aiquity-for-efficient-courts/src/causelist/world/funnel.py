"""Dispute funnel from population: how much burden reaches the court is *derived*, not hand-set.

    disputes / year (kind) = city_population / 1000 * per_1000_per_year(kind)
    legal_notice           = disputes * p(legal_notice)
    paid_on_notice         = legal_notice * p(paid_on_notice)
    negotiation            = (legal_notice - paid_on_notice) * p(negotiation)
    settled_in_negotiation = negotiation * p(settled_in_negotiation)
    complaint_filed        = (legal_notice - paid_on_notice - settled_in_negotiation) * p(complaint_filed)
    reaches_court          = complaint_filed * p(reaches_court)     (0 for kinds heard in another forum)

Every number carries a ``source`` string ("assumed" unless a public figure is in the repo docs).
Kinds heard by this court arrive in the town at the full catchment rate, so the court's inflow is
exactly the funnel's output. Other kinds are simulated as agents at ``background_sample`` of their
rate (display only -- they never reach this court).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

STAGES = ["arisen", "legal_notice", "paid_on_notice", "negotiation", "settled_in_negotiation",
          "complaint_filed", "reaches_court"]
RATE_STAGES = STAGES[1:]            # stages that carry a conversion probability
DAYS_PER_YEAR = 365.0


def _val(node: Any, default: float = 0.0) -> tuple[float, str]:
    if isinstance(node, dict):
        return float(node.get("value", default)), str(node.get("source", "assumed"))
    if node is None:
        return default, "assumed"
    return float(node), "assumed"


@dataclass
class KindFunnel:
    kind: str
    label: str
    relationship: str | None          # town relationship the dispute grows out of (None = any pair)
    forum: str                        # "this_court" or the name of the other forum
    per_1000_per_year: float
    rate_source: str
    stages: dict[str, float]
    sources: dict[str, str]

    @property
    def this_court(self) -> bool:
        return self.forum == "this_court"

    def expected(self, population: float, years: float = 1.0) -> dict[str, float]:
        p = self.stages
        n = population / 1000.0 * self.per_1000_per_year * years
        notice = n * p["legal_notice"]
        paid = notice * p["paid_on_notice"]
        neg = (notice - paid) * p["negotiation"]
        settled = neg * p["settled_in_negotiation"]
        filed = (notice - paid - settled) * p["complaint_filed"]
        reach = filed * p["reaches_court"] if self.this_court else 0.0
        return {"arisen": n, "legal_notice": notice, "paid_on_notice": paid, "negotiation": neg,
                "settled_in_negotiation": settled, "complaint_filed": filed, "reaches_court": reach}


@dataclass
class Funnel:
    city_population: float = 200_000
    population_source: str = "assumed"
    household_size_mean: float = 4.0
    household_source: str = "assumed"
    background_sample: float = 0.15
    background_source: str = "display only"
    kinds: dict[str, KindFunnel] = field(default_factory=dict)

    @property
    def households(self) -> int:
        return int(round(self.city_population / max(1.0, self.household_size_mean)))

    def arrivals_per_day(self, kind: str) -> float:
        """Rate at which this kind of dispute arises in the simulated town (per calendar day)."""
        k = self.kinds[kind]
        scale = 1.0 if k.this_court else self.background_sample
        return self.city_population / 1000.0 * k.per_1000_per_year / DAYS_PER_YEAR * scale

    def court_filings_per_year(self) -> float:
        return sum(k.expected(self.city_population)["reaches_court"] for k in self.kinds.values())

    def as_config(self) -> dict[str, Any]:
        return {
            "city_population": {"value": self.city_population, "source": self.population_source},
            "household_size_mean": {"value": self.household_size_mean, "source": self.household_source},
            "households": self.households,
            "background_sample": {"value": self.background_sample, "source": self.background_source},
            "kinds": {k.kind: {"label": k.label, "relationship": k.relationship, "forum": k.forum,
                               "per_1000_per_year": {"value": k.per_1000_per_year, "source": k.rate_source},
                               "stages": {s: {"value": k.stages[s], "source": k.sources[s]} for s in RATE_STAGES}}
                      for k in self.kinds.values()},
        }


DEFAULT_FUNNEL: dict[str, Any] = {
    "city_population": {"value": 200000, "source": "assumed"},
    "household_size_mean": {"value": 4.0, "source": "assumed"},
    "background_sample": {"value": 0.15, "source": "display only"},
    "kinds": {
        "cheque_loan": {"label": "Cheque / loan repayment", "relationship": "lender_borrower", "forum": "this_court",
                        "per_1000_per_year": 5.0,
                        "stages": {"legal_notice": 0.85, "paid_on_notice": 0.35, "negotiation": 0.5,
                                   "settled_in_negotiation": 0.3, "complaint_filed": 0.85, "reaches_court": 0.95}},
    },
}


def parse_funnel(raw: dict[str, Any] | None) -> Funnel:
    raw = raw or DEFAULT_FUNNEL
    pop, pop_src = _val(raw.get("city_population"), 200_000)
    hh, hh_src = _val(raw.get("household_size_mean"), 4.0)
    bg, bg_src = _val(raw.get("background_sample"), 0.15)
    kinds: dict[str, KindFunnel] = {}
    for name, k in (raw.get("kinds") or {}).items():
        rate, rate_src = _val(k.get("per_1000_per_year"))
        stages, sources = {}, {}
        for s in RATE_STAGES:
            v, src = _val((k.get("stages") or {}).get(s), 0.0)
            if not 0.0 <= v <= 1.0:
                raise ValueError(f"funnel {name}.{s} must be a probability, got {v}")
            stages[s], sources[s] = v, src
        forum = str(k.get("forum", "this_court"))
        if forum != "this_court":
            stages["reaches_court"] = 0.0
        kinds[name] = KindFunnel(name, str(k.get("label", name)), k.get("relationship"), forum,
                                 rate, rate_src, stages, sources)
    if not kinds:
        raise ValueError("funnel needs at least one dispute kind")
    return Funnel(pop, pop_src, hh, hh_src, bg, bg_src, kinds)


def funnel_table(funnel: Funnel, *, window_days: float | None = None,
                 observed: dict[str, dict[str, int]] | None = None,
                 sitting_days_per_year: float | None = None) -> list[dict[str, Any]]:
    """One row per (kind, stage): conversion rate + source, expected per year, and (if given)
    expected over the window and observed in the simulation. Rows for kind ``all`` sum the kinds.

    Observed counts for background kinds are scaled back up by ``1 / background_sample`` in
    ``observed_scaled`` so they compare with the expected city-wide numbers.
    """
    rows: list[dict[str, Any]] = []
    years = (window_days or 0.0) / DAYS_PER_YEAR
    totals: dict[str, dict[str, float]] = {s: {"year": 0.0, "window": 0.0, "obs": 0.0, "obs_scaled": 0.0}
                                           for s in STAGES}
    for k in funnel.kinds.values():
        exp = k.expected(funnel.city_population)
        scale = 1.0 if k.this_court else funnel.background_sample
        for s in STAGES:
            row = {"kind": k.kind, "label": k.label, "forum": k.forum, "stage": s,
                   "rate": k.per_1000_per_year if s == "arisen" else k.stages[s],
                   "rate_unit": "per 1,000 people per year" if s == "arisen" else "share of previous step",
                   "source": k.rate_source if s == "arisen" else k.sources[s],
                   "expected_per_year": round(exp[s], 1)}
            totals[s]["year"] += exp[s]
            if window_days is not None:
                row["expected_in_window"] = round(exp[s] * years, 1)
                totals[s]["window"] += exp[s] * years
            if observed is not None:
                o = observed.get(k.kind, {}).get(s, 0)
                row["observed"] = o
                row["observed_scaled"] = round(o / scale, 1) if scale else 0.0
                totals[s]["obs"] += o
                totals[s]["obs_scaled"] += row["observed_scaled"]
            rows.append(row)
    for s in STAGES:
        row = {"kind": "all", "label": "All kinds", "forum": "", "stage": s, "rate": None, "rate_unit": "",
               "source": "derived", "expected_per_year": round(totals[s]["year"], 1)}
        if window_days is not None:
            row["expected_in_window"] = round(totals[s]["window"], 1)
        if observed is not None:
            row["observed"] = int(totals[s]["obs"])
            row["observed_scaled"] = round(totals[s]["obs_scaled"], 1)
        rows.append(row)
    if sitting_days_per_year:
        per_day = funnel.court_filings_per_year() / sitting_days_per_year
        rows.append({"kind": "all", "label": "Complaints reaching this court per sitting day", "forum": "this_court",
                     "stage": "reaches_court_per_sitting_day", "rate": None, "rate_unit": "", "source": "derived",
                     "expected_per_year": round(per_day, 2)})
    return rows
