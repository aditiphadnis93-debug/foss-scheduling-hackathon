import type { Metadata } from "next";
import PeopleBoard from "@/components/people/PeopleBoard";

export const metadata: Metadata = {
  title: "People · AIQuity for Efficient Courts",
  description: "Advocates and litigants as agents: who turned up, who did not, and why.",
};

export default function PeoplePage() {
  return <PeopleBoard />;
}
