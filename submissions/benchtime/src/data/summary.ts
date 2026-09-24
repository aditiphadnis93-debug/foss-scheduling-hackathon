// Parser for the roster's last_hearing_summary cell: a "Present:" and an "Absent:" line naming the four
// roles, then the court's free-text order. Everything a planner may learn from the last hearing comes
// through here (rule 1), so the rules are explicit phrase matches, each tested against every distinct note
// in PUCAR's sample (test/summary.test.ts). Unrecognised text is kept in `notes` but yields no tag.

import type { ParsedSummary, ProcessKind, ProcessState, Role } from "../domain/types";

// Role labels as the court writes them, normalised (lower case, no apostrophes, single spaces).
const ROLE_LABELS: Record<string, Role> = {
  complainant: "complainant",
  "complainants advocate": "complainantAdvocate",
  "complainant advocate": "complainantAdvocate",
  "complainants counsel": "complainantAdvocate",
  accused: "accused",
  "accused advocate": "accusedAdvocate",
  "accuseds advocate": "accusedAdvocate",
  "accused counsel": "accusedAdvocate",
  "accuseds counsel": "accusedAdvocate",
};

function normLabel(s: string): string {
  return s
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// A process event found in the text. Strong events (an order to issue, await or a report of service) set
// the state; weak ones ("For return of summons") only name the kind when nothing stronger was said.
interface ProcessEvent {
  pos: number;
  strong: boolean;
  /** null clears the accused's process (a summons to a witness is not process against the accused) */
  state: { kind: ProcessKind; status: ProcessState["status"] } | null;
  tag: string;
}

const PROCESS_RULES: { re: RegExp; strong: boolean; state: ProcessEvent["state"]; tag: string }[] = [
  { re: /\bissue\s+nbw\b|\bnon[- ]?bailable\s+warrant\b/g, strong: true, state: { kind: "warrant_nonbailable", status: "issued" }, tag: "nbw_issued" },
  { re: /\bissue\s+bailable\s+warrant\b|\bissue\s+bw\b/g, strong: true, state: { kind: "warrant_bailable", status: "issued" }, tag: "bw_issued" },
  { re: /\bissue\s+(?:by\s+hand\s+)?warrant\b/g, strong: true, state: { kind: "warrant", status: "issued" }, tag: "warrant_issued" },
  { re: /\bawait\s+warrant\b/g, strong: true, state: { kind: "warrant", status: "issued" }, tag: "warrant_awaited" },
  { re: /\bissue\s+summons\s+to\s+(?:the\s+)?witness/g, strong: true, state: null, tag: "witness_summons" },
  { re: /\bissue\s+summons\b(?!\s+to\s+(?:the\s+)?witness)/g, strong: true, state: { kind: "summons", status: "issued" }, tag: "summons_issued" },
  { re: /\bawait\s+summons\b/g, strong: true, state: { kind: "summons", status: "issued" }, tag: "summons_awaited" },
  { re: /\bissue\s+(?:dca\s+)?notice\b/g, strong: true, state: { kind: "notice", status: "issued" }, tag: "notice_issued" },
  { re: /\bawait\s+notice\b/g, strong: true, state: { kind: "notice", status: "issued" }, tag: "notice_awaited" },
  { re: /\bsummons\s+(?:is\s+|was\s+)?served\b/g, strong: true, state: { kind: "summons", status: "served" }, tag: "summons_served" },
  { re: /\bnotice\s+(?:is\s+|was\s+)?served\b/g, strong: true, state: { kind: "notice", status: "served" }, tag: "notice_served" },
  // "Notice is returned as addressee out of India. Hence notice can be deemed to be served": served, not returned
  { re: /\bnotice\s+can\s+be\s+deemed\s+to\s+be\s+served\b/g, strong: true, state: { kind: "notice", status: "served" }, tag: "notice_deemed_served" },
  { re: /\bfor\s+return\s+of\s+warrant\b/g, strong: false, state: { kind: "warrant", status: "issued" }, tag: "warrant_return_awaited" },
  { re: /\bfor\s+return\s+of\s+summons\b/g, strong: false, state: { kind: "summons", status: "issued" }, tag: "summons_return_awaited" },
  { re: /\bfor\s+return\s+of\s+notice\b/g, strong: false, state: { kind: "notice", status: "issued" }, tag: "notice_return_awaited" },
];

// Descriptive phrases worth a tag (for explanations and the data profile); flags are set separately.
const TAG_RULES: [RegExp, string][] = [
  [/\blast[- ]chance\b/, "last_chance"],
  [/\breferred\s+for\s+mediation\b/, "mediation_referred"],
  [/\bprogress\s+in\s+mediation\b/, "mediation_report_due"],
  [/\bfor\s+judgment\b/, "for_judgment"],
  [/\bjudgment\s+pronounced\b/, "judgment_pronounced"],
  [/\bconvicted\b/, "convicted"],
  [/\bacquitted\b/, "acquitted"],
  [/\bsentenced?\b/, "sentenced"],
  [/\bsentence\s+suspended\b/, "sentence_suspended"],
  [/\bwitness\s+shall\s+be\s+present\b/, "witness_to_attend"],
  [/\bwitness\s+schedule\b/, "witness_schedule"],
  [/\baccused\s+shall\s+be\s+present\b|\bfor\s+the\s+appearance\s+of\s+the\s+accused\b/, "accused_to_appear"],
  [/\bfor\s+the\s+appearance\s+of\s+the\s+parties\b/, "parties_to_appear"],
  [/\bcomplainant\s+shall\s+be\s+present\b/, "complainant_to_appear"],
  [/\bfile\s+objections?\b|\bfor\s+objections?\b/, "objections_pending"],
  [/\bcontinuously\s+absent\b|\babsent\s+despite\b/, "complainant_repeatedly_absent"],
  [/\bsteps\s+not\s+taken\b/, "steps_not_taken"],
  [/\btake\s+steps\b/, "take_steps"],
  [/\bexamined[- ]in[- ]chief\b|\bexamined\s+in\s+chief\b/, "chief_examination"],
  [/\bproof\s+affidavit\b/, "proof_affidavit"],
  [/\bexhibits\s+marked\b/, "exhibits_marked"],
  [/\bnot\s+ready\s+for\s+cross[- ]examination\b/, "cross_not_ready"],
  [/\bfor\s+cross[- ]examination\b/, "cross_examination_due"],
  [/\bcomplainant'?s\s+evidence\b|\bevidence\s+of\s+the\s+complainant\b/, "complainant_evidence"],
  [/\bdefence\s+evidence\b|\bevidence\s+of\s+the\s+accused\b|\bas\s+dw\d/, "defence_evidence"],
  [/\bexamined\s+u\/s\.?\s*351/, "s351_examination"],
  [/\bpleaded\s+not\s+guilty\b/, "pleaded_not_guilty"],
  [/\bpleaded\s+guilty\b/, "pleaded_guilty"],
  [/\bread\s+over\s+and\s+explained\b/, "particulars_explained"],
  [/\bsureties\b/, "sureties"],
  [/\bsummons\s+case\b/, "summons_case"],
  [/\btook\s+cognizance\b|\btaken\s+on\s+file\b/, "cognizance_taken"],
  [/\b225\s+affidavit\b|\baffidavit\s+u\/s\.?\s*225\b/, "s225_affidavit"],
  [/\benquiry\s+conducted\b/, "s225_enquiry"],
  [/\benquiry\s+u\/s\.?\s*225\s+of\s+bnss\s+dispensed\b/, "s225_enquiry_dispensed"],
  [/\bno\s+delay\s+in\s+filing\b/, "no_delay"],
  [/\bdelay\s+condonation\s+application\s+allowed\b/, "delay_condoned"],
  [/\bcmp\s+allowed\b/, "cmp_allowed"],
  [/\bapplication\s+taken\s+up\s+for\s+review\b/, "application_review"],
  [/\bfiled\s+application\b/, "application_filed"],
  [/\bheard\s+from\s+the\s+side\s+of\s+the\s+complainant\b/, "complainant_heard"],
  [/\bfor\s+the\s+hearing\s+of\s+the\s+accused\b/, "accused_to_be_heard"],
  [/\bfor\s+further\s+hearing\b/, "further_hearing"],
  [/\bfor\s+(?:objection\s+and\s+)?hearing\b/, "for_hearing"],
  [/^heard\b|\.\s*heard\b/, "heard"],
  [/\bproduce\s+the\s+order\b/, "produce_order"],
  [/\bout\s+of\s+india\b/, "addressee_abroad"],
  [/\bpower\s+of\s+attorney\s+holder\b/, "poa_holder"],
];

function emptyAttendance(): Record<Role, boolean | null> {
  return { complainant: null, complainantAdvocate: null, accused: null, accusedAdvocate: null };
}

/** Parse one last_hearing_summary cell. Never throws: unknown text stays in `notes` without a tag. */
export function parseSummary(raw: string): ParsedSummary {
  const attendance = emptyAttendance();
  const notes: string[] = [];
  const lines = raw.replace(/\r\n?/g, "\n").split("\n");
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    const m = /^(present|absent)\s*:\s*(.*)$/i.exec(t);
    if (!m) {
      notes.push(t);
      continue;
    }
    const present = m[1]!.toLowerCase() === "present";
    for (const part of m[2]!.split(/[,;]/)) {
      const role = ROLE_LABELS[normLabel(part)];
      if (role) attendance[role] = present;
    }
  }

  const text = notes.join(" ").toLowerCase().replace(/[’`]/g, "'").replace(/\s+/g, " ");
  const tags: string[] = [];
  const addTag = (t: string) => {
    if (!tags.includes(t)) tags.push(t);
  };

  // An attorney holder stands in for the complainant, so the complainant side counts as present
  if (/\bpower\s+of\s+attorney\s+holder\s+for\s+the\s+complainant\s+present\b/.test(text)) attendance.complainant = true;

  // Process: the last strong statement wins (a later order supersedes an earlier report), else the last weak one
  const events: ProcessEvent[] = [];
  for (const r of PROCESS_RULES) {
    r.re.lastIndex = 0;
    for (const hit of text.matchAll(r.re)) events.push({ pos: hit.index ?? 0, strong: r.strong, state: r.state, tag: r.tag });
  }
  events.sort((a, b) => a.pos - b.pos);
  for (const e of events) addTag(e.tag);
  const strong = events.filter((e) => e.strong);
  const decisive = strong.length > 0 ? strong[strong.length - 1] : events[events.length - 1];
  // the roster has no hearing dates, so the issue date is unknown
  const process: ProcessState | null = decisive?.state ? { ...decisive.state, issuedOn: null } : null;

  for (const [re, tag] of TAG_RULES) if (re.test(text)) addTag(tag);

  const has = (t: string) => tags.includes(t);
  const judgmentPronounced = has("convicted") ? "convicted" : has("acquitted") ? "acquitted" : null;
  return {
    raw,
    attendance,
    notes,
    process,
    lastChance: has("last_chance"),
    mediation: /\bmediation\b/.test(text),
    forJudgment: has("for_judgment"),
    judgmentPronounced,
    witnessToAttend: has("witness_to_attend") || has("witness_summons"),
    // "For the appearance of the parties" asks for both sides
    accusedToAppear: has("accused_to_appear") || has("parties_to_appear"),
    complainantToAppear: has("complainant_to_appear") || has("parties_to_appear"),
    objectionsPending: has("objections_pending"),
    tags,
  };
}
