import { NextResponse } from "next/server";
import { z } from "zod";
import { nextAction, recordDetails } from "@/lib/district/engine";
import { pdfsToFetch } from "@/lib/district/orders";
import { body, withCapture } from "@/lib/capture";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const Effort = z.object({ prompts: z.number().optional(), wrong: z.number().optional(), solveMs: z.number().optional() }).optional();

const Body = z.object({
  runId: z.string().uuid(),
  caseId: z.string().uuid(),
  report: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("page"), html: z.string().min(1).max(4_000_000) }),
    z.object({ kind: z.literal("error"), message: z.string().max(500) }),
    z.object({ kind: z.literal("skipped") }),
  ]),
  effort: Effort,
});

/**
 * A case page as the court's page showed it. Answers with the next step and
 * the order PDFs for the extension to download while it is on the court's page.
 */
export async function POST(req: Request) {
  return withCapture(req, async (cap) => {
    const parsed = Body.safeParse(await body(req));
    if (!parsed.success) return NextResponse.json({ error: "Bad request." }, { status: 400 });
    const result = await recordDetails({ ...parsed.data, cap });
    const pdfs = parsed.data.report.kind === "page" && !result.ignored ? await pdfsToFetch(parsed.data.caseId) : [];
    return NextResponse.json({ ...result, pdfs, next: await nextAction(parsed.data.runId, cap) });
  });
}
