import { useQuery } from '@tanstack/react-query'
import { api, errMsg } from '../../api/client'
import { qk } from '../../api/queries'
import { num, prob } from '../../lib/format'
import { ErrorCard, Pill, Skeleton } from '../../components/ui'

const Src = ({ s }: { s: 'real' | 'estimated' }) => <Pill tone={s === 'real' ? 'green' : 'amber'}>{s === 'real' ? 'Real' : 'Estimated'}</Pill>

export default function ReferenceTab() {
  const q = useQuery({ queryKey: qk.reference, queryFn: api.reference, staleTime: Infinity })
  if (q.error) return <ErrorCard msg={errMsg(q.error)} onRetry={() => q.refetch()} />
  if (!q.data) return <Skeleton className="h-96" />
  const r = q.data
  return (
    <>
      <div className="card overflow-x-auto">
        <table className="w-full text-sm num">
          <thead className="bg-bg text-left text-muted">
            <tr>
              <th className="px-4 py-3 font-semibold">Hearing type</th><th className="px-3 text-right font-semibold">Minutes</th><th className="px-3 text-right font-semibold">Days to next</th>
              <th className="px-3 text-right font-semibold">Moves forward</th><th className="px-3 text-right font-semibold">Hearings to clear</th>
              <th className="px-3 text-right font-semibold">Min / median / max</th><th className="px-3 font-semibold">Top reasons it fails</th><th className="px-3 font-semibold">Data</th>
            </tr>
          </thead>
          <tbody>
            {r.hearing_types.map((h) => {
              const top = Object.entries(h.failure_reasons).sort((a, b) => b[1] - a[1]).slice(0, 3)
              return (
                <tr key={h.type} className="border-t border-line align-top">
                  <td className="px-4 py-2.5 font-semibold">{h.label}</td>
                  <td className="px-3 text-right">{h.duration_min}</td>
                  <td className="px-3 text-right">{h.reference_gap_days}</td>
                  <td className="px-3 text-right">{prob(h.p_substantive)}</td>
                  <td className="px-3 text-right">{num(h.expected_hearings, 1)}</td>
                  <td className="px-3 text-right">{h.min_h} / {num(h.median_h, 1)} / {h.max_h}</td>
                  <td className="px-3 text-xs text-muted">{top.length ? top.map(([k, v]) => `${k} (${v})`).join(', ') : '—'}</td>
                  <td className="px-3"><div className="flex flex-col gap-1 items-start"><span className="text-xs text-muted">Chance</span><Src s={h.sources.p_substantive} /><span className="text-xs text-muted">Failures</span><Src s={h.sources.failures} /></div></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="card p-5">
        <h2 className="font-bold mb-3">Adjournment reason groups</h2>
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
          {r.reason_groups.map((g) => <li key={g.group} className="border border-line rounded-btn p-3"><b>{g.label}</b><p className="text-xs text-muted mt-1">{g.columns.join(', ')}</p></li>)}
        </ul>
      </div>
    </>
  )
}
