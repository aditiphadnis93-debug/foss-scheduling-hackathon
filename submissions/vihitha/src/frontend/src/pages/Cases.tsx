import { useEffect, useState } from 'react'
import { keepPreviousData, useQuery, type UseQueryResult } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Search, X } from 'lucide-react'
import { api, errMsg } from '../api/client'
import { qk } from '../api/queries'
import type { CaseQuery, CaseSort, ForecastSummary } from '../api/types'
import { NeedRoster, useApp } from '../lib/app'
import { AGE_BUCKETS, ageLabel, dayMonthYear, FLAG_LABEL, flagLabel, htLabel, LIFECYCLE, HEARING_TYPES, midDate, monthShort, num, pct0, prob, span } from '../lib/format'
import { AgeChip, ErrorCard, PageHeader, Pill, Skeleton, StatCard } from '../components/ui'

const SIZE = 50

export default function Cases() {
  return <NeedRoster><CasesInner /></NeedRoster>
}

function CasesInner() {
  const { openCase } = useApp()
  const [text, setText] = useState('')
  const [f, setF] = useState<CaseQuery>({ sort: 'age_desc', status: 'PENDING', page: 1, size: SIZE })
  useEffect(() => { const t = setTimeout(() => setF((p) => (p.q === (text || undefined) ? p : { ...p, q: text || undefined, page: 1 })), 300); return () => clearTimeout(t) }, [text])
  const set = (patch: Partial<CaseQuery>) => setF((p) => ({ ...p, ...patch, page: patch.page ?? 1 }))
  const q = useQuery({ queryKey: qk.cases(f), queryFn: () => api.cases(f), placeholderData: keepPreviousData })
  const fq = useQuery({ queryKey: qk.forecast, queryFn: api.forecastSummary })
  const total = q.data?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / (f.size ?? SIZE)))
  const active = [f.stage, f.bucket, f.flag, f.ends_before, f.q].filter(Boolean).length + (f.status !== 'PENDING' ? 1 : 0)

  return (
    <>
      <PageHeader title="Cases" sub="Every case on the roster, with when it is likely to end." />
      <ForecastStrip q={fq} onMonth={(m) => set({ ends_before: m })} />

      <div className="card p-4 flex flex-wrap gap-3 items-end">
        <label className="relative flex-1 min-w-[220px]">
          <span className="label block mb-1">Search</span>
          <Search size={16} className="absolute left-3 bottom-3.5 text-muted" />
          <input className="input w-full pl-9" placeholder="Case number, filing number or advocate" value={text} onChange={(e) => setText(e.target.value)} />
        </label>
        <Sel label="Stage" value={f.stage} onChange={(v) => set({ stage: v })} options={[...LIFECYCLE, ...HEARING_TYPES.filter((t) => !LIFECYCLE.includes(t))].map((s) => [s, htLabel(s)])} />
        <Sel label="Age" value={f.bucket} onChange={(v) => set({ bucket: v })} options={AGE_BUCKETS.map((b) => [b, ageLabel(b)])} />
        <Sel label="Status" value={f.status} onChange={(v) => set({ status: v })} options={[['PENDING', 'Pending'], ['DISPOSED', 'Disposed']]} anyLabel="All" />
        <Sel label="Flag" value={f.flag} onChange={(v) => set({ flag: v })} options={Object.keys(FLAG_LABEL).map((k) => [k, flagLabel(k)])} />
        <label className="flex flex-col gap-1"><span className="label">Ends before</span>
          <input type="date" className="input" value={f.ends_before ?? ''} onChange={(e) => set({ ends_before: e.target.value || undefined })} /></label>
        <Sel label="Sort" value={f.sort} onChange={(v) => set({ sort: (v as CaseSort) || 'age_desc' })} noAny
          options={[['age_desc', 'Oldest first'], ['age_asc', 'Newest first'], ['end_asc', 'Ends soonest'], ['end_desc', 'Ends latest'], ['next_date', 'Next date'], ['case_number', 'Case number']]} />
        {active > 0 && <button className="btn-ghost" onClick={() => { setText(''); setF({ sort: f.sort, status: 'PENDING', page: 1, size: SIZE }) }}><X size={16} />Clear filters</button>}
      </div>

      {q.error ? <ErrorCard msg={errMsg(q.error)} onRetry={() => q.refetch()} /> : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-bg text-left text-muted">
                <tr>
                  <th className="px-4 py-3 font-semibold">Case</th><th className="px-3 font-semibold">Stage</th><th className="px-3 font-semibold">Age</th>
                  <th className="px-3 font-semibold">Advocate</th><th className="px-3 font-semibold">Next hearing</th>
                  <th className="px-3 font-semibold">Likely to finish</th><th className="px-3 font-semibold">Flags</th>
                </tr>
              </thead>
              <tbody className={q.isPlaceholderData ? 'opacity-60' : ''}>
                {!q.data ? Array.from({ length: 8 }, (_, i) => <tr key={i}><td colSpan={7} className="px-4 py-2"><Skeleton className="h-8" /></td></tr>)
                  : q.data.items.length === 0 ? <tr><td colSpan={7} className="px-4 py-10 text-center text-muted">No cases match these filters.</td></tr>
                  : q.data.items.map((c) => (
                    <tr key={c.case_id} className="border-t border-line hover:bg-bg cursor-pointer" onClick={() => openCase(c.case_id)}>
                      <td className="px-4 py-2.5"><button className="link num" onClick={(e) => { e.stopPropagation(); openCase(c.case_id) }}>{c.case_number}</button>
                        {c.status === 'DISPOSED' && <Pill tone="blue" className="ml-2">Disposed</Pill>}</td>
                      <td className="px-3">{htLabel(c.stage)}</td>
                      <td className="px-3"><AgeChip years={c.age_years} /></td>
                      <td className="px-3 num">{c.advocate_id}</td>
                      <td className="px-3 num whitespace-nowrap">{c.next_hearing ? (c.next_hearing.tentative
                        ? <span className="text-muted" title="Planned automatically. It will shift as the court records outcomes.">~{midDate(c.next_hearing.date)} <span className="text-xs">(tentative)</span></span>
                        : <>{midDate(c.next_hearing.date)} <span className="text-muted">{span(c.next_hearing.window_start, c.next_hearing.window_end)}</span>{c.next_hearing.status === 'PUBLISHED' && <Pill tone="blue" className="ml-1">Published</Pill>}</>)
                        : <span className="text-muted">Waiting on process</span>}</td>
                      <td className="px-3 whitespace-nowrap">
                        {c.projected_end ? <span className="num" title={`Between ${dayMonthYear(c.projected_end.p10)} and ${dayMonthYear(c.projected_end.p90)}`}>{dayMonthYear(c.projected_end.p50)}</span> : <span className="text-muted">—</span>}
                        {c.likely_to_finish != null && <Pill tone={c.likely_to_finish ? 'green' : 'grey'} className="ml-2" title={`${prob(c.prob_ends_by_horizon)} chance it ends by 31 Dec`}>{c.likely_to_finish ? 'This year' : 'Later'}</Pill>}
                      </td>
                      <td className="px-3"><div className="flex flex-wrap gap-1">{c.flags.filter((x) => x !== 'OLD_CASE' && x !== 'VERY_OLD_CASE').slice(0, 3).map((x) => <Pill key={x} tone="amber">{flagLabel(x)}</Pill>)}</div></td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between px-4 py-3 border-t border-line text-sm">
            <span className="text-muted num">{num(total)} cases{active > 0 && ' match'}</span>
            <div className="flex items-center gap-2">
              <button className="icon-btn" aria-label="Previous page" disabled={(f.page ?? 1) <= 1} onClick={() => set({ page: (f.page ?? 1) - 1 })}><ChevronLeft size={18} /></button>
              <span className="num">Page {f.page} of {pages}</span>
              <button className="icon-btn" aria-label="Next page" disabled={(f.page ?? 1) >= pages} onClick={() => set({ page: (f.page ?? 1) + 1 })}><ChevronRight size={18} /></button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function Sel({ label, value, onChange, options, anyLabel = 'Any', noAny }: { label: string; value: string | undefined; onChange: (v: string | undefined) => void; options: (readonly [string, string] | string[])[]; anyLabel?: string; noAny?: boolean }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="label">{label}</span>
      <select className="input" value={value ?? ''} onChange={(e) => onChange(e.target.value || undefined)}>
        {!noAny && <option value="">{anyLabel}</option>}
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  )
}

function ForecastStrip({ q, onMonth }: { q: UseQueryResult<ForecastSummary>; onMonth: (endsBefore: string) => void }) {
  if (q.error) return <ErrorCard msg={errMsg(q.error)} onRetry={() => q.refetch()} />
  const s = q.data
  if (!s) return <div className="grid grid-cols-3 gap-4"><Skeleton className="h-28" /><Skeleton className="h-28" /><Skeleton className="h-28" /></div>
  const max = Math.max(1, ...s.ending_by_month.map((m) => m.count))
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[220px_220px_1fr] gap-4">
      <StatCard label="Typical time to finish" value={<>{num(s.median_days_to_end)} <span className="text-base font-semibold text-muted">days</span></>} sub="Median for pending cases, from their current stage" />
      <StatCard label={`Ending by ${dayMonthYear(s.horizon_end)}`} value={pct0(s.pct_ending_by_horizon)} sub="Share of pending cases likely to finish" />
      <div className="card p-5 flex flex-col gap-2">
        <span className="label">Cases likely to end, by month</span>
        <div className="flex items-end gap-2 h-20">
          {s.ending_by_month.map((m) => (
            <button key={m.month} className="flex-1 flex flex-col items-center justify-end gap-1 group min-w-0" title={`${m.count} cases likely to end in ${monthShort(m.month)}. Click to list cases ending before the end of this month.`}
              onClick={() => { const [y, mo] = m.month.split('-').map(Number); const next = new Date(y, mo, 1); onMonth(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-01`) }}>
              <span className="text-[10px] num text-muted">{m.count}</span>
              <span className="w-full rounded-t bg-teal group-hover:bg-blue" style={{ height: `${(m.count / max) * 48}px` }} />
              <span className="text-[10px] text-muted truncate w-full text-center">{monthShort(m.month).split(' ')[0]}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
