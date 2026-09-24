"use client";

import HowLink from "@/components/ui/HowLink";
import Link from "next/link";
import { motion } from "framer-motion";
import { Lock } from "lucide-react";
import PageHeader from "@/components/shell/PageHeader";
import { Badge, Card, Skeleton } from "@/components/ui/Card";
import { useAsync } from "@/lib/data";
import { C } from "@/lib/theme";

type Setting = { key: string; group: string; name: string; what: string; default: unknown; range?: string; who_can_change: string; learned: string; in_simulation?: boolean; set_in?: string };
type Split = { listed_per_case: number; moved_per_case: number };
type LawyerRow = { bucket: string; cases: number; "Current practice": Split; "Recommended list": Split };
type Catalog = {
  settings: Setting[];
  floors: { name: string; rule: string }[];
  estimation: { step: string; how: string }[];
  advocate_rules?: { name: string; rule: string }[];
  lawyer_check?: { roster: number; rows: LawyerRow[]; takeaway: string } | null;
  where?: string;
};

const GROUPS = ["Court day", "Overbooking", "Fairness", "Advocates", "Priority", "Readiness", "People", "Dates", "Learning", "Judge", "Simulation"];

const load = () =>
  fetch("/data/settings_catalog.json")
    .then((r) => (r.ok ? (r.json() as Promise<Catalog>) : null))
    .catch(() => null);

function who(w: string): { label: string; colour: string } {
  if (/fixed|floor/i.test(w)) return { label: w.includes("above") ? "judge, above a fixed floor" : "fixed floor", colour: C.old };
  if (/court/i.test(w)) return { label: "court", colour: C.not_ready };
  return { label: "judge", colour: C.primary };
}

function show(v: unknown): string {
  if (v === null || v === undefined) return "--";
  if (typeof v === "boolean") return v ? "on" : "off";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export default function Settings() {
  const cat = useAsync(load, []);
  const groups = cat ? [...GROUPS.filter((g) => cat.settings.some((s) => s.group === g)), ...[...new Set(cat.settings.map((s) => s.group))].filter((g) => !GROUPS.includes(g))] : [];
  return (
    <div>
      <PageHeader eyebrow="Settings & rules" title="Every setting, who can change it, and what cannot move" lede="Each judge's setup is a short list of settings. Most can be changed by the judge; a few belong to the court's master list; the fairness floors cannot be moved by anyone." />
      {!cat ? (
        <Skeleton className="h-96" />
      ) : (
        <div className="flex flex-col gap-5">
          <Card className="border-l-2" title={<span className="flex items-center gap-2"><Lock size={16} className="text-old" /> Fairness floors: these cannot be moved</span>}>
            <HowLink id="fairness" label="Fairness" className="mb-2 inline-block" />
            <ul className="grid gap-2 md:grid-cols-2">
              {cat.floors.map((f) => (
                <li key={f.name} className="rounded-lg bg-surface-2 p-3">
                  <p className="text-[14px] font-medium text-text">{f.name}</p>
                  <p className="text-[13px] text-muted">{f.rule}</p>
                </li>
              ))}
            </ul>
          </Card>

          {cat.advocate_rules && (
            <Card title="Lawyers: are busy advocates favoured?">
              {cat.lawyer_check && <p className="mb-3 text-[14px] text-text">{cat.lawyer_check.takeaway}</p>}
              <ul className="grid gap-2 md:grid-cols-2">
                {cat.advocate_rules.map((f) => (
                  <li key={f.name} className="rounded-lg bg-surface-2 p-3">
                    <p className="text-[14px] font-medium text-text">{f.name}</p>
                    <p className="text-[13px] text-muted">{f.rule}</p>
                  </li>
                ))}
              </ul>
              {cat.lawyer_check && (
                <div className="scroll-thin mt-4 overflow-x-auto">
                  <p className="mb-2 text-[12px] text-muted">
                    Measured on the {cat.lawyer_check.roster.toLocaleString()}-case docket over the same posting: per case, how often it was listed and how often it moved forward, by how many cases its advocate carries.
                  </p>
                  <table className="w-full min-w-[620px] text-[13px]">
                    <thead className="text-left text-[11px] uppercase tracking-[0.08em] text-muted">
                      <tr>
                        {["Advocate carries", "Cases", "Listed per case (current / recommended)", "Moved forward per case (current / recommended)"].map((h) => (
                          <th key={h} className="border-b border-line py-2 pr-3 font-medium">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {cat.lawyer_check.rows.map((r) => (
                        <tr key={r.bucket} className="border-b border-line">
                          <td className="py-2 pr-3 text-text">{r.bucket}</td>
                          <td className="num py-2 pr-3 text-muted">{r.cases}</td>
                          <td className="num py-2 pr-3"><span className="text-base">{r["Current practice"].listed_per_case.toFixed(2)}</span> / <span className="text-primary">{r["Recommended list"].listed_per_case.toFixed(2)}</span></td>
                          <td className="num py-2 pr-3"><span className="text-base">{r["Current practice"].moved_per_case.toFixed(2)}</span> / <span className="text-sub">{r["Recommended list"].moved_per_case.toFixed(2)}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          )}

          {groups.map((g, gi) => (
            <Card key={g} title={g} delay={gi * 0.03}>
              <div className="scroll-thin overflow-x-auto">
                <table className="w-full min-w-[900px] text-[13px]">
                  <thead className="text-left text-[11px] uppercase tracking-[0.08em] text-muted">
                    <tr>
                      {["Setting", "What it does", "Default", "Range", "Who can change it", "Where", "Learned?"].map((h) => (
                        <th key={h} className="border-b border-line py-2 pr-3 font-medium">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {cat.settings.filter((s) => s.group === g).map((s) => {
                      const w = who(s.who_can_change);
                      return (
                        <tr key={s.key} className="border-b border-line align-top">
                          <td className="py-2 pr-3">
                            <p className="text-text">{s.name}</p>
                            {s.in_simulation && <Link href="/whatif" className="text-[12px] text-primary hover:underline">Try it in Simulation</Link>}
                          </td>
                          <td className="py-2 pr-3 text-muted">{s.what}</td>
                          <td className="num py-2 pr-3 text-text">{show(s.default)}</td>
                          <td className="num py-2 pr-3 text-muted">{s.range ?? "--"}</td>
                          <td className="py-2 pr-3"><Badge colour={w.colour}>{w.label}</Badge></td>
                          <td className="py-2 pr-3 text-[12px] text-muted">{s.in_simulation ? "Simulation or setup file" : "setup file"}</td>
                          <td className="py-2"><Badge colour={/^no/i.test(s.learned) ? C.baseline : C.substantive}>{/^no/i.test(s.learned) ? "no" : s.learned}</Badge></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          ))}

          <Card title="How the chances are estimated">
            <ol className="flex flex-col gap-3">
              {cat.estimation.map((e, i) => (
                <motion.li key={e.step} initial={{ opacity: 0, x: -8 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.06 }} className="flex gap-3">
                  <span className="num grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary-subtle text-[12px] font-medium text-primary">{i + 1}</span>
                  <span>
                    <span className="block text-[14px] font-medium text-text">{e.step}</span>
                    <span className="block text-[14px] text-muted">{e.how}</span>
                  </span>
                </motion.li>
              ))}
            </ol>
          </Card>
          {cat.where && <p className="text-[12px] text-faint">{cat.where}</p>}
        </div>
      )}
    </div>
  );
}
