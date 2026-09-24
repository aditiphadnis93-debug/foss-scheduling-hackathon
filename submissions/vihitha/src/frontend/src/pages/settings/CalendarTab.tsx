import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { api, errMsg } from '../../api/client'
import { qk, refreshAll } from '../../api/queries'
import type { CalendarDay, LeaveResponse } from '../../api/types'
import { useApp } from '../../lib/app'
import { addDays, addMonths, htLabel, longDate, midDate, monthLabel, monthOf, parseISO, span } from '../../lib/format'
import { cx, ErrorCard, Modal, Skeleton, Spinner } from '../../components/ui'

export default function CalendarTab() {
  const { today, toast, toastError } = useApp()
  const qc = useQueryClient()
  const [m, setM] = useState(() => monthOf(today || '2026-09-24'))
  const from = `${m}-01`, to = addDays(`${addMonths(m, 1)}-01`, -1)
  const q = useQuery({ queryKey: qk.calendar(from, to), queryFn: () => api.calendar(from, to) })
  const [pick, setPick] = useState<CalendarDay | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<LeaveResponse | null>(null)

  const addLeave = async () => {
    if (!pick) return
    setBusy(true)
    try {
      const r = await api.addLeave(pick.date, note || undefined)
      setPick(null); setNote(''); setResult(r)
      await refreshAll(qc)
      toast({ msg: `Leave added for ${midDate(r.date)}. ${r.hearings_moved} draft hearings moved.` })
    } catch (e) { toastError(e) } finally { setBusy(false) }
  }
  const removeLeave = async () => {
    if (!pick) return
    setBusy(true)
    try {
      await api.removeLeave(pick.date)
      setPick(null)
      await refreshAll(qc)
      toast({ msg: `Leave removed for ${midDate(pick.date)}. The day is a sitting day again.` })
    } catch (e) { toastError(e) } finally { setBusy(false) }
  }

  const days = q.data?.days ?? []
  const lead = days.length ? (parseISO(days[0].date).getDay() + 6) % 7 : 0
  return (
    <>
      <div className="card p-5 flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <button className="icon-btn" aria-label="Previous month" onClick={() => setM(addMonths(m, -1))}><ChevronLeft size={20} /></button>
          <h2 className="font-bold text-lg w-48 text-center">{monthLabel(m)}</h2>
          <button className="icon-btn" aria-label="Next month" onClick={() => setM(addMonths(m, 1))}><ChevronRight size={20} /></button>
          <p className="text-sm text-muted ml-4">Click a sitting day to mark judge leave. Click a leave day to remove it.</p>
        </div>
        {q.error ? <ErrorCard msg={errMsg(q.error)} onRetry={() => q.refetch()} /> : !q.data ? <Skeleton className="h-80" /> : (
          <div className="grid grid-cols-7 gap-1.5 max-w-[760px]">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d} className="text-xs font-semibold text-muted text-center">{d}</div>)}
            {Array.from({ length: lead }, (_, i) => <div key={i} />)}
            {days.map((d) => {
              const can = d.sitting || d.leave
              return (
                <button key={d.date} disabled={!can} onClick={() => { setPick(d); setNote(d.leave_note ?? '') }}
                  className={cx('min-h-[64px] rounded-btn border p-1.5 text-left flex flex-col text-xs',
                    d.leave ? 'border-purple bg-purple-bg text-purple-text' : d.sitting ? 'border-line bg-white hover:border-blue' : 'border-line bg-grey-bg text-grey-text cursor-default',
                    d.date === today && 'ring-2 ring-blue')}>
                  <span className="font-bold num text-sm">{parseISO(d.date).getDate()}</span>
                  {d.leave ? <span className="font-semibold">Leave{d.leave_note ? `: ${d.leave_note}` : ''}</span> : !d.sitting && <span>{d.holiday_name ?? ''}</span>}
                </button>
              )
            })}
          </div>
        )}
        <div className="flex gap-4 text-xs text-muted">
          <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded-sm border border-line bg-white" />Sitting day</span>
          <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-grey-bg border border-line" />Holiday or weekend</span>
          <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-purple-bg border border-purple" />Judge on leave</span>
        </div>
      </div>

      {result && (
        <div className="card p-5 flex flex-col gap-3">
          <h2 className="font-bold">Leave on {longDate(result.date)}</h2>
          <p className="text-sm">{result.hearings_moved} draft hearings were moved to other days automatically.</p>
          {result.published_hearings_affected.length === 0 ? <p className="text-sm text-green-text">No published hearings were affected.</p> : <>
            <p className="text-sm text-amber-text font-semibold">{result.published_hearings_affected.length} published hearings were promised for this day. Please review them on the calendar and move them yourself:</p>
            <ul className="text-sm flex flex-col gap-1">
              {result.published_hearings_affected.map((h) => <li key={h.hearing_id} className="num">{h.case_number} · {htLabel(h.hearing_type)} · {span(h.window_start, h.window_end)} · {h.advocate_id}</li>)}
            </ul>
          </>}
        </div>
      )}

      <Modal open={!!pick} onClose={() => setPick(null)} title={pick ? (pick.leave ? `Remove leave on ${midDate(pick.date)}?` : `Judge leave on ${midDate(pick.date)}`) : ''}
        footer={<>
          <button className="btn-secondary" onClick={() => setPick(null)}>Cancel</button>
          {pick?.leave
            ? <button className="btn-primary" disabled={busy} onClick={removeLeave}>{busy && <Spinner light />}Remove leave</button>
            : <button className="btn-primary" disabled={busy} onClick={addLeave}>{busy && <Spinner light />}Mark leave</button>}
        </>}>
        {pick?.leave ? <p>The day becomes a sitting day again and the planner can use it.</p> : <>
          <p>Draft hearings on this day move to other days. Published hearings are listed for you to review.</p>
          <label className="flex flex-col gap-1.5"><span className="label">Note (optional)</span><input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Conference" /></label>
        </>}
      </Modal>
    </>
  )
}
