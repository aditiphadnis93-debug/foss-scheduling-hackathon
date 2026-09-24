"use client";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { api, fmtDay } from "@/lib/api";
import { useRole } from "@/components/role";

type Summary = { name: string; preset_label: string; cases: number; clock: string | null; days_played: number; days_total: number; pending: number };

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const { ws } = useParams<{ ws: string }>();
  const path = usePathname();
  const { role } = useRole();
  const [s, setS] = useState<Summary | null>(null);

  useEffect(() => {
    api<Summary>(`/workspaces/${ws}`, role).then(setS).catch(() => {});
  }, [ws, role, path]);

  const tabs = [
    { href: `/w/${ws}`, label: "Today" },
    { href: `/w/${ws}/plan`, label: "Plan" },
    { href: `/w/${ws}/options`, label: "Rules & options" },
    { href: `/w/${ws}/changes`, label: "Changes" },
    { href: `/w/${ws}/health`, label: "Docket health" },
    { href: `/w/${ws}/history`, label: "Days so far" },
  ];
  return (
    <div>
      <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href="/" className="text-[13px] text-mut hover:text-acc">
            ← Courts
          </Link>
          <h1 className="text-[26px] font-semibold tracking-tight">{s?.name ?? "…"}</h1>
          {s && (
            <p className="text-sm text-mut">
              {s.preset_label} · {s.pending.toLocaleString("en-IN")} pending of {s.cases.toLocaleString("en-IN")} · {s.days_played} of {s.days_total} sitting days played
              {s.clock ? ` · today ${fmtDay(s.clock)}` : " · posting finished"}
            </p>
          )}
        </div>
        <nav className="flex flex-wrap gap-0.5 rounded-full bg-soft p-1 text-sm">
          {tabs.map((t) => {
            const active = t.href === `/w/${ws}` ? path === t.href : path.startsWith(t.href);
            return (
              <Link key={t.href} href={t.href} className={`rounded-full px-3 py-1 ${active ? "bg-card text-fg shadow-sm" : "text-mut hover:text-fg"}`}>
                {t.label}
              </Link>
            );
          })}
        </nav>
      </div>
      {children}
    </div>
  );
}
