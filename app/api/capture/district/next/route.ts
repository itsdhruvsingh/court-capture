import { NextResponse } from "next/server";
import { z } from "zod";
import { activeRun, nextAction } from "@/lib/district/engine";
import { body, withCapture } from "@/lib/capture";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ runId: z.string().uuid().nullish() });

/** This person's next step on the court's page: open a case, search a type, wait, or stop. */
export async function POST(req: Request) {
  return withCapture(req, async (cap) => {
    const parsed = Body.safeParse((await body(req)) ?? {});
    if (!parsed.success) return NextResponse.json({ error: "Bad request." }, { status: 400 });
    const runId = parsed.data.runId ?? (await activeRun())?.id;
    if (!runId) {
      return NextResponse.json({ action: "none", runId: null, message: "No run is open. Start one in Court Cases → Scraper." });
    }
    return NextResponse.json(await nextAction(runId, cap));
  });
}
