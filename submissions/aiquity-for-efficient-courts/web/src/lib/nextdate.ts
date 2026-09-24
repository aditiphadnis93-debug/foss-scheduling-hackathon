// The suggested next date, explained: what happened, the rule, why this day, and two alternatives.
import type { Day, Listing, Run } from "./types";
import { dateLabel, pretty } from "./format";

export const IDEAL_GAP: Record<string, number> = {
  ADMISSION: 5, APPEARANCE: 21, APPLICATION_REVIEW: 5, ARGUMENTS: 14, BAIL: 14, COGNIZANCE: 14,
  DELAY_CONDONATION_HEARING: 5, EVIDENCE_ACCUSED: 14, EVIDENCE_COMPLAINANT: 14, EXAMINATION_UNDER_S351_BNSS: 14,
  JUDGEMENT: 21, PLEA: 14, REPORTS: 45, WARRANT: 21,
};

type AuditRow = { day: string; case_id: string | null; action: string; rule?: string; why?: string; after?: unknown };

const DAY = 86400000;
const addDays = (iso: string, n: number) => new Date(Date.parse(iso) + n * DAY).toISOString().slice(0, 10);
const between = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);

export function whatHappened(l: Listing): string {
  const o = l.outcome;
  if (!o) return "Not yet heard.";
  if (o.kind === "substantive") return o.next_date ? `The hearing went ahead; the case moves to ${pretty(o.next_purpose ?? l.purpose)}.` : "The hearing went ahead and the case was decided.";
  if (o.kind === "not_reached") return "The day ran out before the matter was called.";
  if (o.kind === "not_ready") return `A prerequisite was not ready${o.reason ? `: ${o.reason.toLowerCase()}` : ""}.`;
  const r = o.reason ?? "";
  if (r.startsWith("Respondent Absence")) return "The accused did not appear.";
  if (r.startsWith("Petitioner Absence")) return "The complainant did not appear.";
  if (r.startsWith("Both Parties")) return "Neither side was ready or present.";
  if (r.startsWith("Party Sought Time")) return "Time was sought.";
  if (r.startsWith("Judge emergency")) return "The judge was called away before the matter was heard.";
  return r ? `Adjourned: ${r.toLowerCase()}.` : "Adjourned.";
}

export function ruleIdFor(run: Run, day: Day, l: Listing): string {
  const a = ((run as Run & { audit?: AuditRow[] }).audit ?? []).find((x) => x.day === day.date && x.case_id === l.case_id && x.action === "next_date");
  if (a?.rule) return a.rule;
  const o = l.outcome;
  if (!o) return "procedural";
  if (!o.next_date) return "disposed";
  if (String(run.meta.config_detail?.next_date_policy ?? "") === "flat") return "flat";
  if (o.kind === "not_reached") return "carry-next-day";
  if (o.kind === "not_ready") return "prerequisite";
  if (o.reason && /Absence|Sought Time|Unready/.test(o.reason)) return "absence-short";
  return "procedural";
}

export function ruleText(id: string, nextPurpose: string, gap: number): string {
  switch (id) {
    case "procedural":
      return `The next step (${pretty(nextPurpose)}) normally needs ${gap} days.`;
    case "absence-short":
      return "An absence gets a short, firm date, at most 14 days, so the absent side cannot stretch the case.";
    case "prerequisite":
      return "Listed on the day the summons or warrant is expected back.";
    case "capacity-aware":
      return "The earliest day on or after the procedural date that still has room.";
    case "gaming-firm-short":
      return "Time was sought again by the same side: a firm date within 7 days.";
    case "flat":
      return "Current practice: 60 days.";
    case "emergency-roll":
      return "The judge was called away: rolled to the next sitting with priority.";
    case "carry-next-day":
      return "Not reached today: it returns at the next sitting with priority.";
    case "disposed":
      return "Judgement delivered; the case is closed.";
    default:
      return id.replace(/-/g, " ");
  }
}

export type DayFacts = { date: string; load: number | null; advocateThere: boolean | null; daysLater: number };
export type Explained = {
  happened: string;
  ruleId: string;
  rule: string;
  chosen: string | null;
  minDate: string | null;
  usual: number;
  facts: DayFacts | null;
  alts: (DayFacts & { tradeoff: string })[];
};

export function explainNextDate(run: Run, day: Day, l: Listing): Explained {
  const o = l.outcome;
  const nextPurpose = o?.next_purpose ?? l.purpose;
  const gap = IDEAL_GAP[nextPurpose] ?? 14;
  const id = ruleIdFor(run, day, l);
  const chosen = o?.next_date ?? null;
  const sizes = run.days.map((d) => d.listings.length).sort((a, b) => a - b);
  const usual = sizes.length ? sizes[Math.floor(sizes.length / 2)] : 0;
  const dates = run.days.map((d) => d.date);
  const facts = (date: string): DayFacts => {
    const d = run.days.find((x) => x.date === date);
    return {
      date,
      load: d ? d.listings.length : null,
      advocateThere: d ? d.listings.some((x) => x.advocate === l.advocate && x.case_id !== l.case_id) : null,
      daysLater: between(day.date, date),
    };
  };
  const minDate = id === "procedural" ? addDays(day.date, gap) : null;
  const alts: Explained["alts"] = [];
  if (chosen) {
    const later = dates.filter((d) => d > day.date);
    const i = later.indexOf(chosen);
    const cand = i >= 0 ? [later[i - 1], later[i + 1]] : [later.filter((d) => d < chosen).pop(), later.find((d) => d > chosen)];
    for (const c of cand) {
      if (!c) continue;
      const f = facts(c);
      const earlier = c < chosen;
      let t: string;
      if (earlier && minDate && c < minDate) t = `${between(c, chosen)} day${between(c, chosen) > 1 ? "s" : ""} sooner, but earlier than the next step needs.`;
      else if (earlier && f.load !== null && f.load > usual) t = `One sitting earlier, but the list is full: ${f.load - usual} matter${f.load - usual > 1 ? "s" : ""} risk not being reached.`;
      else if (earlier) t = "One sitting earlier, with room on the list.";
      else t = `${between(chosen, c)} more day${between(chosen, c) > 1 ? "s" : ""} for the parties to wait${f.advocateThere ? ", though the advocate is already in court that day" : ""}.`;
      alts.push({ ...f, tradeoff: t });
    }
  }
  return { happened: whatHappened(l), ruleId: id, rule: ruleText(id, nextPurpose, gap), chosen, minDate, usual, facts: chosen ? facts(chosen) : null, alts };
}

export function factLine(f: DayFacts, usual: number): string {
  const parts = [`${f.daysLater} days from today`];
  if (f.load === null) parts.push("beyond the simulated period");
  else parts.push(`${f.load} matters already listed (a usual day has ${usual})`);
  if (f.advocateThere) parts.push("the advocate already has matters that day: one trip");
  return parts.join(" · ");
}

export { dateLabel };
