export const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8765";

export type Role = "Judge" | "Court Master" | "Analyst";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function api<T>(path: string, role: Role, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}/api${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", "X-Role": role, ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  if (!res.ok) {
    let msg = res.statusText;
    try {
      msg = (await res.json()).detail ?? msg;
    } catch {}
    throw new ApiError(res.status, msg);
  }
  return res.json();
}

export const pct = (v: number | null | undefined, d = 0) =>
  v == null || Number.isNaN(v) ? "—" : `${(v * 100).toFixed(d)}%`;
export const num = (v: number | null | undefined, d = 0) =>
  v == null || Number.isNaN(v) ? "—" : v.toLocaleString("en-IN", { maximumFractionDigits: d });
export const fmtDay = (d: string | null | undefined) =>
  d ? new Date(d + "T00:00:00").toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" }) : "—";
