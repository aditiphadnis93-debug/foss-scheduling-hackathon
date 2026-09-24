import type { Metadata } from "next";
import CaseFile from "@/components/world/CaseFile";

export const metadata: Metadata = {
  title: "Case file · AIQuity for Efficient Courts",
  description: "One case's full journey: from the quarrel in the town to every hearing, delay and next date.",
};

export default async function CasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let caseId = id;
  try { caseId = decodeURIComponent(id); } catch { /* keep the raw id */ }
  return <CaseFile caseId={caseId} />;
}
