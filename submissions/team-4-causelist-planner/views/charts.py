"""Plotly figures for the calendar views.

Colours follow the dataviz reference palette: categorical slots in fixed order (validated; the
three low-contrast slots are relieved by a text label on every bar and a table under every chart),
a one-hue blue ramp for magnitude, and status colours only next to an icon and a label.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta

import pandas as pd
import plotly.express as px
import plotly.graph_objects as go

SERIES = {"light": ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4"],
          "dark": ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181"]}
SURFACE = {"light": "#ffffff", "dark": "#0e1117"}
INK = "#0b0b0b"
SEQUENTIAL = ["#cde2fb", "#86b6ef", "#3987e5", "#1c5cab", "#104281"]
STATUS = {"good": "#0ca30c", "serious": "#ec835a", "critical": "#d03b3b"}
BASE_DAY = date(2000, 1, 3)  # week views put every day's times on one axis


def color_map(keys: list[str], mode: str) -> dict[str, str]:
    """Fixed order: the n-th entity always gets the n-th slot, whatever is on screen."""
    pal = SERIES[mode]
    return {k: pal[i % len(pal)] for i, k in enumerate(keys)}


def on_base_day(t: datetime) -> datetime:
    return datetime.combine(BASE_DAY, t.time())


def gantt(df: pd.DataFrame, y: str, color: str, keys: list[str], mode: str, *, text: str = "label",
          hover: list[str] | None = None, y_order: list[str] | None = None, title: str = "",
          time_only: bool = False) -> go.Figure:
    """Horizontal bars from `start` to `end`; one row per `y`, first row on top."""
    fig = px.timeline(df, x_start="start", x_end="end", y=y, color=color, text=text,
                      hover_data=hover or [], color_discrete_map=color_map(keys, mode),
                      category_orders={y: y_order or list(dict.fromkeys(df[y])), color: keys}, title=title)
    fig.update_traces(textposition="inside", insidetextanchor="start", textfont_color=INK,
                      marker_line_width=2, marker_line_color=SURFACE[mode])
    fig.update_yaxes(autorange="reversed", title=None)
    fig.update_xaxes(title=None, tickformat="%H:%M" if time_only else None, showgrid=True)
    fig.update_layout(legend=dict(title_text="", orientation="h", yanchor="bottom", y=1.0, xanchor="right", x=1),
                      height=max(240, 90 + 34 * df[y].nunique()), margin=dict(l=10, r=10, t=70 if title else 30, b=10))
    return fig


def month_grid(counts: dict[date, int], title: str = "") -> go.Figure:
    """Calendar month grid: weeks down, Mon–Sat across, cell shade = cases listed."""
    if not counts:
        return go.Figure()
    first = min(counts) - timedelta(days=min(counts).weekday())
    weeks = sorted({(d - timedelta(days=d.weekday())) for d in counts} | {first})
    cols = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
    z, text, hover = [], [], []
    for w in weeks:
        row_z, row_t, row_h = [], [], []
        for i in range(6):
            d = w + timedelta(days=i)
            n = counts.get(d)
            row_z.append(n)
            row_t.append(f"{d:%d %b}<br><b>{n}</b>" if n is not None else f"{d:%d %b}<br>—")
            row_h.append(f"{d:%a %d %b}: {n} listed" if n is not None else f"{d:%a %d %b}: not sitting")
        z.append(row_z)
        text.append(row_t)
        hover.append(row_h)
    fig = go.Figure(go.Heatmap(
        z=z, x=cols, y=[f"Week of {w:%d %b}" for w in weeks], text=text, texttemplate="%{text}",
        hovertext=hover, hovertemplate="%{hovertext}<extra></extra>", xgap=2, ygap=2,
        colorscale=[[i / (len(SEQUENTIAL) - 1), c] for i, c in enumerate(SEQUENTIAL)],
        colorbar=dict(title="Listed"), zmin=0))
    fig.update_yaxes(autorange="reversed")
    fig.update_layout(title=title, height=90 + 70 * len(weeks), margin=dict(l=10, r=10, t=50 if title else 10, b=10))
    return fig


OUTCOME_STYLE = {  # status colour + marker symbol + label, never colour alone
    "effective": (STATUS["good"], "circle", "✓ effective"),
    "heard, not effective": (STATUS["serious"], "diamond", "◆ heard, not effective"),
    "not heard": (STATUS["critical"], "x", "✕ not heard"),
    "listed": (SERIES["light"][0], "star", "★ listed (upcoming)"),
}


def timeline_strip(entries: list, title: str = "") -> go.Figure:
    """One dot per hearing along the case's life, outcome by colour + shape + legend label."""
    fig = go.Figure()
    for outcome, (colour, symbol, label) in OUTCOME_STYLE.items():
        pts = [e for e in entries if e.outcome == outcome]
        if pts:
            fig.add_trace(go.Scatter(
                x=[e.day for e in pts], y=[0] * len(pts), mode="markers", name=label,
                marker=dict(color=colour, symbol=symbol, size=12, line=dict(width=2, color="#ffffff")),
                customdata=[[(e.purpose or "").replace("_", " "), e.detail] for e in pts],
                hovertemplate="%{x|%d %b %Y}<br>%{customdata[0]}<br>%{customdata[1]}<extra></extra>"))
    filed = [e for e in entries if e.kind == "filed"]
    if filed:
        fig.add_vline(x=filed[0].day, line_width=1, line_dash="dot")
        fig.add_annotation(x=filed[0].day, y=0.8, text="filed", showarrow=False)
    fig.update_yaxes(visible=False, range=[-1, 1])
    fig.update_layout(title=title, height=170, legend_orientation="h", legend_y=-0.35,
                      margin=dict(l=10, r=10, t=40 if title else 10, b=10))
    return fig


def window_load(df: pd.DataFrame, keys: list[str], mode: str, title: str = "") -> go.Figure:
    """Expected hearing minutes per half hour, cases taken one after another, against the 30 available.

    `df`: slot (datetime on BASE_DAY), block, minutes, label. Bars past a block's end are its expected overrun.
    """
    fig = px.bar(df, x="slot", y="minutes", color="block", text="label", color_discrete_map=color_map(keys, mode),
                 category_orders={"block": keys}, title=title,
                 labels={"slot": "", "minutes": "Expected minutes", "block": ""})
    fig.update_traces(textposition="outside", marker_line_width=0, width=30 * 60 * 1000 * 0.85,
                      hovertemplate="%{x|%H:%M}: %{y:.0f} expected minutes<extra></extra>")
    fig.add_hline(y=30, line_dash="dot", line_width=1, annotation_text="30 min available",
                  annotation_position="top left")
    fig.update_xaxes(tickformat="%H:%M", showgrid=False)
    fig.update_yaxes(rangemode="tozero")
    fig.update_layout(legend=dict(title_text="", orientation="h", yanchor="bottom", y=1.0, xanchor="right", x=1),
                      height=260, margin=dict(l=10, r=10, t=70 if title else 30, b=10), bargap=0.1)
    return fig


AGE_BUCKETS = ["5y+", "4-5y", "3-4y", "1-3y", "<1y"]  # stacked from the bottom: oldest first
KIND_PATTERN = {"Published": "/", "Set by the judge": "x", "Tentative": ""}
KIND_ACCENT = {"Published": 1, "Set by the judge": 3}  # SERIES slots: orange, amber; both clear of the blue ramp


def _kind_marker(fill: str, kind: str, mode: str) -> dict:
    """The age colour as the fill; published / judge-set add their accent hatch (overlay keeps the fill)
    and an accent outline. Tentative is plain, split from its neighbours by a surface-coloured line."""
    if kind not in KIND_ACCENT:
        return dict(color=fill, line=dict(width=1, color=SURFACE[mode]))
    accent = SERIES[mode][KIND_ACCENT[kind]]
    return dict(color=fill, line=dict(width=2, color=accent),
                pattern=dict(shape=KIND_PATTERN[kind], fillmode="overlay", fgcolor=accent, size=7, solidity=0.35))


def day_load(df: pd.DataFrame, days: list[date], mode: str, limit: float, day: float | None = None,
             title: str = "") -> go.Figure:
    """Expected minutes booked per sitting day, stacked by case age, against the planning limit (and the
    full day above it, when `day` is given: the gap between the lines is the ad-hoc buffer).

    Age is ordered, so it takes the one-hue ramp: darker = older in light mode; in dark mode the ramp
    turns round so the oldest cases are the brightest. Booking kind is an accent-coloured hatch and outline
    over the age colour (orange / = published, amber x = set by the judge), so both stay readable.
    `df`: day, age, kind, minutes, listings. `days`: every sitting day, in order; only these get a slot,
    so weekends and holidays don't appear as empty days.
    """
    order = [f"{d:%a %d %b}" for d in days]
    ramp = SEQUENTIAL[::-1] if mode == "light" else SEQUENTIAL  # AGE_BUCKETS runs oldest → newest
    colour = dict(zip(AGE_BUCKETS, ramp))
    df = df.assign(label=[f"{d:%a %d %b}" for d in df["day"]])
    fig = go.Figure()
    for age in AGE_BUCKETS:
        for kind, shape in KIND_PATTERN.items():
            part = df[(df["age"] == age) & (df["kind"] == kind)]
            if part.empty:
                continue
            fig.add_bar(
                x=part["label"], y=part["minutes"], name=age, legendgroup=age,
                showlegend=False,
                marker=_kind_marker(colour[age], kind, mode),
                customdata=part[["listings"]].assign(kind=kind, age=age).to_numpy(),
                hovertemplate="%{x} · %{customdata[2]} · %{customdata[1]}<br>"
                              "%{y:.0f} expected min · %{customdata[0]} listings<extra></extra>")
    for age in AGE_BUCKETS:  # plain legend keys, so a hatched segment never stands for its age
        if (df["age"] == age).any():
            fig.add_bar(x=[None], y=[None], name=age, legendgroup=age, marker=_kind_marker(colour[age], "", mode))
    for kind in KIND_ACCENT:  # legend keys for the booking kinds, over a neutral grey
        if (df["kind"] == kind).any():
            fig.add_bar(x=[None], y=[None], name=kind, legendgroup=kind, marker=_kind_marker("#8a8f98", kind, mode))
    fig.add_hline(y=limit, line_dash="dot", line_width=1, annotation_text=f"{limit:.0f} min planned",
                  annotation_position="bottom left")
    if day:
        fig.add_hline(y=day, line_dash="dash", line_width=1, annotation_text=f"{day:.0f} min day · "
                      f"{day - limit:.0f} min ad-hoc buffer", annotation_position="top left")
    fig.update_xaxes(showgrid=False, type="category", categoryorder="array", categoryarray=order)
    fig.update_yaxes(rangemode="tozero", title="Expected minutes", range=[0, (day or limit) * 1.08])
    fig.update_layout(barmode="stack", title=title, height=320, bargap=0.15,
                      legend=dict(title_text="Case age", orientation="h", yanchor="bottom", y=1.0, xanchor="right",
                                  x=1, traceorder="normal"),
                      margin=dict(l=10, r=10, t=70 if title else 30, b=10))
    return fig


TIGHT_MINUTES = 30  # fits, but with less than this to spare: "tight"


def availability_strip(cells: pd.DataFrame, picks: dict[str, date | None], selected: date | None,
                       mode: str) -> go.Figure:
    """One row of sitting days, coloured by whether this hearing fits: red ✕ full, orange ! tight
    (fits with under 30 min to spare), green ✓ room. Status colours, each with its own symbol.

    `cells`: day, free, need (this hearing's expected minutes), early (before the usual gap),
    late (over 2× the gap), hover.
    `picks`: row label → the day to mark in that row (Best fit, Nearest, Earliest). A single heatmap
    with text axes, like month_grid: mark rows carry a symbol and no fill, and every row is labelled
    on the axis, so nothing relies on colour alone.
    """
    days = list(cells["day"])
    x = [f"{d:%a %d %b}" for d in days]
    symbols = dict(zip(picks, ("★", "◆", "▲")))
    rows = [*picks, "This hearing", "Before the usual gap", "More than 2× gap"]  # top → bottom
    z, text, hover = [], [], []
    for row in rows:
        if row == "This hearing":
            level = [0 if f < n else 1 if f - n < TIGHT_MINUTES else 2 for f, n in zip(cells["free"], cells["need"])]
            z.append(level)
            text.append([("✕", "!", "✓")[v] for v in level])
        else:
            z.append([None] * len(days))
            if row in picks:
                text.append([symbols[row] if d == picks[row] else "" for d in days])
            else:
                col = "early" if row == "Before the usual gap" else "late"
                text.append(["◀" if col == "early" and v else "▶" if v else "" for v in cells[col]])
        hover.append(cells["hover"].tolist())
    fig = go.Figure(go.Heatmap(
        z=z, x=x, y=rows, text=text, texttemplate="%{text}", hovertext=hover,
        hovertemplate="%{hovertext}<extra></extra>", xgap=2, ygap=2, zmin=-0.5, zmax=2.5,
        colorscale=[[0, STATUS["critical"]], [1 / 3, STATUS["critical"]], [1 / 3, STATUS["serious"]],
                    [2 / 3, STATUS["serious"]], [2 / 3, STATUS["good"]], [1, STATUS["good"]]],
        textfont=dict(color=INK, size=12),
        colorbar=dict(tickvals=[0, 1, 2], ticktext=["✕ full", "! tight", "✓ room"], thickness=10, len=0.6)))
    if selected in days:
        k, r = days.index(selected), rows.index("This hearing")
        fig.add_shape(type="rect", x0=k - 0.5, x1=k + 0.5, y0=r - 0.5, y1=r + 0.5,
                      line=dict(color=INK if mode == "light" else "#e6e8eb", width=3))
    ticks = [f"{d:%d}" + (f"<br>{d:%b}" if i == 0 or d.month != days[i - 1].month else "") for i, d in enumerate(days)]
    fig.update_xaxes(tickvals=x, ticktext=ticks, showgrid=False, tickfont=dict(size=10))
    fig.update_yaxes(autorange="reversed", showgrid=False, tickfont=dict(size=11))
    fig.update_layout(height=60 + 28 * len(rows), margin=dict(l=10, r=10, t=10, b=10))
    return fig
