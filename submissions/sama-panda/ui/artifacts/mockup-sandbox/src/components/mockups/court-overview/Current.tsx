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
  Scale,
  SlidersHorizontal,
  Sun,
  Users,
} from "lucide-react";
import { useState, type ReactNode } from "react";
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

  const toggleTheme = () => {
    document.documentElement.classList.toggle("dark", !dark);
    setDark(!dark);
  };

  return (
    <div className="flex min-h-screen bg-background text-foreground flex-col md:flex-row font-serif">
      <aside className="w-full md:w-64 border-r border-border bg-sidebar shrink-0 font-sans flex flex-col">
        <div className="p-6 border-b border-sidebar-border flex items-center gap-3 text-sidebar-foreground">
          <Scale className="w-6 h-6 text-primary" />
          <div>
            <h1 className="font-serif font-bold text-lg leading-none tracking-tight">High Court</h1>
            <p className="text-xs text-muted-foreground mt-1 tracking-wider uppercase">Court Time Planner</p>
          </div>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1">
          {navItems.map((item) => {
            const isActive = location === item.path || (item.path !== "/" && location.startsWith(item.path));
            return (
              <Link
                key={item.path}
                href={item.path}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors ${isActive ? "bg-sidebar-primary text-sidebar-primary-foreground" : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"}`}
              >
                <item.icon className="w-4 h-4 opacity-80" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="p-4 border-t border-sidebar-border text-sm text-muted-foreground space-y-3">
          <div>Justice Sehgal&apos;s Chamber</div>
          <label className="block text-xs" htmlFor="role-switch">Viewing as</label>
          <select id="role-switch" value={role} onChange={(event) => setRole(event.target.value)} className="w-full bg-background border rounded-md p-2 text-foreground">
            <option>Judge</option>
            <option>Court Master</option>
          </select>
          <button type="button" onClick={toggleTheme} className="flex items-center gap-2 rounded-md border px-3 py-2 w-full text-foreground hover:bg-sidebar-accent" aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}>
            {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            {dark ? "Light mode" : "Dark mode"}
          </button>
        </div>
      </aside>
      <main className="flex-1 flex flex-col min-w-0">
        <div className="flex-1 p-6 md:p-10 max-w-6xl w-full mx-auto overflow-auto font-sans">{children}</div>
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