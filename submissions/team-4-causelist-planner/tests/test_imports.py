"""Every view module imports: the app's pages aren't otherwise loaded by the tests."""
import importlib
import pkgutil

import pytest

import views


@pytest.mark.parametrize("name", [m.name for m in pkgutil.iter_modules(views.__path__)])
def test_view_module_imports(name):
    importlib.import_module(f"views.{name}")
