import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { api } from '../api/client'
import { qk } from '../api/queries'
import { NeedRoster, useApp } from '../lib/app'
import { addDays, addMonths, fullDay, longDate, monthLabel, monthOf, mondayOf, shortDate } from '../lib/format'
import { Segmented } from '../components/ui'
import DayScreen from './calendar/DayScreen'
import WeekScreen from './calendar/WeekScreen'
import MonthScreen from './calendar/MonthScreen'

export type CalView = 'day' | 'week' | 'month'

/** Sitting days around a date, used to skip holidays and weekends when stepping day by day. */
export function useSittingDays(center: string) {
  const m = center ? monthOf(center) : ''
  const from = m ? addDays(`${addMonths(m, -2)}-01`, 0) : ''
  const to = m ? addDays(`${addMonths(m, 3)}-01`, -1) : ''
  const q = useQuery({ queryKey: qk.calendar(from, to), queryFn: () => api.calendar(from, to), enabled: !!m, staleTime: 60_000 })
  const days = q.data?.days ?? []
  return {
    days,
    sitting: days.filter((d) => d.sitting).map((d) => d.date),
    info: new Map(days.map((d) => [d.date, d])),
  }
}

export default function Calendar() {
  return <NeedRoster><CalendarInner /></NeedRoster>
}

function CalendarInner() {
  const { today } = useApp()
  const [sp, setSp] = useSearchParams()
  const view = (sp.get('view') as CalView) || 'day'
  const date = sp.get('date') || today
  const { sitting } = useSittingDays(date)
  const go = (v: CalView, d: string) => setSp({ view: v, date: d }, { replace: false })

  if (!date) return null

  const step = (dir: 1 | -1) => {
    if (view === 'day') {
      const next = dir > 0 ? sitting.find((d) => d > date) : [...sitting].reverse().find((d) => d < date)
      go('day', next ?? addDays(date, dir))
    } else if (view === 'week') go('week', addDays(mondayOf(date), dir * 7))
    else go('month', `${addMonths(monthOf(date), dir)}-01`)
  }
  const title = view === 'day' ? fullDay(date) : view === 'week' ? `Week of ${shortDate(mondayOf(date))} – ${shortDate(addDays(mondayOf(date), 6))}` : monthLabel(monthOf(date))
  const todayLabel = view === 'day' ? 'Today' : view === 'week' ? 'This week' : 'This month'

  return (
    <>
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1">
          <button className="icon-btn" aria-label={view === 'day' ? 'Previous sitting day' : `Previous ${view}`} onClick={() => step(-1)}><ChevronLeft size={20} strokeWidth={1.8} /></button>
          <button className="btn-secondary min-h-[40px]" onClick={() => go(view, today)} disabled={!today}>{todayLabel}</button>
          <button className="icon-btn" aria-label={view === 'day' ? 'Next sitting day' : `Next ${view}`} onClick={() => step(1)}><ChevronRight size={20} strokeWidth={1.8} /></button>
        </div>
        <h1 className="text-[26px] leading-9 font-bold">{title}</h1>
        {view === 'day' && date === today && <span className="pill bg-blue-sel text-blue">Today</span>}
        <label className="relative btn-ghost min-h-[40px] cursor-pointer" title="Jump to a date">
          <CalendarDays size={18} strokeWidth={1.8} /><span className="sr-only">Jump to date</span>
          <input type="date" className="absolute inset-0 opacity-0 cursor-pointer" aria-label="Jump to date" value={date} onChange={(e) => e.target.value && go(view, e.target.value)} />
        </label>
        <div className="ml-auto">
          <Segmented label="Calendar view" value={view} onChange={(v) => go(v, date)}
            options={[{ value: 'day', label: 'Day' }, { value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }]} />
        </div>
      </div>
      {view === 'day' && <DayScreen date={date} onOpenDay={(d) => go('day', d)} key={date} />}
      {view === 'week' && <WeekScreen date={date} onOpenDay={(d) => go('day', d)} />}
      {view === 'month' && <MonthScreen date={date} onOpenDay={(d) => go('day', d)} />}
      <p className="sr-only" aria-live="polite">Showing {view} view for {longDate(date)}</p>
    </>
  )
}
