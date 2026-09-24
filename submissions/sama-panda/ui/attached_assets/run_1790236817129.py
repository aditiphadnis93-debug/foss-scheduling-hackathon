#!/usr/bin/env python3
"""Run the scheduler + simulator and write every output the dashboard needs.

    python3 run.py                      # full run: 3,000 cases, all presets, 5 seeds
    python3 run.py --cases 100 --seeds 1 --quick

Judges' rules live in config/*.json — edit those, not the code.
"""
import argparse
import csv
import datetime as dt
import json
import statistics
import sys
import time
from dataclasses import fields, replace
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / "src"))
import engine as E  # noqa: E402

REPO = HERE.parent.parent
DATA = REPO / "data"
OUT = HERE / "output"


def load_policy(path: Path) -> E.Policy:
    cfg = json.loads(path.read_text())
    lv = E.Levers(**cfg.pop("levers", {}))
    cfg = {k: v for k, v in cfg.items() if not k.startswith("_")}
    pol = E.Policy(**cfg, levers=lv)
    if pol.old_case_quota < E.MIN_OLD_CASE_QUOTA and pol.enforce_age_floor:
        print(f"  note: {pol.name} asked for old-case quota {pol.old_case_quota}; floor is {E.MIN_OLD_CASE_QUOTA}")
    return pol


def run_many(pol, types, rows, days, seeds, log_first=False):
    runs, sims = [], []
    for s in seeds:
        sim = E.Simulation(pol, types, rows, days, seed=s, log=log_first and s == seeds[0])
        runs.append(sim.run())
        sims.append(sim)
    agg = {}
    for k, v in runs[0].items():
        if isinstance(v, (int, float)) and not isinstance(v, bool) and v is not None:
            vals = [r[k] for r in runs if r[k] is not None]
            agg[k] = round(statistics.mean(vals), 4)
            agg[k + "_lo"] = round(min(vals), 4)
            agg[k + "_hi"] = round(max(vals), 4)
        else:
            agg[k] = v
    return agg, sims[0]


def write_csv(path, rows):
    if not rows:
        return
    with open(path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cases", type=int, default=3000)
    ap.add_argument("--seeds", type=int, default=5)
    ap.add_argument("--start", default="2026-09-28")
    ap.add_argument("--end", default="2026-12-31")
    ap.add_argument("--leave", default="2026-11-16,2026-11-17", help="judge's personal leave, comma-separated")
    ap.add_argument("--quick", action="store_true", help="skip sweeps")
    ap.add_argument("--part", default="all", choices=["all", "presets", "ablations", "sweeps"],
                    help="run one part and merge into an existing output/results.json")
    a = ap.parse_args()
    t0 = time.time()
    OUT.mkdir(exist_ok=True)

    types = E.load_reference(DATA)
    base = E.read_roster(DATA / "roster_sample_100.csv")
    rows = base if a.cases == len(base) else E.bootstrap_roster(base, a.cases, seed=42)
    write_csv(OUT / f"roster_{a.cases}.csv", rows)
    days = E.load_calendar(DATA, dt.date.fromisoformat(a.start), dt.date.fromisoformat(a.end),
                           [x for x in a.leave.split(",") if x])
    seeds = list(range(1, a.seeds + 1))
    print(f"{len(rows)} cases · {len(days)} sitting days ({days[0]} → {days[-1]}) · seeds {seeds}")

    results = {"meta": dict(cases=len(rows), days=len(days), start=str(days[0]), end=str(days[-1]),
                            seeds=len(seeds), day_minutes=420,
                            generated=dt.datetime.now().isoformat(timespec="minutes"),
                            min_old_case_quota=E.MIN_OLD_CASE_QUOTA),
                            
               "policies": {}, "ablations": {}, "fill_sweep": [], "quota_sweep": [], "daily": {}}
    prev = OUT / "results.json"
    if a.part != "all" and prev.exists():
        old = json.loads(prev.read_text())
        for k in ("policies", "ablations", "fill_sweep", "quota_sweep", "block_sweep", "daily", "causelist_day1", "causelist_week1"):
            if k in old:
                results[k] = old[k]
    do = lambda part: a.part in ("all", part)

    presets = ["baseline", "sehgal", "dimakar", "joshi", "optimised"]
    pols = {n: load_policy(HERE / "config" / f"{n}.json") for n in presets}
    results["meta"]["old_case_quota"] = pols["optimised"].old_case_quota
    results["meta"]["fill_factor"] = pols["optimised"].fill_factor
    results["meta"]["short_block_share"] = pols["optimised"].short_block_share
    for n in (presets if do("presets") else []):
        agg, sim = run_many(pols[n], types, rows, days, seeds, log_first=True)
        results["policies"][n] = agg
        results["daily"][n] = sim.daily
        write_csv(OUT / f"daily_{n}.csv", sim.daily)
        if n in ("optimised", "baseline"):
            write_csv(OUT / f"simulation_log_{n}.csv", sim.rows_log)
        if n == "optimised":
            write_csv(OUT.parent / "proposed_schedule.csv",
                      [{k: v for k, v in r.items() if k not in ("outcome", "bench_minutes")} for r in sim.rows_log])
            first = days[0].isoformat()
            day1 = [r for r in sim.rows_log if r["date"] == first]
            write_csv(OUT / f"causelist_{first}.csv", day1)
            results["causelist_day1"] = day1
            results["causelist_week1"] = [r for r in sim.rows_log if r["date"] <= days[min(4, len(days)-1)].isoformat()]
        print(f"  {n:<10} util {agg['utilisation']:.0%}  reach {agg['reach_rate']:.0%}  "
              f"subst {agg['substantiveness']:.0%}  subst/day {agg['substantive_per_day']:.1f}  "
              f"4+ heard {agg['old_heard_pct']:.0%}  disposed {agg['disposed']:.0f}")

    opt = pols["optimised"]
    ablations = {
        "scheduling_only": ("Algorithm only — no behavioural levers",
                            replace(opt, levers=E.Levers())),
        "no_gate": ("− readiness gate", replace(opt, levers=replace(opt.levers, readiness_gate=False))),
        "fixed_60": ("− expected-minute capacity (fixed 60/day)",
                     replace(opt, capacity_mode="fixed_count", fixed_count=60)),
        "flat_gap": ("− procedural next dates (flat 60 days)", replace(opt, next_date="flat", carryover="flat")),
        "no_summaries": ("− summaries for old files", replace(opt, levers=replace(opt.levers, summaries=False))),
        "no_blocks": ("− day blocks (one greedy list)", replace(opt, slots=False)),
        "no_slots": ("− appointment slots & advocate clustering",
                     replace(opt, levers=replace(opt.levers, appointment_slots=False, advocate_cluster=False))),
        "fifo_priority": ("− value-per-minute priority (FIFO)", replace(opt, priority="fifo")),
    }
    if not a.quick and do("ablations"):
        results["ablations"] = {}
        for k, (label, pol) in ablations.items():
            agg, _ = run_many(replace(pol, name=k, label=label), types, rows, days, seeds)
            results["ablations"][k] = agg
            print(f"  ablation {k:<16} subst/day {agg['substantive_per_day']:.1f}  util {agg['utilisation']:.0%}  reach {agg['reach_rate']:.0%}")
    if not a.quick and do("sweeps"):
        results["fill_sweep"], results["quota_sweep"] = [], []
        for ff in [0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.3, 1.45, 1.6, 1.8, 2.0]:
            agg, _ = run_many(replace(opt, fill_factor=ff, name=f"fill_{ff}"), types, rows, days, seeds)
            results["fill_sweep"].append(dict(fill_factor=ff, **{k: agg[k] for k in (
                "utilisation", "productive_utilisation", "reach_rate", "substantive_per_day",
                "listed_per_day", "predictability_days", "heard_on_first_listing", "not_reached")}))
            print(f"  fill {ff:<4} util {agg['utilisation']:.0%} reach {agg['reach_rate']:.0%} subst/day {agg['substantive_per_day']:.1f}")
        results["block_sweep"] = []
        for sh in [0.2, 0.3, 0.35, 0.45, 0.55, 0.65]:
            agg, _ = run_many(replace(opt, short_block_share=sh, name=f"block_{sh}"), types, rows, days, seeds)
            results["block_sweep"].append(dict(short_share=sh, **{k: agg[k] for k in (
                "substantive_per_day", "disposed", "cases_advanced", "old_heard_pct", "old_pending_end", "reach_rate")}))
            print(f"  block {sh:<4} subst/day {agg['substantive_per_day']:.1f} disposed {agg['disposed']:.0f} advanced {agg['cases_advanced']:.0f} 4+ heard {agg['old_heard_pct']:.0%}")
        for q in [0.25, 0.35, 0.5, 0.65, 0.8]:
            agg, _ = run_many(replace(opt, old_case_quota=q, name=f"quota_{q}"), types, rows, days, seeds)
            results["quota_sweep"].append(dict(quota=q, **{k: agg[k] for k in (
                "substantive_per_day", "old_heard_pct", "old_advanced_pct", "old_pending_end", "disposed", "utilisation")}))
            print(f"  quota {q:<4} subst/day {agg['substantive_per_day']:.1f} 4+ heard {agg['old_heard_pct']:.0%} 4+ pending end {agg['old_pending_end']:.0f}")

    fl = E.flags(rows, types, days[0])
    write_csv(OUT / "docket_flags.csv", fl)
    results["flags_summary"] = dict(total=len(fl),
                                    old=sum("4+ years" in r["flags"] for r in fl),
                                    repeat=sum("hearings at" in r["flags"] for r in fl),
                                    stuck=sum("stuck" in r["flags"] for r in fl))
    results["flags_top"] = fl[:40]
    results["hearing_types"] = {t: dict(minutes=h.minutes, gap_days=h.gap_days, p_sub=h.p_sub,
                                        share=h.reason_share, hazards=h.hazards)
                                for t, h in types.items()}
    (OUT / "results.json").write_text(json.dumps(results, indent=1, default=str))
    print(f"done in {time.time() - t0:.0f}s → {OUT}")


if __name__ == "__main__":
    main()
