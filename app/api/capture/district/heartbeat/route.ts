import { NextResponse } from "next/server";
import { z } from "zod";
import { heartbeat } from "@/lib/district/engine";
import { body, withCapture } from "@/lib/capture";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ runId: z.string().uuid() });

/** "Still here": sent while the extension waits for its person to type, so their case types stay theirs. */
export async function POST(req: Request) {
  return withCapture(req, async (cap) => {
    const parsed = Body.safeParse(await body(req));
    if (!parsed.success) return NextResponse.json({ error: "Bad request." }, { status: 400 });
    await heartbeat(parsed.data.runId, cap);
    return NextResponse.json({ ok: true });
  });
}
