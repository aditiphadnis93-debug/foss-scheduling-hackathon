"use client";

import { motion } from "framer-motion";
import type { ReactNode } from "react";
import { EASE } from "@/lib/motion";

export default function PageHeader({
  eyebrow,
  title,
  lede,
  right,
}: {
  eyebrow: string;
  title: ReactNode;
  lede?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <motion.header
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: EASE }}
      className="mb-6 flex min-w-0 flex-col gap-4 md:mb-8 xl:flex-row xl:items-end xl:justify-between"
    >
      <div className="min-w-0 max-w-3xl">
        <p className="mb-2 text-[12px] font-medium uppercase tracking-[0.14em] text-primary">{eyebrow}</p>
        <h1 className="display text-[24px] leading-[1.2] sm:text-[28px] lg:text-[34px] xl:text-[38px] break-words">{title}</h1>
        {lede && <p className="mt-3 text-[15px] leading-relaxed text-muted">{lede}</p>}
      </div>
      {right && <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">{right}</div>}
    </motion.header>
  );
}
