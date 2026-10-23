import { judgmentFileName, judgmentPdf, loadJudgment } from "@/lib/highcourt/docs";
import { handle } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** The judgment's PDF, from our copy (fetched from the court the first time). `?download=1` saves it. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await ctx.params;
    const download = new URL(req.url).searchParams.get("download") === "1";
    const j = await loadJudgment(id);
    const { bytes } = await judgmentPdf(j);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "content-type": "application/pdf",
        "content-length": String(bytes.length),
        "content-disposition": `${download ? "attachment" : "inline"}; filename="${judgmentFileName(j)}"`,
        "cache-control": "private, max-age=3600",
      },
    });
  });
}
