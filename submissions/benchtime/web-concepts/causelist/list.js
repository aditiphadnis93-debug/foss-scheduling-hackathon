// Tomorrow's list: the cause list as a page, live from the engine. Take off, put on, find, approve.
import {
  $, esc, api, toMin, clock, clockOf, dateLong, dateShort, dayEnd, benchToClock, in10, likely, prospectText, dayKind,
  purpose, isOld, years, plainReasons, lastOrder, caseIdFrom, getRules, getOverrides, setOverrides, getApproval,
  setApproval, planRequest, whatChanges, toast, wireTheme, SAMPLE_NOTE, turnsOn, decidedButPending, withTimes,
} from "./core.js";

const S = { meta: null, date: null, rules: {}, ov: null, plan: null, preview: null, pending: null, open: new Set(), found: null, sure: false, error: null };

const listKey = (plan) => plan.listings.map((l) => l.caseId).join(",");
const approvedNow = () => {
  const a = getApproval();
  return a && a.date === S.date && a.key === listKey(S.plan) ? a : null;
};

async function planFor(ov) {
  return withTimes(await api("plan", planRequest(S.meta, S.date, S.rules, ov)));
}

async function boot() {
  wireTheme();
  try {
    S.meta = await api("meta");
    S.date = new URLSearchParams(location.search).get("date") || S.meta.defaultDate;
    S.rules = getRules();
    S.ov = getOverrides(S.date);
    S.plan = await planFor(S.ov);
    render(true);
  } catch (e) {
    $("#sheet").innerHTML = `<h1 class="title">Tomorrow's list could not be prepared</h1>
      <p class="lede">${esc(e.message)}</p>
      <p><button class="btn btn-primary" type="button" onclick="location.reload()">Try again</button></p>`;
    $("#panel").innerHTML = "";
  }
}

/* ---------------- the page ---------------- */

function render(first = false) {
  const P = S.preview ?? S.plan;
  if (!P.workingDay) return renderNoCourt(P);
  $("#sheet").innerHTML = header(P) + groups(P) + noOne(P) + footnote();
  $("#panel").innerHTML = panel();
  $("#previewbar").hidden = !S.pending;
  if (S.pending) $("#previewbar").innerHTML = previewBar();
  wire(first);
  S.swept = true;
}

function renderNoCourt(P) {
  $("#sheet").innerHTML = `<h1 class="title">No court on ${esc(dateLong(P.date))}</h1>
    <p class="lede">It is not a working day, so there is no list.</p>
    ${P.nextWorkingDay ? `<p><a class="btn btn-primary" href="/?date=${P.nextWorkingDay}">Open the list for ${esc(dateLong(P.nextWorkingDay))}</a></p>` : ""}`;
  $("#panel").innerHTML = "";
}

function header(P) {
  const e = P.expected, end = dayEnd(P);
  const approved = !S.pending && approvedNow();
  const custom = Object.keys(S.rules).length > 0;
  const lo = benchToClock(P, e.minutesLo), hi = benchToClock(P, e.minutesHi), close = toMin(P.sitting.end);
  const past = e.overrunRisk < 0.05 ? `Very little chance the day runs past ${clock(close)}.` : `About ${in10(e.overrunRisk)} in 10 chance the day runs past ${clock(close)}.`;
  return `
  ${approved ? stamp(approved, false) : ""}
  <p class="court">${esc(S.meta.court.name)}</p>
  <h1 class="title">Tomorrow's list</h1>
  <p class="date">Next sitting: ${esc(dateLong(P.date))}</p>
  <p class="summary"><span>${e.listed} cases, ${dayKind(P)}.</span> <span>About ${Math.round(e.substantive)} will likely go ahead.</span>${lateCount(P) ? ` <span>About ${Math.round(e.reached)} will be reached before the court rises at ${clockOf(P.sitting.end)}.</span>` : end ? ` <span>The day should end about ${clock(end)}.</span>` : ""}</p>
  ${strip(P)}
  ${P.derivedTimes ? `<p class="note">The planner gives no call times, so the times shown are estimates from the expected length of each hearing.</p>` : ""}
  ${!P.derivedTimes && overLunch(P) ? `<p class="flag">Check the times: the planner has ${overLunch(P)} matter${overLunch(P) === 1 ? "" : "s"} running into the lunch break (${P.sitting.breaks.map((b) => `${clockOf(b.start)} to ${clockOf(b.end)}`).join(", ")}). This is noted for the technical team.</p>` : ""}
  <div class="sure">
    <button type="button" class="linkish" id="sure" aria-expanded="${S.sure}">How sure are we?</button>
    <div id="sure-body" ${S.sure ? "" : "hidden"}>
      ${lateCount(P)
        ? `<p>The list holds more hearings than one day on purpose. Many listed matters fail in the first minutes, so the next matter is called in their place. About ${Math.round(e.reached)} will be reached before the court rises at ${clockOf(P.sitting.end)}. Matters not reached get an early new date. Over the quarter, the court sits a little past ${clockOf(P.sitting.end)} on about 4 days in 10, for about 15 minutes on those days.</p>`
        : `<p>The day will most likely end between ${clock(Math.min(lo, end ?? lo))} and ${clock(hi)}. ${past}</p>`}
      <p>Between ${Math.round(e.substantiveLo)} and ${Math.round(e.substantiveHi)} cases will likely go ahead.</p>
    </div>
  </div>
  ${custom ? `<p class="note">This list follows your own rules, not the recommended ones. <a href="/rules">See my rules</a></p>` : ""}`;
}

/** The one picture: the court day as a ruler, each case a mark, lunch and the free time shown plainly. */
function strip(P) {
  const start = toMin(P.sitting.start), close = toMin(P.sitting.end), span = close - start;
  const pct = (m) => ((m - start) / span) * 100;
  const end = dayEnd(P);
  const marks = P.listings
    .filter((l) => l.callTime && !l.standby && !l.late)
    .map((l) => {
      const a = toMin(l.callTime);
      return `<span class="mark ${likely(l.pSubstantive) ? "" : "maybe"}" style="left:${pct(a)}%;width:${(Math.max(0, Math.min(l.expectedMinutes, close - a)) / span) * 100}%"></span>`;
    })
    .join("");
  const breaks = P.sitting.breaks
    .map((b) => `<span class="lunch" style="left:${pct(toMin(b.start))}%;width:${pct(toMin(b.end)) - pct(toMin(b.start))}%"><span>Lunch</span></span>`)
    .join("");
  const ticks = [];
  for (let h = Math.ceil(start / 60) * 60; h <= close - 45; h += 60) ticks.push(`<span style="left:${pct(h)}%">${clock(h).replace(":00", "")}</span>`);
  const e = P.expected;
  const band = S.sure ? `<span class="band" style="left:${pct(benchToClock(P, e.minutesLo))}%;width:${Math.max(0, Math.min(100, pct(benchToClock(P, e.minutesHi))) - pct(benchToClock(P, e.minutesLo)))}%"></span>` : "";
  const maybe = P.listings.some((l) => l.callTime && !likely(l.pSubstantive));
  return `
  <figure class="strip" aria-label="The day from ${clockOf(P.sitting.start)} to ${clock(close)}. Cases fill it until about ${end ? clock(end) : "the end"}.">
    <div class="ruler">
      ${breaks}${band}
      <div class="marks ${S.swept ? "" : "sweep"}">${marks}</div>
      ${lateCount(P) ? `<span class="endmark flip" style="left:100%"><span>about ${Math.max(1, P.expected.listed - Math.round(P.expected.reached))} not reached by ${clock(close)}</span></span>`
        : end ? `<span class="endmark ${pct(end) > 72 ? "flip" : ""}" style="left:${pct(end)}%"><span>ends about ${clock(end)}</span></span>` : ""}
      <span class="rise"><span>court rises ${clock(close)}</span></span>
    </div>
    <div class="ticks" aria-hidden="true">${ticks.join("")}</div>
    <figcaption><span class="key"><span class="sw"></span>likely to go ahead</span>${maybe ? `<span class="key"><span class="sw maybe"></span>may be adjourned</span>` : ""}</figcaption>
  </figure>`;
}

function lateCount(P) {
  return P.listings.filter((l) => l.late).length;
}

function overLunch(P) {
  return P.listings.filter((l) => l.callTime && !l.standby && P.sitting.breaks.some((b) => {
    const a = toMin(l.callTime), e = a + l.expectedMinutes;
    return a < toMin(b.end) && e > toMin(b.start) + 2;
  })).length;
}

function groups(P) {
  const start = toMin(P.sitting.start), br = P.sitting.breaks[0];
  const end = dayEnd(P);
  const cur = new Set(S.plan.listings.map((l) => l.caseId));
  const next = new Set(P.listings.map((l) => l.caseId));
  // in a preview, cases leaving the list stay on the page, struck through
  const leaving = S.preview ? S.plan.listings.filter((l) => !next.has(l.caseId)).map((l) => ({ ...l, leaving: true })) : [];
  const wasStandby = new Set(S.plan.listings.filter((l) => l.standby).map((l) => l.caseId));
  const rows = [...P.listings.map((l) => ({ ...l, coming: S.preview && !cur.has(l.caseId), moved: S.preview && l.standby && cur.has(l.caseId) && !wasStandby.has(l.caseId) })), ...leaving].sort(
    (a, b) => (a.standby - b.standby) || (a.callTime && b.callTime ? toMin(a.callTime) - toMin(b.callTime) : 0) || (a.leaving ? -1 : 1),
  );
  const timed = rows.filter((l) => l.callTime && !l.standby && !l.late);
  const standby = rows.filter((l) => l.standby || !l.callTime || l.late);
  const sections = [];
  if (br) {
    const bs = toMin(br.start), be = toMin(br.end);
    sections.push([`Morning, ${clock(start)} to ${clock(bs)}`, timed.filter((l) => toMin(l.callTime) < bs)]);
    sections.push([`Afternoon, ${clock(be)} to ${lateCount(P) || !end ? clockOf(P.sitting.end) : `about ${clock(Math.max(end, be))}`}`, timed.filter((l) => toMin(l.callTime) >= bs)]);
  } else sections.push([`${clock(start)} to about ${end ? clock(end) : clockOf(P.sitting.end)}`, timed]);
  if (standby.length) sections.push([P.derivedTimes ? `May not be reached before ${clockOf(P.sitting.end)} (called if time allows)` : "If time allows (called only if other cases finish early)", standby]);
  let item = 0;
  return sections
    .filter(([, list]) => list.length)
    .map(([title, list]) => {
      let lastWin = null;
      const body = list
        .map((l) => {
          const win = l.window && l.window !== "standby" ? l.window.split("-")[0] : null;
          const showTime = win && win !== lastWin;
          if (win) lastWin = win;
          const no = l.leaving ? "" : ++item;
          return row(l, no, showTime ? clockOf(win) : "", showTime);
        })
        .join("");
      const n = list.filter((l) => !l.leaving).length;
      return `<section class="group"><h2><span>${esc(title)}</span><span class="count">${n} case${n === 1 ? "" : "s"}</span></h2><ol class="rows">${body}</ol></section>`;
    })
    .join("");
}

function row(l, no, time, newWindow) {
  const c = l.case, id = l.caseId, open = S.open.has(id) && !S.pending;
  const cls = ["row", newWindow ? "newwin" : "", l.leaving ? "leaving" : "", l.coming ? "coming" : "", l.pinned ? "pinned" : "", open ? "open" : ""].join(" ");
  const tag = l.leaving ? `<span class="tag tag-off">coming off</span>` : l.moved ? `<span class="tag tag-off">moves here</span>` : l.coming ? `<span class="tag tag-on">${S.ov.drop.includes(id) ? "put back" : l.pinned ? "added by you" : "comes on to fill the time"}</span>` : l.pinned ? `<span class="tag tag-on">added by you</span>` : "";
  return `<li class="${cls}" data-id="${esc(id)}">
    <button type="button" class="line" aria-expanded="${open}" ${S.pending ? "disabled" : ""} aria-label="Item ${no}, ${esc(id)}. ${esc(purpose(l.type, c.nextPurposeLabel))}. ${isOld(c) ? "Old case. " : ""}${prospectText(l.pSubstantive)}. Show details.">
      <span class="no">${no}</span>
      <span class="time">${time}</span>
      <span class="cno">${esc(id)}</span>
      <span class="what">${esc(purpose(l.type, c.nextPurposeLabel))}${isOld(c) ? ` <span class="old">old case</span>` : ""}${tag}</span>
      <span class="odds ${likely(l.pSubstantive) ? "" : "maybe"}">${prospectText(l.pSubstantive)}</span>
    </button>
    ${open ? details(l) : ""}
  </li>`;
}

function slot(l) {
  const [a, b] = (l.window ?? "").split("-");
  return a && b ? `between ${clockOf(a)} and ${clockOf(b)}` : `about ${clockOf(l.callTime)}`;
}

function facts(c) {
  const f = [`Filed ${dateShort(c.filingDate)}, ${years(c.ageYears)} ago.`];
  if (c.crossesNext) f.push(`It turns ${c.crossesNext.years} years old on ${dateShort(turnsOn(c, c.crossesNext.years))}.`);
  f.push(`Listed ${c.totalHearings} time${c.totalHearings === 1 ? "" : "s"} so far.`);
  return f.join(" ");
}

function details(l) {
  const c = l.case, why = plainReasons(l, c), order = lastOrder(c);
  return `<div class="details">
    <p class="chance">${in10(l.pSubstantive)} in 10 chance it goes ahead.</p>
    ${why.length ? `<ul class="why">${why.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>` : ""}
    <p class="facts">${esc(facts(c))} Advocate ${esc(c.advocateId)}.</p>
    ${order ? `<p class="order">Last order: <q>${esc(order)}</q></p>` : ""}
    ${decidedButPending(c) ? `<p class="flag">Check this case: the last order reads as if it was decided, but the records still show it pending.</p>` : ""}
    <div class="actions">
      ${l.pinned ? `<p class="pinned-note">You put this case on the list.</p><button type="button" class="btn btn-quiet" data-stage="drop" data-id="${esc(l.caseId)}">Undo</button>`
        : `<button type="button" class="btn btn-outline" data-stage="drop" data-id="${esc(l.caseId)}">Take off tomorrow's list</button>`}
    </div>
  </div>`;
}

function noOne(P) {
  const n = P.desk.length + P.deferred.length;
  if (!n) return `<section class="group noone"><h2><span>No one needs to come tomorrow</span><span class="count">none</span></h2><p class="noone-line">Every case on the list is expected in court.</p></section>`;
  const moved = P.deferred.filter((d) => /check-in/i.test(d.reason));
  const byYou = P.deferred.filter((d) => /taken off/i.test(d.reason));
  const other = P.deferred.filter((d) => !/check-in|taken off/i.test(d.reason));
  const names = [
    ...P.desk.map((d) => `<li><span class="cno">${esc(d.caseId)}</span> ${d.kind === "mediation_report" ? "mediation report not in yet" : `${esc(kindWords(d.kind))} not back yet`}</li>`),
    ...P.deferred.map((d) => `<li><span class="cno">${esc(d.caseId)}</span> moved to ${esc(dateShort(d.to))}</li>`),
  ].join("");
  return `<section class="group noone">
    <h2><span>No one needs to come tomorrow</span><span class="count">${n} case${n === 1 ? "" : "s"}</span></h2>
    <ul class="noone-lines">
      <li>Summons or warrant not back yet: ${P.desk.length || "none"}.</li>
      ${moved.length ? `<li>A party said they are not ready, so the case moves to a new date: ${moved.length}.</li>` : ""}
      ${byYou.length ? `<li>Taken off the list by you: ${byYou.length}.</li>` : ""}
      ${other.map((d) => `<li>${esc(d.caseId)}: ${esc(d.reason)}.</li>`).join("")}
    </ul>
    <details class="names"><summary>Show the ${n} case numbers</summary><ul>${names}</ul></details>
  </section>`;
}

function footnote() {
  const a = !S.pending && approvedNow();
  return `<p class="foot">${a ? `Approved at ${esc(a.time)} for the sitting on ${esc(dateShort(S.date))}.` : "Not approved yet."} ${esc(SAMPLE_NOTE)}</p>`;
}

function stamp(a, animate) {
  return `<div class="stamp ${animate ? "press" : ""}" aria-hidden="true"><span class="s1">Approved</span><span class="s2">for ${esc(dateShort(S.date))}</span></div>`;
}

/* ---------------- the margin: decision, find, changes ---------------- */

function panel() {
  const a = approvedNow();
  const advocates = new Set(S.plan.messages.map((m) => m.to)).size;
  const decision = S.pending
    ? `<div class="block decide"><h2>Check the change first</h2><p>The list below shows the change marked in. Keep it or cancel it at the bottom of the screen.</p></div>`
    : a
      ? `<div class="block decide done"><h2>Tomorrow's list is approved.</h2>
         <p>Text messages will go to ${advocates} advocates.</p>
         <div class="row2"><button type="button" class="btn btn-outline" id="print">Print the list</button><button type="button" class="btn btn-quiet" id="unapprove">Undo approval</button></div></div>`
      : `<div class="block decide"><h2>Needs your decision</h2>
         <p>Read the list, then approve it. Advocates get their text message only after you approve.${notReady().length ? ` Also look at the ${notReady().length} case${notReady().length === 1 ? "" : "s"} below where a side said they are not ready.` : ""}</p>
         <button type="button" class="btn btn-primary btn-big" id="approve">Approve tomorrow's list</button></div>`;
  const nr = notReady();
  const ready = !S.pending && nr.length
    ? `<div class="block notready"><h2>A side said they are not ready (${nr.length})</h2>
       <p class="hint">Each has been given a later date. Put one back if it should be heard now.</p>
       <ul>${nr.slice(0, 3).map(nrItem).join("")}</ul>
       ${nr.length > 3 ? `<details class="nr-more"><summary>Show the other ${nr.length - 3}</summary><ul>${nr.slice(3).map(nrItem).join("")}</ul></details>` : ""}</div>`
    : "";
  const changes = [
    ...S.ov.drop.map((id) => `<li>You took <span class="cno">${esc(id)}</span> off. <button type="button" class="btn btn-quiet" data-stage="pin" data-id="${esc(id)}">Undo</button></li>`),
    ...S.ov.pin.map((id) => `<li>You put <span class="cno">${esc(id)}</span> on. <button type="button" class="btn btn-quiet" data-stage="drop" data-id="${esc(id)}">Undo</button></li>`),
  ];
  return `${decision}${ready}
  <form class="block find" id="find" role="search">
    <label for="q"><h2>Find a case</h2></label>
    <p class="hint" id="q-hint">${S.pending ? "Keep or cancel the change at the bottom of the screen first." : "Type the case number, for example 1922/2016."}</p>
    <div class="findrow"><input id="q" name="q" autocomplete="off" inputmode="text" aria-describedby="q-hint" value="${esc(S.found?.query ?? "")}" ${S.pending ? "disabled" : ""}><button class="btn btn-outline" type="submit" ${S.pending ? "disabled" : ""}>Find</button></div>
    <div id="found">${S.found ? foundCard(S.found) : ""}</div>
  </form>
  ${changes.length ? `<div class="block changes"><h2>Your changes to this list</h2><ul>${changes.join("")}</ul></div>` : ""}`;
}

function nrItem(d) {
  return `<li><span class="cno">${esc(d.caseId)}</span> <span class="nr-what">${esc(purpose(d.case.nextPurpose, d.case.nextPurposeLabel))}. New date ${esc(dateShort(d.to))}.</span>
    <button type="button" class="btn btn-outline btn-small" data-stage="pin" data-id="${esc(d.caseId)}">Put on tomorrow's list</button></li>`;
}

function kindWords(k) {
  return ({ summons: "summons", notice: "notice", warrant_bailable: "bailable warrant", warrant_nonbailable: "non-bailable warrant", mediation_report: "mediation report" })[k] ?? String(k).replace(/_/g, " ");
}

function notReady() {
  return S.plan.deferred.filter((d) => /check-in/i.test(d.reason));
}

function foundCard(f) {
  if (f.error) return `<div class="card"><p>${esc(f.error)}</p></div>`;
  const P = S.plan, id = f.id;
  const L = P.listings.find((l) => l.caseId === id);
  if (L) {
    const no = P.listings.filter((l) => !l.standby).indexOf(L) + 1;
    const why = plainReasons(L, L.case);
    return `<div class="card on"><h3><span class="cno">${esc(id)}</span> is on tomorrow's list.</h3>
      <p>${L.standby ? "If time allows" : `Item ${no}, ${esc(slot(L))}`}, ${esc(purpose(L.type, L.case.nextPurposeLabel).toLowerCase())}. ${isOld(L.case) ? "An old case. " : ""}${in10(L.pSubstantive)} in 10 chance it goes ahead.</p>
      ${L.pinned ? "<p>You put it on the list.</p>" : why.length ? `<p class="why1">Why: ${esc(why.join(" "))}</p>` : ""}
      <div class="row2"><button type="button" class="btn btn-outline" data-show="${esc(id)}">Show it in the list</button>
      ${L.pinned ? `<button type="button" class="btn btn-quiet" data-stage="drop" data-id="${esc(id)}">Undo</button>` : `<button type="button" class="btn btn-outline" data-stage="drop" data-id="${esc(id)}">Take off tomorrow's list</button>`}</div></div>`;
  }
  const c = f.case;
  const desk = P.desk.find((d) => d.caseId === id), def = P.deferred.find((d) => d.caseId === id);
  let why;
  if (S.ov.drop.includes(id)) why = "You took it off tomorrow's list.";
  else if (def) why = /check-in/i.test(def.reason) ? `A party said they are not ready, so it moves to ${dateShort(def.to)}. No one needs to come tomorrow.` : `${def.reason}. It moves to ${dateShort(def.to)}.`;
  else if (desk || c.process?.state === "out") {
    const p = c.process;
    why = `The ${kindWords(p?.kind ?? desk?.kind ?? "summons")} is not back yet${p?.daysOut != null ? ` (sent ${p.daysOut} days ago)` : ""}, so no one needs to come.`;
  } else if (c.externalPending) why = "The mediation report is not in yet.";
  else if (c.nextDate && c.nextDate > S.date) why = `Its next date is ${dateShort(c.nextDate)}, so it is not due tomorrow.`;
  else why = `It is due, but the day is full. Cases more likely to go ahead came first. This one has a ${in10(c.prediction.pSubstantive)} in 10 chance.`;
  return `<div class="card off"><h3><span class="cno">${esc(id)}</span> is not on tomorrow's list.</h3>
    <p>${esc(purpose(c.nextPurpose, c.nextPurposeLabel))}. ${isOld(c) ? `An old case, filed ${esc(dateShort(c.filingDate))}. ` : ""}</p>
    <p class="why1">Why: ${esc(why)}</p>
    ${decidedButPending(c) ? `<p class="flag">Check this case: the last order reads as if it was decided, but the records still show it pending.</p>` : ""}
    <div class="row2">${S.ov.drop.includes(id) ? `<button type="button" class="btn btn-outline" data-stage="pin" data-id="${esc(id)}">Put back on tomorrow's list</button>`
      : `<button type="button" class="btn btn-outline" data-stage="pin" data-id="${esc(id)}">Put on tomorrow's list</button>`}</div></div>`;
}

/* ---------------- the check-before-you-change bar ---------------- */

function previewBar() {
  const { kind, id, rejected, error } = S.pending;
  const verb = kind === "drop" ? "Take off tomorrow's list" : "Put on tomorrow's list";
  if (error || rejected) {
    return `<div class="pb-in"><p class="pb-text"><strong>${esc(id)} cannot be ${kind === "drop" ? "taken off" : "put on"}.</strong> ${esc(rejected ?? error)}</p>
      <div class="pb-actions"><button type="button" class="btn btn-outline" id="pb-cancel">Close</button></div></div>`;
  }
  if (!S.preview) return `<div class="pb-in"><p class="pb-text">Working out what this changes...</p><div class="pb-actions"><button type="button" class="btn btn-outline" id="pb-cancel">Cancel</button></div></div>`;
  const parts = whatChanges(S.plan, S.preview);
  const cur = new Set(S.plan.listings.map((l) => l.caseId)), nxt = new Set(S.preview.listings.map((l) => l.caseId));
  const fill = S.preview.listings.filter((l) => !cur.has(l.caseId) && l.caseId !== id).length;
  const out = S.plan.listings.filter((l) => !nxt.has(l.caseId) && l.caseId !== id).length;
  if (fill) parts.push(`${fill}\u00a0other case${fill === 1 ? " comes" : "s come"} on to fill the time.`);
  if (out) parts.push(`${out}\u00a0other case${out === 1 ? " comes" : "s come"} off to make room.`);
  const sbCur = new Set(S.plan.listings.filter((l) => l.standby).map((l) => l.caseId));
  const toStandby = S.preview.listings.filter((l) => l.standby && !sbCur.has(l.caseId) && cur.has(l.caseId)).length;
  if (toStandby) parts.push(`${toStandby}\u00a0other case${toStandby === 1 ? " moves" : "s move"} to “if time allows” at the end of the day.`);
  if (approvedNow()) parts.push("You will need to approve the list again.");
  return `<div class="pb-in">
    <p class="pb-text"><strong>${kind === "drop" ? "Taking" : "Putting"} ${esc(id)} ${S.ov.drop.includes(id) ? "back on" : kind === "drop" ? "off" : "on"}.</strong> ${esc(parts.join(" "))}</p>
    <div class="pb-actions"><button type="button" class="btn btn-primary" id="pb-ok">${verb}</button><button type="button" class="btn btn-outline" id="pb-cancel">Cancel</button></div>
  </div>`;
}

async function stage(kind, id) {
  S.pending = { kind, id };
  S.preview = null;
  S.open.clear();
  render();
  const ov = nextOv(kind, id);
  try {
    const p = await planFor(ov);
    const rej = p.overrides?.rejected?.find((r) => r.caseId === id);
    if (rej) S.pending.rejected = rej.reason;
    else S.preview = p;
  } catch (e) {
    S.pending.error = `${e.message} Nothing has changed.`;
  }
  render();
  $("#pb-ok")?.focus();
}

function nextOv(kind, id) {
  const pin = S.ov.pin.filter((x) => x !== id), drop = S.ov.drop.filter((x) => x !== id);
  if (kind === "drop" && !S.ov.pin.includes(id)) drop.push(id);
  if (kind === "pin" && !S.ov.drop.includes(id)) pin.push(id);
  return { date: S.date, pin, drop };
}

function confirm() {
  const { kind, id } = S.pending;
  const wasApproved = !!approvedNow();
  const before = S.ov;
  S.ov = nextOv(kind, id);
  setOverrides(S.ov);
  S.plan = S.preview;
  S.preview = null;
  S.pending = null;
  if (S.found?.id === id) S.found = { ...S.found };
  if (wasApproved) setApproval(null);
  render();
  toast(`${esc(id)} is ${kind === "drop" ? "off" : "on"} tomorrow's list.${wasApproved ? " Approve the list again when you are ready." : ""}`, () => restore(before));
}

async function restore(ov) {
  S.ov = ov;
  setOverrides(ov);
  try {
    S.plan = await planFor(ov);
    render();
    toast("Undone. The list is as it was.");
  } catch (e) {
    toast(esc(e.message));
  }
}

async function undo(kind, id) {
  const before = S.ov;
  const ov = { date: S.date, pin: S.ov.pin.filter((x) => x !== id), drop: S.ov.drop.filter((x) => x !== id) };
  S.ov = ov;
  setOverrides(ov);
  try {
    S.plan = await planFor(ov);
    render();
    toast(`${esc(id)} is ${kind === "drop" ? "back on" : "off"} tomorrow's list, as before.`, () => restore(before));
  } catch (e) {
    toast(esc(e.message));
  }
}

/* ---------------- find ---------------- */

async function find(q) {
  const id = caseIdFrom(q);
  if (!id) {
    S.found = { query: q, error: "Type the case number with its year, for example 1922/2016." };
    return render();
  }
  const inPlan = [...S.plan.listings, ...S.plan.desk, ...S.plan.deferred].find((x) => x.caseId === id);
  try {
    const c = inPlan ? inPlan.case : await api(`case/${encodeURIComponent(id)}?date=${S.date}`);
    S.found = { query: q, id, case: c };
  } catch (e) {
    S.found = { query: q, id, error: e.status === 404 ? `There is no case ${id} in this court. Check the number and try again.` : e.message };
  }
  render();
  $("#found .card")?.focus();
}

function showInList(id) {
  S.open.add(id);
  render();
  const li = document.querySelector(`.row[data-id="${CSS.escape(id)}"]`);
  li?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
  li?.classList.add("flash");
  li?.querySelector(".line")?.focus({ preventScroll: true });
}

/* ---------------- wiring ---------------- */

function wire() {
  document.querySelectorAll(".line").forEach((b) =>
    b.addEventListener("click", () => {
      const id = b.closest(".row").dataset.id;
      S.open.has(id) ? S.open.delete(id) : S.open.add(id);
      render();
      document.querySelector(`.row[data-id="${CSS.escape(id)}"] .line`)?.focus();
    }),
  );
  document.querySelectorAll("[data-stage]").forEach((b) => b.addEventListener("click", () => stage(b.dataset.stage, b.dataset.id)));
  document.querySelectorAll("[data-undo]").forEach((b) => b.addEventListener("click", () => undo(b.dataset.undo, b.dataset.id)));
  document.querySelectorAll("[data-show]").forEach((b) => b.addEventListener("click", () => showInList(b.dataset.show)));
  $("#sure")?.addEventListener("click", () => {
    S.sure = !S.sure;
    render();
    $("#sure").focus();
  });
  $("#find")?.addEventListener("submit", (ev) => {
    ev.preventDefault();
    find($("#q").value);
  });
  $("#approve")?.addEventListener("click", approve);
  $("#unapprove")?.addEventListener("click", () => {
    const a = getApproval();
    setApproval(null);
    render();
    toast("Approval undone. The list is waiting for your decision again.", () => {
      setApproval(a);
      render();
    });
  });
  $("#print")?.addEventListener("click", () => window.print());
  $("#pb-ok")?.addEventListener("click", confirm);
  $("#pb-cancel")?.addEventListener("click", () => {
    const id = S.pending?.id;
    S.pending = null;
    S.preview = null;
    render();
    toast(`Cancelled. Nothing changed${id ? ` for ${esc(id)}` : ""}.`);
  });
}

function approve() {
  const now = new Date();
  const a = {
    date: S.date,
    key: listKey(S.plan),
    at: now.toISOString(),
    time: now.toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit", hour12: true }).replace(/\s?([ap])\.?m\.?/i, " $1m"),
  };
  setApproval(a);
  render();
  // the one orchestrated moment: the green-ink seal is pressed onto the page
  const s = document.querySelector(".stamp");
  if (s) s.classList.add("press");
  $("#print")?.focus();
}

window.addEventListener("beforeprint", () => document.querySelectorAll("details.names").forEach((d) => (d.open = true)));
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && S.pending) $("#pb-cancel")?.click();
});

boot();
