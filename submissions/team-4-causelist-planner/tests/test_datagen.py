"""Synthetic data generator: every table is filled, files reload into the DDL, and the history is coherent."""
from datetime import date

import duckdb
import pytest

from datagen import schema
from datagen.generate import generate
from scheduler.data import is_sitting_day

TODAY = date(2026, 10, 5)


def _build(out, seed=3):
    con = schema.connect()
    rows = generate(60, seed, TODAY, horizon_days=5)
    for t in schema.TABLE_ORDER:
        schema.insert(con, t, rows.get(t, []))
    schema.export_parquet(con, out)
    return con


@pytest.fixture(scope="module")
def out(tmp_path_factory):
    path = tmp_path_factory.mktemp("synthetic")
    _build(path).close()
    return path


@pytest.fixture(scope="module")
def con(out):
    """A fresh database from the DDL, loaded only from the parquet files: proves they satisfy every constraint."""
    c = schema.connect()
    schema.load_parquet(c, out)
    return c


def _one(con, sql):
    return con.execute(sql).fetchone()[0]


def test_every_ddl_table_has_a_parquet_file_with_rows(out, con):
    tables = {r[0] for r in con.execute("SELECT table_name FROM duckdb_tables()").fetchall()}
    assert tables == set(schema.TABLE_ORDER)
    for t in schema.TABLE_ORDER:
        assert (out / f"{t}.parquet").exists()
        assert _one(con, f"SELECT count(*) FROM {t}") > 0, t


def test_same_seed_same_data(out, tmp_path):
    again = _build(tmp_path)
    for t in schema.TABLE_ORDER:
        diff = again.execute(f"SELECT count(*) FROM (SELECT * FROM '{out / t}.parquet' "
                             f"EXCEPT ALL SELECT * FROM '{tmp_path / t}.parquet')").fetchone()[0]
        assert diff == 0, t


def test_outcomes_obey_effective_heard_reached(con):
    assert _one(con, """SELECT count(*) FROM hearing_outcome
                        WHERE (was_effective AND NOT was_heard) OR (was_heard AND NOT was_reached)""") == 0


def test_failed_hearings_have_one_matching_adjournment(con):
    assert _one(con, """
        SELECT count(*) FROM hearing_outcome o
        LEFT JOIN (SELECT hearing_id, count(*) n, any_value(reason_code) code FROM adjournment GROUP BY 1) a
               ON a.hearing_id = o.hearing_id
        LEFT JOIN adjournment_reason r ON r.code = a.code
        WHERE CASE WHEN o.was_effective THEN a.n IS NOT NULL
                   ELSE a.n IS DISTINCT FROM 1
                        OR r.failure_kind <> CASE WHEN o.was_heard THEN 'heard_not_effective' ELSE 'not_heard' END
              END""") == 0


def test_hearings_fall_on_sitting_days_within_the_case_life(con):
    rows = con.execute("""
        SELECT h.hearing_date, h.status, c.registration_date, h.judge_id
        FROM hearing h JOIN court_case c ON c.id = h.case_id""").fetchall()
    leave = {}
    for j, lo, hi in con.execute("SELECT judge_id, from_date, to_date FROM judge_leave").fetchall():
        leave.setdefault(j, set()).update(date.fromordinal(o) for o in range(lo.toordinal(), hi.toordinal() + 1))
    for day, status, registered, judge in rows:
        assert is_sitting_day(day, leave.get(judge, set())), day
        assert day > registered
        assert (day < TODAY) == (status != "scheduled")


def test_case_row_agrees_with_its_history(con):
    assert _one(con, """
        SELECT count(*) FROM court_case c
        LEFT JOIN (SELECT case_id, count(*) FILTER (WHERE NOT o.was_effective) adj, max(hearing_date) last_day
                   FROM hearing h JOIN hearing_outcome o ON o.hearing_id = h.id GROUP BY 1) x ON x.case_id = c.id
        WHERE c.adjournment_count <> coalesce(x.adj, 0) OR c.last_listed_date IS DISTINCT FROM x.last_day""") == 0
    # The last outcome's next date is the case's next date; disposed cases have none.
    assert _one(con, """
        SELECT count(*) FROM court_case c
        JOIN hearing h ON h.case_id = c.id AND h.hearing_date = c.last_listed_date
        JOIN hearing_outcome o ON o.hearing_id = h.id
        WHERE o.next_hearing_date IS DISTINCT FROM c.next_hearing_date""") == 0
    assert _one(con, """SELECT count(*) FROM court_case
                        WHERE (status = 'disposed') <> (disposal_date IS NOT NULL)
                           OR (status = 'disposed' AND next_hearing_date IS NOT NULL)""") == 0


def test_child_rows_point_inside_the_same_case(con):
    checks = {
        "advocate_mapping": "SELECT count(*) FROM advocate_mapping m JOIN party p ON p.id = m.party_id WHERE p.case_id <> m.case_id",
        "adjournment": """SELECT count(*) FROM adjournment a JOIN hearing h ON h.id = a.hearing_id
                          JOIN party p ON p.id = a.sought_by_party_id WHERE p.case_id <> h.case_id""",
        "task party": "SELECT count(*) FROM task t JOIN party p ON p.id = t.addressee_party_id WHERE p.case_id <> t.case_id",
        "task order": "SELECT count(*) FROM task t JOIN court_order o ON o.id = t.order_id WHERE o.case_id <> t.case_id",
        "order hearing": "SELECT count(*) FROM court_order o JOIN hearing h ON h.id = o.hearing_id WHERE h.case_id <> o.case_id OR h.hearing_date <> o.order_date",
        "application": "SELECT count(*) FROM application a JOIN party p ON p.id = a.filed_by_party_id WHERE p.case_id <> a.case_id",
        "stage": "SELECT count(*) FROM case_stage_history s JOIN hearing h ON h.id = s.hearing_id WHERE h.case_id <> s.case_id",
        "hearing item": """SELECT count(*) FROM hearing h JOIN causelist_item i ON i.id = h.causelist_item_id
                           JOIN causelist l ON l.id = i.causelist_id
                           WHERE i.case_id <> h.case_id OR l.list_date <> h.hearing_date OR l.judge_id <> h.judge_id""",
    }
    for name, sql in checks.items():
        assert _one(con, sql) == 0, name


def test_dates_are_ordered(con):
    assert _one(con, "SELECT count(*) FROM application WHERE decided_on < created_date") == 0
    assert _one(con, "SELECT count(*) FROM task WHERE served_on < created_date OR served_on >= DATE '2026-10-05'") == 0
    assert _one(con, "SELECT count(*) FROM task WHERE served_on IS NOT NULL AND service_status NOT IN ('served', 'complied')") == 0
    assert _one(con, "SELECT count(*) FROM court_case WHERE registration_date < filing_date") == 0


def test_windows_sit_inside_a_block_for_that_weekday(con):
    assert _one(con, """
        SELECT count(*) FROM causelist_item i
        JOIN causelist l ON l.id = i.causelist_id
        JOIN scheduling_preset p ON p.judge_id = l.judge_id
        LEFT JOIN time_block b ON b.preset_id = p.id AND b.name = i.time_block
             AND list_contains(b.weekdays, isodow(l.list_date) - 1)
             AND list_contains(b.purpose_codes, i.purpose_code)
        WHERE b.id IS NULL OR i.window_start::TIME < b.start_time OR i.window_end::TIME > b.end_time
           OR i.window_end <= i.window_start""") == 0


def test_views_cover_every_case(con):
    cases = _one(con, "SELECT count(*) FROM court_case")
    assert _one(con, "SELECT count(*) FROM case_summary_facts") == cases
    assert _one(con, "SELECT count(DISTINCT case_id) FROM case_timeline") == cases


def test_parties_carry_a_person_key_and_the_seed_run_is_a_draft(con):
    assert _one(con, "SELECT count(*) FROM party WHERE person_key IS NULL") == 0
    assert _one(con, "SELECT count(*) FROM party WHERE person_key LIKE 'LIT%' OR person_key LIKE 'ORG%'") > 0
    assert _one(con, "SELECT count(*) FROM hearing WHERE status = 'scheduled'") == 0
    assert _one(con, """SELECT count(DISTINCT status) FROM causelist WHERE scheduling_run_id IS NOT NULL""") == 1
    assert _one(con, """SELECT any_value(status) FROM causelist WHERE scheduling_run_id IS NOT NULL""") == "draft"
    assert _one(con, "SELECT count(*) FROM scheduling_run WHERE additional_details->>'batch' <> 'seed'") == 0


def test_cli_round_trip(tmp_path):
    from datagen.__main__ import main

    main(["generate", "--out", str(tmp_path / "pq"), "--cases-per-judge", "20", "--presets", "sehgal"])
    main(["load", "--parquet", str(tmp_path / "pq"), "--db", str(tmp_path / "x.duckdb")])
    with duckdb.connect(str(tmp_path / "x.duckdb"), read_only=True) as c:
        assert c.execute("SELECT count(*) FROM court_case").fetchone()[0] == 20
