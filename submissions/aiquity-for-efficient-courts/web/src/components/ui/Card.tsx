"use client";

import clsx from "clsx";
import { motion } from "framer-motion";
import type { ReactNode } from "react";
import { EASE } from "@/lib/motion";
import { alpha } from "@/lib/theme";

export function Card({
  children,
  className,
  title,
  subtitle,
  right,
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  title?: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;
  delay?: number;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.55, ease: EASE, delay }}
      className={clsx("card p-5 md:p-6", className)}
    >
      {(title || right) && (
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            {title && <h2 className="text-[16px] font-semibold">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-[13px] text-muted">{subtitle}</p>}
          </div>
          {right}
        </div>
      )}
      {children}
    </motion.section>
  );
}

/** The one-line "what this tells the judge" under every chart. */
export function Takeaway({ children }: { children: ReactNode }) {
  return (
    <p className="mt-4 flex gap-2 border-t border-line pt-3 text-[13px] leading-relaxed text-muted">
      <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
      <span>{children}</span>
    </p>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx("animate-pulse rounded-lg bg-surface-2", className)} />;
}

export function Badge({ children, colour, className }: { children: ReactNode; colour?: string; className?: string }) {
  return (
    <span
      className={clsx("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium", className)}
      style={colour ? { color: colour, background: alpha(colour, 12), boxShadow: `inset 0 0 0 1px ${alpha(colour, 30)}` } : undefined}
    >
      {children}
    </span>
  );
}

export function Dot({ colour, size = 8 }: { colour: string; size?: number }) {
  return <span className="inline-block shrink-0 rounded-full" style={{ width: size, height: size, background: colour }} />;
}
