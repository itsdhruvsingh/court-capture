import { NextResponse } from "next/server";
import { z } from "zod";
import { createRun, listRuns } from "@/lib/district/engine";
import { handle } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return handle(async () => NextResponse.json({ runs: await listRuns() }));
}

const Body = z.object({
  caseStatus: z.enum(["P", "D"]).default("P"),
  perType: z.number().int().min(1).max(25).optional(),
  maxYears: z.number().int().min(1).max(30).optional(),
  startYear: z.number().int().min(1950).max(2100).optional(),
  caseTypes: z.array(z.string().max(10)).max(200).optional(),
  label: z.string().max(120).nullish(),
});

export async function POST(req: Request) {
  return handle(async (staff) => {
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: "That run setup is not valid." }, { status: 400 });
    const id = await createRun({ ...parsed.data, staff });
    return NextResponse.json({ id }, { status: 201 });
  });
}
