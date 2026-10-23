import { NextResponse } from "next/server";
import { z } from "zod";
import { syncJudges } from "@/lib/highcourt/engine";
import { body, withCapture } from "@/lib/capture";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ judges: z.array(z.object({ code: z.string().max(12), name: z.string().max(200) })).max(300) });

/** The judge list as the court's page shows it today, so new judges join the next run. */
export async function POST(req: Request) {
  return withCapture(req, async () => {
    const parsed = Body.safeParse(await body(req));
    if (!parsed.success) return NextResponse.json({ error: "Bad request." }, { status: 400 });
    return NextResponse.json(await syncJudges(parsed.data.judges));
  });
}
