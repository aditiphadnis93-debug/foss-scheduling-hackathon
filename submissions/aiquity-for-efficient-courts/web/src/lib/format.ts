export function pretty(code: string | null | undefined): string {
  if (!code) return "";
  return code
    .toLowerCase()
    .split("_")
    .map((w) => (w === "s351" ? "S351" : w === "bnss" ? "BNSS" : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

const SETUP_NAMES: Record<string, string> = {
  optimal: "Recommended list",
  baseline: "Current practice",
  block_schedule: "Block scheduling",
  cluster_by_advocate: "Cluster by advocate",
  fresh_matters_first: "Fresh matters first",
  morning_bench: "Morning bench",
  marathon_bench: "Full-day bench",
  new_judge_from_criminal_bar: "New judge (criminal bar)",
  agents: "Recommended list · people decided by AI agents (10 days)",
  combined: "One world: town + AI agents (20 days)",
};

/** A court setup's name in the judge's language. */
export function presetLabel(name: string): string {
  return SETUP_NAMES[name] ?? name.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

export function toMin(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m || 0);
}

export function toHHMM(mins: number): string {
  const m = Math.round(mins);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Deterministic (timezone-free) date labels so server and client render the same text. */
export function dateLabel(iso: string | null | undefined, withDay = false): string {
  if (!iso) return "--";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const wd = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${withDay ? wd + " " : ""}${d} ${MONTHS[m - 1]}${withDay ? "" : " " + y}`;
}

export function shortDate(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[(m || 1) - 1]}`;
}

export function daysBetween(a: string, b: string): number {
  const pa = a.split("-").map(Number);
  const pb = b.split("-").map(Number);
  return Math.round((Date.UTC(pb[0], pb[1] - 1, pb[2]) - Date.UTC(pa[0], pa[1] - 1, pa[2])) / 86400000);
}

export function ageFromWhy(why: string[]): number | null {
  for (const w of why) {
    const m = /age\s+([\d.]+)\s*y/i.exec(w);
    if (m) return Number(m[1]);
  }
  return null;
}

export function pct(v: number, d = 0): string {
  return `${(v * 100).toFixed(d)}%`;
}

export function downloadCsv(filename: string, rows: Record<string, unknown>[]): void {
  if (!rows.length) return;
  const cols = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** An engine "why listed" reason in the court's words (null = not worth showing a judge). */
export function whyText(w: string): string | null {
  let m: RegExpExecArray | null;
  if ((m = /^P\(moves forward\)\s*(\d+)%/.exec(w))) return `${m[1]}% chance it moves forward`;
  if ((m = /^age\s+([\d.]+)y/.exec(w))) return `pending ${m[1]} years`;
  if ((m = /^carried over x(\d+)/.exec(w))) return m[1] === "1" ? "not reached last time" : `not reached ${m[1]} times`;
  if (/^justice weight/.test(w)) return w.replace("justice weight", "priority");
  if (/^progress\s/.test(w)) return null;
  if (w === "preparedness confirmed") return "readiness confirmed by the parties";
  return w.replace(/^standby:\s*/, "standby: ");
}

export function whyList(why: string[]): string[] {
  return why.map(whyText).filter((x): x is string => !!x);
}
