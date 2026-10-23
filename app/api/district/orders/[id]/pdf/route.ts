import { loadOrder, orderFileName, orderPdf } from "@/lib/district/orders";
import { handle } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The order's PDF. The first request fetches it from the court and keeps it in
 * the private court-orders space; every later one is served from there.
 * Streamed through the app (orders are ~150 KB) so `inline` opens it in the
 * browser's viewer and `?download=1` saves it.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await ctx.params;
    const download = new URL(req.url).searchParams.get("download") === "1";
    const order = await loadOrder(id);
    const { bytes } = await orderPdf(order);
    const name = orderFileName(order);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "content-type": "application/pdf",
        "content-length": String(bytes.length),
        "content-disposition": `${download ? "attachment" : "inline"}; filename="${name}"`,
        "cache-control": "private, max-age=3600",
      },
    });
  });
}
