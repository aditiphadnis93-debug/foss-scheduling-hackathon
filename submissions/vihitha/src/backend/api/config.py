"""Runtime configuration from environment variables."""
from __future__ import annotations

import os
from datetime import date
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
STATE_DIR = Path(os.environ.get("VIHITHA_STATE_DIR", BACKEND_DIR / "state"))
DB_URL = os.environ.get("VIHITHA_DB_URL", f"sqlite:///{(STATE_DIR / 'vihitha.db').as_posix()}")
DATA_DIR = os.environ.get("VIHITHA_DATA_DIR")  # None -> engine default (bundled organisers' data)
DEMO_TODAY = date.fromisoformat(os.environ.get("DEMO_TODAY", "2026-09-24"))
AUTOLOAD_SAMPLE = os.environ.get("VIHITHA_AUTOLOAD", "1") == "1"
# Default roster: the case study's scale (3,000 cases bootstrapped from the 100-case sample
# with the organisers' generate_roster.py logic). Set VIHITHA_DEFAULT_ROSTER=SAMPLE for the raw 100.
DEFAULT_ROSTER = os.environ.get("VIHITHA_DEFAULT_ROSTER", "GENERATE").upper()
DEFAULT_ROSTER_N = int(os.environ.get("VIHITHA_DEFAULT_ROSTER_N", "3000"))
CORS_ORIGINS = [o.strip() for o in os.environ.get("CORS_ORIGINS", "*").split(",") if o.strip()]
COURT_NAME = os.environ.get("VIHITHA_COURT_NAME", "Judicial First Class Magistrate Court (NI Act), Court Room 3")
COURT_ADDRESS = os.environ.get("VIHITHA_COURT_ADDRESS", "Court Complex, Kochi, Kerala")
FORECAST_HORIZON_END = date.fromisoformat(os.environ.get("VIHITHA_FORECAST_END", "2026-12-31"))
SEED = int(os.environ.get("VIHITHA_SEED", "42"))
DEFAULT_HORIZON_WORKING_DAYS = 20  # [ASSUMPTION]
DEFAULT_WINDOW_MINUTES = 30  # [ASSUMPTION]
WHATIF_TTL_SECONDS = 30 * 60
