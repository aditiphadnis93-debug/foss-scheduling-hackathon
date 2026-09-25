"""Each signed-in role gets its own colours, readable on both the light and the dark theme."""
import tomllib
from pathlib import Path

import pytest

from views import charts
from views.theme import ROLE_THEMES, ROLES, badge, css

CONFIG = tomllib.loads((Path(__file__).resolve().parent.parent / ".streamlit" / "config.toml").read_text())


def luminance(hex_colour: str) -> float:
    def ch(c: float) -> float:
        c /= 255
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = (int(hex_colour[i:i + 2], 16) for i in (1, 3, 5))
    return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b)


def contrast(a: str, b: str) -> float:
    la, lb = sorted((luminance(a), luminance(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)


@pytest.mark.parametrize("role", ROLES)
def test_role_css_and_badge(role):
    assert ROLE_THEMES[role].accent in css(role)
    assert role.upper() in badge(role)


@pytest.mark.parametrize("role", ROLES)
@pytest.mark.parametrize("mode", ["light", "dark"])
def test_accent_reads_on_both_themes(role, mode):
    bg = CONFIG["theme"][mode]["backgroundColor"]
    assert contrast(ROLE_THEMES[role].accent, bg) >= 3.0
    assert contrast(ROLE_THEMES[role].accent, "#ffffff") >= 3.0  # white text on buttons and badges


def test_role_accents_are_distinct_and_not_chart_colours():
    accents = {t.accent for t in ROLE_THEMES.values()}
    assert len(accents) == len(ROLES)
    assert not accents & set(charts.SERIES["light"] + charts.SERIES["dark"])
