import type { Metadata } from "next";
import { TypesAndJudgesBoard } from "./TypesAndJudgesBoard";

export const metadata: Metadata = { title: "High Court case types & judges" };

export default function HighCourtCaseTypesPage() {
  return <TypesAndJudgesBoard />;
}
