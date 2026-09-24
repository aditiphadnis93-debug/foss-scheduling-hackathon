"""Results page (static HTML + Chart.js) and the sample causelist CSV."""

from __future__ import annotations

import csv
import html
import json
from datetime import datetime, timedelta
from pathlib import Path

from .experiment import mean_ci, paired_delta
from .sim import RunResult

METRICS = [  # (key, label, higher_is_better, fmt)
    ("utilisation", "Utilisation", True, "pct"),
    ("reach_rate", "Reach rate", True, "pct"),
    ("substantiveness", "Substantiveness", True, "pct"),
    ("old_heard", "4+ yr cases heard", True, "pct"),
    ("predictability_days", "Days late vs first scheduled", False, "num"),
]
COUNTER = [
    ("listed_per_day", "Listed per day  ↔ reach rate", None, "num"),
    ("substantive_per_day", "Substantive hearings per day  ↔ substantiveness", True, "num"),
    ("old_advanced", "4+ yr cases advanced  ↔ 4+ yr heard", True, "pct"),
    ("stage_advances", "Stage advances (posting)", True, "num"),
    ("appearances_per_advance", "Appearances per stage advance", False, "num"),
    ("projected_days_to_disposal", "Projected days to disposal", False, "num"),
    ("wasted_on_pending_process", "Listings wasted on pending process / day", False, "num"),
    ("slot_kept", "Slot kept", True, "pct"),
    ("trips_per_case", "Trips per case (advocate)", False, "num"),
    ("idle_minutes_per_day", "Idle minutes per day", False, "num"),
    ("disposals", "Disposals (posting)", True, "num"),
    ("adjournment_heavy_heard", "Adjournment-heavy cases heard (fairness guard)", True, "pct"),
    ("adjournment_heavy_advanced", "Adjournment-heavy cases advanced (fairness guard)", True, "pct"),
]


def fmt(v: float, kind: str) -> str:
    if v != v:  # nan
        return "—"
    return f"{v * 100:.1f}%" if kind == "pct" else f"{v:,.2f}"


def _series(grid: dict, label: str, key: str) -> list[float]:
    runs = grid[label][key]
    return [sum(r[i] for r in runs) / len(runs) for i in range(len(runs[0]))] if runs else []


def write_causelist(res: RunResult, day, path: Path, opens_at: str = "10:00") -> None:
    t0 = datetime.strptime(opens_at, "%H:%M")
    rows = [r for r in res.listings if r.day == day]
    with open(path, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["order", "slot", "case_number", "advocate_id", "hearing_purpose", "age_4plus",
                    "expected_minutes", "why_listed"])
        for i, r in enumerate(rows, 1):
            s = t0 + timedelta(minutes=r.slot_start or 0)
            e = s + timedelta(minutes=60)
            w.writerow([i, f"{s:%H:%M}-{e:%H:%M}", r.case_id, r.advocate, r.purpose,
                        "yes" if r.old else "", f"{r.exp_minutes:.0f}", r.why])


def build_page(exps: dict[str, dict], seeds: list[int], sample: RunResult, sample_day, meta: dict) -> str:
    H = exps["headline"]
    base, l1, l2 = H["Current practice"]["scores"], H["Rule-based"]["scores"], H["Adaptive"]["scores"]

    def row(key, label, hib, kind):
        bm, _ = mean_ci([base[s][key] for s in base])
        l1m, _ = mean_ci([l1[s][key] for s in l1])
        lm, lci = mean_ci([l2[s][key] for s in l2])
        d, dci = paired_delta(base, l2, key)
        good = "" if hib is None or d != d else ("up" if (d > 0) == hib and abs(d) > dci else
                                                  "down" if (d < 0) == hib and abs(d) > dci else "")
        scale = 100 if kind == "pct" else 1
        unit = " pp" if kind == "pct" else ""
        dtxt = "—" if d != d else f"{d * scale:+.1f}{unit} ± {dci * scale:.1f}"
        return (f"<tr><td>{html.escape(label)}</td><td>{fmt(bm, kind)}</td><td>{fmt(l1m, kind)}</td>"
                f"<td>{fmt(lm, kind)}</td><td class='{good}'>{dtxt}</td></tr>")

    def table(name: str, keys) -> str:
        g = exps[name]
        head = "".join(f"<th>{html.escape(lab)}</th>" for _, lab, _, _ in keys)
        body = ""
        for label, cell in g.items():
            sc = cell["scores"]
            body += f"<tr><td>{html.escape(label)}</td>" + "".join(
                f"<td>{fmt(mean_ci([sc[i][k] for i in sc])[0], kind)}</td>" for k, _, _, kind in keys) + "</tr>"
        return f"<table><tr><th></th>{head}</tr>{body}</table>"

    tkeys = [("substantiveness", "Substantive", True, "pct"), ("substantive_per_day", "Subst./day", True, "num"),
             ("old_heard", "4+ yr heard", True, "pct"), ("old_advanced", "4+ yr advanced", True, "pct"),
             ("appearances_per_advance", "App./advance", False, "num"), ("trips_per_case", "Trips/case", False, "num"),
             ("adjournment_heavy_heard", "Adj.-heavy heard", True, "pct"), ("adjournment_heavy_advanced", "Adj.-heavy advanced", True, "pct"), ("projected_days_to_disposal", "Proj. days", False, "num")]
    styles_table = table("styles", tkeys)
    model_table = table("model", tkeys)

    head_rows = "".join(row(*m) for m in METRICS)
    counter_rows = "".join(row(*m) for m in COUNTER)

    def sweep(name: str, keys: list[tuple[str, str]]):
        g = exps[name]
        labels = list(g)
        data = {k: [mean_ci([g[l]["scores"][s][k] for s in g[l]["scores"]])[0] for l in labels] for k, _ in keys}
        return {"labels": labels, "series": [{"label": lab, "key": k, "data": data[k]} for k, lab in keys]}

    charts = {
        "fill": sweep("fill", [("utilisation", "Utilisation"), ("reach_rate", "Reach rate"), ("slot_kept", "Slot kept")]),
        "old_share": sweep("old_share", [("old_heard", "4+ yr heard"), ("old_advanced", "4+ yr advanced"), ("substantiveness", "Substantiveness")]),
        "spacing": sweep("spacing", [("appearances_per_advance", "Appearances per advance"), ("stage_advances", "Stage advances ÷100"), ("projected_days_to_disposal", "Projected days to disposal ÷1000")]),
        "tracking": sweep("tracking", [("wasted_on_pending_process", "Wasted listings/day"), ("substantive_per_day", "Substantive/day ÷10")]),
        "grouping": sweep("grouping", [("trips_per_case", "Trips per case"), ("old_heard", "4+ yr heard")]),
        "assumptions": sweep("assumptions", [("substantiveness", "Substantiveness"), ("old_heard", "4+ yr heard"), ("utilisation", "Utilisation")]),
    }
    for s in charts["spacing"]["series"]:
        if "÷100" in s["label"]:
            s["data"] = [x / 100 for x in s["data"]]
        if "÷1000" in s["label"]:
            s["data"] = [x / 1000 for x in s["data"]]
    for s in charts["tracking"]["series"]:
        if "÷10" in s["label"]:
            s["data"] = [x / 10 for x in s["data"]]
    backlog = {
        "days": [str(d) for d in sample.days],
        "series": [
            {"label": "Current practice: 4+ yr heard", "data": _series(H, "Current practice", "old_heard")},
            {"label": "Adaptive: 4+ yr heard", "data": _series(H, "Adaptive", "old_heard")},
            {"label": "Current practice: 4+ yr advanced", "data": _series(H, "Current practice", "old_advanced")},
            {"label": "Adaptive: 4+ yr advanced", "data": _series(H, "Adaptive", "old_advanced")},
        ],
    }
    cl_rows = "".join(
        f"<tr><td>{i}</td><td>{html.escape(r.case_id)}</td><td>{r.advocate}</td><td>{r.purpose.title().replace('_', ' ')}</td>"
        f"<td>{'●' if r.old else ''}</td><td>{(datetime(2000,1,1,10)+timedelta(minutes=r.slot_start or 0)):%H:%M}</td>"
        f"<td>{html.escape(r.why)}</td></tr>"
        for i, r in enumerate([r for r in sample.listings if r.day == sample_day], 1))
    return TEMPLATE.format(
        styles_table=styles_table, model_table=model_table,
        seeds=len(seeds), head_rows=head_rows, counter_rows=counter_rows, cl_rows=cl_rows,
        sample_day=sample_day, charts=json.dumps(charts), backlog=json.dumps(backlog),
        meta=html.escape(json.dumps(meta, indent=1)),
    )


TEMPLATE = """<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Scheduling Justice — results</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
<style>
:root{{--bg:#fbfaf7;--fg:#1d1d1b;--mut:#6b6a66;--line:#e4e1da;--acc:#1f7a5a;--bad:#b3261e;--card:#fff}}
@media (prefers-color-scheme:dark){{:root{{--bg:#16171a;--fg:#e8e6e1;--mut:#9a988f;--line:#2d2f34;--acc:#4cc59a;--bad:#f2867e;--card:#1e2024}}}}
body{{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,sans-serif}}
main{{max-width:980px;margin:0 auto;padding:32px 18px 80px}} h1{{margin:0 0 4px;font-size:26px}}
h2{{font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:var(--acc);margin:36px 0 10px}}
.sub,.note{{color:var(--mut);font-size:14px}} table{{width:100%;border-collapse:collapse;font-size:14px}}
td,th{{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line)}} th{{font-size:12px;color:var(--mut);text-transform:uppercase}}
td.up{{color:var(--acc);font-weight:600}} td.down{{color:var(--bad);font-weight:600}}
.grid{{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:14px}}
.card{{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px}} .card h3{{margin:0 0 4px;font-size:15px}}
pre{{font-size:12px;background:var(--card);border:1px solid var(--line);padding:10px;border-radius:8px;overflow:auto}}
.scroll{{max-height:420px;overflow:auto}}
</style></head><body><main>
<h1>Scheduling Justice — results</h1>
<p class="sub">3,000-case roster · posting 1 Oct – 15 Dec 2026 · 420 min/day · {seeds} paired seeds (same roster and same pre-drawn outcomes for every strategy). Rule-based = fixed rules; Adaptive = rule-based + a per-case prediction model. Δ = adaptive − current practice, mean ± 95% CI. Green = significantly better, red = significantly worse.</p>

<h2>Scorecard — the five brief metrics</h2>
<table><tr><th>Metric</th><th>Current practice</th><th>Rule-based</th><th>Adaptive</th><th>Δ adaptive vs current</th></tr>{head_rows}</table>
<h2>Counter-metrics and case-life measures</h2>
<p class="note">Each headline metric can be gamed alone; these sit beside them.</p>
<table><tr><th>Metric</th><th>Current practice</th><th>Rule-based</th><th>Adaptive</th><th>Δ adaptive vs current</th></tr>{counter_rows}</table>

<h2>Scheduling styles (the brief's three judges), as settings on the adaptive planner</h2>
<p class="note">No single winner. Easy-first tops “substantive” while old cases fall behind; oldest-first clears the backlog but wastes appearances.</p>
{styles_table}

<h2>The per-case model (adaptive planner): when does it help, and at whose cost?</h2>
<p class="note">The adaptive planner estimates each case's odds from its hearing history and updates after every appearance. By default it only sizes the day and spaces hearings. Letting it <i>rank</i> cases buys efficiency but pushes adjournment-heavy (“hard”) cases down: the fairness trade-off, made visible.</p>
{model_table}

<h2>Old-case backlog over the posting</h2>
<div class="card"><canvas id="backlog" height="110"></canvas></div>

<h2>What-if: turn a knob, see the trade-off</h2>
<div class="grid">
<div class="card"><h3>How full should a day be?</h3><p class="note">Fill level = chance the day fits in 420 min.</p><canvas id="fill"></canvas></div>
<div class="card"><h3>What does protecting old cases cost?</h3><p class="note">Old-case guarantee share of minutes.</p><canvas id="old_share"></canvas></div>
<div class="card"><h3>How far apart should appearances be?</h3><p class="note">Multiplier on published gaps (with the preparation ramp).</p><canvas id="spacing"></canvas></div>
<div class="card"><h3>What does process tracking save?</h3><p class="note">Planner knows whether summons/warrant is back.</p><canvas id="tracking"></canvas></div>
<div class="card"><h3>Does advocate grouping help?</h3><p class="note">Uniform (organisers' generator) vs lopsided caseload (ours).</p><canvas id="grouping"></canvas></div>
<div class="card"><h3>Do our assumptions change the story?</h3><p class="note">Same planner, different worlds.</p><canvas id="assumptions"></canvas></div>
</div>

<h2>Sample causelist — {sample_day} (adaptive planner, seed 0)</h2>
<div class="scroll"><table><tr><th>#</th><th>Case</th><th>Advocate</th><th>Purpose</th><th>4+ yr</th><th>Slot</th><th>Why listed</th></tr>{cl_rows}</table></div>

<h2>Run settings</h2><pre>{meta}</pre>
</main>
<script>
const C={charts}, B={backlog};
const pal=['#1f7a5a','#2a5db0','#b36b00','#7a3fb0','#b3261e'];
for (const [id,c] of Object.entries(C)) {{
  new Chart(document.getElementById(id),{{type:'line',data:{{labels:c.labels,datasets:c.series.map((s,i)=>({{label:s.label,data:s.data,borderColor:pal[i],backgroundColor:pal[i],tension:.2}}))}},
    options:{{plugins:{{legend:{{position:'bottom',labels:{{boxWidth:10}}}}}},scales:{{y:{{beginAtZero:true}}}}}}}});
}}
new Chart(document.getElementById('backlog'),{{type:'line',data:{{labels:B.days,datasets:B.series.map((s,i)=>({{label:s.label,data:s.data,borderColor:pal[i%4],borderDash:i<2?[]:[5,4],pointRadius:0,tension:.2}}))}},
  options:{{plugins:{{legend:{{position:'bottom'}}}},scales:{{y:{{beginAtZero:true,ticks:{{callback:v=>Math.round(v*100)+'%'}}}}}}}}}});
</script></body></html>"""
