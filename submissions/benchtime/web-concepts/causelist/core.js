// Shared helpers for the causelist concept: engine calls, plain-word formatting, and what the browser remembers.

export const $ = (s, r = document) => r.querySelector(s);
export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export async function api(path, body) {
  const opt = body
    ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
    : {};
  let r;
  try {
    r = await fetch("/api/" + path, opt);
  } catch {
    throw new Error("This page could not reach its server. Check that it is running, then try again.");
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(j.error ? `${j.error} ${j.detail ?? ""}`.trim() : `The engine answered with an error (${r.status}).`);
    e.status = r.status;
    throw e;
  }
  return j;
}

/* ---------- time ---------- */
export const toMin = (hhmm) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};
const round5 = (m) => Math.round(m / 5) * 5;
/** 24 hour minutes to the way a court clock is read: 4:40, 10:00, 1:30 */
export const clock = (min) => {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")}`;
};
export const clockOf = (hhmm) => clock(toMin(hhmm));

export const dateLong = (iso) =>
  new Date(iso + "T00:00:00").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
export const dateShort = (iso) =>
  new Date(iso + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

/** Clock minute (from midnight) when the last timed matter is expected to finish, to the nearest 5 minutes. */
export function dayEnd(plan) {
  const timed = plan.listings.filter((l) => l.callTime && !l.standby && !l.late);
  if (!timed.length) return null;
  return Math.min(toMin(plan.sitting.end), round5(Math.max(...timed.map((l) => toMin(l.callTime) + l.expectedMinutes))));
}
/** Bench minutes (breaks excluded) to a clock minute, for the "How sure are we?" range. */
export function benchToClock(plan, bench) {
  const start = toMin(plan.sitting.start);
  let t = start + bench;
  for (const b of plan.sitting.breaks) {
    const bs = toMin(b.start);
    if (t > bs) t += toMin(b.end) - bs;
  }
  return round5(t);
}

/* ---------- chances and plain words ---------- */
export const in10 = (p) => Math.min(9, Math.max(1, Math.round(p * 10)));
export const likely = (p) => in10(p) >= 7;
export const prospectText = (p) => (likely(p) ? "likely to go ahead" : "may be adjourned");

export function dayKind(plan) {
  const e = plan.expected;
  if (e.utilisation > 1 || e.overrunRisk >= 0.3) return "a heavy day";
  if (e.utilisation < 0.6) return "a light day";
  return "a normal day";
}

const PURPOSE = {
  ADMISSION: "For admission of the complaint",
  DELAY_CONDONATION_HEARING: "For excusing the delay in filing",
  COGNIZANCE: "For taking cognizance",
  APPEARANCE: "For appearance of the accused",
  WARRANT: "For the accused, on warrant",
  PLEA: "For plea of the accused",
  EXAMINATION_UNDER_S351_BNSS: "For questioning the accused (s. 351)",
  EVIDENCE_COMPLAINANT: "For complainant's evidence",
  EVIDENCE_ACCUSED: "For defence evidence",
  ARGUMENTS: "For arguments",
  JUDGEMENT: "For judgment",
  BAIL: "For bail",
  REPORTS: "For report",
  APPLICATION_REVIEW: "For hearing an application",
};
export const purpose = (type, label) => PURPOSE[type] ?? `For ${String(label ?? type).toLowerCase()}`;

export const isOld = (c) => c.ageYears >= 4;
export const years = (y) => (y < 1 ? "under a year" : `${Math.floor(y)} year${Math.floor(y) === 1 ? "" : "s"}`);

/** Engine reasons in the words a magistrate uses; machinery and duplicates are dropped. */
export function plainReasons(listing, c) {
  const raw = [...(listing?.why ?? []), ...(c.prediction?.reasons ?? []).filter((r) => r.effect > 0.02).map((r) => r.text)];
  const out = [];
  for (const t of raw) {
    let s = t;
    if (/knapsack|PUCAR|across the docket|index rule/i.test(t)) continue;
    if (/years old|fairness floor/i.test(t)) s = "It is an old case, so it gets time first.";
    else if (/can dispose of the case/i.test(t)) s = "This hearing can finish the case.";
    else if (/notice known returned/i.test(t)) s = "The notice has come back.";
    else if (/substantive hearing disposes/i.test(t)) s = "This hearing can finish the case.";
    else if (/summons known returned/i.test(t)) s = "The summons has come back.";
    else if (/warrant known returned/i.test(t)) s = "The warrant has come back.";
    else if (/no summons, warrant or report outstanding/i.test(t)) s = "Nothing is pending: no summons, warrant or report is out.";
    else if (/present at (\d+) of (\d+) recorded/i.test(t)) {
      const m = t.match(/^(.*) present at (\d+) of (\d+)/i);
      s = `${m[1]} came to ${m[2]} of the ${m[3]} hearing${m[3] === "1" ? "" : "s"} on record.`;
    } else if (!/[.!]$/.test(s)) s += ".";
    if (!out.includes(s)) out.push(s);
  }
  return out.slice(0, 3);
}

export function lastOrder(c) {
  const lines = (c.lastSummary?.raw ?? "").split("\n").map((l) => l.trim()).filter((l) => l && !/^(present|absent):/i.test(l));
  const t = lines.join(" ");
  return t.length > 150 ? t.slice(0, 147).replace(/\s+\S*$/, "") + "..." : t;
}

/** Normalise what someone types into a case id: "1922/2016", "ST 1922 2016", "1922 of 2016". */
export function caseIdFrom(input) {
  const m = String(input).toUpperCase().match(/(?:([A-Z]{1,4})\s*[/ -]?\s*)?(\d{1,5})\s*(?:\/|-|\s|OF)+\s*(\d{4})/);
  if (!m) return null;
  return `${m[1] || "ST"}/${Number(m[2])}/${m[3]}`;
}

/* ---------- what the browser remembers ---------- */
const read = (k, d) => {
  try {
    return JSON.parse(localStorage.getItem(k)) ?? d;
  } catch {
    return d;
  }
};
const write = (k, v) => localStorage.setItem(k, JSON.stringify(v));

export const getRules = () => read("benchtime.rules", {});
export const setRules = (r) => write("benchtime.rules", r);
export function getOverrides(date) {
  const o = read("benchtime.overrides", null);
  return o && o.date === date ? { date, pin: o.pin ?? [], drop: o.drop ?? [] } : { date, pin: [], drop: [] };
}
export const setOverrides = (o) => write("benchtime.overrides", o);
export const getApproval = () => read("causelist.approval", null);
export const setApproval = (a) => (a ? write("causelist.approval", a) : localStorage.removeItem("causelist.approval"));

/** The planner that honours the judge's own rules ("zoo" in the rules patch), else the recommended one. */
export const policyOf = (meta) => (meta.policies?.some((p) => p.id === "zoo") ? "zoo" : meta.recommended);

export function planRequest(meta, date, rules, ov) {
  const body = { date, policy: policyOf(meta) };
  if (rules && Object.keys(rules).length) body.config = rules;
  if (ov?.pin?.length) body.pin = ov.pin;
  if (ov?.drop?.length) body.drop = ov.drop;
  return body;
}

/** One plain sentence (or two) on what changes between two plans. */
export function whatChanges(a, b, { oldShare = false } = {}) {
  const parts = [];
  const ea = dayEnd(a), eb = dayEnd(b);
  if (ea != null && eb != null) {
    parts.push(ea === eb ? `The day will still end about\u00a0${clock(ea)}.` : `The day will end about\u00a0${clock(eb)} instead of\u00a0${clock(ea)}.`);
  }
  const close = toMin(b.sitting.end);
  if (eb != null && eb > close && (ea == null || ea <= close)) parts.push(`That is after the court rises at\u00a0${clock(close)}.`);
  const na = a.expected.listed, nb = b.expected.listed;
  if (na !== nb) parts.push(`${nb}\u00a0cases instead of\u00a0${na}.`);
  const sa = Math.round(a.expected.substantive), sb = Math.round(b.expected.substantive);
  if (sa !== sb) parts.push(`About\u00a0${sb} will likely go ahead instead of\u00a0${sa}.`);
  if (oldShare) {
    const pa = Math.round(a.expected.share4yPlus * 100), pb = Math.round(b.expected.share4yPlus * 100);
    if (pa !== pb) parts.push(`Old cases get ${pb}% of the time instead of ${pa}%.`);
  }
  return parts;
}

export function toast(html, undo) {
  let t = $("#toast");
  t.innerHTML = `<p>${html}</p>` + (undo ? `<button type="button" class="btn btn-quiet" id="toast-undo">Undo</button>` : "");
  t.hidden = false;
  t.classList.remove("show");
  void t.offsetWidth;
  t.classList.add("show");
  clearTimeout(toast.timer);
  if (undo) $("#toast-undo").onclick = () => {
    t.hidden = true;
    undo();
  };
  toast.timer = setTimeout(() => (t.hidden = true), 12000);
}

/** The next birthday of a case (filing anniversary) at a whole number of years, counted from the filing date itself. */
export function turnsOn(c, years) {
  const d = new Date(c.filingDate + "T00:00:00");
  d.setFullYear(d.getFullYear() + years);
  return d.toISOString().slice(0, 10);
}

/** A last order that reads like the case was decided, while the engine still has it pending. */
export const decidedButPending = (c) => /acquitt|convicted|judg(e)?ment pronounced|disposed of|case (is )?closed/i.test(c.lastSummary?.raw ?? "");

/* ---------- light by default, dark on request ---------- */
export function wireTheme() {
  const b = document.getElementById("theme");
  if (!b) return;
  const set = (t) => {
    document.documentElement.dataset.theme = t;
    localStorage.setItem("causelist.theme", t);
    b.setAttribute("aria-pressed", String(t === "dark"));
    b.textContent = t === "dark" ? "Light page" : "Dark page";
  };
  set(localStorage.getItem("causelist.theme") === "dark" ? "dark" : "light");
  b.addEventListener("click", () => set(document.documentElement.dataset.theme === "dark" ? "light" : "dark"));
}

export const SAMPLE_NOTE = "PUCAR's sample court: synthetic cases for this demonstration, not a real court's records.";

/** Planners that give no call times: estimate each start from the engine's expected running total
 *  (load.cumulative, bench minutes), skipping breaks. Matters that would start after the court rises are "late". */
export function withTimes(plan) {
  if (!plan?.workingDay || !plan.listings.length || plan.listings.some((l) => l.callTime)) return plan;
  const start = toMin(plan.sitting.start), close = toMin(plan.sitting.end);
  const endOf = new Map((plan.load?.cumulative ?? []).map((c) => [c.order, c.expectedEnd]));
  const toClock = (bench) => {
    let t = start + bench;
    for (const b of plan.sitting.breaks) if (t >= toMin(b.start)) t += toMin(b.end) - toMin(b.start);
    return t;
  };
  const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(Math.floor(m % 60)).padStart(2, "0")}`;
  let prev = 0;
  const listings = [...plan.listings].sort((a, b) => a.order - b.order).map((l) => {
    const begin = toClock(prev);
    prev = endOf.get(l.order) ?? prev + l.expectedMinutes;
    const w = Math.floor(begin / 30) * 30;
    return { ...l, callTime: hhmm(begin), window: `${hhmm(w)}-${hhmm(w + 30)}`, late: begin >= close, derived: true };
  });
  return { ...plan, listings, derivedTimes: true };
}
