import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { summarizeJudgment } from "@/lib/highcourt/docs";
import { handle } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const VIEW = "id, summary, summary_model, summary_source, summary_at, summary_by, summary_status, summary_error";

async function view(id: string) {
  const { data } = await supabaseAdmin().from("hc_judgments").select(VIEW).eq("id", id).single();
  return data;
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await ctx.params;
    return NextResponse.json(await view(id));
  });
}

/** Write the summary if there is none yet; otherwise return the stored one. */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async (staff) => {
    const { id } = await ctx.params;
    const { cached } = await summarizeJudgment(id, staff);
    return NextResponse.json({ ...(await view(id)), cached });
  });
}
