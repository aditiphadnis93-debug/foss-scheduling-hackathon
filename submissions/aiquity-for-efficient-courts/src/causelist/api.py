"""Local HTTP API for live what-if runs from the web app.

    PYTHONPATH=src uvicorn causelist.api:app --port 8000
"""
from __future__ import annotations

import copy
import dataclasses
from datetime import date, timedelta
from functools import lru_cache
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from .config import MIN_AGEING_SHARE, check_day_profile, list_presets, load_config, sitting_minutes
from .export import export_result
from .montecarlo import run_many
from .roster import load_roster
from .reference import load_hearing_types
from .simulate import DEFAULT_END, DEFAULT_START, build_behaviour, run

ROSTERS = {"100": None, "3000": str(Path(__file__).resolve().parents[2] / "data" / "roster_3000.csv")}

app = FastAPI(title="AIQuity for Efficient Courts API")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@lru_cache(maxsize=8)
def _roster(key: str):
    if key in ROSTERS:
        return load_roster(ROSTERS[key])
    from .actions import roster_path
    p = roster_path(key)
    if p is None:
        raise HTTPException(400, f"unknown roster {key}")
    return load_roster(p)


class Overrides(BaseModel):
    ageing_share: float | str | None = None
    fill_target: float | None = None
    overbook: float | None = None
    risk_kappa: float | None = None
    max_listed: int | None = None
    cluster: float | None = None
    fresh: float | None = None
    age: float | None = None
    carry_over: str | None = None
    next_date_policy: str | None = None
    use_readiness: bool | None = None
    give_appointments: bool | None = None
    use_horizon: bool | None = None
    horizon_days: int | None = None
    advocate_correlation: bool | None = None
    advocate_daily_cap: int | None = Field(None, ge=1, le=20)
    # court operations
    reserve_minutes: int | None = None
    urgent_per_day: float | None = None
    judge_emergency_p: float | None = None
    learning: bool | None = None
    gaming_share: float | None = None
    gaming_response: bool | None = None
    agency_delay_mult: float | None = None
    absence_mult: float | None = None      # behaviour slider: passed to the behaviour model when it supports it
    day_profile: dict | None = None        # per-weekday sittings / lunch / admin (guardrails -> HTTP 422)
    judge: dict | None = None              # {background, years_on_bench, specialisations} (duration_model)
    leave: list[date] = Field(default_factory=list)


class RunRequest(BaseModel):
    roster: str = "100"
    config: str = "optimal"
    overrides: Overrides = Field(default_factory=Overrides)
    seed: int = 42
    sitting_days: int | None = None     # shorten the window for fast what-if
    include_cases: bool = False


def _apply(cfg, o: Overrides):
    for k in ("fill_target", "overbook", "risk_kappa", "max_listed", "carry_over", "next_date_policy",
              "use_readiness", "give_appointments", "use_horizon", "horizon_days", "advocate_correlation", "advocate_daily_cap",
              "reserve_minutes", "urgent_per_day", "judge_emergency_p", "learning", "gaming_share",
              "gaming_response", "agency_delay_mult"):
        v = getattr(o, k)
        if v is not None and hasattr(cfg, k):
            setattr(cfg, k, v)
    if o.ageing_share is not None:
        cfg.ageing_share = o.ageing_share if o.ageing_share == "auto" else max(float(o.ageing_share), MIN_AGEING_SHARE)
    for k in ("cluster", "fresh", "age"):
        v = getattr(o, k)
        if v is not None:
            setattr(cfg.weights, k, v)
    if o.judge is not None:
        cfg.judge = o.judge or None     # {} clears the setup's judge profile
    if o.day_profile is not None:
        cfg.day_profile = o.day_profile or None
        errs = check_day_profile(cfg)
        if errs:
            raise HTTPException(422, {"guardrail": errs})
        if cfg.day_profile:     # same rule as load_config: day_minutes = the longest weekday
            ref = date(2026, 9, 28)
            cfg.day_minutes = max(sitting_minutes(cfg, date.fromordinal(ref.toordinal() + i)) for i in range(5))
    if cfg.planner != "baseline":
        cfg.enforce_floors()
    cfg.leave = list(o.leave)
    return cfg


def _end_for(days: int | None) -> date:
    if not days:
        return DEFAULT_END
    return DEFAULT_START + timedelta(days=int(days * 7 / 5) + 3)


@app.get("/api/presets")
def presets() -> dict[str, Any]:
    return {"presets": {p: dataclasses.asdict(load_config(p)) for p in list_presets()},
            "floors": {"min_ageing_share": MIN_AGEING_SHARE}}


@app.post("/api/run")
def run_one(req: RunRequest) -> dict[str, Any]:
    cfg = _apply(load_config(req.config), req.overrides)
    res = run(copy.deepcopy(_roster(req.roster)), cfg, start=DEFAULT_START, end=_end_for(req.sitting_days), seed=req.seed,
              absence_mult=req.overrides.absence_mult)
    return export_result(res, include_cases=req.include_cases)


@app.post("/api/compare")
def compare(req: RunRequest, seeds: int = 3) -> dict[str, Any]:
    """Modified config vs the unmodified preset, averaged over seeds (single-seed what-ifs are noisy)."""
    roster = _roster(req.roster)
    end = _end_for(req.sitting_days)
    base_cfg = load_config(req.config)
    mod_cfg = _apply(load_config(req.config), req.overrides)
    types = load_hearing_types()
    am = req.overrides.absence_mult
    # build behaviours the way ``run`` does (gaming share, learning), so both arms see the same world
    base_f = lambda s: build_behaviour(base_cfg, s, types)
    mod_f = lambda s: build_behaviour(mod_cfg, s, types, absence_mult=am)
    return {"base": run_many(roster, base_cfg, seeds, start=DEFAULT_START, end=end, behaviour_factory=base_f),
            "modified": run_many(roster, mod_cfg, seeds, start=DEFAULT_START, end=end, behaviour_factory=mod_f)}


class AnnotationIn(BaseModel):
    case_id: str
    day: date
    field: str
    predicted: Any = None
    judge_value: Any = None
    note: str = ""
    annotator: str = "judge"


@app.post("/api/annotations")
def annotate(a: AnnotationIn) -> dict[str, Any]:
    """Judge feedback on a prediction -> out/annotations.csv (data loop for recalibration)."""
    from .agents.annotations import save_annotation
    from .domain import Annotation
    save_annotation(Annotation(**(a.model_dump() if hasattr(a, "model_dump") else a.dict())))
    return {"saved": True}


@app.get("/api/annotations")
def annotations() -> dict[str, Any]:
    from .agents.annotations import load_annotations
    return {"annotations": [dataclasses.asdict(x) if dataclasses.is_dataclass(x) else x for x in load_annotations()]}


class AskIn(BaseModel):
    question: str
    day: str
    roster: str = "100"
    config: str = "optimal"
    run_file: str | None = None      # e.g. "run_100_agents.json" (in web/public/data)


@app.post("/api/ask")
def ask_assistant(q: AskIn) -> dict[str, Any]:
    """Court assistant: an AI agent answers the judge from the day's own record (offline fallback)."""
    import json as _json
    from . import assistant
    data_dir = Path(__file__).resolve().parents[2] / "web" / "public" / "data"
    name = q.run_file or f"run_{q.roster}_{q.config}.json"
    path = (data_dir / Path(name).name)
    if not path.exists():
        raise HTTPException(404, f"no run file {path.name}")
    return assistant.ask(q.question, _json.loads(path.read_text()), q.day, assistant.make_client())


class ProposeIn(AskIn):
    test: bool = True               # also run the proposal through the engine and return the effect
    sitting_days: int = 10


@app.post("/api/assistant")
def assistant_propose(q: ProposeIn) -> dict[str, Any]:
    """The assistant explains the problem, proposes changes to the judge's own settings (within
    guardrails), and the engine tests the proposal on the same court. The judge decides."""
    import json as _json
    from . import assistant
    data_dir = Path(__file__).resolve().parents[2] / "web" / "public" / "data"
    name = q.run_file or f"run_{q.roster}_{q.config}.json"
    path = data_dir / Path(name).name
    if not path.exists():
        raise HTTPException(404, f"no run file {path.name}")
    cfg = load_config(q.config)
    current = {k: getattr(cfg, k, getattr(cfg.weights, k, None)) for k in assistant.LEVERS}
    out = assistant.propose(q.question, _json.loads(path.read_text()), q.day, assistant.make_client(), current)
    if q.test and out.get("proposal"):
        ov = Overrides(**{k: v for k, v in out["proposal"].items()})
        req = RunRequest(roster=q.roster, config=q.config, overrides=ov, sitting_days=q.sitting_days)
        res = compare(req, seeds=2)
        keys = ["justice_weighted_progress_per_hour", "substantive_total", "disposed", "reach_rate_pct",
                "utilisation_pct", "advocate_trips", "backlog_4y_heard_pct"]
        out["effect"] = {k: {"now": res["base"][k]["mean"], "with_change": res["modified"][k]["mean"]}
                         for k in keys if k in res["base"]}
    return out


# --- The three court actions: create a roster, generate a causelist, suggest a next date -------
class RosterUpload(BaseModel):
    name: str
    csv: str


class RosterGenerate(BaseModel):
    num_cases: int = 500
    seed: int = 42
    name: str | None = None


class CauselistIn(BaseModel):
    roster: str = "100"
    config: str = "optimal"
    date: date
    seed: int = 42
    overrides: Overrides = Field(default_factory=Overrides)


class NextDateIn(BaseModel):
    roster: str = "100"
    case_id: str
    today: date
    outcome: str = "absent"          # moved | absent | sought_time | not_ready | not_reached
    config: str = "optimal"
    preferences: dict | None = None  # {"petitioner": {"prefer": [...], "avoid": [...]}, "respondent": {...}}


def _act(fn, *a, **k):
    try:
        return fn(*a, **k)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@app.get("/api/rosters")
def rosters() -> dict[str, Any]:
    from .actions import list_rosters
    return {"rosters": list_rosters()}


@app.post("/api/roster/upload")
def roster_upload(r: RosterUpload) -> dict[str, Any]:
    from .actions import upload_roster
    _roster.cache_clear()
    return _act(upload_roster, r.name, r.csv)


@app.post("/api/roster/generate")
def roster_generate(r: RosterGenerate) -> dict[str, Any]:
    from .actions import generate_roster
    _roster.cache_clear()
    return _act(generate_roster, r.num_cases, r.seed, r.name)


@app.post("/api/causelist")
def causelist(r: CauselistIn) -> dict[str, Any]:
    from .actions import causelist_for
    return _act(causelist_for, r.roster, r.config, r.date, r.seed, r.overrides)


@app.post("/api/next-date")
def next_date(r: NextDateIn) -> dict[str, Any]:
    from .actions import suggest_next_date
    return _act(suggest_next_date, r.roster, r.case_id, r.today, r.outcome, None, r.config, r.preferences)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"ok": "true"}
