import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ChevronDown, Download, Trophy } from 'lucide-react'
import { api, errMsg, exportUrls } from '../api/client'
import { qk } from '../api/queries'
import type { MetricsSummary, Scoring } from '../api/types'
import { NeedRoster, useApp } from '../lib/app'
import { AGE_BUCKETS, AGE_COLOR, ageLabel, dayMonthYear, htLabel, num, shortDate } from '../lib/format'
import { LineChart, StackedBars } from '../components/charts'
import { AgeChip, cx, DeltaTag, ErrorCard, InfoTip, KpiCard, PageHeader, Segmented, Skeleton, SkeletonCards, StatCard } from '../components/ui'

export default function Metrics() {
  return <NeedRoster><MetricsInner /></NeedRoster>
}

function MetricsInner() {
  const q = useQuery({ queryKey: qk.metrics, queryFn: () => api.metrics() })
  if (q.error) return <><PageHeader title="Metrics" /><ErrorCard msg={errMsg(q.error)} onRetry={() => q.refetch()} /></>
  const m = q.data
  return (
    <>
      <PageHeader title="Metrics" sub={m ? `${dayMonthYear(m.from)} to ${dayMonthYear(m.to)}. Past weeks use what was recorded in court. Later weeks are a forecast.` : 'How the court is doing.'}>
        <a className="btn-secondary" href={exportUrls.proposedSchedule()} download><Download size={16} />Export schedule CSV</a>
      </PageHeader>
      {!m ? <><SkeletonCards n={4} /><Skeleton className="h-72" /><Skeleton className="h-72" /></> : <Body m={m} />}
      <ScoringSection />
    </>
  )
}

function Body({ m }: { m: MetricsSummary }) {
  const firstFc = m.weekly.findIndex((w) => w.is_forecast)
  const labels = m.weekly.map((w) => shortDate(w.week_start))
  const bl = m.backlog_by_age
  return (
    <>
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">{m.kpis.map((k) => <KpiCard key={k.key} kpi={k} compareLabel="Baseline" />)}</div>

      <div className="grid grid-cols-1 2xl:grid-cols-2 gap-6">
        <section className="card p-5 flex flex-col gap-3">
          <h2 className="font-bold">Cases moved forward each week</h2>
          <LineChart label="Cases moved forward per week" labels={labels} dashFrom={firstFc < 0 ? undefined : firstFc}
            series={[{ label: 'Moved forward', color: '#0F8B8D', values: m.weekly.map((w) => w.moved_forward) }]} yFmt={(v) => String(Math.round(v))} />
        </section>
        <section className="card p-5 flex flex-col gap-3">
          <h2 className="font-bold">Court time used and promises kept</h2>
          <LineChart label="Court time used and heard on promised date, per week" labels={labels} dashFrom={firstFc < 0 ? undefined : firstFc} yMax={110}
            refLine={{ value: 100, label: '420 min' }}
            series={[
              { label: 'Court time used', color: '#1E5AA8', values: m.weekly.map((w) => w.court_time_pct) },
              { label: 'Heard on promised date', color: '#D98E04', values: m.weekly.map((w) => w.heard_on_promised_pct) },
            ]} yFmt={(v) => `${Math.round(v)}%`} />
        </section>
      </div>

      <section className="card p-5 flex flex-col gap-3">
        <h2 className="font-bold inline-flex items-center">Pending cases by age<InfoTip label="Backlog by age" tip="Pending cases each week, split by how old they are. Lighter bars are forecast weeks." /></h2>
        <StackedBars label="Backlog by case age" labels={bl.map((b) => shortDate(b.week_start))} keys={AGE_BUCKETS.map(ageLabel)} colors={AGE_BUCKETS.map((b) => AGE_COLOR[b])}
          data={bl.map((b) => AGE_BUCKETS.map((k) => b.buckets[k] ?? 0))} faded={bl.map((b) => b.is_forecast)} />
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_280px] gap-6 items-start">
        <NeedsAttention m={m} />
        <div className="flex flex-col gap-4">
          <StatCard label="Cases likely to end this month" value={num(m.cases_ending.this_month)} />
          <StatCard label="Likely to end next month" value={num(m.cases_ending.next_month)} />
        </div>
      </div>
    </>
  )
}

function NeedsAttention({ m }: { m: MetricsSummary }) {
  const { openCase } = useApp()
  const [sel, setSel] = useState(0)
  const groups = m.needs_attention
  const g = groups[sel]
  return (
    <section className="card p-5 flex flex-col gap-4">
      <h2 className="font-bold flex items-center gap-2"><AlertTriangle size={18} className="text-amber" />Needs attention</h2>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        {groups.map((x, i) => (
          <button key={x.code} onClick={() => setSel(i)} aria-pressed={sel === i}
            className={cx('rounded-card border p-3 text-left flex flex-col gap-1 min-h-[72px]', sel === i ? 'border-blue border-2 bg-blue-sel' : 'border-line hover:border-blue')}>
            <span className="text-2xl font-bold num">{x.count}</span>
            <span className="text-xs font-semibold text-muted leading-tight">{x.label}</span>
          </button>
        ))}
      </div>
      {!g ? <p className="text-sm text-muted">Nothing needs attention.</p> : g.top.length === 0 ? <p className="text-sm text-muted">No cases in this group.</p> : (
        <ul className="flex flex-col divide-y divide-line">
          {g.top.map((c) => (
            <li key={c.case_id} className="py-3 flex flex-col gap-1">
              <div className="flex items-center gap-2 flex-wrap">
                <button className="link num" onClick={() => openCase(c.case_id)}>{c.case_number}</button>
                <span className="text-sm text-muted">{htLabel(c.stage)}</span><AgeChip years={c.age_years} />
              </div>
              <p className="text-sm">{c.why}</p>
              <p className="text-sm text-teal-text">Suggested: {c.suggested_action}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function ScoringSection() {
  const [open, setOpen] = useState(false)
  const [src, setSrc] = useState<'simulated' | 'actual'>('simulated')
  const q = useQuery({ queryKey: qk.scoring(src), queryFn: () => api.scoring(src), enabled: open })
  return (
    <section className="card">
      <button className="w-full flex items-center gap-2 px-5 min-h-[56px] text-left font-bold" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Trophy size={18} className="text-muted" />Hackathon scoring<span className="text-sm font-normal text-muted">The six official measures against the baseline</span>
        <ChevronDown size={18} className={cx('ml-auto transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="px-5 pb-5 flex flex-col gap-3">
          <Segmented label="Source" value={src} onChange={setSrc} options={[{ value: 'simulated', label: 'Simulated' }, { value: 'actual', label: 'Recorded in court' }]} />
          {q.error ? <ErrorCard msg={errMsg(q.error)} onRetry={() => q.refetch()} /> : !q.data ? <Skeleton className="h-48" /> : <ScoreTable s={q.data} />}
        </div>
      )}
    </section>
  )
}

function ScoreTable({ s }: { s: Scoring }) {
  const f = (v: number | null, unit: string) => (v == null ? '—' : unit === '%' ? `${Math.round(v)}%` : `${v.toFixed(1)}${unit ? ` ${unit}` : ''}`)
  return (
    <table className="w-full text-sm num">
      <thead className="text-left text-muted"><tr><th className="py-2 font-semibold">Measure</th><th className="text-right font-semibold">Vihitha</th><th className="text-right font-semibold">Baseline</th><th className="text-right font-semibold pr-2">Change</th></tr></thead>
      <tbody>
        {s.metrics.map((m) => (
          <tr key={m.key} className="border-t border-line">
            <td className="py-2"><span className="inline-flex items-center">{m.label}<InfoTip label={m.label} tip={m.tooltip} /></span></td>
            <td className="text-right font-semibold">{f(m.value, m.unit)}</td>
            <td className="text-right text-muted">{f(m.baseline, m.unit)}</td>
            <td className="text-right pr-2"><DeltaTag delta={m.delta} better={m.better} fmt={(d) => `${d > 0 ? '+' : '−'}${m.unit === '%' ? `${Math.abs(Math.round(d))} pts` : Math.abs(d).toFixed(1)}`} small /></td>
          </tr>
        ))}
      </tbody>
      <caption className="caption-bottom text-xs text-muted pt-2 text-left">{dayMonthYear(s.from)} to {dayMonthYear(s.to)} · {s.source === 'actual' ? 'recorded outcomes' : 'simulated'}</caption>
    </table>
  )
}
