import { NextResponse } from "next/server";
import { z } from "zod";
import { notePdfFailure, storeOrderPdf } from "@/lib/district/orders";
import { body, withCapture } from "@/lib/capture";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  orderId: z.string().uuid(),
  // base64 of the PDF as the court served it to the person's browser (under 3 MB)
  pdf: z.string().min(8).max(4_000_000).optional(),
  // or why the court's answer was not a PDF
  error: z.string().max(300).optional(),
});

/** An order PDF the extension downloaded from the court's own link, or why it could not. */
export async function POST(req: Request) {
  return withCapture(req, async () => {
    const parsed = Body.safeParse(await body(req));
    if (!parsed.success || (!parsed.data.pdf && !parsed.data.error)) return NextResponse.json({ error: "Bad request." }, { status: 400 });
    if (parsed.data.pdf) return NextResponse.json(await storeOrderPdf(parsed.data.orderId, Buffer.from(parsed.data.pdf, "base64")));
    await notePdfFailure(parsed.data.orderId, parsed.data.error!);
    return NextResponse.json({ stored: false });
  });
}
