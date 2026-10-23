import { gunzipSync } from "node:zlib";
import { after, NextResponse } from "next/server";
import { z } from "zod";
import { nextAction, recordResults } from "@/lib/highcourt/engine";
import { prefetchJudgments } from "@/lib/highcourt/docs";
import { body, withCapture } from "@/lib/capture";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The search is saved inside the request; texts and PDFs are fetched after it.
export const maxDuration = 300;

const Effort = z.object({ prompts: z.number().optional(), wrong: z.number().optional(), solveMs: z.number().optional() }).optional();
const Iso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const Body = z.object({
  runId: z.string().uuid(),
  taskId: z.string().uuid(),
  from: Iso,
  to: Iso,
  report: z.discriminatedUnion("kind", [
    // A judge's whole list arrives gzipped and base64-encoded (`gz`): ten years of rows compress to well under a megabyte.
    z.object({ kind: z.literal("results"), html: z.string().min(1).max(8_000_000).optional(), gz: z.string().min(1).max(4_000_000).optional(), info: z.string().max(300).nullish() }),
    z.object({ kind: z.literal("empty"), message: z.string().max(500).optional() }),
    z.object({ kind: z.literal("missing") }),
    z.object({ kind: z.literal("error"), message: z.string().max(500) }),
  ]),
  effort: Effort,
});

/** The table's HTML, unpacked; null when it is missing or not a gzip of at most 64 MB. */
function tableHtml(r: { html?: string; gz?: string }): string | null {
  if (r.html) return r.html;
  if (!r.gz) return null;
  try {
    return gunzipSync(Buffer.from(r.gz, "base64"), { maxOutputLength: 64 * 1024 * 1024 }).toString("utf8");
  } catch {
    return null;
  }
}

/** The results table as the court's page showed it; answers with the next step. */
export async function POST(req: Request) {
  return withCapture(req, async (cap) => {
    const parsed = Body.safeParse(await body(req));
    if (!parsed.success) return NextResponse.json({ error: "Bad request." }, { status: 400 });
    const { report: raw, ...rest } = parsed.data;
    let report;
    if (raw.kind === "results") {
      const html = tableHtml(raw);
      if (!html) return NextResponse.json({ error: "Could not read the results table that was sent." }, { status: 400 });
      report = { kind: "results" as const, html, info: raw.info };
    } else report = raw;

    const since = new Date(Date.now() - 5000).toISOString();
    const result = await recordResults({ ...rest, report, cap });
    if (result.added > 0) {
      // Complete the record: each new judgment's text and PDF, without holding up the next search.
      after(() => prefetchJudgments(rest.runId, since).catch((e) => console.error("[highcourt] prefetch:", e)));
    }
    return NextResponse.json({ ...result, next: await nextAction(rest.runId, cap) });
  });
}
