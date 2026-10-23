import type { Metadata } from "next";
import { CaptureDesk } from "./CaptureDesk";

export const metadata: Metadata = { title: "Capture" };

export default async function CapturePage({ searchParams }: { searchParams: Promise<{ court?: string; run?: string }> }) {
  const { court, run } = await searchParams;
  return <CaptureDesk court={court === "highcourt" ? "highcourt" : "district"} run={run && /^[0-9a-f-]{36}$/i.test(run) ? run : null} />;
}
