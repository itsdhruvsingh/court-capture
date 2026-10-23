import type { Metadata } from "next";
import { AdvocateView } from "./AdvocateView";

export const metadata: Metadata = { title: "Advocate" };

export default async function AdvocatePage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  return <AdvocateView advocateKey={decodeURIComponent(key)} />;
}
