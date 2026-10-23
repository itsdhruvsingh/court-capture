import type { Metadata } from "next";
import { AdvocatesBoard } from "./AdvocatesBoard";

export const metadata: Metadata = { title: "Advocates" };

export default async function AdvocatesPage() {
  return <AdvocatesBoard />;
}
