// Colour semantics (web/COLORS.md). Values are CSS variables from app/theme.css, so both themes follow.
export const C = {
  ours: "var(--c-ours)",
  baseline: "var(--c-baseline)",
  substantive: "var(--c-substantive)",
  adjourned: "var(--c-adjourned)",
  not_reached: "var(--c-not-reached)",
  not_ready: "var(--c-not-ready)",
  old: "var(--c-old)",
  danger: "var(--c-danger)",
  primary: "var(--primary)",
} as const;

/** A token at a given opacity (0-100), for soft fills and borders. */
export function alpha(colour: string, pct: number): string {
  return `color-mix(in srgb, ${colour} ${pct}%, transparent)`;
}

export const OUTCOME_COLOUR: Record<string, string> = {
  substantive: C.substantive,
  adjourned: C.adjourned,
  not_reached: C.not_reached,
  not_ready: C.not_ready,
};

export const OUTCOME_LABEL: Record<string, string> = {
  substantive: "Moved forward",
  adjourned: "Adjourned",
  not_reached: "Not reached",
  not_ready: "Not ready",
};

// Other presets: tints of the primary ramp, so "ours" stays the strongest blue and baseline stays grey.
const PRESET_TONES = ["var(--age-2)", "var(--age-4)", "var(--age-1)", "var(--primary-strong)", "var(--age-0)"];

export function presetColour(name: string, all: string[] = []): string {
  if (name === "baseline") return C.baseline;
  if (name === "optimal") return C.ours;
  const others = all.filter((n) => n !== "baseline" && n !== "optimal");
  const i = Math.max(0, others.indexOf(name));
  return PRESET_TONES[i % PRESET_TONES.length];
}

// Age buckets, youngest to oldest: a blue ramp with the oldest in the old-case coral.
export const AGE_KEYS = ["<1y", "1-2y", "2-3y", "3-4y", "4-5y", "5y+"] as const;
export const AGE_LABEL: Record<string, string> = {
  "<1y": "< 1 yr",
  "1-2y": "1-2 yrs",
  "2-3y": "2-3 yrs",
  "3-4y": "3-4 yrs",
  "4-5y": "4-5 yrs",
  "5y+": "5+ yrs",
};
export const AGE_COLOUR: Record<string, string> = {
  "<1y": "var(--age-0)",
  "1-2y": "var(--age-1)",
  "2-3y": "var(--age-2)",
  "3-4y": "var(--age-3)",
  "4-5y": "var(--age-4)",
  "5y+": "var(--age-5)",
};
