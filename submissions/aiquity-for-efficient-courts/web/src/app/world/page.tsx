import type { Metadata } from "next";
import WorldExperience from "@/components/world/WorldExperience";

export const metadata: Metadata = {
  title: "The town · AIQuity for Efficient Courts",
  description: "A synthetic town where quarrels become cases: watch people walk to court, hearings go ahead or not, and disputes resolve.",
};

export default async function WorldPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const scenario = typeof sp.scenario === "string" && /^[\w-]+$/.test(sp.scenario) ? sp.scenario : undefined;
  return <WorldExperience scenario={scenario} />;
}
