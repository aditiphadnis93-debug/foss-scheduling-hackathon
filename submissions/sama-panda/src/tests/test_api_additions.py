from fastapi.testclient import TestClient

from src.main import app
from src.seed import DEFAULT_ROSTER, resolve_default_roster


def test_policy_items_include_descriptions():
    with TestClient(app) as client:
        response = client.get("/policy")
    assert response.status_code == 200
    items = response.json()["policy"]
    assert items
    assert all(item["description"] for item in items)


def test_calendar_range_includes_janmashtami():
    with TestClient(app) as client:
        response = client.get("/calendar?from=2026-09-01&to=2026-09-07")
    assert response.status_code == 200
    days = response.json()["days"]
    holiday = next(day for day in days if day["date"] == "2026-09-04")
    assert holiday["is_holiday"] is True
    assert holiday["is_working_day"] is False
    assert "Janmashtami" in holiday["holiday_name"]


def test_default_roster_prefers_existing_3k_file():
    roster = resolve_default_roster()
    assert roster.exists()
    assert roster.name == "roster_3000.csv"
    assert roster.resolve() == DEFAULT_ROSTER.resolve()
