import type { Metadata } from "next";
import { JudgmentView } from "./JudgmentView";

export const metadata: Metadata = { title: "Judgment" };

export default async function JudgmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <JudgmentView id={id} />;
}
