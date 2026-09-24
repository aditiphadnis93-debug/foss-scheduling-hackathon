import { useQuery } from '@tanstack/react-query'
import { api, errMsg } from '../../api/client'
import { qk } from '../../api/queries'
import { useApp } from '../../lib/app'
import { loadColor, monthOf, parseISO, pct0 } from '../../lib/format'
import { cx, ErrorCard, Skeleton } from '../../components/ui'
import { StatusLegend } from './WeekScreen'

const STATUS_DOT: Record<string, string> = { DRAFT: 'bg-grey', TENTATIVE: 'bg-white border-2 border-dashed border-teal', PUBLISHED: 'bg-blue', CLOSED: 'bg-green' }

export default function MonthScreen({ date, onOpenDay }: { date: string; onOpenDay: (d: string) => void }) {
  const { today } = useApp()
  const m = monthOf(date)
  const q = useQuery({ queryKey: qk.month(m), queryFn: () => api.month(m) })
  if (q.error) return <ErrorCard msg={errMsg(q.error)} onRetry={() => q.refetch()} />
  if (!q.data) return <Skeleton className="h-[560px]" />
  const days = q.data.days
  const lead = days.length ? (parseISO(days[0].date).getDay() + 6) % 7 : 0
  return (
    <div className="flex flex-col gap-3">
      <div className="card p-3">
        <div className="grid grid-cols-7 gap-1.5">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d} className="text-xs font-semibold text-muted text-center py-1">{d}</div>)}
          {Array.from({ length: lead }, (_, i) => <div key={`l${i}`} />)}
          {days.map((d) => {
            const lc = loadColor(d.sitting ? d.load_pct : 0)
            const tent = d.status === 'TENTATIVE'
            return (
              <button key={d.date} onClick={() => onOpenDay(d.date)}
                aria-label={`${d.date}: ${d.sitting ? `${d.listed} listed, ${Math.round(d.load_pct)}% full` : d.leave ? 'judge on leave' : d.holiday_name ?? 'no sitting'}`}
                className={cx('min-h-[96px] rounded-btn border p-2 text-left flex flex-col gap-0.5 hover:ring-2 hover:ring-blue transition-shadow',
                  d.leave ? 'border-purple bg-purple-bg' : !d.sitting ? 'border-line bg-grey-bg' : tent ? 'border-dashed border-teal' : 'border-line', d.date === today && 'ring-2 ring-blue')}
                style={d.sitting && !d.leave ? (tent ? { background: '#FFFFFF', color: '#52627A' } : { background: lc.bg, color: lc.text }) : undefined}>
                <span className="flex items-center gap-1.5">
                  <span className="font-bold num">{parseISO(d.date).getDate()}</span>
                  {d.status && <span className={cx('w-2.5 h-2.5 rounded-full', STATUS_DOT[d.status])} title={d.status.toLowerCase()} />}
                  {tent && <span className="text-[10px] text-teal-text font-semibold">tentative</span>}
                </span>
                {d.leave ? <span className="text-xs font-semibold text-purple-text">Judge on leave</span>
                  : !d.sitting ? <span className="text-xs text-grey-text">{d.holiday_name ?? ''}</span>
                  : !d.status ? <span className="text-xs text-muted">Not planned yet</span>
                  : <>
                    <span className={cx('text-sm num', tent ? 'font-normal' : 'font-semibold')}>{tent && '~'}{pct0(d.load_pct)}</span>
                    <span className="text-xs num">{d.listed} listed{d.old_cases ? ` · ${d.old_cases} old` : ''}</span>
                    {d.moved_forward != null && <span className="text-xs num text-green-text font-semibold">{d.moved_forward} moved fwd</span>}
                  </>}
              </button>
            )
          })}
        </div>
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted items-center">
        <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded-sm border border-line" style={{ background: loadColor(40).bg }} />Under 60% full</span>
        <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded-sm" style={{ background: loadColor(70).bg }} />60–85%</span>
        <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded-sm" style={{ background: loadColor(90).bg }} />85–100% (good)</span>
        <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded-sm" style={{ background: loadColor(120).bg }} />Over budget</span>
        <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-purple-bg border border-purple" />Judge on leave</span>
      </div>
      <div className="-mt-3"><StatusLegend />
      </div>
    </div>
  )
}
