import { NextResponse } from "next/server";
import { z } from "zod";
import { createRun, judgeList, listRuns } from "@/lib/highcourt/engine";
import { handle } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handle(async () => {
    if (new URL(req.url).searchParams.get("judges") === "1") return NextResponse.json({ judges: await judgeList() });
    return NextResponse.json({ runs: await listRuns() });
  });
}

const Body = z.object({
  perJudge: z.number().int().min(1).max(100).optional(),
  maxTries: z.number().int().min(1).max(30).optional(),
  windowDays: z.number().int().min(1).max(366).optional(),
  earliest: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  judgeCodes: z.array(z.string().max(12)).max(300).optional(),
  label: z.string().max(120).nullish(),
});

export async function POST(req: Request) {
  return handle(async (staff) => {
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: "That run setup is not valid." }, { status: 400 });
    return NextResponse.json({ id: await createRun({ ...parsed.data, staff }) }, { status: 201 });
  });
}
