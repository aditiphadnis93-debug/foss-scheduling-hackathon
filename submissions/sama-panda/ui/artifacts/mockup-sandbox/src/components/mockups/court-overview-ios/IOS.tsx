import "./_group.css";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Calendar,
  CheckCircle,
  Clock,
  LayoutDashboard,
  List,
  Moon,
  Menu,
  X,
  SlidersHorizontal,
  Sun,
  Users,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

type Case = {
  id: string;
  ageYears: number;
  filingNumber: string;
  flags: string[];
  stage: string;
  waitingOn?: string;
};

type Dashboard = {
  nextDate: string;
  recommendedCount: number;
  sittingHours: number;
  movedForward: number;
  oldCases: number;
  sentHome: number;
  attention: Case[];
};

const dashboardData: Dashboard = {
  nextDate: "2025-02-24T00:00:00.000Z",
  recommendedCount: 18,
  sittingHours: 5,
  movedForward: 12,
  oldCases: 7,
  sentHome: 3,
  attention: [
    {
      id: "case-1042",
      ageYears: 6,
      filingNumber: "Crl. Appeal 1042/2019",
      flags: ["OLD_CASE", "WAITING_WARRANT"],
      stage: "Evidence",
      waitingOn: "warrant execution report",
    },
    {
      id: "case-0871",
      ageYears: 5,
      filingNumber: "Civil Suit 871/2020",
      flags: ["OLD_CASE"],
      stage: "Arguments",
    },
  ],
};

function useGetDashboard() {
  return { data: dashboardData, isLoading: false, isError: false };
}

function Link({
  href,
  children,
  className,
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <a href={href} className={className} onClick={(event) => event.preventDefault()}>
      {children}
    </a>
  );
}

const navItems = [
  { path: "/", label: "Overview", icon: LayoutDashboard },
  { path: "/calendar", label: "Calendar", icon: Calendar },
  { path: "/roster", label: "Roster", icon: Users },
  { path: "/priorities", label: "Priorities", icon: SlidersHorizontal },
  { path: "/cause-list", label: "Cause List", icon: List },
  { path: "/impact", label: "Impact", icon: Activity },
  { path: "/finalise", label: "Finalise", icon: CheckCircle },
];

function CourtShell({ children }: { children: ReactNode }) {
  const [location] = useState("/");
  const [role, setRole] = useState("Judge");
  const [dark, setDark] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const toggleTheme = () => {
    document.documentElement.classList.toggle("dark", !dark);
    setDark(!dark);
  };

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location]);

  return (
    <div className="flex min-h-[100dvh] bg-background text-foreground flex-col md:flex-row font-sans selection:bg-primary/20">
      <header className="md:hidden flex items-center justify-between p-3 border-b border-border bg-[#162b46] text-white sticky top-0 z-40">
        <div className="flex items-center gap-2.5 min-w-0">
          <img src="/__mockup/branding/court-emblem-white.png" alt="Court emblem" className="h-8 w-8 object-contain shrink-0" />
          <h1 className="font-serif font-semibold text-[17px] tracking-tight truncate">Cause List Configuration</h1>
        </div>
        <Button variant="ghost" size="icon" className="text-white hover:bg-white/10 hover:text-white" onClick={() => setMobileMenuOpen(true)}>
          <Menu className="w-6 h-6" />
        </Button>
      </header>
      <aside className={`fixed inset-y-0 left-0 z-50 w-72 md:w-64 bg-sidebar border-r border-border flex flex-col transition-transform duration-300 ease-in-out md:translate-x-0 md:static ${mobileMenuOpen ? "translate-x-0 shadow-2xl" : "-translate-x-full"}`}>
        <div className="m-4 mb-3 p-4 rounded-2xl flex items-center justify-between bg-[#162b46] text-white shadow-lg shadow-[#162b46]/20 md:block">
          <div className="flex items-center gap-3">
            <img src="/__mockup/branding/court-emblem-white.png" alt="Court emblem" className="w-10 h-10 object-contain shrink-0" />
            <div>
              <h1 className="font-serif font-bold text-[16px] leading-tight tracking-tight">Cause List Configuration</h1>
              <p className="text-[11px] text-white/65 font-medium uppercase tracking-wider">Justice Sehgal&apos;s Chamber</p>
            </div>
          </div>
          <Button variant="ghost" size="icon" className="md:hidden text-white hover:bg-white/10 hover:text-white" onClick={() => setMobileMenuOpen(false)}>
            <X className="w-5 h-5" />
          </Button>
        </div>
        <nav className="flex-1 px-4 py-2 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const isActive = location === item.path || (item.path !== "/" && location.startsWith(item.path));
            return (
              <Link
                key={item.path}
                href={item.path}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-[15px] font-medium transition-all duration-200 ${isActive ? "bg-primary text-primary-foreground shadow-sm shadow-primary/20" : "text-sidebar-foreground hover:bg-black/5 dark:hover:bg-white/10 active:scale-95"}`}
              >
                <item.icon className={`w-[18px] h-[18px] ${isActive ? "opacity-100" : "opacity-70"}`} />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="p-4 m-4 mt-auto rounded-2xl bg-card border shadow-sm text-sm space-y-4">
          <div className="text-center pb-2 border-b border-border/50">
            <p className="font-semibold text-[13px]">Justice Sehgal</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">Chamber Dashboard</p>
          </div>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <label className="block text-[11px] uppercase tracking-wider text-muted-foreground font-semibold px-1" htmlFor="role-switch">Role</label>
              <select id="role-switch" value={role} onChange={(event) => setRole(event.target.value)} className="w-full bg-sidebar/50 border-0 ring-1 ring-inset ring-border rounded-lg p-2 text-[14px] text-foreground focus:ring-2 focus:ring-primary outline-none transition-all">
                <option>Judge</option>
                <option>Court Master</option>
              </select>
            </div>
            <button type="button" onClick={toggleTheme} className="flex items-center justify-between w-full rounded-lg px-3 py-2 text-[14px] font-medium text-foreground hover:bg-black/5 dark:hover:bg-white/10 active:scale-95 transition-all" aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}>
              <span className="flex items-center gap-2 text-muted-foreground">
                {dark ? <Sun className="w-[18px] h-[18px]" /> : <Moon className="w-[18px] h-[18px]" />}
                {dark ? "Light Theme" : "Dark Theme"}
              </span>
            </button>
          </div>
        </div>
      </aside>
      {mobileMenuOpen && <div className="fixed inset-0 bg-black/20 backdrop-blur-sm z-40 md:hidden" onClick={() => setMobileMenuOpen(false)} />}
      <main className="flex-1 flex flex-col min-w-0 bg-background md:rounded-tl-[2.5rem] md:shadow-[-8px_0_24px_-12px_rgba(0,0,0,0.1)] overflow-hidden border-l border-border relative z-0">
        <div className="flex-1 p-4 sm:p-6 md:p-10 max-w-5xl w-full mx-auto overflow-auto scroll-smooth">{children}</div>
      </main>
    </div>
  );
}

function DashboardPage() {
  const { data: dashboard, isLoading, isError } = useGetDashboard();

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="space-y-2">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-96" />
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-32 rounded-xl" />)}
        </div>
      </div>
    );
  }

  if (isError || !dashboard) {
    return (
      <div className="p-8 text-center bg-destructive/10 text-destructive rounded-xl border border-destructive/20">
        <AlertTriangle className="w-8 h-8 mx-auto mb-4" />
        <h2 className="text-lg font-semibold">Failed to load dashboard</h2>
        <p>There was a problem retrieving the latest data.</p>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-serif font-bold text-foreground">Good morning, Justice Sehgal</h1>
          <p className="text-muted-foreground mt-1">
            Overview for the next sitting date:{" "}
            <span className="font-semibold text-foreground">
              {new Date(dashboard.nextDate).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
            </span>
          </p>
        </div>
        <Button asChild className="gap-2 shrink-0">
          <Link href="/cause-list">Prepare tomorrow&apos;s cause list <ArrowRight className="w-4 h-4" /></Link>
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">Recommended Cases</CardTitle>
            <CheckCircle className="w-4 h-4 text-primary" />
          </CardHeader>
          <CardContent><div className="text-2xl font-bold">{dashboard.recommendedCount}</div><p className="text-xs text-muted-foreground mt-1">Based on {dashboard.sittingHours} sitting hours</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">Cases that may move forward if listed</CardTitle>
            <ArrowRight className="w-4 h-4 text-amber-500" />
          </CardHeader>
          <CardContent><div className="text-2xl font-bold">{dashboard.movedForward}</div><p className="text-xs text-muted-foreground mt-1">Estimate, not recorded outcomes</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">Cases older than 4 years</CardTitle>
            <Clock className="w-4 h-4 text-blue-500" />
          </CardHeader>
          <CardContent><div className="text-2xl font-bold">{dashboard.oldCases}</div><p className="text-xs text-muted-foreground mt-1">Trend unavailable without earlier rosters</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">Hearings that may not go ahead</CardTitle>
            <AlertTriangle className="w-4 h-4 text-destructive" />
          </CardHeader>
          <CardContent><div className="text-2xl font-bold">{dashboard.sentHome}</div><p className="text-xs text-muted-foreground mt-1">Estimate, not people actually sent home</p></CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        <h2 className="text-xl font-serif font-semibold">Needs your attention</h2>
        <p className="text-sm text-muted-foreground">This sample does not include past adjournment streaks, verified service records, or weekly outcomes. Flags based on the supplied latest-hearing note need confirmation.</p>
        {dashboard.attention.length === 0 ? (
          <div className="p-8 text-center border rounded-xl bg-card">
            <CheckCircle className="w-8 h-8 text-primary mx-auto mb-3" />
            <h3 className="font-medium">All caught up</h3>
            <p className="text-sm text-muted-foreground mt-1">No cases require manual intervention at this time.</p>
          </div>
        ) : (
          <div className="grid gap-3">
            {dashboard.attention.map((item) => (
              <Card key={item.id} className="hover-elevate transition-all">
                <CardContent className="p-4 flex items-center justify-between gap-4">
                  <div className="flex-1 min-w-0 flex items-center gap-4">
                    <div className="w-12 h-12 bg-destructive/10 text-destructive rounded-lg flex items-center justify-center font-bold shrink-0">{item.ageYears}y</div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">{item.filingNumber}</span>
                        {item.flags.map((flag) => <Badge key={flag} variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0">{flag === "OLD_CASE" ? "4+ years old" : flag === "WAITING_WARRANT" ? "Process needs checking" : flag}</Badge>)}
                      </div>
                      <p className="text-sm text-muted-foreground mt-1 truncate">{item.stage} {item.waitingOn ? `• ${item.waitingOn}` : "• Older case needs review"}</p>
                    </div>
                  </div>
                  <Button variant="outline" size="sm" asChild className="shrink-0"><Link href={`/roster/${item.id}`}>Review</Link></Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function Current() {
  return <CourtShell><DashboardPage /></CourtShell>;
}