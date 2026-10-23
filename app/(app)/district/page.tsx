import type { Metadata } from "next";
import { CasesBoard } from "./CasesBoard";

export const metadata: Metadata = { title: "District cases" };

export default async function CourtCasesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  return (
    <CasesBoard
      initial={{
        q: sp.q ?? "",
        type: sp.type ?? "",
        status: sp.status ?? "",
        sort: sp.sort ?? "newest",
        page: Math.max(1, Number(sp.page) || 1),
      }}
    />
  );
}
