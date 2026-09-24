import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, errMsg } from '../../api/client'
import { qk, refreshAll } from '../../api/queries'
import type { Settings } from '../../api/types'
import { useApp } from '../../lib/app'
import { ErrorCard, Skeleton, Spinner } from '../../components/ui'

export default function GeneralTab() {
  const { toast, toastError } = useApp()
  const qc = useQueryClient()
  const q = useQuery({ queryKey: qk.settings, queryFn: api.settings })
  const [s, setS] = useState<Settings | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (q.data) setS(q.data) }, [q.data])
  if (q.error) return <ErrorCard msg={errMsg(q.error)} onRetry={() => q.refetch()} />
  if (!s || !q.data) return <Skeleton className="h-64" />
  const dirty = JSON.stringify(s) !== JSON.stringify(q.data)
  const save = async () => {
    setBusy(true)
    try {
      const patch: Partial<Settings> = {}
      ;(Object.keys(s) as (keyof Settings)[]).forEach((k) => { if (s[k] !== q.data![k]) (patch as Record<string, unknown>)[k] = s[k] })
      await api.saveSettings(patch)
      await refreshAll(qc)
      toast({ msg: 'Settings saved.' })
    } catch (e) { toastError(e) } finally { setBusy(false) }
  }
  return (
    <div className="card p-5 flex flex-col gap-5 max-w-[560px]">
      <label className="flex flex-col gap-1.5">
        <span className="label">Days kept planned ahead</span>
        <input type="number" min={1} max={120} className="input num" value={s.horizon_working_days} onChange={(e) => setS({ ...s, horizon_working_days: Number(e.target.value) })} />
        <span className="text-xs text-muted">Sitting days the planner keeps filled. Anything later is a forecast, not a schedule.</span>
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="label">Window length (minutes)</span>
        <select className="input" value={s.window_minutes} onChange={(e) => setS({ ...s, window_minutes: Number(e.target.value) })}>
          {[15, 20, 30, 45, 60].map((m) => <option key={m} value={m}>{m} minutes</option>)}
        </select>
        <span className="text-xs text-muted">The time window given to parties, for example "be here 11:30–12:00".</span>
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="label">Today (demo)</span>
        <input type="date" className="input" value={s.today} onChange={(e) => e.target.value && setS({ ...s, today: e.target.value })} />
        <span className="text-xs text-muted">Closing a day also moves today forward.</span>
      </label>
      <div className="flex gap-3">
        <button className="btn-primary" onClick={save} disabled={!dirty || busy}>{busy && <Spinner light />}Save</button>
        {dirty && <button className="btn-secondary" onClick={() => setS(q.data!)}>Discard</button>}
      </div>
    </div>
  )
}
