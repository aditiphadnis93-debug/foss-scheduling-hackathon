"""Per-role look: a faint wash of the role colour, a top bar and an accent for tabs, buttons and titles.

Light and dark mode belong to Streamlit (.streamlit/config.toml, switched in ⋮ → Settings). The role
colours sit on top as translucent washes and mid-tone accents that read on either background, so they
never depend on detecting the mode (st.context.theme lags a switch; Streamlit issue #11920).
Data colours (views/charts.py) stay the same in every role, and the accents avoid the chart hues.
"""
from __future__ import annotations

from dataclasses import dataclass

import streamlit as st


@dataclass(frozen=True)
class RoleTheme:
    icon: str
    accent: str  # mid-tone: ≥ 3:1 against both the light and the dark background


ROLE_THEMES: dict[str, RoleTheme] = {
    "Judge": RoleTheme("⚖", "#b83a4b"),  # burgundy: the bench
    "Court Master": RoleTheme("📋", "#0f8f84"),  # teal: court operations
    "Advocate": RoleTheme("💼", "#5563d6"),  # indigo: the bar
    "Litigant": RoleTheme("👤", "#8a5cd6"),  # violet: the public
}
ROLES = list(ROLE_THEMES)


def theme_mode() -> str:
    """Streamlit's current mode, for chart surfaces. May lag one rerun after the user switches."""
    try:
        return "dark" if st.context.theme.type == "dark" else "light"
    except Exception:
        return "light"


def _rgba(hex_colour: str, alpha: float) -> str:
    r, g, b = (int(hex_colour[i:i + 2], 16) for i in (1, 3, 5))
    return f"rgba({r}, {g}, {b}, {alpha})"


def css(role: str) -> str:
    a = ROLE_THEMES[role].accent
    wash, side = _rgba(a, 0.05), _rgba(a, 0.10)
    return f"""<style>
[data-testid="stApp"] {{ background-image: linear-gradient({wash}, {wash}); }}
[data-testid="stSidebar"] {{ background-image: linear-gradient({side}, {side}); }}
[data-testid="stHeader"] {{ background: transparent; border-top: 4px solid {a}; }}
h1 {{ color: {a}; }}
button[kind="primary"], button[kind="primaryFormSubmit"] {{ background-color: {a}; border-color: {a}; color: #fff; }}
[data-baseweb="tab-highlight"] {{ background-color: {a}; }}
button[role="tab"][aria-selected="true"] p {{ color: {a}; }}
.role-badge {{ display: inline-block; padding: 2px 10px; border-radius: 999px; background: {a}; color: #fff;
  font-size: 0.8rem; font-weight: 600; letter-spacing: 0.04em; vertical-align: middle; }}
</style>"""


def apply(role: str) -> None:
    st.markdown(css(role), unsafe_allow_html=True)


def badge(role: str) -> str:
    return f'<span class="role-badge">{ROLE_THEMES[role].icon} {role.upper()}</span>'
