"""Enumerations shared across the engine."""
from __future__ import annotations

from enum import Enum


class HearingType(str, Enum):
    ADMISSION = "ADMISSION"
    DELAY_CONDONATION_HEARING = "DELAY_CONDONATION_HEARING"
    COGNIZANCE = "COGNIZANCE"
    APPEARANCE = "APPEARANCE"
    WARRANT = "WARRANT"
    PLEA = "PLEA"
    EXAMINATION_UNDER_S351_BNSS = "EXAMINATION_UNDER_S351_BNSS"
    EVIDENCE_COMPLAINANT = "EVIDENCE_COMPLAINANT"
    EVIDENCE_ACCUSED = "EVIDENCE_ACCUSED"
    ARGUMENTS = "ARGUMENTS"
    JUDGEMENT = "JUDGEMENT"
    BAIL = "BAIL"
    REPORTS = "REPORTS"
    APPLICATION_REVIEW = "APPLICATION_REVIEW"

    @property
    def label(self) -> str:
        return LABELS[self]


H = HearingType

# Sequential lifecycle, in order (section 2.8).
SEQUENTIAL: list[HearingType] = [
    H.ADMISSION,
    H.DELAY_CONDONATION_HEARING,
    H.COGNIZANCE,
    H.APPEARANCE,
    H.WARRANT,
    H.PLEA,
    H.EXAMINATION_UNDER_S351_BNSS,
    H.EVIDENCE_COMPLAINANT,
    H.EVIDENCE_ACCUSED,
    H.ARGUMENTS,
    H.JUDGEMENT,
]
STAGE_INDEX: dict[HearingType, int] = {h: i for i, h in enumerate(SEQUENTIAL)}
INTERRUPTS: frozenset[HearingType] = frozenset({H.BAIL, H.REPORTS, H.APPLICATION_REVIEW})

LABELS: dict[HearingType, str] = {
    H.ADMISSION: "Admission",
    H.DELAY_CONDONATION_HEARING: "Delay condonation",
    H.COGNIZANCE: "Cognizance",
    H.APPEARANCE: "Appearance",
    H.WARRANT: "Warrant",
    H.PLEA: "Plea",
    H.EXAMINATION_UNDER_S351_BNSS: "Examination u/s 351 BNSS",
    H.EVIDENCE_COMPLAINANT: "Complainant evidence",
    H.EVIDENCE_ACCUSED: "Defence evidence",
    H.ARGUMENTS: "Arguments",
    H.JUDGEMENT: "Judgement",
    H.BAIL: "Bail",
    H.REPORTS: "Reports",
    H.APPLICATION_REVIEW: "Application review",
}


def normalise_type(value: str) -> HearingType:
    """'Evidence Complainant' -> HearingType.EVIDENCE_COMPLAINANT."""
    key = str(value).strip().upper().replace(" ", "_").replace("-", "_")
    return HearingType(key)


def roster_column(h: HearingType) -> str:
    """Roster hearing-count column for a type, e.g. 'hearings_evidence_complainant'."""
    return "hearings_" + h.value.lower()


class ReasonGroup(str, Enum):
    ABSENCE = "ABSENCE"
    PREP = "PREP"
    PROCESS = "PROCESS"
    COURT = "COURT"
    UNCLEAR = "UNCLEAR"


# hearing_failure_reasons.csv column -> group (section 2.6).
# "Court Holiday / No Sitting" is dropped: we never list on non-working days.
REASON_GROUPS: dict[str, ReasonGroup] = {
    "Respondent Absence / Non-Compliance": ReasonGroup.ABSENCE,
    "Petitioner Absence / Non-Compliance": ReasonGroup.ABSENCE,
    "Both Parties Unready / Absent": ReasonGroup.ABSENCE,
    "Party Sought Time / Adjournment": ReasonGroup.PREP,
    "Evidence / Filing Not Ready": ReasonGroup.PREP,
    "Awaiting Process / Summons / Warrant Return": ReasonGroup.PROCESS,
    "External Dependency": ReasonGroup.PROCESS,
    "Court Administrative Issue": ReasonGroup.COURT,
    "Unclear": ReasonGroup.UNCLEAR,
}
DROPPED_REASONS = ("Court Holiday / No Sitting",)

# Labels used for outcomes the tables do not cover.
PART_HEARD_LABEL = "Part-heard, court time ran out"
NOT_REACHED_LABEL = "Not reached"

BUCKETS: list[str] = ["0-1", "1-3", "3-4", "4-5", "5+"]


def age_bucket(age_years: float) -> str:
    if age_years < 1:
        return "0-1"
    if age_years < 3:
        return "1-3"
    if age_years < 4:
        return "3-4"
    if age_years < 5:
        return "4-5"
    return "5+"


WEEKDAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]


# Hearing groups used to mix a day and to order it (short calls first, then trial, then final).
GROUPS = ["SHORT", "TRIAL", "FINAL"]
GROUP_OF: dict[HearingType, str] = {
    H.ADMISSION: "SHORT", H.DELAY_CONDONATION_HEARING: "SHORT", H.COGNIZANCE: "SHORT",
    H.APPEARANCE: "SHORT", H.WARRANT: "SHORT", H.BAIL: "SHORT", H.REPORTS: "SHORT",
    H.APPLICATION_REVIEW: "SHORT",
    H.PLEA: "TRIAL", H.EXAMINATION_UNDER_S351_BNSS: "TRIAL", H.EVIDENCE_COMPLAINANT: "TRIAL",
    H.EVIDENCE_ACCUSED: "TRIAL",
    H.ARGUMENTS: "FINAL", H.JUDGEMENT: "FINAL",
}


def group_of(h) -> str:
    return GROUP_OF[HearingType(h)]
