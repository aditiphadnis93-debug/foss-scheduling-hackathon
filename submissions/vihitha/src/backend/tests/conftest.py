import os
import tempfile

import pytest

# Isolated database for the test session (set before the API is imported).
os.environ.setdefault("VIHITHA_STATE_DIR", tempfile.mkdtemp(prefix="vihitha_test_"))
os.environ.setdefault("VIHITHA_AUTOLOAD", "1")


@pytest.fixture(scope="session")
def client():
    from fastapi.testclient import TestClient

    from api.main import app

    with TestClient(app) as c:
        yield c


@pytest.fixture(scope="session")
def inputs():
    from vihitha.inputs import load_inputs

    return load_inputs()
