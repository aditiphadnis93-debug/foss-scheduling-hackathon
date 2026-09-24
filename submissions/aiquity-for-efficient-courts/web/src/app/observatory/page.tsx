import type { Metadata } from "next";
import Observatory from "@/components/world/Observatory";

export const metadata: Metadata = {
  title: "Observatory · AIQuity for Efficient Courts",
  description: "Three synchronised views on one clock: the town, the day's causelist and every agent's decision.",
};

export default function ObservatoryPage() {
  return <Observatory />;
}
