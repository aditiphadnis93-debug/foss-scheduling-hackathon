"""Generate a synthetic town: neighbourhoods, households, people, businesses, advocates and the
relationships that disputes grow out of. Deterministic for a given ``random.Random``.

Every name is assembled from invented syllables; nothing refers to a real person or place.
"""
from __future__ import annotations

import math
import random
from dataclasses import dataclass, field

# --- invented geography -------------------------------------------------------
PLANE = 1000.0                   # map coordinates run 0..PLANE on both axes
COURT_XY = (500.0, 500.0)        # the court complex sits in the middle of the map
NEIGHBOURHOODS = [
    # name, centre x, centre y, spread, weight
    ("Old Market", 500.0, 580.0, 70.0, 1.2),
    ("Mill Quarter", 220.0, 300.0, 90.0, 1.0),
    ("Riverside", 780.0, 280.0, 90.0, 1.0),
    ("Hill Colony", 280.0, 800.0, 80.0, 0.8),
    ("Station Road", 800.0, 760.0, 80.0, 0.9),
]

# occupation, share, daily wage range (currency units)
OCCUPATIONS = [
    ("labourer", 0.20, (400, 650)),
    ("farmer", 0.10, (400, 700)),
    ("driver", 0.10, (550, 850)),
    ("mechanic", 0.07, (600, 950)),
    ("clerk", 0.09, (700, 1100)),
    ("teacher", 0.06, (900, 1400)),
    ("shopkeeper", 0.10, (800, 1600)),
    ("trader", 0.07, (1100, 2600)),
    ("homemaker", 0.13, (250, 350)),     # imputed value of a day away from home
    ("retired", 0.08, (300, 450)),
]
BUSINESS_KINDS = ["grocery", "hardware", "textiles", "pharmacy", "tea stall", "wholesale", "wholesale"]

_SYL_A = ["ka", "ve", "lo", "mi", "ra", "tu", "se", "no", "pa", "di", "ro", "ya", "be", "zu", "fe"]
_SYL_B = ["rin", "vol", "sa", "ten", "mar", "lu", "dek", "ni", "vas", "ro", "len", "ta", "mo", "ris"]


def synthetic_name(rng: random.Random) -> str:
    first = (rng.choice(_SYL_A) + rng.choice(_SYL_B)).capitalize()
    last = (rng.choice(_SYL_A) + rng.choice(_SYL_A) + rng.choice(_SYL_B)).capitalize()
    return f"{first} {last}"


@dataclass
class Person:
    pid: str
    name: str
    household: int
    neighbourhood: str
    x: float
    y: float
    occupation: str
    wage: float
    trips: int = 0
    wages_lost: float = 0.0
    frustration: float = 0.0
    balance: float = 0.0             # money gained (+) or paid (-) through disputes
    disputes: list[str] = field(default_factory=list)


@dataclass
class Business:
    bid: str
    name: str
    kind: str
    owner: str
    x: float
    y: float


@dataclass
class Advocate:
    aid: str
    name: str
    x: float
    y: float
    adopted: bool = False           # True = an advocate id taken from the roster
    trips: int = 0
    matters: int = 0


@dataclass
class Relationship:
    rid: int
    kind: str                      # lender_borrower | supplier_shop | employer_worker | landlord_tenant
    creditor: str                  # the side that is owed money (complainant if it goes to court)
    debtor: str
    scale: float                   # typical amount at stake (currency units)
    busy: bool = False             # an active dispute already exists on this relationship


KIND_TEXT = {
    "lender_borrower": ("lent money to", "missed a repayment; the repayment cheque bounced"),
    "supplier_shop": ("supplies goods on credit to", "fell behind on a supply bill; the payment cheque bounced"),
    "employer_worker": ("employs", "wages went unpaid"),
    "landlord_tenant": ("rents a home to", "rent fell into arrears"),
    "family_property": ("shares family property with", "a quarrel over a share of the property broke out"),
    "other": ("lives near", "a quarrel over money broke out"),
}


@dataclass
class Town:
    people: list[Person]
    businesses: list[Business]
    advocates: list[Advocate]
    relationships: list[Relationship]

    def person(self, pid: str) -> Person:
        return self.people[int(pid.split("-")[1]) - 1]


def _clamp(v: float) -> float:
    return max(10.0, min(PLANE - 10.0, v))


def build_town(rng: random.Random, population: int, household_size: tuple[int, int],
               n_businesses: int, n_advocates: int) -> Town:
    weights = [n[4] for n in NEIGHBOURHOODS]
    occ_names = [o[0] for o in OCCUPATIONS]
    occ_w = [o[1] for o in OCCUPATIONS]
    wage_rng = {o[0]: o[2] for o in OCCUPATIONS}

    people: list[Person] = []
    hh = 0
    while len(people) < population:
        hh += 1
        nb = rng.choices(NEIGHBOURHOODS, weights=weights)[0]
        hx = _clamp(rng.gauss(nb[1], nb[3]))
        hy = _clamp(rng.gauss(nb[2], nb[3]))
        size = min(rng.randint(*household_size), population - len(people))
        for _ in range(size):
            occ = rng.choices(occ_names, weights=occ_w)[0]
            lo, hi = wage_rng[occ]
            n = len(people) + 1
            people.append(Person(f"TP-{n:05d}", synthetic_name(rng), hh, nb[0],
                                 round(_clamp(hx + rng.uniform(-8.0, 8.0)), 1),
                                 round(_clamp(hy + rng.uniform(-8.0, 8.0)), 1),
                                 occ, float(rng.randint(lo, hi))))

    owners = [p for p in people if p.occupation in ("shopkeeper", "trader")]
    rng.shuffle(owners)
    businesses: list[Business] = []
    for i, owner in enumerate(owners[:n_businesses]):
        kind = "wholesale" if owner.occupation == "trader" and rng.random() < 0.5 else rng.choice(BUSINESS_KINDS[:-2])
        businesses.append(Business(f"TB-{i + 1:03d}", f"{owner.name.split()[1]} {kind.title()}", kind,
                                   owner.pid, owner.x, owner.y))

    advocates: list[Advocate] = []
    for i in range(n_advocates):
        ang, dist = rng.uniform(0, 2 * math.pi), rng.uniform(20, 140)
        advocates.append(Advocate(f"TADV-{i + 1:03d}", "Adv. " + synthetic_name(rng),
                                  round(_clamp(COURT_XY[0] + dist * math.cos(ang)), 1),
                                  round(_clamp(COURT_XY[1] + dist * math.sin(ang)), 1)))

    rels: list[Relationship] = []

    def add(kind: str, creditor: Person, debtor: Person, scale: float) -> None:
        if creditor.pid != debtor.pid:
            rels.append(Relationship(len(rels), kind, creditor.pid, debtor.pid, round(scale, -2)))

    # lenders: a few better-off people lend to many
    by_wage = sorted(people, key=lambda p: -p.wage)
    lenders = by_wage[: max(3, population // 25)]
    working = [p for p in people if p.occupation not in ("retired",)]
    for lender in lenders:
        for b in rng.sample(working, k=min(len(working), rng.randint(5, 12))):
            add("lender_borrower", lender, b, b.wage * rng.uniform(20, 120))

    wholesalers = [b for b in businesses if b.kind == "wholesale"] or businesses[:1]
    shops = [b for b in businesses if b.kind != "wholesale"]
    for shop in shops:
        for sup in rng.sample(wholesalers, k=min(len(wholesalers), rng.randint(1, 3))):
            add("supplier_shop", people[int(sup.owner.split("-")[1]) - 1],
                people[int(shop.owner.split("-")[1]) - 1], rng.uniform(40_000, 300_000))

    workers = [p for p in people if p.occupation in ("labourer", "driver", "mechanic")]
    for biz in businesses:
        owner = people[int(biz.owner.split("-")[1]) - 1]
        for w in rng.sample(workers, k=min(len(workers), rng.randint(1, 5))):
            add("employer_worker", owner, w, w.wage * rng.uniform(10, 45))

    landlords = by_wage[: max(3, population // 30)]
    households = sorted({p.household for p in people})
    heads = {}
    for p in people:
        heads.setdefault(p.household, p)
    for h in rng.sample(households, k=len(households) // 6):
        tenant = heads[h]
        add("landlord_tenant", rng.choice(landlords), tenant, tenant.wage * rng.uniform(15, 60))

    return Town(people, businesses, advocates, rels)
