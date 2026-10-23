import { NextResponse } from "next/server";
import { z } from "zod";
import { activeRun, nextAction } from "@/lib/highcourt/engine";
import { body, withCapture } from "@/lib/capture";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ runId: z.string().uuid().nullish() });

/** This person's next High Court search: a judge and a random window, or wait, or stop. */
export async function POST(req: Request) {
  return withCapture(req, async (cap) => {
    const parsed = Body.safeParse((await body(req)) ?? {});
    if (!parsed.success) return NextResponse.json({ error: "Bad request." }, { status: 400 });
    const runId = parsed.data.runId ?? (await activeRun())?.id;
    if (!runId) {
      return NextResponse.json({ action: "none", court: "highcourt", runId: null, message: "No High Court run is open. Start one from the extension or the Capture page." });
    }
    return NextResponse.json(await nextAction(runId, cap));
  });
}
