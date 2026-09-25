"""The app's working database: the generated dataset (data/synthetic/*.parquet) loaded into DuckDB.

Judges, courtrooms, presets, leave, advocates, parties, cases and their history all come from here.
Only the plan is computed live by the pipeline; saved schedules go back into the schema's own run
tables (see scheduler/runs.py). The pipeline stages never read the store: the app converts rows to
`Case` and `JudgeConfig` here and hands those over, so the stages stay pure.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import date, timedelta
from functools import cached_property
from pathlib import Path

import duckdb
import pandas as pd

from .config import from_dict
from .data import HEARING_TYPES
from .models import Case, JudgeConfig

ROOT = Path(__file__).resolve().parent.parent
DATASET_DIR = ROOT / "data" / "synthetic"
DB_PATH = ROOT / "data" / "court.duckdb"
OPEN_TASK = ("pending", "dispatched", "unserved", "returned")


@dataclass(frozen=True)
class JudgeRow:
    id: str
    name: str
    hall_id: str
    hall: str  # 'Court 1'
    preset_id: str
    preset_name: str


@dataclass
class Directory:
    """Display names. Party keys are `party.person_key`, so one litigant spans cases."""
    advocates: dict[str, str] = field(default_factory=dict)
    persons: dict[str, str] = field(default_factory=dict)
    organisations: set[str] = field(default_factory=set)

    def advocate(self, aid: str) -> str:
        return self.advocates.get(aid, aid)

    def person(self, key: str) -> str:
        return self.persons.get(key, key)

    def parties(self, keys) -> str:
        names = [self.person(k) for k in keys]
        return f"{names[0]} v. {', '.join(names[1:])}" if len(names) > 1 else (names[0] if names else "")


class Store:
    def __init__(self, db: Path, dataset: Path):
        self.db, self.dataset = Path(db), Path(dataset)
        self.con = duckdb.connect(str(self.db))
        self.manifest = json.loads(self.con.execute("SELECT value FROM app_meta WHERE key = 'manifest'").fetchone()[0])
        self.today = date.fromisoformat(self.manifest["today"])

    def close(self) -> None:
        self.con.close()

    # ------------------------------------------------------------------ plumbing

    def cursor(self) -> duckdb.DuckDBPyConnection:
        """One cursor per call: Streamlit reruns on several threads and a connection isn't thread-safe."""
        return self.con.cursor()

    def rows(self, sql: str, params: list | dict | None = None) -> list[dict]:
        cur = self.cursor()
        res = cur.execute(sql, params or [])
        cols = [d[0] for d in res.description]
        return [dict(zip(cols, r)) for r in res.fetchall()]

    def df(self, sql: str, params: list | dict | None = None) -> pd.DataFrame:
        return self.cursor().execute(sql, params or []).df()

    @property
    def stale(self) -> bool:
        """The dataset on disk was regenerated after this DB was loaded."""
        path = self.dataset / "manifest.json"
        return path.exists() and json.loads(path.read_text()) != self.manifest

    def hearing_type_mismatches(self) -> list[str]:
        out = []
        rows = {r["code"]: r for r in self.rows("SELECT * FROM hearing_type")}
        for code, h in HEARING_TYPES.items():
            r = rows.get(code)
            if r is None:
                out.append(f"{code}: missing from hearing_type")
                continue
            for f in ("priority", "est_minutes", "p_heard", "p_effective", "ideal_gap_days", "min_gap_days"):
                if r[f] != getattr(h, f):
                    out.append(f"{code}.{f}: table {r[f]} vs code {getattr(h, f)}")
        out += [f"{c}: in hearing_type but not in scheduler/data.py" for c in rows.keys() - HEARING_TYPES.keys()]
        return out

    def hearing_types_df(self) -> pd.DataFrame:
        return self.df("SELECT * EXCLUDE (additional_details) FROM hearing_type ORDER BY priority, code")

    # ------------------------------------------------------------------ who and where

    @cached_property
    def judges(self) -> list[JudgeRow]:
        return [JudgeRow(**r) for r in self.rows("""
            SELECT j.id, j.name, h.id AS hall_id, h.hall_number AS hall, p.id AS preset_id, p.name AS preset_name
            FROM judge j JOIN scheduling_preset p ON p.judge_id = j.id LEFT JOIN court_hall h ON h.id = p.court_hall_id
            ORDER BY try_cast(regexp_extract(h.hall_number, '\\d+') AS INTEGER), h.hall_number, j.id""")]

    def judge(self, judge_id: str) -> JudgeRow:
        return next(j for j in self.judges if j.id == judge_id)

    def preset_dict(self, judge_id: str) -> dict:
        """The judge's preset in the presets/*.yaml shape, as stored (before locked-rule clamping)."""
        p = self.rows("""SELECT p.*, h.hall_number FROM scheduling_preset p
                         LEFT JOIN court_hall h ON h.id = p.court_hall_id WHERE p.judge_id = ?""", [judge_id])[0]
        blocks = self.rows("SELECT * FROM time_block WHERE preset_id = ? ORDER BY rowid", [p["id"]])
        leave = sorted({lo + timedelta(days=i)
                        for lo, hi in self.cursor().execute(
                            "SELECT from_date, to_date FROM judge_leave WHERE judge_id = ?", [judge_id]).fetchall()
                        for i in range((hi - lo).days + 1)})
        d = {
            "name": p["name"], "courtroom": p["hall_number"],
            "max_cases_per_day": p["max_cases_per_day"], "listing_factor": p["listing_factor"],
            "clustering": p["clustering"], "rollover": p["rollover"],
            "case_types": p["case_type_codes"] or None,
            "cover_page_for": p["requires_cover_page_for"] or [],
            "weights": json.loads(p["weights"]) if p["weights"] else {},
            "blocks": [{"name": b["name"], "start": f"{b['start_time']:%H:%M}", "end": f"{b['end_time']:%H:%M}",
                        "purposes": list(b["purpose_codes"]), "weekdays": list(b["weekdays"]),
                        "sort_by": b["sort_by"]} for b in blocks],
            "leave": [d.isoformat() for d in leave],
            "style": json.loads(p["additional_details"] or "{}").get("style"),
        }
        return {k: v for k, v in d.items() if v is not None}

    def config(self, judge_id: str, overrides: dict | None = None) -> JudgeConfig:
        """Preset + UI overrides, through the same loader as YAML, so locked rules are clamped."""
        return from_dict({**self.preset_dict(judge_id), **(overrides or {})})

    @cached_property
    def directory(self) -> Directory:
        d = Directory()
        d.advocates = dict(self.cursor().execute("SELECT id, name FROM advocate").fetchall())
        for key, name, org in self.cursor().execute("""
                SELECT coalesce(person_key, id), any_value(name), bool_or(party_category = 'organisation')
                FROM party GROUP BY 1""").fetchall():
            d.persons[key] = name
            if org:
                d.organisations.add(key)
        return d

    # ------------------------------------------------------------------ cases

    def cases(self, judge_id: str) -> list[Case]:
        """Pending cases on this judge's board as scheduler input. `next_date` stays unset: the plan is live."""
        rows = self.rows("""
            SELECT id, filing_date, case_type_code, next_purpose_code, last_heard_date, adjournment_count,
                   consecutive_skips, is_urgent, is_on_hold OR status IN ('stayed', 'sine_die') AS on_hold
            FROM court_case WHERE judge_id = ? AND status <> 'disposed' AND next_purpose_code IS NOT NULL
            ORDER BY id""", [judge_id])
        advs: dict[str, list[str]] = {}
        for cid, aid in self.cursor().execute("""
                SELECT m.case_id, m.advocate_id FROM advocate_mapping m
                JOIN court_case c ON c.id = m.case_id LEFT JOIN party p ON p.id = m.party_id
                WHERE c.judge_id = ? AND m.is_active
                ORDER BY m.case_id, m.advocate_type <> 'primary', p.party_type = 'respondent', m.id""",
                [judge_id]).fetchall():
            advs.setdefault(cid, []).append(aid)
        parties: dict[str, list[str]] = {}
        for cid, key in self.cursor().execute("""
                SELECT p.case_id, coalesce(p.person_key, p.id) FROM party p JOIN court_case c ON c.id = p.case_id
                WHERE c.judge_id = ? AND p.is_active ORDER BY p.case_id, p.party_type = 'respondent', p.id""",
                [judge_id]).fetchall():
            parties.setdefault(cid, []).append(key)
        blocked = {r[0] for r in self.cursor().execute(f"""
                SELECT DISTINCT t.case_id FROM task t JOIN court_case c ON c.id = t.case_id
                WHERE c.judge_id = ? AND t.service_status IN {OPEN_TASK}
                  AND (t.blocks_hearing_type IS NULL OR t.blocks_hearing_type = c.next_purpose_code)""",
                [judge_id]).fetchall()}
        return [Case(
            id=r["id"], filing_date=r["filing_date"], case_type=r["case_type_code"],
            purpose=r["next_purpose_code"], advocate_ids=list(dict.fromkeys(advs.get(r["id"], []))) or ["—"],
            last_heard=r["last_heard_date"], adjournment_count=r["adjournment_count"] or 0,
            consecutive_skips=r["consecutive_skips"] or 0, prerequisites_met=r["id"] not in blocked,
            urgent=bool(r["is_urgent"]), on_hold=bool(r["on_hold"]), parties=parties.get(r["id"], []),
        ) for r in rows]

    @cached_property
    def case_numbers(self) -> dict[str, str]:
        return dict(self.cursor().execute("SELECT id, court_case_number FROM court_case").fetchall())

    def case_meta(self, case_id: str) -> dict:
        return self.rows("""SELECT id, court_case_number, case_title, status, nature, next_hearing_date,
                                   registration_date, cnr_number FROM court_case WHERE id = ?""", [case_id])[0]

    # ------------------------------------------------------------------ history

    def timeline(self, case_id: str) -> list[dict]:
        return self.rows("""
            SELECT t.*, h.hearing_type_code FROM case_timeline t
            LEFT JOIN hearing h ON t.source_table = 'hearing' AND h.id = t.source_id
            WHERE t.case_id = ? ORDER BY t.event_date, t.seq, t.source_id""", [case_id])

    def facts_many(self, case_ids: list[str]) -> dict[str, dict]:
        if not case_ids:
            return {}
        return {r["case_id"]: r for r in self.rows(
            "SELECT * FROM case_summary_facts WHERE case_id IN (SELECT unnest(?::VARCHAR[]))", [list(case_ids)])}

    def facts(self, case_id: str) -> dict:
        return self.facts_many([case_id])[case_id]

    def open_tasks(self, case_id: str) -> list[dict]:
        return self.rows(f"""SELECT task_type, task_description, created_date, due_date, service_status,
                                    blocks_hearing_type FROM task
                             WHERE case_id = ? AND service_status IN {OPEN_TASK} ORDER BY created_date""", [case_id])

    # ------------------------------------------------------------------ docket insights

    def docket(self, judge_id: str) -> dict[str, pd.DataFrame]:
        """Insights over this judge's pending docket, as of the dataset's today."""
        p, pj = {"judge": judge_id, "today": self.today}, {"judge": judge_id}
        age = "date_diff('day', c.filing_date, $today) / 365.25"
        pending = "c.judge_id = $judge AND c.status <> 'disposed'"
        open_tasks = f"(SELECT DISTINCT case_id FROM task WHERE service_status IN {OPEN_TASK})"
        return {
            "ages": self.df(f"""
                SELECT CASE WHEN a < 1 THEN '<1y' WHEN a < 3 THEN '1-3y' WHEN a < 4 THEN '3-4y'
                            WHEN a < 5 THEN '4-5y' ELSE '5y+' END AS bucket, count(*) AS cases
                FROM (SELECT {age} AS a FROM court_case c WHERE {pending}) GROUP BY bucket ORDER BY bucket""", p),
            "stuck": self.df(f"""
                SELECT c.next_purpose_code AS "Purpose", count(*) AS "Cases",
                       count(o.case_id) AS "Prerequisite pending",
                       round(avg(c.adjournment_count), 1) AS "Avg adjournments"
                FROM court_case c LEFT JOIN {open_tasks} o ON o.case_id = c.id
                WHERE {pending} GROUP BY 1 ORDER BY "Cases" DESC""", pj),
            "reasons": self.df("""
                SELECT r.name AS "Reason", r.attributable_to AS "Attributable to",
                       r.preventable_by_scheduler AS "Preventable by scheduler", count(*) AS "Adjournments"
                FROM adjournment a JOIN adjournment_reason r ON r.code = a.reason_code
                JOIN hearing h ON h.id = a.hearing_id WHERE h.judge_id = $judge
                GROUP BY ALL ORDER BY "Adjournments" DESC""", pj),
            "advocates": self.df(f"""
                SELECT v.name AS "Advocate", v.designation AS "Designation", count(DISTINCT m.case_id) AS "Matters"
                FROM advocate_mapping m JOIN advocate v ON v.id = m.advocate_id JOIN court_case c ON c.id = m.case_id
                WHERE {pending} AND m.is_active GROUP BY ALL ORDER BY "Matters" DESC LIMIT 15""", pj),
            "repeat": self.df(f"""
                SELECT c.court_case_number AS "Case", c.case_title AS "Title", c.next_purpose_code AS "Purpose",
                       c.adjournment_count AS "Adjournments", round({age}, 1) AS "Age (y)",
                       f.top_adjournment_reason AS "Top reason"
                FROM court_case c JOIN case_summary_facts f ON f.case_id = c.id
                WHERE {pending} AND c.adjournment_count >= 5 ORDER BY c.adjournment_count DESC LIMIT 50""", p),
        }


# ---------------------------------------------------------------------- opening / (re)loading

def _manifest(dataset: Path) -> dict:
    return json.loads((dataset / "manifest.json").read_text())


def _recorded_manifest(db: Path) -> dict | None:
    try:
        with duckdb.connect(str(db), read_only=True) as con:
            row = con.execute("SELECT value FROM app_meta WHERE key = 'manifest'").fetchone()
        return json.loads(row[0]) if row else None
    except duckdb.Error:
        return None  # legacy DB (old roster table) or unreadable: rebuild


def load_dataset(db: Path = DB_PATH, dataset: Path = DATASET_DIR) -> None:
    """(Re)build the working DB from the dataset. Discards saved schedules."""
    from datagen import schema

    for p in (db, Path(f"{db}.wal")):
        p.unlink(missing_ok=True)
    db.parent.mkdir(parents=True, exist_ok=True)
    con = schema.connect(db)
    try:
        schema.load_parquet(con, dataset)
        con.execute("CREATE TABLE app_meta (key VARCHAR PRIMARY KEY, value VARCHAR)")
        con.execute("INSERT INTO app_meta VALUES ('manifest', ?)", [json.dumps(_manifest(dataset))])
    finally:
        con.close()


def open_store(db: Path = DB_PATH, dataset: Path = DATASET_DIR, reload: bool = False) -> Store:
    """Generate the dataset if there is none, build the DB on first use, then open it.

    A dataset regenerated later is NOT loaded automatically (that would discard saved schedules):
    `Store.stale` reports it and the app offers a reload.
    """
    db, dataset = Path(db), Path(dataset)
    if not (dataset / "manifest.json").exists():
        from datagen import build

        build(dataset)
    if reload or not db.exists() or _recorded_manifest(db) is None:
        load_dataset(db, dataset)
    return Store(db, dataset)
