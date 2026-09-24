"""Command line: the scoring contract. Runs the engine without the database.

    python -m vihitha.cli generate-roster --n 3000 --seed 42 --out ../data/roster_3000.csv
    python -m vihitha.cli run --roster ../data/roster_3000.csv --preset optimal --runs 3 --out proposed_schedule.csv
    python -m vihitha.cli compare --presets baseline,optimal,sehgal,dimakar,joshi
    python -m vihitha.cli plan --from 2026-09-24 --days 20 --out cause_list.csv
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import date
from pathlib import Path

from . import export, loaders
from . import roster as roster_mod
from .enums import HearingType
from .estimates import expected_minutes
from .inputs import DEFAULT_END, DEFAULT_START, load_inputs, parse_leave
from .metrics import HEADLINE, LABELS, LOWER_IS_BETTER, PERCENT, aggregate, compute_run, with_baseline
from .planner import assign_pool
from .rules import resolve, rules_from_dict
from .simulate import DEFAULT_HORIZON_WORKING_DAYS, build_cases, horizon_days, new_state, simulate_many
from .windows import PackItem, pack_day


def _fmt(k: str, v) -> str:
    if v is None:
        return "-"
    return f"{v * 100:.1f}%" if k in PERCENT else f"{v:.1f}"


def _delta(k: str, v) -> str:
    if v is None:
        return "-"
    return (f"{v * 100:+.1f} pts" if k in PERCENT else f"{v:+.1f}").replace("-", "−")


def _date(s: str) -> date:
    return date.fromisoformat(s)


def _rules(a):
    if getattr(a, "rules", None):
        return resolve(rules=rules_from_dict(json.loads(Path(a.rules).read_text())), agents=a.agents)
    return resolve(preset_name=a.preset, agents=a.agents)


def cmd_generate(a) -> int:
    base = loaders.read_roster(a.base) if a.base else loaders.load_sample_roster(a.data_dir)
    df = roster_mod.generate(a.n, a.seed, base)
    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(a.out, index=False)
    print(f"Wrote {len(df)} cases to {a.out} (bootstrap-resampled from the 100-case sample: more of the same mix)")
    return 0


def score(inp, rules, start, end, seed, runs, horizon=DEFAULT_HORIZON_WORKING_DAYS, baseline=True):
    """Six official metrics (+ baseline). Shared with the API's /metrics/scoring."""
    sims = simulate_many(inp.roster, inp.calendar, inp.ref, rules, start, end, seed, runs,
                         horizon_working_days=horizon)
    agg = aggregate([compute_run(s) for s in sims])
    base = None
    if baseline and not rules.is_baseline:
        b, _ = resolve(preset_name="baseline")
        bs = simulate_many(inp.roster, inp.calendar, inp.ref, b, start, end, seed, runs,
                           horizon_working_days=horizon)
        base = aggregate([compute_run(s) for s in bs])
    return sims, with_baseline(agg, base)


def cmd_run(a) -> int:
    t0 = time.perf_counter()
    inp = load_inputs(a.roster, a.data_dir, parse_leave(a.leave))
    rules, warnings = _rules(a)
    sims, m = score(inp, rules, a.start, a.end, a.seed, a.runs, a.horizon, baseline=not a.no_baseline)
    rows = export.write(export.rows_from_sim(sims[0]), a.out) if a.out else None
    if a.json:
        print(json.dumps({"preset": rules.preset, "warnings": warnings, "metrics": m}, indent=2, default=str))
        return 0
    print(f"Vihitha — preset: {rules.preset} | roster: {len(inp.roster)} cases | {a.start} → {a.end} | "
          f"{len(sims[0].sitting_days)} sitting days | runs: {a.runs} | agents: {'on' if rules.agents.enabled else 'off'}")
    for w in warnings:
        print(f"  ! Guardrail: {w['field']} {w['requested']} → {w['applied']}. {w['message']}")
    print(f"{'Metric':<30}{'Vihitha':<13}{'Baseline':<13}Δ")
    for k in HEADLINE:
        v = m[k]
        print(f"{LABELS[k]:<30}{_fmt(k, v['value']):<13}{_fmt(k, v['baseline']):<13}{_delta(k, v['delta'])}")
    if a.verbose:
        for k, v in m["extras"].items():
            print(f"  {k:<28} {v if not isinstance(v, float) else round(v, 3)}")
    if rows is not None:
        print(f"Wrote {a.out} ({rows} rows, first seed)")
    print(f"({time.perf_counter() - t0:.1f} s)")
    return 0


def cmd_compare(a) -> int:
    inp = load_inputs(a.roster, a.data_dir, parse_leave(a.leave))
    names = [p.strip() for p in a.presets.split(",") if p.strip()]
    modes = {"off": [False], "on": [True], "both": [False, True]}[a.agents]
    cols = []
    for name in names:
        for ag in modes:
            r, _ = resolve(preset_name=name, agents=ag)
            label = name if len(modes) == 1 else f"{name}{'+agents' if ag else ''}"
            sims = simulate_many(inp.roster, inp.calendar, inp.ref, r, a.start, a.end, a.seed, a.runs,
                                 horizon_working_days=a.horizon)
            cols.append((label, aggregate([compute_run(s) for s in sims])))
    if a.json:
        print(json.dumps({label: m for label, m in cols}, indent=2, default=str))
        return 0
    print(f"Vihitha compare | roster: {len(inp.roster)} cases | {a.start} → {a.end} | runs: {a.runs}")
    width = max(12, max(len(l) for l, _ in cols) + 2)
    print(f"{'Metric':<30}" + "".join(f"{l:<{width}}" for l, _ in cols))
    for k in HEADLINE:
        vals = [m[k]["value"] for _, m in cols]
        best = min(vals) if k in LOWER_IS_BETTER else max(vals)
        print(f"{LABELS[k]:<30}" + "".join(f"{(_fmt(k, v) + ('*' if v == best else '')):<{width}}" for v in vals))
    for k, label in (("disposed", "Disposed"), ("disposed_4y", "Disposed (4+ yrs)"),
                     ("avg_trips_per_advocate", "Trips per advocate")):
        print(f"{label:<30}" + "".join(f"{m['extras'][k]:<{width}.1f}" for _, m in cols))
    print("* best on that metric")
    return 0


def plan_rows(inp, rules, start: date, n_days: int, seed: int, window_minutes: int | None = None) -> list[dict]:
    """The planner the API uses, on a fresh roster: cause lists for the next n working days."""
    cases = build_cases(inp.roster, inp.ref, start, seed)
    state = new_state(cases, inp.calendar, rules, inp.ref, start)
    days = horizon_days(inp.calendar, start, n_days)
    assigned, _ = assign_pool(list(cases.values()), days, state.sched, today=start, seed=seed, horizon_start=start)
    by_day: dict[date, list] = {}
    for x in assigned:
        by_day.setdefault(x.date, []).append(x)
    rows = []
    for d in days:
        items = []
        for x in by_day.get(d, []):
            c = cases[x.case_id]
            m, p = expected_minutes(c, c.next_purpose, d, rules, inp.ref)
            items.append(PackItem(x.case_id, c.next_purpose.value, c.age_years(d), c.advocate_id, False,
                                  x.score, m, inp.ref.duration(c.next_purpose), p))
        packed = pack_day(d, items, rules, window_minutes)
        reasons = {x.case_id: x.reason for x in by_day.get(d, [])}
        for pl in packed.ordered():
            c = cases[pl.key]
            rows.append({
                "Case Number": c.case_number, "Filing Number": c.filing_number,
                "Hearing Type": HearingType(c.next_purpose).value, "Hearing Date": d.isoformat(),
                "window_start": pl.window_start, "window_end": pl.window_end, "est_start": pl.est_start,
                "est_end": pl.est_end, "advocate_id": c.advocate_id, "case_age_years": f"{c.age_years(d):.2f}",
                "reason": reasons.get(pl.key, ""), "status": "DRAFT",
            })
    return rows


def cmd_plan(a) -> int:
    inp = load_inputs(a.roster, a.data_dir, parse_leave(a.leave))
    rules, warnings = _rules(a)
    rows = plan_rows(inp, rules, getattr(a, "from"), a.days, a.seed)
    n = export.write(rows, a.out)
    days = len({r["Hearing Date"] for r in rows})
    print(f"Planned {n} hearings on {days} sitting days from {getattr(a, 'from')} ({rules.name}). Wrote {a.out}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="vihitha", description="Vihitha court scheduling engine")
    p.add_argument("--data-dir", default=None, help="Organisers' data folder (default: VIHITHA_DATA_DIR or bundled)")
    sub = p.add_subparsers(dest="cmd", required=True)

    g = sub.add_parser("generate-roster", help="Bootstrap a bigger roster from the 100-case sample")
    g.add_argument("--n", type=int, default=3000)
    g.add_argument("--seed", type=int, default=42)
    g.add_argument("--base", default=None)
    g.add_argument("--out", default="../data/roster_3000.csv")
    g.set_defaults(fn=cmd_generate)

    def common(sp):
        sp.add_argument("--roster", default=None, help="Roster CSV (default: the 100-case sample)")
        sp.add_argument("--seed", type=int, default=42)
        sp.add_argument("--leave", default=None, help="Judge's leave dates, comma separated")
        sp.add_argument("--preset", default="optimal", choices=["optimal", "sehgal", "dimakar", "joshi", "baseline"])
        sp.add_argument("--rules", default=None, help="Custom RulesBody JSON file (overrides --preset)")
        sp.add_argument("--agents", action=argparse.BooleanOptionalAction, default=None)

    r = sub.add_parser("run", help="Simulate one rule set, print the six metrics, write proposed_schedule.csv")
    common(r)
    r.add_argument("--start", type=_date, default=DEFAULT_START)
    r.add_argument("--end", type=_date, default=DEFAULT_END)
    r.add_argument("--runs", type=int, default=1)
    r.add_argument("--horizon", type=int, default=DEFAULT_HORIZON_WORKING_DAYS)
    r.add_argument("--out", default=None)
    r.add_argument("--no-baseline", action="store_true")
    r.add_argument("--json", action="store_true")
    r.add_argument("--verbose", action="store_true")
    r.set_defaults(fn=cmd_run)

    c = sub.add_parser("compare", help="Compare presets side by side")
    c.add_argument("--roster", default=None)
    c.add_argument("--seed", type=int, default=42)
    c.add_argument("--leave", default=None)
    c.add_argument("--start", type=_date, default=DEFAULT_START)
    c.add_argument("--end", type=_date, default=DEFAULT_END)
    c.add_argument("--runs", type=int, default=1)
    c.add_argument("--horizon", type=int, default=DEFAULT_HORIZON_WORKING_DAYS)
    c.add_argument("--presets", default="baseline,optimal,sehgal,dimakar,joshi")
    c.add_argument("--agents", choices=["off", "on", "both"], default="off")
    c.add_argument("--json", action="store_true")
    c.set_defaults(fn=cmd_compare)

    pl = sub.add_parser("plan", help="Plan the next N working days with the API's planner and write a cause list")
    common(pl)
    pl.add_argument("--from", type=_date, default=DEFAULT_START)
    pl.add_argument("--days", type=int, default=DEFAULT_HORIZON_WORKING_DAYS)
    pl.add_argument("--out", default="cause_list.csv")
    pl.set_defaults(fn=cmd_plan)
    return p


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    a = build_parser().parse_args(argv)
    return a.fn(a)


if __name__ == "__main__":
    sys.exit(main())
