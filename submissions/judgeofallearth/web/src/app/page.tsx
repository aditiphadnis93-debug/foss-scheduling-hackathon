"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { API, api, fmtDay, num } from "@/lib/api";
import { useRole } from "@/components/role";
import { Card, Empty, Tag } from "@/components/ui";

type Ws = { id: string; name: string; preset: string; roster: string; cases: number; clock: string | null; status: string; days_total: number; days_played: number };
type Preset = { id: string; label: string };
type Preview = {
  valid: number; error_count: number; errors: { row: number; case?: string; message: string }[];
  warnings: { row: number | null; message: string }[]; age_buckets: Record<string, number>; stages: Record<string, number>;
  advocates: number; as_of: string; sample: { case_id: string; filing_date: string; stage: string; purpose: string; advocate: string }[];
};

export default function Home() {
  const { role } = useRole();
  const [list, setList] = useState<Ws[] | null>(null);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [form, setForm] = useState({ name: "Court 1", roster: "generated", size: 3000, advocates: "uniform", preset: "balanced", seed: 0 });
  const [busy, setBusy] = useState(false);
  const [csv, setCsv] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = () => api<Ws[]>("/workspaces", role).then(setList).catch((e) => setErr(String(e.message)));
  useEffect(() => {
    load();
    api<Preset[]>("/presets", role).then(setPresets).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const create = async () => {
    setBusy(true);
    setErr(null);
    try {
      const body = form.roster === "csv" ? { ...form, csv } : form;
      const ws = await api<Ws>("/workspaces", role, { method: "POST", body: JSON.stringify(body) });
      window.location.href = `/w/${ws.id}`;
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  const onFile = async (f: File | undefined) => {
    setPreview(null);
    setErr(null);
    if (!f) return;
    const text = await f.text();
    setCsv(text);
    setFileName(f.name);
    try {
      setPreview(await api<Preview>("/roster/preview", role, { method: "POST", body: JSON.stringify({ csv: text }) }));
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  return (
    <div className="grid gap-6 md:grid-cols-[1fr_380px]">
      <div>
        <h1 className="mb-1 text-[26px] font-semibold tracking-tight">Courts</h1>
        <p className="mb-4 text-mut">Each workspace is one judge&apos;s roster over a posting. Open one to run it day by day.</p>
        {err && <p className="mb-3 text-sm text-bad">{err} — is the API running on :8765?</p>}
        {list === null ? (
          <Empty>Loading…</Empty>
        ) : list.length === 0 ? (
          <Empty>No courts yet. Create one on the right.</Empty>
        ) : (
          <div className="grid gap-3">
            {list.map((w) => (
              <Link key={w.id} href={`/w/${w.id}`} className="rounded-2xl border border-line bg-card p-5 transition hover:border-acc/50 hover:shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold">{w.name}</span>
                  <Tag tone={w.clock ? "acc" : "mut"}>{w.clock ? `Today: ${fmtDay(w.clock)}` : "Posting finished"}</Tag>
                </div>
                <div className="mt-1 text-sm text-mut">
                  {num(w.cases)} cases · {(w as Ws & { preset_label?: string }).preset_label ?? w.preset} · day {w.days_played} of {w.days_total}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      <Card title="New court" sub="Sets up the roster and plans day 1. Assumptions are listed in the submission write-up.">
        <div className="grid gap-3 text-sm">
          <label className="grid gap-1">
            <span className="text-mut">Name</span>
            <input className="rounded-xl border border-line bg-card px-3 py-2" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label className="grid gap-1">
            <span className="text-mut">Roster</span>
            <select className="rounded-xl border border-line bg-card px-3 py-2" value={form.roster} onChange={(e) => setForm({ ...form, roster: e.target.value })}>
              <option value="csv">Upload the judge&apos;s roster (CSV)</option>
              <option value="generated">Generated from the sample</option>
              <option value="sample">Organisers&apos; 100-case sample</option>
            </select>
          </label>
          {form.roster === "csv" && (
            <div className="grid gap-2 rounded-xl bg-soft/70 p-3">
              <input type="file" accept=".csv,text/csv" onChange={(e) => onFile(e.target.files?.[0])} className="text-[13px] file:mr-3 file:rounded-lg file:border-0 file:bg-card file:px-3 file:py-1.5 file:text-sm" />
              <p className="text-[12px] text-mut">
                One row per case. Needs <code>case_number</code>, <code>filing_date</code> (YYYY-MM-DD), <code>current_stage</code>, <code>purpose_of_next_hearing</code>; <code>advocate_id</code>,{" "}
                <code>total_hearings_held</code>, <code>hearings_&lt;type&gt;</code> and <code>last_hearing_summary</code> help if present.{" "}
                <a className="text-acc hover:underline" href={`${API}/api/roster/template.csv`}>Download a template</a>
              </p>
              {preview && (
                <div className="grid gap-2 text-[13px]">
                  <div>
                    <b className={preview.valid ? "text-acc" : "text-bad"}>{num(preview.valid)} cases ready</b>
                    {preview.error_count > 0 && <span className="text-bad"> · {preview.error_count} rows skipped</span>} · {preview.advocates} advocates{fileName ? ` · ${fileName}` : ""}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {Object.entries(preview.age_buckets).map(([b, n]) => (
                      <span key={b} className="rounded-full bg-card px-2 py-0.5 text-[12px] text-mut">{b} yrs: {n}</span>
                    ))}
                  </div>
                  {preview.errors.length > 0 && (
                    <div className="max-h-32 overflow-auto rounded-lg bg-bad/5 p-2 text-[12px] text-bad">
                      {preview.errors.map((e, i) => (
                        <div key={i}>Row {e.row}{e.case ? ` (${e.case})` : ""}: {e.message}</div>
                      ))}
                    </div>
                  )}
                  {preview.warnings.length > 0 && <div className="text-[12px] text-warn">{preview.warnings.length} warning(s), e.g. row {preview.warnings[0].row}: {preview.warnings[0].message}</div>}
                </div>
              )}
            </div>
          )}
          {form.roster === "generated" && (
            <>
              <label className="grid gap-1">
                <span className="text-mut">Cases</span>
                <input type="number" className="rounded-xl border border-line bg-card px-3 py-2" value={form.size} onChange={(e) => setForm({ ...form, size: Number(e.target.value) })} />
              </label>
              <label className="grid gap-1">
                <span className="text-mut">Advocate caseload</span>
                <select className="rounded-xl border border-line bg-card px-3 py-2" value={form.advocates} onChange={(e) => setForm({ ...form, advocates: e.target.value })}>
                  <option value="uniform">Even (organisers&apos; generator)</option>
                  <option value="lopsided">Lopsided (a few busy advocates)</option>
                </select>
              </label>
            </>
          )}
          <label className="grid gap-1">
            <span className="text-mut">Scheduling style</span>
            <select className="rounded-xl border border-line bg-card px-3 py-2" value={form.preset} onChange={(e) => setForm({ ...form, preset: e.target.value })}>
              {presets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1">
            <span className="text-mut">Seed</span>
            <input type="number" className="rounded-xl border border-line bg-card px-3 py-2" value={form.seed} onChange={(e) => setForm({ ...form, seed: Number(e.target.value) })} />
          </label>
          <button disabled={busy || !form.name || (form.roster === "csv" && !preview?.valid)} onClick={create} className="mt-1 rounded-xl bg-acc px-4 py-2.5 font-medium text-white transition hover:bg-acc/90 disabled:opacity-50">
            {busy ? "Setting up…" : form.roster === "csv" && preview?.valid ? `Create court with ${num(preview.valid)} cases` : "Create court"}
          </button>
        </div>
      </Card>
    </div>
  );
}
