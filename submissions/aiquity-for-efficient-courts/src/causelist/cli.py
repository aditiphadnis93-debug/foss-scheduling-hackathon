"""Command line: run a preset over the roster, print the scorecard, write the causelists.

    python -m causelist.cli --config optimal --compare baseline
"""
from __future__ import annotations

import argparse
import csv
import json
from datetime import date
from pathlib import Path

from .config import load_config
from .metrics import flags, score
from .roster import load_roster
from .simulate import DEFAULT_END, DEFAULT_START, run

OUT = Path(__file__).resolve().parents[2] / "out"


def write_causelist(res, path: Path) -> None:
    kinds = {(o.case_id, o.day): o for d in res.days for o in d.outcomes}
    with open(path, "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["date", "slot", "window_start", "window_end", "case_number", "purpose", "advocate_id",
                    "expected_minutes", "p_goes_ahead", "p_substantive", "why_listed", "simulated_outcome",
                    "reason", "recommended_next_date"])
        h, m = map(int, res.config.day_start.split(":"))
        base = h * 60 + m
        hhmm = lambda x: f"{(base + x) // 60:02d}:{(base + x) % 60:02d}"
        for d in res.days:
            for l in sorted(d.plan.listings, key=lambda l: l.start_min):
                o = kinds.get((l.case_id, l.day))
                w.writerow([l.day, l.slot, hhmm(l.start_min), hhmm(l.end_min), l.case_id, l.purpose, l.advocate_id,
                            l.expected_minutes, l.p_goes_ahead, l.p_substantive, "; ".join(l.why),
                            o.kind if o else "", o.reason if o and o.reason else "", o.next_date if o else ""])


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--config", default="optimal")
    ap.add_argument("--compare", nargs="*", default=["baseline"])
    ap.add_argument("--roster", default=None, help="roster CSV (default: data/roster_sample_100.csv)")
    ap.add_argument("--start", default=DEFAULT_START.isoformat())
    ap.add_argument("--end", default=DEFAULT_END.isoformat())
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()

    roster = load_roster(args.roster)
    OUT.mkdir(exist_ok=True)
    table = {}
    for name in [args.config, *args.compare]:
        cfg = load_config(name)
        res = run(roster, cfg, start=date.fromisoformat(args.start), end=date.fromisoformat(args.end), seed=args.seed)
        table[cfg.name] = score(res)
        write_causelist(res, OUT / f"causelist_{cfg.name}.csv")
        if name == args.config:
            (OUT / f"flags_{cfg.name}.json").write_text(json.dumps(flags(res), indent=2, default=str))
    keys = list(next(iter(table.values())).keys())
    names = list(table)
    print(f"{'metric':32}" + "".join(f"{n:>20}" for n in names))
    for k in keys:
        print(f"{k:32}" + "".join(f"{table[n][k]:>20}" for n in names))
    (OUT / "scorecard.json").write_text(json.dumps(table, indent=2))
    print(f"\nCauselists + scorecard written to {OUT.relative_to(OUT.parents[2])}/")


if __name__ == "__main__":
    main()
