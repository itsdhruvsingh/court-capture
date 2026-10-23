import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { handle } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Every judge on record with how many judgments are captured for them. */
export async function GET(req: Request) {
  return handle(async () => {
    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    const q = (url.searchParams.get("q") ?? "").replace(/[%_]/g, " ").trim();
    const sort = url.searchParams.get("sort") ?? "judgments";
    let query = supabaseAdmin().from("hc_judge_stats_v").select("*");
    if (id) query = query.eq("id", id);
    else if (q) query = query.ilike("name", `%${q}%`);
    query = sort === "name" ? query.order("name") : query.order("judgments", { ascending: false }).order("name");
    const { data, error } = await query.limit(500);
    if (error) throw error;
    return NextResponse.json({ judges: data ?? [] });
  });
}
