"""Saved schedules: a live plan written into the schema's run tables, and read back for display.

A *batch* is one save across courtrooms: one `scheduling_run` per judge sharing
`additional_details.batch`, each with draft `causelist`s per sitting day, a `causelist_item` per
listing and a `listing_decision` per listed / forced / near-missed case. Reading a batch rebuilds the
same `DayPlan` / `Listing` objects the pipeline returns, so every view renders a saved schedule
exactly like a live one. The seed schedule `datagen` writes has the same shape (batch "seed").
"""
from __future__ import annotations

import json
import uuid
from collections import defaultdict
from datetime import date, datetime

import pandas as pd

from . import config as locked
from .assign import DayPlan
from .data import sitting_days
from .models import Case, JudgeConfig, Listing
from .scoring import terms
from .store import Store


def _metrics(plans: list[DayPlan]) -> dict:
    listings = [l for p in plans for l in p.listings]
    minutes = sum(l.expected_minutes for l in listings)
    old = sum(l.expected_minutes for l in listings if l.age_years >= locked.AGE_QUOTA_MIN_YEARS)
    excluded: dict[str, int] = defaultdict(int)
    for p in plans:
        for k, v in p.excluded.items():
            excluded[k] += v
    return {"listed": len(listings), "cases": len({l.case_id for l in listings}),
            "expected_minutes": round(minutes, 1), "share_4y_minutes": round(old / minutes, 3) if minutes else 0.0,
            "sitting_days": len(plans), "excluded": dict(excluded)}


def save_batch(store: Store, rooms, *, label: str, overrides: dict[str, dict] | None = None) -> str:
    """Save every courtroom's current plan as one batch. `rooms` are views.court.Courtroom objects."""
    from datagen import schema

    batch = f"{datetime.now():%Y%m%d-%H%M%S}-{uuid.uuid4().hex[:4]}"
    sections = dict(store.cursor().execute("SELECT code, list_section FROM hearing_type").fetchall())
    rows: dict[str, list[dict]] = defaultdict(list)
    for room in rooms:
        run_id = f"RUN-{uuid.uuid4().hex[:12]}"
        rows["scheduling_run"].append(dict(
            id=run_id, preset_id=store.judge(room.judge_id).preset_id, run_at=datetime.now(),
            horizon_start=room.days[0], horizon_days=len(room.days), policy="l1",
            data_version=f"synthetic-seed{store.manifest['seed']}@{store.today}", seed=None,
            code_version="l1", clamped_rules=list(room.cfg.clamped), metrics=_metrics(room.plans),
            additional_details={"batch": batch, "label": label,
                                "overrides": (overrides or {}).get(room.judge_id, {})}))
        n = 0
        for plan in room.plans:
            if not plan.listings and not plan.near_miss:
                continue
            cl_id = f"CL-{run_id}-{plan.day:%Y%m%d}"
            rows["causelist"].append(dict(
                id=cl_id, tenant_id="hc", judge_id=room.judge_id, bench_id=None,
                court_hall_id=store.judge(room.judge_id).hall_id, list_date=plan.day, list_type="daily",
                scheduling_run_id=run_id, status="draft", published_at=None,
                additional_details={"excluded": plan.excluded, "pool_size": plan.pool_size}))
            ordered = sorted(plan.listings, key=lambda l: (l.window_start or datetime.min, l.block, l.case_id))
            for serial, l in enumerate(ordered, 1):
                n += 1
                item_id = f"CLI-{run_id}-{n}"
                rows["causelist_item"].append(dict(
                    id=item_id, causelist_id=cl_id, case_id=l.case_id, serial_number=serial,
                    list_section=sections.get(l.purpose), purpose_code=l.purpose,
                    tag_group=l.advocate if room.cfg.clustering else None, time_block=l.block,
                    window_start=l.window_start, window_end=l.window_end, expected_minutes=l.expected_minutes,
                    score=l.score, reasons=list(l.reasons), was_booked=bool(l.reasons) and l.reasons[0] == "booked at last hearing"))
                forced = bool(l.reasons) and l.reasons[0].startswith("starvation guard")
                c = room.by_id.get(l.case_id)
                rows["listing_decision"].append(dict(
                    id=f"LD-{run_id}-{n}", run_id=run_id, case_id=l.case_id, list_date=plan.day,
                    decision="forced" if forced else "listed", time_block=l.block, score=l.score,
                    score_components={label: round(v, 2) for v, label in terms(c, plan.day, room.cfg)} if c else None,
                    reasons=list(l.reasons), causelist_item_id=item_id,
                    additional_details={"how": plan.how.get(l.case_id), "rank": plan.rank.get(l.case_id),
                                        "window_why": l.window_why}))
            for cid in plan.near_miss:
                n += 1
                rows["listing_decision"].append(dict(
                    id=f"LD-{run_id}-{n}", run_id=run_id, case_id=cid, list_date=plan.day,
                    decision="near_miss", score=None,
                    exclusion_reason=plan.skipped.get(cid, "eligible, next in line; the day was full"),
                    reasons=[plan.skipped.get(cid, "eligible, next in line; the day was full")],
                    additional_details={"rank": plan.rank.get(cid)}))

    cur = store.cursor()
    cur.begin()
    try:
        for t in ("scheduling_run", "causelist", "causelist_item", "listing_decision"):
            if rows[t]:
                schema.insert(cur, t, rows[t])
        cur.commit()
    except Exception:
        cur.rollback()
        raise
    return batch


def list_batches(store: Store) -> pd.DataFrame:
    return store.df("""
        SELECT additional_details->>'batch' AS batch, any_value(additional_details->>'label') AS label,
               min(run_at) AS created, min(horizon_start) AS horizon_start, max(horizon_days) AS sitting_days,
               count(*) AS courtrooms, sum(try_cast(metrics->>'listed' AS INTEGER)) AS listed
        FROM scheduling_run WHERE additional_details->>'batch' IS NOT NULL
        GROUP BY 1 ORDER BY created DESC""")


def batch_label(store: Store, batch: str) -> str:
    row = store.rows("""SELECT any_value(additional_details->>'label') AS label, min(run_at) AS created
                        FROM scheduling_run WHERE additional_details->>'batch' = ?""", [batch])[0]
    return f"{row['label']} · {row['created']:%d %b %H:%M}" if row["created"] else batch


def load_batch(store: Store, batch: str) -> list[tuple[str, JudgeConfig, list[date], list[DayPlan], dict]]:
    """(judge_id, cfg, days, plans, overrides) per courtroom in the batch."""
    runs = store.rows("""
        SELECT r.id, r.horizon_start, r.horizon_days, r.additional_details, p.judge_id
        FROM scheduling_run r JOIN scheduling_preset p ON p.id = r.preset_id
        WHERE r.additional_details->>'batch' = ?""", [batch])
    out = []
    for run in runs:
        overrides = json.loads(run["additional_details"]).get("overrides") or {}
        cfg = store.config(run["judge_id"], overrides)
        cases: dict[str, Case] = {c.id: c for c in store.cases(run["judge_id"])}
        items = store.rows("""
            SELECT l.list_date, l.additional_details AS list_details, i.*
            FROM causelist l LEFT JOIN causelist_item i ON i.causelist_id = l.id
            WHERE l.scheduling_run_id = ? ORDER BY l.list_date, i.serial_number""", [run["id"]])
        near = store.rows("""SELECT list_date, case_id, exclusion_reason, additional_details FROM listing_decision
                             WHERE run_id = ? AND decision = 'near_miss' ORDER BY rowid""", [run["id"]])
        lineage = {(r["list_date"], r["case_id"]): json.loads(r["additional_details"] or "{}") for r in store.rows(
            """SELECT list_date, case_id, additional_details FROM listing_decision
               WHERE run_id = ? AND decision IN ('listed', 'forced')""", [run["id"]])}
        by_day: dict[date, DayPlan] = {}
        for r in items:
            plan = by_day.setdefault(r["list_date"], DayPlan(r["list_date"]))
            if r["list_details"] and not plan.excluded:
                details = json.loads(r["list_details"])
                plan.excluded = details.get("excluded") or {}
                plan.pool_size = details.get("pool_size") or 0
            if r["id"] is None or r["case_id"] not in cases:
                continue
            c = cases[r["case_id"]]
            ws, we = r["window_start"], r["window_end"]
            lin = lineage.get((r["list_date"], c.id), {})
            if lin.get("how"):
                plan.how[c.id] = lin["how"]
            if lin.get("rank"):
                plan.rank[c.id] = lin["rank"]
            plan.listings.append(Listing(
                case_id=c.id, day=r["list_date"], block=r["time_block"], purpose=r["purpose_code"],
                advocate=c.advocate_ids[0], age_years=round(c.age_years(r["list_date"]), 1),
                score=r["score"] or 0.0, expected_minutes=r["expected_minutes"] or 0.0,
                reasons=list(r["reasons"] or []), window=f"{ws:%H:%M}–{we:%H:%M}" if ws and we else "",
                window_start=ws, window_end=we, window_why=lin.get("window_why") or ""))
        for r in near:
            plan = by_day.setdefault(r["list_date"], DayPlan(r["list_date"]))
            plan.near_miss.append(r["case_id"])
            if r["exclusion_reason"]:
                plan.skipped[r["case_id"]] = r["exclusion_reason"]
            rank = json.loads(r["additional_details"] or "{}").get("rank")
            if rank:
                plan.rank[r["case_id"]] = rank
        days = sorted(set(sitting_days(run["horizon_start"], run["horizon_days"], cfg.leave)) | set(by_day))
        out.append((run["judge_id"], cfg, days, [by_day.get(d, DayPlan(d)) for d in days], overrides))
    return out


def delete_batch(store: Store, batch: str) -> None:
    """Children first; one statement at a time so DuckDB's FK checks see each delete committed."""
    runs = [r["id"] for r in store.rows(
        "SELECT id FROM scheduling_run WHERE additional_details->>'batch' = ?", [batch])]
    if not runs:
        return
    cur = store.cursor()
    ids = "(SELECT unnest(?::VARCHAR[]))"
    cur.execute(f"DELETE FROM listing_decision WHERE run_id IN {ids}", [runs])
    cur.execute(f"""DELETE FROM causelist_item WHERE causelist_id IN
                    (SELECT id FROM causelist WHERE scheduling_run_id IN {ids})
                    AND id NOT IN (SELECT causelist_item_id FROM hearing WHERE causelist_item_id IS NOT NULL)""", [runs])
    cur.execute(f"DELETE FROM causelist WHERE scheduling_run_id IN {ids}", [runs])
    cur.execute(f"DELETE FROM scheduling_run WHERE id IN {ids}", [runs])
