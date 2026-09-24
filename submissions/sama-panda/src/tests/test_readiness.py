"""PRD §11 Gherkin-style readiness tests."""

from __future__ import annotations

import uuid
from pathlib import Path

import pytest

from src.catalog import PURPOSE_REQUIRED_CODES, action_label_for, can_act
from src.db import connect, init_db
from src.normalize import to_upper_snake
from src.readiness import blocking_open_count, open_soft_defect_count, recompute_readiness
from src.seed import keyword_overlays, required_codes_for, seed_roster
from src import store as store_mod

ROSTER = Path("/Users/paulthottan/foss-scheduling-hackathon/data/roster_sample_100.csv")


@pytest.fixture()
def db(tmp_path):
    path = tmp_path / "test.db"
    init_db(path)
    return path


@pytest.fixture()
def seeded(db):
    seed_roster(ROSTER, db, reset_defects=True)
    return db


def test_normalize_examples():
    assert to_upper_snake("Evidence Accused") == "EVIDENCE_ACCUSED"
    assert to_upper_snake("Examination Under S351 Bnss") == "EXAMINATION_UNDER_S351_BNSS"
    assert to_upper_snake("EVIDENCE_ACCUSED") == "EVIDENCE_ACCUSED"


def test_recompute_blocked_open():
    assert recompute_readiness([{"status": "open"}]) == "BLOCKED"
    assert recompute_readiness([{"status": "rejected"}]) == "BLOCKED"
    assert recompute_readiness([{"status": "expired"}]) == "BLOCKED"


def test_recompute_healing():
    assert (
        recompute_readiness([{"status": "submitted"}, {"status": "cleared"}])
        == "HEALING"
    )


def test_recompute_ready():
    assert (
        recompute_readiness([{"status": "cleared"}, {"status": "waived"}]) == "READY"
    )
    assert recompute_readiness([]) == "READY"


def test_seed_keyword_return_of_warrant():
    codes = keyword_overlays("Await warrant. For return of warrant.")
    assert "PROCESS_RETURN_PENDING" in codes


def test_seed_invents_process_from_summary(seeded):
    """Scenario: Seed invents defects from summary keywords."""
    conn = connect(seeded)
    try:
        row = conn.execute(
            """
            SELECT c.case_number, c.readiness_status, d.status AS dstatus
            FROM cases c
            JOIN defects d ON d.case_number = c.case_number
            WHERE d.code = 'PROCESS_RETURN_PENDING'
              AND c.last_hearing_summary LIKE '%return of warrant%'
            LIMIT 1
            """
        ).fetchone()
        assert row is not None
        assert row["dstatus"] == "open"
        assert row["readiness_status"] == "BLOCKED"
    finally:
        conn.close()


def test_appearance_process_blocks(seeded):
    """Open process defect blocks Appearance matters."""
    conn = connect(seeded)
    try:
        # find or craft appearance with process open
        case = conn.execute(
            "SELECT case_number FROM cases WHERE purpose_norm = 'APPEARANCE' LIMIT 1"
        ).fetchone()
        assert case
        cn = case["case_number"]
        defects = store_mod.get_defects(conn, cn)
        # ensure PROCESS open
        proc = next((d for d in defects if d["code"] == "PROCESS_RETURN_PENDING"), None)
        assert proc is not None
        conn.execute(
            "UPDATE defects SET status='open' WHERE id=?", (proc["id"],)
        )
        status = store_mod.refresh_case_status(conn, cn)
        conn.commit()
        assert status == "BLOCKED"
        elig = store_mod.eligibility(conn)
        assert all(c["case_number"] != cn for c in elig["cases"])
    finally:
        conn.close()


def test_all_cleared_ready_in_eligibility(db):
    """Case with all hard defects cleared becomes READY and appears in eligibility."""
    conn = connect(db)
    try:
        cn = "ST/TEST/READY"
        conn.execute(
            """
            INSERT INTO cases (
                case_number, filing_number, filing_date, advocate_id, party_id,
                current_stage, current_stage_norm, purpose_of_next_hearing, purpose_norm,
                last_hearing_summary, readiness_status, duration_mins_estimate, updated_at
            ) VALUES (?, 'KL-TEST', '2023-01-01', 'ADV-1', 'PARTY-1',
                      'Evidence Complainant', 'EVIDENCE_COMPLAINANT',
                      'Evidence Complainant', 'EVIDENCE_COMPLAINANT',
                      'Ready.', 'BLOCKED', 30, datetime('now'))
            """,
            (cn,),
        )
        for code in PURPOSE_REQUIRED_CODES["EVIDENCE_COMPLAINANT"]:
            conn.execute(
                """
                INSERT INTO defects (id, case_number, code, purpose, owner, severity, status, source, updated_at)
                VALUES (?, ?, ?, 'EVIDENCE_COMPLAINANT', 'COUNSEL', 'HARD', 'cleared', 'manual', datetime('now'))
                """,
                (str(uuid.uuid4()), cn, code),
            )
        status = store_mod.refresh_case_status(conn, cn)
        conn.commit()
        assert status == "READY"
        elig = store_mod.eligibility(conn, as_of="2026-09-22")
        assert any(c["case_number"] == cn for c in elig["cases"])
        assert all(c["readiness_status"] == "READY" for c in elig["cases"])
    finally:
        conn.close()


def test_counsel_upload_healing_then_verify_ready(db):
    """Counsel upload → HEALING; registry verify last defect → READY."""
    conn = connect(db)
    try:
        cn = "ST/TEST/HEAL"
        codes = ["FILING_NOT_READY", "RSVP_SHOW_INTENT"]
        conn.execute(
            """
            INSERT INTO cases (
                case_number, filing_number, filing_date, advocate_id, party_id,
                current_stage, current_stage_norm, purpose_of_next_hearing, purpose_norm,
                last_hearing_summary, readiness_status, duration_mins_estimate, updated_at
            ) VALUES (?, 'KL-H', '2024-01-01', 'ADV-2', 'PARTY-2',
                      'Arguments', 'ARGUMENTS', 'Arguments', 'ARGUMENTS',
                      'Counsel not ready.', 'BLOCKED', 30, datetime('now'))
            """,
            (cn,),
        )
        defect_ids = {}
        for code in codes:
            did = str(uuid.uuid4())
            status = "open"
            owner = "COUNSEL" if code == "FILING_NOT_READY" else "PARTY"
            conn.execute(
                """
                INSERT INTO defects (id, case_number, code, purpose, owner, severity, status, source, updated_at)
                VALUES (?, ?, ?, 'ARGUMENTS', ?, 'HARD', ?, 'manual', datetime('now'))
                """,
                (did, cn, code, owner, status),
            )
            defect_ids[code] = did
        # clear RSVP first so only filing blocks
        conn.execute(
            "UPDATE defects SET status='cleared' WHERE id=?",
            (defect_ids["RSVP_SHOW_INTENT"],),
        )
        store_mod.refresh_case_status(conn, cn)
        conn.commit()

        result = store_mod.apply_party_action(
            conn,
            case_number=cn,
            defect_id=defect_ids["FILING_NOT_READY"],
            action="upload",
            role="counsel",
            note="written args.pdf",
            evidence_uri="file://args.pdf",
        )
        assert result["defect"]["status"] == "submitted"
        assert result["readiness_status"] == "HEALING"
        elig = store_mod.eligibility(conn)
        assert all(c["case_number"] != cn for c in elig["cases"])

        verified = store_mod.registry_verify(
            conn, defect_ids["FILING_NOT_READY"], role="registry"
        )
        assert verified["defect"]["status"] == "cleared"
        assert verified["readiness_status"] == "READY"
        elig2 = store_mod.eligibility(conn)
        assert any(c["case_number"] == cn for c in elig2["cases"])
    finally:
        conn.close()


def test_registry_reject_blocks(db):
    conn = connect(db)
    try:
        cn = "ST/TEST/REJ"
        did = str(uuid.uuid4())
        conn.execute(
            """
            INSERT INTO cases (
                case_number, filing_number, filing_date, advocate_id, party_id,
                current_stage, current_stage_norm, purpose_of_next_hearing, purpose_norm,
                last_hearing_summary, readiness_status, updated_at
            ) VALUES (?, 'KL-R', '2024-01-01', 'ADV-3', 'PARTY-3',
                      'Bail', 'BAIL', 'Bail', 'BAIL', 'x', 'HEALING', datetime('now'))
            """,
            (cn,),
        )
        conn.execute(
            """
            INSERT INTO defects (id, case_number, code, purpose, owner, severity, status, source, updated_at)
            VALUES (?, ?, 'FILING_NOT_READY', 'BAIL', 'COUNSEL', 'HARD', 'submitted', 'manual', datetime('now'))
            """,
            (did, cn),
        )
        conn.commit()
        out = store_mod.registry_reject(conn, did, reason="illegible scan", role="registry")
        assert out["defect"]["status"] == "rejected"
        assert out["readiness_status"] == "BLOCKED"
        assert out["defect"]["reject_reason"] == "illegible scan"
    finally:
        conn.close()


def test_flag_adjournment_blocks_ready(db):
    conn = connect(db)
    try:
        cn = "ST/TEST/ADJ"
        conn.execute(
            """
            INSERT INTO cases (
                case_number, filing_number, filing_date, advocate_id, party_id,
                current_stage, current_stage_norm, purpose_of_next_hearing, purpose_norm,
                last_hearing_summary, readiness_status, updated_at
            ) VALUES (?, 'KL-A', '2024-01-01', 'ADV-4', 'PARTY-4',
                      'Judgement', 'JUDGEMENT', 'Judgement', 'JUDGEMENT', 'x', 'READY', datetime('now'))
            """,
            (cn,),
        )
        conn.commit()
        out = store_mod.apply_party_action(
            conn,
            case_number=cn,
            defect_id="unused",
            action="flag_adjournment",
            role="counsel",
            note="counsel clash",
        )
        assert out["readiness_status"] == "BLOCKED"
        assert out["defect"]["code"] == "ADJOURNMENT_PREDECLARED"
    finally:
        conn.close()


def test_party_cannot_clear_court_admin_block(db):
    conn = connect(db)
    try:
        cn = "ST/TEST/CAB"
        did = str(uuid.uuid4())
        conn.execute(
            """
            INSERT INTO cases (
                case_number, filing_number, filing_date, advocate_id, party_id,
                current_stage, current_stage_norm, purpose_of_next_hearing, purpose_norm,
                last_hearing_summary, readiness_status, updated_at
            ) VALUES (?, 'KL-C', '2024-01-01', 'ADV-5', 'PARTY-5',
                      'Plea', 'PLEA', 'Plea', 'PLEA', 'x', 'BLOCKED', datetime('now'))
            """,
            (cn,),
        )
        conn.execute(
            """
            INSERT INTO defects (id, case_number, code, purpose, owner, severity, status, source, updated_at)
            VALUES (?, ?, 'COURT_ADMIN_BLOCK', 'PLEA', 'COURT', 'HARD', 'open', 'manual', datetime('now'))
            """,
            (did, cn),
        )
        conn.commit()
        with pytest.raises(PermissionError):
            store_mod.apply_party_action(
                conn,
                case_number=cn,
                defect_id=did,
                action="undertake",
                role="party",
            )
    finally:
        conn.close()


def test_action_labels_your_vs_court():
    assert action_label_for("PARTY", "party") == "Your action"
    assert action_label_for("COURT", "party") == "Court action"
    assert action_label_for("EXTERNAL_AGENCY", "counsel") == "Agency action"
    assert can_act("PARTY", "party", "open") is True
    assert can_act("COURT", "party", "open", "COURT_ADMIN_BLOCK") is False


def test_eligibility_only_ready(seeded):
    conn = connect(seeded)
    try:
        elig = store_mod.eligibility(conn)
        assert all(c["readiness_status"] == "READY" for c in elig["cases"])
        st = store_mod.stats(conn)
        assert len(elig["cases"]) == st["READY"]
        assert st["READY"] < st["total"]
        assert st["BLOCKED"] > 0
    finally:
        conn.close()


def test_rsvp_does_not_ready_with_hard_open(db):
    conn = connect(db)
    try:
        cn = "ST/TEST/RSVP"
        ev = str(uuid.uuid4())
        rsvp = str(uuid.uuid4())
        conn.execute(
            """
            INSERT INTO cases (
                case_number, filing_number, filing_date, advocate_id, party_id,
                current_stage, current_stage_norm, purpose_of_next_hearing, purpose_norm,
                last_hearing_summary, readiness_status, updated_at
            ) VALUES (?, 'KL-S', '2024-01-01', 'ADV-6', 'PARTY-6',
                      'Evidence Complainant', 'EVIDENCE_COMPLAINANT',
                      'Evidence Complainant', 'EVIDENCE_COMPLAINANT',
                      'x', 'BLOCKED', datetime('now'))
            """,
            (cn,),
        )
        for did, code, owner in [
            (ev, "EVIDENCE_NOT_READY", "COUNSEL"),
            (rsvp, "RSVP_SHOW_INTENT", "PARTY"),
        ]:
            conn.execute(
                """
                INSERT INTO defects (id, case_number, code, purpose, owner, severity, status, source, updated_at)
                VALUES (?, ?, ?, 'EVIDENCE_COMPLAINANT', ?, 'HARD', 'open', 'manual', datetime('now'))
                """,
                (did, cn, code, owner),
            )
        conn.commit()
        out = store_mod.apply_party_action(
            conn,
            case_number=cn,
            defect_id=rsvp,
            action="rsvp",
            role="party",
            window="2026-09-22-am",
        )
        assert out["defect"]["status"] == "cleared"
        assert out["readiness_status"] == "BLOCKED"
    finally:
        conn.close()


def test_admission_process_conditional():
    codes = required_codes_for("ADMISSION", "For admission; parties present.")
    assert "RSVP_SHOW_INTENT" in codes
    assert "PROCESS_RETURN_PENDING" not in codes
    codes2 = required_codes_for("ADMISSION", "Await process. Take steps.")
    assert "PROCESS_RETURN_PENDING" in codes2



def test_soft_open_only_ready():
    """Open soft-only defects do not block READY."""
    defects = [
        {"code": "RSVP_SHOW_INTENT", "severity": "SOFT", "status": "open", "blocking": False},
    ]
    assert recompute_readiness(defects) == "READY"
    assert blocking_open_count(defects) == 0
    assert open_soft_defect_count(defects) == 1


def test_hard_open_blocked():
    defects = [
        {"code": "FILING_NOT_READY", "severity": "HARD", "status": "open", "blocking": True},
    ]
    assert recompute_readiness(defects) == "BLOCKED"
    assert blocking_open_count(defects) == 1


def test_soft_open_hard_cleared_ready():
    defects = [
        {"code": "RSVP_SHOW_INTENT", "severity": "SOFT", "status": "open", "blocking": False},
        {"code": "FILING_NOT_READY", "severity": "HARD", "status": "cleared", "blocking": True},
    ]
    assert recompute_readiness(defects) == "READY"


def test_blocking_submitted_healing():
    defects = [
        {"code": "FILING_NOT_READY", "severity": "HARD", "status": "submitted", "blocking": True},
        {"code": "RSVP_SHOW_INTENT", "severity": "SOFT", "status": "open", "blocking": False},
    ]
    assert recompute_readiness(defects) == "HEALING"


def test_soft_submitted_only_ready_not_healing():
    """Submitted soft defects are warnings, not HEALING."""
    defects = [
        {"code": "RSVP_SHOW_INTENT", "severity": "SOFT", "status": "submitted", "blocking": False},
    ]
    assert recompute_readiness(defects) == "READY"


def test_policy_overrides_severity_for_rsvp(db):
    """Judge can mark RSVP blocking via policy; locked codes cannot soften."""
    conn = connect(db)
    try:
        # default soft RSVP open → READY
        cn = "ST/TEST/POL"
        did = str(uuid.uuid4())
        conn.execute(
            """
            INSERT INTO cases (
                case_number, filing_number, filing_date, advocate_id, party_id,
                current_stage, current_stage_norm, purpose_of_next_hearing, purpose_norm,
                last_hearing_summary, readiness_status, updated_at
            ) VALUES (?, 'KL-P', '2024-01-01', 'ADV-P', 'PARTY-P',
                      'Judgement', 'JUDGEMENT', 'Judgement', 'JUDGEMENT',
                      'x', 'BLOCKED', datetime('now'))
            """,
            (cn,),
        )
        conn.execute(
            """
            INSERT INTO defects (id, case_number, code, purpose, owner, severity, status, source, updated_at)
            VALUES (?, ?, 'RSVP_SHOW_INTENT', 'JUDGEMENT', 'PARTY', 'SOFT', 'open', 'manual', datetime('now'))
            """,
            (did, cn),
        )
        conn.commit()
        status = store_mod.refresh_case_status(conn, cn)
        conn.commit()
        assert status == "READY"

        detail = store_mod.get_case_detail(conn, cn, role="registry")
        rsvp = next(d for d in detail["defects"] if d["code"] == "RSVP_SHOW_INTENT")
        assert rsvp["blocking"] is False
        assert rsvp["locked_by_law"] is False

        out = store_mod.set_policy(conn, "RSVP_SHOW_INTENT", blocking=True, role="registry")
        assert out["blocking"] is True
        row = conn.execute(
            "SELECT readiness_status FROM cases WHERE case_number=?", (cn,)
        ).fetchone()
        assert row["readiness_status"] == "BLOCKED"

        store_mod.set_policy(conn, "RSVP_SHOW_INTENT", blocking=False, role="registry")
        row = conn.execute(
            "SELECT readiness_status FROM cases WHERE case_number=?", (cn,)
        ).fetchone()
        assert row["readiness_status"] == "READY"

        with pytest.raises(PermissionError):
            store_mod.set_policy(conn, "FILING_NOT_READY", blocking=False, role="registry")
    finally:
        conn.close()
