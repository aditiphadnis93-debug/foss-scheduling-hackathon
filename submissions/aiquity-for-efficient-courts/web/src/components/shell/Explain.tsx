"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import clsx from "clsx";
import { Info } from "lucide-react";

// Site-wide "Explain: Plain | Technical". Plain is the default; the choice is remembered in this browser.
export type ExplainMode = "plain" | "technical";
const KEY = "ocl.explain";
const EVT = "ocl-explain";

function read(): ExplainMode {
  try {
    return localStorage.getItem(KEY) === "technical" ? "technical" : "plain";
  } catch {
    return "plain";
  }
}
function subscribe(cb: () => void) {
  window.addEventListener(EVT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVT, cb);
    window.removeEventListener("storage", cb);
  };
}
export function setExplain(m: ExplainMode) {
  try {
    localStorage.setItem(KEY, m);
  } catch {}
  window.dispatchEvent(new Event(EVT));
}

/** The current explanation mode (a tiny external store, so any component can read it). */
export function useExplain(): ExplainMode {
  return useSyncExternalStore(subscribe, read, () => "plain");
}

/** Children shown only in Technical mode; optional hint in Plain mode. */
export function Technical({ children, hint }: { children: ReactNode; hint?: string }) {
  const mode = useExplain();
  if (mode === "technical") return <>{children}</>;
  return hint ? <p className="mt-2 text-[12px] text-faint">{hint}</p> : null;
}

export function Plain({ children }: { children: ReactNode }) {
  return useExplain() === "plain" ? <>{children}</> : null;
}

export function ExplainToggle({ compact = false }: { compact?: boolean }) {
  const mode = useExplain();
  return (
    <div className="flex items-center gap-2">
      {!compact && (
        <span className="flex items-center gap-1.5 text-[12px] text-muted">
          <Info size={16} strokeWidth={1.75} aria-hidden />
          Explain
        </span>
      )}
      <div className="inline-flex rounded-lg border border-line bg-bg p-0.5">
        {(["plain", "technical"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setExplain(m)}
            className={clsx("rounded-md px-2 py-1 text-[12px] capitalize transition-colors", mode === m ? "bg-primary-subtle font-medium text-primary" : "text-muted hover:text-text")}
          >
            {m}
          </button>
        ))}
      </div>
    </div>
  );
}
