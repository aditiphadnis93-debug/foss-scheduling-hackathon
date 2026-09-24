"""Court assistant: an AI agent the judge can ask about the day.

It answers from the day's own record only (the causelist, outcomes, held-back matters and the audit
log with the rule behind every decision), so every answer is traceable to a logged decision. It
never changes the schedule itself: it explains, and suggests changes the judge can then try in What-if.

* Live: Sarvam chat model (key in env ``SARVAM_API_KEY``, model ``SARVAM_MODEL``), strict JSON reply.
* Offline: a rule-based answer built from the same record (always available, deterministic).
* Recorded answers for the demo days are precomputed into ``web/public/data/assistant_100.json``.
"""
from __future__ import annotations

import json
from collections import Counter
from pathlib import Path
from typing import Any

SUGGESTED_QUESTIONS = [
    "Why is the first matter on today's list there?",
    "What went wrong today, and what should I change for tomorrow?",
    "Who caused today's delays?",
]

SYSTEM = (
    "You are the court assistant for a High Court judge. Answer ONLY from the day's record provided "
    "(causelist, outcomes, held-back matters and the audit log with the rule behind each decision). "
    "Use plain court language, no technical terms. Be specific: cite case numbers, times, and the rule "
    "or reason from the record. Never invent facts. You explain and suggest; the judge decides. "
    'Reply with strict JSON: {"answer": "<3-6 sentences>", "suggestions": ["<short actionable change>", ...], '
    '"cited_cases": ["<case number>", ...]}'
)


def day_context(run: dict, day: str, max_rows: int = 40) -> dict[str, Any]:
    d = next((x for x in run.get("days", []) if x.get("date") == day), None)
    if d is None:
        return {}
    rows = []
    for l in d.get("listings", [])[:max_rows]:
        o = l.get("outcome") or {}
        rows.append({"case": l["case_id"], "window": f'{l["start"]}-{l["end"]}', "purpose": l["purpose"],
                     "advocate": l["advocate"], "chance_goes_ahead": l.get("p_ahead"), "why_listed": l.get("why"),
                     "outcome": o.get("kind"), "reason": o.get("reason"), "who": o.get("stakeholder"),
                     "decided_by": o.get("decided_by"), "person_said": o.get("rationale"),
                     "next_date": o.get("next_date")})
    audit = [a for a in run.get("audit", []) if a.get("day") == day and a.get("action") not in ("listed", "next_date")][:40]
    return {"date": day, "sitting": d.get("sitting_windows"), "capacity_minutes": d.get("capacity"),
            "minutes_used": d.get("minutes_used"), "urgent": d.get("urgent"), "judge_emergency": d.get("judge_emergency"),
            "held_back": d.get("held_back", [])[:20], "listings": rows, "decisions_log": audit}


def offline_answer(question: str, ctx: dict) -> dict[str, Any]:
    rows = ctx.get("listings", [])
    if not rows:
        return {"answer": "There is no record for that day.", "suggestions": [], "cited_cases": [], "source": "rules"}
    q = question.lower()
    kinds = Counter(r["outcome"] for r in rows)
    who = Counter(r["who"] for r in rows if r.get("who"))
    if "why" in q and "first" in q:
        r = rows[0]
        ans = (f"{r['case']} ({r['purpose'].replace('_', ' ').lower()}) was listed first, {r['window']}: "
               + "; ".join(r.get("why_listed") or []) + f". Outcome: {r['outcome']}"
               + (f" ({r['reason']})" if r.get("reason") else "") + ".")
        return {"answer": ans, "suggestions": [], "cited_cases": [r["case"]], "source": "rules"}
    if "who" in q or "delay" in q:
        top = ", ".join(f"{k.replace('_', ' ')} {v}" for k, v in who.most_common(4)) or "none"
        return {"answer": f"Of {len(rows)} matters, {kinds.get('substantive', 0)} moved forward. Lost hearings by who "
                          f"was responsible: {top}.", "suggestions": [], "cited_cases": [], "source": "rules"}
    sug = []
    if kinds.get("not_reached"):
        sug.append(f"{kinds['not_reached']} matters were not reached: list slightly fewer long matters or keep standby ready.")
    if who.get("state_agencies"):
        sug.append("Summons/warrant still pending for some matters: ask the process section for a status before re-dating.")
    if who.get("respondent_side", 0) + who.get("petitioner_side", 0) >= 2:
        sug.append("Several parties did not appear: confirm attendance two days ahead for tomorrow's list.")
    return {"answer": f"{kinds.get('substantive', 0)} of {len(rows)} matters moved forward; "
                      f"{kinds.get('adjourned', 0)} adjourned, {kinds.get('not_ready', 0)} not ready, "
                      f"{kinds.get('not_reached', 0)} not reached.", "suggestions": sug, "cited_cases": [],
            "source": "rules"}


def ask(question: str, run: dict, day: str, client=None) -> dict[str, Any]:
    ctx = day_context(run, day)
    if client is not None and ctx:
        obj = client.ask(SYSTEM, json.dumps({"question": question, "record": ctx}, default=str))
        if isinstance(obj, dict) and obj.get("answer"):
            return {"answer": str(obj["answer"]), "suggestions": [str(s) for s in obj.get("suggestions", [])][:5],
                    "cited_cases": [str(c) for c in obj.get("cited_cases", [])][:10], "source": "ai"}
    return offline_answer(question, ctx)


def make_client(cache_path: Path | None = None):
    from .agents.engines import ResponseCache, SarvamClient
    return SarvamClient(ResponseCache(cache_path), max_tokens=2500)


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser(description="Precompute recorded assistant answers for demo days.")
    ap.add_argument("--run", required=True)
    ap.add_argument("--days", type=int, default=3)
    ap.add_argument("--out", required=True)
    ap.add_argument("--cache", default=None)
    a = ap.parse_args()
    run = json.loads(Path(a.run).read_text())
    client = make_client(Path(a.cache) if a.cache else None)
    days = [d["date"] for d in run["days"][: a.days]]
    out = {"questions": SUGGESTED_QUESTIONS, "answers": {}}
    for day in days:
        out["answers"][day] = {q: ask(q, run, day, client) for q in SUGGESTED_QUESTIONS}
    client.close()
    Path(a.out).write_text(json.dumps(out, indent=1))
    print("wrote", a.out, {d: [v["source"] for v in out["answers"][d].values()] for d in days})


# --- Proposing and testing a change -------------------------------------------------------------
# The assistant may only propose changes to the judge's own settings, within the guardrails; the
# engine then tests the proposal on the same court and returns the effect. The judge decides.
LEVERS = {
    "reserve_minutes": (0, 120, "minutes held back every day for urgent matters"),
    "ageing_share": (0.20, 0.60, "minimum share of hearing time for cases 4+ years old (never below 0.20)"),
    "overbook": (0.9, 1.3, "how far beyond expected capacity to list (1.0 = to capacity)"),
    "max_listed": (10, 60, "most matters listed in a day"),
    "cluster": (0.0, 2.0, "how strongly an advocate's matters are grouped on the same day"),
    "fresh": (0.0, 3.0, "extra priority for early-stage (fresh) matters"),
    "give_appointments": (0, 1, "give every matter a time window (1) or not (0)"),
    "use_readiness": (0, 1, "hold back matters whose summons/warrant/filing is not ready (1) or not (0)"),
}

PROPOSE_SYSTEM = (
    "You are the court assistant for a High Court judge. First decide what the judge's message is. If it is a "
    "greeting, small talk, or not about this court's scheduling, reply in one or two friendly sentences, say what "
    "you can do (explain today's list, find the cause of a problem, propose and test a change to their settings), "
    "and return an empty proposal {}. If it is a question, answer it from the record and propose only if a change "
    "would help. If it describes a problem, do the following. Using ONLY the "
    "day's record provided, explain the cause in 2-4 plain sentences, then propose at most 3 changes to "
    "the judge's own settings that should help, chosen ONLY from the allowed levers with values inside "
    "their ranges. Never propose lowering protections for old cases below the floor. Reply with strict "
    'JSON: {"intent": "greeting" | "question" | "problem", "answer": "...", '
    '"proposal": {"<lever>": <value>, ...}, "why": "<one sentence per change>", "cited_cases": ["..."]}. '
    'Only a "problem" may carry a proposal; for a greeting or a question the proposal must be {}.'
)


PLAIN = {"use_readiness": "the 'hold back matters that are not ready' setting",
         "give_appointments": "the 'time windows' setting",
         "reserve_minutes": "the 'minutes kept for urgent matters' setting",
         "overbook": "the 'how full to list the day' setting",
         "ageing_share": "the 'minimum time for old cases' setting",
         "max_listed": "the 'most matters on one day's list' setting",
         "cluster": "the 'group each advocate's matters' setting",
         "fresh": "the 'priority for fresh matters' setting"}


def plain_text(t: str) -> str:
    """Setting names in court words (the model sometimes echoes the technical names)."""
    import re
    for k, v in PLAIN.items():
        t = re.sub(rf"\b{k}\b(\s+(at|to|=|of)\s+[0-9.]+%?|\s+(at|to)\s+(true|false|on|off))?", v, t, flags=re.I)
    # the model sometimes echoes the plain label itself as if it were a setting name
    for lbl in ("most matters on the list", "how full the day is listed", "minutes kept for urgent matters"):
        t = re.sub(rf"(an? )?(high |low )?{re.escape(lbl)} (setting|factor) of", f"the '{lbl}' setting at", t, flags=re.I)
    return t


def _clean(proposal: dict) -> dict:
    out = {}
    for k, v in (proposal or {}).items():
        if k not in LEVERS:
            continue
        lo, hi, _ = LEVERS[k]
        try:
            x = float(v)
        except (TypeError, ValueError):
            continue
        x = min(hi, max(lo, x))
        out[k] = bool(round(x)) if k in ("give_appointments", "use_readiness") else (int(x) if k in ("reserve_minutes", "max_listed") else round(x, 2))
    return out


def offline_proposal(ctx: dict) -> dict:
    rows = ctx.get("listings", [])
    kinds = Counter(r["outcome"] for r in rows)
    prop, why = {}, []
    if kinds.get("not_reached", 0) >= 2:
        prop["overbook"] = 0.95; why.append("list a little under capacity so fewer matters go unreached")
    if (ctx.get("urgent") or []) and len(ctx.get("urgent")) >= 2:
        prop["reserve_minutes"] = 45; why.append("more urgent matters than the reserve absorbs")
    if sum(1 for r in rows if r.get("who") in ("respondent_side", "petitioner_side")) >= 3:
        prop["cluster"] = 0.8; why.append("group each advocate's matters so one trip covers them")
    return {"proposal": prop, "why": "; ".join(why)}


def propose(question: str, run: dict, day: str, client=None, current: dict | None = None) -> dict[str, Any]:
    ctx = day_context(run, day)
    if client is not None and ctx:
        payload = {"problem": question, "record": ctx, "current_settings": current or {},
                   "allowed_levers": {k: {"min": lo, "max": hi, "meaning": m} for k, (lo, hi, m) in LEVERS.items()}}
        obj = client.ask(PROPOSE_SYSTEM, json.dumps(payload, default=str))
        if isinstance(obj, dict) and obj.get("answer"):
            intent = str(obj.get("intent", "problem")).lower()
            prop = _clean(obj.get("proposal") or {}) if intent == "problem" else {}   # the model's own reading of the message
            return {"intent": intent, "answer": plain_text(str(obj["answer"])), "proposal": prop,
                    "why": plain_text(str(obj.get("why", ""))), "cited_cases": [str(c) for c in obj.get("cited_cases", [])][:10],
                    "source": "ai"}
    base = offline_answer(question, ctx)
    op = offline_proposal(ctx)
    return {**base, "proposal": op["proposal"], "why": op["why"]}
