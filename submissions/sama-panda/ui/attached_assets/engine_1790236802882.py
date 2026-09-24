"""Scheduling Justice — scheduling engine and court simulator.

Pure standard-library Python (3.9+). One module so it can be vendored into any
stack. Three layers:

  1. DATA      load the organisers' CSVs, normalise hearing types, bootstrap a roster
  2. MODEL     outcome model for one listed hearing, calibrated to the real tables
  3. POLICY    build a day's cause list (the thing we are optimising)
  4. SIMULATE  run a policy over the working days and measure it

The core idea: a judge's minute is the scarce resource. Every candidate hearing
is valued by *expected forward progress per expected minute of bench time*,
cases whose prerequisites are not met are held back before they reach the
list, and the day is filled to the *expected* 420 minutes (not the nominal
listed minutes), because on average half the list will never take bench time.
"""
from __future__ import annotations

import csv
import datetime as dt
import math
import random
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path

# --------------------------------------------------------------------------- #
# 1. DATA
# --------------------------------------------------------------------------- #

MAIN_ORDER = [
    "ADMISSION", "DELAY_CONDONATION_HEARING", "COGNIZANCE", "APPEARANCE", "WARRANT",
    "PLEA", "EXAMINATION_UNDER_S351_BNSS", "EVIDENCE_COMPLAINANT", "EVIDENCE_ACCUSED",
    "ARGUMENTS", "JUDGEMENT",
]
SIDE_TYPES = {"BAIL", "REPORTS", "APPLICATION_REVIEW"}
# Where a case goes after a substantive hearing of this type.
NEXT_STAGE = {
    "ADMISSION": "COGNIZANCE",
    "DELAY_CONDONATION_HEARING": "COGNIZANCE",
    "COGNIZANCE": "APPEARANCE",
    "APPEARANCE": "PLEA",          # accused appeared -> plea
    "WARRANT": "PLEA",             # warrant executed -> plea
    "PLEA": "EXAMINATION_UNDER_S351_BNSS",
    "EXAMINATION_UNDER_S351_BNSS": "EVIDENCE_COMPLAINANT",
    "EVIDENCE_COMPLAINANT": "EVIDENCE_ACCUSED",
    "EVIDENCE_ACCUSED": "ARGUMENTS",
    "ARGUMENTS": "JUDGEMENT",
    "JUDGEMENT": "DISPOSED",
}
# Stages where an old file costs extra bench time to re-read (case study, Sehgal/Dimakar).
MERITS_STAGES = {"EXAMINATION_UNDER_S351_BNSS", "EVIDENCE_COMPLAINANT", "EVIDENCE_ACCUSED",
                 "ARGUMENTS", "JUDGEMENT"}

# Failure reasons in the order a listed hearing "falls over" (sequential hurdles).
REASON_ORDER = ["admin", "prereq", "absence", "not_ready", "adjourn", "other"]
REASON_COLUMNS = {
    "Court Administrative Issue": "admin",
    "Court Holiday / No Sitting": "admin",
    "Awaiting Process / Summons / Warrant Return": "prereq",
    "External Dependency": "prereq",
    "Respondent Absence / Non-Compliance": "absence",
    "Petitioner Absence / Non-Compliance": "absence",
    "Both Parties Unready / Absent": "absence",
    "Evidence / Filing Not Ready": "not_ready",
    "Party Sought Time / Adjournment": "adjourn",
    "Unclear": "other",
}
# Outcomes in which the parties were before the judge ("heard").
HEARD_OUTCOMES = {"substantive", "not_ready", "adjourn", "other"}


def norm_type(s: str) -> str:
    return s.strip().upper().replace(" ", "_").replace("-", "_")


@dataclass
class HearingType:
    name: str
    minutes: float          # estimated bench minutes when substantive
    gap_days: int           # procedural gap to the next hearing after this purpose
    mean_hearings: float
    median_hearings: float
    max_hearings: int
    p_sub: float            # P(substantive | listed), real data
    reason_share: dict      # share of non-substantive mass per reason bucket
    hazards: dict = field(default_factory=dict)  # conditional fail prob per hurdle

    def build_hazards(self):
        """Turn marginal shares into sequential conditional hazards.

        P(fail at r) = (1 - p_sub) * share_r. Hazard h_r = P(fail at r | passed all
        previous hurdles). Modifiers (gating, appointments, summaries...) then scale
        individual hazards, and freed probability mass flows on to later hurdles,
        which is how a real hearing behaves: if the party does turn up, the hearing
        can still fail because evidence is not ready.
        """
        remaining = 1.0
        for r in REASON_ORDER:
            fail = (1 - self.p_sub) * self.reason_share.get(r, 0.0)
            self.hazards[r] = 0.0 if remaining <= 1e-9 else min(1.0, fail / remaining)
            remaining -= fail


def load_reference(data_dir: Path) -> dict:
    types = {}
    with open(data_dir / "hearing_type_reference.csv") as f:
        for row in csv.DictReader(f):
            t = norm_type(row["Hearing Purpose"])
            types[t] = dict(
                minutes=float(row["Time it takes for hearing (mins) - estimated"]),
                gap_days=int(float(row["Time to next hearing given this is the purpose (days)"])),
                mean_hearings=float(row["Mean Hearings per Case"]),
                median_hearings=float(row["Median Hearings per Case"]),
                max_hearings=int(float(row["Max Hearings per Case"])),
            )
    with open(data_dir / "substantiveness_by_hearing_type.csv") as f:
        for row in csv.DictReader(f):
            types[norm_type(row["hearingType"])]["p_sub"] = \
                float(row["Substantive Hearings (percentage probability)"]) / 100
    with open(data_dir / "hearing_failure_reasons.csv") as f:
        for row in csv.DictReader(f):
            t = norm_type(row["hearingType"])
            buckets = Counter()
            for col, b in REASON_COLUMNS.items():
                buckets[b] += float(row.get(col) or 0)
            tot = sum(buckets.values()) or 1.0
            types[t]["reason_share"] = {b: v / tot for b, v in buckets.items()}
    out = {}
    for t, d in types.items():
        ht = HearingType(name=t, **d)
        ht.build_hazards()
        out[t] = ht
    return out


def load_calendar(data_dir: Path, start: dt.date, end: dt.date | None, leave: list[str]) -> list[dt.date]:
    leave_d = {dt.date.fromisoformat(x) for x in leave}
    days = []
    with open(data_dir / "court_calendar.csv") as f:
        for row in csv.DictReader(f):
            d = dt.date.fromisoformat(row["date"])
            if d < start or (end and d > end) or row["is_working_day"] != "Yes" or d in leave_d:
                continue
            days.append(d)
    return days


HEARING_COUNT_COLS = {
    "ADMISSION": "hearings_admission",
    "DELAY_CONDONATION_HEARING": "hearings_delay_condonation_hearing",
    "COGNIZANCE": "hearings_cognizance",
    "APPEARANCE": "hearings_appearance",
    "WARRANT": "hearings_warrant",
    "PLEA": "hearings_plea",
    "EXAMINATION_UNDER_S351_BNSS": "hearings_examination_under_s351_bnss",
    "EVIDENCE_COMPLAINANT": "hearings_evidence_complainant",
    "EVIDENCE_ACCUSED": "hearings_evidence_accused",
    "ARGUMENTS": "hearings_arguments",
    "JUDGEMENT": "hearings_judgement",
    "BAIL": "hearings_bail",
    "REPORTS": "hearings_reports",
    "APPLICATION_REVIEW": "hearings_application_review",
}


def read_roster(path: Path) -> list[dict]:
    with open(path) as f:
        return list(csv.DictReader(f))


def bootstrap_roster(base: list[dict], n: int, seed: int) -> list[dict]:
    """Stdlib port of scripts/generate_roster.py (same method: resample whole
    rows, mint fresh case/filing/party IDs, redraw advocates from a pool sized to
    the sample's cases-per-advocate ratio). Output is 'more of the same mix'."""
    rng = random.Random(seed)
    n_adv = max(1, round(n / (len(base) / len({r["advocate_id"] for r in base}))))
    out = []
    for i in range(n):
        r = dict(rng.choice(base))
        y = r["filing_date"][:4]
        r["case_number"] = f"ST/{i + 1}/{y}"
        r["filing_number"] = f"KL-{i + 1:06d}-{y}"
        r["party_id"] = f"PARTY-{i + 1:05d}"
        r["advocate_id"] = f"ADV-{rng.randint(1, n_adv):03d}"
        out.append(r)
    out.sort(key=lambda r: r["filing_date"])
    return out


# --------------------------------------------------------------------------- #
# Case state
# --------------------------------------------------------------------------- #

@dataclass
class Case:
    case_number: str
    filing_number: str
    filing_date: dt.date
    advocate: str
    party: str
    purpose: str            # purpose of next hearing
    main_stage: str         # stage to return to after a side hearing
    counts: Counter         # hearings already held per type (from roster, then sim)
    eligible: dt.date       # earliest date it may be listed
    last_heard: dt.date | None = None
    carried: int = 0        # consecutive lists where it was not reached
    fails_in_row: int = 0   # consecutive non-substantive outcomes
    disposed_on: dt.date | None = None
    episode_start: dt.date | None = None  # first listing date for the current purpose
    stage_entered: dt.date | None = None
    heard_in_posting: int = 0  # times actually heard since this judge took the roster

    def age_years(self, on: dt.date) -> float:
        return (on - self.filing_date).days / 365.25

    @property
    def stage_idx(self) -> int:
        s = self.main_stage if self.purpose in SIDE_TYPES else self.purpose
        return MAIN_ORDER.index(s) if s in MAIN_ORDER else 0


def build_cases(rows: list[dict], start: dt.date) -> list[Case]:
    cases = []
    for r in rows:
        purpose = norm_type(r["purpose_of_next_hearing"])
        stage = norm_type(r["current_stage"])
        main = purpose if purpose in MAIN_ORDER else (stage if stage in MAIN_ORDER else "APPEARANCE")
        counts = Counter({t: int(float(r.get(c) or 0)) for t, c in HEARING_COUNT_COLS.items()})
        cases.append(Case(
            case_number=r["case_number"], filing_number=r["filing_number"],
            filing_date=dt.date.fromisoformat(r["filing_date"]),
            advocate=r["advocate_id"], party=r["party_id"],
            purpose=purpose, main_stage=main, counts=counts, eligible=start,
            stage_entered=None,
        ))
    return cases


# --------------------------------------------------------------------------- #
# 2. MODEL — what happens to one listed hearing
# --------------------------------------------------------------------------- #

@dataclass
class Advocate:
    """A light behavioural agent. Latent traits drive the simulated world; the
    scheduler never sees them — it learns an estimate from what it observes."""
    aid: str
    absence_mult: float     # latent: >1 = turns up less often than the court average
    prep_mult: float        # latent: >1 = more often unprepared / seeks time
    seen: int = 0           # hearings of theirs the court has called
    absent: int = 0         # ...of which they (or their party) did not appear
    exp_abs: float = 0.0    # absences the court-average hazard would have predicted

    def est_absence_mult(self, prior: float = 1.5) -> float:
        """Gamma-Poisson posterior mean of the no-show multiplier: observed
        absences vs expected, shrunk toward 1.0 with `prior` pseudo-absences."""
        return (self.absent + prior) / (self.exp_abs + prior)


def make_advocates(cases: list[Case], seed: int, spread: float) -> dict[str, Advocate]:
    rng = random.Random(seed * 7919 + 1)
    advs = {}
    for aid in sorted({c.advocate for c in cases}):
        # lognormal with mean 1: exp(N(-s^2/2, s))
        a = math.exp(rng.gauss(-spread ** 2 / 2, spread))
        p = math.exp(rng.gauss(-spread ** 2 / 2, spread))
        advs[aid] = Advocate(aid, a, p)
    return advs


@dataclass
class Levers:
    """Which interventions are switched on. These change the *world* (hazards),
    not just the list; each is an explicit, documented assumption."""
    readiness_gate: bool = False     # staff/portal confirm process served & filings in before listing
    gate_detect: float = 0.8         # share of unready cases the check catches
    gate_notready_cut: float = 0.5   # checklist also cuts 'evidence/filing not ready' hazard
    appointment_slots: bool = False  # parties get a 30-min window instead of all-day wait
    slot_absence_cut: float = 0.2
    advocate_cluster: bool = False   # same advocate's cases in the same slot
    cluster_absence_cut: float = 0.25
    summaries: bool = False          # mandatory 1-page summary for 3+ yr files at merits stages
    summary_prep_cut: float = 0.4
    old_file_time_mult: float = 1.3  # extra bench time to re-read a 4+ yr file with no summary
    duration_sigma: float = 0.45     # lognormal spread of actual hearing length


FAIL_MINUTES = {"admin": 1.0, "prereq": 1.0, "absence": 2.0, "adjourn": 3.0}


def effective_hazards(ht: HearingType, case: Case, on: dt.date, lv: Levers,
                      absence_mult: float, prep_mult: float, clustered: bool) -> dict:
    h = dict(ht.hazards)
    h["absence"] *= absence_mult
    h["not_ready"] *= prep_mult
    h["adjourn"] *= prep_mult
    if lv.appointment_slots:
        h["absence"] *= 1 - lv.slot_absence_cut
    if lv.advocate_cluster and clustered:
        h["absence"] *= 1 - lv.cluster_absence_cut
    if lv.readiness_gate:
        h["not_ready"] *= 1 - lv.gate_notready_cut
    if lv.summaries and case.age_years(on) >= 3 and case.purpose in MERITS_STAGES:
        h["not_ready"] *= 1 - lv.summary_prep_cut
        h["adjourn"] *= 1 - lv.summary_prep_cut
    return {k: min(0.95, v) for k, v in h.items()}


def p_substantive(h: dict) -> float:
    p = 1.0
    for r in REASON_ORDER:
        p *= 1 - h[r]
    return p


def bench_minutes(ht: HearingType, case: Case, on: dt.date, lv: Levers) -> float:
    m = ht.minutes
    if case.purpose in MERITS_STAGES and case.age_years(on) >= 4 and not lv.summaries:
        m *= lv.old_file_time_mult
    return m


def fail_minutes(reason: str, full: float) -> float:
    if reason in FAIL_MINUTES:
        return FAIL_MINUTES[reason]
    return max(3.0, 0.3 * full)   # not_ready / other: hearing starts then stops


def expected_minutes(h: dict, full: float) -> float:
    """E[bench minutes] if listed and reached — what the capacity planner packs."""
    e, alive = 0.0, 1.0
    for r in REASON_ORDER:
        e += alive * h[r] * fail_minutes(r, full)
        alive *= 1 - h[r]
    return e + alive * full


def draw_outcome(rng: random.Random, h: dict, skip: set = frozenset()) -> str:
    for r in REASON_ORDER:
        if r in skip:
            continue
        if rng.random() < h[r]:
            return r
    return "substantive"


# --------------------------------------------------------------------------- #
# 3. POLICY — building the cause list
# --------------------------------------------------------------------------- #

@dataclass
class Policy:
    name: str = "optimised"
    label: str = ""
    # capacity
    capacity_mode: str = "expected_minutes"   # expected_minutes | fixed_count
    fill_factor: float = 1.10                 # target expected minutes / day minutes
    fixed_count: int = 60
    day_minutes: int = 420
    # prioritisation
    priority: str = "value_per_minute"        # value_per_minute | fifo | oldest_first | fresh_first | cluster_purpose
    age_weight: float = 0.15                  # +15% priority per year of age
    stage_weight: float = 0.5                 # up to +50% for cases near judgment
    overdue_weight: float = 1.0               # +100% per 30 days waiting past eligible date (no starvation)
    old_case_quota: float = 0.30              # share of expected minutes reserved for 4+ yr cases
    trip_cost_minutes: float = 5.0            # cost of making parties come to court, in bench-minute equivalents
    # next date
    next_date: str = "purpose"                # purpose | flat
    flat_gap_days: int = 60
    carryover: str = "next_day"               # next_day | next_week | flat
    # day structure
    slots: bool = True
    short_block_share: float = 0.35           # share of the 420 minutes given to the short-matters block
    levers: Levers = field(default_factory=Levers)
    enforce_age_floor: bool = True            # NOT configurable by judges: see MIN_OLD_CASE_QUOTA


# Design principle from the case study: ageing cases must not be deprioritised.
# A judge can raise the old-case quota but not push it below this floor.
MIN_OLD_CASE_QUOTA = 0.25

SLOTS = [  # (label, start judicial minute, length) — lengths only used by fixed-count presets
    ("Block A · short matters", 0, 210),
    ("Block B · merits & old matters", 210, 210),
]


def clock(judicial_minute: float) -> str:
    """Judicial minute (0..420) -> wall clock. 10:00–13:30, lunch, 14:00–17:30."""
    m = judicial_minute if judicial_minute < 210 else judicial_minute + 30
    t = dt.datetime(2000, 1, 1, 10, 0) + dt.timedelta(minutes=m)
    return t.strftime("%H:%M")


def window(judicial_minute: float) -> str:
    """30-minute appointment window a party is told to be present in."""
    m = judicial_minute if judicial_minute < 210 else judicial_minute + 30
    w0 = int(m // 30) * 30
    t = dt.datetime(2000, 1, 1, 10, 0) + dt.timedelta(minutes=w0)
    return f"{t:%H:%M}–{t + dt.timedelta(minutes=30):%H:%M}"


@dataclass
class Listing:
    case: Case
    htype: HearingType
    est_minutes: float
    full_minutes: float
    p_sub: float
    score: float
    slot: int = 0
    window: str = ""
    clustered: bool = False
    carried: bool = False
    pre_fail: str | None = None   # outcome pre-drawn at gate time (prereq failure)


class Scheduler:
    def __init__(self, policy: Policy, types: dict, advocates: dict):
        self.p = policy
        self.types = types
        self.advs = advocates

    # ---- estimates the scheduler is allowed to use (no latent traits) ----
    def estimate(self, c: Case, on: dt.date, clustered: bool = False):
        ht = self.types[c.purpose]
        adv = self.advs[c.advocate]
        h = effective_hazards(ht, c, on, self.p.levers, adv.est_absence_mult(), 1.0, clustered)
        full = bench_minutes(ht, c, on, self.p.levers)
        return ht, h, full

    def score(self, c: Case, on: dt.date, p_sub: float, est_min: float) -> float:
        p = self.p
        age = c.age_years(on)
        overdue = max(0, (on - c.eligible).days)
        if p.priority == "value_per_minute":
            # expected progress per unit of cost; cost = bench minutes + the
            # trip we impose on the parties (so cheap-but-futile listings lose)
            s = p_sub / (est_min + p.trip_cost_minutes)
            s *= 1 + p.age_weight * age
            s *= 1 + p.stage_weight * c.stage_idx / 10
            s *= 1 + p.overdue_weight * overdue / 30
        elif p.priority == "oldest_first":
            s = age + overdue / 365
        elif p.priority == "fresh_first":
            s = -age + overdue / 365
        elif p.priority == "cluster_purpose":
            s = age  # grouping handled in ordering
        else:  # fifo: whoever has waited longest since eligible
            s = overdue + random.Random(hash(c.case_number) & 0xffff).random() * 0.5
        return s

    def build(self, on: dt.date, active: list[Case], rng: random.Random) -> list[Listing]:
        p = self.p
        pool = [c for c in active if c.eligible <= on]
        cands = []
        for c in pool:
            ht, h, full = self.estimate(c, on)
            est = expected_minutes(h, full)
            ps = p_substantive(h)
            cands.append(Listing(c, ht, est, full, ps, self.score(c, on, ps, est), carried=c.carried > 0))

        # Readiness gate: before a case reaches the list, staff confirm the
        # process/report has come back. Caught cases are deferred without
        # costing any bench time or a party trip.
        if p.levers.readiness_gate:
            kept = []
            for L in cands:
                if rng.random() < self.types[L.case.purpose].hazards["prereq"]:
                    if rng.random() < p.levers.gate_detect:
                        L.case.eligible = on + dt.timedelta(days=max(3, L.htype.gap_days // 2))
                        continue
                    L.pre_fail = "prereq"
                else:
                    L.pre_fail = "ok"
                kept.append(L)
            cands = kept

        # carried-over cases first (predictability), then by score
        cands.sort(key=lambda L: (not L.carried, -L.score))
        budget = p.fill_factor * p.day_minutes
        chosen: list[Listing] = []
        if p.capacity_mode == "fixed_count":
            if p.enforce_age_floor:
                chosen = self._with_quota(cands, lambda sel: len(sel) >= p.fixed_count,
                                          lambda L: 1, p.fixed_count, on)
            else:
                chosen = cands[: p.fixed_count]
        elif p.slots:
            # Block the day like Justice Sehgal does: the morning block is packed
            # with short matters, the afternoon block with merits hearings. Without
            # this a pure value-per-minute greedy fills the day with 5-minute
            # matters and evidence/arguments never get listed (we measured it).
            short = [L for L in cands if L.htype.minutes <= 15]
            long_ = [L for L in cands if L.htype.minutes > 15]
            b0 = p.fill_factor * p.day_minutes * p.short_block_share
            b1 = p.fill_factor * p.day_minutes * (1 - p.short_block_share)
            c0 = self._with_quota(short, None, lambda L: L.est_minutes, b0, on)
            u0 = sum(L.est_minutes for L in c0)
            c1 = self._with_quota(long_, None, lambda L: L.est_minutes, b1 + max(0.0, b0 - u0), on)
            u1 = sum(L.est_minutes for L in c1)
            spare = budget - u0 - u1
            if spare > 5:
                rest = [L for L in short if L not in c0]
                c0 += self._with_quota(rest, None, lambda L: L.est_minutes, spare, on)
            for L in c0:
                L.slot = 0
            for L in c1:
                L.slot = 1
            chosen = c0 + c1
            self._slotted = True
        else:
            chosen = self._with_quota(cands, None, lambda L: L.est_minutes, budget, on)
        return self._order(chosen, on)

    def _with_quota(self, cands, _unused, cost, budget, on):
        """Fill `budget` (minutes or count), reserving a share for 4+ yr cases."""
        quota = max(self.p.old_case_quota, MIN_OLD_CASE_QUOTA) if self.p.enforce_age_floor else 0.0
        chosen, used, ids = [], 0.0, set()
        carried = [L for L in cands if L.carried]
        for L in carried:
            if used + cost(L) > budget:
                break
            chosen.append(L); used += cost(L); ids.add(id(L))
        # The reserved share goes to 4+ year cases that have NOT yet been heard in
        # this posting — otherwise the same easy old cases get re-listed and the
        # hard old ones never surface (measured: quota had zero effect).
        old_budget = quota * budget
        old_used = sum(cost(L) for L in chosen if L.case.age_years(on) >= 4 and L.case.heard_in_posting == 0)
        for L in cands:
            if old_used >= old_budget or used >= budget:
                break
            if id(L) in ids or L.case.age_years(on) < 4 or L.case.heard_in_posting > 0:
                continue
            if used + cost(L) > budget:
                continue
            chosen.append(L); used += cost(L); old_used += cost(L); ids.add(id(L))
        for L in cands:
            if used >= budget:
                break
            if id(L) in ids:
                continue
            if used + cost(L) > budget + 1e-9:
                continue
            chosen.append(L); used += cost(L); ids.add(id(L))
        return chosen

    def _order(self, chosen: list[Listing], on: dt.date) -> list[Listing]:
        p = self.p
        adv_count = Counter(L.case.advocate for L in chosen)
        for L in chosen:
            L.clustered = adv_count[L.case.advocate] >= 2
        if not p.slots:
            if p.priority == "fifo":
                return sorted(chosen, key=lambda L: L.case.case_number)
            return chosen
        # Slot 0: short hearings (<= 15 min nominal). Slot 1: merits / long / old.
        slotted = getattr(self, "_slotted", False)
        self._slotted = False
        if not slotted:
            for L in chosen:
                L.slot = 0 if L.htype.minutes <= 15 else 1
        # balance: if a slot overflows its expected minutes, spill the lowest-value items
        cap = [s[2] * p.fill_factor for s in SLOTS]
        for s in ((0, 1) if not slotted else ()):
            items = sorted([L for L in chosen if L.slot == s], key=lambda L: -L.score)
            load = 0.0
            for L in items:
                load += L.est_minutes
                if load > cap[s]:
                    L.slot = 1 - s
        ordered = []
        t_end0 = 0.0
        for s in (0, 1):
            items = [L for L in chosen if L.slot == s]
            if p.priority == "cluster_purpose":
                key = lambda L: (L.htype.name, L.case.advocate, -L.score)
            elif p.levers.advocate_cluster:
                # group an advocate's matters back-to-back; groups ordered by best score
                best = defaultdict(float)
                for L in items:
                    best[L.case.advocate] = max(best[L.case.advocate], L.score)
                key = lambda L: (not L.carried, -best[L.case.advocate], L.case.advocate, -L.score)
            else:
                key = lambda L: (not L.carried, -L.score)
            items.sort(key=key)
            # appointment windows from expected cumulative minutes
            t = 0.0 if s == 0 else max(t_end0, p.short_block_share * p.day_minutes * 0 + t_end0)
            for L in items:
                L.window = window(min(t, p.day_minutes - 1))
                t += L.est_minutes
            if s == 0:
                t_end0 = t
            ordered.extend(items)
        return ordered


# --------------------------------------------------------------------------- #
# 4. SIMULATE
# --------------------------------------------------------------------------- #

class Simulation:
    def __init__(self, policy: Policy, types: dict, rows: list[dict], days: list[dt.date],
                 seed: int, advocate_spread: float = 0.4, log: bool = False):
        self.policy = policy
        self.types = types
        self.days = days
        self.rng = random.Random(seed)
        self.cases = build_cases(rows, days[0])
        # Advocate traits depend on the roster, not the policy, so every policy
        # faces the same people (seeded identically).
        self.advs = make_advocates(self.cases, seed, advocate_spread)
        self.sched = Scheduler(policy, types, self.advs)
        self.log = log
        self.rows_log: list[dict] = []
        self.daily: list[dict] = []
        # baseline shuffle: courts list by previously fixed dates ~ random wrt merit
        order = list(range(len(self.cases)))
        random.Random(seed + 99).shuffle(order)
        for rank, i in enumerate(order):
            self.cases[i].case_number_rank = rank  # type: ignore[attr-defined]
        self.start_old = {c.case_number for c in self.cases if c.age_years(days[0]) >= 4}
        self.heard_ids: set = set()
        self.advanced_ids: set = set()
        self.first_list_to_heard: list[int] = []
        self.heard_first_time = 0
        self.episodes = 0
        self.gaps_assigned: list[int] = []
        self.party_trips = 0
        self.adv_days: set = set()

    # next-date recommender ------------------------------------------------ #
    def next_date(self, c: Case, on: dt.date, ht: HearingType, outcome: str) -> dt.date:
        p = self.policy
        if p.next_date == "flat":
            gap = p.flat_gap_days
        elif outcome == "substantive":
            gap = ht.gap_days
        elif outcome == "absence":
            gap = 7              # fresh notice / advocate to secure presence
        elif outcome in ("admin",):
            gap = 1
        elif outcome == "prereq":
            gap = ht.gap_days    # one full process cycle
        else:                    # adjourn / not_ready / other
            gap = min(ht.gap_days, 14)
        self.gaps_assigned.append(gap)
        return on + dt.timedelta(days=gap)

    def carry_date(self, on: dt.date) -> dt.date:
        p = self.policy
        if p.carryover == "next_week":
            return on + dt.timedelta(days=7)
        if p.carryover == "flat":
            return on + dt.timedelta(days=p.flat_gap_days)
        return on + dt.timedelta(days=1)

    def run(self) -> dict:
        p, lv = self.policy, self.policy.levers
        tot = Counter()
        minutes_reached = minutes_sub = 0.0
        for day_i, on in enumerate(self.days):
            active = [c for c in self.cases if c.disposed_on is None]
            if p.priority == "fifo" and not p.slots:
                active.sort(key=lambda c: c.case_number_rank)  # type: ignore[attr-defined]
            lst = self.sched.build(on, active, self.rng)
            t = 0.0
            day = Counter()
            dmin = dsub = 0.0
            for seq, L in enumerate(lst):
                c, ht = L.case, L.htype
                adv = self.advs[c.advocate]
                if c.episode_start is None:
                    c.episode_start = on
                self.party_trips += 1
                self.adv_days.add((c.advocate, on))
                # true world: latent advocate traits
                h = effective_hazards(ht, c, on, lv, adv.absence_mult, adv.prep_mult, L.clustered)
                full_nominal = bench_minutes(ht, c, on, lv)
                if L.pre_fail == "prereq":
                    outcome = "prereq"
                else:
                    skip = {"prereq"} if L.pre_fail == "ok" else set()
                    outcome = draw_outcome(self.rng, h, skip)
                if outcome == "substantive":
                    dur = full_nominal * math.exp(self.rng.gauss(-lv.duration_sigma ** 2 / 2, lv.duration_sigma))
                    dur = min(dur, 3 * full_nominal)
                else:
                    dur = fail_minutes(outcome, full_nominal)
                reached = t + dur <= p.day_minutes
                if not reached and outcome == "substantive" and t + 1 <= p.day_minutes:
                    # judge calls it, no time left for a full hearing: adjourned for want of time
                    t += 1
                if not reached:
                    day["not_reached"] += 1
                    c.carried += 1
                    c.eligible = self.carry_date(on)
                    self._log(on, seq, L, "not_reached", 0.0)
                    continue
                t += dur
                dmin += dur
                day["reached"] += 1
                day[outcome] += 1
                c.carried = 0
                # learning: the scheduler observes the no-show (Beta update)
                adv.seen += 1
                if outcome not in ("admin", "prereq"):   # reached the attendance hurdle
                    h_ref = effective_hazards(ht, c, on, lv, 1.0, 1.0, L.clustered)
                    adv.exp_abs += h_ref["absence"]
                if outcome == "absence":
                    adv.absent += 1
                if outcome in HEARD_OUTCOMES:
                    day["heard"] += 1
                    self.heard_ids.add(c.case_number)
                    self.episodes += 1
                    self.first_list_to_heard.append((on - c.episode_start).days)
                    if on == c.episode_start:
                        self.heard_first_time += 1
                    c.episode_start = None
                    c.last_heard = on
                    c.heard_in_posting += 1
                c.counts[c.purpose] += 1
                if outcome == "substantive":
                    dsub += dur
                    c.fails_in_row = 0
                    self.advanced_ids.add(c.case_number)
                    nxt = NEXT_STAGE.get(c.purpose) if c.purpose in MAIN_ORDER else c.main_stage
                    old_purpose = c.purpose
                    c.eligible = self.next_date(c, on, ht, outcome)
                    if nxt == "DISPOSED":
                        c.disposed_on = on
                        day["disposed"] += 1
                    else:
                        c.purpose = nxt
                        if nxt in MAIN_ORDER:
                            c.main_stage = nxt
                        if old_purpose != nxt:
                            c.stage_entered = on
                else:
                    c.fails_in_row += 1
                    c.eligible = self.next_date(c, on, ht, outcome)
                self._log(on, seq, L, outcome, dur)
            day["listed"] = len(lst)
            minutes_reached += dmin
            minutes_sub += dsub
            tot.update(day)
            old_pending = sum(1 for c in self.cases if c.disposed_on is None and c.age_years(on) >= 4)
            self.daily.append(dict(
                date=on.isoformat(), listed=len(lst), reached=day["reached"], heard=day["heard"],
                substantive=day["substantive"], disposed=day["disposed"],
                utilisation=round(dmin / p.day_minutes, 4), productive=round(dsub / p.day_minutes, 4),
                old_pending=old_pending,
                pending=sum(1 for c in self.cases if c.disposed_on is None),
            ))
        return self.metrics(tot, minutes_reached, minutes_sub)

    def _log(self, on, seq, L: Listing, outcome, dur):
        if not self.log:
            return
        c = L.case
        self.rows_log.append(dict(
            date=on.isoformat(), seq=seq + 1, slot=SLOTS[L.slot][0] if self.policy.slots else "",
            window=L.window, case_number=c.case_number, filing_number=c.filing_number,
            hearing_type=L.htype.name, advocate_id=c.advocate,
            age_years=round(c.age_years(on), 1), est_minutes=round(L.est_minutes, 1),
            p_substantive=round(L.p_sub, 3), priority_score=round(L.score, 4),
            carried_over=int(L.carried), clustered=int(L.clustered),
            outcome=outcome, bench_minutes=round(dur, 1),
        ))

    def metrics(self, tot: Counter, minutes_reached: float, minutes_sub: float) -> dict:
        p = self.policy
        avail = p.day_minutes * len(self.days)
        listed = tot["listed"] or 1
        reached = tot["reached"] or 1
        end = self.days[-1]
        old_end = sum(1 for c in self.cases if c.disposed_on is None and c.age_years(end) >= 4)
        old_start_n = len(self.start_old) or 1
        pred = self.first_list_to_heard
        return dict(
            policy=p.name, label=p.label or p.name, days=len(self.days), cases=len(self.cases),
            listed=tot["listed"], reached=tot["reached"], heard=tot["heard"],
            substantive=tot["substantive"], disposed=tot["disposed"],
            listed_per_day=round(tot["listed"] / len(self.days), 1),
            utilisation=round(minutes_reached / avail, 4),
            productive_utilisation=round(minutes_sub / avail, 4),
            reach_rate=round(tot["reached"] / listed, 4),
            substantiveness=round(tot["substantive"] / reached, 4),
            substantive_per_listed=round(tot["substantive"] / listed, 4),
            substantive_per_day=round(tot["substantive"] / len(self.days), 2),
            old_heard_pct=round(len(self.heard_ids & self.start_old) / old_start_n, 4),
            old_advanced_pct=round(len(self.advanced_ids & self.start_old) / old_start_n, 4),
            old_pending_start=len(self.start_old), old_pending_end=old_end,
            predictability_days=round(sum(pred) / len(pred), 2) if pred else None,
            heard_on_first_listing=round(self.heard_first_time / max(self.episodes, 1), 4),
            avg_next_gap_days=round(sum(self.gaps_assigned) / max(len(self.gaps_assigned), 1), 1),
            prereq_failures=tot["prereq"], absences=tot["absence"],
            not_reached=tot["not_reached"],
            party_trips_per_substantive=round(self.party_trips / max(tot["substantive"], 1), 2),
            advocate_days=len(self.adv_days),
            bench_min_per_substantive=round(minutes_reached / max(tot["substantive"], 1), 1),
            cases_advanced=len(self.advanced_ids),
        )


def flags(rows: list[dict], types: dict, on: dt.date) -> list[dict]:
    """Docket health flags for the judge: ageing, repeat adjournment, stuck."""
    out = []
    for c in build_cases(rows, on):
        ht = types[c.purpose]
        n = c.counts[c.purpose]
        age = c.age_years(on)
        f = []
        if age >= 4:
            f.append("4+ years old")
        if n >= max(3, 2 * ht.median_hearings):
            f.append(f"{n} hearings at {c.purpose.replace('_', ' ').title()} (median {ht.median_hearings:g})")
        if n >= ht.max_hearings * 0.6 and n >= 5:
            f.append("stuck: near the longest-observed run for this stage")
        if f:
            out.append(dict(case_number=c.case_number, advocate_id=c.advocate, age_years=round(age, 1),
                            purpose=c.purpose, hearings_at_stage=n, flags="; ".join(f)))
    out.sort(key=lambda r: (-len(r["flags"].split(";")), -r["age_years"]))
    return out
