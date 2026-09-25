"""Synthetic rows for every table in docs/scheduler-schema.sql, consistent across foreign keys.

One courtroom per judge preset (presets/*.yaml). Each courtroom's cases come from the scheduler's
own `generate_roster`, seeded per courtroom. Faker (en_IN) fills in names, contact details and order
text. The app (scheduler/store.py) runs entirely on this dataset; the only future listings here are one
draft "seed" schedule per courtroom, stored exactly as the app saves its own (scheduler/runs.py).

Beyond the FKs, the history is kept internally consistent:
  * hearings fall on the judge's sitting days (weekday, not a holiday, not on leave, and a time block
    that takes that purpose), between registration and yesterday;
  * purposes follow NEXT_PURPOSE; an effective hearing moves the case on (the last one disposes it);
  * outcomes obey was_effective => was_heard => was_reached, and every failed hearing has exactly one
    adjournment whose reason matches the kind of failure;
  * each outcome's next date is the case's next hearing; the case row is derived from its history;
  * parties, advocates and hearings referenced by child rows belong to the same case;
  * causelist items sit inside a time block of that weekday, one list per judge per day.
"""
from __future__ import annotations

import random
import re
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta

import yaml
from faker import Faker

from scheduler.config import PRESETS_DIR, list_presets, load_preset
from scheduler.data import (ADJOURNMENT_REASONS, HEARING_TYPES, INSTITUTIONS, NEXT_PURPOSE, generate_roster,
                            holidays, is_sitting_day)
from scheduler.models import Block, Case, JudgeConfig

TENANT = "hc"
ESTABLISHMENT = "Principal Seat"

# Placeholder causelist sections per purpose (docs/court-domain-model.md §6).
LIST_SECTION = {
    "admission": "admission",
    "mention": "mention",
    "interim_application": "after_notice",
    "evidence": "part_heard",
    "final_arguments": "final_hearing",
}

# Hearing-failure taxonomy (docs/court-domain-model.md §6):
# code -> (failure_kind, attributable_to, preventable_by_scheduler, sampling weight).
# Names and the first weights come from scheduler/data.py ADJOURNMENT_REASONS where present.
REASONS = {
    "not_reached": ("not_heard", "court", True, None),
    "party_absent": ("not_heard", "party", False, None),
    "advocate_absent": ("not_heard", "advocate", False, None),
    "advocate_busy_other_court": ("not_heard", "advocate", False, 5),
    "accommodation_sought": ("not_heard", "advocate", False, None),
    "bench_not_sitting": ("not_heard", "court", True, 0),  # hearings avoid leave days, so never drawn
    "abstention_strike": ("not_heard", "external", False, 2),
    "file_not_traceable": ("not_heard", "court", False, 1),
    "prerequisite_pending": ("heard_not_effective", "state_agency", True, None),
    "pleadings_incomplete": ("heard_not_effective", "party", True, 5),
    "counsel_unprepared": ("heard_not_effective", "advocate", False, 4),
    "facts_resummarised": ("heard_not_effective", "court", False, 2),
    "awaiting_higher_court": ("heard_not_effective", "external", True, 1),
}


def _reason_name(code: str) -> str:
    return ADJOURNMENT_REASONS[code][0] if code in ADJOURNMENT_REASONS else code.replace("_", " ").capitalize()


def _reason_weight(code: str) -> int:
    w = REASONS[code][3]
    return ADJOURNMENT_REASONS[code][1] if w is None else w


CASE_TYPE_ABBR = {"civil": "OP(C)", "criminal": "Crl.A", "writ": "WP(C)", "arbitration": "Arb.P"}
APPLICATION_TYPES = {
    "civil": ["stay", "condonation_of_delay", "amendment", "impleadment", "early_hearing",
              "vacate_stay", "extension_of_time"],
    "criminal": ["bail", "suspension_of_sentence", "condonation_of_delay", "exemption"],
}
URGENT_APPLICATIONS = {"stay", "bail", "suspension_of_sentence"}
DISPOSAL_NATURES = ["allowed", "dismissed", "partly_allowed", "disposed_of", "withdrawn"]
SERVICE_MODES = ["speed_post", "registered_post", "process_server", "email", "hand_delivery"]
STATE_ORGS = {"ORG01", "ORG02", "ORG03"}


def _label(code: str | None) -> str:
    return (code or "").replace("_", " ")


def room_number(cfg: JudgeConfig, fallback: int) -> int:
    digits = re.sub(r"\D", "", cfg.courtroom)
    return int(digits) if digits else fallback


def purpose_chain(current: str) -> list[str]:
    """The purposes a case passed through to reach `current`, following NEXT_PURPOSE from admission."""
    chain, p = ["admission"], "admission"
    while p != current:
        p = NEXT_PURPOSE.get(p)
        if p is None:
            return ["admission", current]
        chain.append(p)
    return chain


@dataclass
class Room:
    """One courtroom: a judge preset with its judge, hall and preset rows."""
    preset: str
    cfg: JudgeConfig
    number: int
    leave: set[date] = field(default_factory=set)

    @property
    def judge_id(self) -> str:
        return f"JDG{self.number:02d}"

    @property
    def hall_id(self) -> str:
        return f"HALL{self.number:02d}"

    @property
    def preset_id(self) -> str:
        return f"PRESET-{self.preset}"

    def blocks_for(self, day: date, purpose: str) -> list[Block]:
        return [b for b in self.cfg.blocks_on(day) if purpose in b.purposes]

    def ok(self, day: date, purpose: str) -> bool:
        return is_sitting_day(day, self.leave) and bool(self.blocks_for(day, purpose))

    def next_ok(self, day: date, purpose: str, before: date) -> date | None:
        while day < before:
            if self.ok(day, purpose):
                return day
            day += timedelta(days=1)
        return None


class Gen:
    def __init__(self, seed: int, today: date, cases_per_judge: int, horizon_days: int,
                 presets: list[str] | None = None):
        self.seed, self.today = seed, today
        self.cases_per_judge, self.horizon_days = cases_per_judge, horizon_days
        self.presets = presets or list_presets()
        self.rng = random.Random(f"datagen-{seed}")
        self.fake = Faker("en_IN")
        self.fake.seed_instance(seed)
        self.rows: dict[str, list[dict]] = defaultdict(list)
        self._seq: dict[str, int] = defaultdict(int)
        self._litigant_names: dict[str, str] = {}

    def id(self, prefix: str) -> str:
        self._seq[prefix] += 1
        return f"{prefix}{self._seq[prefix]:07d}"

    def add(self, table: str, **row) -> dict:
        self.rows[table].append(row)
        return row

    # ------------------------------------------------------------------ reference and people

    def reference(self) -> None:
        for code, h in HEARING_TYPES.items():
            self.add("hearing_type", code=code, name=_label(code).capitalize(), priority=h.priority,
                     est_minutes=h.est_minutes, p_heard=h.p_heard, p_effective=h.p_effective,
                     ideal_gap_days=h.ideal_gap_days, min_gap_days=h.min_gap_days,
                     next_purpose_code=NEXT_PURPOSE.get(code), list_section=LIST_SECTION.get(code),
                     additional_details={"source": "scheduler/data.py HEARING_TYPES (placeholder)"})
        for code, (kind, to, preventable, _) in REASONS.items():
            self.add("adjournment_reason", code=code, name=_reason_name(code), failure_kind=kind,
                     attributable_to=to, preventable_by_scheduler=preventable)
        years = range(self.today.year - 13, self.today.year + 2)
        for y in years:
            for d in sorted(holidays(y)):
                self.add("court_calendar", id=f"CAL-{d:%Y%m%d}", tenant_id=TENANT, day=d, day_type="holiday",
                         description="Court holiday (placeholder)")

    def advocates(self, n: int = 300) -> None:
        # IDs match generate_roster's pool (ADV000..), which already follows a long tail.
        for i in range(n):
            senior = self.rng.random() < 0.06
            enrolled = self.rng.randint(1985, 2022)
            self.add("advocate", id=f"ADV{i:03d}", tenant_id=TENANT, name=self.fake.name(),
                     bar_registration_number=f"K/{self.rng.randint(1, 3999)}/{enrolled}",
                     designation="senior_advocate" if senior else "advocate",
                     mobile_number=self.fake.phone_number(), email=self.fake.email(),
                     additional_details={"enrolled": enrolled})

    def room(self, preset: str, fallback: int) -> Room:
        cfg = load_preset(preset)
        raw = yaml.safe_load((PRESETS_DIR / f"{preset}.yaml").read_text())  # as the judge asked, before clamping
        room = Room(preset, cfg, room_number(cfg, fallback))
        rng = self.rng
        self.add("judge", id=room.judge_id, tenant_id=TENANT, name=cfg.name.split(" (")[0],
                 designation="judge", additional_details={"preset": preset, "style": cfg.name})
        self.add("court_hall", id=room.hall_id, tenant_id=TENANT, establishment=ESTABLISHMENT,
                 hall_number=cfg.courtroom, vc_enabled=rng.random() < 0.7)
        self.add("scheduling_preset", id=room.preset_id, judge_id=room.judge_id, court_hall_id=room.hall_id,
                 name=cfg.name, max_cases_per_day=cfg.max_cases_per_day,
                 listing_factor=float(raw.get("listing_factor", 1.0)),
                 clustering=cfg.clustering, rollover=cfg.rollover,
                 case_type_codes=list(cfg.case_types) if cfg.case_types else None, weights=raw.get("weights") or {},
                 requires_cover_page_for=list(cfg.cover_page_for), source_yaml=f"presets/{preset}.yaml",
                 additional_details={"style": cfg.style} if cfg.style else None)
        for k, b in enumerate(cfg.blocks, 1):
            self.add("time_block", id=f"{room.preset_id}-B{k}", preset_id=room.preset_id, name=b.name,
                     start_time=b.start, end_time=b.end, purpose_codes=list(b.purposes),
                     weekdays=list(b.weekdays), sort_by=b.sort_by)
        # Leave: the preset's own days, plus a few synthetic spells in the past year and one ahead.
        spells = [(d, d) for d in cfg.leave]
        for _ in range(3):
            start = self.today - timedelta(days=rng.randint(20, 360))
            spells.append((start, start + timedelta(days=rng.randint(0, 4))))
        start = self.today + timedelta(days=rng.randint(15, 60))
        spells.append((start, start + timedelta(days=rng.randint(0, 2))))
        for lo, hi in sorted(spells):
            self.add("judge_leave", id=self.id("LV"), judge_id=room.judge_id, from_date=lo, to_date=hi,
                     session="full_day", additional_details={"synthetic": True})
            room.leave.update(lo + timedelta(days=i) for i in range((hi - lo).days + 1))
        return room

    def _person(self, pid: str) -> str:
        if pid.startswith("LIT"):  # frequent litigants keep one name across cases
            return self._litigant_names.setdefault(pid, self.fake.name())
        return self.fake.name()

    def parties(self, case_id: str, c: Case, nature: str) -> list[dict]:
        rng, out = self.rng, []
        for k, pid in enumerate(c.parties):
            pet = k == 0
            org = pid in INSTITUTIONS
            ptype = ("appellant" if nature == "criminal" else "petitioner") if pet else "respondent"
            out.append(self.add(
                "party", id=self.id("PTY"), case_id=case_id,
                party_category="organisation" if org else "individual", party_type=ptype,
                party_number="P1" if pet else f"R{k}", name=INSTITUTIONS[pid] if org else self._person(pid),
                person_key=pid,
                is_party_in_person=k >= 2 and not org and rng.random() < 0.1,  # R1 may get counsel
                is_state=pid in STATE_ORGS,
                mobile_number=None if org else self.fake.phone_number(),
                email=self.fake.company_email() if org else self.fake.email(),
                is_active=True))
        return out

    # ------------------------------------------------------------------ one case and its history

    def case(self, room: Room, c: Case, seq: int) -> dict:
        rng, today = self.rng, self.today
        nature = "criminal" if c.case_type == "criminal" else "civil"
        case_id = c.id
        parties = self.parties(case_id, c, nature)
        pet, resps = parties[0], parties[1:]

        advs = list(c.advocate_ids)
        mappings = [self.add("advocate_mapping", id=self.id("AM"), case_id=case_id, advocate_id=advs[0],
                             party_id=pet["id"], advocate_type="primary", is_active=True)]
        if len(advs) > 1:
            mappings.append(self.add("advocate_mapping", id=self.id("AM"), case_id=case_id, advocate_id=advs[1],
                                     party_id=resps[0]["id"], advocate_type="primary", is_active=True))
        elif rng.random() < 0.6:
            mappings.append(self.add("advocate_mapping", id=self.id("AM"), case_id=case_id,
                                     advocate_id=f"ADV{rng.randint(0, 299):03d}", party_id=resps[0]["id"],
                                     advocate_type="primary", is_active=True))
        if rng.random() < 0.05:
            mappings.append(self.add("advocate_mapping", id=self.id("AM"), case_id=case_id,
                                     advocate_id=f"ADV{rng.randint(0, 29):03d}", party_id=pet["id"],
                                     advocate_type="senior_briefed", is_active=True))

        registration = min(c.filing_date + timedelta(days=rng.randint(1, 20)), today - timedelta(days=1))
        chain = purpose_chain(c.purpose)
        disposed = c.purpose == "final_arguments" and c.last_heard is not None and rng.random() < 0.35
        stalled = not c.prerequisites_met and not disposed and c.last_heard is not None

        # Outcome sequence: `moves` effective hearings, the rest failed; then dates for each.
        flags: list[bool] = []
        if c.last_heard is not None:
            moves = len(chain) - 1 + disposed
            flags = [True] * moves + [False] * max(c.adjournment_count, int(stalled))
            rng.shuffle(flags)
            if flags and disposed and not flags[-1]:
                i = max(i for i, f in enumerate(flags) if f)
                flags[i], flags[-1] = flags[-1], flags[i]
            if flags and stalled and flags[-1]:
                i = max(i for i, f in enumerate(flags) if not f)
                flags[i], flags[-1] = flags[-1], flags[i]

        hearings: list[dict] = []
        step, prev = 0, registration
        if flags:
            first = min(registration + timedelta(days=rng.randint(20, 60)), c.last_heard)
            span = max(0, (c.last_heard - first).days)
            targets = sorted(first + timedelta(days=rng.randint(0, span)) for _ in flags[:-1]) + [c.last_heard]
            n_failed = 0
            for i, (effective, target) in enumerate(zip(flags, targets)):
                purpose = chain[min(step, len(chain) - 1)]
                day = room.next_ok(max(target, prev + timedelta(days=1)), purpose, before=today)
                if day is None:
                    break
                last = i == len(flags) - 1
                if effective:
                    reason, kind = None, "effective"
                else:
                    reason = "prerequisite_pending" if stalled and last else rng.choices(
                        list(REASONS), [_reason_weight(r) for r in REASONS])[0]
                    kind = REASONS[reason][0]
                    n_failed += 1
                hearings.append({"day": day, "purpose": purpose, "effective": effective, "reason": reason,
                                 "kind": kind, "n_failed": n_failed, "stage_before": purpose,
                                 "stage_after": purpose})
                if effective:
                    step += 1
                    hearings[-1]["stage_after"] = chain[step] if step < len(chain) else "disposed"
                prev = day

        is_disposed = bool(hearings) and hearings[-1]["stage_after"] == "disposed"
        next_purpose = None if is_disposed else chain[min(step, len(chain) - 1)]
        stalled = stalled and bool(hearings) and hearings[-1]["reason"] == "prerequisite_pending"
        on_hold = not is_disposed and bool(hearings) and rng.random() < 0.02
        if is_disposed:
            status = "disposed"
        elif on_hold:
            status = "stayed"
        elif not hearings and (today - c.filing_date).days < 30:
            status = "registered"
        else:
            status = "pending"

        type_key = f"num-{c.case_type}-{registration.year}"
        self._seq[type_key] += 1
        type_seq = self._seq[type_key]
        resp_name = resps[0]["name"] + (" & Ors." if len(resps) > 1 else "")
        heard = [h for h in hearings if h["kind"] != "not_heard"]
        row = self.add(
            "court_case", id=case_id, tenant_id=TENANT,
            filing_number=f"F-{c.filing_date.year}-{seq:06d}", filing_date=c.filing_date,
            registration_date=registration, cnr_number=f"HCKL01{seq:06d}{c.filing_date.year}",
            court_case_number=f"{CASE_TYPE_ABBR.get(c.case_type, c.case_type.upper())} {type_seq}/{registration.year}",
            case_title=f"{pet['name']} v. {resp_name}", case_type_code=c.case_type, nature=nature,
            stage_code=hearings[-1]["stage_after"] if hearings else chain[0], sub_stage_code=None,
            status=status,
            disposal_nature_code=rng.choice(DISPOSAL_NATURES) if is_disposed else None,
            disposal_date=hearings[-1]["day"] if is_disposed else None,
            judge_id=room.judge_id, bench_id=None,
            is_part_heard=next_purpose in ("evidence", "final_arguments") and rng.random() < 0.15,
            is_urgent=c.urgent, is_senior_citizen=rng.random() < 0.05,
            is_in_custody=nature == "criminal" and rng.random() < 0.3, is_legal_aid=rng.random() < 0.05,
            is_on_hold=on_hold,
            next_hearing_date=None,  # set by schedule_future()
            next_purpose_code=next_purpose,
            last_listed_date=hearings[-1]["day"] if hearings else None,
            last_heard_date=heard[-1]["day"] if heard else None,
            adjournment_count=sum(not h["effective"] for h in hearings),
            consecutive_skips=0 if is_disposed else rng.choice([0, 0, 0, 1, 2]),
            additional_details={"synthetic": True, "prerequisites_met": not stalled},
        )
        row["_room"], row["_hearings"], row["_parties"], row["_mappings"] = room, hearings, parties, mappings
        row["_chain"] = chain
        return row

    # ------------------------------------------------------------------ future listings

    def schedule_future(self, room: Room, cases: list[dict]) -> tuple[list[date], dict[date, list[dict]]]:
        """Next hearing dates. Some fall in the horizon (listed by the L1 run), the rest later."""
        rng, today = self.rng, self.today
        horizon: list[date] = []
        d = today
        while len(horizon) < self.horizon_days:
            if is_sitting_day(d, room.leave):
                horizon.append(d)
            d += timedelta(days=1)
        # Same capacity model as the scheduler: expected minutes (duration x p_heard) within block budgets.
        budget = {d: sum(b.minutes * room.cfg.listing_factor for b in room.cfg.blocks_on(d)) for d in horizon}
        count = {d: 0 for d in horizon}
        listed: dict[date, list[dict]] = defaultdict(list)
        beyond = horizon[-1] + timedelta(days=1)
        for row in cases:
            p = row["next_purpose_code"]
            if p is None or row["is_on_hold"]:
                continue
            last = row["last_listed_date"]
            earliest = last + timedelta(days=HEARING_TYPES[p].min_gap_days) if last else today
            cost = HEARING_TYPES[p].est_minutes * HEARING_TYPES[p].p_heard
            options = [d for d in horizon if d >= earliest and count[d] < room.cfg.max_cases_per_day
                       and budget[d] >= cost and room.ok(d, p)]
            if options and rng.random() < 0.5:
                day = rng.choice(options)
                count[day] += 1
                budget[day] -= cost
                listed[day].append(row)
            else:
                start = max(beyond, earliest) + timedelta(days=rng.randint(0, 120))
                day = room.next_ok(start, p, before=start + timedelta(days=60))
            row["next_hearing_date"] = day
        return horizon, listed

    # ------------------------------------------------------------------ hearings, lists, outcomes

    def materialise(self, room: Room, cases: list[dict], horizon: list[date],
                    listed: dict[date, list[dict]], runs: dict[str, str]) -> None:
        hall = next(h for h in self.rows["court_hall"] if h["id"] == room.hall_id)
        by_day: dict[date, list[tuple[dict, dict]]] = defaultdict(list)  # day -> (case row, hearing row)

        for row in cases:
            hs = row["_hearings"]
            for i, h in enumerate(hs):
                status = "closed" if h["effective"] else "adjourned"
                hr = self.add("hearing", id=self.id("HRG"), case_id=row["id"], causelist_item_id=None,
                              hearing_type_code=h["purpose"], status=status, judge_id=room.judge_id,
                              court_hall_id=room.hall_id, hearing_date=h["day"], start_time=None, end_time=None,
                              mode=self._mode(hall), notes=None)
                h["row"] = hr
                by_day[h["day"]].append((row, hr))
        for day, rows in listed.items():  # the seed schedule is a draft: listings only, no hearing rows yet
            for row in rows:
                by_day[day].append((row, {"hearing_type_code": row["next_purpose_code"]}))

        for day in sorted(by_day):
            self._causelist(room, day, by_day[day], day >= self.today, runs)

        for row in cases:
            self._outcomes(room, row)

    def _mode(self, hall: dict) -> str:
        r = self.rng.random()
        if hall["vc_enabled"] and r < 0.12:
            return "virtual"
        return "hybrid" if hall["vc_enabled"] and r < 0.18 else "physical"

    def _reasons(self, row: dict, purpose: str) -> list[str]:
        age = (self.today - row["filing_date"]).days / 365.25
        out = [f"age {age:.1f}y", f"purpose {_label(purpose)} (priority {HEARING_TYPES[purpose].priority})"]
        if row["is_urgent"]:
            out.append("urgent")
        if row["adjournment_count"]:
            out.append(f"{row['adjournment_count']} adjournments so far")
        if age >= 4:
            out.append("ageing quota (4y+)")
        return out

    def _causelist(self, room: Room, day: date, entries: list[tuple[dict, dict]], future: bool,
                   runs: dict[str, str]) -> None:
        rng = self.rng
        cl = self.add(
            "causelist", id=f"CL-{room.number:02d}-{day:%Y%m%d}", tenant_id=TENANT, judge_id=room.judge_id,
            bench_id=None, court_hall_id=room.hall_id, list_date=day, list_type="daily",
            scheduling_run_id=runs["l1"] if future else None,
            status="draft" if future else "published",
            published_at=None if future else datetime.combine(day - timedelta(days=1), time(17, 30)),
            additional_details={"excluded": {}} if future else {"source": "registry (status quo)"})
        blocks = room.cfg.blocks_on(day)
        placed = []
        for row, hr in entries:
            block = rng.choice(room.blocks_for(day, hr["hearing_type_code"]))
            placed.append((blocks.index(block), -HEARING_TYPES[hr["hearing_type_code"]].priority,
                           row["filing_date"], row["id"], block, row, hr))
        placed.sort(key=lambda t: t[:4])
        per_block: dict[str, list] = defaultdict(list)
        for p in placed:
            per_block[p[4].name].append(p)
        serial = 0
        for p in placed:
            _, _, _, _, block, row, hr = p
            serial += 1
            peers = per_block[block.name]
            slot = block.minutes / len(peers)
            k = peers.index(p)
            est = HEARING_TYPES[hr["hearing_type_code"]].est_minutes
            b_start = datetime.combine(day, block.start)
            b_end = datetime.combine(day, block.end)
            w_start = b_start + timedelta(minutes=round(k * slot))
            w_end = min(w_start + timedelta(minutes=max(est, round(slot))), b_end)
            score = round(rng.uniform(40, 100), 2) if future else None
            item = self.add(
                "causelist_item", id=self.id("CLI"), causelist_id=cl["id"], case_id=row["id"],
                serial_number=serial, list_section=LIST_SECTION.get(hr["hearing_type_code"]),
                purpose_code=hr["hearing_type_code"],
                tag_group=row["_mappings"][0]["advocate_id"] if room.cfg.clustering else None,
                time_block=block.name, window_start=w_start, window_end=w_end, expected_minutes=round(est * HEARING_TYPES[hr["hearing_type_code"]].p_heard, 1),
                score=score,
                reasons=self._reasons(row, hr["hearing_type_code"]) if future else ["registry listing (status quo)"],
                was_booked=True if future else rng.random() < 0.5)
            hr["causelist_item_id"] = item["id"]
            hr["_window"] = (w_start, w_end)
            if future:
                self.add("listing_decision", id=self.id("LD"), run_id=runs["l1"], case_id=row["id"],
                         list_date=day, decision="forced" if row["consecutive_skips"] >= 3 else "listed",
                         time_block=block.name, score=score,
                         score_components={"age": round(score * 0.5, 2), "purpose": round(score * 0.3, 2),
                                           "overdue": round(score * 0.2, 2)},
                         exclusion_reason=None, reasons=item["reasons"], causelist_item_id=item["id"])

    def _outcomes(self, room: Room, row: dict) -> None:
        rng = self.rng
        hs = row["_hearings"]
        parties, mappings = row["_parties"], row["_mappings"]
        advocates = [m["advocate_id"] for m in mappings]
        stage_rows = [self.add("case_stage_history", id=self.id("CSH"), case_id=row["id"], from_stage_code=None,
                               to_stage_code=row["_chain"][0], changed_on=row["registration_date"], hearing_id=None)]
        orders: list[tuple[dict, dict]] = []  # (hearing, order)
        for i, h in enumerate(hs):
            hr = h["row"]
            ht = HEARING_TYPES[h["purpose"]]
            reached = h["reason"] not in ("not_reached", "bench_not_sitting")
            heard = h["kind"] in ("effective", "heard_not_effective")
            nxt = hs[i + 1] if i + 1 < len(hs) else None
            w_start, w_end = hr["_window"]
            minutes = None
            if heard:
                minutes = round(ht.est_minutes * rng.uniform(0.5, 1.8), 1)
            elif reached:
                minutes = round(rng.uniform(0.5, 3), 1)
            if reached:
                start = w_start + timedelta(minutes=rng.randint(-10, 40))
                hr["start_time"], hr["end_time"] = start, start + timedelta(minutes=minutes)
            if nxt:
                next_day, next_purpose = nxt["day"], nxt["purpose"]
            else:
                next_day, next_purpose = row["next_hearing_date"], row["next_purpose_code"]
            source = "not_fixed" if next_day is None else (
                "rollover" if room.cfg.rollover and not h["effective"] and rng.random() < 0.5
                else rng.choices(["judge", "default", "scheduler"], [5, 3, 2])[0])
            self.add("hearing_outcome", hearing_id=hr["id"], was_reached=reached, was_heard=heard,
                     was_effective=h["effective"], actual_minutes=minutes,
                     within_window=(w_start <= hr["start_time"] <= w_end) if reached else None,
                     stage_before_code=h["stage_before"], stage_after_code=h["stage_after"],
                     next_hearing_date=next_day, next_purpose_code=next_purpose, next_date_source=source)
            if h["effective"]:
                stage_rows.append(self.add("case_stage_history", id=self.id("CSH"), case_id=row["id"],
                                           from_stage_code=h["stage_before"], to_stage_code=h["stage_after"],
                                           changed_on=h["day"], hearing_id=hr["id"]))
            else:
                _, to, _, _ = REASONS[h["reason"]]
                self.add("adjournment", id=self.id("ADJ"), hearing_id=hr["id"], reason_code=h["reason"],
                         sought_by_party_id=rng.choice(parties)["id"] if to == "party" else None,
                         sought_by_advocate_id=rng.choice(advocates) if to == "advocate" and advocates else None,
                         is_last_opportunity=h["n_failed"] >= 5 and rng.random() < 0.3,
                         remarks=None if rng.random() < 0.7 else self.fake.sentence(nb_words=8))
            if reached:
                orders.append((h, self._order(row, h, nxt)))
        self._applications(row, orders)
        self._tasks(row, orders)

    def _order(self, row: dict, h: dict, nxt: dict | None, application: dict | None = None,
               order_type: str | None = None, summary: str | None = None) -> dict:
        after = h["stage_after"]
        if order_type is None:
            if not h["effective"]:
                order_type = "adjournment"
                summary = f"Adjourned: {_reason_name(h['reason']).lower()}."
                if nxt or row["next_hearing_date"]:
                    summary += f" List on {(nxt['day'] if nxt else row['next_hearing_date']):%d %b %Y}."
            elif after == "disposed":
                order_type = "judgment"
                summary = f"Judgment pronounced; {_label(row['disposal_nature_code'])}."
            elif h["purpose"] == "admission":
                order_type = "notice"
                summary = "Admitted. Notice to respondents; counter in 4 weeks."
            elif h["purpose"] == "interim_application" and self.rng.random() < 0.4:
                order_type = "interim_stay"
                summary = "Interim stay granted until further orders."
            else:
                order_type = "directions"
                summary = f"{_label(h['purpose']).capitalize()} completed; list for {_label(after)}."
        oid = self.id("ORD")
        return self.add("court_order", id=oid, case_id=row["id"], order_number=f"{oid[3:].lstrip('0')}/{h['day'].year}",
                        hearing_id=h["row"]["id"], application_id=application["id"] if application else None,
                        order_type_code=order_type, order_date=h["day"], summary=summary,
                        order_text=self.fake.paragraph(nb_sentences=4),
                        document_uri=f"filestore://orders/{oid}.pdf")

    def _applications(self, row: dict, orders: list[tuple[dict, dict]]) -> None:
        rng, today = self.rng, self.today
        heard = [h for h, _ in orders if h["kind"] != "not_heard"]
        for _ in range(rng.choices([0, 1, 2, 3], [5, 3, 1, 1])[0]):
            atype = rng.choice(APPLICATION_TYPES[row["nature"]])
            span = max(1, (today - row["registration_date"]).days)
            created = row["registration_date"] + timedelta(days=rng.randint(0, span - 1))
            later = [h for h in heard if h["day"] >= created]
            app = self.add("application", id=self.id("IA"), case_id=row["id"],
                           application_number=f"IA {self._seq['IA']}/{created.year}", application_type_code=atype,
                           created_date=created, filed_by_party_id=rng.choice(row["_parties"][:2])["id"],
                           status="pending", decided_on=None,
                           is_urgent=atype in URGENT_APPLICATIONS and rng.random() < 0.6)
            if later and rng.random() < 0.7:
                h = rng.choice(later)
                app["status"] = rng.choices(["allowed", "dismissed", "withdrawn", "closed"], [5, 3, 1, 1])[0]
                app["decided_on"] = h["day"]
                self._order(row, h, None, application=app,
                            order_type="interim_stay" if atype == "stay" and app["status"] == "allowed" else "directions",
                            summary=f"IA ({_label(atype)}) {app['status']}.")

    def _tasks(self, row: dict, orders: list[tuple[dict, dict]]) -> None:
        rng, yesterday = self.rng, self.today - timedelta(days=1)
        resps = [p for p in row["_parties"] if p["party_type"] == "respondent"]
        advocates = [m["advocate_id"] for m in row["_mappings"]]

        def closed(created: date, status: str) -> tuple[str, date]:
            return status, min(created + timedelta(days=rng.randint(5, 40)), yesterday)

        for h, order in orders:
            if order["order_type_code"] == "notice":
                for p in resps:
                    status, served = closed(h["day"], "served")
                    self.add("task", id=self.id("TSK"), case_id=row["id"], order_id=order["id"], task_type="notice",
                             task_description=f"Notice to {p['party_number']} ({p['name']})",
                             addressee_party_id=p["id"], responsible_advocate_id=None,
                             service_mode=rng.choice(SERVICE_MODES), created_date=h["day"],
                             due_date=h["day"] + timedelta(days=28), service_status=status, served_on=served,
                             blocks_hearing_type=h["stage_after"] if h["stage_after"] in HEARING_TYPES else None)
            elif order["order_type_code"] == "directions" and advocates and rng.random() < 0.5:
                status, served = closed(h["day"], "complied")
                what = rng.choice(["counter affidavit", "rejoinder", "written submissions", "records"])
                self.add("task", id=self.id("TSK"), case_id=row["id"], order_id=order["id"],
                         task_type="document.submission", task_description=f"File {what}",
                         addressee_party_id=None, responsible_advocate_id=rng.choice(advocates),
                         service_mode=None, created_date=h["day"], due_date=h["day"] + timedelta(days=28),
                         service_status=status, served_on=served,
                         blocks_hearing_type=h["stage_after"] if h["stage_after"] in HEARING_TYPES else None)
        # The prerequisite that stalled the last hearing is still open.
        if orders and orders[-1][0]["reason"] == "prerequisite_pending" and resps:
            h, order = orders[-1]
            p = rng.choice(resps)
            ttype = "summons" if row["nature"] == "criminal" else "notice"
            self.add("task", id=self.id("TSK"), case_id=row["id"], order_id=order["id"], task_type=ttype,
                     task_description=f"Fresh {ttype} to {p['party_number']} ({p['name']})",
                     addressee_party_id=p["id"], responsible_advocate_id=None,
                     service_mode=rng.choice(SERVICE_MODES), created_date=h["day"],
                     due_date=h["day"] + timedelta(days=21),
                     service_status=rng.choice(["pending", "dispatched", "unserved", "returned"]), served_on=None,
                     blocks_hearing_type=row["next_purpose_code"])

    # ------------------------------------------------------------------ runs and unlisted decisions

    def runs(self, room: Room, horizon: list[date]) -> dict[str, str]:
        """One draft seed schedule per courtroom, in the batch the app lists as "Seed run"."""
        rid = f"RUN-{room.number:02d}-seed"
        self.add("scheduling_run", id=rid, preset_id=room.preset_id,
                 run_at=datetime.combine(self.today - timedelta(days=3), time(18, 0)),
                 horizon_start=horizon[0], horizon_days=len(horizon), policy="l1",
                 data_version=f"synthetic-seed{self.seed}", seed=self.seed, code_version="datagen",
                 clamped_rules=list(room.cfg.clamped), metrics=None,
                 additional_details={"batch": "seed", "label": "Seed run (generated)", "overrides": {}})
        return {"l1": rid}

    def unlisted_decisions(self, room: Room, cases: list[dict], horizon: list[date],
                           listed: dict[date, list[dict]], run_id: str) -> None:
        rng = self.rng
        on_list = {r["id"] for rows in listed.values() for r in rows}
        for row in cases:
            if row["id"] in on_list or row["status"] == "disposed":
                continue
            day = horizon[0]
            if row["is_on_hold"]:
                decision, why = "excluded", "on_hold"
            elif not row["additional_details"]["prerequisites_met"]:
                decision, why = "excluded", "prerequisite_pending"
            elif rng.random() < 0.08:
                decision, why, day = "near_miss", None, rng.choice(horizon)
            elif rng.random() < 0.03:
                decision, why = "not_ranked", None
            else:
                continue
            score = round(rng.uniform(25, 40), 2) if decision == "near_miss" else None
            reasons = self._reasons(row, row["next_purpose_code"]) if row["next_purpose_code"] else []
            if why:
                reasons = [f"excluded: {_label(why)}"]
            self.add("listing_decision", id=self.id("LD"), run_id=run_id, case_id=row["id"], list_date=day,
                     decision=decision, time_block=None, score=score,
                     score_components={"age": round(score * 0.5, 2)} if score else None,
                     exclusion_reason=why, reasons=reasons, causelist_item_id=None)

    # ------------------------------------------------------------------ driver

    def run(self) -> dict[str, list[dict]]:
        self.reference()
        self.advocates()
        seq = 0
        for k, preset in enumerate(self.presets, 1):
            room = self.room(preset, k)
            roster = generate_roster(self.cases_per_judge, today=self.today, seed=self.seed + room.number,
                                     case_types=room.cfg.case_types, id_prefix=f"HC{room.number}")
            cases = []
            for c in roster:
                seq += 1
                cases.append(self.case(room, c, seq))
            horizon, listed = self.schedule_future(room, cases)
            runs = self.runs(room, horizon)
            self.materialise(room, cases, horizon, listed, runs)
            self.unlisted_decisions(room, cases, horizon, listed, runs["l1"])
            run = next(r for r in self.rows["scheduling_run"] if r["id"] == runs["l1"])
            run["metrics"] = {"listed": sum(len(v) for v in listed.values()),
                              "cases": len(cases), "horizon_days": len(horizon)}
        return {t: [{k: v for k, v in r.items() if not k.startswith("_")} for r in rows]
                for t, rows in self.rows.items()}


def generate(cases_per_judge: int = 1000, seed: int = 7, today: date = date(2026, 10, 5),
             horizon_days: int = 10, presets: list[str] | None = None) -> dict[str, list[dict]]:
    """Rows per table name, ready for datagen.schema.insert()."""
    return Gen(seed, today, cases_per_judge, horizon_days, presets).run()
