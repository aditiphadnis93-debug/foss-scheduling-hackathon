"""Scheduler / minute packer tests (scheduler-light PRD §10)."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from src.db import connect, init_db
from src.packer import (
    AGE_WEIGHT_MIN,
    DEFAULT_BLOCKS,
    MAX_LISTED_SOFT_CAP,
    clamp_age_weight,
    pack,
    resolve_duration,
)
from src.probabilities import gap_days, p_show, p_substantive, system_duration_mins
from src import scheduler_store as sched
from src.seed import seed_roster

ROSTER = Path("/Users/paulthottan/foss-scheduling-hackathon/data/roster_sample_100.csv")


@pytest.fixture()
def db(tmp_path):
    path = tmp_path / "packer.db"
    init_db(path)
    return path


@pytest.fixture()
def seeded(db):
    seed_roster(ROSTER, db, reset_defects=True)
    # Force a chunk of cases READY for packer tests (bypass defect gates)
    conn = connect(db)
    try:
        # Clear all defects and mark READY so we have a pool
        conn.execute("UPDATE defects SET status = 'cleared'")
        conn.execute("UPDATE cases SET readiness_status = 'READY'")
        conn.commit()
    finally:
        conn.close()
    return db


def _mk_case(
    case_number: str,
    purpose: str,
    *,
    filing_date: str = "2018-01-01",
    stage: str = "Evidence",
    status: str = "READY",
    total_hearings: int = 5,
    duration: int = 30,
) -> dict:
    return {
        "case_number": case_number,
        "filing_number": f"KL-{case_number}",
        "filing_date": filing_date,
        "current_stage": stage,
        "purpose_of_next_hearing": purpose,
        "advocate_id": "ADV-001",
        "readiness_status": status,
        "total_hearings_held": total_hearings,
        "duration_mins_estimate": duration,
    }


def test_probabilities_load():
    assert system_duration_mins("BAIL") == 15
    assert system_duration_mins("EVIDENCE_ACCUSED") == 30
    assert 0.05 <= p_show("BAIL") <= 1.0
    assert 0.01 <= p_substantive("JUDGEMENT") <= 1.0
    assert gap_days("REPORTS") == 45


def test_only_ready_listed():
    cases = [
        _mk_case("A/1", "BAIL", status="READY"),
        _mk_case("B/1", "BAIL", status="BLOCKED"),
        _mk_case("C/1", "BAIL", status="HEALING"),
        _mk_case("D/1", "EVIDENCE_ACCUSED", status="READY", filing_date="2015-01-01"),
    ]
    draft = pack(
        judge_id="J-SEHGAL",
        sitting_date="2026-09-22",
        ready_cases=cases,
        blocks=DEFAULT_BLOCKS,
        capacity_mins=420,
        overbook_buffer_pct=0.25,
        age_weight=2.0,
        duration_lookup={("BAIL", None): 15, ("EVIDENCE_ACCUSED", None): 30},
    )
    listed = [e["case_number"] for b in draft["blocks"] for e in b["entries"]]
    assert "A/1" in listed
    assert "D/1" in listed
    assert "B/1" not in listed
    assert "C/1" not in listed


def test_purpose_respects_block_allowlist():
    blocks = [
        {
            "block_id": "B1",
            "label": "Evidence only",
            "list_section": 1,
            "sequence": 1,
            "allowed_purposes": ["EVIDENCE_COMPLAINANT", "EVIDENCE_ACCUSED"],
            "minute_budget": 420,
        }
    ]
    cases = [
        _mk_case("BAIL/1", "BAIL"),
        _mk_case("EV/1", "EVIDENCE_ACCUSED", filing_date="2016-01-01"),
    ]
    draft = pack(
        judge_id="J-SEHGAL",
        sitting_date="2026-09-22",
        ready_cases=cases,
        blocks=blocks,
        capacity_mins=420,
        overbook_buffer_pct=0.25,
        age_weight=2.0,
        duration_lookup={("BAIL", None): 15, ("EVIDENCE_ACCUSED", None): 30},
    )
    listed = [e for b in draft["blocks"] for e in b["entries"]]
    assert all(e["purpose"] in ("EVIDENCE_COMPLAINANT", "EVIDENCE_ACCUSED") for e in listed)
    assert any(e["case_number"] == "EV/1" for e in listed)
    wait_reasons = {w["case_number"]: w["reason"] for w in draft["waitlist"]}
    assert wait_reasons.get("BAIL/1") == "no_matching_block"


def test_expected_load_within_buffer():
    cases = [
        _mk_case(f"ST/{i}/2018", "EVIDENCE_ACCUSED", filing_date=f"{2010 + (i % 10)}-01-01")
        for i in range(80)
    ]
    draft = pack(
        judge_id="J-SEHGAL",
        sitting_date="2026-09-22",
        ready_cases=cases,
        blocks=DEFAULT_BLOCKS,
        capacity_mins=420,
        overbook_buffer_pct=0.25,
        age_weight=2.0,
        duration_lookup={("EVIDENCE_ACCUSED", None): 30},
    )
    cap_eff = 420 * 1.25
    # Per-block: List1 is 330; overall expected should respect block caps
    assert draft["totals"]["expected_load_mins"] <= 330 * 1.25 + 90 * 1.25 + 1e-6
    assert draft["totals"]["expected_load_mins"] <= cap_eff + 1e-6


def test_age_weight_clamp_rejects_zero():
    assert clamp_age_weight(0) == AGE_WEIGHT_MIN
    assert clamp_age_weight(-1) == AGE_WEIGHT_MIN
    assert clamp_age_weight(None) >= AGE_WEIGHT_MIN

    # Via API prefs
    from src.main import app

    # Use in-memory by patching DB — simpler: call put_prefs on temp db
    path = Path("/tmp")  # noqa — use fixture via init
    # Direct store test
    import tempfile

    with tempfile.TemporaryDirectory() as td:
        db = Path(td) / "t.db"
        init_db(db)
        conn = connect(db)
        try:
            # age_weight 0 should clamp via put_prefs (API rejects <=0)
            result = sched.put_prefs(conn, "J-SEHGAL", {"age_weight": 0})
            assert result["age_weight"] >= AGE_WEIGHT_MIN
        finally:
            conn.close()


def test_age_weight_api_rejects_zero(tmp_path, monkeypatch):
    from src.main import app

    db = tmp_path / "api.db"
    init_db(db)
    monkeypatch.setattr("src.main.DB_PATH", db)
    client = TestClient(app)
    r = client.put("/judges/J-SEHGAL/prefs", json={"age_weight": 0})
    assert r.status_code == 400


def test_duration_from_judge_table_override():
    lookup = {("EVIDENCE_ACCUSED", None): 45}
    case = _mk_case("EV/99", "EVIDENCE_ACCUSED", duration=30)
    assert resolve_duration(case, lookup) == 45
    draft = pack(
        judge_id="J-SEHGAL",
        sitting_date="2026-09-22",
        ready_cases=[case],
        blocks=DEFAULT_BLOCKS,
        capacity_mins=420,
        overbook_buffer_pct=0.25,
        age_weight=2.0,
        duration_lookup=lookup,
    )
    entries = [e for b in draft["blocks"] for e in b["entries"]]
    assert entries[0]["duration_mins"] == 45
    # expected uses 45 * P_show * P_sub
    expected = 45 * p_show("EVIDENCE_ACCUSED") * p_substantive("EVIDENCE_ACCUSED")
    assert abs(entries[0]["expected_load_mins"] - expected) < 0.05


def test_soft_guard_listed_count_le_40():
    cases = [
        _mk_case(
            f"ST/{i}/2015",
            "EVIDENCE_COMPLAINANT" if i % 2 == 0 else "BAIL",
            filing_date=f"{2005 + (i % 15)}-06-01",
            duration=5,
        )
        for i in range(200)
    ]
    # Tiny durations inflate headcount — soft cap must still hold
    lookup = {("EVIDENCE_COMPLAINANT", None): 5, ("BAIL", None): 5}
    draft = pack(
        judge_id="J-SEHGAL",
        sitting_date="2026-09-22",
        ready_cases=cases,
        blocks=DEFAULT_BLOCKS,
        capacity_mins=420,
        overbook_buffer_pct=0.25,
        age_weight=2.0,
        duration_lookup=lookup,
        max_listed=MAX_LISTED_SOFT_CAP,
    )
    assert draft["totals"]["cases_listed"] <= MAX_LISTED_SOFT_CAP


def test_generate_excludes_cases_from_second_pack(seeded):
    conn = connect(seeded)
    try:
        first = sched.generate_causelist(
            conn, judge_id="J-SEHGAL", sitting_date="2026-09-22"
        )
        first_cases = [
            entry["case_number"]
            for block in first["blocks"]
            for entry in block["entries"]
        ][:3]
        assert len(first_cases) == 3

        second = sched.generate_causelist(
            conn,
            judge_id="J-SEHGAL",
            sitting_date="2026-09-23",
            exclude_case_numbers=first_cases,
        )
        second_cases = {
            entry["case_number"]
            for block in second["blocks"]
            for entry in block["entries"]
        }
        assert second_cases.isdisjoint(first_cases)
        assert second["totals"]["ready_pool"] == first["totals"]["ready_pool"]
        assert second["totals"]["excluded"] == 3
        assert second["totals"]["after_exclude"] == first["totals"]["after_exclude"] - 3
        assert second["excluded_case_numbers"] == sorted(first_cases)
    finally:
        conn.close()


def test_generate_persists_draft(seeded):
    conn = connect(seeded)
    try:
        draft = sched.generate_causelist(
            conn, judge_id="J-SEHGAL", sitting_date="2026-09-22"
        )
        assert draft["totals"]["ready_pool"] > 0
        assert draft["totals"]["cases_listed"] <= MAX_LISTED_SOFT_CAP
        saved = sched.get_draft(conn, "J-SEHGAL", "2026-09-22")
        assert saved is not None
        assert saved["totals"]["cases_listed"] == draft["totals"]["cases_listed"]
    finally:
        conn.close()


def test_holiday_refused(seeded):
    conn = connect(seeded)
    try:
        with pytest.raises(ValueError, match="force_holiday|Holiday|Weekly|non-working"):
            # 2026-09-20 is Sunday weekly off
            sched.generate_causelist(
                conn,
                judge_id="J-SEHGAL",
                sitting_date="2026-09-20",
                force_holiday=False,
            )
        # with force ok
        draft = sched.generate_causelist(
            conn,
            judge_id="J-SEHGAL",
            sitting_date="2026-09-20",
            force_holiday=True,
        )
        assert "totals" in draft
    finally:
        conn.close()
