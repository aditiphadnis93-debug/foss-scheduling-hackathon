"use client";

import { useState } from "react";
import clsx from "clsx";
import PageHeader from "@/components/shell/PageHeader";
import MetricBars, { type BarRow } from "@/components/charts/MetricBars";
import { Card, Skeleton, Takeaway } from "@/components/ui/Card";
import { Chips, Segmented } from "@/components/ui/Controls";
import { DeltaPill } from "@/components/ui/Stat";
import { availableConfigs, preferredRoster, useAsync, useRuns } from "@/lib/data";
import { SCORED, deltaTone, direction, fmtDelta, fmtMetric, meta, orderedKeys } from "@/lib/metrics";
import { presetColour } from "@/lib/theme";
import { presetLabel } from "@/lib/format";
import type { Roster, Run } from "@/lib/types";
import WeekStrip, { Guardrails, WeekLegend } from "@/components/charts/WeekStrip";
import { weekOf } from "@/lib/dayprofile";
import { Technical } from "@/components/shell/Explain";

const TAKE: Record<string, string> = {
  utilisation_pct: "More of the court's 420 minutes go on hearings that actually happen, instead of call-overs and waiting.",
  predictability_gap_days: "A matter is heard sooner after it is first listed, so parties can plan the day they come to court.",
  substantive_pct_of_heard: "Of the hearings that take place, this share moves the case to its next step.",
  backlog_4y_heard_pct: "The ageing floor guarantees the oldest cases court time; this is how many of them were heard at all.",
  next_date_sane_pct: "Next dates follow what the next step needs (a summons return, an evidence date) rather than a flat gap.",
};

export default function Scorecard() {
  const initial = useAsync(() => preferredRoster(["optimal", "baseline"]), []);
  const [rosterPick, setRoster] = useState<Roster | null>(null);
  const roster = rosterPick ?? initial ?? "100";
  const configs = useAsync(() => availableConfigs(roster), [roster]) ?? [];
  const [pick, setPick] = useState<string[] | null>(null);
  const selected = (pick ?? configs).filter((c) => configs.includes(c));
  const withBase = selected.includes("baseline") || !configs.includes("baseline") ? selected : ["baseline", ...selected];
  const shown = [...withBase].sort((a, b) => order(a) - order(b) || a.localeCompare(b));
  const { runs, loading } = useRuns(roster, shown);
  const base = runs["baseline"];
  const ours = runs["optimal"] ? "optimal" : shown.find((c) => c !== "baseline");
  const keys = orderedKeys(Object.values(runs).flatMap((r) => Object.keys(r.metrics)));
  const hasMc = Object.values(runs).some((r) => r.montecarlo);

  return (
    <div>
      <PageHeader
        eyebrow="Scorecard"
        title="Every court setup against current practice"
        lede="Each judge's way of running the court is a setup. Every setup runs the same roster, with the same people and the same random draws, for the same sitting days. The five dimensions the court is scored on come first."
        right={
          <Segmented<Roster>
            id="sc-roster"
            value={roster}
            onChange={(r) => {
              setRoster(r);
              setPick(null);
            }}
            options={[
              { value: "100", label: "100 cases" },
              { value: "3000", label: "3,000 cases" },
            ]}
          />
        }
      />

      <div className="card mb-6 flex flex-wrap items-center gap-4 p-4">
        <span className="text-[11px] uppercase tracking-[0.14em] text-muted">Court setups</span>
        <Chips
          options={configs}
          value={shown}
          onChange={(v) => setPick(v)}
          colourOf={(c) => presetColour(c, configs)}
          labelOf={presetLabel}
          locked={["baseline"]}
        />
        {!hasMc && Object.keys(runs).length > 0 && (
          <span className="ml-auto text-[12px] text-faint">Each setup is simulated once; thin lines show the spread where repeated runs exist.</span>
        )}
      </div>

      {loading && !Object.keys(runs).length ? (
        <div className="grid gap-4 md:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-56" />
          ))}
        </div>
      ) : (
        <>
          {/* five scored dimensions */}
          <div className="grid gap-5 lg:grid-cols-2">
            {SCORED.filter((k) => keys.includes(k)).map((k, i) => (
              <Card
                key={k}
                delay={i * 0.05}
                title={
                  <span className="flex items-center gap-2">
                    {meta(k).dim}
                    <span className="text-[12px] font-normal text-muted">
                      {meta(k).label}
                      {direction(k) < 0 ? " · lower is better" : ""}
                    </span>
                  </span>
                }
                right={ours && base ? <DeltaPill k={k} a={runs[ours]?.metrics[k]} b={base.metrics[k]} /> : undefined}
                className={clsx(k === "backlog_4y_heard_pct" && "ring-1 ring-old/30")}
              >
                <MetricBars metric={k} rows={barRows(k, shown, runs, configs)} />
                <Takeaway>{TAKE[k] ?? meta(k).blurb}</Takeaway>
              </Card>
            ))}
          </div>

          <Technical>
            <Card className="mt-6" title="Measure definitions (technical)" subtitle="Field names in the engine export and how each is computed">
              <dl className="grid gap-x-6 gap-y-2 text-[13px] md:grid-cols-2">
                {[
                  ["utilisation_pct", "Minutes on hearings that happened (substantive, or adjourned with both sides present) / sitting minutes."],
                  ["predictability_gap_days", "Mean days from first listing for the current purpose to the day it is heard."],
                  ["substantive_pct_of_heard", "Substantive hearings / hearings where both sides were present."],
                  ["backlog_4y_heard_pct", "Cases 4+ years old at the start that were heard at least once / all such cases."],
                  ["next_date_sane_pct", "Next dates within 0.5x-2x (+3 days) of the procedural gap for the next purpose."],
                  ["reach_rate_pct", "Listings called (not 'not reached') / listings."],
                  ["eju_pct", "Share of sitting minutes spent on hearings that moved the case."],
                  ["justice_weighted_progress_per_hour", "Sum of age-weighted progress of substantive hearings per sitting hour."],
                ].map(([k, v]) => (
                  <div key={k}>
                    <dt className="mono text-[12px] text-text">{k}</dt>
                    <dd className="text-muted">{v}</dd>
                  </div>
                ))}
              </dl>
            </Card>
          </Technical>

          {/* judge day profiles */}
          <Card
            className="mt-6"
            title="How each setup's week is shaped"
            subtitle="When the court hears matters, when it breaks, and when the judge does administrative work"
          >
            <p className="mb-4 text-[14px] text-text">
              A morning bench trades afternoon hearings for chamber work; a marathon bench sits straight through. Both must
              stay above the weekly floor.
            </p>
            <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
              {[...new Set([...shown, "morning_bench", "marathon_bench"])].map((c) => (
                <div key={c}>
                  <WeekStrip week={weekOf(runs[c], c)} compact label={presetLabel(c)} />
                  {!runs[c] && <p className="mt-1 text-[11px] text-faint">Day shape only: this setup&apos;s results arrive with the next data update.</p>}
                </div>
              ))}
            </div>
            <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_1.2fr] lg:items-start">
              <WeekLegend />
              <Guardrails />
            </div>
            <Takeaway>
              Sitting hours set the court&apos;s capacity; compare the setups above to see what each shape of day costs in
              utilisation, reach and backlog.
            </Takeaway>
          </Card>

          {/* every metric */}
          <Card className="mt-6" title="Every measure" subtitle="Change against current practice in brackets. Green is better for the court, whichever direction that is.">
            <div className="scroll-thin overflow-x-auto">
              <table className="w-full min-w-[760px] whitespace-nowrap text-[13px]">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-[0.1em] text-muted">
                    <th className="border-b border-line py-2 pr-4 font-medium">Measure</th>
                    {shown.filter((c) => runs[c]).map((c) => (
                      <th key={c} className="border-b border-line px-3 py-2 text-right font-medium">
                        <span className="inline-flex items-center gap-1.5">
                          <span className="h-2 w-2 rounded-full" style={{ background: presetColour(c, configs) }} />
                          {presetLabel(c)}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {keys.map((k) => (
                    <tr key={k} className={clsx("border-b border-line", (SCORED as readonly string[]).includes(k) && "bg-primary-subtle")}>
                      <td className="py-2 pr-4">
                        <span className="text-text">{meta(k).label}</span>
                        {meta(k).dim && <span className="ml-2 text-[11px] text-primary">{meta(k).dim}</span>}
                      </td>
                      {shown.filter((c) => runs[c]).map((c) => {
                        const v = runs[c].metrics[k];
                        const b = base?.metrics[k];
                        const tone = c === "baseline" ? "neutral" : deltaTone(k, v, b);
                        return (
                          <td key={c} className="num px-3 py-2 text-right">
                            <span className="text-text">{fmtMetric(k, v)}</span>
                            {c !== "baseline" && base && (
                              <span className={clsx("ml-2 text-[11px]", tone === "good" ? "text-sub" : tone === "bad" ? "text-adj" : "text-faint")}>
                                ({fmtDelta(k, v, b) || "--"})
                              </span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Takeaway>
              New measures appear here automatically. Advocate trips and idle minutes are better when
              lower; everything else in green moves the court the right way.
            </Takeaway>
          </Card>
        </>
      )}
    </div>
  );
}

function order(c: string): number {
  return c === "optimal" ? 0 : c === "baseline" ? 1 : 2;
}

function barRows(k: string, shown: string[], runs: Record<string, Run>, all: string[]): BarRow[] {
  return shown
    .filter((c) => runs[c])
    .map((c) => {
      const mc = runs[c].montecarlo?.[k];
      return {
        key: c,
        label: presetLabel(c),
        colour: presetColour(c, all),
        value: runs[c].metrics[k] ?? mc?.mean,
        p10: mc?.p10,
        p90: mc?.p90,
      };
    });
}
