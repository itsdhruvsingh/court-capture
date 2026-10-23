import type { Metadata } from "next";
import { JudgmentsBoard } from "./JudgmentsBoard";

export const metadata: Metadata = { title: "High Court judgments" };

export default async function HighCourtPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  return (
    <JudgmentsBoard
      initial={{ q: sp.q ?? "", type: sp.type ?? "", year: sp.year ?? "", sort: sp.sort ?? "newest", page: Math.max(1, Number(sp.page) || 1) }}
    />
  );
}
