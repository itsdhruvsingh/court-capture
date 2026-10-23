import type { Metadata } from "next";
import { JudgeView } from "./JudgeView";

export const metadata: Metadata = { title: "Judge" };

export default async function JudgePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <JudgeView id={id} />;
}
