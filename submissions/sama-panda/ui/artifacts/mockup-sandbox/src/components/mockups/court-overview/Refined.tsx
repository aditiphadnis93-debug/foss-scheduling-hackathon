import "./refined.css";
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Gavel,
  LayoutDashboard,
  ListChecks,
  Menu,
  Moon,
  SlidersHorizontal,
  Sun,
  Users,
  X,
} from "lucide-react";
import { useState, type ReactNode } from "react";

type Case = {
  id: string;
  age: string;
  title: string;
  meta: string;
  tags: string[];
  tone: "coral" | "amber";
};

const cases: Case[] = [
  {
    id: "case-1042",
    age: "6y",
    title: "Crl. Appeal 1042/2019",
    meta: "Evidence · warrant execution report",
    tags: ["4+ years old", "Needs checking"],
    tone: "coral",
  },
  {
    id: "case-0871",
    age: "5y",
    title: "Civil Suit 871/2020",
    meta: "Arguments · older case review",
    tags: ["4+ years old"],
    tone: "amber",
  },
];

const nav = [
  { label: "Overview", icon: LayoutDashboard },
  { label: "Calendar", icon: CalendarDays },
  { label: "Roster", icon: Users },
  { label: "Priorities", icon: SlidersHorizontal },
  { label: "Cause list", icon: ListChecks },
  { label: "Impact", icon: Activity },
];

function NavItem({
  active,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: typeof LayoutDashboard;
  label: string;
  onClick: () => void;
}) {
  return (
    <button className={`refined-nav-item ${active ? "is-active" : ""}`} onClick={onClick} type="button">
      <Icon size={17} strokeWidth={active ? 2.2 : 1.8} />
      <span>{label}</span>
      {active && <span className="nav-dot" />}
    </button>
  );
}

function Stat({
  label,
  value,
  note,
  icon: Icon,
  accent,
}: {
  label: string;
  value: string;
  note: string;
  icon: typeof CheckCircle2;
  accent: string;
}) {
  return (
    <article className="refined-stat">
      <div className="stat-topline">
        <span>{label}</span>
        <span className={`stat-icon ${accent}`}><Icon size={16} /></span>
      </div>
      <strong>{value}</strong>
      <small>{note}</small>
    </article>
  );
}

export function Refined() {
  const [active, setActive] = useState("Overview");
  const [dark, setDark] = useState(false);
  const [role, setRole] = useState("Judge");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [reviewing, setReviewing] = useState<Case | null>(null);
  const [ready, setReady] = useState(false);

  return (
    <div className={`refined-shell ${dark ? "refined-dark" : ""}`} onAnimationEnd={() => setReady(true)}>
      <aside className={`refined-sidebar ${mobileOpen ? "mobile-open" : ""}`}>
        <div className="brand-lockup">
          <div className="brand-mark"><img src="/__mockup/branding/court-emblem-white.png" alt="Court emblem" /></div>
          <div>
            <div className="brand-name">Cause List Configuration</div>
            <div className="brand-sub">Justice Sehgal&apos;s Chamber</div>
          </div>
          <button className="mobile-close" type="button" onClick={() => setMobileOpen(false)} aria-label="Close navigation"><X size={18} /></button>
        </div>

        <div className="workspace-label">Workspace</div>
        <nav className="refined-nav">
          {nav.map(({ label, icon }) => (
            <NavItem key={label} label={label} icon={icon} active={active === label} onClick={() => { setActive(label); setMobileOpen(false); }} />
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="progress-card">
            <div className="progress-heading"><span>Monday sitting</span><b>62%</b></div>
            <div className="progress-track"><span /></div>
            <p>3h 06m of 5h scheduled</p>
          </div>
          <div className="profile-row">
            <div className="avatar">JS</div>
            <div className="profile-copy"><b>Justice Sehgal</b><span>Chamber dashboard</span></div>
            <button className="theme-button" type="button" onClick={() => setDark(!dark)} aria-label="Toggle theme">
              {dark ? <Sun size={16} /> : <Moon size={16} />}
            </button>
          </div>
          <label className="role-label" htmlFor="refined-role">Viewing as</label>
          <select id="refined-role" value={role} onChange={(event) => setRole(event.target.value)}>
            <option>Judge</option>
            <option>Court Master</option>
          </select>
        </div>
      </aside>

      {mobileOpen && <button className="mobile-scrim" onClick={() => setMobileOpen(false)} aria-label="Close menu" type="button" />}

      <main className={`refined-main ${ready ? "is-ready" : ""}`}>
        <header className="refined-header">
          <button className="mobile-menu" type="button" onClick={() => setMobileOpen(true)} aria-label="Open navigation"><Menu size={20} /></button>
          <div className="mobile-brand"><img src="/__mockup/branding/court-emblem-white.png" alt="Court emblem" /><b>Cause List Configuration</b></div>
          <div className="breadcrumb"><span>Chamber</span><ChevronRight size={14} /><b>{active}</b></div>
          <div className="header-right"><span className="live-indicator"><i /> Data synced 2m ago</span><div className="header-avatar">JS</div></div>
        </header>

        <div className="refined-content">
          <section className="hero-row">
            <div>
              <p className="eyebrow">MONDAY · 24 FEBRUARY 2025</p>
              <h1>Good morning, <em>Justice Sehgal.</em></h1>
              <p className="hero-note">A clear view of what needs your attention before the next sitting.</p>
            </div>
            <button className="primary-action" type="button" onClick={() => setActive("Cause list")}>
              Prepare cause list <ArrowUpRight size={17} />
            </button>
          </section>

          <section className="stat-grid">
            <Stat label="Recommended cases" value="18" note="Within 5 sitting hours" icon={CheckCircle2} accent="mint" />
            <Stat label="May move forward" value="12" note="If listed tomorrow" icon={ArrowUpRight} accent="gold" />
            <Stat label="Older than 4 years" value="07" note="Needs active review" icon={Clock3} accent="blue" />
            <Stat label="May not go ahead" value="03" note="Confirm before listing" icon={AlertTriangle} accent="coral" />
          </section>

          <section className="attention-section">
            <div className="section-heading">
              <div><h2>Needs your attention</h2><p>Two cases have signals worth checking before the list is finalised.</p></div>
              <button className="quiet-action" type="button" onClick={() => setActive("Priorities")}>View all <ArrowUpRight size={15} /></button>
            </div>
            <div className="case-list">
              {cases.map((item) => (
                <article className={`case-row ${reviewing?.id === item.id ? "is-selected" : ""}`} key={item.id}>
                  <div className={`age-chip ${item.tone}`}>{item.age}</div>
                  <div className="case-main"><h3>{item.title}</h3><p>{item.meta}</p><div className="tag-row">{item.tags.map((tag) => <span className={`tag ${item.tone}`} key={tag}>{tag}</span>)}</div></div>
                  <button className="review-button" type="button" onClick={() => setReviewing(item)}>{reviewing?.id === item.id ? <><Check size={15} /> Reviewing</> : <>Review <ArrowUpRight size={15} /></>}</button>
                </article>
              ))}
            </div>
          </section>

          <section className="lower-grid">
            <div className="next-card"><div className="section-heading compact"><div><p className="eyebrow">NEXT SITTING</p><h2>Monday, 24 February</h2></div><CalendarDays size={19} /></div><div className="timeline"><div className="timeline-line" /><div><b>10:30</b><span>Morning session begins</span></div><div><b>13:30</b><span>Lunch recess</span></div><div><b>16:00</b><span>Reserved buffer</span></div></div></div>
            <div className="signal-card"><div className="section-heading compact"><div><p className="eyebrow">PLANNER SIGNAL</p><h2>Room to move</h2></div><Gavel size={19} /></div><div className="signal-number">01<span>h</span> 54<span>m</span></div><p>Estimated capacity remains after the recommended cases. Keep it available for priority matters.</p><button type="button" onClick={() => setActive("Calendar")} className="text-action">Open calendar <ArrowUpRight size={15} /></button></div>
          </section>
        </div>
      </main>

      {reviewing && <div className="review-toast"><div className="toast-icon"><Check size={16} /></div><div><b>{reviewing.title}</b><span>Added to your review queue</span></div><button type="button" onClick={() => setReviewing(null)} aria-label="Dismiss"><X size={16} /></button></div>}
    </div>
  );
}

export default Refined;