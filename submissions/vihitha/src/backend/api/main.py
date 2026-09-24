"""FastAPI app: `uvicorn api.main:app --reload --port 8000`."""
from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import config, errors
from .db import init_db
from .routers import insights, rules, schedule, setup
from .services import setup_service


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    setup_service.ensure_loaded()
    yield


app = FastAPI(title="Vihitha API", version="3.0.0", lifespan=lifespan,
              description="Real court schedule (SQLite) with a what-if simulator. See API_CONTRACT_v3.md.")
app.add_middleware(CORSMiddleware, allow_origins=config.CORS_ORIGINS, allow_credentials=False,
                   allow_methods=["*"], allow_headers=["*"])
errors.install(app)
for r in (setup.router, rules.router, schedule.router, insights.router):
    app.include_router(r, prefix="/api/v1")
