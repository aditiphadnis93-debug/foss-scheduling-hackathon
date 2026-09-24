import type { ReactNode } from 'react'
import { Lock, Plus, Trash2 } from 'lucide-react'
import type { ColorKey, HearingType, RuleBlock, RulesBody, Warning, Weekday } from '../api/types'
import { BLOCK_COLOR, HEARING_TYPES, htLabel } from '../lib/format'
import { cx, Guardrail, InfoTip, Toggle } from './ui'

const WEEKDAYS: Weekday[] = ['MON', 'TUE', 'WED', 'THU', 'FRI']
const COLOR_KEYS: ColorKey[] = ['short', 'evidence', 'old', 'carry', 'fresh', 'any']
const COLOR_LABEL: Record<ColorKey, string> = { short: 'Short matters', evidence: 'Evidence', old: 'Old cases', carry: 'Carried forward', fresh: 'Fresh', any: 'Any' }
const QUOTA_MIN = 20

/** Full editor for every RulesBody field. Warnings from the server are shown next to their field with a lock. */
export function RuleEditor({ value: r, onChange, warnings = [] }: { value: RulesBody; onChange: (r: RulesBody) => void; warnings?: Warning[] }) {
  const set = <K extends keyof RulesBody>(k: K, v: RulesBody[K]) => onChange({ ...r, [k]: v, preset: k === 'name' ? r.preset : 'custom' })
  const warn = (prefix: string) => warnings.filter((w) => w.field === prefix || w.field.startsWith(`${prefix}.`) || w.field.startsWith(`${prefix}[`))
  const W = ({ f }: { f: string }) => <>{warn(f).map((w, i) => <Guardrail key={i}>{w.message}</Guardrail>)}</>
  const other = warnings.filter((w) => !KNOWN.some((k) => w.field === k || w.field.startsWith(`${k}.`) || w.field.startsWith(`${k}[`)))

  return (
    <div className="flex flex-col gap-5">
      {other.length > 0 && <div className="flex flex-col gap-2">{other.map((w, i) => <Guardrail key={i}>{w.message}</Guardrail>)}</div>}

      <Section title="Basics">
        <Field label="Name"><input className="input" value={r.name} onChange={(e) => set('name', e.target.value)} /></Field>
        <Field label="Based on"><input className="input bg-bg" readOnly value={r.preset} /></Field>
        <Num label="Judicial minutes per day" value={r.capacity_minutes} onChange={(v) => set('capacity_minutes', v)} min={60} max={600} />
        <Num label="Fill the day to" suffix="%" value={Math.round((r.fill_target ?? 1) * 100)} onChange={(v) => set('fill_target', v / 100)} min={50} max={150} step={5}
          hint="Planned expected minutes as a share of the day." />
        <Num label="Most matters listed per day" value={r.max_listed_per_day} nullable nullLabel="No limit" onChange={(v) => set('max_listed_per_day', v)} min={1} max={200} />
        <Num label="Window length" suffix="min" value={r.window_minutes ?? 30} onChange={(v) => set('window_minutes', v)} min={10} max={120} step={5} />
        <W f="capacity_minutes" /><W f="fill_target" /><W f="max_listed_per_day" /><W f="window_minutes" />
      </Section>

      <Section title="Court day">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 col-span-full">
          {(['start', 'lunch_start', 'lunch_end', 'end'] as const).map((k) => (
            <Field key={k} label={{ start: 'Starts', lunch_start: 'Lunch from', lunch_end: 'Lunch to', end: 'Ends' }[k]}>
              <input type="time" className="input num" value={r.day[k]} onChange={(e) => set('day', { ...r.day, [k]: e.target.value })} />
            </Field>
          ))}
        </div>
        <div className="col-span-full"><W f="day" /></div>
      </Section>

      <Section title="Time blocks" full>
        <p className="text-xs text-muted">Each block holds certain kinds of hearing. Leave the types empty to allow any.</p>
        {r.blocks.map((b, i) => <BlockRow key={i} b={b} onChange={(nb) => set('blocks', r.blocks.map((x, j) => (j === i ? nb : x)))} onRemove={() => set('blocks', r.blocks.filter((_, j) => j !== i))} />)}
        <button type="button" className="btn-ghost self-start" onClick={() => set('blocks', [...r.blocks, { id: `block_${r.blocks.length + 1}`, label: 'New block', start: r.day.lunch_end, end: r.day.end, hearing_types: null, min_age_years: null, carried_forward_only: false, color_key: 'any' }])}>
          <Plus size={16} />Add block</button>
        <W f="blocks" />
      </Section>

      <Section title="What comes first">
        <p className="text-xs text-muted col-span-full">How much each factor counts when deciding which cases get listed first (0 to 1).</p>
        {(['age', 'p_substantive', 'waiting', 'near_disposal', 'fresh'] as const).map((k) => (
          <Slider key={k} label={{ age: 'Age of case', p_substantive: 'Likely to move forward', waiting: 'Time waiting', near_disposal: 'Close to the end', fresh: 'Fresh matters' }[k]}
            value={r.priority_weights[k]} onChange={(v) => set('priority_weights', { ...r.priority_weights, [k]: v })} />
        ))}
        <div className="col-span-full"><W f="priority_weights" /></div>
      </Section>

      <Section title="Old cases (guardrail)">
        <div className="flex flex-col gap-1.5">
          <span className="label inline-flex items-center gap-1"><Lock size={12} />Share of each day for 4+ year cases<InfoTip label="Guardrail" tip={`Ageing cases can never be given less than ${QUOTA_MIN}% of the day.`} /></span>
          <div className="flex items-center gap-2"><input type="number" className="input num w-28" min={0} max={100} value={r.ageing_quota_pct} onChange={(e) => set('ageing_quota_pct', Number(e.target.value))} /><span className="text-sm text-muted">%</span></div>
          {r.ageing_quota_pct < QUOTA_MIN && <Guardrail>Below the {QUOTA_MIN}% minimum. Vihitha will keep it at {QUOTA_MIN}%.</Guardrail>}
        </div>
        <Num label="Longest wait for a 4+ year case" suffix="days" value={r.max_wait_days_4y} onChange={(v) => set('max_wait_days_4y', v)} min={1} max={180} lock />
        <div className="col-span-full"><W f="ageing_quota_pct" /><W f="max_wait_days_4y" /></div>
      </Section>

      <Section title="Grouping">
        <Toggle on={r.clustering.by_advocate} onChange={(v) => set('clustering', { ...r.clustering, by_advocate: v })} label="Group by advocate" hint="Fewer trips to court for advocates" />
        <Toggle on={r.clustering.purpose_days != null} onChange={(v) => set('clustering', { ...r.clustering, purpose_days: v ? {} : null })} label="Set days for hearing types" hint="e.g. evidence on Tuesdays" />
        {r.clustering.purpose_days && (
          <div className="col-span-full flex flex-col gap-2">
            {WEEKDAYS.map((d) => (
              <div key={d} className="grid grid-cols-[48px_1fr] gap-2 items-start">
                <span className="text-sm font-semibold pt-1">{d.charAt(0) + d.slice(1).toLowerCase()}</span>
                <TypePicker value={r.clustering.purpose_days?.[d] ?? []} onChange={(v) => set('clustering', { ...r.clustering, purpose_days: { ...r.clustering.purpose_days, [d]: v } })} />
              </div>
            ))}
          </div>
        )}
        <div className="col-span-full"><W f="clustering" /></div>
      </Section>

      <Section title="Listing and next dates">
        <Toggle on={r.carry_forward_same_weekday} onChange={(v) => set('carry_forward_same_weekday', v)} label="Carry forward to the same weekday" hint="Matters not reached return next week, same day" />
        <Toggle on={r.prerequisite_check} onChange={(v) => set('prerequisite_check', v)} label="Check prerequisites" hint="Hold back matters waiting on summons or warrants" />
        <Field label="Next date">
          <select className="input" value={r.next_date_mode} onChange={(e) => set('next_date_mode', e.target.value as RulesBody['next_date_mode'])}>
            <option value="REFERENCE">Reference gap for each hearing type</option>
            <option value="FLAT_60">Flat 60 days</option>
          </select>
        </Field>
        <Num label="Range around the ideal gap" suffix="×" value={r.next_date_window_factor} onChange={(v) => set('next_date_window_factor', v)} min={0} max={3} step={0.1} />
        <Toggle on={r.slots} onChange={(v) => set('slots', v)} label="Give parties time windows" hint="Parties get a slot, not just a date" />
        <div className="col-span-full"><W f="next_date_mode" /><W f="next_date_window_factor" /><W f="carry_forward_same_weekday" /><W f="prerequisite_check" /><W f="slots" /></div>
      </Section>

      <Section title="Preparation and outcomes">
        <Toggle on={r.require_case_summary_4y} onChange={(v) => set('require_case_summary_4y', v)} label="Case summary for 4+ year cases" hint="Advocates file a summary before the hearing" />
        <Num label="Fewer 'not prepared' adjournments with a summary" suffix="0–1" value={r.summary_prep_reduction} onChange={(v) => set('summary_prep_reduction', v)} min={0} max={1} step={0.05} />
        <Num label="Chance of settlement per hearing" suffix="0–1" value={r.settlement_prob} onChange={(v) => set('settlement_prob', v)} min={0} max={1} step={0.01} />
        <Num label="Spread of hearing lengths" value={r.duration_sigma} onChange={(v) => set('duration_sigma', v)} min={0} max={2} step={0.05} />
        <Num label="Minutes for an adjournment call" suffix="min" value={r.adjourn_call_minutes} onChange={(v) => set('adjourn_call_minutes', v)} min={0} max={30} />
        <Toggle on={r.learning} onChange={(v) => set('learning', v)} label="Learn from recorded outcomes" hint="Update each party's turn-up estimate" />
        <div className="col-span-full"><W f="require_case_summary_4y" /><W f="summary_prep_reduction" /><W f="settlement_prob" /><W f="duration_sigma" /><W f="adjourn_call_minutes" /><W f="learning" /></div>
      </Section>

      <Section title="Behaviour of parties (simulation)">
        <Toggle on={r.agents.enabled} onChange={(v) => set('agents', { ...r.agents, enabled: v })} label="Simulate litigants and advocates" hint="Used by What-If and forecasts only" />
        <div />
        {([
          ['trait_sd', 'Variation between people', 0.05],
          ['slot_bonus', 'Turn-up boost from a time window', 0.01],
          ['notice_bonus', 'Turn-up boost from early notice', 0.01],
          ['notice_min_days', 'Days of notice that count as early', 1],
          ['cluster_bonus', 'Turn-up boost from grouping', 0.01],
          ['fatigue_per_miss', 'Drop per missed hearing', 0.01],
          ['fatigue_cap', 'Largest total drop', 0.01],
          ['last_chance_bonus', 'Boost on a last-chance hearing', 0.01],
        ] as const).map(([k, label, step]) => (
          <Num key={k} label={label} value={r.agents[k]} step={step} min={0} disabled={!r.agents.enabled} onChange={(v) => set('agents', { ...r.agents, [k]: v })} />
        ))}
        <div className="col-span-full"><W f="agents" /></div>
      </Section>
    </div>
  )
}

const KNOWN = ['name', 'preset', 'capacity_minutes', 'day', 'fill_target', 'max_listed_per_day', 'window_minutes', 'blocks', 'priority_weights', 'clustering',
  'ageing_quota_pct', 'max_wait_days_4y', 'carry_forward_same_weekday', 'prerequisite_check', 'next_date_mode', 'next_date_window_factor', 'slots',
  'require_case_summary_4y', 'summary_prep_reduction', 'settlement_prob', 'duration_sigma', 'adjourn_call_minutes', 'learning', 'agents']

function Section({ title, children, full }: { title: string; children: ReactNode; full?: boolean }) {
  return (
    <fieldset className="card p-5">
      <legend className="px-1 font-bold">{title}</legend>
      <div className={full ? 'flex flex-col gap-3' : 'grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3'}>{children}</div>
    </fieldset>
  )
}
function Field({ label, children, hint }: { label: ReactNode; children: ReactNode; hint?: string }) {
  return <label className="flex flex-col gap-1.5"><span className="label">{label}</span>{children}{hint && <span className="text-xs text-muted">{hint}</span>}</label>
}
function Num({ label, value, onChange, min, max, step = 1, suffix, hint, nullable, nullLabel, disabled, lock }: {
  label: string; value: number | null; onChange: (v: number) => void; min?: number; max?: number; step?: number; suffix?: string; hint?: string
  nullable?: boolean; nullLabel?: string; disabled?: boolean; lock?: boolean
}) {
  return (
    <Field label={<span className="inline-flex items-center gap-1">{lock && <Lock size={12} />}{label}</span>} hint={hint}>
      <div className="flex items-center gap-2">
        <input type="number" className="input num w-32" value={value ?? ''} min={min} max={max} step={step} disabled={disabled || (nullable && value == null)}
          onChange={(e) => e.target.value !== '' && onChange(Number(e.target.value))} />
        {suffix && <span className="text-sm text-muted">{suffix}</span>}
        {nullable && (
          <label className="inline-flex items-center gap-1.5 text-sm ml-2">
            <input type="checkbox" checked={value == null} onChange={(e) => (onChange as (v: number | null) => void)(e.target.checked ? null : (min ?? 1) * 60)} />{nullLabel}
          </label>
        )}
      </div>
    </Field>
  )
}
function Slider({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="label flex justify-between">{label}<span className="num normal-case text-navy">{value.toFixed(2)}</span></span>
      <input type="range" min={0} max={1} step={0.05} value={value} onChange={(e) => onChange(Number(e.target.value))} className="accent-teal" />
    </label>
  )
}

function TypePicker({ value, onChange }: { value: HearingType[]; onChange: (v: HearingType[]) => void }) {
  return (
    <div className="flex flex-wrap gap-1">
      {HEARING_TYPES.map((t) => {
        const on = value.includes(t)
        return (
          <button type="button" key={t} aria-pressed={on} onClick={() => onChange(on ? value.filter((x) => x !== t) : [...value, t])}
            className={cx('px-2 min-h-[28px] rounded-[12px] border text-xs', on ? 'border-blue bg-blue-sel text-blue font-semibold' : 'border-line text-muted hover:border-blue')}>
            {htLabel(t)}
          </button>
        )
      })}
    </div>
  )
}

function BlockRow({ b, onChange, onRemove }: { b: RuleBlock; onChange: (b: RuleBlock) => void; onRemove: () => void }) {
  const c = BLOCK_COLOR[b.color_key] ?? BLOCK_COLOR.any
  return (
    <div className="rounded-card border-l-4 border p-3 flex flex-col gap-2" style={{ borderLeftColor: c.border, background: c.bg }}>
      <div className="flex flex-wrap gap-2 items-end">
        <label className="flex flex-col gap-1 flex-1 min-w-[160px]"><span className="label">Label</span><input className="input" value={b.label} onChange={(e) => onChange({ ...b, label: e.target.value })} /></label>
        <label className="flex flex-col gap-1 w-28"><span className="label">Id</span><input className="input" value={b.id} onChange={(e) => onChange({ ...b, id: e.target.value })} /></label>
        <label className="flex flex-col gap-1"><span className="label">From</span><input type="time" className="input num" value={b.start} onChange={(e) => onChange({ ...b, start: e.target.value })} /></label>
        <label className="flex flex-col gap-1"><span className="label">To</span><input type="time" className="input num" value={b.end} onChange={(e) => onChange({ ...b, end: e.target.value })} /></label>
        <label className="flex flex-col gap-1"><span className="label">Colour</span>
          <select className="input" value={b.color_key} onChange={(e) => onChange({ ...b, color_key: e.target.value as ColorKey })}>{COLOR_KEYS.map((k) => <option key={k} value={k}>{COLOR_LABEL[k]}</option>)}</select></label>
        <label className="flex flex-col gap-1 w-28"><span className="label">Min age (yrs)</span>
          <input type="number" min={0} className="input num" value={b.min_age_years ?? ''} placeholder="Any" onChange={(e) => onChange({ ...b, min_age_years: e.target.value === '' ? null : Number(e.target.value) })} /></label>
        <button type="button" className="icon-btn text-red-text" aria-label={`Remove block ${b.label}`} onClick={onRemove}><Trash2 size={18} /></button>
      </div>
      <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={b.carried_forward_only} onChange={(e) => onChange({ ...b, carried_forward_only: e.target.checked })} />Only matters carried forward</label>
      <div className="flex flex-col gap-1">
        <span className="label">Hearing types {b.hearing_types == null && <span className="normal-case font-normal">(any)</span>}</span>
        <TypePicker value={b.hearing_types ?? []} onChange={(v) => onChange({ ...b, hearing_types: v.length ? v : null })} />
      </div>
    </div>
  )
}
