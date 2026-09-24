import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Database } from 'lucide-react'
import type { Health, NextDateSuggestion } from '../api/types'
import { useHealth } from '../api/queries'
import { errMsg } from '../api/client'
import { EmptyState, ErrorCard, Modal, Toast, cx } from '../components/ui'

export type Role = 'JUDGE' | 'COURT_MASTER'
type ToastMsg = { msg: string; tone?: 'ok' | 'error'; action?: string; onAction?: () => void }
/** Opens the next-date panel for a hearing that just had its outcome recorded. */
export type NextDateTarget = { hearingId: number; caseNumber: string; outcome?: string; suggestion?: NextDateSuggestion | null }
type ConfirmOpts = { title: string; body: ReactNode; confirmLabel?: string; danger?: boolean }

interface Ctx {
  role: Role; setRole: (r: Role) => void
  health: Health | undefined
  today: string
  caseId: string | null; openCase: (id: string | null) => void
  nextDate: NextDateTarget | null; openNextDate: (t: NextDateTarget | null) => void
  toast: (t: ToastMsg) => void
  toastError: (e: unknown) => void
  confirm: (o: ConfirmOpts) => Promise<boolean>
}
const AppCtx = createContext<Ctx>(null!)
export const useApp = () => useContext(AppCtx)

const get = (k: string) => { try { return localStorage.getItem(k) } catch { return null } }
const put = (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* ignore */ } }

export function AppProvider({ children }: { children: ReactNode }) {
  const [role, setRoleS] = useState<Role>(() => (get('vihitha.role') as Role) || 'JUDGE')
  const healthQ = useHealth()
  const [caseId, openCase] = useState<string | null>(null)
  const [nextDate, openNextDate] = useState<NextDateTarget | null>(null)
  const [t, setT] = useState<ToastMsg | null>(null)
  const done = useCallback(() => setT(null), [])
  const [conf, setConf] = useState<ConfirmOpts | null>(null)
  const resolver = useRef<((v: boolean) => void) | null>(null)

  const confirm = useCallback((o: ConfirmOpts) => new Promise<boolean>((res) => { resolver.current = res; setConf(o) }), [])
  const settle = (v: boolean) => { resolver.current?.(v); resolver.current = null; setConf(null) }
  const toastError = useCallback((e: unknown) => setT({ msg: errMsg(e), tone: 'error' }), [])

  const setRole = (r: Role) => { put('vihitha.role', r); setRoleS(r) }
  const today = healthQ.data?.today ?? ''
  return (
    <AppCtx.Provider value={{ role, setRole, health: healthQ.data, today, caseId, openCase, nextDate, openNextDate, toast: setT, toastError, confirm }}>
      {children}
      {t && <Toast {...t} onDone={done} />}
      <Modal open={!!conf} onClose={() => settle(false)} title={conf?.title}
        footer={<>
          <button className="btn-secondary" onClick={() => settle(false)}>Cancel</button>
          <button autoFocus className={cx('btn', conf?.danger ? 'bg-red text-white hover:bg-red-text' : 'btn-primary')} onClick={() => settle(true)}>{conf?.confirmLabel ?? 'Confirm'}</button>
        </>}>
        {conf?.body}
      </Modal>
    </AppCtx.Provider>
  )
}

/**
 * Wraps screens that need the backend and a loaded roster.
 * Shows a clear error if the server is down and an empty state if no roster is loaded.
 */
export function NeedRoster({ children }: { children: ReactNode }) {
  const q = useHealth()
  if (q.isLoading) return null
  if (q.error) return <ErrorCard title="Cannot reach the Vihitha server" msg={errMsg(q.error)} onRetry={() => q.refetch()} />
  if (q.data && !q.data.roster_loaded) {
    return (
      <EmptyState icon={<Database size={40} strokeWidth={1.5} />} title="No roster loaded"
        action={<Link to="/settings" className="btn-primary">Go to Settings</Link>}>
        Load the sample roster, generate one, or upload a CSV in Settings. The calendar fills in as soon as a roster is loaded.
      </EmptyState>
    )
  }
  return <>{children}</>
}
