// My rules: the standing instructions for making the list, written as sentences with blanks to fill.
// Start from a judge's way, change any blank, and see the effect before keeping it: tomorrow's list marked in
// (POST /api/plan) and the effect to 15 December with gains and costs side by side (POST /api/rules/preview).
import {
  $, esc, api, clock, clockOf, toMin, dateLong, dateShort, dayEnd, getRules, setRules, getOverrides, planRequest,
  policyOf, whatChanges, toast, wireTheme, SAMPLE_NOTE, purpose, isOld, in10, withTimes,
} from "./core.js";

const FRESH = ["ADMISSION", "DELAY_CONDONATION_HEARING", "COGNIZANCE", "APPEARANCE", "WARRANT", "BAIL", "APPLICATION_REVIEW"];
const TRIAL = ["EXAMINATION_UNDER_S351_BNSS", "EVIDENCE_COMPLAINANT", "EVIDENCE_ACCUSED", "ARGUMENTS", "JUDGEMENT"];
const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
const same = (a, b) => JSON.stringify(canon(a ?? null)) === JSON.stringify(canon(b ?? null));
const stripOrder = (blocks) => (blocks ?? []).map(({ oldestFirst, newestFirst, ...b }) => b);

const SLOT_PLANS = {
  none: { label: "no fixed slots", blocks: [] },
  fresh_am: {
    label: "fresh matters in the morning, oldest after lunch",
    blocks: [
      { id: "fresh", start: "10:00", end: "13:30", types: FRESH },
      { id: "oldest", start: "14:00", end: "17:00", types: "all", oldestFirst: true },
    ],
  },
  sehgal: {
    label: "Justice Sehgal's hours",
    blocks: [
      { id: "fresh", start: "11:00", end: "13:30", types: FRESH },
      { id: "oldest", start: "14:30", end: "16:30", types: "all", oldestFirst: true },
    ],
  },
  trial_am: {
    label: "evidence and judgments in the morning",
    blocks: [
      { id: "trial", start: "10:00", end: "13:30", types: TRIAL, oldestFirst: true },
      { id: "rest", start: "14:00", end: "17:00", types: "all" },
    ],
  },
};
const FRIDAY_JUDGMENTS = {
  5: [
    { id: "morning", start: "10:00", end: "13:30", types: "all" },
    { id: "judgments", start: "14:00", end: "17:30", types: ["JUDGEMENT"] },
  ],
};

/** Each rule: a sentence with one blank. read(cfg) gives the chosen option id, write(cfg, id) gives the new cfg. */
function rules(S) {
  const presetBlocks = (id) => S.presets.find((p) => p.id === id)?.config;
  const dimakarThemes = presetBlocks("dimakar_way")?.blocksByWeekday ?? null;
  const hasSlots = (c) => (c.blocks?.length ?? 0) > 0 || Object.keys(c.blocksByWeekday ?? {}).length > 0;
  const simple = (key, options) => ({
    options,
    read: (c) => {
      const v = key in c ? c[key] ?? null : S.meta.defaultConfig[key] ?? null;
      const hit = options.find(([o]) => same(o, v));
      return hit ? JSON.stringify(hit[0]) : "custom";
    },
    write: (c, id) => {
      const v = JSON.parse(id);
      const n = { ...c };
      if (v === null) delete n[key];
      else n[key] = v;
      return n;
    },
  });
  return [
    {
      group: "How much to list",
      items: [
        { id: "fill", before: "Make each day's list", after: ".", ...simple("fillTarget", withDefault([
          [0.85, "a little lighter than a full day"], [0.95, "about as full as the day"], [1, "full, but never past the day"],
          [1.1, "a little fuller, as some will be adjourned"], [1.3, "well past the day, as many will be adjourned"]],
          S.meta.defaultConfig.fillTarget, (v) => `about ${Math.round(v * 100)}% of the day, as some will be adjourned`)) },
        { id: "max", before: "List", after: "a day.", ...simple("maxListed", [
          [null, "as many matters as fit"], [30, "no more than 30 matters"], [40, "no more than 40 matters"], [50, "no more than 50 matters"]]) },
        { id: "first", before: "Call", after: "first.", ...simple("priorityTypes", [
          [null, "no kind of matter"], [["BAIL"], "bail matters"], [["BAIL", "WARRANT"], "bail and warrant matters"]]) },
      ],
    },
    {
      group: "Old cases",
      items: [
        { id: "floor", before: "Guarantee old cases (over 4 years) at least", after: "of each day.", ...simple("ageingFloor", [
          [0.15, "15%"], [0.3, "30%"], [0.5, "half"]]),
          help: () => `Tomorrow, old cases already get about ${Math.round((S.base?.expected.share4yPlus ?? 0) * 100)}% of the day. This rule is a minimum, not a target, and it can never go below 15%.` },
      ],
    },
    {
      group: "Time slots and days",
      items: [
        {
          id: "slots", before: "Time slots by purpose:", after: ".",
          options: Object.entries(SLOT_PLANS).map(([k, v]) => [k, v.label]),
          read: (c) => Object.entries(SLOT_PLANS).find(([, v]) => same(stripOrder(v.blocks), stripOrder(c.blocks)))?.[0] ?? "custom",
          write: (c, id) => ({ ...c, blocks: SLOT_PLANS[id].blocks }),
          extra: (c) => slotPicture(c.blocks ?? []),
        },
        {
          id: "within", before: "Within a slot, take", after: "matters first.",
          options: [["oldest", "the oldest"], ["newest", "the newest"], ["asis", "the most useful"]],
          read: (c) => {
            const all = [...(c.blocks ?? []), ...Object.values(c.blocksByWeekday ?? {}).flat()];
            if (all.some((b) => b.newestFirst)) return "newest";
            if (all.some((b) => b.oldestFirst)) return "oldest";
            return "asis";
          },
          write: (c, id) => {
            const set = (b) => {
              const { oldestFirst, newestFirst, ...rest } = b;
              return id === "oldest" ? { ...rest, oldestFirst: true } : id === "newest" ? { ...rest, newestFirst: true } : rest;
            };
            const n = { ...c, blocks: (c.blocks ?? []).map(set) };
            if (c.blocksByWeekday) n.blocksByWeekday = Object.fromEntries(Object.entries(c.blocksByWeekday).map(([d, bs]) => [d, bs.map(set)]));
            return n;
          },
          disabled: (c) => (hasSlots(c) ? null : "Applies once there are time slots or weekday themes."),
        },
        {
          id: "themes", before: "Weekday themes:", after: ".",
          options: [["none", "none"], ["fri", "Fridays after lunch, judgments only"], ...(dimakarThemes ? [["dimakar", "Justice Dimakar's trial and appearance days"]] : [])],
          read: (c) => {
            const t = c.blocksByWeekday ?? {};
            if (!Object.keys(t).length) return "none";
            if (same(stripOrderDays(t), stripOrderDays(FRIDAY_JUDGMENTS))) return "fri";
            if (dimakarThemes && same(stripOrderDays(t), stripOrderDays(dimakarThemes))) return "dimakar";
            return "custom";
          },
          write: (c, id) => {
            const n = { ...c };
            if (id === "none") delete n.blocksByWeekday;
            else n.blocksByWeekday = id === "fri" ? FRIDAY_JUDGMENTS : dimakarThemes;
            return n;
          },
          help: (c) => (c.blocksByWeekday && Object.keys(c.blocksByWeekday).length ? themeWords(c.blocksByWeekday) : null),
        },
        {
          id: "half", before: "Sit half days", after: ".",
          options: [["never", "never"], ["fri", "every Friday"], ["oct15", "on Thursday 15 October"]],
          read: (c) => (c.halfDayWeekdays?.includes(5) ? "fri" : c.halfDays?.includes("2026-10-15") ? "oct15" : c.halfDays?.length || c.halfDayWeekdays?.length ? "custom" : "never"),
          write: (c, id) => {
            const { halfDays, halfDayWeekdays, ...n } = c;
            if (id === "fri") n.halfDayWeekdays = [5];
            if (id === "oct15") n.halfDays = ["2026-10-15"];
            return n;
          },
        },
        {
          id: "leave", before: "On leave", after: ".",
          options: [["none", "no days"], ["nov2", "on Monday 2 November"], ["nov16", "from 16 to 20 November"]],
          read: (c) => {
            const l = c.leaveDays ?? [];
            if (!l.length) return "none";
            if (same(l, ["2026-11-02"])) return "nov2";
            if (same(l, LEAVE_NOV16)) return "nov16";
            return "custom";
          },
          write: (c, id) => {
            const { leaveDays, ...n } = c;
            if (id === "nov2") n.leaveDays = ["2026-11-02"];
            if (id === "nov16") n.leaveDays = LEAVE_NOV16;
            return n;
          },
        },
      ],
    },
    {
      group: "Matters not reached and next dates",
      items: [
        {
          id: "carry", before: "If a matter is not reached,", after: ".",
          options: [["room", "give it the next date with room"], ["week", "list it again the same weekday next week, and take it first"]],
          read: (c) => (c.carryForward ? "week" : "room"),
          write: (c, id) => {
            const { carryForward, carriedFirst, ...n } = c;
            if (id === "week") Object.assign(n, { carryForward: true, carriedFirst: true });
            return n;
          },
        },
        { id: "notice", before: "Give at least", after: "notice of a next date.", ...simple("minNoticeDays", [
          [null, "any"], [7, "7 days'"], [14, "14 days'"]]) },
        { id: "gap", before: "Never give a next date more than", after: "away.", ...simple("maxGapDays", [
          [null, "any time"], [30, "30 days"], [60, "60 days"], [90, "90 days"]]) },
      ],
    },
    {
      group: "Advocates and parties",
      items: [
        { id: "peradv", before: "No advocate gets more than", after: "a day.", ...simple("maxPerAdvocate", [
          [null, "any number of matters"], [5, "5 matters"], [8, "8 matters"], [10, "10 matters"]]) },
        {
          id: "group", before: "", after: "an advocate's matters one after another.",
          options: [["yes", "Call"], ["no", "Do not call"]],
          read: (c) => ((c.groupByAdvocate ?? c.clusterByAdvocate ?? S.meta.defaultConfig.clusterByAdvocate) ? "yes" : "no"),
          write: (c, id) => ({ ...c, groupByAdvocate: id === "yes", clusterByAdvocate: id === "yes" }),
        },
        {
          id: "desk", before: "When a summons or warrant is not back yet,", after: ".",
          options: [["true", "tell the parties not to come"], ["false", "list the case anyway"]],
          read: (c) => String(c.processDesk ?? S.meta.defaultConfig.processDesk),
          write: (c, id) => ({ ...c, processDesk: id === "true" }),
        },
        {
          id: "checkin", before: "The day before,", after: ".",
          options: [["true", "ask each side if they are ready"], ["false", "do not ask"]],
          read: (c) => String(c.checkin ?? S.meta.defaultConfig.checkin),
          write: (c, id) => ({ ...c, checkin: id === "true" }),
        },
      ],
    },
  ];
}
/** Make sure the recommended value is one of the choices, worded like the others. */
function withDefault(options, d, words) {
  if (d == null || options.some(([o]) => same(o, d))) return options;
  return [...options, [d, words(d)]].sort((x, y) => (x[0] ?? 0) - (y[0] ?? 0));
}
const LEAVE_NOV16 = ["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20"];
const stripOrderDays = (t) => Object.fromEntries(Object.entries(t).map(([d, b]) => [d, stripOrder(b)]));

const NOT_YET = [
  "Ask for Justice Dimakar's front-page cover before any arguments are listed.",
  "Continue a part-heard matter on the next working day.",
  "Do not list an advocate who is due in another court at the same time.",
  "Take matters of senior citizens first.",
  "Allow no more than [two] last chances before a matter proceeds.",
];

const DAYS = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];
function typesWords(types) {
  if (types === "all") return "any matter";
  if (same([...types].sort(), [...FRESH].sort())) return "fresh and notice matters";
  if (same([...types].sort(), [...TRIAL].sort())) return "evidence, arguments and judgments";
  if (same(types, ["JUDGEMENT"])) return "judgments only";
  return types.map((t) => purpose(t).replace(/^For /, "")).join(", ");
}
function themeWords(t) {
  return Object.entries(t)
    .map(([d, bs]) => `${DAYS[Number(d)]}: ${bs.map((b) => `${clockOf(b.start)} to ${clockOf(b.end)} ${typesWords(b.types)}`).join("; ")}`)
    .join(". ") + ".";
}
function slotPicture(blocks) {
  if (!blocks.length) return "";
  const start = toMin("10:00"), span = toMin("17:30") - start;
  const pct = (m) => ((toMin(m) - start) / span) * 100;
  return `<div class="slotbar" aria-hidden="true">${blocks
    .map((b, i) => `<span class="slot s${i % 2}" style="left:${pct(b.start)}%;width:${pct(b.end) - pct(b.start)}%"></span>`)
    .join("")}<span class="tick" style="left:0">10</span><span class="tick" style="left:${pct("13:30")}%">1:30</span><span class="tick end">5:30</span></div>
    <ul class="slotwords">${blocks.map((b) => `<li>${esc(clockOf(b.start))} to ${esc(clockOf(b.end))}: ${esc(typesWords(b.types))}${b.oldestFirst ? ", oldest first" : b.newestFirst ? ", newest first" : ""}.</li>`).join("")}</ul>`;
}

/* ---------------- state ---------------- */

const S = { meta: null, date: null, presets: [], saved: {}, start: "recommended", draft: null, draftStart: null, base: null, draftPlan: null, preview: null, previewError: null, planError: null };
const plan = async (rules) => withTimes(await api("plan", planRequest(S.meta, S.date, rules, getOverrides(S.date))));
const STARTS = () => [
  { id: "recommended", name: "Recommended", line: "Benchtime's settings for this court.", config: {} },
  ...S.presets.map((p) => ({ id: p.id, name: `Justice ${p.name.replace(/'s way$/, "")}'s way`, line: p.description, config: p.config })),
];

async function boot() {
  wireTheme();
  try {
    S.meta = await api("meta");
    S.date = new URLSearchParams(location.search).get("date") || S.meta.defaultDate;
    try {
      S.presets = (await api("rules/presets")).presets ?? [];
    } catch {
      S.presets = [];
    }
    S.saved = clean(getRules());
    S.start = localStorage.getItem("causelist.start") || "recommended";
    S.base = await plan(S.saved);
    render();
  } catch (e) {
    $("#sheet").innerHTML = `<h1 class="title">Your rules could not be shown</h1><p class="lede">${esc(e.message)}</p>
      <p><button class="btn btn-primary" type="button" onclick="location.reload()">Try again</button></p>`;
  }
}

/* ---------------- the page ---------------- */

function render() {
  const cfg = S.draft ?? S.saved;
  const startNow = S.draft ? S.draftStart : S.start;
  const R = rules(S);
  $("#sheet").innerHTML = `
    <p class="court">${esc(S.meta.court.name)}</p>
    <h1 class="title">My rules for the list</h1>
    <p class="rules-intro">Every list is made this way. Choose what the list should aim for, start from a judge's way if you like, then change any blank. You see what it would do before you keep it.</p>
    ${aimsBlock(cfg)}
    <fieldset class="starts"><legend>Start from a judge's way</legend>
      ${STARTS().map((s) => `<label class="start ${s.id === startNow ? "on" : ""}"><input type="radio" name="start" value="${esc(s.id)}" ${s.id === startNow ? "checked" : ""}>
        <span class="start-name">${esc(s.name)}</span><span class="start-line">${esc(plainLine(s))}</span></label>`).join("")}
    </fieldset>
    ${R.map((g) => `<section class="rgroup"><h2>${esc(g.group)}</h2><div class="clauses">${g.items.map((c) => clause(c, cfg)).join("")}</div></section>`).join("")}
    <section class="rgroup notyet"><h2>Noted, not yet possible</h2>
      <p class="help">You asked for these. The list cannot follow them yet; they are noted for the court's technical team.</p>
      <ul>${NOT_YET.map((t) => `<li aria-disabled="true"><span class="say">${esc(t)}</span><span class="state">Noted, not yet possible</span></li>`).join("")}</ul>
    </section>
    ${S.draft ? markedList() : ""}
    <p class="foot">Your rules are kept on this computer and used for every list it prepares. ${esc(SAMPLE_NOTE)}</p>`;
  $("#panel").innerHTML = panel();
  wire();
}

const AIM_NUMBERS = {
  balanced: ["usefulPerDay", "datesBroken", "neverHeard"],
  focus_hearings: ["usefulPerDay", "minutesWaited", "casesGivenADate", "neverHeard"],
  focus_finish: ["meritsDisposals", "neverHeard", "datesBroken"],
  keep_dates: ["datesBroken", "usefulPerDay", "neverHeard"],
  reach_everyone: ["neverHeard", "daysRanLate", "usefulPerDay"],
  least_waiting: ["minutesWaited", "daysRanLate", "datesBroken"],
};
const METRIC = {
  usefulPerDay: ["Useful hearings a day", (v) => Math.round(v)],
  meritsDisposals: ["Cases decided on the merits", (v) => Math.round(v)],
  datesBroken: ["Dates broken", (v) => Math.round(v).toLocaleString("en-GB")],
  neverHeard: ["Cases never heard by 15 December", (v) => Math.round(v).toLocaleString("en-GB")],
  minutesWaited: ["Minutes a party waits", (v) => Math.round(v)],
  daysRanLate: ["Days that run late", (v) => Math.round(v)],
  casesGivenADate: ["Cases given a date", (v) => Math.round(v).toLocaleString("en-GB")],
  oldPendingAtEnd: ["Old cases still waiting", (v) => Math.round(v)],
};
function aimsBlock(cfg) {
  const A = S.meta.aims;
  if (!A?.aims?.length) return "";
  const now = cfg.aim ?? "balanced";
  return `<fieldset class="starts aims"><legend>What should the list aim for?</legend>
    <p class="help aims-note">Each choice shows what it did against today's way, measured on PUCAR's sample court, 1 October to 15 December.</p>
    ${A.aims.map((a) => `<label class="start ${a.id === now ? "on" : ""}"><input type="radio" name="aim" value="${esc(a.id)}" ${a.id === now ? "checked" : ""}>
      <span class="start-name">${esc(a.name)}</span>
      <ul class="aim-nums">${(AIM_NUMBERS[a.id] ?? ["usefulPerDay", "datesBroken", "neverHeard"]).filter((k) => a.measured[k] != null && A.today[k] != null).map((k) => {
        const [label, f] = METRIC[k];
        return `<li>${esc(label)}: <strong>${esc(String(f(a.measured[k])))}</strong> instead of ${esc(String(f(A.today[k])))}</li>`;
      }).join("")}</ul></label>`).join("")}
  </fieldset>`;
}

function plainLine(s) {
  if (s.id === "recommended") return "Benchtime's own settings: fill the day, old cases guaranteed their share, parties asked the day before.";
  if (s.id === "joshi_way") return "Fresh matters first. Old cases still get at least 15% of each day; this cannot be turned off.";
  if (s.id === "sehgal_way") return "Fixed slots by purpose; a matter not reached comes back the same weekday next week.";
  if (s.id === "dimakar_way") return "Trial days and appearance days; oldest first; an advocate's matters together.";
  return s.line;
}

function clause(c, cfg) {
  const v = c.read(cfg);
  const recommended = c.read({});
  const saved = c.read(S.saved);
  const dis = c.disabled?.(cfg) ?? null;
  const drafting = S.draft && v !== saved;
  const opts = [...c.options];
  if (v === "custom") opts.push(["custom", "as set by you"]);
  const name = `${c.before} ... ${c.after}`.trim();
  const select = `<select class="blank" name="rule-${c.id}" data-rule="${c.id}" aria-label="${esc(name)}" aria-describedby="s-${c.id}" ${dis ? "disabled" : ""}>
    ${opts.map(([o, l]) => { const id = typeof o === "string" ? o : JSON.stringify(o); return `<option value="${esc(id)}" ${id === v ? "selected" : ""}>${esc(l)}</option>`; }).join("")}
  </select>`;
  const help = typeof c.help === "function" ? c.help(cfg) : c.help;
  const labelOf = (id) => (opts.find(([o]) => (typeof o === "string" ? o : JSON.stringify(o)) === id) ?? [id, id])[1];
  return `<div class="clause ${drafting ? "draft" : ""} ${dis ? "off" : ""}">
    <div><p class="say">${c.before ? esc(c.before) + " " : ""}${select}${/^[.,]/.test(c.after) ? "" : " "}${esc(c.after)}</p>
      ${help ? `<p class="help">${esc(help)}</p>` : ""}${dis ? `<p class="help">${esc(dis)}</p>` : ""}${c.extra ? c.extra(cfg) : ""}</div>
    <p class="state ${v === recommended ? "" : "changed"}" id="s-${c.id}">${drafting ? "Not kept yet" : v === recommended ? "Recommended" : `Recommended: ${esc(labelOf(recommended))}`}</p>
  </div>`;
}

/* ---------------- the preview ---------------- */

const MEASURES = [
  { path: ["backlog", "plus4End"], label: "Old cases (over 4 years) still waiting", better: "lower", fmt: (v) => Math.round(v) },
  { path: ["extra", "disposed"], label: "Cases finished", better: "higher", fmt: (v) => Math.round(v) },
  { path: ["extra", "substantivePerDay"], label: "Useful hearings a day", better: "higher", fmt: (v) => v.toFixed(0) },
  { path: ["siddarth", "heldOnPromisedDate"], label: "Dates honoured", better: "higher", fmt: (v) => `${Math.round(v * 10)} in 10` },
  { path: ["siddarth", "neverHeard"], label: "Cases never heard", better: "lower", fmt: (v) => Math.round(v) },
];
const at = (o, p) => p.reduce((x, k) => x?.[k], o);

function longRun() {
  if (S.previewError) return `<p class="flag">${esc(S.previewError)}</p>`;
  if (!S.preview) return `<p class="working">Working out the effect to 15 December. This takes about 10 seconds.</p>`;
  const sc = S.preview.scorecards;
  const gains = [], costs = [], flat = [];
  for (const m of MEASURES) {
    const a = at(sc.without, m.path)?.mean, b = at(sc.with, m.path)?.mean, d = at(sc.diff, m.path);
    if (a == null || b == null || !d) continue;
    const line = `<span class="m-l">${esc(m.label)}</span><span class="m-v">${esc(String(m.fmt(b)))} instead of ${esc(String(m.fmt(a)))}</span>`;
    const real = d.lo > 0 || d.hi < 0;
    if (!real || m.fmt(a) === m.fmt(b)) flat.push(m.label.toLowerCase());
    else ((d.mean < 0) === (m.better === "lower") ? gains : costs).push(line);
  }
  const probs = (S.preview.problems ?? []).map((p) => (typeof p === "string" ? p : p.message ?? JSON.stringify(p)));
  const keeps = S.preview.plan?.keepsEveryRule;
  return `<div class="gc">
      <div class="gain"><h3>Gains</h3>${gains.length ? `<ul>${gains.map((g) => `<li>${g}</li>`).join("")}</ul>` : "<p>None worth mentioning.</p>"}</div>
      <div class="cost"><h3>Costs</h3>${costs.length ? `<ul>${costs.map((g) => `<li>${g}</li>`).join("")}</ul>` : "<p>None worth mentioning.</p>"}</div>
    </div>
    ${flat.length ? `<p class="hint">About the same: ${esc(flat.join(", "))}.</p>` : ""}
    ${keeps === false ? `<p class="flag">Tomorrow's list cannot keep every rule. ${esc((S.preview.plan.violations ?? []).slice(0, 2).map(String).join(" "))}</p>` : ""}
    ${probs.length ? `<p class="flag">The engine reports: ${esc(probs.join(" "))}.</p>` : ""}`;
}

function panel() {
  const custom = Object.keys(S.saved).length > 0;
  if (S.draft) {
    let tomorrow;
    if (S.planError) tomorrow = `<p class="flag">${esc(S.planError)}</p>`;
    else if (!S.draftPlan) tomorrow = `<p class="working">Working out tomorrow's list...</p>`;
    else {
      const parts = whatChanges(S.base, S.draftPlan, { oldShare: true });
      const sameList = same(S.base.listings.map((l) => [l.caseId, l.callTime]), S.draftPlan.listings.map((l) => [l.caseId, l.callTime]));
      if (sameList) parts.splice(0, parts.length, "No difference to tomorrow's list. It may matter on other days.");
      tomorrow = `<ul class="change">${parts.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
        ${sameList ? "" : `<p><a href="#tlist" class="linkish">See the changes marked in tomorrow's list</a></p>`}`;
    }
    return `<div class="block effect drafting" aria-live="polite">
      <h2>If you keep this change</h2>
      <h3>Tomorrow, ${esc(dateShort(S.draftPlan?.date ?? S.date))}</h3>
      ${tomorrow}
      <h3>By 15 December</h3>
      ${longRun()}
      <div class="row2"><button type="button" class="btn btn-primary" id="keep" ${S.draftPlan ? "" : "disabled"}>Keep this change</button>
      <button type="button" class="btn btn-outline" id="cancel">Cancel</button></div>
    </div>`;
  }
  const end = dayEnd(S.base);
  return `<div class="block effect decide">
      <h2>Tomorrow under these rules</h2>
      <p class="now">${S.base.expected.listed} cases. About ${Math.round(S.base.expected.substantive)} will likely go ahead.${end ? ` The day should end about ${clock(end)}.` : ""}</p>
      <p><a href="/">Open tomorrow's list</a></p>
    </div>
    <div class="block reset">
      <h2>${custom ? "You have changed some rules" : "You are using the recommended rules"}</h2>
      <p>${custom ? "One click puts every rule back to the recommended setting. You can undo it." : "Change any blank on the left to see what it would do."}</p>
      ${custom ? `<button type="button" class="btn btn-outline" id="reset">Go back to the recommended rules</button>` : ""}
    </div>`;
}

/** Tomorrow's list under the draft, with the change marked in: coming on in green, coming off struck through. */
function markedList() {
  if (!S.draftPlan) return `<section class="rgroup" id="tlist"><h2>Tomorrow's list with this change</h2><p class="working">Working out tomorrow's list...</p></section>`;
  const cur = new Set(S.base.listings.map((l) => l.caseId));
  const nxt = new Set(S.draftPlan.listings.map((l) => l.caseId));
  const was = new Map(S.base.listings.map((l) => [l.caseId, l.callTime]));
  const rows = [
    ...S.draftPlan.listings.map((l) => ({ ...l, on: !cur.has(l.caseId) })),
    ...S.base.listings.filter((l) => !nxt.has(l.caseId)).map((l) => ({ ...l, off: true })),
  ].sort((a, b) => (a.standby - b.standby) || ((a.callTime && b.callTime) ? toMin(a.callTime) - toMin(b.callTime) : 0) || (a.off ? -1 : 1));
  const on = rows.filter((r) => r.on).length, off = rows.filter((r) => r.off).length;
  const moved = rows.filter((r) => !r.on && !r.off && r.callTime && was.get(r.caseId) && was.get(r.caseId) !== r.callTime).length;
  let n = 0;
  return `<section class="rgroup" id="tlist"><h2>Tomorrow's list with this change</h2>
    <p class="help">${on || off ? `${on} coming on, marked in green. ${off} coming off, struck through.` : "The same cases as now."}${moved ? ` ${moved} at a new time, with the old time shown.` : ""} ${esc(dateLong(S.draftPlan.date))}.</p>
    <ol class="rows mini">${rows.map((l) => `<li class="row ${l.off ? "leaving" : ""} ${l.on ? "coming" : ""}"><div class="line static">
      <span class="no">${l.off ? "" : ++n}</span><span class="time">${l.callTime ? esc(clockOf(l.callTime)) : ""}</span>
      <span class="cno">${esc(l.caseId)}</span>
      <span class="what">${esc(purpose(l.type, l.case?.nextPurposeLabel))}${l.case && isOld(l.case) ? ` <span class="old">old case</span>` : ""}${l.off ? ` <span class="tag tag-off">coming off</span>` : l.on ? ` <span class="tag tag-on">coming on</span>` : l.callTime && was.get(l.caseId) && was.get(l.caseId) !== l.callTime ? ` <span class="tag tag-was">was ${esc(clockOf(was.get(l.caseId)))}</span>` : ""}</span>
      <span class="odds ${in10(l.pSubstantive) >= 7 ? "" : "maybe"}">${in10(l.pSubstantive) >= 7 ? "likely to go ahead" : "may be adjourned"}</span></div></li>`).join("")}</ol></section>`;
}

/** Drop anything equal to the recommended setting, so "no change" really is no change. */
function clean(cfg) {
  const d = S.meta.defaultConfig;
  const out = {};
  for (const [k, v] of Object.entries(cfg ?? {})) {
    if (v == null) continue;
    if (k in d && same(v, d[k])) continue;
    if (Array.isArray(v) && !v.length && !(k in d)) continue;
    if (k === "blocksByWeekday" && !Object.keys(v).length) continue;
    out[k] = v;
  }
  return out;
}

let token = 0;
async function draft(next, startId) {
  next = clean(next);
  S.draft = next;
  S.draftStart = startId ?? (S.draftStart || S.start);
  if (same(S.draft, S.saved) && S.draftStart === S.start) return cancel(true);
  S.draftPlan = null;
  S.preview = null;
  S.previewError = null;
  S.planError = null;
  const mine = ++token;
  render();
  plan(next)
    .then((p) => { if (mine === token) { S.draftPlan = p; render(); } })
    .catch((e) => { if (mine === token) { S.planError = `${e.message} Nothing has changed.`; render(); } });
  api("rules/preview", { config: next, baseConfig: S.saved, policy: policyOf(S.meta), date: S.date })
    .then((p) => { if (mine === token) { S.preview = p; render(); } })
    .catch((e) => { if (mine === token) { S.previewError = `The effect to 15 December could not be worked out. ${e.message}`; render(); } });
}

function cancel(silent) {
  token++;
  S.draft = null;
  S.draftStart = null;
  S.draftPlan = null;
  S.preview = null;
  render();
  if (!silent) toast("Cancelled. Your rules have not changed.");
}

async function commit(rules, start, message, undoTo) {
  const prev = { rules: S.saved, start: S.start };
  S.saved = rules;
  S.start = start;
  setRules(rules);
  localStorage.setItem("causelist.start", start);
  S.base = S.draftPlan && same(S.draft, rules) ? S.draftPlan : await plan(rules);
  token++;
  S.draft = null;
  S.draftPlan = null;
  S.preview = null;
  render();
  toast(message, undoTo ? () => commit(prev.rules, prev.start, "Undone. Your rules are as they were.") : null);
}

/** A blank is as wide as the words written in it, like a filled-in form. */
function fit(sel) {
  const c = fit.ctx || (fit.ctx = document.createElement("canvas").getContext("2d"));
  const cs = getComputedStyle(sel);
  c.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  sel.style.width = Math.ceil(c.measureText(sel.options[sel.selectedIndex]?.text ?? "").width + 46) + "px";
}

function wire() {
  const R = rules(S).flatMap((g) => g.items);
  document.querySelectorAll(".blank").forEach((s) => {
    fit(s);
    s.addEventListener("change", () => {
      const rule = R.find((r) => r.id === s.dataset.rule);
      if (s.value === "custom") return;
      draft(rule.write({ ...(S.draft ?? S.saved) }, s.value));
      setTimeout(() => document.querySelector(`.blank[data-rule="${rule.id}"]`)?.focus(), 0);
    });
  });
  document.fonts?.ready.then(() => document.querySelectorAll(".blank").forEach(fit));
  document.querySelectorAll('input[name="aim"]').forEach((r) =>
    r.addEventListener("change", () => {
      const next = { ...(S.draft ?? S.saved) };
      if (r.value === "balanced") delete next.aim;
      else next.aim = r.value;
      draft(next);
      setTimeout(() => document.querySelector(`input[name="aim"][value="${r.value}"]`)?.focus(), 0);
    }),
  );
  document.querySelectorAll('input[name="start"]').forEach((r) =>
    r.addEventListener("change", () => {
      const s = STARTS().find((x) => x.id === r.value);
      const aim = (S.draft ?? S.saved).aim;
      draft({ ...structuredClone(s.config), ...(aim ? { aim } : {}) }, s.id);
      setTimeout(() => document.querySelector(`input[name="start"][value="${s.id}"]`)?.focus(), 0);
    }),
  );
  $("#keep")?.addEventListener("click", () => commit(S.draft, S.draftStart || S.start, "Change kept. Tomorrow's list now follows your rules.", true));
  $("#cancel")?.addEventListener("click", () => cancel(false));
  $("#reset")?.addEventListener("click", () => commit({}, "recommended", "Back to the recommended rules. Tomorrow's list follows them now.", true));
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && S.draft) cancel(false);
});

boot();
