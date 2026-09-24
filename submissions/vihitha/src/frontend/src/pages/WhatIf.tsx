import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, FlaskConical, Lock, Play, Users } from 'lucide-react'
import { api, errMsg } from '../api/client'
import { qk, refreshAll } from '../api/queries'
import type { RulesBody, WhatIfRequest, WhatIfResult } from '../api/types'
import { NeedRoster, useApp } from '../lib/app'
import { fullDay, midDate, parseISO, pct0, planSentence, prob, shortDate } from '../lib/format'
import { DayCalendar } from '../components/DayCalendar'
import {
  cx, EmptyState, ErrorCard, Guardrail, InfoTip, KpiCard, Modal, PageHeader, Segmented, Skeleton, SkeletonCards, Spinner, Toggle,
} from '../components/ui'

type Controls = { fill: number; quota: number; byAdvocate: boolean; carry: boolean; prereq: boolean }
const fromRules = (r: RulesBody): Controls => ({
  fill: Math.round((r.fill_target ?? 1) * 100), quota: r.ageing_quota_pct, byAdvocate: r.clustering.by_advocate,
  carry: r.carry_forward_same_weekday, prereq: r.prerequisite_check,
})
const QUOTA_MIN = 20

export default function WhatIf() {
  return <NeedRoster><WhatIfInner /></NeedRoster>
}

function WhatIfInner() {
  const { today, health, toast, toastError, confirm } = useApp()
  const qc = useQueryClient()
  const presetsQ = useQuery({ queryKey: qk.presets, queryFn: api.presets, staleTime: Infinity })
  const setsQ = useQuery({ queryKey: qk.rulesets, queryFn: api.rulesets })
  const presets = presetsQ.data?.presets ?? []
  const sets = setsQ.data?.items ?? []

  const [source, setSource] = useState<string>('')
  useEffect(() => {
    if (source || !presets.length) return
    const alt = presets.find((p) => p.id !== 'baseline' && !sets.find((s) => s.is_active && s.preset === p.id)) ?? presets[0]
    setSource(`preset:${alt.id}`)
  }, [presets, sets, source])
  const [kind, idStr] = source.split(':')
  const rulesetQ = useQuery({ queryKey: qk.ruleset(Number(idStr)), queryFn: () => api.ruleset(Number(idStr)), enabled: kind === 'ruleset' && !!idStr })
  const base: RulesBody | undefined = kind === 'preset' ? presets.find((p) => p.id === idStr)?.rules : rulesetQ.data?.ruleset.rules
  const baseName = kind === 'preset' ? presets.find((p) => p.id === idStr)?.name : rulesetQ.data?.ruleset.name

  const [ctl, setCtl] = useState<Controls | null>(null)
  useEffect(() => { if (base) setCtl(fromRules(base)) }, [base])
  const edited = useMemo(() => !!base && !!ctl && JSON.stringify(fromRules(base)) !== JSON.stringify(ctl), [base, ctl])

  const [horizon, setHorizon] = useState<'30' | '60' | '90'>('30')
  const [agents, setAgents] = useState(false)
  const [compare, setCompare] = useState<string>('ACTIVE')
  const [focus, setFocus] = useState('')
  const focusDate = focus || today

  const [result, setResult] = useState<WhatIfResult | null>(null)
  const [running, setRunning] = useState(false)
  const [runErr, setRunErr] = useState<string | null>(null)
  const [applyOpen, setApplyOpen] = useState(false)

  const buildRequest = (f = focusDate): WhatIfRequest | null => {
    if (!base || !ctl) return null
    const common = {
      compare_to: compare === 'ACTIVE' || compare === 'BASELINE' ? compare : Number(compare),
      horizon_days: Number(horizon) as 30 | 60 | 90, focus_date: f || undefined, agents,
    } as const
    if (edited) {
      const rules: RulesBody = {
        ...base, name: `${baseName ?? base.name} (edited)`, preset: 'custom',
        fill_target: ctl.fill / 100, ageing_quota_pct: ctl.quota,
        clustering: { ...base.clustering, by_advocate: ctl.byAdvocate },
        carry_forward_same_weekday: ctl.carry, prerequisite_check: ctl.prereq,
        agents: { ...base.agents, enabled: agents },
      }
      return { ...common, rules }
    }
    return kind === 'preset' ? { ...common, preset: idStr } : { ...common, ruleset_id: Number(idStr) }
  }

  const run = async (f?: string) => {
    const body = buildRequest(f)
    if (!body) return
    setRunning(true); setRunErr(null)
    try { setResult(await api.whatif(body)) } catch (e) { setRunErr(errMsg(e)) } finally { setRunning(false) }
  }

  const applyNow = async (name: string) => {
    if (!result) return
    if (!(await confirm({
      title: 'Make these the court’s rules?',
      body: <p>Vihitha will switch to these rules and re-plan the <b>draft</b> days from {midDate(today)}. Published and closed days do not change.</p>,
      confirmLabel: 'Apply these rules',
    }))) return
    try {
      const r = await api.applyWhatif(result.id, { from_date: today, name: name || undefined })
      setApplyOpen(false)
      await refreshAll(qc)
      toast({ msg: `“${r.active_ruleset.name}” is now active. ${planSentence(r.plan)}` })
    } catch (e) { toastError(e) }
  }

  return (
    <>
      <PageHeader title="What-If" sub="Try different rules on a copy of the real schedule. Nothing changes until you press Apply." />
      <div className="grid grid-cols-1 xl:grid-cols-[340px_minmax(0,1fr)] gap-6 items-start">
        {/* ---------- controls ---------- */}
        <aside className="card p-5 flex flex-col gap-5 xl:sticky xl:top-20">
          <label className="flex flex-col gap-1.5">
            <span className="label">Start from</span>
            <select className="input" value={source} onChange={(e) => { setSource(e.target.value); setResult(null) }}>
              {!source && <option value="">Loading…</option>}
              <optgroup label="Presets">{presets.map((p) => <option key={p.id} value={`preset:${p.id}`}>{p.name}</option>)}</optgroup>
              {sets.length > 0 && <optgroup label="Saved rule sets">{sets.map((s) => <option key={s.id} value={`ruleset:${s.id}`}>{s.name}{s.is_active ? ' (active)' : ''}</option>)}</optgroup>}
            </select>
            {kind === 'preset' && <span className="text-xs text-muted">{presets.find((p) => p.id === idStr)?.description}</span>}
          </label>

          {!ctl ? <Skeleton className="h-64" /> : <>
            <div className="flex flex-col gap-1">
              <span className="label flex items-center justify-between">Day filled to<span className="num text-navy text-sm normal-case">{ctl.fill}%</span></span>
              <input type="range" min={60} max={120} step={5} value={ctl.fill} onChange={(e) => setCtl({ ...ctl, fill: Number(e.target.value) })} aria-label="Fill target percent" className="accent-teal" />
              <span className="text-xs text-muted">How much of the 420 minutes to plan, counting likely adjournments as short.</span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="label flex items-center justify-between"><span className="inline-flex items-center gap-1"><Lock size={12} />Share for 4+ year cases</span><span className="num text-navy text-sm normal-case">{ctl.quota}%</span></span>
              <input type="range" min={0} max={60} step={5} value={ctl.quota} onChange={(e) => setCtl({ ...ctl, quota: Number(e.target.value) })} aria-label="Ageing quota percent" className="accent-teal" />
              {ctl.quota < QUOTA_MIN
                ? <Guardrail>Old cases can never get less than {QUOTA_MIN}% of the day. Vihitha will keep it at {QUOTA_MIN}%.</Guardrail>
                : <span className="text-xs text-muted">Minimum share of each day kept for cases over 4 years old. Locked at {QUOTA_MIN}% or more.</span>}
            </div>
            <Toggle on={ctl.byAdvocate} onChange={(v) => setCtl({ ...ctl, byAdvocate: v })} label="Group by advocate" hint="List an advocate's matters on the same day" />
            <Toggle on={ctl.carry} onChange={(v) => setCtl({ ...ctl, carry: v })} label="Carry forward to the same weekday" hint="Matters not reached return next week, same day" />
            <Toggle on={ctl.prereq} onChange={(v) => setCtl({ ...ctl, prereq: v })} label="Check prerequisites" hint="Hold back matters waiting on summons or warrants" />
            {edited && <p className="text-xs text-teal-text">You changed these rules. They will be tried as a custom set.</p>}
          </>}

          <hr className="border-line" />
          <div className="flex flex-col gap-1.5">
            <span className="label">Look ahead</span>
            <Segmented label="Horizon" value={horizon} onChange={setHorizon} options={[{ value: '30', label: '30 days' }, { value: '60', label: '60 days' }, { value: '90', label: '90 days' }]} />
          </div>
          <Toggle on={agents} onChange={setAgents} label="Behaviour of parties" hint="Simulate litigants and advocates deciding whether to turn up" />
          <label className="flex flex-col gap-1.5">
            <span className="label">Compare with</span>
            <select className="input" value={compare} onChange={(e) => setCompare(e.target.value)}>
              <option value="ACTIVE">Current rules{health?.active_ruleset ? ` (${health.active_ruleset.name})` : ''}</option>
              <option value="BASELINE">Baseline (60 a day, 60-day gap)</option>
              {sets.map((s) => <option key={s.id} value={String(s.id)}>{s.name}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="label">Day to look at</span>
            <input type="date" className="input" value={focusDate} onChange={(e) => setFocus(e.target.value)} />
          </label>
          <button className="btn-primary h-12" onClick={() => run()} disabled={running || !ctl}>{running ? <Spinner light /> : <Play size={18} />}Run</button>
          <button className="btn-secondary" onClick={() => setApplyOpen(true)} disabled={!result || running}><CheckCircle2 size={18} />Apply these rules</button>
          {!result && <p className="text-xs text-muted -mt-2">Run first to see what the rules would do.</p>}
        </aside>

        {/* ---------- results ---------- */}
        <section className="flex flex-col gap-5 min-w-0">
          {runErr && <ErrorCard msg={runErr} onRetry={() => run()} />}
          {running && !result && <><SkeletonCards n={4} /><Skeleton className="h-[480px]" /></>}
          {!running && !result && !runErr && (
            <EmptyState icon={<FlaskConical size={40} strokeWidth={1.5} />} title="Try a set of rules">
              Pick a starting point, adjust the five controls and press Run. You will see the chosen day, the next month, and the four measures side by side with {compare === 'BASELINE' ? 'the baseline' : 'your current rules'}.
            </EmptyState>
          )}
          {result && <Results r={result} running={running} onPickDay={(d) => { setFocus(d); run(d) }} />}
        </section>
      </div>
      <ApplyModal open={applyOpen} onClose={() => setApplyOpen(false)} defaultName={edited ? `${baseName ?? 'Custom'} (edited)` : baseName ?? ''} onApply={applyNow} />
    </>
  )
}

function Results({ r, running, onPickDay }: { r: WhatIfResult; running: boolean; onPickDay: (d: string) => void }) {
  const fd = r.focus_day, cmp = r.focus_day_compare
  return (
    <div className={cx('flex flex-col gap-5 transition-opacity', running && 'opacity-60')}>
      {r.warnings.length > 0 && <div className="flex flex-col gap-2">{r.warnings.map((w, i) => <Guardrail key={i}>{w.message}</Guardrail>)}</div>}
      <div className="grid grid-cols-2 2xl:grid-cols-4 gap-4">{r.kpis.map((k) => <KpiCard key={k.key} kpi={k} compareLabel={r.compare_label} />)}</div>

      {(r.cost_sentences.length > 0 || r.agents_effect || r.advocate_trips) && (
        <div className="card p-5 flex flex-col gap-2">
          <h2 className="font-bold">What these rules cost and gain</h2>
          <ul className="list-disc pl-5 flex flex-col gap-1 text-sm">{r.cost_sentences.map((s, i) => <li key={i}>{s}</li>)}</ul>
          {r.agents_effect && <p className="text-sm flex items-start gap-2"><Users size={16} className="text-teal-text mt-0.5 shrink-0" /><span>{r.agents_effect.sentence} <span className="text-muted num">(turn-up {prob(r.agents_effect.show_rate_without)} → {prob(r.agents_effect.show_rate_with)})</span></span></p>}
          {r.advocate_trips && <p className="text-sm text-muted">{r.advocate_trips.sentence}</p>}
        </div>
      )}

      <div className="card p-5 flex flex-col gap-3">
        <div className="flex items-baseline justify-between flex-wrap gap-2">
          <h2 className="font-bold">{fullDay(fd.date)} under these rules</h2>
          <span className="text-sm num text-muted">
            {fd.totals.listed} listed · {pct0(fd.totals.load_pct)} full · {fd.totals.old_cases} old
            <span className="mx-2">|</span>{r.compare_label}: {cmp.listed} listed · {pct0(cmp.load_pct)} full · {cmp.old_cases} old
          </span>
        </div>
        <DayCalendar day={fd} readOnly scale={1.05} />
      </div>

      <MonthStrip r={r} onPick={onPickDay} />
    </div>
  )
}

function MonthStrip({ r, onPick }: { r: WhatIfResult; onPick: (d: string) => void }) {
  const days = r.month.filter((d) => d.sitting)
  const max = Math.max(110, ...days.flatMap((d) => [d.load_pct, d.compare_load_pct]))
  const H = 140
  return (
    <div className="card p-5 flex flex-col gap-3">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <h2 className="font-bold inline-flex items-center">How full each day is<InfoTip label="Month strip" tip="Bars are these rules. The dark tick is the comparison. The dashed line is 100% of the 420 minutes. Click a day to look at it." /></h2>
        <span className="flex gap-4 text-xs text-muted">
          <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-teal" />These rules</span>
          <span className="inline-flex items-center gap-1"><span className="w-3 h-0.5 bg-navy" />{r.compare_label}</span>
        </span>
      </div>
      {days.length === 0 ? <p className="text-sm text-muted">No sitting days in this range.</p> : (
        <div className="overflow-x-auto">
          <div className="relative flex items-end gap-[3px] min-w-full" style={{ height: H + 36, width: Math.max(days.length * 22, 400) }}>
            <div className="absolute left-0 right-0 border-t border-dashed border-muted" style={{ bottom: 36 + (100 / max) * H }} aria-hidden />
            {days.map((d) => {
              const h = (d.load_pct / max) * H, ch = (d.compare_load_pct / max) * H
              const focus = d.date === r.focus_day.date
              const dt = parseISO(d.date)
              return (
                <button key={d.date} onClick={() => onPick(d.date)} className="relative flex-1 min-w-[18px] flex flex-col items-center justify-end group" style={{ height: H + 36 }}
                  title={`${midDate(d.date)}: ${d.listed} listed, ${pct0(d.load_pct)} full, about ${d.expected_moved_forward.toFixed(1)} moved forward, ${d.old_cases} old. ${r.compare_label}: ${d.compare_listed} listed, ${pct0(d.compare_load_pct)}.`}>
                  <span className={cx('w-full rounded-t', d.load_pct > 100 ? 'bg-amber' : 'bg-teal', focus ? 'ring-2 ring-blue' : 'group-hover:opacity-80')} style={{ height: Math.max(2, h) }} />
                  <span className="absolute left-0 right-0 h-0.5 bg-navy" style={{ bottom: 36 + ch }} />
                  <span className={cx('h-9 pt-1 text-[10px] num leading-tight text-center', focus ? 'text-blue font-bold' : 'text-muted')}>{dt.getDate()}<br />{dt.getDate() <= 7 || d === days[0] ? shortDate(d.date).split(' ')[1] : ''}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function ApplyModal({ open, onClose, defaultName, onApply }: { open: boolean; onClose: () => void; defaultName: string; onApply: (name: string) => Promise<void> }) {
  const [name, setName] = useState(defaultName)
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (open) setName(defaultName) }, [open, defaultName])
  return (
    <Modal open={open} onClose={onClose} title="Apply these rules"
      footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn-primary" disabled={busy} onClick={async () => { setBusy(true); try { await onApply(name) } finally { setBusy(false) } }}>{busy && <Spinner light />}Apply</button></>}>
      <p>The rules are saved as a rule set and become the active rules. Draft days are re-planned. Published days stay as they are.</p>
      <label className="flex flex-col gap-1.5"><span className="label">Name for this rule set</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></label>
    </Modal>
  )
}
