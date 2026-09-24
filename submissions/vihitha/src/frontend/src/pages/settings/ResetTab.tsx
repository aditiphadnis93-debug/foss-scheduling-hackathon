import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { RotateCcw } from 'lucide-react'
import { api } from '../../api/client'
import { refreshAll } from '../../api/queries'
import { useApp } from '../../lib/app'
import { Spinner } from '../../components/ui'

export default function ResetTab() {
  const { toast, toastError, confirm } = useApp()
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const reset = async () => {
    if (!(await confirm({
      title: 'Reset the demo?',
      body: <p>This <b>deletes everything</b>: hearings, outcomes, published days, leave, saved rule sets and settings. Vihitha then reloads the sample roster, restores the preset rules and plans the coming days. This cannot be undone.</p>,
      confirmLabel: 'Reset everything', danger: true,
    }))) return
    setBusy(true)
    try {
      await api.reset()
      await refreshAll(qc)
      toast({ msg: 'Demo reset. The sample roster is loaded and planned.' })
    } catch (e) { toastError(e) } finally { setBusy(false) }
  }
  return (
    <div className="card border-red p-6 flex flex-col gap-3 max-w-[640px]">
      <h2 className="font-bold text-lg flex items-center gap-2"><RotateCcw size={20} className="text-red" />Reset demo</h2>
      <p className="text-sm">Start again from a clean state: the sample roster, the preset rule sets and a fresh plan. Use this before a demonstration.</p>
      <button className="btn bg-red text-white hover:bg-red-text self-start" onClick={reset} disabled={busy}>{busy && <Spinner light />}Reset demo</button>
    </div>
  )
}
