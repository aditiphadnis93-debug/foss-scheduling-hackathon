"""The app's data layer: the dataset becomes scheduler input without losing what the pipeline needs."""
from datetime import date

from scheduler.config import list_presets, load_preset
from scheduler.store import OPEN_TASK


def test_every_preset_is_a_judge(store):
    assert len(store.judges) == len(list_presets())
    assert all(j.hall and j.name for j in store.judges)


def test_preset_rows_round_trip_to_the_yaml_config(store):
    """Same blocks, weights and clamps as loading the YAML; leave is the YAML's plus the dataset's."""
    by_name = {load_preset(p).name: load_preset(p) for p in list_presets()}
    for j in store.judges:
        cfg, yaml_cfg = store.config(j.id), by_name[j.preset_name]
        assert cfg.blocks == yaml_cfg.blocks
        assert cfg.weights == yaml_cfg.weights
        assert cfg.listing_factor == yaml_cfg.listing_factor and cfg.clamped == yaml_cfg.clamped
        assert (cfg.courtroom, cfg.case_types, cfg.cover_page_for) == \
               (yaml_cfg.courtroom, yaml_cfg.case_types, yaml_cfg.cover_page_for)
        assert set(yaml_cfg.leave) <= set(cfg.leave)


def test_overrides_are_clamped_like_a_preset(store):
    j = store.judges[0].id
    cfg = store.config(j, {"listing_factor": 5.0, "weights": {"age": 0}})
    assert cfg.listing_factor == 1.3 and cfg.weights["age"] == 3.0 and len(cfg.clamped) == 2


def test_cases_map_the_rows_the_pipeline_needs(store):
    for j in store.judges:
        cases = store.cases(j.id)
        ids = [c.id for c in cases]
        rows = {r["id"]: r for r in store.rows(
            "SELECT * FROM court_case WHERE judge_id = ? AND status <> 'disposed'", [j.id])}
        assert set(ids) == set(rows) and len(ids) == len(set(ids))
        for c in cases:
            r = rows[c.id]
            assert c.purpose == r["next_purpose_code"] and c.last_heard == r["last_heard_date"]
            assert c.adjournment_count == r["adjournment_count"] and c.urgent == r["is_urgent"]
            assert c.next_date is None and not c.disposed
            assert c.advocate_ids and c.parties
        # advocates: the petitioner's primary advocate comes first
        first = dict(store.cursor().execute("""
            SELECT m.case_id, m.advocate_id FROM advocate_mapping m JOIN party p ON p.id = m.party_id
            WHERE p.party_number = 'P1' AND m.advocate_type = 'primary'""").fetchall())
        assert all(c.advocate_ids[0] == first[c.id] for c in cases if c.id in first)


def test_prerequisites_follow_open_tasks(store):
    blocked = {r[0] for r in store.cursor().execute(f"""
        SELECT t.case_id FROM task t JOIN court_case c ON c.id = t.case_id
        WHERE t.service_status IN {OPEN_TASK}
          AND (t.blocks_hearing_type IS NULL OR t.blocks_hearing_type = c.next_purpose_code)""").fetchall()}
    cases = [c for j in store.judges for c in store.cases(j.id)]
    assert blocked and any(c.prerequisites_met for c in cases)
    assert all(c.prerequisites_met == (c.id not in blocked) for c in cases)


def test_hearing_types_match_and_today_comes_from_the_manifest(store):
    assert store.hearing_type_mismatches() == []
    assert store.today == date.fromisoformat(store.manifest["today"])
    assert not store.stale


def test_docket_insights_query_the_real_tables(store):
    d = store.docket(store.judges[0].id)
    assert d["ages"]["cases"].sum() == len(store.cases(store.judges[0].id))
    assert not d["reasons"].empty and not d["advocates"].empty
