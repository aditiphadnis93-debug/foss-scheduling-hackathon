"""Purpose → defect codes, owners, severity, and action labels (PRD §5)."""

from __future__ import annotations

from typing import Any

# PRD §5.2 purpose → required defect codes
PURPOSE_REQUIRED_CODES: dict[str, list[str]] = {
    "ADMISSION": ["RSVP_SHOW_INTENT"],  # PROCESS_RETURN_PENDING only if summary suggests
    "COGNIZANCE": ["FILING_NOT_READY", "RSVP_SHOW_INTENT"],
    "DELAY_CONDONATION_HEARING": ["FILING_NOT_READY", "RSVP_SHOW_INTENT"],
    "APPEARANCE": ["PROCESS_RETURN_PENDING", "PARTY_ABSENCE_RISK", "RSVP_SHOW_INTENT"],
    "WARRANT": ["PROCESS_RETURN_PENDING", "PARTY_ABSENCE_RISK"],
    "PLEA": ["PARTY_ABSENCE_RISK", "RSVP_SHOW_INTENT"],
    "EXAMINATION_UNDER_S351_BNSS": [
        "EVIDENCE_NOT_READY",
        "COUNSEL_NOT_READY",
        "RSVP_SHOW_INTENT",
    ],
    "EVIDENCE_COMPLAINANT": [
        "EVIDENCE_NOT_READY",
        "PARTY_ABSENCE_RISK",
        "COUNSEL_NOT_READY",
        "RSVP_SHOW_INTENT",
    ],
    "EVIDENCE_ACCUSED": [
        "EVIDENCE_NOT_READY",
        "PARTY_ABSENCE_RISK",
        "COUNSEL_NOT_READY",
        "RSVP_SHOW_INTENT",
    ],
    "ARGUMENTS": ["COUNSEL_NOT_READY", "FILING_NOT_READY", "RSVP_SHOW_INTENT"],
    "JUDGEMENT": ["RSVP_SHOW_INTENT"],
    "BAIL": ["PARTY_ABSENCE_RISK", "FILING_NOT_READY", "RSVP_SHOW_INTENT"],
    "REPORTS": ["EXTERNAL_REPORT_PENDING"],
    "APPLICATION_REVIEW": ["OBJECTION_PENDING", "RSVP_SHOW_INTENT"],
}

# Low-substantiveness purposes: bias seed so ≥1 hard defect stays open
LOW_SUBSTANTIVENESS: frozenset[str] = frozenset(
    {"WARRANT", "REPORTS", "ARGUMENTS", "EVIDENCE_ACCUSED"}
)

# Seed owners (PRD guidance)
DEFECT_OWNERS: dict[str, str] = {
    "PROCESS_RETURN_PENDING": "COURT",
    "FILING_NOT_READY": "COUNSEL",
    "EVIDENCE_NOT_READY": "COUNSEL",
    "COUNSEL_NOT_READY": "COUNSEL",
    "PARTY_ABSENCE_RISK": "PARTY",
    "RSVP_SHOW_INTENT": "PARTY",
    "OBJECTION_PENDING": "COUNSEL",
    "ADJOURNMENT_PREDECLARED": "COUNSEL",
    "EXTERNAL_REPORT_PENDING": "EXTERNAL_AGENCY",
    "COURT_ADMIN_BLOCK": "COURT",
}

DEFECT_DESCRIPTIONS: dict[str, str] = {
    "PROCESS_RETURN_PENDING": "Process / summons return not yet on record",
    "FILING_NOT_READY": "Required filing or pleading not ready",
    "EVIDENCE_NOT_READY": "Evidence / documents not ready for this hearing",
    "COUNSEL_NOT_READY": "Counsel not confirmed ready",
    "PARTY_ABSENCE_RISK": "Party may not appear (absence risk)",
    "RSVP_SHOW_INTENT": "Party has not confirmed they will appear (RSVP / show intent)",
    "OBJECTION_PENDING": "Objection or reply still pending",
    "ADJOURNMENT_PREDECLARED": "Adjournment already flagged for this date",
    "EXTERNAL_REPORT_PENDING": "External agency report still pending",
    "COURT_ADMIN_BLOCK": "Court admin hold — registry only",
}

DEFECT_SEVERITY: dict[str, str] = {
    "PROCESS_RETURN_PENDING": "HARD",
    "FILING_NOT_READY": "HARD",
    "EVIDENCE_NOT_READY": "HARD",
    "COUNSEL_NOT_READY": "HARD",
    "PARTY_ABSENCE_RISK": "HARD",
    "RSVP_SHOW_INTENT": "SOFT",  # default soft; judge may set blocking via policy
    "OBJECTION_PENDING": "HARD",
    "ADJOURNMENT_PREDECLARED": "HARD",
    "EXTERNAL_REPORT_PENDING": "HARD",
    "COURT_ADMIN_BLOCK": "HARD",
}


LOCKED_BY_LAW: frozenset[str] = frozenset(
    {
        "PROCESS_RETURN_PENDING",
        "FILING_NOT_READY",
        "EVIDENCE_NOT_READY",
        "COUNSEL_NOT_READY",
        "PARTY_ABSENCE_RISK",
        "OBJECTION_PENDING",
        "ADJOURNMENT_PREDECLARED",
        "EXTERNAL_REPORT_PENDING",
        "COURT_ADMIN_BLOCK",
    }
)


def is_locked(code: str) -> bool:
    return code in LOCKED_BY_LAW


def default_blocking(code: str) -> bool:
    """True if catalog severity is HARD or the code is locked-by-law."""
    if code in LOCKED_BY_LAW:
        return True
    return DEFECT_SEVERITY.get(code, "HARD") == "HARD"

# Primary party/counsel action per defect code
DEFECT_PRIMARY_ACTION: dict[str, str] = {
    "FILING_NOT_READY": "upload",
    "OBJECTION_PENDING": "upload",
    "EXTERNAL_REPORT_PENDING": "eta_report",
    "EVIDENCE_NOT_READY": "confirm_evidence",
    "COUNSEL_NOT_READY": "confirm_counsel",
    "PROCESS_RETURN_PENDING": "process_ack",
    "RSVP_SHOW_INTENT": "rsvp",
    "PARTY_ABSENCE_RISK": "undertake",
    "ADJOURNMENT_PREDECLARED": "withdraw_adjournment",
    "COURT_ADMIN_BLOCK": "",  # party cannot act
}

# Actions that party/counsel may perform
PARTY_COUNSEL_ACTIONS: frozenset[str] = frozenset(
    {
        "upload",
        "confirm_evidence",
        "confirm_counsel",
        "process_ack",
        "rsvp",
        "undertake",
        "flag_adjournment",
        "withdraw_adjournment",
        "eta_report",
    }
)

# Which owners a role may act on
ROLE_OWNERS: dict[str, frozenset[str]] = {
    "counsel": frozenset({"COUNSEL", "PARTY"}),  # demo collapses party+counsel somewhat
    "party": frozenset({"PARTY", "COUNSEL"}),
    "registry": frozenset({"COURT", "REGISTRY", "EXTERNAL_AGENCY", "COUNSEL", "PARTY"}),
}

HARD_OPEN_STATUSES: frozenset[str] = frozenset({"open", "rejected", "expired"})
SUBMITTED_STATUSES: frozenset[str] = frozenset({"submitted"})
CLEARED_STATUSES: frozenset[str] = frozenset({"cleared", "waived"})


def owner_for(code: str) -> str:
    return DEFECT_OWNERS.get(code, "COUNSEL")


def severity_for(code: str) -> str:
    return DEFECT_SEVERITY.get(code, "HARD")


def action_label_for(owner: str, role: str) -> str:
    """PRD: 'Your action' | 'Court action' | 'Agency action' based on role vs owner."""
    role = (role or "counsel").lower()
    owner = (owner or "").upper()
    if owner == "EXTERNAL_AGENCY":
        return "Agency action"
    if owner in ("COURT", "REGISTRY"):
        return "Court action"
    # PARTY / COUNSEL owned
    if role in ("party", "counsel") and owner in ROLE_OWNERS.get(role, frozenset()):
        return "Your action"
    if role == "registry":
        return "Your action" if owner in ("COURT", "REGISTRY") else "Party/Counsel action"
    return "Court action" if owner in ("COURT", "REGISTRY") else "Your action"


def can_act(owner: str, role: str, defect_status: str, code: str = "") -> bool:
    """Whether the actor can take a resolve action on this defect."""
    role = (role or "counsel").lower()
    owner = (owner or "").upper()
    if code == "COURT_ADMIN_BLOCK" and role != "registry":
        return False
    if role == "registry":
        return defect_status == "submitted" or owner in ("COURT", "REGISTRY")
    if defect_status not in ("open", "rejected"):
        # withdraw_adjournment needs open ADJOURNMENT; eta on open EXTERNAL
        if code == "ADJOURNMENT_PREDECLARED" and defect_status == "open":
            return True
        if code == "EXTERNAL_REPORT_PENDING" and defect_status == "open":
            return role in ("party", "counsel")
        return False
    return owner in ROLE_OWNERS.get(role, frozenset())


def duration_mins_for(purpose: str, duration_map: dict[str, int] | None = None) -> int | None:
    if duration_map and purpose in duration_map:
        return duration_map[purpose]
    defaults = {
        "ADMISSION": 5,
        "COGNIZANCE": 10,
        "DELAY_CONDONATION_HEARING": 5,
        "APPEARANCE": 10,
        "WARRANT": 10,
        "PLEA": 15,
        "EXAMINATION_UNDER_S351_BNSS": 30,
        "EVIDENCE_COMPLAINANT": 30,
        "EVIDENCE_ACCUSED": 30,
        "ARGUMENTS": 30,
        "JUDGEMENT": 30,
        "BAIL": 15,
        "REPORTS": 10,
        "APPLICATION_REVIEW": 10,
    }
    return defaults.get(purpose)


def catalog_snapshot() -> dict[str, Any]:
    return {
        "purpose_required_codes": PURPOSE_REQUIRED_CODES,
        "owners": DEFECT_OWNERS,
        "severity": DEFECT_SEVERITY,
    }
