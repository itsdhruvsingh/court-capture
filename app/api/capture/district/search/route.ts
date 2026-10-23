import { NextResponse } from "next/server";
import { z } from "zod";
import { nextAction, recordSearch } from "@/lib/district/engine";
import { body, withCapture } from "@/lib/capture";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Effort = z.object({ prompts: z.number().optional(), wrong: z.number().optional(), solveMs: z.number().optional() }).optional();

const Body = z.object({
  runId: z.string().uuid(),
  taskId: z.string().uuid(),
  year: z.number().int(),
  report: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("results"), html: z.string().min(1).max(2_000_000) }),
    z.object({ kind: z.literal("empty"), message: z.string().max(500).optional() }),
    z.object({ kind: z.literal("missing") }),
    z.object({ kind: z.literal("error"), message: z.string().max(500) }),
  ]),
  effort: Effort,
});

/** What the court's page showed after a search; answers with the next step. */
export async function POST(req: Request) {
  return withCapture(req, async (cap) => {
    const parsed = Body.safeParse(await body(req));
    if (!parsed.success) return NextResponse.json({ error: "Bad request." }, { status: 400 });
    const result = await recordSearch({ ...parsed.data, cap });
    return NextResponse.json({ ...result, next: await nextAction(parsed.data.runId, cap) });
  });
}
