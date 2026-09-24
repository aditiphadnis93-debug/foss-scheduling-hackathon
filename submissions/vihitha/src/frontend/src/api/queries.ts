import { useQuery, type QueryClient } from '@tanstack/react-query'
import { api } from './client'

/** Query keys. Everything that depends on the live schedule sits under one of these roots. */
export const qk = {
  health: ['health'] as const,
  day: (d: string) => ['day', d] as const,
  week: (start: string) => ['week', start] as const,
  month: (m: string) => ['month', m] as const,
  calendar: (from: string, to: string) => ['calendar', from, to] as const,
  unscheduled: ['unscheduled'] as const,
  cases: (q: object) => ['cases', q] as const,
  case: (id: string) => ['case', id] as const,
  forecast: ['forecast'] as const,
  metrics: ['metrics'] as const,
  scoring: (src: string) => ['scoring', src] as const,
  roster: ['roster'] as const,
  settings: ['settings'] as const,
  presets: ['presets'] as const,
  rulesets: ['rulesets'] as const,
  ruleset: (id: number) => ['ruleset', id] as const,
  nextDate: (id: number) => ['next-date', id] as const,
  reference: ['reference'] as const,
}

/** Static data that no mutation changes. */
const STATIC = new Set(['reference', 'presets'])

/**
 * After any mutation that changes the schedule (outcome, publish, move, close day, auto-run,
 * apply rules, leave, roster load, reset) refresh every live query so all screens agree.
 */
export function refreshAll(qc: QueryClient) {
  return qc.invalidateQueries({ predicate: (q) => !STATIC.has(String(q.queryKey[0])) })
}

export const useHealth = () => useQuery({ queryKey: qk.health, queryFn: api.health, refetchInterval: 30_000 })
