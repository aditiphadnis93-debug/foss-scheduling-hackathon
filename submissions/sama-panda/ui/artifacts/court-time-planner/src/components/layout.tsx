import { Link, useLocation } from "wouter";
import { LayoutDashboard, Calendar, Users, SlidersHorizontal, List, Activity, CheckCircle, Moon, Sun, Menu, X, PanelLeftClose, PanelLeftOpen, ShieldCheck, ClipboardList, Scale } from "lucide-react";
import { useActorRole, setActorRole, type ActorRole } from "@/hooks/use-actor-role";
import { ReactNode, useState, useEffect } from "react";
import { Button } from "@/components/ui/button";

const navItems = [
  { path: "/", label: "Overview", icon: LayoutDashboard },
  { path: "/calendar", label: "Calendar", icon: Calendar },
  { path: "/roster", label: "Roster", icon: Users },
  { path: "/eligibility", label: "Eligibility", icon: ClipboardList },
  { path: "/registry", label: "Registry queue", icon: ShieldCheck },
  { path: "/policy", label: "Defect policy", icon: Scale },
  { path: "/priorities", label: "Priorities", icon: SlidersHorizontal },
  { path: "/cause-list", label: "Cause List", icon: List },
  { path: "/impact", label: "Impact", icon: Activity },
  { path: "/finalise", label: "Finalise", icon: CheckCircle },
];

// Keep the source in one place so the transparent emblem can be swapped without
// changing the shared shell. The production asset lives in public/branding.
const BRAND_EMBLEM_SRC = `${import.meta.env.BASE_URL}branding/court-emblem-white.png`;

export function Layout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const actorRole = useActorRole();
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark") || localStorage.getItem("planner-theme") === "dark");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("planner-sidebar-collapsed") === "true");

  const toggleTheme = () => {
    document.documentElement.classList.toggle("dark", !dark);
    localStorage.setItem("planner-theme", dark ? "light" : "dark");
    setDark(!dark);
  };

  // Close mobile menu on navigation
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location]);

  useEffect(() => {
    if (!mobileMenuOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileMenuOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [mobileMenuOpen]);

  const toggleSidebar = () => {
    setCollapsed(current => {
      localStorage.setItem("planner-sidebar-collapsed", String(!current));
      return !current;
    });
  };

  return (
    <div className="planner-shell flex h-[100dvh] overflow-hidden bg-background text-foreground flex-col md:flex-row font-sans selection:bg-primary/20">
      {/* Mobile Top Bar */}
      <header className="print-hidden md:hidden flex items-center justify-between px-4 py-3 border-b border-border bg-card text-foreground sticky top-0 z-40">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="w-9 h-9 rounded-md bg-[#162b46] flex items-center justify-center shrink-0"><img src={BRAND_EMBLEM_SRC} alt="National emblem" className="h-7 w-7 object-contain" /></span>
          <h1 className="font-semibold text-[14px] tracking-tight truncate">Sama-Panda Readiness</h1>
        </div>
        <Button variant="ghost" size="icon" onClick={() => setMobileMenuOpen(true)} aria-label="Open navigation" aria-expanded={mobileMenuOpen} aria-controls="planner-navigation">
          <Menu className="w-5 h-5" />
        </Button>
      </header>

      {/* Sidebar (Desktop) / Drawer (Mobile) */}
      <aside id="planner-navigation" className={`print-hidden fixed inset-y-0 left-0 z-50 w-72 bg-sidebar border-r border-border flex flex-col transition-[transform,width] duration-200 ease-out md:sticky md:top-0 md:h-full md:shrink-0 md:translate-x-0 md:visible ${collapsed ? 'md:w-[72px]' : 'md:w-60'} ${mobileMenuOpen ? 'translate-x-0 visible' : '-translate-x-full invisible'}`}>
        <div className="border-b border-border px-3 py-4">
          <div className={`flex items-center gap-2 ${collapsed ? 'md:justify-center' : ''}`}>
            <span className="w-10 h-10 rounded-md bg-[#162b46] flex items-center justify-center shrink-0">
              <img src={BRAND_EMBLEM_SRC} alt="National emblem" className="w-8 h-8 object-contain" />
            </span>
            <div className={`min-w-0 ${collapsed ? 'md:hidden' : ''}`}>
              <h1 className="font-semibold text-[13px] leading-tight tracking-tight">Sama-Panda Readiness</h1>
            </div>
            <Button variant="ghost" size="icon" className="md:hidden ml-auto" onClick={() => setMobileMenuOpen(false)} aria-label="Close navigation">
              <X className="w-5 h-5" />
            </Button>
          </div>
        </div>

        <nav aria-label="Main navigation" className="min-h-0 flex-1 px-2.5 py-4 space-y-0.5 overflow-y-auto md:overflow-hidden">
          {navItems.map((item) => {
            const isActive = location === item.path || (item.path !== "/" && location.startsWith(item.path));
            return (
              <Link 
                key={item.path} 
                href={item.path} 
                title={collapsed ? item.label : undefined}
                aria-current={isActive ? "page" : undefined}
                className={`flex items-center gap-3 px-3 py-2 rounded-md text-[13px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-primary ${collapsed ? 'md:justify-center md:px-0' : ''} ${
                  isActive 
                    ? 'bg-sidebar-accent text-foreground font-semibold'
                    : 'text-muted-foreground hover:bg-sidebar-accent/70 hover:text-foreground'
                }`}
              >
                <item.icon className="w-[16px] h-[16px] shrink-0" aria-hidden="true" />
                <span className={collapsed ? 'md:sr-only' : ''}>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className={`mt-auto border-t border-border p-3 text-sm ${collapsed ? 'md:px-2' : ''}`}>
          <div className={`flex items-center gap-2 ${collapsed ? 'md:justify-center' : ''}`}>
            <span className={`min-w-0 px-2 text-[13px] font-semibold ${collapsed ? 'md:sr-only' : ''}`}>Justice Sehgal</span>
            <button type="button" className={`hidden md:flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-primary focus-visible:outline-2 focus-visible:outline-primary ${collapsed ? '' : 'ml-auto'}`} onClick={toggleSidebar} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} aria-expanded={!collapsed} title={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
              {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
            </button>
          </div>
          <label className={`mb-2 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[12px] text-muted-foreground ${collapsed ? 'md:justify-center' : ''}`}>
            <span className={collapsed ? 'md:sr-only' : ''}>Role</span>
            <select
              className={`rounded border bg-background px-1 py-0.5 text-[12px] text-foreground ${collapsed ? 'md:w-10' : 'ml-auto'}`}
              value={actorRole}
              onChange={(e) => setActorRole(e.target.value as ActorRole)}
              aria-label="Actor role"
              title={actorRole}
            >
              <option value="counsel">counsel</option>
              <option value="party">party</option>
              <option value="registry">registry</option>
            </select>
          </label>
          <button
            type="button"
            onClick={toggleTheme}
            className={`mt-2 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[12px] font-medium text-muted-foreground hover:bg-sidebar-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary ${collapsed ? 'md:justify-center' : ''}`}
            aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
            title={collapsed ? (dark ? "Light Theme" : "Dark Theme") : undefined}
          >
            {dark ? <Sun className="h-4 w-4 shrink-0" /> : <Moon className="h-4 w-4 shrink-0" />}
            <span className={collapsed ? 'md:sr-only' : ''}>{dark ? "Light Theme" : "Dark Theme"}</span>
          </button>
        </div>
      </aside>

      {/* Overlay for mobile */}
      {mobileMenuOpen && (
        <div 
          className="fixed inset-0 bg-black/25 z-40 md:hidden"
          aria-hidden="true"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Main Content */}
      <main className="relative z-0 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
        <div className="mx-auto min-h-0 w-full max-w-[1440px] flex-1 overflow-y-auto p-4 scroll-smooth sm:p-6 lg:p-8">
          {children}
        </div>
      </main>
    </div>
  );
}