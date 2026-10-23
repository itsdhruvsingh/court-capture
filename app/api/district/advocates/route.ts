import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { advocateKey } from "@/lib/district/parse";
import { handle } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The advocate directory: every advocate on record and how many cases they carry. */
export async function GET(req: Request) {
  return handle(async () => {
    const url = new URL(req.url);
    const key = url.searchParams.get("key");
    const q = advocateKey(url.searchParams.get("q") ?? "");
    const sort = url.searchParams.get("sort") ?? "cases";
    const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
    const per = Math.min(200, Math.max(10, Number(url.searchParams.get("per")) || 50));

    const db = supabaseAdmin() as unknown as SupabaseClient;
    let query = db.from("court_advocates_v").select("*", { count: "exact" });
    if (key) query = query.eq("advocate_key", key);
    else if (q) query = query.ilike("advocate_key", `%${q.replace(/[%_]/g, " ")}%`);

    query =
      sort === "name"
        ? query.order("name", { ascending: true })
        : sort === "next"
          ? query.order("latest_next_hearing", { ascending: false, nullsFirst: false })
          : query.order("cases", { ascending: false }).order("name", { ascending: true });

    const { data, count, error } = await query.range((page - 1) * per, page * per - 1);
    if (error) throw error;
    return NextResponse.json({ advocates: data ?? [], total: count ?? 0, page, per });
  });
}
