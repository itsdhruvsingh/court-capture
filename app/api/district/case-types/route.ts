import { NextResponse } from "next/server";
import { caseTypes } from "@/lib/district/engine";
import { handle } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The case types Saket lists, as captured from the court's form. */
export async function GET() {
  return handle(async () => NextResponse.json({ types: caseTypes() }));
}
