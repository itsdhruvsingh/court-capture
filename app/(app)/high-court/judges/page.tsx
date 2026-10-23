import type { Metadata } from "next";
import { JudgesBoard } from "./JudgesBoard";

export const metadata: Metadata = { title: "Judges" };

export default function JudgesPage() {
  return <JudgesBoard />;
}
