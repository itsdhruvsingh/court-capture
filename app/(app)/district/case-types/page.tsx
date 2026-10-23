import type { Metadata } from "next";
import { CaseTypesBoard } from "./CaseTypesBoard";

export const metadata: Metadata = { title: "District case types" };

export default function DistrictCaseTypesPage() {
  return <CaseTypesBoard />;
}
