import type { Run } from "@/lib/types";

/** "Planned the evening before · dates published for the next N sitting days" */
export default function PlannedLine({ run }: { run: Run }) {
  const det = run.meta.config_detail ?? {};
  const on = det.use_horizon !== false;
  const n = Number(det.horizon_days ?? 10);
  return (
    <p className="mb-3 text-[12px] text-muted">
      Planned the evening before{on ? ` · dates published for the next ${n} sitting days` : " · no dates published ahead"}
    </p>
  );
}
