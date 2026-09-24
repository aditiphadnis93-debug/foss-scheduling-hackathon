import { useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Database, Shuffle, Upload } from 'lucide-react'
import { api, ApiError, errMsg } from '../../api/client'
import { qk, refreshAll } from '../../api/queries'
import type { PlanSummary, RosterLoadRequest } from '../../api/types'
import { useApp } from '../../lib/app'
import { AGE_COLOR, ageLabel, htLabel, num, pct0, planSentence } from '../../lib/format'
import { HBars } from '../../components/charts'
import { ErrorCard, Guardrail, Skeleton, Spinner, StatCard } from '../../components/ui'

export default function RosterTab() {
  const { toast, toastError, confirm } = useApp()
  const qc = useQueryClient()
  const q = useQuery({ queryKey: qk.roster, queryFn: api.rosterSummary })
  const [n, setN] = useState(3000)
  const [seed, setSeed] = useState(42)
  const [busy, setBusy] = useState<string | null>(null)
  const [plan, setPlan] = useState<PlanSummary | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = async (key: string, make: (reset: boolean) => RosterLoadRequest | FormData) => {
    setBusy(key)
    try {
      let r
      try { r = await api.loadRoster(make(false)) } catch (e) {
        if (!(e instanceof ApiError && e.status === 409)) throw e
        const ok = await confirm({
          title: 'Replace the current roster?',
          body: <p>A roster and schedule already exist. Loading a new roster <b>wipes every hearing, outcome and published day</b> and plans again from scratch. Rule sets and leave are kept.</p>,
          confirmLabel: 'Replace roster', danger: true,
        })
        if (!ok) return
        r = await api.loadRoster(make(true))
      }
      setPlan(r.plan)
      await refreshAll(qc)
      toast({ msg: `Loaded ${num(r.roster.cases)} cases. ${planSentence(r.plan)}` })
    } catch (e) { toastError(e) } finally { setBusy(null) }
  }

  const upload = (f: File) => load('upload', (reset) => {
    const fd = new FormData()
    fd.append('source', 'UPLOAD'); fd.append('file', f); fd.append('reset', String(reset))
    return fd
  })

  const s = q.data
  return (
    <>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="card p-5 flex flex-col gap-3">
          <h2 className="font-bold flex items-center gap-2"><Database size={18} className="text-teal" />Sample roster</h2>
          <p className="text-sm text-muted">The organisers' 100-case sample. Quick to load and good for a first look.</p>
          <button className="btn-primary mt-auto" disabled={!!busy} onClick={() => load('sample', (reset) => ({ source: 'SAMPLE', reset }))}>{busy === 'sample' && <Spinner light />}Use sample</button>
        </div>
        <div className="card p-5 flex flex-col gap-3">
          <h2 className="font-bold flex items-center gap-2"><Shuffle size={18} className="text-teal" />Generate a roster</h2>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1"><span className="label">Cases</span><input type="number" min={10} max={20000} className="input num" value={n} onChange={(e) => setN(Number(e.target.value))} /></label>
            <label className="flex flex-col gap-1"><span className="label">Seed</span><input type="number" className="input num" value={seed} onChange={(e) => setSeed(Number(e.target.value))} /></label>
          </div>
          <p className="text-xs text-muted">The same seed always gives the same roster.</p>
          <button className="btn-primary mt-auto" disabled={!!busy || n < 1} onClick={() => load('gen', (reset) => ({ source: 'GENERATE', n, seed, reset }))}>{busy === 'gen' && <Spinner light />}Generate</button>
        </div>
        <div className="card p-5 flex flex-col gap-3">
          <h2 className="font-bold flex items-center gap-2"><Upload size={18} className="text-teal" />Upload a roster CSV</h2>
          <p className="text-sm text-muted">Same columns as the hackathon roster file (filing number, case number, filing date, advocate, party, next purpose, hearing counts…).</p>
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = '' }} />
          <button className="btn-secondary mt-auto" disabled={!!busy} onClick={() => fileRef.current?.click()}>{busy === 'upload' && <Spinner />}Choose file</button>
        </div>
      </div>

      {plan && (
        <div className="card p-4 text-sm flex flex-col gap-2">
          <p><b>Planned</b> {plan.from} to {plan.last_date ?? plan.to}. {planSentence(plan)}</p>
          {plan.warnings.map((w, i) => <Guardrail key={i}>{w.message}</Guardrail>)}
        </div>
      )}

      {q.error ? <ErrorCard msg={errMsg(q.error)} onRetry={() => q.refetch()} /> : !s ? <Skeleton className="h-64" /> : s.cases === 0 ? (
        <div className="card p-8 text-center text-muted">No roster loaded yet. Choose one of the options above.</div>
      ) : (
        <>
          <div className="grid grid-cols-2 xl:grid-cols-5 gap-4">
            <StatCard label="Cases" value={num(s.cases)} sub={`${num(s.pending)} pending · ${num(s.disposed)} disposed`} />
            <StatCard label="Advocates" value={num(s.advocates)} />
            <StatCard label="4+ years old" value={pct0(s.pct_4y_plus)} />
            <StatCard label="5+ years old" value={pct0(s.pct_5y_plus)} />
            <StatCard label="Source" value={<span className="text-xl">{s.source ?? '—'}</span>} sub={s.seed != null ? `Seed ${s.seed}` : undefined} />
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <section className="card p-5"><h3 className="font-bold mb-3">Pending cases by stage</h3>
              <HBars rows={s.by_stage.map((x) => ({ label: htLabel(x.stage), value: x.count }))} fmt={(v) => num(v)} /></section>
            <section className="card p-5"><h3 className="font-bold mb-3">By age</h3>
              <ul className="flex flex-col gap-2">
                {s.by_bucket.map((b) => {
                  const max = Math.max(1, ...s.by_bucket.map((x) => x.count))
                  return (
                    <li key={b.bucket} className="grid grid-cols-[90px_1fr] items-center gap-3 text-sm">
                      <span className="text-muted">{ageLabel(b.bucket)}</span>
                      <span className="flex items-center gap-2"><span className="h-5 rounded-r" style={{ width: `${(b.count / max) * 85}%`, background: AGE_COLOR[b.bucket] }} /><span className="num font-semibold">{num(b.count)}</span></span>
                    </li>
                  )
                })}
              </ul>
            </section>
          </div>
        </>
      )}
    </>
  )
}
