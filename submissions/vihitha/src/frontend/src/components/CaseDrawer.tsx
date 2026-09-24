import { useQuery } from '@tanstack/react-query'
import { CalendarClock, Flag, Hourglass } from 'lucide-react'
import { api, errMsg } from '../api/client'
import { qk } from '../api/queries'
import type { CaseDetail, CaseForecast, HearingEvent, LifecycleState } from '../api/types'
import { useApp } from '../lib/app'
import {
  daysBetween, DISPOSAL_LABEL, dayMonthYear, flagLabel, htLabel, longDate, midDate, num, prob, REASON_LABEL, RESULT_LABEL, RESULT_TONE, span,
} from '../lib/format'
import { AgeChip, CloseBtn, cx, Drawer, ErrorCard, LikelihoodDot, Pill, Skeleton } from './ui'

export function CaseDrawer() {
  const { caseId, openCase } = useApp()
  return (
    <Drawer open={!!caseId} onClose={() => openCase(null)} labelledBy="case-title">
      {caseId && <Body id={caseId} />}
    </Drawer>
  )
}

function Body({ id }: { id: string }) {
  const { openCase } = useApp()
  const q = useQuery({ queryKey: qk.case(id), queryFn: () => api.caseDetail(id) })
  const c = q.data
  return (
    <>
      <header className="flex items-start gap-3 px-6 py-5 border-b border-line">
        <div className="flex-1">
          <h2 id="case-title" className="text-[28px] leading-9 font-bold num">{c?.case_number ?? id}</h2>
          {c && (
            <p className="text-sm text-muted num flex flex-wrap items-center gap-x-2 gap-y-1 mt-1">
              <span>Filed {dayMonthYear(c.filing_date)}</span><AgeChip years={c.age_years} />
              <span>· {c.advocate_id}</span><span>· {c.party_id}</span>
              {c.status === 'DISPOSED' && <Pill tone="blue">Disposed</Pill>}
            </p>
          )}
          {c && c.flags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">{c.flags.map((f) => <Pill key={f} tone={f.includes('OLD') ? 'red' : 'amber'}><Flag size={12} />{flagLabel(f)}</Pill>)}</div>
          )}
        </div>
        <CloseBtn onClick={() => openCase(null)} />
      </header>
      {q.error ? <div className="p-6"><ErrorCard msg={errMsg(q.error)} onRetry={() => q.refetch()} /></div> : !c ? (
        <div className="p-6 flex flex-col gap-4"><Skeleton className="h-10" /><Skeleton className="h-40" /><Skeleton className="h-32" /></div>
      ) : (
        <div className="flex-1 overflow-y-auto px-6 py-5 flex flex-col gap-6">
          <Lifecycle c={c} />
          <NextHearing c={c} />
          {c.forecast ? <EndsCard f={c.forecast} /> : c.status === 'PENDING' && (
            <p className="text-sm text-muted card p-4">No end-date forecast yet for this case.</p>
          )}
          <Counts c={c} />
          <section>
            <h3 className="font-bold mb-2">Last hearing</h3>
            <p className="text-sm bg-bg border border-line rounded-btn p-3 whitespace-pre-line">{c.last_hearing_summary || 'No summary recorded.'}</p>
          </section>
          <History items={c.history} />
        </div>
      )}
    </>
  )
}

const STATE_CLS: Record<LifecycleState, string> = {
  DONE: 'bg-teal', CURRENT: 'bg-blue ring-2 ring-blue/30', UPCOMING: 'bg-[#E9EEF4]', SKIPPED: 'bg-white border border-dashed border-grey',
}
const STATE_LABEL: Record<LifecycleState, string> = { DONE: 'Done', CURRENT: 'Current', UPCOMING: 'Still to come', SKIPPED: 'Skipped' }

function Lifecycle({ c }: { c: CaseDetail }) {
  const stages = [...c.lifecycle].sort((a, b) => a.index - b.index)
  const cur = stages.find((s) => s.state === 'CURRENT')
  const curIdx = cur ? stages.indexOf(cur) + 1 : null
  return (
    <section aria-label="Case lifecycle">
      <div className="flex justify-between items-baseline mb-2">
        <h3 className="font-bold">Stage</h3>
        <span className="text-sm font-semibold text-blue">{htLabel(c.stage)}{curIdx && ` · ${curIdx} of ${stages.length}`}</span>
      </div>
      <ol className="grid gap-1" style={{ gridTemplateColumns: `repeat(${Math.max(1, stages.length)}, minmax(0, 1fr))` }}>
        {stages.map((s) => (
          <li key={s.stage} title={`${htLabel(s.stage)}: ${STATE_LABEL[s.state]}${s.hearings_so_far ? ` · ${s.hearings_so_far} hearings` : ''}`}
            aria-current={s.state === 'CURRENT' ? 'step' : undefined} className={cx('h-2.5 rounded-full', STATE_CLS[s.state])} />
        ))}
      </ol>
      <div className="flex justify-between text-xs text-muted mt-1"><span>{htLabel(stages[0]?.stage)}</span><span>{htLabel(stages[stages.length - 1]?.stage)}</span></div>
      <div className="flex gap-3 text-xs text-muted mt-2 flex-wrap">
        {(['DONE', 'CURRENT', 'UPCOMING', 'SKIPPED'] as LifecycleState[]).map((s) => <span key={s} className="inline-flex items-center gap-1"><span className={cx('w-3 h-2 rounded-full', STATE_CLS[s])} />{STATE_LABEL[s]}</span>)}
      </div>
    </section>
  )
}

function NextHearing({ c }: { c: CaseDetail }) {
  const up = c.upcoming[0]
  if (!c.next_hearing && !up) {
    return <section className="card p-4 text-sm"><h3 className="font-bold mb-1">Next hearing</h3><p className="text-muted">{c.status === 'DISPOSED' ? 'This case has ended.' : 'Waiting on process (for example a summons or warrant). It gets a date once it can be listed.'}</p></section>
  }
  const nh = c.next_hearing
  return (
    <section className="card p-4 flex gap-3 items-start">
      <CalendarClock size={22} strokeWidth={1.8} className="text-blue shrink-0 mt-0.5" />
      <div className="flex-1">
        <h3 className="font-bold">Next hearing</h3>
        <p className="num font-semibold">{(nh?.tentative ?? up?.tentative) ? <>~{longDate(nh?.date ?? up?.date)} <span className="text-sm font-normal text-muted">(tentative)</span></> : <>{longDate(nh?.date ?? up?.date)} · {span(nh?.window_start ?? up?.window_start, nh?.window_end ?? up?.window_end)}</>}</p>
        <p className="text-sm text-muted">{htLabel(up?.hearing_type ?? c.next_purpose)}{(nh?.status ?? up?.status) === 'PUBLISHED' ? ' · published to parties' : (nh?.tentative ?? up?.tentative) ? ' · tentative: planned automatically, will shift as the court runs' : ' · draft, can still change'}</p>
        {up?.reason && <p className="text-sm text-teal-text mt-1">{up.reason}</p>}
      </div>
    </section>
  )
}

function EndsCard({ f }: { f: CaseForecast }) {
  const { today } = useApp()
  const start = today || f.projected_end.p10
  const total = Math.max(1, daysBetween(start, f.projected_end.p90) * 1.1)
  const pos = (d: string) => `${Math.min(100, Math.max(0, (daysBetween(start, d) / total) * 100))}%`
  return (
    <section className="rounded-card border border-[#BFE3E3] bg-teal-light p-4 flex flex-col gap-3" aria-label="How and when this case ends">
      <div className="flex items-center gap-2"><Hourglass size={18} strokeWidth={1.8} className="text-teal-text" /><h3 className="font-bold">How and when this case ends</h3></div>
      <div>
        <p className="text-sm text-muted">Most likely ends</p>
        <p className="text-2xl font-bold num">{longDate(f.projected_end.p50)}</p>
        <p className="text-sm num">Between {dayMonthYear(f.projected_end.p10)} and {dayMonthYear(f.projected_end.p90)} · {prob(f.prob_ends_by_horizon)} chance it ends this year</p>
      </div>
      <div className="relative h-8" aria-hidden>
        <div className="absolute top-3 left-0 right-0 h-2 rounded-full bg-white" />
        <div className="absolute top-3 h-2 rounded-full bg-teal/60" style={{ left: pos(f.projected_end.p10), width: `calc(${pos(f.projected_end.p90)} - ${pos(f.projected_end.p10)})` }} />
        <div className="absolute top-1 w-1 h-6 rounded bg-navy" style={{ left: pos(f.projected_end.p50) }} />
        <span className="absolute -bottom-1 left-0 text-[10px] text-muted">Today</span>
      </div>
      <p className="text-sm"><span className="font-semibold">How it ends: </span>{f.how_it_ends}</p>
      {f.remaining_stages.length > 0 && (
        <table className="w-full text-sm num bg-white rounded-btn overflow-hidden">
          <thead className="text-left text-muted"><tr><th className="px-3 py-1.5 font-semibold">Stage still to come</th><th className="px-3 text-right font-semibold">Hearings</th><th className="px-3 text-right font-semibold">Days</th></tr></thead>
          <tbody>{f.remaining_stages.map((s) => (
            <tr key={s.stage} className="border-t border-line"><td className="px-3 py-1.5">{htLabel(s.stage)}</td><td className="px-3 text-right">{num(s.expected_hearings, 1)}</td><td className="px-3 text-right">{num(s.expected_days)}</td></tr>
          ))}</tbody>
        </table>
      )}
      <p className="text-sm text-teal-text">{f.explanation}</p>
    </section>
  )
}

function Counts({ c }: { c: CaseDetail }) {
  const counts = Object.entries(c.hearing_counts).filter(([, n]) => n) as [string, number][]
  if (!counts.length) return null
  const max = Math.max(1, ...counts.map(([, n]) => n))
  return (
    <section>
      <h3 className="font-bold mb-2">Hearings so far</h3>
      <ul className="flex flex-col gap-1.5">
        {counts.map(([t, n]) => (
          <li key={t} className="grid grid-cols-[170px_1fr] items-center gap-3 text-sm">
            <span className="text-muted truncate">{htLabel(t)}</span>
            <span className="flex items-center gap-2"><span className="h-3 rounded-r bg-blue/70" style={{ width: `${(n / max) * 80}%` }} /><span className="num font-semibold">{n}</span></span>
          </li>
        ))}
      </ul>
    </section>
  )
}

function History({ items }: { items: HearingEvent[] }) {
  return (
    <section>
      <h3 className="font-bold mb-3">History</h3>
      {items.length === 0 ? <p className="text-sm text-muted">No hearings recorded in Vihitha yet.</p> : (
        <ol className="relative border-l-2 border-line ml-2 flex flex-col gap-4">
          {items.map((h) => (
            <li key={h.hearing_id} className="pl-5 relative">
              <span className="absolute -left-[7px] top-1.5 w-3 h-3 rounded-full bg-white border-2 border-blue" />
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold num text-sm">{midDate(h.date)}</span>
                <Pill tone="blue">{htLabel(h.hearing_type)}</Pill>
                {h.result && <Pill tone={RESULT_TONE[h.result.result]} dot>{RESULT_LABEL[h.result.result]}
                  {h.result.reason_group && ` · ${REASON_LABEL[h.result.reason_group]}`}{h.result.disposal_type && ` · ${DISPOSAL_LABEL[h.result.disposal_type]}`}</Pill>}
                <LikelihoodDot l={h.likelihood} p={h.p_substantive} />
              </div>
              {h.result?.actual_start && <p className="text-xs text-muted num mt-1">Heard {span(h.result.actual_start, h.result.actual_end)}</p>}
              {h.result?.note && <p className="text-sm text-muted mt-1">{h.result.note}</p>}
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
