"use client";

import { useEffect, useState } from "react";
import type { Index, Roster, Run } from "./types";

// Static JSON under /data (precomputed by the engine). Cached per session; failures are values, not throws.
const cache = new Map<string, Promise<unknown>>();

function getJson<T>(url: string): Promise<T | null> {
  if (!cache.has(url)) {
    cache.set(
      url,
      fetch(url)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    );
  }
  return cache.get(url) as Promise<T | null>;
}

export const runUrl = (roster: string, config: string) => `/data/run_${roster}_${config}.json`;

export function fetchIndex(): Promise<Index | null> {
  return getJson<Index>("/data/index.json");
}

export function fetchRun(roster: string, config: string): Promise<Run | null> {
  return getJson<Run>(runUrl(roster, config));
}

/** Configs available for a roster: from the index, plus any run file that answers. */
export async function availableConfigs(roster: string): Promise<string[]> {
  const idx = await fetchIndex();
  const configs = [...new Set([...(idx?.configs ?? ["baseline", "optimal"]), "morning_bench", "marathon_bench"])];
  const listed = new Set((idx?.scenarios ?? []).filter((s) => s.roster === roster).map((s) => s.config));
  const probes = await Promise.all(
    configs.map(async (c) => (listed.has(c) ? c : (await headOk(runUrl(roster, c))) ? c : null)),
  );
  return probes.filter((c): c is string => !!c);
}

const heads = new Map<string, Promise<boolean>>();
function headOk(url: string): Promise<boolean> {
  if (!heads.has(url)) {
    heads.set(
      url,
      fetch(url, { method: "HEAD" })
        .then((r) => r.ok)
        .catch(() => false),
    );
  }
  return heads.get(url)!;
}

/** Prefer the 3,000-case roster when both runs exist; fall back to the 100 sample. */
export async function preferredRoster(configs: string[] = ["optimal", "baseline"]): Promise<Roster> {
  const ok = await Promise.all(configs.map((c) => headOk(runUrl("3000", c))));
  return ok.every(Boolean) ? "3000" : "100";
}

export type Loadable<T> = { data: T | null; loading: boolean; error: boolean };

export function useRun(roster: string | null, config: string | null): Loadable<Run> {
  const [state, setState] = useState<Loadable<Run> & { key: string }>({ data: null, loading: true, error: false, key: "" });
  const key = `${roster}|${config}`;
  useEffect(() => {
    if (!roster || !config) return;
    let live = true;
    fetchRun(roster, config).then((r) => {
      if (live) setState({ data: r, loading: false, error: !r, key });
    });
    return () => {
      live = false;
    };
  }, [roster, config, key]);
  if (state.key !== key) return { data: null, loading: true, error: false };
  return state;
}

export function useRuns(roster: string, configs: string[]): { runs: Record<string, Run>; loading: boolean } {
  const [state, setState] = useState<{ runs: Record<string, Run>; key: string }>({ runs: {}, key: "" });
  const key = `${roster}|${configs.join(",")}`;
  useEffect(() => {
    let live = true;
    Promise.all(configs.map((c) => fetchRun(roster, c).then((r) => [c, r] as const))).then((pairs) => {
      if (!live) return;
      const runs: Record<string, Run> = {};
      for (const [c, r] of pairs) if (r) runs[c] = r;
      setState({ runs, key });
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return { runs: state.key === key ? state.runs : {}, loading: state.key !== key };
}

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): T | null {
  const [v, setV] = useState<T | null>(null);
  useEffect(() => {
    let live = true;
    fn().then((x) => live && setV(x));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return v;
}
