"""Stage transitions after a reached hearing (section 5.6)."""
from __future__ import annotations

from datetime import date, timedelta

from .enums import INTERRUPTS, SEQUENTIAL, STAGE_INDEX, HearingType, ReasonGroup
from .models import Case, Outcome
from .reference import Reference

H = HearingType


def next_stage(case: Case, h: HearingType) -> HearingType | None:
    """Stage after a substantive hearing of sequential purpose h. None = disposed."""
    if h == H.JUDGEMENT:
        return None
    if h in (H.APPEARANCE, H.WARRANT):
        return H.PLEA
    nxt = SEQUENTIAL[STAGE_INDEX[h] + 1]
    # [ASSUMPTION] Skip delay condonation unless the case already had DCH hearings.
    if nxt == H.DELAY_CONDONATION_HEARING and case.hearing_counts.get(H.DELAY_CONDONATION_HEARING, 0) == 0:
        nxt = H.COGNIZANCE
    return nxt


def apply(case: Case, h: HearingType, outcome: Outcome, d: date, ref: Reference) -> None:
    """Mutates `case` for a reached hearing of purpose h on day d."""
    case.hearing_counts[h] = case.hearing_counts.get(h, 0) + 1
    if outcome.reason_group is not None:
        case.reason_history.append(outcome.reason_group)

    if outcome.substantive:
        case.consecutive_non_substantive = 0
        case.consecutive_absence = 0
        if h in INTERRUPTS:
            case.next_purpose = case.stage  # back to the main line
        else:
            nxt = next_stage(case, h)
            if nxt is None:
                case.disposed_on, case.disposal_type = d, "JUDGEMENT"
            else:
                if h in (H.APPEARANCE, H.WARRANT):
                    case.accused_seen = True
                case.stage = nxt
                case.next_purpose = nxt
                case.hearings_at_stage = 0
                case.stage_entered_on = d
        case.pending_until = None
        case.pending_reason = None
        case.last_chance = False
    else:
        case.consecutive_non_substantive += 1
        case.hearings_at_stage += 1
        if outcome.reason_group == ReasonGroup.PROCESS:
            case.pending_until = d + timedelta(days=ref.gap(h))
            case.pending_reason = "Awaiting return of process"
        if outcome.reason_group == ReasonGroup.ABSENCE:
            case.consecutive_absence += 1
        else:
            case.consecutive_absence = 0
        # [ASSUMPTION] Two consecutive absences at appearance -> warrant.
        if h == H.APPEARANCE and case.consecutive_absence >= 2:
            case.stage = H.WARRANT
            case.next_purpose = H.WARRANT
            case.hearings_at_stage = 0
            case.stage_entered_on = d
            case.consecutive_absence = 0

    if outcome.settled and not case.disposed:
        case.disposed_on, case.disposal_type = d, "SETTLED"
