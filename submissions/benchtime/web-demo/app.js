// Benchtime pitch demo. Plain ES module, no dependencies.
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
const PRESENTER = new URLSearchParams(location.search).has("presenter");
const chan = "BroadcastChannel" in window ? new BroadcastChannel("benchtime-demo") : null;

const fmt = (x, d = 0) => (x == null || Number.isNaN(x) ? "" : Number(x).toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d }));
const pct = (x, d = 0) => fmt(x * 100, d) + "%";
const sgn = (x, d = 0) => (x > 0 ? "+" : x < 0 ? "-" : "") + fmt(Math.abs(x), d);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function sizeCanvas(c) { const r = c.getBoundingClientRect(); const dpr = Math.min(2, devicePixelRatio || 1); c.width = Math.max(1, Math.round(r.width * dpr)); c.height = Math.max(1, Math.round(r.height * dpr)); const x = c.getContext("2d"); x.setTransform(dpr, 0, 0, dpr, 0, 0); return { x, w: r.width, h: r.height }; }
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

let D = null, NOTES = null;
const scenes = $$(".scene");
const state = { i: -1, step: 0 };
const hooks = {};
const timers = new Set();
function later(fn, ms) { const t = setTimeout(() => { timers.delete(t); fn(); }, REDUCED ? 0 : ms); timers.add(t); return t; }
function clearLater() { for (const t of timers) clearTimeout(t); timers.clear(); }
let raf = 0;
function animate(dur, fn, done) { cancelAnimationFrame(raf); if (REDUCED) { fn(1); done && done(); return; } const t0 = performance.now(); const tick = (now) => { const p = Math.min(1, (now - t0) / dur); fn(p); if (p < 1) raf = requestAnimationFrame(tick); else done && done(); }; raf = requestAnimationFrame(tick); }
const ease = (p) => 1 - Math.pow(1 - p, 3);

async function load() {
  const [d, n] = await Promise.all([fetch("data.json").then((r) => r.json()), fetch("notes.json").then((r) => r.json()).catch(() => null)]);
  D = d; NOTES = n;
}

// ---------- bindings ----------
function bindings() {
  const c = D.court, H = Object.fromEntries(D.headline.rows.map((r) => [r.id, r]));
  const old = D.tournament.old, ow = old.winner.validation || old.winner, ot = old.todayValidation || old.today;
  const dial = D.dialHeldout, drow = (lab) => dial.rows.find((r) => r.label.toLowerCase().startsWith(lab));
  const proc = c.failures.reasons.find((r) => r.key === "process");
  const fails = D.guardrails.rows.filter((r) => !r.pass).length;
  const useful = drow("useful hearings"), merits = drow("cases decided"), dated = drow("cases given a date");
  const B = {
    "court.totalMinutes": fmt(c.totalMinutes), "court.totalMinutesFmt": fmt(Math.round(c.totalMinutes / 10) * 10),
    "court.overDays": fmt(c.totalMinutes / c.dayMinutes, 1), "court.processPct": pct(proc.share), "court.failTotal": fmt(c.failures.total),
    "court.expectedUseful": fmt(c.expectedUseful),
    "calib.mae": pct(D.calibration.maePSub, 1),
    "t.distinct": fmt(D.tournament.distinctGenomes), "t.genes": String(D.tournament.geneNames.filter((n) => !n.startsWith("weights.")).length + 1), "t.finalN": fmt(D.tournament.final.points.length), "t.finalSeeds": "tuning seeds " + D.tournament.final.seeds,
    "old.todayUseful": fmt(ot.useful), "old.held": pct(ow.heldOnPromised), "old.todayHeld": pct(ot.heldOnPromised),
    "old.never": fmt(ow.neverHeard), "old.todayNever": fmt(ot.neverHeard), "old.noDate": fmt(3000 - ow.casesScheduled),
    "guard.passText": `${19 - fails} of 19`,
    "focus.useful": fmt(useful.values[3][0], 1), "focus.todayUseful": fmt(useful.values[0][0], 1),
    "focus.merits": fmt(merits.values[3][0]), "focus.todayMerits": fmt(merits.values[0][0], 1), "focus.dated": fmt(dated.values[3][0]),
    "close.useful": "+" + fmt((H.useful.diff[0] / H.useful.today[0]) * 100) + "%", "close.broken": fmt(-H.broken.diff[0]),
    "close.waited": fmt(-H.waited.diff[0], 1), "close.never": "+" + fmt(H.neverHeard.diff[0]),
  };
  for (const e of $$("[data-bind]")) { const v = B[e.dataset.bind]; if (v != null) e.textContent = v; }
  $("#tw-useful").textContent = fmt(ow.useful, 1);
}

// ---------- navigation ----------
function stepsOf(i) { return +scenes[i].dataset.steps || 1; }
function applyReveal(scene, step) {
  for (const e of $$("[data-show]", scene)) {
    const s = +e.dataset.show, h = e.dataset.hide != null ? +e.dataset.hide : Infinity;
    const on = step >= s && step < h;
    e.classList.toggle("on", on); e.classList.toggle("off", !on);
  }
}
function go(i, step = 0, from = "local") {
  i = Math.max(0, Math.min(scenes.length - 1, i));
  step = Math.max(0, Math.min(stepsOf(i) - 1, step));
  const prev = state.i, changed = prev !== i;
  if (changed) { clearLater(); cancelAnimationFrame(raf); if (prev >= 0) hooks[scenes[prev].id]?.leave?.(); }
  state.i = i; state.step = step;
  scenes.forEach((s, k) => s.classList.toggle("active", k === i));
  const sc = scenes[i];
  applyReveal(sc, step);
  if (changed) hooks[sc.id]?.enter?.(step);
  hooks[sc.id]?.step?.(step);
  renderProgress();
  history.replaceState(null, "", `#${i + 1}.${step + 1}`);
  if (chan && from !== "remote") chan.postMessage({ type: "state", i, step, t: Date.now() });
  if (chan && from === "remote") chan.postMessage({ type: "state", i, step, t: Date.now() });
}
function next() { if (state.step < stepsOf(state.i) - 1) go(state.i, state.step + 1); else if (state.i < scenes.length - 1) go(state.i + 1, 0); }
function prev() { if (state.step > 0) go(state.i, state.step - 1); else if (state.i > 0) go(state.i - 1, stepsOf(state.i - 1) - 1); }

function buildProgress() {
  const nav = $("#progress");
  scenes.forEach((s, k) => {
    const b = el("button", "seg"); b.type = "button"; b.setAttribute("aria-label", `Scene ${k + 1}: ${s.dataset.title}`);
    b.style.setProperty("--w", stepsOf(k));
    b.append(el("span", "fill"), el("span", "tip", `${k + 1}. ${s.dataset.title}`));
    b.addEventListener("click", (e) => { e.stopPropagation(); go(k, 0); });
    nav.append(b);
  });
}
function renderProgress() {
  $$("#progress .seg").forEach((b, k) => {
    b.classList.toggle("done", k < state.i);
    const f = $(".fill", b);
    f.style.width = k < state.i ? "100%" : k === state.i ? `${((state.step + 1) / stepsOf(k)) * 100}%` : "0";
  });
}
function buildJump() {
  const j = $("#jump"); const inner = el("div", "jump-inner");
  inner.append(el("h2", null, "Go to a scene"));
  const ol = el("ol");
  scenes.forEach((s, k) => { const li = el("li"); const b = el("button", null, `<b>${k + 1}</b>${s.dataset.title}`); b.type = "button"; b.onclick = (e) => { e.stopPropagation(); j.classList.add("hidden"); go(k, 0); }; li.append(b); ol.append(li); });
  inner.append(ol, el("p", "keys", "Keys: arrows or space to step, 1 to 9 to jump, t for how exactly, p for the presenter view, g for this list."));
  j.append(inner); j.addEventListener("click", (e) => { if (e.target === j) j.classList.add("hidden"); });
}
function toggleTech(force) {
  const on = force ?? !document.body.classList.contains("tech-on");
  document.body.classList.toggle("tech-on", on); $("#techbtn").setAttribute("aria-pressed", String(on));
}
let presenterWin = null;
function openPresenter() {
  presenterWin = window.open(location.pathname + "?presenter=1" + location.hash, "benchtime-presenter", "width=1100,height=760");
  if (!presenterWin) alert("The browser blocked the presenter window. Allow pop-ups for this page and press p again.");
}
function wireInput() {
  document.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key;
    if (["ArrowRight", "ArrowDown", "PageDown", " ", "Enter"].includes(k)) { e.preventDefault(); next(); }
    else if (["ArrowLeft", "ArrowUp", "PageUp", "Backspace"].includes(k)) { e.preventDefault(); prev(); }
    else if (/^[0-9]$/.test(k)) go(k === "0" ? 9 : +k - 1, 0);
    else if (k === "Home") go(0, 0);
    else if (k === "End") go(scenes.length - 1, 0);
    else if (k === "t" || k === "T") toggleTech();
    else if (k === "p" || k === "P") openPresenter();
    else if (k === "g" || k === "G") $("#jump").classList.toggle("hidden");
    else if (k === "Escape") { $("#jump").classList.add("hidden"); toggleTech(false); }
  });
  document.addEventListener("click", (e) => {
    if (e.target.closest("button, a, iframe, input, .tech, #jump, .aim-list, .axis-switch, .console-frame, .gene-cells, .gene-info")) return;
    if (e.button !== 0) return;
    next();
  });
  let acc = 0, lock = 0;
  window.addEventListener("wheel", (e) => {
    const now = performance.now(); if (now < lock) return;
    acc += e.deltaY; if (Math.abs(acc) > 70) { acc > 0 ? next() : prev(); acc = 0; lock = now + 850; }
  }, { passive: true });
  $("#techbtn").addEventListener("click", (e) => { e.stopPropagation(); toggleTech(); });
  let rz = 0; window.addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(() => { hooks[scenes[state.i].id]?.resize?.(state.step); }, 150); });
  if (chan) chan.onmessage = (m) => {
    const d = m.data; if (!d) return;
    if (d.type === "cmd") { if (d.cmd === "next") next(); else if (d.cmd === "prev") prev(); else if (d.cmd === "go") go(d.i, d.step ?? 0); else if (d.cmd === "tech") toggleTech(); }
    if (d.type === "hello") chan.postMessage({ type: "state", i: state.i, step: state.step, t: Date.now() });
  };
}


// ---------- scene 0: how I approached this ----------
const ROLES = ["Simulator builder", "Calibrator", "Redesign team A", "Redesign team B", "Redesign team C", "Redesign team D", "Redesign team E", "Redesign team F", "Redesign team G", "Redesign team H", "Tournament runner", "Reviewer, a magistrate's eye", "Reviewer, PUCAR's scorecards", "Reviewer, loopholes", "Reviewer, statistics", "Held-out experiments", "Console designer A", "Console designer B", "Console designer C", "Magistrate and court-master usability tester", "Judge-rules engineer", "DRISTI integrator", "Writer", "Fact-checker"];
hooks["s-approach"] = {
  built: false,
  build() {
    const host = $("#crowd"); host.innerHTML = "";
    const R = rng(67), slots = Array.from({ length: 67 }, (_, k) => k);
    for (let k = slots.length - 1; k > 0; k--) { const j = Math.floor(R() * (k + 1)); [slots[k], slots[j]] = [slots[j], slots[k]]; }
    const named = new Map(ROLES.map((r, k) => [slots[k], r]));
    for (let k = 0; k < 67; k++) {
      const role = named.get(k); const d = el("div", "agent" + (role ? " named" : "") + (role && role.startsWith("Reviewer") ? " reviewer" : ""), role || "");
      d.style.transitionDelay = `${(k % 12) * 0.03 + Math.floor(k / 12) * 0.08}s`; host.append(d);
    }
    const lc = $("#lesson-cards"); lc.innerHTML = "";
    const lens = ["A magistrate's eye", "PUCAR's scorecards", "Loopholes", "Statistics"], stamps = ["Would not sign", "Unguarded", "Loophole", "Inside the noise"];
    lens.forEach((l, k) => { const d = el("div", "rv"); d.append(el("h4", null, "Reviewer"), el("p", null, l), el("span", "stamp", stamps[k])); lc.append(d); });
    this.built = true;
  },
  enter() { if (!this.built) this.build(); },
  step(k) {
    const agents = $$("#crowd .agent");
    agents.forEach((a) => a.classList.toggle("in", k === 1));
    $(".counters").classList.toggle("dim", k >= 3);
    const nums = $$(".counters [data-count]");
    if (k === 2) {
      animate(1800, (p) => { for (const n of nums) { const v = +n.dataset.count * ease(p); n.innerHTML = (n.dataset.prefix ? `<small>${n.dataset.prefix}</small>` : "") + fmt(v); } });
    } else if (k > 2) for (const n of nums) n.innerHTML = (n.dataset.prefix ? `<small>${n.dataset.prefix}</small>` : "") + fmt(+n.dataset.count);
    $$("#lesson-cards .rv").forEach((c) => c.classList.toggle("shown", k === 4));
  },
};

// ---------- scene 1: the court ----------
const SHORT_TYPE = { EVIDENCE_COMPLAINANT: "Evidence", EVIDENCE_ACCUSED: "Evidence", ARGUMENTS: "Arguments", JUDGEMENT: "Judgment", EXAMINATION_UNDER_S351_BNSS: "Examination" };
const EV_TYPES = new Set(["EVIDENCE_COMPLAINANT", "EVIDENCE_ACCUSED", "ARGUMENTS", "JUDGEMENT", "EXAMINATION_UNDER_S351_BNSS"]);
const WAR_TYPES = new Set(["WARRANT", "APPEARANCE", "REPORTS"]);
hooks["s-court"] = {
  built: false,
  build() {
    const host = $("#causelist"); host.innerHTML = "";
    const day = D.court.dayMinutes, rows = [];
    let r = 0, used = 0;
    const list = D.court.causelist;
    // deterministic "would move the case" marks, as many as PUCAR's rates predict for this list
    const R = rng(22), score = list.map((m, k) => ({ k, s: Math.pow(R(), 1 / Math.max(0.01, m.pSub)) }));
    const nUseful = Math.round(D.court.expectedUseful);
    const useful = new Set(score.sort((a, b) => b.s - a.s).slice(0, nUseful).map((o) => o.k));
    list.forEach((m, k) => {
      if (used + m.minutes > day + 0.01) { r++; used = 0; }
      (rows[r] ||= []).push({ m, k, left: used });
      used += m.minutes;
    });
    rows.forEach((items, ri) => {
      const row = el("div", "cl-row" + (ri === 0 ? " day" : ""));
      row.append(el("span", "row-lab", ri === 0 ? "the day" : ri === 1 ? "beyond the day" : ""));
      for (const { m, k, left } of items) {
        const b = el("div", "cl-block" + (ri > 0 ? " over" : "") + (EV_TYPES.has(m.type) ? " t-ev" : WAR_TYPES.has(m.type) ? " t-war" : ""));
        b.style.left = (left / day) * 100 + "%"; b.style.width = `calc(${(m.minutes / day) * 100}% - 2px)`;
        b.title = `${m.case}, ${m.label}, ${m.minutes} min`;
        if (m.minutes >= 30) b.textContent = SHORT_TYPE[m.type] || m.label;
        b.dataset.k = k; b.dataset.useful = useful.has(k) ? "1" : "0"; b.dataset.row = ri;
        row.append(b);
      }
      host.append(row);
    });
    const rs = $("#reasons"); rs.innerHTML = "";
    const max = D.court.failures.reasons[0].share;
    for (const r0 of D.court.failures.reasons.filter((x) => x.share >= 0.02)) {
      const row = el("div", "rs-row");
      row.append(el("span", null, r0.label));
      const tr = el("div"); const bar = el("div", "rs-bar"); bar.style.width = (r0.share / max) * 100 + "%"; tr.append(bar); row.append(tr);
      row.append(el("span", "pct", pct(r0.share))); rs.append(row);
    }
    this.built = true;
  },
  enter() { if (!this.built) this.build(); },
  step(k) {
    const blocks = $$("#causelist .cl-block"), wrap = $(".causelist-wrap");
    wrap.classList.toggle("compact", k >= 2);
    if (k >= 1) {
      blocks.forEach((b, n) => { if (!b.classList.contains("in")) later(() => b.classList.add("in"), 12 * n); });
    } else blocks.forEach((b) => b.classList.remove("in"));
    blocks.forEach((b) => { b.classList.toggle("useful", k >= 2 && b.dataset.useful === "1"); b.classList.toggle("fail", k >= 2 && b.dataset.useful !== "1"); });
    const lab = $(".cl-over-label");
    lab.innerHTML = k >= 2 ? `On PUCAR's rates, about <b class="g">${fmt(D.court.expectedUseful)}</b> of the 90 would move the case (green)` : `The list holds <b>${fmt(D.court.totalMinutes / D.court.dayMinutes, 1)}</b> days of work`;
    $$("#reasons .rs-bar").forEach((b, n) => { b.classList.remove("in"); if (k === 2) later(() => b.classList.add("in"), 300 + 120 * n); });
  },
};

// ---------- scene 2: how we test ----------
hooks["s-test"] = {
  built: false,
  build() {
    const rows = D.calibration.rows.slice().sort((a, b) => b.target - a.target);
    const W = 900, rowH = 30, top = 40, H = top + rows.length * rowH + 34, L = 250, R = 40;
    const x = (v) => L + v * (W - L - R);
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="PUCAR's chance of a useful hearing by type, against the simulated court">`;
    for (const v of [0, 0.25, 0.5, 0.75, 1]) s += `<line x1="${x(v)}" x2="${x(v)}" y1="${top - 8}" y2="${H - 26}" stroke="#DCD6C8"/><text x="${x(v)}" y="${H - 8}" text-anchor="middle" font-size="13" fill="#6F6B62" font-family="Public Sans">${v * 100}%</text>`;
    rows.forEach((r, k) => {
      const y = top + k * rowH + rowH / 2, est = r.judged === "estimated";
      s += `<text x="${L - 14}" y="${y + 5}" text-anchor="end" font-size="15" fill="${est ? "#9C988E" : "#17171A"}" font-family="Public Sans">${r.label}${est ? " (estimate)" : ""}</text>`;
      s += `<circle cx="${x(r.target)}" cy="${y}" r="9" fill="none" stroke="#1B3F8F" stroke-width="2.5"/>`;
      s += `<circle class="sim" cx="${x(r.simulated)}" cy="${y}" r="5" fill="#0E6B4D"/>`;
    });
    s += `<g font-family="Public Sans" font-size="14"><circle cx="${L}" cy="12" r="7" fill="none" stroke="#1B3F8F" stroke-width="2.5"/><text x="${L + 14}" y="17" fill="#17171A">PUCAR's records</text><circle cx="${L + 170}" cy="12" r="5" fill="#0E6B4D"/><text x="${L + 182}" y="17" fill="#17171A">our simulated court</text></g></svg>`;
    $("#calib").innerHTML = s;
    this.built = true;
  },
  enter() { if (!this.built) this.build(); },
  step(k) { if (k === 2) this.runDay(); else cancelAnimationFrame(raf); },
  resize(k) { if (k === 2) this.runDay(true); },
  runDay(instant) {
    const c = $("#daycanvas"); const { x, w, h } = sizeCanvas(c);
    const list = D.court.causelist, reasons = D.court.failures.reasons;
    const target = Math.round(D.headline.rows.find((r) => r.id === "useful").today[0]);
    // one seeded draw with PUCAR's rates; we keep the first seed whose day matches today's simulated average
    const drawDay = (seed) => {
      const R = rng(seed);
      const pick = () => { let u = R(), acc = 0; for (const r of reasons) { acc += r.share; if (u <= acc) return r.key; } return "unclear"; };
      let clock = 0; const out = [];
      for (const m of list) {
        if (clock >= D.court.dayMinutes) { out.push({ kind: "unreached" }); continue; }
        const ok = R() < m.pSub; const kind = ok ? "moved" : pick();
        clock += ok ? m.minutes : Math.min(3, m.minutes); out.push({ kind, at: clock });
      }
      return out;
    };
    let out = drawDay(1);
    for (let seed = 1; seed < 400; seed++) { const o = drawDay(seed); if (o.filter((x) => x.kind === "moved").length === target) { out = o; break; } }
    const cols = 15, rows = Math.ceil(list.length / cols);
    const pad = 8, gridW = w, cellW = (gridW - pad * (cols - 1)) / cols, barH = 26, gridH = h - barH - 64;
    const cellH = Math.min(cellW * 0.62, (gridH - pad * (rows - 1)) / rows);
    const col = { moved: css("--green"), process: css("--red"), absent: "#D2877F", unreached: "#E7E2D6" };
    const tally = { moved: 0, adj: 0, proc: 0, abs: 0 };
    const draw = (n, tmin) => {
      x.clearRect(0, 0, w, h);
      tally.moved = tally.adj = tally.proc = tally.abs = 0;
      list.forEach((m, k) => {
        const cx = (k % cols) * (cellW + pad), cy = Math.floor(k / cols) * (cellH + pad);
        const o = out[k]; let f = "#F3F0E7", stroke = "#CFC8B8";
        if (k < n) {
          if (o.kind === "moved") { f = col.moved; stroke = f; tally.moved++; }
          else if (o.kind === "process") { f = col.process; stroke = f; tally.proc++; }
          else if (o.kind === "absent") { f = col.absent; stroke = f; tally.abs++; }
          else if (o.kind === "unreached") { f = "#FBF9F4"; stroke = "#E2DCCF"; }
          else { f = "#B9B3A5"; stroke = f; tally.adj++; }
        }
        x.fillStyle = f; x.strokeStyle = stroke; x.lineWidth = 1.2;
        x.beginPath(); x.roundRect(cx + 0.5, cy + 0.5, cellW - 1, cellH - 1, 3); x.fill(); x.stroke();
        if (k === n - 1 && n < list.length) { x.strokeStyle = css("--blue"); x.lineWidth = 3; x.stroke(); }
        if (k < n && o.kind === "unreached") { x.fillStyle = "#B7B0A2"; x.font = "11px Public Sans"; x.fillText("not reached", cx + 6, cy + cellH / 2 + 4); }
      });
      const by = h - barH - 18;
      x.fillStyle = "#EAE5D9"; x.fillRect(0, by, w, barH);
      x.fillStyle = css("--green"); x.fillRect(0, by, (Math.min(tmin, 420) / 420) * w, barH);
      x.fillStyle = "#17171A"; x.font = "600 15px Public Sans";
      x.fillText(`The bench has used ${Math.round(Math.min(tmin, 420))} of its 420 minutes`, 0, by - 10);
      $("#t-moved").textContent = tally.moved; $("#t-adj").textContent = tally.adj; $("#t-proc").textContent = tally.proc; $("#t-abs").textContent = tally.abs;
    };
    const reachedN = out.findIndex((o) => o.kind === "unreached");
    const N = list.length;
    if (instant || REDUCED) { draw(N, 420); return; }
    animate(7000, (p) => {
      const n = Math.round(p * N);
      const last = out[Math.min(n, reachedN < 0 ? N : reachedN) - 1];
      draw(n, last && last.at ? last.at : n >= reachedN ? 420 : 0);
    });
  },
  leave() { cancelAnimationFrame(raf); },
};

// ---------- scene 3: tournament ----------
const GENE_INFO = {
  selection: "how the day's list is chosen from the ready cases (index means one priority number per case)",
  firstDates: "how every case gets its first date at the start of the quarter",
  nextDate: "how a next date is given after a hearing",
  coverage: "extra cover for cases over 4 years old, on top of the minutes floor",
  callOrder: "the order in which the day's list is called",
  calibration: "whether the planner corrects PUCAR's odds against what this court records",
  caseEstimate: "the chance of a useful hearing comes from the case's own record, not only its hearing type",
  priorCheck: "PUCAR's estimated odds are checked against PUCAR's own hearing counts",
  desk: "matters whose summons is not back are handled at the desk, so nobody travels",
  checkin: "advocates answer ready or not ready the evening before",
  checkinRobust: "a case can be released by a not-ready answer only once in a row",
  cluster: "next dates prefer a day when the same advocate is already coming",
  callTimes: "each listing carries a fixed call time",
  fillTarget: "expected minutes listed, as a share of the day",
  standbyShare: "the standby list, as a share of the day",
  promiseFill: "how full a day may be booked when giving dates, as a share of the day",
  initialFill: "how full the first dates fill each day, leaving room for returns",
  firstOldShare: "share of each first-date day offered first to cases over 4 years old",
  "weights.throughput": "how much the planner values hearings that move a case",
  "weights.disposal": "how much the planner values finishing cases",
  "weights.fairness": "how much the planner values old cases",
  "weights.trips": "how much the planner avoids wasted trips to court",
  "weights.predictability": "how much the planner values keeping promised dates",
  ageExponent: "how steeply a case's value rises with its age",
  ageingFloor: "share of the day's minutes offered first to cases over 4 years old (never below 15%)",
  enforceFloor: "whether the 15% floor for old cases applies (off only in presets that copy a floorless way)",
  windowDays: "working days after PUCAR's gap searched for a day with room",
  relistDays: "days before a failed or released matter comes back",
  relistCap: "how full a day relisted matters may book",
  quickRelist: "failed, released and unheard matters come back early",
  gapOfHeard: "the gap follows the purpose just heard, not the next one",
  countDiary: "the diary counts matters instead of expected minutes",
  countCap: "the most matters a day when the diary counts matters",
  pendingHold: "share of its minutes a case waiting on process holds on its date",
  returnMargin: "how far out a case waiting on process is dated, as a multiple of the expected wait",
  recheckDays: "days between desk re-checks of an overdue process or report",
  rotationDays: "every case over 4 years old comes before the bench at least once in this many working days",
  rotationCap: "the most of the day that rotation calls may take",
  reviewDays: "desk and released matters unseen this long compete for a short review call (0 is off)",
  mentionAfter: "desk visits a never-heard old case has before a 2-minute mention",
  portfolioOld: "share of the day reserved for old cases never heard",
  blocks: "Sehgal's time blocks for fresh and old matters",
  purposeDays: "Dimakar's weekday themes by purpose",
  carryForward: "a matter not reached returns on the same weekday next week",
  rotationAll: "the rotation covers every case, not only old ones",
};
const geneVal = (v) => (typeof v === "number" ? (Math.abs(v) < 2 && v % 1 ? fmt(v, 2) : fmt(v, v % 1 ? 2 : 0)) : typeof v === "boolean" ? (v ? "on" : "off") : String(v));
function halo(x, text, px, py, color) { const cw = x.canvas.getBoundingClientRect().width, tw = x.measureText(text).width; if (x.textAlign === "left" || x.textAlign === "start") { if (px + tw > cw - 4) px = Math.max(2, px - tw - 20); if (px < 2) px = 2; } x.save(); x.lineWidth = 5; x.strokeStyle = "rgba(251,249,244,.92)"; x.lineJoin = "round"; x.strokeText(text, px, py); x.fillStyle = color; x.fillText(text, px, py); x.restore(); }
const GENE_PALETTE = ["#1B3F8F", "#0E6B4D", "#A86B12", "#7A3E8F", "#B3261E", "#2F7F96", "#5B6B2E", "#8C5A3C"];
hooks["s-tournament"] = {
  built: false, axis: "honoured", drawnGen: -1,
  build() {
    const T = D.tournament, names = T.geneNames, G = T.genomes;
    const host = $("#genes"); host.innerHTML = "";
    const cats = {}; for (const n of names) { const vals = [...new Set(G.map((g) => String(g.genes[n])))]; cats[n] = vals; }
    const nums = {}; for (const n of names) { const vs = G.map((g) => g.genes[n]).filter((v) => typeof v === "number"); if (vs.length) nums[n] = [Math.min(...vs), Math.max(...vs)]; }
    const order = [0, 1, 2, 3, 4, 5];
    for (const gi of order) {
      const g = G[gi]; const row = el("div", "gene-row" + (gi === 5 ? " ours" : ""));
      const nm = g.name.replace(" (an operations-research rule)", "");
      row.append(el("div", "gene-name", nm + (gi === 4 ? "<small>an operations-research rule</small>" : gi === 5 ? "<small>the tournament's pick</small>" : gi === 0 ? "<small>every due case, then a flat 60-day gap</small>" : "<small>a judge's way, as the brief describes it</small>")));
      const cells = el("div", "gene-cells");
      names.forEach((n, ni) => {
        const v = g.genes[n]; const i = el("i"); let bg;
        if (typeof v === "boolean") bg = v ? "#17171A" : "#E7E2D6";
        else if (typeof v === "number") { const [a, b] = nums[n]; const t = b > a ? (v - a) / (b - a) : 0.5; bg = `color-mix(in oklab, #1B3F8F ${Math.round(15 + t * 85)}%, #F3F0E7)`; }
        else { const idx = cats[n].indexOf(String(v)); bg = GENE_PALETTE[(idx + ni) % GENE_PALETTE.length]; }
        i.style.background = bg; i.dataset.gene = n; i.dataset.g = gi; i.tabIndex = -1; cells.append(i);
      });
      row.append(cells); row.style.transitionDelay = `${gi * 0.12}s`; host.append(row);
    }
    const ax = el("div", "gene-axis"); ax.append(el("span", null, ""), el("span", null, `<span>which cases, and how full a day</span><span>what the planner values</span><span>next dates, relisting and old cases</span>`));
    host.append(ax);
    const infoLine = el("div", "gene-info", "Point at or click any cell to read what that gene does.");
    host.append(infoLine);
    const show = (cell, pin) => {
      const n = cell.dataset.gene, g = G[+cell.dataset.g], win = G[5];
      $$(".gene-cells i.hl", host).forEach((c) => c.classList.remove("hl"));
      $$(`.gene-cells i[data-gene="${CSS.escape(n)}"]`, host).forEach((c) => c.classList.add("hl"));
      const txt = GENE_INFO[n] || "a design choice"; const same = g === win;
      infoLine.innerHTML = `<b>${n}</b>. ${txt[0].toUpperCase() + txt.slice(1)}. <span>${same ? "" : `${g.name.replace(" (an operations-research rule)", "")} sets it to <b>${geneVal(g.genes[n])}</b>. `}Our pick sets it to <b>${geneVal(win.genes[n])}</b>.</span>`;
      if (pin) this.pinned = n;
    };
    host.addEventListener("mouseover", (e) => { const c = e.target.closest(".gene-cells i"); if (c) show(c, false); });
    host.addEventListener("click", (e) => { const c = e.target.closest(".gene-cells i"); if (c) { e.stopPropagation(); show(c, true); } });
    host.append(el("p", "source", `Each schedule has ${names.filter((n) => !n.startsWith("weights.")).length + 1} genes, and each colour or shade is one setting. The weights gene has five parts, so it shows as five cells. The presets come from out/tournament/candidates.jsonl and the pick from out/tournament/winner.json. The explanations come from src/planner/zoo/genome.ts.`));
    for (const b of $$(".axis-switch .chip")) b.addEventListener("click", (e) => { e.stopPropagation(); this.axis = b.dataset.axis; $$(".axis-switch .chip").forEach((c) => c.classList.toggle("on", c === b)); this.draw(this.curGen ?? 12, 1, state.step >= 2); });
    this.built = true;
  },
  enter() { if (!this.built) this.build(); },
  step(k) {
    if (k === 0) { cancelAnimationFrame(raf); return; }
    if (k === 1) this.play();
    if (k === 2) { cancelAnimationFrame(raf); this.draw(12, 1, true); }
  },
  resize(k) { if (k >= 1) this.draw(this.curGen ?? 12, 1, k >= 2); },
  play() {
    const G = D.tournament.final.generations;
    animate(REDUCED ? 0 : 6500, (p) => { const g = p * (G + 1); this.draw(Math.min(G, Math.floor(g)), g - Math.floor(g), false); });
  },
  draw(gen, frac, showPick) {
    this.curGen = gen;
    const F = D.tournament.final, c = $("#arena"); const { x, w, h } = sizeCanvas(c);
    const ax = this.axis, cols = F.cols, iy = cols.indexOf("useful"), ix = cols.indexOf(ax), ig = cols.indexOf("gen");
    const L = 78, Rm = 24, T = 24, B = 64;
    const X = ax === "neverHeard" ? { lo: 0, hi: 2000, rev: false } : { lo: 0.4, hi: 1.0, rev: false };
    const Y = { lo: 8, hi: 26 };
    const px = (v) => L + ((Math.max(X.lo, Math.min(X.hi, v)) - X.lo) / (X.hi - X.lo)) * (w - L - Rm);
    const py = (v) => h - B - ((Math.max(Y.lo, Math.min(Y.hi, v)) - Y.lo) / (Y.hi - Y.lo)) * (h - T - B);
    x.clearRect(0, 0, w, h);
    x.font = "13px Public Sans"; x.fillStyle = "#6F6B62"; x.strokeStyle = "#E4DFD3"; x.lineWidth = 1;
    for (let v = 8; v <= 24; v += 4) { const y = py(v); x.beginPath(); x.moveTo(L, y); x.lineTo(w - Rm, y); x.stroke(); x.textAlign = "right"; x.fillText(String(v), L - 10, y + 4); }
    const xt = ax === "neverHeard" ? [0, 500, 1000, 1500, 2000] : [0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
    x.textAlign = "center";
    for (const v of xt) { const X0 = px(v); x.beginPath(); x.moveTo(X0, T); x.lineTo(X0, h - B); x.stroke(); x.fillText(ax === "neverHeard" ? fmt(v) + (v === 2000 ? "+" : "") : (v === 0.4 ? "40% or less" : pct(v)), X0, h - B + 22); }
    x.fillStyle = "#17171A"; x.font = "600 15px Public Sans";
    x.fillText(ax === "neverHeard" ? "Cases never heard in the quarter (fewer is better)" : "Dates honoured (more is better)", L + (w - L - Rm) / 2, h - 14);
    x.save(); x.translate(20, T + (h - T - B) / 2); x.rotate(-Math.PI / 2); x.fillText("Useful hearings a day", 0, 0); x.restore();
    // points
    for (const p of F.points) {
      const g = p[ig]; if (g > gen) continue;
      const a = g < gen ? 0.32 : 0.32 + 0.5 * (1 - frac);
      x.fillStyle = g === gen && frac < 1 ? `rgba(27,63,143,${Math.min(0.9, a + 0.2)})` : `rgba(27,63,143,${showPick ? 0.18 : 0.3})`;
      x.beginPath(); x.arc(px(p[ix]), py(p[iy]), g === gen ? 3.6 : 3, 0, Math.PI * 2); x.fill();
    }
    // frontier of the schedules shown so far: nobody has both more useful hearings and a better x
    const better = ax === "neverHeard" ? (a, b) => a < b : (a, b) => a > b;
    const shown = F.points.filter((p) => p[ig] <= gen).slice().sort((a, b) => (better(a[ix], b[ix]) ? -1 : better(b[ix], a[ix]) ? 1 : b[iy] - a[iy]));
    const front = []; let bestY = -Infinity;
    for (const p of shown) { if (p[iy] > bestY) { front.push(p); bestY = p[iy]; } }
    if (front.length > 1) {
      x.strokeStyle = css("--blue"); x.lineWidth = 2.5; x.setLineDash([]); x.beginPath();
      front.forEach((p, k) => { const X0 = px(p[ix]), Y0 = py(p[iy]); if (k === 0) x.moveTo(X0, Y0); else { x.lineTo(X0, py(front[k - 1][iy])); x.lineTo(X0, Y0); } });
      x.stroke();
      const lp = front[Math.min(front.length - 1, Math.floor(front.length * 0.5))];
      x.font = "600 14px Public Sans"; x.textAlign = "left"; halo(x, "the best trade-offs found so far", px(lp[ix]) + 8, Math.max(T + 34, py(lp[iy]) - 10), css("--blue"));
    }
    // named rivals
    x.font = "13px Public Sans"; x.textAlign = "left";
    const named = F.named || {};
    const labelOf = { sehgal: "Sehgal as coded", dimakar: "Dimakar as coded", joshi: "Joshi as coded", bin_packing: "bin packing", oldest_first: "oldest first", fifo_capped: "first come first served" };
    for (const [id, r] of Object.entries(named)) {
      if (!labelOf[id]) continue; const vx = r[ax]; if (vx == null) continue;
      const X0 = px(vx), Y0 = py(r.useful);
      x.strokeStyle = "#6F6B62"; x.lineWidth = 1.5; x.beginPath(); x.arc(X0, Y0, 5, 0, Math.PI * 2); x.stroke();
      const dy = id === "oldest_first" ? -8 : id === "fifo_capped" ? 14 : 4;
      halo(x, labelOf[id] + (ax === "honoured" && vx < 0.4 ? ` (${pct(vx)})` : ""), X0 + 9, Y0 + dy, "#4A4843");
    }
    // today
    const t = F.today, tx = px(t[ax]), ty = py(t.useful);
    x.fillStyle = "#17171A"; x.fillRect(tx - 7, ty - 7, 14, 14);
    x.font = "600 15px Public Sans"; halo(x, "today's way", tx + 12, ty + 24, "#17171A");
    // pick
    if (showPick) {
      const wv = F.winner, wx = px(wv[ax]), wy = py(wv.useful);
      x.strokeStyle = css("--green"); x.lineWidth = 3; x.beginPath(); x.arc(wx, wy, 13, 0, Math.PI * 2); x.stroke();
      x.fillStyle = css("--green"); x.beginPath(); x.arc(wx, wy, 5.5, 0, Math.PI * 2); x.fill();
      x.font = "600 18px Literata"; halo(x, "the pick, g237", wx + 18, wy - 14, css("--green"));
      x.font = "14px Public Sans";
      halo(x, ax === "neverHeard" ? "Up is more useful hearings. Left is fewer cases left unheard." : "Up is more useful hearings. Right is more dates kept.", L + 12, T + 16, "#4A4843");
    }
    $("#gen-n").textContent = String(gen);
    const n = F.points.filter((p) => p[ig] <= gen).length;
    $("#gen-count").textContent = `${fmt(n)} schedules so far. They are the ones run under the final rule, on tuning seeds ${F.seeds}.`;
  },
};

// ---------- scene 4: the twist ----------
const GUARD_PLAIN = {
  "every case given a date inside the quarter": "Every case gets a date inside the quarter",
  "dates honoured (heard or desk order on the day)": "Dates honoured, heard or ordered on the day",
  "cases never acted on": "Cases never acted on",
  "cases never heard": "Cases never heard",
  "4y+ heard at all (README)": "Cases over 4 years old heard at all",
  "every 4y+ case heard at least once (README score)": "Every case over 4 years old heard once",
  "4y+ moved on": "Cases over 4 years old moved forward",
  "4y+ still pending at the end": "Cases over 4 years old still pending",
  "disposals on the merits (verdict + settlement + compounded)": "Cases decided on the merits",
  "next-date excess over PUCAR's gap": "Next dates beyond PUCAR's gap",
  "days that ran late": "Days that ran late",
  "court time used": "Court time used",
  "reach rate": "Listed matters reached",
  "substantiveness": "Share of hearings that move a case",
  "trips per useful hearing": "Trips to court per useful hearing",
  "wasted listings": "Listings that achieve nothing",
  "minutes waited": "Minutes waited",
  "load balance across days": "Even load across days",
  "useful hearings a day at least today's": "Useful hearings a day",
};
const plainGuard = (l) => GUARD_PLAIN[l] || l.replace(/\(README[^)]*\)/g, "").trim();
hooks["s-twist"] = {
  built: false,
  build() {
    const stamps = ["Would not sign", "Unguarded", "Loophole", "Inside the noise"];
    const QUOTES = { "A magistrate's eye": "I would not sign lists made by the winner of the 10-guardrail rule. Roughly 1,340 cases that already have dates in their order sheets were quietly moved to January, without being called and without any order." };
    const host = $("#reviewers"); host.innerHTML = "";
    D.reviews.forEach((r, k) => { const d = el("div", "rv"); d.append(el("h4", null, r.lens), el("p", null, '"' + (QUOTES[r.lens] || r.finding) + '"'), el("span", "stamp", stamps[k] || "Review")); host.append(d); });
    const g = $("#guardgrid"); g.innerHTML = "";
    D.guardrails.rows.forEach((r) => { const d = el("div", "gr " + (r.pass ? "pass" : "fail")); d.append(el("span", "box", r.pass ? "&#10003;" : "&#10007;"), el("span", null, plainGuard(r.label))); g.append(d); });
    const fails = D.guardrails.rows.filter((r) => !r.pass);
    $("#guard-verdict").innerHTML = `On the final test, seeds 31-60, <b>${19 - fails.length} of 19 hold</b>. We report the one that fails, ${fails.map((f) => plainGuard(f.label).toLowerCase()).join(" and ")}, and the pick stands.`;
    this.built = true;
  },
  enter() { if (!this.built) this.build(); },
  step(k) {
    const ow = D.tournament.old.winner.validation || D.tournament.old.winner, ot = D.tournament.old.todayValidation || D.tournament.old.today;
    $("#tw-useful").textContent = fmt(ow.useful, 1);
    if (k <= 1) this.twistChart(k); else if (k === 3) this.park(); else cancelAnimationFrame(raf);
    const grs = $$("#guardgrid .gr"); grs.forEach((g) => g.classList.remove("lit"));
    if (k === 4) grs.forEach((g, n) => later(() => g.classList.add("lit"), 250 + n * 110));
  },
  resize(k) { if (k === 3) this.park(true); if (k <= 1) this.twistChart(k, true); },
  twistChart(k, instant) {
    const O = D.tournament.old, c = $("#twistcanvas"); const { x, w, h } = sizeCanvas(c);
    const t = O.todayValidation || O.today, wv = O.winner.validation || O.winner;
    const chartW = w * 0.64, L = 70, T = 40, B = 64, Rm = 20;
    const X = [12, 28], Y = [0.5, 1.0];
    const px = (v) => L + ((v - X[0]) / (X[1] - X[0])) * (chartW - L - Rm);
    const py = (v) => h - B - ((Math.max(Y[0], Math.min(Y[1], v)) - Y[0]) / (Y[1] - Y[0])) * (h - T - B);
    const pileX = chartW + 30, pileW = w - pileX, cell = Math.max(6, Math.min(11, (pileW / 2 - 30) / 10 - 2)), gap = 2;
    const tSq = Math.round(t.neverHeard / 10), wSq = Math.round(wv.neverHeard / 10);
    const draw = (p, q) => {
      x.clearRect(0, 0, w, h);
      x.font = "13px Public Sans"; x.strokeStyle = "#2A2E34"; x.lineWidth = 1; x.fillStyle = "#9C988E";
      for (const v of [0.5, 0.6, 0.7, 0.8, 0.9, 1.0]) { const y = py(v); x.beginPath(); x.moveTo(L, y); x.lineTo(chartW - Rm, y); x.stroke(); x.textAlign = "right"; x.fillText(pct(v), L - 10, y + 4); }
      x.textAlign = "center"; for (const v of [12, 16, 20, 24, 28]) { const X0 = px(v); x.beginPath(); x.moveTo(X0, T); x.lineTo(X0, h - B); x.stroke(); x.fillText(String(v), X0, h - B + 20); }
      x.fillStyle = "#EEEBE3"; x.font = "600 15px Public Sans";
      x.fillText("Useful hearings a day", L + (chartW - L - Rm) / 2, h - 16);
      x.save(); x.translate(18, T + (h - T - B) / 2); x.rotate(-Math.PI / 2); x.fillText("Dates kept", 0, 0); x.restore();
      // today
      const tx = px(t.useful), ty = py(t.heldOnPromised);
      x.fillStyle = "#EEEBE3"; x.fillRect(tx - 7, ty - 7, 14, 14);
      x.font = "600 15px Public Sans"; x.textAlign = "left"; x.fillText("today's way", tx - 40, ty + 30);
      // winner: flies in (p), then slides down to its real share of dates kept (q)
      const wx = px(X[0] + (wv.useful - X[0]) * p), wyTop = py(1.0), wyReal = py(wv.heldOnPromised), wy = wyTop + (wyReal - wyTop) * q;
      if (p > 0) {
        if (q > 0) { x.strokeStyle = "rgba(240,122,110,.6)"; x.setLineDash([5, 5]); x.beginPath(); x.moveTo(wx, wyTop); x.lineTo(wx, wy); x.stroke(); x.setLineDash([]); }
        x.fillStyle = q > 0 ? "#F07A6E" : "#FFFFFF"; x.beginPath(); x.arc(wx, wy, 11, 0, Math.PI * 2); x.fill();
        x.font = "600 17px Literata"; x.textAlign = "right"; x.fillStyle = q > 0 ? "#F07A6E" : "#FFFFFF";
        x.fillText("the first winner, g921", wx - 20, wy + 6);
        x.font = "14px Public Sans"; x.fillStyle = "#9C988E";
        x.fillText(q > 0 ? `${pct(wv.heldOnPromised * 1)} of its dates kept` : "the first rule never checked its dates", wx - 20, wy + 28);
      }
      // piles of unheard cases, one square per 10 cases
      if (q > 0) {
        x.textAlign = "left"; x.font = "600 15px Public Sans"; x.fillStyle = "#EEEBE3";
        x.fillText("Cases never heard", pileX, T + 4);
        x.font = "13px Public Sans"; x.fillStyle = "#9C988E"; x.fillText("one square is 10 cases", pileX, T + 22);
        const colW = 10 * (cell + gap), base = h - B;
        [[tSq, "today's way", "#EEEBE3", fmt(t.neverHeard)], [wSq, "first winner", "#F07A6E", fmt(wv.neverHeard)]].forEach(([n, lab, col, txt], j) => {
          const ox = pileX + j * (colW + 36); const shownN = Math.round(n * q);
          x.fillStyle = col;
          for (let i = 0; i < shownN; i++) { const r = Math.floor(i / 10), cc = i % 10; x.fillRect(ox + cc * (cell + gap), base - (r + 1) * (cell + gap), cell, cell); }
          x.font = "600 14px Public Sans"; x.fillStyle = col; x.fillText(lab, ox, base + 22);
          x.font = "600 22px Literata"; x.fillText(txt, ox, base - Math.ceil(shownN / 10) * (cell + gap) - 10);
        });
      }
    };
    if (instant || REDUCED) { draw(1, k >= 1 ? 1 : 0); return; }
    if (k === 0) animate(1400, (p) => draw(ease(p), 0));
    else animate(2600, (p) => draw(1, ease(p)));
  },

  oldPlot() {
    const O = D.tournament.old, c = $("#oldcanvas"); const { x, w, h } = sizeCanvas(c);
    const iy = O.cols.indexOf("useful"), ix = O.cols.indexOf("neverHeard");
    const L = 60, B = 50, T = 20, Rm = 10, X = [0, 2000], Y = [8, 28];
    const px = (v) => L + (Math.min(X[1], Math.max(X[0], v)) - X[0]) / (X[1] - X[0]) * (w - L - Rm);
    const py = (v) => h - B - (Math.min(Y[1], Math.max(Y[0], v)) - Y[0]) / (Y[1] - Y[0]) * (h - T - B);
    x.clearRect(0, 0, w, h); x.font = "13px Public Sans"; x.fillStyle = "#9C988E"; x.strokeStyle = "#2A2E34";
    for (let v = 8; v <= 28; v += 4) { const y = py(v); x.beginPath(); x.moveTo(L, y); x.lineTo(w - Rm, y); x.stroke(); x.textAlign = "right"; x.fillText(String(v), L - 8, y + 4); }
    x.textAlign = "center"; for (const v of [0, 500, 1000, 1500, 2000]) x.fillText(fmt(v), px(v), h - B + 20);
    x.fillText("Cases never heard in the quarter", L + (w - L) / 2, h - 10);
    x.save(); x.translate(14, T + (h - T - B) / 2); x.rotate(-Math.PI / 2); x.fillText("Useful hearings a day", 0, 0); x.restore();
    const pts = O.points; const N = pts.length;
    const t = O.todayValidation || O.today, wv = O.winner.validation || O.winner;
    const draw = (p) => {
      x.clearRect(L, T - 10, w - L, h - T - B + 10);
      for (let v = 8; v <= 28; v += 4) { const y = py(v); x.strokeStyle = "#2A2E34"; x.beginPath(); x.moveTo(L, y); x.lineTo(w - Rm, y); x.stroke(); }
      const n = Math.floor(p * N);
      x.fillStyle = "rgba(169,192,240,.35)";
      for (let k = 0; k < n; k++) { const q = pts[k]; x.beginPath(); x.arc(px(q[ix]), py(q[iy]), 2.4, 0, Math.PI * 2); x.fill(); }
      x.fillStyle = "#EEEBE3"; x.fillRect(px(t.neverHeard) - 6, py(t.useful) - 6, 12, 12);
      x.font = "600 14px Public Sans"; x.textAlign = "left"; x.fillText("today's way", px(t.neverHeard) + 10, py(t.useful) + 22);
      if (p >= 1) { const X0 = px(wv.neverHeard), Y0 = py(wv.useful); x.strokeStyle = "#fff"; x.lineWidth = 2.5; x.beginPath(); x.arc(X0, Y0, 11, 0, Math.PI * 2); x.stroke(); x.lineWidth = 1; x.fillStyle = "#fff"; x.font = "600 16px Literata"; x.fillText("the first winner, g921", X0 + 16, Y0 - 12); }
    };
    if (REDUCED) { draw(1); return; }
    animate(2200, (p) => draw(ease(p)));
  },
  park(instant) {
    const c = $("#parkcanvas"); const { x, w, h } = sizeCanvas(c);
    const N = 300, R = rng(15), share = 0.44; // 40 to 47% of the docket (loopholes review); drawn at 44%
    const wallX = w * 0.72, top = 56, bot = h - 60;
    const dots = Array.from({ length: N }, (_, k) => { const parked = R() < share; return { x0: 12 + R() * (wallX - 30), y: top + 10 + R() * (bot - top - 20), parked, x1: wallX + 24 + R() * (w - wallX - 40) }; });
    const draw = (p) => {
      x.clearRect(0, 0, w, h);
      x.font = "15px Public Sans"; x.fillStyle = "#9C988E"; x.textAlign = "left";
      const months = ["October", "November", "December 1 to 15"];
      months.forEach((m, k) => { const mx = 12 + (k * (wallX - 12)) / 3; x.fillText(m, mx, top - 22); x.strokeStyle = "#2E3238"; x.beginPath(); x.moveTo(mx - 6, top - 10); x.lineTo(mx - 6, bot); x.stroke(); });
      x.fillStyle = "#F07A6E"; x.fillText("After 15 December", wallX + 24, top - 22);
      x.fillStyle = "#F07A6E"; x.fillRect(wallX - 2, top - 14, 4, bot - top + 14);
      x.fillStyle = "#EEEBE3"; x.font = "600 14px Public Sans"; x.fillText("end of the quarter", wallX - 150, bot + 24);
      x.fillStyle = "#9C988E"; x.font = "14px Public Sans"; x.fillText("no row, so never counted", wallX + 24, bot + 24);
      for (const d of dots) {
        const t = d.parked ? ease(Math.min(1, Math.max(0, p * 1.4 - (d.y / h) * 0.4))) : 0;
        const xx = d.x0 + (d.x1 - d.x0) * t;
        x.fillStyle = d.parked ? (t > 0.98 ? "#F07A6E" : `rgba(240,122,110,${0.4 + 0.6 * t})`) : "#7FC3A6";
        x.beginPath(); x.arc(xx, d.y, 3.6, 0, Math.PI * 2); x.fill();
      }
    };
    if (instant || REDUCED) { draw(1); return; }
    draw(0); later(() => animate(3200, draw), 500);
  },
  leave() { cancelAnimationFrame(raf); },
};

// ---------- scene 5: what we found ----------
function unitText(r, v, d = 1) {
  if (r.unit === "%") return pct(v, 1);
  return fmt(v, Math.abs(v) >= 100 ? 0 : d);
}
function diffText(r, v) {
  if (r.unit === "%") return sgn(v, 1) + " pts";
  const d = Math.abs(v) >= 100 ? 0 : Math.abs(v) >= 10 ? 1 : 2;
  return sgn(v, d) + (r.unit === "days" ? " days" : r.unit === "min" ? " min" : "");
}
const HEAD_PLAIN = { useful: "Useful hearings a day", merits: "Cases decided on the merits", disposals: "Cases disposed of, all routes", honoured: "Dates honoured", broken: "Dates broken or never given", neverHeard: "Cases never heard", oldMoved: "Cases over 4 years old moved forward", trips: "Trips to court per useful hearing", waited: "Minutes waited per person heard", overshoot: "Days a next date overshoots PUCAR's gap" };
const ROBUST_PLAIN = { "Planner too hopeful (success chances shown 30% higher)": "Planner shown chances 30% too high", "Planner too gloomy (success chances shown 30% lower)": "Planner shown chances 30% too low", "Twice the false 'not ready' answers": "Twice the false \"not ready\" answers" };
hooks["s-found"] = {
  built: false,
  build() {
    const rows = D.headline.rows, host = $("#headline-chart"); host.innerHTML = "";
    const hr = el("div", "hrow head-row"); hr.append(el("span", null, "Measure"), el("span", "v", "Today"), el("span", "v", "Our pick"), el("span", "axis-hdr", "<span>worse than today</span><span>today</span><span>better than today</span>")); host.append(hr);
    const rel = (r, v) => { const base = r.unit === "%" ? r.today[0] * 100 : Math.abs(r.today[0]); return v / base; };
    const maxRel = Math.max(...rows.map((r) => Math.abs(rel(r, r.diff[2])), ...rows.map((r) => Math.abs(rel(r, r.diff[1])))));
    this.bars = [];
    for (const r of rows) {
      const good = r.better === "higher" ? 1 : -1;
      const row = el("div", "hrow " + (r.verdict === "better" ? "better" : r.verdict === "worse" ? "worse" : ""));
      row.append(el("span", "lab", HEAD_PLAIN[r.id] || r.label), el("span", "v", unitText(r, r.today[0])), el("span", "v us", unitText(r, r.winner[0])));
      const tr = el("div", "track"); tr.append(el("span", "zero"));
      const bar = el("span", "bar"), ci = el("span", "ci"), dt = el("span", "dtext", diffText(r, r.diff[0]));
      tr.append(bar, ci, dt); row.append(tr); host.append(row);
      const toX = (v) => 50 + (rel(r, v) * good / maxRel) * 33;
      this.bars.push({ bar, ci, dt, a: toX(0), m: toX(r.diff[0]), lo: toX(r.diff[1]), hi: toX(r.diff[2]) });
    }
    // robustness
    const R = D.robustness.rows, rh = $("#robust-chart"); rh.innerHTML = "";
    const stress = R.filter((r) => r.id !== "baseline");
    const beatBoth = stress.filter((r) => r.useful[1] > 0 && r.merits[1] > 0).length;
    const sum = el("div", "robust-sum"); sum.append(el("span", "big num", `${beatBoth} of ${stress.length}`), el("span", "cap-lg", "stress tests keep our pick ahead of today on useful hearings and on cases decided on the merits. The whole 95% interval stays above zero in each.")); rh.append(sum);
    const mu = Math.max(...R.map((r) => r.useful[2])), mm = Math.max(...R.map((r) => r.merits[2]));
    const hdr = el("div", "rrow hdr"); hdr.append(el("span", null, "What we changed in the court"), el("span", null, `Extra useful hearings a day, 0 to ${fmt(mu, 1)}`), el("span", null, `Extra cases decided on the merits, 0 to ${fmt(mm, 1)}`)); rh.append(hdr);
    this.rbars = [];
    for (const r of R) {
      const row = el("div", "rrow"); row.append(el("span", null, ROBUST_PLAIN[r.label] || r.label));
      for (const [key, mx] of [["useful", mu], ["merits", mm]]) {
        const tr = el("div", "rtrack"); tr.append(el("span", "zero")); const ci = el("span", "ci"), pt = el("span", "pt"); tr.append(ci, pt); row.append(tr);
        this.rbars.push({ ci, pt, lo: (r[key][1] / mx) * 96, hi: (r[key][2] / mx) * 96, m: (r[key][0] / mx) * 96 });
      }
      rh.append(row);
    }
    rh.append(el("p", "source", "Every condition runs seeds 31-60, and both approaches face the same changed court. Planner bias changes only what the planner sees."));
    // ablation
    const A = D.ablation.rows, ah = $("#ablate-chart"); ah.innerHTML = "";
    const PLAN = [
      ["selection first come first served", "Priority index replaced by first come, first served", ""],
      ["prior check", "PUCAR's judgment table used as printed, without the correction", "PUCAR lists judgments as always substantive. Its own hearing counts say about 28%."],
      ["standby list off", "Standby list switched off", ""],
      ["first dates by priority", "First dates by priority instead of spread like today", ""],
      ["process desk off", "Process desk switched off", "The desk keeps dates and saves journeys. It adds no hearings, and 168 of its cases are acted on at the desk instead of heard."],
      ["SEP", "Tempting, but the search left them off", ""],
      ["day-before check-in on", "Day-before check-in switched on", "A not-ready answer releases the matter, which breaks 516 dates."],
      ["calibration on", "Recalibration switched on", "It adds hearings, runs late on 10.6 more days and breaks 266 dates."],
    ];
    const chosen = PLAN.map(([id, lab, note]) => id === "SEP" ? { sep: lab } : { r: A.find((r) => r.variant.startsWith(id)), lab, note }).filter((o) => o.sep || o.r);
    const h2 = el("div", "arow hdr"); h2.append(el("span", null, "Change one part of our pick"), el("span", null, "Useful hearings a day"), el("span", null, "Dates broken or never given"), el("span", null, "Trips per useful hearing")); ah.append(h2);
    const rs = chosen.filter((o) => o.r).map((o) => o.r);
    const mU = Math.max(...rs.map((r) => Math.abs(r.useful[0]))), mB = Math.max(...rs.map((r) => Math.abs(r.broken[0]))), mT = Math.max(...rs.map((r) => Math.abs(r.trips[0])));
    this.abars = [];
    for (const o of chosen) {
      if (o.sep) { ah.append(el("div", "arow sep", o.sep)); continue; }
      const r = o.r; const row = el("div", "arow"); row.append(el("span", null, o.lab + (o.note ? `<span class="note">${o.note}</span>` : "")));
      for (const [f, mx, goodDir, d] of [["useful", mU, 1, 2], ["broken", mB, -1, 0], ["trips", mT, -1, 2]]) {
        const v = r[f][0]; const tr = el("div", "atrack"); tr.append(el("span", "zero"));
        const good = v * goodDir > 0; const bar = el("span", "bar " + (good ? "good" : "bad")); const t = el("span", "t", sgn(v, d));
        tr.append(bar, t); row.append(tr);
        this.abars.push({ bar, t, v: (v / mx) * 30 });
      }
      ah.append(row);
    }
    ah.append(el("p", "source", "Each row changes one gene of the pick and runs the same seeds 31-60, paired against the pick. Green helps the court and red hurts it. Source: out/ablation.md."));
    this.built = true;
  },
  enter() { if (!this.built) this.build(); },
  step(k) {
    const main = $(".found-main"); main.classList.toggle("focus-loss", k === 1);
    const setBars = (on) => {
      for (const b of this.bars) {
        const m = on ? b.m : b.a, lo = on ? b.lo : b.a, hi = on ? b.hi : b.a;
        b.bar.style.left = Math.min(b.a, m) + "%"; b.bar.style.width = Math.abs(m - b.a) + "%";
        b.ci.style.left = Math.min(lo, hi) + "%"; b.ci.style.width = Math.abs(hi - lo) + "%";
        const right = m >= b.a; b.dt.style.left = right ? `calc(${Math.max(m, hi, lo)}% + 10px)` : `calc(${Math.min(m, lo, hi)}% - 10px)`; b.dt.style.transform = right ? "translateY(-50%)" : "translate(-100%, -50%)"; b.dt.style.opacity = on ? 1 : 0;
      }
    };
    if (k <= 1) { setBars(false); later(() => setBars(true), k === 0 ? 350 : 0); if (k === 1) setBars(true); }
    const setR = (on) => { for (const b of this.rbars) { b.ci.style.left = (on ? b.lo : 0) + "%"; b.ci.style.width = (on ? b.hi - b.lo : 0) + "%"; b.pt.style.left = (on ? b.m : 0) + "%"; } };
    setR(false); if (k === 2) later(() => setR(true), 300);
    const setA = (on) => { for (const b of this.abars) { const v = on ? b.v : 0; b.bar.style.left = (v >= 0 ? 50 : 50 + v) + "%"; b.bar.style.width = Math.abs(v) + "%"; b.t.style.left = v >= 0 ? `calc(${50 + v}% + 8px)` : ""; b.t.style.right = v < 0 ? `calc(${50 - v}% + 8px)` : ""; b.t.style.opacity = on ? 1 : 0; } };
    setA(false); if (k === 3) later(() => setA(true), 300);
  },
};

// ---------- scene 6: the dial ----------
const AIM_MEASURES = [
  { k: "usefulPerDay", label: "Useful hearings a day", dir: 1, f: (v) => fmt(v, 1) },
  { k: "meritsDisposals", label: "Cases decided on the merits", dir: 1, f: (v) => fmt(v) },
  { k: "datesBroken", label: "Dates broken or never given", dir: -1, f: (v) => fmt(v) },
  { k: "neverHeard", label: "Cases never heard", dir: -1, f: (v) => fmt(v) },
  { k: "minutesWaited", label: "Minutes waited per person", dir: -1, f: (v) => fmt(v) },
  { k: "casesGivenADate", label: "Cases given a date this quarter", dir: 1, f: (v) => fmt(v) },
];
const AIM_DESC = {
  balanced: "Our pick. It stays no worse than today on 19 measures and then gives the most useful hearings.",
  focus_hearings: "The quarter goes to the cases that can move. It gives far more useful hearings and fewer trips, and about a third of cases get their first date after 15 December.",
  focus_finish: "The court takes cases to judgment day to day, as s.143 NI Act intends. It decides more than twice as many cases on the merits, and most cases get their first date after 15 December.",
  keep_dates: "The court gives fewer dates it cannot keep. It breaks the fewest dates and still dates every case this quarter.",
  reach_everyone: "The court hears as many cases as it can at least once this quarter. It leaves the fewest cases unheard, and more days run late.",
  least_waiting: "Every matter gets a call time, so people wait minutes instead of hours. More days run late.",
};
const AIM_SHORT = { balanced: "Balanced", focus_hearings: "Most useful hearings", focus_finish: "Finish the most cases", keep_dates: "Keep every date", reach_everyone: "Reach every case", least_waiting: "Least waiting" };
hooks["s-dial"] = {
  built: false, cur: 0,
  build() {
    const A = D.aims.aims, list = $("#aimlist"); list.innerHTML = "";
    A.forEach((a, k) => { const b = el("button", "aim", AIM_SHORT[a.id] || a.name); b.type = "button"; b.setAttribute("role", "radio"); b.onclick = (e) => { e.stopPropagation(); this.pick(k); }; list.append(b); });
    const svg = $("#dialsvg"); const n = A.length; let s = `<circle cx="160" cy="160" r="142" fill="#F3F0E7" stroke="#17171A" stroke-width="2"/><circle cx="160" cy="160" r="112" fill="#FBF9F4" stroke="#DCD6C8" stroke-width="1.5"/>`;
    this.angles = A.map((_, k) => -120 + (240 * k) / (n - 1));
    this.angles.forEach((a, k) => { const r1 = 118, r2 = 138, rad = ((a - 90) * Math.PI) / 180; s += `<line x1="${160 + r1 * Math.cos(rad)}" y1="${160 + r1 * Math.sin(rad)}" x2="${160 + r2 * Math.cos(rad)}" y2="${160 + r2 * Math.sin(rad)}" stroke="#17171A" stroke-width="${k === 0 ? 5 : 3}" stroke-linecap="round"/>`; });
    s += `<g id="needle" style="transform-origin:160px 160px;transition:transform .9s cubic-bezier(.3,1.4,.4,1)"><line x1="160" y1="160" x2="160" y2="62" stroke="#1B3F8F" stroke-width="7" stroke-linecap="round"/><circle cx="160" cy="160" r="22" fill="#1B3F8F"/><circle cx="160" cy="160" r="8" fill="#FBF9F4"/></g>`;
    svg.innerHTML = s;
    const bars = $("#aimbars"); bars.innerHTML = "";
    this.rows = AIM_MEASURES.map((m) => {
      const row = el("div", "ab"); const lab = el("div", "lab", m.label + `<small>${m.dir > 0 ? "more is better" : "fewer is better"}</small>`);
      const tr = el("div", "tr"); const tb = el("span", "today"), ab = el("span", "aimv"); tr.append(tb, ab);
      const val = el("div", "val"); row.append(lab, tr, val); bars.append(row);
      const max = Math.max(D.aims.today[m.k], ...A.map((a) => a.measured[m.k]));
      return { m, tb, ab, val, max };
    });
    const f = $("#focusbar"); const dated = D.dialHeldout.rows.find((r) => r.label.toLowerCase().startsWith("cases given a date")).values[3][0];
    f.innerHTML = `<div class="seg a" style="width:0%">${fmt(dated)} cases dated and heard at their natural rhythm this quarter</div><div class="seg b" style="width:100%">${fmt(3000 - dated)} wait until after 15 December</div>`;
    this.built = true;
  },
  enter() { if (!this.built) this.build(); },
  step(k) {
    if (k === 0) this.pick(this.cur, true);
    const f = $("#focusbar"), dated = D.dialHeldout.rows.find((r) => r.label.toLowerCase().startsWith("cases given a date")).values[3][0];
    const [a, b] = $$(".seg", f); a.style.width = "0%"; b.style.width = "100%";
    if (k === 1) later(() => { a.style.width = (dated / 3000) * 100 + "%"; b.style.width = (1 - dated / 3000) * 100 + "%"; }, 400);
  },
  pick(k, quiet) {
    this.cur = k; const A = D.aims.aims, a = A[k], T = D.aims.today;
    $$("#aimlist .aim").forEach((b, n) => { b.classList.toggle("on", n === k); b.setAttribute("aria-checked", String(n === k)); });
    $("#needle").style.transform = `rotate(${this.angles[k]}deg)`;
    $("#aimdesc").textContent = AIM_DESC[a.id] || a.description;
    const from = this.rows.map((r) => r.shown ?? T[r.m.k]);
    for (const r of this.rows) {
      const tv = T[r.m.k], av = a.measured[r.m.k];
      r.tb.style.width = (tv / r.max) * 100 + "%"; r.ab.style.width = (av / r.max) * 100 + "%";
      const rel = (av - tv) / Math.max(1e-9, Math.abs(tv));
      r.ab.className = "aimv " + (Math.abs(rel) < 0.01 ? "same" : rel * r.m.dir > 0 ? "good" : "bad");
    }
    cancelAnimationFrame(this.morph || 0);
    const t0 = performance.now(), dur = REDUCED || quiet ? 0 : 900;
    const tick = (now) => {
      const p = dur ? Math.min(1, (now - t0) / dur) : 1, e = ease(p);
      this.rows.forEach((r, n) => { const v = from[n] + (a.measured[r.m.k] - from[n]) * e; r.shown = v; r.val.innerHTML = `${r.m.f(v)}<small>today ${r.m.f(T[r.m.k])}</small>`; });
      if (p < 1) this.morph = requestAnimationFrame(tick);
    };
    this.morph = requestAnimationFrame(tick);
  },
};

// ---------- scene 7: styles and the console ----------
hooks["s-styles"] = {
  built: false,
  build() {
    const S = D.styles, host = $("#styles"); host.innerHTML = "";
    const today = S.today, win = S.winner;
    const items = [["useful", "Useful hearings a day", 1, 1], ["merits", "Decided on the merits", 1, 0], ["broken", "Dates broken or never given", -1, 0], ["neverHeard", "Cases never heard", -1, 0]];
    const names = { style_sehgal: "Justice Sehgal's way", style_dimakar: "Justice Dimakar's way", style_joshi: "Justice Joshi's way" };
    const STYLE_HOW = {
      style_sehgal: "Fresh and notice matters sit from 11:00 to 13:30 and the oldest from 14:30 to 16:30. Every matter gets a time. A matter not reached returns on the same weekday next week and goes first. The list runs past the day.",
      style_dimakar: "Evidence, arguments and judgments sit on Monday, Wednesday and Friday. Appearances and process sit on Tuesday and Thursday. The oldest cases go first, and an advocate's matters are called together. The list never runs past the day.",
      style_joshi: "Fresh matters go first, with the youngest filings called first all day. Old cases get the 15% floor and no more.",
    };
    for (const r of S.rows) {
      const d = el("div", "style"); d.append(el("h3", null, names[r.id] || r.name), el("p", "how", STYLE_HOW[r.id] || r.how));
      for (const [f, lab, dir, dp] of items) {
        const v = r[f][0], t = today[f][0]; const good = (v - t) * dir > 0;
        const plainV = r.plain && r.plain[f] != null ? (Array.isArray(r.plain[f]) ? r.plain[f][0] : r.plain[f]) : null;
        const sm = el("div", "sm"); sm.append(el("span", "k", lab), el("span", "v " + (Math.abs(v - t) / Math.abs(t) < 0.01 ? "" : good ? "good" : "bad"), fmt(v, dp)));
        sm.append(el("span", "ref", `Today's way gives ${fmt(t, dp)}.${plainV != null ? ` This way on its own scheduler gives ${fmt(plainV, dp)}.` : ""}`));
        d.append(sm);
      }
      host.append(d);
    }
    host.append(el("p", "source style-foot", `Each judge's rules run on top of our scheduler, on held-out seeds 31-60. Our pick alone gives ${fmt(win.useful[0], 1)} useful hearings a day, ${fmt(win.merits[0])} cases on the merits, ${fmt(win.broken[0])} broken dates and ${fmt(win.neverHeard[0])} cases never heard. Green is better than today and red is worse. A rules checker found 0 violations.`));
    this.built = true;
  },
  enter() { if (!this.built) this.build(); },
  step(k) { $("#s-styles").classList.toggle("console-on", k === 1); if (k === 1) this.loadConsole(); },
  async loadConsole() {
    if (this.consoleTried) return; this.consoleTried = true;
    const url = `${location.protocol}//${location.hostname}:8796/`;
    const iframe = $("#console-iframe"), img = $("#console-shot"), note = $("#console-note");
    const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 1800);
    try {
      await fetch(url, { mode: "no-cors", signal: ctl.signal, cache: "no-store" });
      clearTimeout(to); iframe.src = url; note.textContent = "This is the live judge's console, running on this machine at port 8796. Click inside it to use it, and click the headline to carry on.";
    } catch {
      iframe.classList.add("hidden"); img.classList.remove("hidden"); note.textContent = "The console is not running on this machine, so this is a screenshot of it from web-concepts/causelist.";
    }
  },
};

// ---------- scene 8: DRISTI ----------
hooks["s-dristi"] = {
  built: false,
  build() {
    const steps = [
      ["0", "Shadow first", "For two to four weeks the tool proposes lists while the court lists as usual. We check the scorecards against the court's real outcomes."],
      ["1", "Day one", "A nightly roster export in PUCAR's shape gives lists sized to the day, next dates from PUCAR's gaps and the process desk."],
      ["2", "Weeks 1 to 4", "The court master records each outcome with one of PUCAR's ten reasons. It takes two taps a matter."],
      ["3", "E-post", "DRISTI's e-post sends the status of each summons, notice and warrant, so nobody types it in."],
      ["4", "Hearing module", "DRISTI records hearings itself, and the roster export retires."],
    ];
    const ol = $("#rollout"); ol.innerHTML = "";
    steps.forEach(([n, h, p], k) => { const li = el("li", "ro"); li.style.transitionDelay = `${k * 0.18}s`; li.append(el("div", "pin", n), el("h4", null, h), el("p", null, p)); ol.append(li); });
    ol.insertAdjacentHTML("afterend", "");
    this.built = true;
  },
  enter() { if (!this.built) this.build(); },
};

// ---------- presenter view ----------
function presenter() {
  document.body.classList.add("presenter");
  const root = el("div", "pv"); document.body.append(root);
  const main = el("div"), side = el("div", "side"); root.append(main, side);
  const S = NOTES?.scenes || scenes.map((s) => ({ id: s.id, title: s.dataset.title, seconds: 60, land: "", steps: [] }));
  const total = S.reduce((a, s) => a + s.seconds, 0);
  let cur = { i: 0, step: 0 };
  let t0 = +localStorage.getItem("bt-t0") || 0; let sceneT0 = Date.now(); let lastI = -1;
  const render = () => {
    const s = S[cur.i] || S[0];
    main.innerHTML = "";
    main.append(el("h1", null, `${cur.i + 1}. ${s.title}`), el("div", "meta", `Click ${cur.step + 1} of ${s.steps.length || stepsOf(cur.i)}, budget ${s.seconds} s`), el("p", "land", s.land ? `Land: ${s.land}` : ""));
    const ol = el("ol"); s.steps.forEach((t, k) => { const li = el("li", k === cur.step ? "now" : "", t); ol.append(li); }); main.append(ol);
    const nx = S[cur.i + 1];
    side.innerHTML = "";
    const clock = el("div", "clock"), sc = el("div", "scene-clock");
    side.append(clock, sc, el("div", "next", nx ? `Next scene<b>${cur.i + 2}. ${nx.title}</b>` : "Last scene"));
    let acc = 0; const bud = el("div", "budget"); bud.innerHTML = S.map((x, k) => { acc += x.seconds; return `<div class="${k === cur.i ? "cur" : ""}">${k + 1}. ${x.title}, ${x.seconds} s, by ${Math.floor(acc / 60)}:${String(acc % 60).padStart(2, "0")}</div>`; }).join("");
    side.append(bud);
    const row = el("div"); const b1 = el("button", null, "Previous"), b2 = el("button", null, "Next"), b3 = el("button", null, "Restart timer"), b4 = el("button", null, "How exactly");
    b1.onclick = () => chan?.postMessage({ type: "cmd", cmd: "prev" }); b2.onclick = () => chan?.postMessage({ type: "cmd", cmd: "next" });
    b3.onclick = () => { t0 = Date.now(); localStorage.setItem("bt-t0", String(t0)); sceneT0 = Date.now(); tick(); };
    b4.onclick = () => chan?.postMessage({ type: "cmd", cmd: "tech" });
    row.style.display = "flex"; row.style.gap = "8px"; row.style.flexWrap = "wrap"; row.append(b1, b2, b3, b4); side.append(row);
    side.append(el("div", "keys", "Arrows or space here also move the audience screen. The timer starts at the first click."));
    tick();
  };
  const tick = () => {
    const clock = $(".clock"), sc = $(".scene-clock"); if (!clock) return;
    const left = t0 ? total - Math.floor((Date.now() - t0) / 1000) : total;
    const m = Math.floor(Math.abs(left) / 60), s = Math.abs(left) % 60;
    clock.textContent = `${left < 0 ? "-" : ""}${m}:${String(s).padStart(2, "0")}`; clock.classList.toggle("late", left < 0);
    const el2 = Math.floor((Date.now() - sceneT0) / 1000), bud = (S[cur.i] || {}).seconds || 60;
    sc.textContent = t0 ? `This scene ${el2} s of ${bud} s` : "Timer starts at the first click"; sc.classList.toggle("late", t0 && el2 > bud);
  };
  setInterval(tick, 500);
  if (chan) {
    chan.onmessage = (m) => {
      const d = m.data; if (d?.type !== "state") return;
      if (!t0 && (d.i > 0 || d.step > 0)) { t0 = Date.now(); localStorage.setItem("bt-t0", String(t0)); }
      if (d.i !== lastI) { sceneT0 = Date.now(); lastI = d.i; }
      cur = { i: d.i, step: d.step }; render();
    };
    chan.postMessage({ type: "hello" });
  }
  document.addEventListener("keydown", (e) => {
    if (["ArrowRight", "ArrowDown", "PageDown", " ", "Enter"].includes(e.key)) { e.preventDefault(); chan?.postMessage({ type: "cmd", cmd: "next" }); }
    else if (["ArrowLeft", "ArrowUp", "PageUp", "Backspace"].includes(e.key)) { e.preventDefault(); chan?.postMessage({ type: "cmd", cmd: "prev" }); }
    else if (/^[1-9]$/.test(e.key)) chan?.postMessage({ type: "cmd", cmd: "go", i: +e.key - 1, step: 0 });
    else if (e.key === "t") chan?.postMessage({ type: "cmd", cmd: "tech" });
  });
  render();
}

// ---------- boot ----------
(async function boot() {
  await load();
  if (PRESENTER) { presenter(); return; }
  if (document.fonts?.ready) await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1200))]);
  bindings(); buildProgress(); buildJump(); wireInput();
  const m = /^#(\d+)(?:\.(\d+))?/.exec(location.hash);
  go(m ? +m[1] - 1 : 0, m && m[2] ? +m[2] - 1 : 0);
  window.__demo = { go, state, next, prev };
})();
