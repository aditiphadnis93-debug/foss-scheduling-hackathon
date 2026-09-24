"""HTTP API over the workspace service. The role comes from the X-Role header (no auth: identity belongs to DRISTI)."""

from __future__ import annotations

from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from . import service as S

app = FastAPI(title="Scheduling Justice — court app API")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

ROLES = {"Judge", "Court Master", "Analyst"}


def _role(x_role: str | None) -> str:
    role = x_role or "Analyst"
    if role not in ROLES:
        raise HTTPException(400, f"Unknown role {role!r}")
    return role


def _guard(fn, *a, **kw):
    try:
        return fn(*a, **kw)
    except S.Forbidden as e:
        raise HTTPException(403, str(e))
    except S.Conflict as e:
        raise HTTPException(409, str(e))
    except (KeyError, FileNotFoundError, AttributeError, IndexError):
        raise HTTPException(404, "Not found")


class NewWorkspace(BaseModel):
    name: str
    roster: str = "generated"  # "sample" | "generated"
    size: int = 3000
    advocates: str = "uniform"
    preset: str = "balanced"
    seed: int = 0
    csv: str | None = None  # roster file contents when roster == "csv"


@app.get("/api/presets")
def presets():
    return [{"id": k, "label": v[0]} for k, v in S.PRESETS.items()]


@app.get("/api/workspaces")
def workspaces():
    return S.list_workspaces()


@app.post("/api/workspaces")
def create(body: NewWorkspace, x_role: str | None = Header(None)):
    try:
        return S.create_workspace(body.name, body.roster, body.size, body.advocates, body.preset, body.seed,
                                  _role(x_role), csv_text=body.csv)
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.get("/api/workspaces/{ws}")
def summary(ws: str):
    return _guard(S.summary, ws)


@app.get("/api/workspaces/{ws}/today")
def today(ws: str):
    return _guard(S.today, ws)


@app.post("/api/workspaces/{ws}/approve")
def approve(ws: str, x_role: str | None = Header(None)):
    return _guard(S.approve, ws, _role(x_role))


@app.post("/api/workspaces/{ws}/run")
def run(ws: str, x_role: str | None = Header(None)):
    return _guard(S.run_day, ws, _role(x_role))


@app.post("/api/workspaces/{ws}/run-days")
def run_days(ws: str, n: int = 5, x_role: str | None = Header(None)):
    return _guard(S.run_days, ws, n, _role(x_role))


@app.get("/api/workspaces/{ws}/health")
def health(ws: str):
    return _guard(S.health, ws)


@app.get("/api/workspaces/{ws}/cases/{case_idx}")
def case(ws: str, case_idx: int):
    return _guard(S.case_view, ws, case_idx)


@app.get("/api/workspaces/{ws}/days")
def days(ws: str):
    return _guard(S.days, ws)


@app.get("/api/workspaces/{ws}/days/{day_idx}")
def day(ws: str, day_idx: int):
    return _guard(S.day_detail, ws, day_idx)


@app.get("/api/workspaces/{ws}/events")
def events(ws: str):
    return _guard(S.events, ws)


# --- Slice 2 ---------------------------------------------------------------------------------
class ForecastBody(BaseModel):
    options: list[dict] = []
    weeks: int = 4
    samples: int = 3


class ApplyBody(BaseModel):
    option: dict


@app.get("/api/workspaces/{ws}/candidates")
def candidates(ws: str, limit: int = 40, q: str | None = None):
    return _guard(S.candidates, ws, limit, q)


@app.get("/api/workspaces/{ws}/rules")
def rules(ws: str):
    return _guard(S.rules, ws)


@app.get("/api/presets/{preset}/params")
def preset_params(preset: str):
    return _guard(S.preset_params, preset)


@app.post("/api/workspaces/{ws}/forecast")
def forecast(ws: str, body: ForecastBody):
    return _guard(S.forecast, ws, body.options, body.weeks, body.samples)


@app.post("/api/workspaces/{ws}/apply")
def apply(ws: str, body: ApplyBody, x_role: str | None = Header(None)):
    return _guard(S.apply, ws, body.option, _role(x_role))


@app.get("/api/workspaces/{ws}/calendar")
def calendar(ws: str, weeks: int = 6):
    return _guard(S.calendar, ws, weeks)


@app.get("/api/workspaces/{ws}/overrides")
def overrides(ws: str):
    return _guard(S.pending_overrides, ws)


# --- Model story: what changed in the model, why, and what happened ---------------------------
@app.get("/api/story")
def story():
    import json
    from pathlib import Path
    p = Path("results/model_story.json")
    if not p.exists():
        from ..story import build
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(build(), default=float))
    return json.loads(p.read_text())



@app.get("/api/workspaces/{ws}/changes")
def changes(ws: str):
    return _guard(S.changes, ws)



class RosterFile(BaseModel):
    csv: str


@app.post("/api/roster/preview")
def roster_preview(body: RosterFile):
    return S.preview_roster(body.csv)


@app.get("/api/roster/template.csv")
def roster_template():
    from fastapi.responses import PlainTextResponse
    from ..data import DATA_DIR
    text = (DATA_DIR / "roster_sample_100.csv").read_text()
    return PlainTextResponse(text, media_type="text/csv",
                             headers={"Content-Disposition": "attachment; filename=roster_template.csv"})
