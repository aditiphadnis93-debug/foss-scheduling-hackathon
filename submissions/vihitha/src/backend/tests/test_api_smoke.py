"""API smoke (spec v3 section 12): load -> plan -> day -> publish -> outcome -> next date -> close
-> what-if -> metrics -> export, all 2xx; plus the invariants the API promises."""
from datetime import date, timedelta

API = "/api/v1"


def ok(r, code=200):
    assert r.status_code == code, (r.status_code, r.text[:500])
    return r.json() if r.content and r.headers.get("content-type", "").startswith("application/json") else r


def test_full_flow(client):
    h = ok(client.get(f"{API}/health"))
    assert h["roster_loaded"] and h["today"] == "2026-09-24"
    today = date.fromisoformat(h["today"])

    # load (reset) + plan
    res = ok(client.post(f"{API}/setup/roster", json={"source": "SAMPLE", "reset": True}))
    plan = res["plan"]
    assert res["roster"]["cases"] == 100 and plan["days_planned"] >= 20
    # v3.1: every pending case has a date (except those waiting on process past the last day)
    assert plan["hearings_created"] + plan["unscheduled_count"] == 100 and plan["unscheduled_count"] <= 5
    r = client.post(f"{API}/setup/roster", json={"source": "SAMPLE"})
    assert r.status_code == 409

    cal = ok(client.get(f"{API}/setup/calendar", params={"from": "2026-10-01", "to": "2026-10-05"}))
    assert [d["sitting"] for d in cal["days"]] == [True, False, False, False, True]  # Oct 2 holiday + weekend

    # day view
    day = ok(client.get(f"{API}/calendar/day/{today}"))
    assert day["status"] == "DRAFT" and day["hearings"]
    for e in day["hearings"]:
        assert e["window_start"] <= e["est_start"] < e["window_end"]
    assert day["windows"] and all(w["end"] <= "13:30" or w["start"] >= "14:00" for w in day["windows"])
    ok(client.get(f"{API}/calendar/week", params={"start": today.isoformat()}))
    month = ok(client.get(f"{API}/calendar/month", params={"month": "2026-10"}))
    assert all(not d["listed"] for d in month["days"] if not d["sitting"])

    # preview + move a draft hearing
    hid = day["hearings"][-1]["hearing_id"]
    nxt_day = ok(client.get(f"{API}/calendar/day/2026-09-25"))
    pv = ok(client.post(f"{API}/hearings/preview", json={"change": {"type": "MOVE", "hearing_id": hid,
                                                                     "to_date": "2026-09-25"}}))
    assert len(pv["kpi_deltas"]) == 4 and pv["message"]
    mv = ok(client.patch(f"{API}/hearings/{hid}", json={"to_date": "2026-09-25"}))
    assert mv["hearing"]["date"] == "2026-09-25" and mv["hearing"]["pinned"]

    # publish today; published hearings are protected
    pub = ok(client.post(f"{API}/schedule/publish", json={"from": today.isoformat(), "to": today.isoformat()}))
    assert pub["days_published"] == 1
    day = ok(client.get(f"{API}/calendar/day/{today}"))
    first = day["hearings"][0]
    r = client.patch(f"{API}/hearings/{first['hearing_id']}", json={"to_date": "2026-09-28"})
    assert r.status_code == 409
    before = {e["hearing_id"]: (e["window_start"], e["est_start"]) for e in day["hearings"]}
    ok(client.post(f"{API}/schedule/plan", json={}))
    after = {e["hearing_id"]: (e["window_start"], e["est_start"])
             for e in ok(client.get(f"{API}/calendar/day/{today}"))["hearings"]}
    assert before == after

    # outcome + next date
    out = ok(client.post(f"{API}/hearings/{first['hearing_id']}/outcome", json={"result": "ADJOURNED",
                                                                                 "reason_group": "ABSENCE"}))
    assert out["next_date"] and out["next_date"]["suggested"]["date"] > today.isoformat()
    assert len(out["next_date"]["heatmap"]) == 42
    nd = ok(client.post(f"{API}/hearings/{first['hearing_id']}/next-date", json={"accept_suggestion": True}))
    assert nd["next_hearing"]["origin"] == "NEXT_DATE"

    # public slot reads published only
    pub_slot = ok(client.get(f"{API}/public/slot", params={"case_no": day["hearings"][1]["case_number"]}))
    assert pub_slot["status"] in ("SCHEDULED", "RUNNING_LATE", "IN_PROGRESS")
    assert "party" not in str(pub_slot).lower()

    # close day -> carry forward + today moves on
    cl = ok(client.post(f"{API}/calendar/day/{today}/close"))
    assert cl["today"] == "2026-09-25" and cl["carried_forward"] >= 1
    closed = ok(client.get(f"{API}/calendar/day/{today}"))
    assert closed["status"] == "CLOSED" and closed["totals"]["not_reached"] >= 1

    # demo auto-run the next day
    auto = ok(client.post(f"{API}/calendar/day/2026-09-25/auto-outcomes", json={}))
    assert auto["status"] == "CLOSED"
    assert all(e["result"] for e in auto["hearings"])

    # invariant: at most one future active hearing per pending case
    cases = ok(client.get(f"{API}/cases", params={"size": 500}))
    assert cases["total"] == 100
    assert all(c["projected_end"] for c in cases["items"] if c["status"] == "PENDING")
    detail = ok(client.get(f"{API}/cases/{cases['items'][0]['case_id']}"))
    assert len(detail["lifecycle"]) == 11
    ok(client.get(f"{API}/cases/forecast/summary"))
    ok(client.get(f"{API}/schedule/unscheduled"))

    # what-if doesn't change the DB; apply changes only draft days
    snap = ok(client.get(f"{API}/export/proposed_schedule.csv")).text
    wi = ok(client.post(f"{API}/whatif", json={"preset": "sehgal", "compare_to": "ACTIVE", "horizon_days": 30,
                                                "agents": True}))
    assert len(wi["kpis"]) == 4 and wi["focus_day"]["blocks"] and wi["agents_effect"]
    assert ok(client.get(f"{API}/export/proposed_schedule.csv")).text == snap
    ap = ok(client.post(f"{API}/whatif/{wi['id']}/apply", json={}))
    assert ap["active_ruleset"]["preset"] == "sehgal"

    # metrics + scoring + exports
    m = ok(client.get(f"{API}/metrics/summary"))
    assert len(m["kpis"]) == 4 and len(m["needs_attention"]) == 5 and m["weekly"]
    sc = ok(client.get(f"{API}/metrics/scoring"))
    assert len(sc["metrics"]) == 6
    ok(client.get(f"{API}/metrics/scoring", params={"source": "actual"}))
    csv = ok(client.get(f"{API}/export/cause-list.csv", params={"date": "2026-09-28"})).text
    assert csv.startswith("Case Number,Filing Number,Hearing Type,Hearing Date")

    # rules + settings + leave + reference
    ok(client.get(f"{API}/rules/presets"))
    rs = ok(client.get(f"{API}/rulesets"))["items"]
    joshi = next(r for r in rs if r["preset"] == "joshi")
    full = ok(client.get(f"{API}/rulesets/{joshi['id']}"))["ruleset"]
    upd = ok(client.put(f"{API}/rulesets/{joshi['id']}", json={"rules": full["rules"]}))
    assert upd["ruleset"]["rules"]["ageing_quota_pct"] >= 25
    act = [r for r in ok(client.get(f"{API}/rulesets"))["items"] if r["is_active"]][0]
    assert client.delete(f"{API}/rulesets/{act['id']}").status_code == 409
    ok(client.put(f"{API}/rules/active", json={"ruleset_id": rs[0]["id"]}))
    lv = ok(client.post(f"{API}/setup/leave", json={"date": "2026-10-05", "note": "Leave"}))
    assert lv["hearings_moved"] >= 0
    assert not ok(client.get(f"{API}/calendar/day/2026-10-05"))["hearings"]
    assert client.delete(f"{API}/setup/leave/2026-10-05").status_code == 204
    ok(client.get(f"{API}/setup/reference"))
    ok(client.get(f"{API}/setup/settings"))
    ok(client.get(f"{API}/setup/roster/summary"))

    # remove + add
    d = ok(client.get(f"{API}/calendar/day/2026-09-29"))
    victim = next(e for e in d["hearings"] if e["status"] == "DRAFT")
    rm = ok(client.delete(f"{API}/hearings/{victim['hearing_id']}"))
    assert rm["suggestion"]["suggested"]["date"]
    added = ok(client.post(f"{API}/hearings", json={"case_id": victim["case_id"], "date": "2026-09-30"}))
    assert added["hearing"]["origin"] == "JUDGE"

    # nothing ever on a non-sitting day
    sched = ok(client.get(f"{API}/export/proposed_schedule.csv", params={"from": "2026-09-24", "to": "2026-12-31"})).text
    dates = {line.split(",")[3] for line in sched.strip().splitlines()[1:]}
    sitting = {x["date"] for x in ok(client.get(f"{API}/setup/calendar", params={"from": "2026-09-24",
                                                                                  "to": "2026-12-31"}))["days"]
               if x["sitting"]}
    assert dates <= sitting

    assert client.post(f"{API}/setup/reset", json={"confirm": True}).status_code == 204
