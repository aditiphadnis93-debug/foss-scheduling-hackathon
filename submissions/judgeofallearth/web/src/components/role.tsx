"use client";
import { createContext, useContext, useEffect, useState } from "react";
import type { Role } from "@/lib/api";

const RoleCtx = createContext<{ role: Role; setRole: (r: Role) => void }>({ role: "Court Master", setRole: () => {} });

export function RoleProvider({ children }: { children: React.ReactNode }) {
  const [role, setRoleState] = useState<Role>("Court Master");
  useEffect(() => {
    try {
      const r = localStorage.getItem("role") as Role | null;
      if (r) setRoleState(r);
    } catch {}
  }, []);
  const setRole = (r: Role) => {
    setRoleState(r);
    try {
      localStorage.setItem("role", r);
    } catch {}
  };
  return <RoleCtx.Provider value={{ role, setRole }}>{children}</RoleCtx.Provider>;
}

export const useRole = () => useContext(RoleCtx);

export function RoleSwitcher() {
  const { role, setRole } = useRole();
  const roles: Role[] = ["Judge", "Court Master", "Analyst"];
  return (
    <div className="flex items-center gap-0.5 rounded-full bg-soft p-1 text-sm" title="Acting as (no login: identity belongs to DRISTI)">
      {roles.map((r) => (
        <button
          key={r}
          onClick={() => setRole(r)}
          className={`rounded-full px-3 py-1 transition ${role === r ? "bg-card text-fg shadow-sm" : "text-mut hover:text-fg"}`}
        >
          {r}
        </button>
      ))}
    </div>
  );
}
