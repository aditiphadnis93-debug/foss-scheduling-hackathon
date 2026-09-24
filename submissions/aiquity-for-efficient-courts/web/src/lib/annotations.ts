"use client";

import { postAnnotation } from "./api";

// Mirrors the engine's domain.Annotation record.
export type Annotation = {
  case_id: string;
  day: string;
  field: "p_goes_ahead" | "expected_minutes" | "next_date" | "listed";
  predicted: string | number | null;
  judge_value: string | number | null;
  note: string;
  annotator: string;
  config?: string;
  roster?: string;
  saved_at?: string;
};

const KEY = "ocl.annotations.v1";

export function loadAnnotations(): Annotation[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "[]") as Annotation[];
  } catch {
    return [];
  }
}

/** Saves locally, then posts to the engine if it is running. Never throws. */
export async function saveAnnotations(items: Annotation[]): Promise<{ local: boolean; remote: boolean }> {
  let local = false;
  try {
    const all = [...loadAnnotations(), ...items];
    localStorage.setItem(KEY, JSON.stringify(all));
    local = true;
  } catch {
    local = false;
  }
  const results = await Promise.all(items.map((a) => postAnnotation(a)));
  return { local, remote: results.length > 0 && results.every(Boolean) };
}
