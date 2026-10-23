import { NextResponse } from "next/server";
import { loadOrder, summarizeOrder } from "@/lib/district/orders";
import { handle } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Fetch the PDF from the court (first time only), read it, and write.
export const maxDuration = 120;

function view(o: Awaited<ReturnType<typeof loadOrder>>) {
  return {
    id: o.id,
    summary: o.summary,
    summary_model: o.summary_model,
    summary_source: o.summary_source,
    summary_at: o.summary_at,
    summary_by: o.summary_by,
    summary_status: o.summary_status,
    summary_error: o.summary_error,
    pdf_path: o.pdf_path,
  };
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await ctx.params;
    return NextResponse.json(view(await loadOrder(id)));
  });
}

/** Write the summary if there is none yet; otherwise return the stored one. */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async (staff) => {
    const { id } = await ctx.params;
    const { order, cached } = await summarizeOrder(id, staff);
    return NextResponse.json({ ...view(order), cached });
  });
}
