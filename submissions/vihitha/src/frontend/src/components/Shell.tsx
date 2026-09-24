import { NavLink, Outlet } from 'react-router-dom'
import { BarChart3, Briefcase, CalendarDays, ExternalLink, FlaskConical, Scale, Settings2 } from 'lucide-react'
import { useApp } from '../lib/app'
import { longDate } from '../lib/format'
import { Segmented, cx } from './ui'
import { CaseDrawer } from './CaseDrawer'
import { NextDatePanel } from './NextDatePanel'

const NAV = [
  { to: '/', label: 'Calendar', icon: CalendarDays },
  { to: '/whatif', label: 'What-If', icon: FlaskConical },
  { to: '/cases', label: 'Cases', icon: Briefcase },
  { to: '/metrics', label: 'Metrics', icon: BarChart3 },
  { to: '/settings', label: 'Settings', icon: Settings2 },
]

export function Shell() {
  const { role, setRole, health } = useApp()
  const online = health?.status === 'ok'
  return (
    <div className="min-h-screen flex flex-col">
      <header className="h-16 bg-navy text-white flex items-center gap-5 px-6 shrink-0 sticky top-0 z-30">
        <div className="flex items-baseline gap-2 w-[208px] shrink-0">
          <span className="text-xl font-bold tracking-tight">Vihitha</span>
          <span lang="ml" className="font-ml text-sm text-white/70">വിഹിത</span>
        </div>
        <span className="text-sm text-white/80 truncate hidden lg:inline">{health?.court_name ?? 'Court'}</span>
        <div className="ml-auto flex items-center gap-4 text-sm">
          <span className="inline-flex items-center gap-2" title={online ? 'Connected to the Vihitha server' : 'Server not reachable'}>
            <span className={cx('w-2 h-2 rounded-full', online ? 'bg-green' : 'bg-amber')} />
            <span className="text-white/70">Today</span>
            <span className="font-semibold num">{health ? longDate(health.today) : '—'}</span>
          </span>
          <span className="hidden md:inline-flex items-center gap-2 max-w-[260px]" title="Active rules">
            <Scale size={16} strokeWidth={1.8} className="text-white/70 shrink-0" />
            <span className="truncate font-semibold">{health?.active_ruleset?.name ?? 'No active rules'}</span>
          </span>
          <Segmented dark label="Role" value={role} onChange={setRole} options={[{ value: 'JUDGE', label: 'Judge' }, { value: 'COURT_MASTER', label: 'Court Master' }]} />
        </div>
      </header>
      <div className="flex flex-1">
        <aside className="w-[232px] shrink-0 bg-white border-r border-line flex flex-col sticky top-16 h-[calc(100vh-64px)]">
          <nav className="flex flex-col gap-1 p-3" aria-label="Main">
            {NAV.map(({ to, label, icon: Icon }) => (
              <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => cx('flex items-center gap-3 px-3 min-h-[44px] rounded-btn text-sm font-medium',
                isActive ? 'bg-blue-sel text-blue font-semibold' : 'text-navy hover:bg-bg')}>
                <Icon size={18} strokeWidth={1.8} />{label}
              </NavLink>
            ))}
          </nav>
          <div className="mt-auto p-4 border-t border-line flex flex-col gap-2">
            <a href="/public" target="_blank" rel="noreferrer" className="link text-sm inline-flex items-center gap-1.5 min-h-[44px]">Public slot page <ExternalLink size={14} strokeWidth={1.8} /></a>
            <p className="text-xs text-muted">{role === 'JUDGE' ? 'Judge view: plan, publish and change rules.' : 'Court Master view: record what happened in court.'}</p>
          </div>
        </aside>
        <main className="flex-1 min-w-0 px-8 py-6 flex flex-col gap-6">
          <Outlet />
        </main>
      </div>
      <CaseDrawer />
      <NextDatePanel />
    </div>
  )
}
