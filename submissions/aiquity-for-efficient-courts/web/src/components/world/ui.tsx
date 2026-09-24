"use client";

import { animate, motion, useMotionValue, useTransform } from "framer-motion";
import { useEffect } from "react";
import clsx from "clsx";

/** A number that counts to its new value. */
export function Num({ value, format = (v) => Math.round(v).toLocaleString("en-IN"), className, duration = 0.7 }: {
  value: number; format?: (v: number) => string; className?: string; duration?: number;
}) {
  const mv = useMotionValue(value);
  const text = useTransform(mv, (v) => format(v));
  useEffect(() => {
    const c = animate(mv, value, { duration, ease: [0.22, 1, 0.36, 1] });
    return () => c.stop();
  }, [mv, value, duration]);
  return <motion.span className={clsx("tabular-nums", className)}>{text}</motion.span>;
}

export function Panel({ className, children, flat }: { className?: string; children: React.ReactNode; flat?: boolean }) {
  return (
    <div className={clsx("rounded-xl border border-[var(--border,var(--line,#E1E7EF))] bg-[var(--surface)]", !flat && "shadow-[0_1px_2px_rgba(17,24,39,.06),0_8px_24px_rgba(17,24,39,.06)]", className)}>
      {children}
    </div>
  );
}

export function IconButton({ onClick, active, title, children, className }: {
  onClick: () => void; active?: boolean; title: string; children: React.ReactNode; className?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      onClick={onClick}
      className={clsx(
        "inline-flex h-9 items-center justify-center gap-1.5 rounded-xl border px-2.5 text-xs font-medium transition-colors",
        active ? "border-[var(--primary,#2463EB)] bg-[var(--primary-subtle,#F0F6FF)] text-[var(--primary-strong,#1E3B8A)]" : "border-[var(--border,var(--line,#E1E7EF))] bg-[var(--bg,var(--surface))] text-[var(--text)] hover:bg-[var(--surface-2)]",
        className,
      )}
    >
      {children}
    </button>
  );
}
