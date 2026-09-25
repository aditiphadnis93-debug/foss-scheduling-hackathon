"""A small generated dataset and a store over it, shared by the tests that need app data."""
import pytest

from datagen import build
from scheduler.store import open_store


@pytest.fixture(scope="session")
def dataset(tmp_path_factory):
    out = tmp_path_factory.mktemp("dataset")
    build(out, cases_per_judge=200, seed=5, horizon_days=5)
    return out


@pytest.fixture(scope="session")
def store(dataset, tmp_path_factory):
    s = open_store(tmp_path_factory.mktemp("db") / "court.duckdb", dataset)
    yield s
    s.close()


@pytest.fixture
def fresh_store(dataset, tmp_path):
    """A private working DB, for tests that write (saved schedules)."""
    s = open_store(tmp_path / "court.duckdb", dataset)
    yield s
    s.close()
