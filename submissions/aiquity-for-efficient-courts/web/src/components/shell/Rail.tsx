"use client";

import { useEffect, useState, useSyncExternalStore, type ComponentType } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  BookOpen,
  CalendarClock,
  ChartColumn,
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  House,
  Hourglass,
  IdCard,
  Info,
  Layers,
  Lightbulb,
  Map as MapIcon,
  Menu,
  Radar,
  Scale,
  ScrollText,
  Search,
  SlidersHorizontal,
  Sparkles,
  Target,
  UserRound,
  Users,
  X,
  Route,
  Gavel,
  Zap,
  Settings2,
  ClipboardList } from "lucide-react";
import clsx from "clsx";
import ThemeToggle from "./ThemeToggle";
import { ExplainToggle, setExplain, useExplain } from "./Explain";

type Item = { href: string; label: string; icon: ComponentType<{ size?: number; strokeWidth?: number; className?: string; "aria-hidden"?: boolean }> };
type Group = { id: string; label: string; items: Item[]; caseSearch?: boolean };

const HOME: Item = { href: "/", label: "Home", icon: House };
const ACTIONS: Item = { href: "/actions", label: "Court actions", icon: Zap };
const BENCH: Item = { href: "/bench", label: "Bench view", icon: Gavel };
const MASTER: Item = { href: "/master", label: "Court master", icon: ClipboardList };
const ALGO: Item = { href: "/algorithm", label: "How we schedule", icon: Route };
const GROUPS: Group[] = [
  {
    id: "today",
    label: "The court today",
    items: [
      { href: "/court", label: "Court day", icon: CalendarClock },
      { href: "/assistant", label: "Court assistant", icon: Sparkles },
      { href: "/access", label: "What people see", icon: Users },
      { href: "/delays", label: "Who is the delay?", icon: Hourglass },
    ],
  },
  {
    id: "plan",
    label: "Plan & change",
    items: [
      { href: "/scorecard", label: "Scorecard", icon: ChartColumn },
      { href: "/whatif", label: "Simulation", icon: SlidersHorizontal },
      { href: "/runway", label: "What this posting can close", icon: Target },
      { href: "/priors", label: "What the court assumes", icon: BookOpen },
    ],
  },
  {
    id: "cases",
    label: "Cases & people",
    items: [
      { href: "/backlog", label: "Backlog", icon: Layers },
      { href: "/profiles", label: "Profiles", icon: IdCard },
      { href: "/people", label: "People", icon: UserRound },
    ],
    caseSearch: true,
  },
  {
    id: "town",
    label: "The town",
    items: [
      { href: "/observatory", label: "Observatory", icon: Radar },
      { href: "/world", label: "Town map", icon: MapIcon },
    ],
  },
  {
    id: "behind",
    label: "Behind the scenes",
    items: [
      { href: "/how", label: "How it works", icon: Lightbulb },
      { href: "/audit", label: "Decision log", icon: ScrollText },
      { href: "/settings", label: "Settings & rules", icon: Settings2 },
    ],
  },
];

function isActive(path: string | null, href: string) {
  return href === "/" ? path === "/" : !!path?.startsWith(href);
}

function NavLink({ item, active, collapsed = false }: { item: Item; active: boolean; collapsed?: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      aria-label={collapsed ? item.label : undefined}
      title={collapsed ? item.label : undefined}
      className={clsx(
        "group relative flex items-center gap-3 rounded-lg py-1.5 text-[14px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
        collapsed ? "justify-center px-0 py-2" : "px-3",
        active ? "font-medium text-primary" : "text-muted hover:bg-surface-2 hover:text-text",
      )}
    >
      {active && <motion.span layoutId="rail-active" className="absolute inset-0 rounded-lg bg-primary-subtle" transition={{ type: "spring", stiffness: 420, damping: 36 }} />}
      <Icon size={18} strokeWidth={1.75} className="relative shrink-0" aria-hidden />
      {collapsed ? (
        <span
          role="tooltip"
          className="float pointer-events-none absolute left-full top-1/2 z-50 ml-3 -translate-y-1/2 whitespace-nowrap rounded-md border border-line bg-surface px-2 py-1 text-[12px] font-medium text-text opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
        >
          {item.label}
        </span>
      ) : (
        <span className="relative leading-tight">{item.label}</span>
      )}
    </Link>
  );
}

function CaseSearch() {
  const router = useRouter();
  const [q, setQ] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const id = q.trim();
        if (id) router.push(`/case/${encodeURIComponent(id)}`);
      }}
      className="relative mx-3 mt-1"
    >
      <Search size={15} strokeWidth={1.75} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Open a case file (e.g. ST/123/2020)"
        aria-label="Open a case file by case number"
        className="w-full rounded-lg border border-line bg-surface-2 py-2 pl-8 pr-2 text-[13px] text-text outline-none placeholder:text-muted focus:bg-bg focus:ring-2 focus:ring-primary/50"
      />
    </form>
  );
}

// Collapsed state lives on <html data-rail="collapsed"> (set before paint in layout.tsx) so the
// content offset is right on first render; this store mirrors it into React.
const RAIL_KEY = "ocl.rail";
function subscribeRail(cb: () => void) {
  const obs = new MutationObserver(cb);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-rail"] });
  return () => obs.disconnect();
}
const getCollapsed = () => document.documentElement.dataset.rail === "collapsed";
function setCollapsed(v: boolean) {
  if (v) document.documentElement.dataset.rail = "collapsed";
  else delete document.documentElement.dataset.rail;
  try {
    localStorage.setItem(RAIL_KEY, v ? "collapsed" : "open");
  } catch {}
}

function Brand({ collapsed }: { collapsed: boolean }) {
  return (
    <Link href="/" className="flex min-w-0 items-center gap-3 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50" aria-label="AIQuity for Efficient Courts, home">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary text-on-primary">
        <Scale size={20} strokeWidth={1.75} />
      </span>
      {!collapsed && (
        <span className="min-w-0 leading-tight">
          <span className="display block text-[14px]">AIQuity for Efficient Courts</span>
          <span className="block text-[12px] text-muted">Court scheduling</span>
        </span>
      )}
    </Link>
  );
}

function CompactExplain() {
  const mode = useExplain();
  const next = mode === "plain" ? "technical" : "plain";
  return (
    <button
      onClick={() => setExplain(next)}
      title={`Explain: ${mode} (switch to ${next})`}
      aria-label={`Explain mode is ${mode}. Switch to ${next}.`}
      className="grid h-8 w-10 place-items-center rounded-lg border border-line bg-bg transition hover:bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
    >
      <Info size={18} strokeWidth={1.75} className={mode === "technical" ? "text-primary" : "text-muted"} />
    </button>
  );
}

function NavBody({ path, collapsed, onNavigate }: { path: string | null; collapsed: boolean; onNavigate?: () => void }) {
  const current = GROUPS.find((g) => g.items.some((i) => isActive(path, i.href)) || (g.caseSearch && path?.startsWith("/case/")))?.id;
  const [openState, setOpen] = useState<Record<string, boolean>>({});
  const isOpen = (id: string) => openState[id] ?? true;
  return (
    <nav
      className={clsx("scroll-thin flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto overflow-x-hidden pb-3", collapsed ? "px-2" : "px-3")}
      aria-label="Main"
      onClick={(e) => {
        if (onNavigate && (e.target as HTMLElement).closest("a")) onNavigate();
      }}
    >
      <NavLink item={HOME} active={isActive(path, "/")} collapsed={collapsed} />
          <NavLink item={ACTIONS} active={isActive(path, "/actions")} collapsed={collapsed} />
          <NavLink item={BENCH} active={isActive(path, "/bench")} collapsed={collapsed} />
          <NavLink item={MASTER} active={isActive(path, "/master")} collapsed={collapsed} />
          <NavLink item={ALGO} active={isActive(path, "/algorithm")} collapsed={collapsed} />
      {GROUPS.map((g) => {
        if (collapsed) {
          return (
            <div key={g.id} className="mt-2 flex flex-col gap-0.5 border-t border-line pt-2">
              {g.items.map((i) => (
                <NavLink key={i.href} item={i} active={isActive(path, i.href)} collapsed />
              ))}
            </div>
          );
        }
        const open = isOpen(g.id);
        return (
          <div key={g.id} className="mt-1">
            <button
              onClick={() => setOpen((s) => ({ ...s, [g.id]: !open }))}
              aria-expanded={open}
              aria-controls={`nav-${g.id}`}
              className={clsx(
                "flex w-full items-center justify-between rounded-lg px-3 py-1.5 text-left text-[11px] font-medium uppercase tracking-[0.1em] transition-colors hover:bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
                g.id === current ? "text-text" : "text-faint",
              )}
            >
              {g.label}
              <ChevronDown size={14} className={clsx("transition-transform", open && "rotate-180")} />
            </button>
            <AnimatePresence initial={false}>
              {open && (
                <motion.div
                  id={`nav-${g.id}`}
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="flex flex-col gap-0.5 overflow-hidden pt-0.5"
                >
                  {g.items.map((i) => (
                    <NavLink key={i.href} item={i} active={isActive(path, i.href)} />
                  ))}
                  {g.caseSearch && <CaseSearch />}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </nav>
  );
}

function Footer({ collapsed }: { collapsed: boolean }) {
  if (collapsed) {
    return (
      <div className="flex flex-col items-center gap-2 border-t border-line px-2 pb-16 pt-3">
        <CompactExplain />
        <ThemeToggle compact />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3 border-t border-line px-5 pb-16 pt-4">
      <ExplainToggle />
      <ThemeToggle />
      <p className="text-[11px] leading-snug text-faint">Simulated court. Anonymised roster. Open source.</p>
    </div>
  );
}

export default function Rail() {
  const path = usePathname();
  const collapsed = useSyncExternalStore(subscribeRail, getCollapsed, () => false);
  const [drawer, setDrawer] = useState(false);

  // Close the drawer on navigation and on Escape.
  const [lastPath, setLastPath] = useState(path);
  if (lastPath !== path) {
    setLastPath(path);
    setDrawer(false);
  }
  useEffect(() => {
    if (!drawer) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setDrawer(false);
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [drawer]);

  return (
    <>
      {/* Desktop rail: fixed, own scroll, collapsible to icons. */}
      <aside
        className="fixed inset-y-0 left-0 z-40 hidden flex-col border-r border-line bg-bg transition-[width] duration-200 ease-out lg:flex"
        style={{ width: "var(--rail-w)" }}
        aria-label="Site navigation"
      >
        <div className={clsx("flex shrink-0 items-center gap-2 pb-4 pt-5", collapsed ? "flex-col px-2" : "px-4")}>
          <Brand collapsed={collapsed} />
          <button
            onClick={() => setCollapsed(!collapsed)}
            aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
            title={collapsed ? "Expand navigation" : "Collapse navigation"}
            className={clsx(
              "grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted transition hover:bg-surface-2 hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
              !collapsed && "ml-auto",
            )}
          >
            {collapsed ? <ChevronsRight size={18} strokeWidth={1.75} /> : <ChevronsLeft size={18} strokeWidth={1.75} />}
          </button>
        </div>
        <NavBody path={path} collapsed={collapsed} />
        <Footer collapsed={collapsed} />
      </aside>

      {/* Narrow screens: sticky top bar + slide-over drawer. */}
      <header className="sticky top-0 z-40 flex h-14 items-center gap-3 border-b border-line bg-bg/95 px-4 backdrop-blur lg:hidden">
        <button
          onClick={() => setDrawer(true)}
          aria-label="Open navigation"
          aria-expanded={drawer}
          aria-controls="nav-drawer"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line text-text transition hover:bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
        >
          <Menu size={18} strokeWidth={1.75} />
        </button>
        <Link href="/" className="flex min-w-0 items-center gap-2">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-primary text-on-primary">
            <Scale size={16} strokeWidth={1.75} />
          </span>
          <span className="display truncate text-[14px]">AIQuity for Efficient Courts</span>
        </Link>
      </header>
      <AnimatePresence>
        {drawer && (
          <div className="fixed inset-0 z-50 lg:hidden" id="nav-drawer" role="dialog" aria-modal="true" aria-label="Navigation">
            <motion.div
              className="absolute inset-0 bg-black/40"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={() => setDrawer(false)}
            />
            <motion.aside
              className="absolute inset-y-0 left-0 flex w-[min(288px,85vw)] flex-col border-r border-line bg-bg shadow-xl"
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", stiffness: 420, damping: 40 }}
            >
              <div className="flex shrink-0 items-center gap-2 px-4 pb-4 pt-4">
                <Brand collapsed={false} />
                <button
                  onClick={() => setDrawer(false)}
                  aria-label="Close navigation"
                  autoFocus
                  className="ml-auto grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted transition hover:bg-surface-2 hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                >
                  <X size={18} strokeWidth={1.75} />
                </button>
              </div>
              <NavBody path={path} collapsed={false} onNavigate={() => setDrawer(false)} />
              <Footer collapsed={false} />
            </motion.aside>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
