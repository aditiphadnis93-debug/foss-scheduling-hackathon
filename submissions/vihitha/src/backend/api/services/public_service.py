"""Public slot page for litigants and advocates (spec v3 8.8). PUBLISHED hearings only; never party IDs."""
from __future__ import annotations

from datetime import date

from vihitha.calendar import fmt_day
from vihitha.enums import HearingType
from vihitha.windows import hhmm_to_min, min_to_hhmm

from .. import config
from ..db import session_scope
from ..errors import NotFound, ValidationFailed
from ..repositories import cases as cases_repo
from ..repositories import hearings as hearings_repo
from . import context

LATE_MINUTES = 10
BRING = {
    "APPEARANCE": ["Identity proof", "Summons or notice received"],
    "WARRANT": ["Identity proof", "Bail bond / surety papers if any"],
    "PLEA": ["Identity proof"],
    "EXAMINATION_UNDER_S351_BNSS": ["Identity proof"],
    "EVIDENCE_COMPLAINANT": ["Original cheque and bank return memo", "Proof affidavit", "Witness list"],
    "EVIDENCE_ACCUSED": ["Defence documents", "Witness list"],
    "ARGUMENTS": ["Written arguments (if any)", "Citations"],
    "JUDGEMENT": ["Identity proof"],
    "BAIL": ["Bail application copy", "Surety documents"],
    "ADMISSION": ["Complaint copy", "Statutory notice and postal proof"],
    "DELAY_CONDONATION_HEARING": ["Delay condonation petition"],
    "COGNIZANCE": ["Complaint copy"],
    "REPORTS": ["Copy of the report"],
    "APPLICATION_REVIEW": ["Application copy"],
}


def _ml_date(d: date) -> str:
    return d.strftime("%d-%m-%Y")


def slot(case_no: str) -> dict:
    if not case_no or not case_no.strip():
        raise ValidationFailed("case_no is required")
    with session_scope() as s:
        c = cases_repo.find_by_number(s, case_no.strip())
        if c is None:
            raise NotFound("No case with that number")
        t = context.today(s)
        base = {"case_number": c.case_number, "court_name": config.COURT_NAME, "court_address": config.COURT_ADDRESS}
        hs = [h for h in hearings_repo.for_case(s, c.id) if h.date >= t and h.status in ("PUBLISHED", "DONE")]
        today_h = next((h for h in hs if h.date == t), None)
        future = next((h for h in hs if h.date > t and h.status == "PUBLISHED"), None)
        if c.status == "DISPOSED" and today_h is None:
            return {**base, "date": None, "window_start": None, "window_end": None, "status": "DONE", "eta": None,
                    "delay_minutes": 0, "queue_position": None, "what_to_bring": [],
                    "message_en": "This case is disposed. No further hearings.",
                    "message_ml": "ഈ കേസ് തീർപ്പാക്കി. ഇനി ഹിയറിംഗ് ഇല്ല."}
        if today_h is not None:
            day_hs = [h for h in hearings_repo.on_date(s, t) if h.status in ("PUBLISHED", "DONE")]
            done = [h for h in day_hs if h.status == "DONE" and h.actual_end]
            delay = 0
            if done:
                last = max(done, key=lambda h: hhmm_to_min(h.actual_end))
                delay = max(0, hhmm_to_min(last.actual_end) - hhmm_to_min(last.est_end or last.actual_end))
            waiting = sorted([h for h in day_hs if h.status == "PUBLISHED"], key=lambda h: (h.est_start, h.seq))
            bring = BRING.get(today_h.hearing_type, [])
            if today_h.status == "DONE":
                st = "DONE"
                pos, eta = None, None
                msg = "Your hearing today is over."
                ml = "ഇന്നത്തെ നിങ്ങളുടെ ഹിയറിംഗ് കഴിഞ്ഞു."
            else:
                pos = waiting.index(today_h) + 1
                eta = min_to_hhmm(hhmm_to_min(today_h.est_start) + delay)
                if pos == 1 and done:
                    st, msg = "IN_PROGRESS", "Your case is next. Please be in the courtroom now."
                    ml = "നിങ്ങളുടെ കേസ് അടുത്തതാണ്. ദയവായി ഇപ്പോൾ കോടതി മുറിയിൽ ഉണ്ടാകുക."
                elif delay >= LATE_MINUTES:
                    st = "RUNNING_LATE"
                    msg = f"The court is running about {delay} minutes late. Expected around {eta}."
                    ml = f"കോടതി ഏകദേശം {delay} മിനിറ്റ് വൈകിയാണ്. ഏകദേശം {eta}ന് പ്രതീക്ഷിക്കുന്നു."
                else:
                    st = "SCHEDULED"
                    msg = f"Please come between {today_h.window_start} and {today_h.window_end}. Expected around {eta}."
                    ml = f"ദയവായി {today_h.window_start} നും {today_h.window_end} നും ഇടയിൽ എത്തുക. ഏകദേശം {eta}."
            return {**base, "date": t.isoformat(), "window_start": today_h.window_start,
                    "window_end": today_h.window_end, "status": st, "eta": eta, "delay_minutes": delay,
                    "queue_position": pos, "what_to_bring": bring, "message_en": msg, "message_ml": ml}
        if future is not None:
            label = HearingType(future.hearing_type).label
            return {**base, "date": future.date.isoformat(), "window_start": future.window_start,
                    "window_end": future.window_end, "status": "NOT_LISTED_TODAY", "eta": future.est_start,
                    "delay_minutes": 0, "queue_position": None,
                    "what_to_bring": BRING.get(future.hearing_type, []),
                    "message_en": f"Next hearing ({label}) on {fmt_day(future.date)} {future.date.year}, "
                                  f"between {future.window_start} and {future.window_end}.",
                    "message_ml": f"അടുത്ത ഹിയറിംഗ് {_ml_date(future.date)}ന് {future.window_start} – "
                                  f"{future.window_end} സമയത്ത്."}
        return {**base, "date": None, "window_start": None, "window_end": None, "status": "NOT_SCHEDULED",
                "eta": None, "delay_minutes": 0, "queue_position": None, "what_to_bring": [],
                "message_en": "Your next date will be announced.",
                "message_ml": "നിങ്ങളുടെ അടുത്ത തീയതി അറിയിക്കും."}
