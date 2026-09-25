"""A synthetic roster in the shape of roster_sample_100.csv, from a generative model of case lifecycles.

The organisers' generate_roster.py bootstrap-resamples the 100 rows, so its 3,000 cases have only 100
distinct shapes. Here each case is simulated instead, calibrated on provided/ alone:

- current stage: the sample's stage mix, smoothed so thin stages still appear;
- path: the mainline (reference.NEXT_STAGE), with Delay Condonation and Warrant as branches;
- hearings per stage: a shifted negative binomial per purpose, fitted to hearing_type_reference.csv
  (min, median, mean, max); the current stage is part-way through its own draw;
- filing date: the mainline hearings walked back from `as_of`, each purpose's gap_days × a per-case pace;
- next purpose: the sample's stage × purpose mix, smoothed;
- last summary: a Present/Absent line plus a body in the sample's wording for that stage;
- advocates: a pool sized like the sample's (~2.4 cases each), drawn Zipf-skewed so some are busy.

    python -m planner.synth --num-cases 225 --seed 7 --out data/roster_synthetic.csv

225 is the default because it leaves room on some days: a case comes back every gap_days, so a
60-day forecast of ~300 cases or more fills every day to the 390 planned minutes.
"""
from __future__ import annotations

import argparse
from datetime import date, timedelta
from functools import lru_cache

import numpy as np
import pandas as pd

from .reference import DISPOSED, NEXT_STAGE, PROVIDED_DIR, calendar, code, hearing_types

SAMPLE = PROVIDED_DIR / "data" / "roster_sample_100.csv"
MAINLINE = ("ADMISSION", "DELAY_CONDONATION_HEARING", "COGNIZANCE", "APPEARANCE", "WARRANT", "PLEA",
            "EXAMINATION_UNDER_S351_BNSS", "EVIDENCE_COMPLAINANT", "EVIDENCE_ACCUSED", "ARGUMENTS", "JUDGEMENT")
SIDE = ("BAIL", "REPORTS", "APPLICATION_REVIEW")
BRANCH = {"DELAY_CONDONATION_HEARING": 0.6, "WARRANT": 0.8}  # P(a case passing this point took the branch)
SIDE_RATE = {"BAIL": 0.08, "REPORTS": 0.12, "APPLICATION_REVIEW": 0.06}  # P(side history), cases past Appearance
STAGE_FLOOR = 2.0     # pseudo-count added to every stage's share of the sample
PURPOSE_FLOOR = 0.5   # pseudo-count for every plausible next purpose
PACE = (2.5, 0.35)    # lognormal median and sigma: real gap / reference gap_days
INTAKE_DAYS = (120, 0.5)  # lognormal median and sigma: filing to first hearing
DISPOSAL_RATE = 0.1   # Judgement-stage cases whose summary already records conviction and sentence
EARLIEST = date(2015, 1, 1)
DEFAULT_CASES = 225  # ~60% of the forecast's days full, the rest with an hour or more spare
CASES_PER_ADVOCATE = 2.4
ZIPF = 0.6
ROLES = ("Complainant", "Complainant's Advocate", "Accused", "Accused Advocate")
PRESENT = (0.35, 0.9, 0.35, 0.7)  # P(role present), before the all-absent draw
ALL_ABSENT = 0.15

# Last-hearing wording by the stage that was heard, in the sample's style.
BODY = {
    "ADMISSION": [
        "Complaint filed. Sworn statement of the complainant recorded. For enquiry u/s.225 of BNSS.",
        "Accused filed affidavit u/s.225 of BNSS. No delay in filing the complaint. For hearing on admission.",
        "Complaint presented beyond time; delay condonation petition filed. Issue notice to accused. Take steps.",
        "",
    ],
    "DELAY_CONDONATION_HEARING": [
        "Issue DCA notice to accused. Take steps. For return of notice.",
        "Notice served against accused. For objection and hearing.",
        "Notice is returned as addressee out of India. Hence notice can be deemed to be served. "
        "For objection and hearing.",
        "Objection filed. Heard in part. For further hearing on the delay condonation application.",
    ],
    "COGNIZANCE": [
        "Delay condonation application allowed. Heard. Perused the records. Satisfied that there is sufficient "
        "ground to proceed. Hence the court took cognizance u/s.138 of NI Act and the case is taken on file as ST. "
        "Issue summons to accused. Take steps. For return of summons.",
        "225 affidavit filed. Enquiry conducted u/s.225 of BNSS. Heard. Cognizance taken u/s.138 of NI Act. "
        "Issue summons to accused. Take steps.",
    ],
    "APPEARANCE": [
        "Summons served. For the appearance of the accused.",
        "Summons not served; address incomplete. Take steps. For return of summons.",
        "For the appearance of the parties.",
        "Both complainant and accused present; parties referred for mediation.",
        "Issue NBW to accused. Take steps. For return of warrant.",
        "",
    ],
    "WARRANT": [
        "Await warrant. For return of warrant.",
        "CMP allowed. Issue by hand warrant to accused. Take steps. For return of warrant.",
        "Warrant returned unexecuted. Issue fresh NBW to accused. Take steps.",
        "Accused appeared; warrant recalled. Accused enlarged on bail on executing bond with two sureties.",
        "",
    ],
    "PLEA": [
        "Accused present with sureties. Particulars of the offence u/s.138 of NI Act read over and explained. "
        "Accused pleaded not guilty and claimed trial. Case to proceed as a summons case.",
        "Accused absent; petition u/s.355 of BNSS allowed. For plea.",
    ],
    "EXAMINATION_UNDER_S351_BNSS": [
        "Accused filed application. For objection and hearing.",
        "Accused present. Questioned u/s.351 of BNSS; answers recorded. For defence evidence.",
        "Accused absent. For examination u/s.351 of BNSS, last chance.",
        "",
    ],
    "EVIDENCE_COMPLAINANT": [
        "Complainant present; examined-in-chief by proof affidavit. Exhibits marked. Accused's counsel not ready "
        "for cross-examination; adjourned for cross-examination.",
        "For the evidence of the complainant.",
        "PW1 cross-examined in part. For further cross-examination.",
        "Application taken up for review; other side to file objections.",
        "",
    ],
    "EVIDENCE_ACCUSED": [
        "For defence evidence, last chance.",
        "Witness shall be present.",
        "Accused present. Accused is examined in chief as DW1. Exhibits marked. For further evidence of the accused.",
        "Summons to DW2 not returned. Take steps. For defence evidence.",
    ],
    "ARGUMENTS": [
        "Heard from the side of the complainant. For the hearing of the accused.",
        "Heard. For judgment.",
        "Heard. For further hearing.",
        "Counsel for the accused sought time. For arguments, last chance.",
    ],
    "JUDGEMENT": [
        "Accused shall be present. For judgment.",
        "Produce the order of the Hon'ble District Court, if any.",
        "Judgment pronounced; accused acquitted, benefit of doubt extended.",
        "Application taken up for review; other side to file objections.",
    ],
}
CONVICTED = ("Accused found guilty and convicted u/s.138 of the NI Act. Sentenced to imprisonment till the rising "
             "of the court and directed to pay compensation to the complainant, in default to undergo simple "
             "imprisonment. Sentence suspended for filing appeal.")


def _title(purpose: str) -> str:
    """The roster's own spelling: 'EXAMINATION_UNDER_S351_BNSS' → 'Examination Under S351 Bnss'."""
    return purpose.replace("_", " ").title()


@lru_cache(maxsize=1)
def _sample() -> pd.DataFrame:
    df = pd.read_csv(SAMPLE, parse_dates=["filing_date"])
    df["stage"] = df["current_stage"].map(code)
    df["purpose"] = df["purpose_of_next_hearing"].map(code)
    return df


def columns() -> list[str]:
    return list(pd.read_csv(SAMPLE, nrows=0).columns)


@lru_cache(maxsize=1)
def stage_weights() -> dict[str, float]:
    counts = _sample()["stage"].value_counts()
    w = {s: counts.get(s, 0) + STAGE_FLOOR for s in MAINLINE}
    total = sum(w.values())
    return {s: v / total for s, v in w.items()}


@lru_cache(maxsize=1)
def purpose_weights() -> dict[str, dict[str, float]]:
    """Next purpose given the current stage: stay, move on, or a side type; the sample's counts, smoothed."""
    seen = _sample().groupby(["stage", "purpose"]).size()
    out = {}
    for s in MAINLINE:
        nxt = {NEXT_STAGE.get(s)} - {DISPOSED, None}
        if s == "ADMISSION":
            nxt.add("DELAY_CONDONATION_HEARING")
        if s == "APPEARANCE":
            nxt.add("WARRANT")
        side = {"REPORTS", "APPLICATION_REVIEW"} | ({"BAIL"} if s in ("APPEARANCE", "WARRANT", "PLEA") else set())
        options = {s} | nxt | (side if MAINLINE.index(s) >= MAINLINE.index("APPEARANCE") else set())
        options |= {p for (st, p) in seen.index if st == s}
        w = {p: seen.get((s, p), 0) + PURPOSE_FLOOR for p in sorted(options)}
        total = sum(w.values())
        out[s] = {p: v / total for p, v in w.items()}
    return out


@lru_cache(maxsize=1)
def count_models() -> dict[str, tuple[int, int, float, float]]:
    """(min, max, n, p) per purpose: min + NegBin(n, p), mean matched, dispersion picked to hit the median."""
    rng = np.random.default_rng(0)
    out = {}
    for pur, r in hearing_types().items():
        lo, hi, mu = r.hearings_min, r.hearings_max, max(r.hearings_mean - r.hearings_min, 1e-3)
        best = None
        for n in (0.3, 0.5, 0.8, 1.2, 2.0, 3.5, 6.0, 10.0):
            p = n / (n + mu)
            med = np.median(np.clip(lo + rng.negative_binomial(n, p, 4000), lo, hi))
            err = abs(med - r.hearings_median)
            if best is None or err < best[0]:
                best = (err, n, p)
        out[pur] = (lo, hi, best[1], best[2])
    return out


def _count(rng: np.random.Generator, purpose: str) -> int:
    lo, hi, n, p = count_models()[purpose]
    return int(min(hi, lo + rng.negative_binomial(n, p)))


def _path(rng: np.random.Generator, stage: str) -> list[str]:
    """Mainline stages up to and including `stage`, the branches taken or not."""
    out = []
    for s in MAINLINE[:MAINLINE.index(stage) + 1]:
        if s in BRANCH and s != stage and rng.random() >= BRANCH[s]:
            continue
        out.append(s)
    return out


def _summary(rng: np.random.Generator, stage: str) -> str:
    if rng.random() < ALL_ABSENT:
        present = []
    else:
        present = [r for r, p in zip(ROLES, PRESENT) if rng.random() < p]
    absent = [r for r in ROLES if r not in present]
    lines = ([f"Present: {', '.join(present)}"] if present else []) + ([f"Absent: {', '.join(absent)}"] if absent else [])
    if stage == "JUDGEMENT" and rng.random() < DISPOSAL_RATE:
        body = CONVICTED
    else:
        bank = BODY[stage]
        body = bank[rng.integers(len(bank))]
    return "\n".join(lines + ([body] if body else []))


def _advocates(rng: np.random.Generator, n: int) -> list[str]:
    pool = max(1, round(n / CASES_PER_ADVOCATE))
    w = 1 / np.arange(1, pool + 1) ** ZIPF
    ids = rng.permutation(pool) + 1  # busiest advocate is not always ADV-001
    return [f"ADV-{ids[i]:03d}" for i in rng.choice(pool, size=n, p=w / w.sum())]


def default_as_of() -> date:
    return calendar()[0]["date"]


def generate(n: int = DEFAULT_CASES, seed: int = 7, as_of: date | None = None) -> pd.DataFrame:
    as_of = as_of or default_as_of()
    rng = np.random.default_rng(seed)
    ref = hearing_types()
    stages, sw = zip(*stage_weights().items())
    pw = purpose_weights()
    rows = []
    for _ in range(n):
        stage = stages[rng.choice(len(stages), p=sw)]
        path = _path(rng, stage)
        counts = {p: 0 for p in ref}
        for s in path[:-1]:
            counts[s] = max(1, _count(rng, s))
        full = max(1, _count(rng, stage))
        counts[stage] = int(rng.integers(1, full + 1))  # part-way through the current stage
        if MAINLINE.index(stage) > MAINLINE.index("APPEARANCE"):
            for side, rate in SIDE_RATE.items():
                if rng.random() < rate:
                    counts[side] = max(1, _count(rng, side))
        pace = rng.lognormal(np.log(PACE[0]), PACE[1])
        days = rng.lognormal(np.log(INTAKE_DAYS[0]), INTAKE_DAYS[1])
        # Side matters run alongside the main stages, so only mainline hearings add to the case's age.
        days += pace * sum(counts[p] * ref[p].gap_days for p in path)
        filed = max(EARLIEST, as_of - timedelta(days=int(days)))
        opts, w = zip(*pw[stage].items())
        rows.append({
            "filing_date": filed, "current_stage": _title(stage),
            "last_hearing_summary": _summary(rng, stage),
            "purpose_of_next_hearing": _title(opts[rng.choice(len(opts), p=w)]),
            **{f"hearings_{p.lower()}": c for p, c in counts.items()},
        })
    df = pd.DataFrame(rows).sort_values("filing_date", kind="stable").reset_index(drop=True)
    df["filing_date"] = pd.to_datetime(df["filing_date"])
    years = df["filing_date"].dt.year
    seq = df.groupby(years).cumcount() + 1
    df["case_number"] = [f"ST/{s}/{y}" for s, y in zip(seq, years)]
    df["filing_number"] = [f"KL-{i + 1:06d}-{y}" for i, y in enumerate(years)]
    df["party_id"] = [f"PARTY-{i + 1:05d}" for i in range(n)]
    df["advocate_id"] = _advocates(rng, n)
    cols = columns()
    hearing_cols = [c for c in cols if c.startswith("hearings_")]
    df["total_hearings_held"] = df[hearing_cols].sum(axis=1)
    return df[cols]


def describe(df: pd.DataFrame, as_of: date | None = None) -> str:
    as_of = pd.Timestamp(as_of or default_as_of())
    age = ((as_of - df["filing_date"]).dt.days / 365.25)
    buckets = pd.cut(age, [-1, 1, 3, 4, 5, 99], labels=["<1y", "1-3y", "3-4y", "4-5y", "5y+"]).value_counts(sort=False)
    per_adv = df["advocate_id"].value_counts()
    shapes = df.drop(columns=["case_number", "filing_number", "filing_date", "advocate_id", "party_id",
                              "last_hearing_summary"]).drop_duplicates()
    return "\n".join([
        f"{len(df)} cases, {len(shapes)} distinct (stage, purpose, hearings) shapes",
        "Stage mix: " + ", ".join(f"{k} {v}" for k, v in df["current_stage"].value_counts().items()),
        "Age: " + ", ".join(f"{k} {v}" for k, v in buckets.items()),
        f"Advocates: {len(per_adv)}, cases each median {per_adv.median():g}, max {per_adv.max()}",
        f"Hearings held: median {df['total_hearings_held'].median():g}, max {df['total_hearings_held'].max()}",
    ])


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--num-cases", type=int, default=DEFAULT_CASES)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--as-of", type=date.fromisoformat, default=None, help="default: the calendar's first day")
    ap.add_argument("--out", default="data/roster_synthetic.csv")
    args = ap.parse_args()
    df = generate(args.num_cases, args.seed, args.as_of)
    df.to_csv(args.out, index=False, date_format="%Y-%m-%d")
    print(f"Wrote {args.out}\n{describe(df, args.as_of)}")


if __name__ == "__main__":
    main()
