"use client";

import { useId, useState } from "react";
import clsx from "clsx";

/** Case-number box with a short filtered suggestion list (after 2 characters, up to 8, keyboard friendly). */
export default function CaseSuggest({
  value,
  onChange,
  onPick,
  options,
  placeholder = "ST/123/2020",
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  onPick?: (v: string) => void;
  options: string[];
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const [hi, setHi] = useState(0);
  const q = value.trim().toLowerCase();
  const matches = q.length >= 2 ? options.filter((o) => o.toLowerCase().includes(q)).slice(0, 8) : [];
  const pick = (v: string) => {
    onChange(v);
    setOpen(false);
    onPick?.(v);
  };
  return (
    <div className="relative">
      <input
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setHi(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setHi((h) => Math.min(h + 1, matches.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHi((h) => Math.max(h - 1, 0));
          } else if (e.key === "Enter") {
            if (open && matches[hi]) {
              e.preventDefault();
              pick(matches[hi]);
            } else onPick?.(value);
          } else if (e.key === "Escape") setOpen(false);
        }}
        placeholder={placeholder}
        role="combobox"
        aria-controls={listId}
        aria-expanded={open && matches.length > 0}
        aria-autocomplete="list"
        className={clsx("mono w-full rounded-lg border border-line bg-bg px-3 py-2 text-[13px] outline-none focus:ring-2 focus:ring-primary/40", className)}
      />
      {open && matches.length > 0 && (
        <ul id={listId} role="listbox" className="float absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded-lg border border-line bg-bg py-1">
          {matches.map((m, i) => (
            <li key={m} role="option" aria-selected={i === hi}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(m);
                }}
                onMouseEnter={() => setHi(i)}
                className={clsx("mono block w-full px-3 py-1.5 text-left text-[12px]", i === hi ? "bg-primary-subtle text-primary" : "text-text")}
              >
                {m}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
