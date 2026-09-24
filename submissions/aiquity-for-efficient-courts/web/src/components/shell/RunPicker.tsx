"use client";

import { useState, type ReactNode } from "react";
import { Segmented, Select } from "@/components/ui/Controls";
import { availableConfigs, preferredRoster, useAsync, useRun } from "@/lib/data";
import { presetLabel } from "@/lib/format";
import type { Roster, Run } from "@/lib/types";

/** Roster toggle + preset select shared by the analysis pages. */
export function useRunPicker(id: string, opts: { allowBaseline?: boolean } = {}): {
  roster: Roster;
  config: string | null;
  run: Run | null;
  loading: boolean;
  controls: ReactNode;
} {
  const initial = useAsync(() => preferredRoster(["optimal"]), []);
  const [rosterPick, setRoster] = useState<Roster | null>(null);
  const roster = rosterPick ?? initial ?? "100";
  const all = useAsync(() => availableConfigs(roster), [roster]) ?? [];
  const configs = opts.allowBaseline === false ? all.filter((c) => c !== "baseline") : all;
  const [pick, setPick] = useState<string | null>(null);
  const config =
    pick && configs.includes(pick)
      ? pick
      : configs.includes("optimal")
        ? "optimal"
        : configs.find((c) => c !== "baseline") ?? configs[0] ?? null;
  const { data: run, loading } = useRun(roster, config);
  const controls = (
    <>
      <Segmented<Roster>
        id={`${id}-roster`}
        value={roster}
        onChange={setRoster}
        options={[
          { value: "100", label: "100 cases" },
          { value: "3000", label: "3,000 cases" },
        ]}
      />
      <div className="min-w-[200px]">
        <Select value={config ?? ""} onChange={setPick} options={configs.map((c) => ({ value: c, label: presetLabel(c) }))} />
      </div>
    </>
  );
  return { roster, config, run, loading, controls };
}

export function DerivedNote({ show, what }: { show: boolean; what: string }) {
  if (!show) return null;
  return (
    <p className="mb-5 rounded-lg border border-line bg-surface-2 px-3 py-2 text-[12px] text-muted">
      {what} is derived in the browser from this run&apos;s day records (listings, outcomes, held-back reasons). When the
      engine export adds its own block, this page uses it instead.
    </p>
  );
}
