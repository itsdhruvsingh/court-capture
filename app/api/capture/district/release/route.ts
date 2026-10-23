import { NextResponse } from "next/server";
import { z } from "zod";
import { release } from "@/lib/district/engine";
import { body, withCapture } from "@/lib/capture";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ runId: z.string().uuid() });

/** Pause pressed on the panel: this person's case types go back to the pool at once. */
export async function POST(req: Request) {
  return withCapture(req, async (cap) => {
    const parsed = Body.safeParse(await body(req));
    if (!parsed.success) return NextResponse.json({ error: "Bad request." }, { status: 400 });
    await release(parsed.data.runId, cap);
    return NextResponse.json({ ok: true });
  });
}
