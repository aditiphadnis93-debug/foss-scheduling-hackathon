import { useQuery } from '@tanstack/react-query'
import { api, errMsg } from '../../api/client'
import { qk } from '../../api/queries'
import { useApp } from '../../lib/app'
import { blockColor, clock, fromMin, mondayOf, parseISO, pct0, span, toMin } from '../../lib/format'
import { cx, DayStatusBadge, ErrorCard, Skeleton } from '../../components/ui'

const START = toMin('10:00'), END = toMin('17:30'), SCALE = 0.72

export default function WeekScreen({ date, onOpenDay }: { date: string; onOpenDay: (d: string) => void }) {
  const { today } = useApp()
  const start = mondayOf(date)
  const q = useQuery({ queryKey: qk.week(start), queryFn: () => api.week(start) })
  if (q.error) return <ErrorCard msg={errMsg(q.error)} onRetry={() => q.refetch()} />
  if (!q.data) return <Skeleton className="h-[480px]" />
  const H = (END - START) * SCALE
  const hours: number[] = []
  for (let m = START + 0; m <= END; m += 60) hours.push(Math.ceil(m / 60) * 60)
  return (
    <div className="card p-3 overflow-x-auto">
      <div className="grid gap-2 min-w-[900px]" style={{ gridTemplateColumns: '44px repeat(7, minmax(0, 1fr))' }}>
        <div />
        {q.data.days.map((d) => (
          <button key={d.date} onClick={() => onOpenDay(d.date)}
            className={cx('rounded-btn px-2 py-2 text-left flex flex-col gap-1 hover:bg-bg min-h-[88px]', d.date === today && 'ring-2 ring-blue')}>
            <span className="text-xs text-muted font-semibold uppercase">{d.weekday?.slice(0, 3) || parseISO(d.date).toLocaleDateString('en-GB', { weekday: 'short' })}</span>
            <span className="text-xl font-bold num leading-none">{parseISO(d.date).getDate()}</span>
            {d.sitting ? <>
              <DayStatusBadge status={d.status} />
              <span className="text-xs num"><b>{d.totals.listed}</b> listed · <b className={d.totals.load_pct > 100 ? 'text-amber-text' : ''}>{pct0(d.totals.load_pct)}</b></span>
            </> : <span className={cx('text-xs font-semibold', d.leave ? 'text-purple-text' : 'text-grey-text')}>{d.leave ? 'Judge on leave' : d.holiday_name ?? 'No sitting'}</span>}
          </button>
        ))}
        <div className="relative" style={{ height: H }} aria-hidden>
          {hours.map((m) => <span key={m} className="absolute right-1 -translate-y-1/2 text-[10px] text-muted num" style={{ top: (m - START) * SCALE }}>{clock(fromMin(m))}</span>)}
        </div>
        {q.data.days.map((d) => (
          <button key={d.date} onClick={() => onOpenDay(d.date)} aria-label={`Open ${d.date}`}
            className={cx('relative rounded-btn overflow-hidden border text-left', d.sitting ? 'border-line bg-white hover:border-blue' : d.leave ? 'border-purple bg-purple-bg' : 'border-line bg-grey-bg',
              d.status === 'TENTATIVE' && 'border-dashed border-teal opacity-70')}
            style={{ height: H }}>
            {d.sitting && d.status && d.blocks.length <= 1 && (
              <div className="absolute inset-x-0 bottom-0 flex flex-col items-center justify-end" style={{ height: '100%' }}
                title={`${d.totals.listed} listed · ${pct0(d.totals.load_pct)} of the day${d.status === 'TENTATIVE' ? ' · tentative' : ''}`}>
                <div className={cx('w-full', d.status === 'TENTATIVE' ? 'bg-teal-light' : d.totals.load_pct > 100 ? 'bg-amber-bg' : 'bg-[#A9DEDF]')} style={{ height: `${Math.min(100, d.totals.load_pct)}%` }} />
                <span className="absolute top-2 inset-x-0 text-center text-xs num"><b>{d.totals.listed}</b> listed<br />{pct0(d.totals.load_pct)}</span>
              </div>
            )}
            {d.sitting && d.blocks.length > 1 && d.blocks.map((b) => {
              const c = blockColor(b.color_key)
              const top = (toMin(b.start) - START) * SCALE, h = (toMin(b.end) - toMin(b.start)) * SCALE
              return (
                <div key={b.id} className="absolute left-0 right-0 border-l-4 px-1.5 py-0.5 overflow-hidden" style={{ top, height: h - 1, background: c.bg, borderColor: c.border }}
                  title={`${b.label} · ${span(b.start, b.end)} · ${b.listed} listed · ${pct0(b.load_pct)} full`}>
                  <div className="text-[11px] font-semibold truncate" style={{ color: c.text }}>{b.label}</div>
                  {h > 34 && <div className="text-[11px] num text-navy">{b.listed} · {pct0(b.load_pct)}</div>}
                  <div className="absolute bottom-0 left-0 h-1" style={{ width: `${Math.min(100, b.load_pct)}%`, background: b.load_pct > 100 ? '#D98E04' : c.border }} />
                </div>
              )
            })}
            {d.sitting && !d.status && <span className="absolute inset-x-0 top-1/3 text-center text-xs text-muted">Not planned yet</span>}
            {!d.sitting && <span className={cx('absolute inset-x-0 top-1/3 text-center text-xs font-semibold px-1', d.leave ? 'text-purple-text' : 'text-grey-text')}>{d.leave ? 'Leave' : d.holiday_name ?? ''}</span>}
          </button>
        ))}
      </div>
      <StatusLegend />
    </div>
  )
}

export function StatusLegend() {
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted items-center mt-3">
      <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-blue" />Published</span>
      <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-grey" />Draft</span>
      <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full border-2 border-dashed border-teal bg-white" />Tentative (planned automatically, will shift)</span>
      <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-green" />Closed</span>
    </div>
  )
}
