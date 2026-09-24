import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Plus, Save, Trash2 } from 'lucide-react'
import { api, errMsg } from '../../api/client'
import { qk, refreshAll } from '../../api/queries'
import type { RulesBody, Warning } from '../../api/types'
import { useApp } from '../../lib/app'
import { dayMonthYear, midDate, planSentence } from '../../lib/format'
import { RuleEditor } from '../../components/RuleEditor'
import { cx, EmptyState, ErrorCard, Guardrail, Modal, Pill, Skeleton, Spinner } from '../../components/ui'

export default function RulesetsTab() {
  const { toast, toastError, confirm, today } = useApp()
  const qc = useQueryClient()
  const listQ = useQuery({ queryKey: qk.rulesets, queryFn: api.rulesets })
  const presetsQ = useQuery({ queryKey: qk.presets, queryFn: api.presets, staleTime: Infinity })
  const items = listQ.data?.items ?? []
  const [sel, setSel] = useState<number | null>(null)
  useEffect(() => { if (sel == null && items.length) setSel((items.find((i) => i.is_active) ?? items[0]).id) }, [items, sel])
  const rsQ = useQuery({ queryKey: qk.ruleset(sel ?? -1), queryFn: () => api.ruleset(sel!), enabled: sel != null })
  const rs = rsQ.data?.ruleset
  const [draft, setDraft] = useState<RulesBody | null>(null)
  const [warnings, setWarnings] = useState<Warning[]>([])
  useEffect(() => { if (rs) { setDraft(rs.rules); setWarnings([]) } }, [rs])
  const dirty = !!rs && !!draft && JSON.stringify(rs.rules) !== JSON.stringify(draft)
  const [busy, setBusy] = useState<string | null>(null)
  const [newOpen, setNewOpen] = useState(false)

  const wrap = async (key: string, fn: () => Promise<void>) => { setBusy(key); try { await fn() } catch (e) { toastError(e) } finally { setBusy(null) } }

  const save = () => wrap('save', async () => {
    const r = await api.updateRuleset(rs!.id, draft!, draft!.name)
    setWarnings(r.warnings)
    await refreshAll(qc)
    toast({ msg: `Saved “${r.ruleset.name}”.${r.warnings.length ? ` ${r.warnings.length} guardrail ${r.warnings.length === 1 ? 'note' : 'notes'}.` : ''}${rs!.is_active ? ' Use "Make active" again to re-plan draft days with the changes.' : ''}` })
  })
  const remove = async () => {
    if (!rs) return
    if (!(await confirm({ title: `Delete “${rs.name}”?`, body: <p>This rule set will be gone. Days already planned with it are not changed.</p>, confirmLabel: 'Delete', danger: true }))) return
    wrap('delete', async () => { await api.deleteRuleset(rs.id); setSel(null); await refreshAll(qc); toast({ msg: `Deleted “${rs.name}”.` }) })
  }
  const activate = async () => {
    if (!rs) return
    if (dirty && !(await confirm({ title: 'Unsaved changes', body: <p>Your changes are not saved. The saved version will be made active.</p>, confirmLabel: 'Continue' }))) return
    if (!(await confirm({
      title: `Make “${rs.name}” the court’s rules?`,
      body: <p>Draft days from {today ? midDate(today) : 'today'} are re-planned with these rules. Published and closed days do not change.</p>,
      confirmLabel: 'Make active',
    }))) return
    wrap('activate', async () => {
      const r = await api.activate(rs.id, today || undefined)
      setWarnings(r.warnings)
      await refreshAll(qc)
      toast({ msg: `“${r.active.name}” is now active. ${planSentence(r.plan)}` })
    })
  }

  if (listQ.error) return <ErrorCard msg={errMsg(listQ.error)} onRetry={() => listQ.refetch()} />
  return (
    <div className="grid grid-cols-1 xl:grid-cols-[280px_minmax(0,1fr)] gap-6 items-start">
      <aside className="card p-3 flex flex-col gap-1 xl:sticky xl:top-20">
        <button className="btn-primary mb-2" onClick={() => setNewOpen(true)}><Plus size={16} />New rule set</button>
        {!listQ.data ? <Skeleton className="h-40" /> : items.length === 0 ? <p className="text-sm text-muted p-2">No saved rule sets yet.</p> : items.map((i) => (
          <button key={i.id} onClick={() => setSel(i.id)} aria-pressed={sel === i.id}
            className={cx('text-left rounded-btn px-3 py-2 min-h-[44px] flex flex-col', sel === i.id ? 'bg-blue-sel' : 'hover:bg-bg')}>
            <span className="font-semibold text-sm flex items-center gap-2">{i.name}{i.is_active && <Pill tone="green" dot>Active</Pill>}</span>
            <span className="text-xs text-muted">{i.preset} · updated {dayMonthYear(i.updated_at?.slice(0, 10))}</span>
          </button>
        ))}
      </aside>

      <section className="flex flex-col gap-4 min-w-0">
        {sel == null ? <EmptyState title="No rule set selected">Create one from a preset to get started.</EmptyState>
          : rsQ.error ? <ErrorCard msg={errMsg(rsQ.error)} onRetry={() => rsQ.refetch()} />
          : !rs || !draft ? <Skeleton className="h-[600px]" /> : <>
            <div className="card p-4 flex items-center gap-3 flex-wrap sticky top-[72px] z-10">
              <h2 className="font-bold text-lg">{rs.name}</h2>
              {rs.is_active ? <Pill tone="green" dot>Active</Pill> : <Pill>Not active</Pill>}
              {dirty && <Pill tone="amber">Unsaved changes</Pill>}
              <div className="ml-auto flex gap-2 flex-wrap">
                {dirty && <button className="btn-secondary" onClick={() => setDraft(rs.rules)}>Discard</button>}
                <button className="btn-primary" onClick={save} disabled={!dirty || !!busy}>{busy === 'save' ? <Spinner light /> : <Save size={16} />}Save</button>
                <button className="btn-secondary" onClick={activate} disabled={!!busy}>{busy === 'activate' ? <Spinner /> : <CheckCircle2 size={16} />}{rs.is_active ? 'Re-plan with these rules' : 'Make active'}</button>
                <button className="btn-secondary text-red-text" onClick={remove} disabled={!!busy || rs.is_active} title={rs.is_active ? 'The active rule set cannot be deleted' : undefined}><Trash2 size={16} />Delete</button>
              </div>
            </div>
            {warnings.length > 0 && <div className="flex flex-col gap-2">{warnings.map((w, i) => <Guardrail key={i}>{w.message}</Guardrail>)}</div>}
            <RuleEditor value={draft} onChange={setDraft} warnings={warnings} />
          </>}
      </section>

      <NewModal open={newOpen} onClose={() => setNewOpen(false)} presets={presetsQ.data?.presets ?? []}
        onCreate={(name, rules) => wrap('create', async () => {
          const r = await api.createRuleset(name, { ...rules, name })
          setNewOpen(false); setSel(r.ruleset.id); setWarnings(r.warnings)
          await refreshAll(qc)
          toast({ msg: `Created “${r.ruleset.name}”.` })
        })} busy={busy === 'create'} />
    </div>
  )
}

function NewModal({ open, onClose, presets, onCreate, busy }: {
  open: boolean; onClose: () => void; presets: { id: string; name: string; description: string; rules: RulesBody; warnings: Warning[] }[]
  onCreate: (name: string, rules: RulesBody) => void; busy: boolean
}) {
  const [name, setName] = useState('')
  const [from, setFrom] = useState('')
  useEffect(() => { if (open) { setName(''); setFrom(presets[0]?.id ?? '') } }, [open, presets])
  const p = presets.find((x) => x.id === from)
  return (
    <Modal open={open} onClose={onClose} title="New rule set"
      footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn-primary" disabled={!name.trim() || !p || busy} onClick={() => p && onCreate(name.trim(), p.rules)}>{busy && <Spinner light />}Create</button></>}>
      <label className="flex flex-col gap-1.5"><span className="label">Name</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Evidence Tuesdays" autoFocus /></label>
      <label className="flex flex-col gap-1.5"><span className="label">Start from</span>
        <select className="input" value={from} onChange={(e) => setFrom(e.target.value)}>{presets.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
      {p && <p className="text-muted">{p.description}</p>}
      {p?.warnings.map((w, i) => <Guardrail key={i}>{w.message}</Guardrail>)}
    </Modal>
  )
}
