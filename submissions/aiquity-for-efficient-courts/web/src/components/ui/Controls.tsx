"use client";

import clsx from "clsx";
import { motion } from "framer-motion";
import type { ReactNode } from "react";
import { alpha } from "@/lib/theme";

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  id,
}: {
  value: T;
  options: { value: T; label: ReactNode; disabled?: boolean }[];
  onChange: (v: T) => void;
  id: string;
}) {
  return (
    <div className="inline-flex rounded-lg border border-line bg-surface-2 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
          className={clsx(
            "relative rounded-lg px-3 py-1.5 text-[13px] transition-colors disabled:cursor-not-allowed disabled:opacity-40",
            value === o.value ? "text-text" : "text-muted hover:text-text",
          )}
        >
          {value === o.value && (
            <motion.span
              layoutId={`seg-${id}`}
              className="absolute inset-0 rounded-md bg-bg ring-1 ring-line"
              transition={{ type: "spring", stiffness: 500, damping: 38 }}
            />
          )}
          <span className="relative">{o.label}</span>
        </button>
      ))}
    </div>
  );
}

export function Chips({
  options,
  value,
  onChange,
  colourOf,
  labelOf,
  locked = [],
}: {
  options: string[];
  value: string[];
  onChange: (v: string[]) => void;
  colourOf: (o: string) => string;
  labelOf: (o: string) => string;
  locked?: string[];
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => {
        const on = value.includes(o);
        const c = colourOf(o);
        return (
          <button
            key={o}
            disabled={locked.includes(o)}
            onClick={() => onChange(on ? value.filter((x) => x !== o) : [...value, o])}
            className={clsx(
              "flex items-center gap-2 rounded-full border px-3 py-1.5 text-[13px] transition",
              on ? "text-text" : "border-line text-muted hover:text-text",
              locked.includes(o) && "cursor-default",
            )}
            style={on ? { borderColor: alpha(c, 50), background: alpha(c, 10) } : undefined}
          >
            <span className="h-2 w-2 rounded-full" style={{ background: on ? c : "var(--text-faint)" }} />
            {labelOf(o)}
          </button>
        );
      })}
    </div>
  );
}

export function Select<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label?: string;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      {label && <span className="text-[11px] uppercase tracking-[0.14em] text-muted">{label}</span>}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-[14px] text-text outline-none focus:ring-2 focus:ring-primary/40"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
  hint,
  disabled,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format: (v: number) => string;
  hint?: string;
  disabled?: boolean;
}) {
  const p = ((value - min) / (max - min)) * 100;
  return (
    <div className={clsx("flex flex-col gap-1", disabled && "opacity-40")}>
      <div className="flex items-baseline justify-between">
        <span className="text-[13px] text-text">{label}</span>
        <span className="num text-[13px] font-medium text-primary">{format(value)}</span>
      </div>
      <div className="relative">
        <div className="absolute left-0 right-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-surface-2 ring-1 ring-line" />
        <div className="absolute left-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-primary" style={{ width: `${p}%` }} />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(Number(e.target.value))}
          className="relative"
          aria-label={label}
        />
      </div>
      {hint && <span className="text-[12px] text-faint">{hint}</span>}
    </div>
  );
}

export function Toggle({
  label,
  checked,
  onChange,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  hint?: string;
}) {
  return (
    <button onClick={() => onChange(!checked)} className="flex w-full items-start justify-between gap-3 text-left">
      <span>
        <span className="block text-[13px] text-text">{label}</span>
        {hint && <span className="block text-[12px] text-faint">{hint}</span>}
      </span>
      <span
        className={clsx(
          "relative mt-0.5 h-5 w-9 shrink-0 rounded-full ring-1 transition-colors",
          checked ? "bg-primary ring-primary" : "bg-surface-2 ring-line",
        )}
      >
        <motion.span
          animate={{ x: checked ? 16 : 2 }}
          transition={{ type: "spring", stiffness: 600, damping: 34 }}
          className="absolute top-0.5 h-4 w-4 rounded-full bg-bg"
        />
      </span>
    </button>
  );
}

export function Button({
  children,
  onClick,
  variant = "primary",
  disabled,
  className,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "ghost";
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={clsx(
        "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-[14px] font-medium transition disabled:cursor-not-allowed disabled:opacity-50",
        variant === "primary"
          ? "bg-primary text-on-primary hover:bg-primary-hover"
          : "border border-line bg-bg text-text hover:bg-surface-2",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Tabs<T extends string>({
  value,
  onChange,
  tabs,
  id,
}: {
  value: T;
  onChange: (v: T) => void;
  tabs: { value: T; label: ReactNode }[];
  id: string;
}) {
  return (
    <div className="flex gap-1 border-b border-line">
      {tabs.map((t) => (
        <button
          key={t.value}
          onClick={() => onChange(t.value)}
          className={clsx(
            "relative px-3 pb-2.5 pt-1 text-[13px] transition-colors",
            value === t.value ? "text-text" : "text-muted hover:text-text",
          )}
        >
          {t.label}
          {value === t.value && (
            <motion.span layoutId={`tab-${id}`} className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary" />
          )}
        </button>
      ))}
    </div>
  );
}
