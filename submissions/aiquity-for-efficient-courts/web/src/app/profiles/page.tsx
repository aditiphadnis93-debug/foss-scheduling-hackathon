"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Info, Search } from "lucide-react";
import clsx from "clsx";
import PageHeader from "@/components/shell/PageHeader";
import { DerivedNote, useRunPicker } from "@/components/shell/RunPicker";
import { Badge, Card, Skeleton, Takeaway } from "@/components/ui/Card";
import { Drawer } from "@/components/ui/Drawer";
import { Tabs } from "@/components/ui/Controls";
import { C } from "@/lib/theme";
import { pct } from "@/lib/format";
import { profilesOf, type Profile } from "@/lib/insights";
import PersonCalendar from "@/components/charts/PersonCalendar";
import type { Run } from "@/lib/types";

type Who = "advocates" | "parties";
type Sort = "hearings" | "appearance_rate" | "seek_ratio" | "trips";

export default function Profiles() {
  const { run, loading, controls } = useRunPicker("profiles");
  const prof = useMemo(() => (run ? profilesOf(run) : null), [run]);
  const [who, setWho] = useState<Who>("advocates");
  const [sort, setSort] = useState<Sort>("hearings");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Profile | null>(null);
  const list = useMemo(() => {
    const src = (prof?.[who] ?? []).filter((p) => !q.trim() || p.id.toLowerCase().includes(q.trim().toLowerCase()));
    return [...src].sort((a, b) => (b[sort] as number) - (a[sort] as number));
  }, [prof, who, sort, q]);
  const flagged = (prof?.[who] ?? []).filter((p) => p.gaming_flag).length;

  return (
    <div>
      <PageHeader
        eyebrow="Profiles"
        title="How each advocate and party actually shows up"
        lede="Appearance and readiness measured against what the hearing type predicts, with the uncertainty of a small sample shown honestly. A flag is a pattern worth a look, never a finding."
        right={controls}
      />
      {loading || !run || !prof ? (
        <Skeleton className="h-96" />
      ) : (
        <>
          <DerivedNote show={!!prof.derived} what="Profiles (appearance, readiness, time sought)" />
          <Card>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <Tabs<Who>
                id="who"
                value={who}
                onChange={setWho}
                tabs={[
                  { value: "advocates", label: `Advocates (${prof.advocates.length})` },
                  { value: "parties", label: `Parties (${prof.parties.length})` },
                ]}
              />
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
                  <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Search id"
                    className="mono w-40 rounded-lg border border-line bg-bg py-1.5 pl-8 pr-2 text-[13px] outline-none focus:ring-2 focus:ring-primary/40"
                  />
                </div>
                <select
                  value={sort}
                  onChange={(e) => setSort(e.target.value as Sort)}
                  className="rounded-lg border border-line bg-bg px-2 py-1.5 text-[13px]"
                  aria-label="Sort by"
                >
                  <option value="hearings">Most hearings</option>
                  <option value="appearance_rate">Appearance rate</option>
                  <option value="seek_ratio">Time sought</option>
                  <option value="trips">Trips to court</option>
                </select>
              </div>
            </div>
            {list.length === 0 ? (
              <p className="py-8 text-center text-[13px] text-muted">
                {who === "parties" ? "Party details are exported for the 100-case roster; switch roster to see party profiles." : "No profiles for this run."}
              </p>
            ) : (
              <div className="scroll-thin max-h-[560px] overflow-auto">
                <table className="w-full min-w-[820px] whitespace-nowrap text-[13px]">
                  <thead className="sticky top-0 bg-surface text-left text-[11px] uppercase tracking-[0.08em] text-muted">
                    <tr>
                      {["Id", "Hearings", "Appearance vs expected", "Ready to proceed", "Time sought", "Trips", "Minutes lost", ""].map((h) => (
                        <th key={h} className="border-b border-line px-2 py-2 font-medium">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {list.slice(0, 300).map((p) => (
                      <tr key={p.id} onClick={() => setOpen(p)} className="cursor-pointer border-b border-line hover:bg-surface-2">
                        <td className="mono px-2 py-2 text-text">{p.id}</td>
                        <td className="num px-2 py-2">{p.hearings}</td>
                        <td className="px-2 py-2">
                          <Band p={p} />
                        </td>
                        <td className="num px-2 py-2">{pct(p.readiness_rate)}</td>
                        <td className={clsx("num px-2 py-2", p.seek_ratio >= 0.25 && "text-adj")}>{pct(p.seek_ratio)}</td>
                        <td className="num px-2 py-2">{p.trips}</td>
                        <td className="num px-2 py-2">{Math.round(p.delay_minutes)}</td>
                        <td className="px-2 py-2">{p.gaming_flag && <Badge colour={C.adjourned}>pattern to review</Badge>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <Takeaway>
              The bar is this {who === "advocates" ? "advocate" : "party"}&apos;s appearance rate with its 90% band; the tick is
              what the hearing mix predicts. A band that sits clear of the tick is a real difference; a wide band is too few
              hearings to say. {flagged > 0 ? `${flagged} flagged for review.` : "No one is flagged in this run."}
            </Takeaway>
          </Card>
        </>
      )}
      <Drawer open={!!open} onClose={() => setOpen(null)} title={<span className="mono">{open?.id}</span>}>
        {open && run && <Detail p={open} run={run} kind={who === "advocates" ? "advocate" : "party"} />}
      </Drawer>
    </div>
  );
}

function Band({ p }: { p: Profile }) {
  const post = p.posterior;
  const exp = p.expected_appearance;
  return (
    <div className="flex items-center gap-2">
      <div className="relative h-3 w-40 rounded bg-surface-2">
        {post && (
          <div
            className="absolute inset-y-0 rounded"
            style={{ left: `${post.lo90 * 100}%`, width: `${(post.hi90 - post.lo90) * 100}%`, background: "var(--primary-soft)" }}
          />
        )}
        <motion.div className="absolute top-1/2 h-1 -translate-y-1/2 rounded bg-primary" initial={{ width: 0 }} animate={{ width: `${p.appearance_rate * 100}%` }} />
        {exp !== undefined && <div className="absolute -top-0.5 h-4 w-0.5 bg-text" style={{ left: `${exp * 100}%` }} title="Expected for this hearing mix" />}
      </div>
      <span className="num text-[12px] text-muted">{pct(p.appearance_rate)}</span>
    </div>
  );
}

function Detail({ p, run, kind }: { p: Profile; run: Run; kind: "advocate" | "party" }) {
  const reasons = Object.entries(p.adjournments_by_reason ?? {}).sort((a, b) => b[1] - a[1]);
  const maxR = Math.max(1, ...reasons.map((r) => r[1]));
  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-2">
        <Mini label="Hearings" value={String(p.hearings)} />
        <Mini label="Trips to court" value={String(p.trips)} />
        <Mini label="Appearance" value={pct(p.appearance_rate)} />
        <Mini label="Expected" value={p.expected_appearance !== undefined ? pct(p.expected_appearance) : "--"} />
        <Mini label="Ready to proceed" value={pct(p.readiness_rate)} />
        <Mini label="Time sought" value={pct(p.seek_ratio)} />
      </div>
      {p.posterior && (
        <div>
          <p className="mb-2 text-[12px] uppercase tracking-[0.12em] text-muted">Appearance, with uncertainty</p>
          <Band p={p} />
          <p className="mt-2 text-[12px] text-muted">
            90% band {pct(p.posterior.lo90)} to {pct(p.posterior.hi90)} from {p.posterior.n} hearings
            {p.p_exceed !== undefined ? ` · chance the true rate of time-seeking is above normal: ${pct(p.p_exceed)}` : ""}.
          </p>
        </div>
      )}
      {p.gaming_flag && (
        <div className="rounded-lg border border-line bg-surface-2 p-4">
          <p className="flex items-center gap-2 text-[13px] font-medium text-text">
            <Info size={15} className="text-adj" /> Pattern to review
          </p>
          <p className="mt-1 text-[13px] text-muted">
            Time was sought more often than expected as cases neared evidence or judgement. This is the evidence the model
            saw, for the court to weigh; it is not a finding against anyone. The response is a firm, short last-chance
            date, and the other side is not penalised.
          </p>
          <Evidence ev={p.evidence} />
        </div>
      )}
      {reasons.length > 0 && (
        <div>
          <p className="mb-2 text-[12px] uppercase tracking-[0.12em] text-muted">Lost hearings by reason</p>
          <div className="flex flex-col gap-1.5">
            {reasons.map(([r, n]) => (
              <div key={r} className="grid grid-cols-[1fr_120px_28px] items-center gap-2 text-[12px]">
                <span className="truncate text-text" title={r}>
                  {r}
                </span>
                <div className="h-2 rounded bg-surface-2">
                  <div className="h-2 rounded bg-adj" style={{ width: `${(n / maxR) * 100}%` }} />
                </div>
                <span className="num text-right text-muted">{n}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <div>
        <p className="mb-2 text-[12px] uppercase tracking-[0.12em] text-muted">Calendar</p>
        <PersonCalendar run={run} who={{ kind, id: p.id }} />
      </div>
      <div>
        <p className="mb-2 text-[12px] uppercase tracking-[0.12em] text-muted">Cases ({p.case_ids.length})</p>
        <div className="flex flex-wrap gap-1.5">
          {p.case_ids.slice(0, 80).map((c) => (
            <span key={c} className="mono rounded bg-surface-2 px-1.5 py-0.5 text-[11px] text-muted">
              {c}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function Evidence({ ev }: { ev: Profile["evidence"] }) {
  if (!ev) return null;
  if (typeof ev === "string") return <p className="mt-2 text-[12px] text-muted">{ev}</p>;
  return (
    <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px]">
      {Object.entries(ev).map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-faint">{k.replace(/_/g, " ")}</dt>
          <dd className="num text-text">{typeof v === "number" ? (v < 1 && v > 0 ? pct(v) : String(v)) : JSON.stringify(v)}</dd>
        </div>
      ))}
    </dl>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-surface-2 px-3 py-2">
      <p className="text-[11px] uppercase tracking-[0.08em] text-faint">{label}</p>
      <p className="num text-[15px] text-text">{value}</p>
    </div>
  );
}
