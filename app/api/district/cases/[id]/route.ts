import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { handle } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** One case, everything but the raw HTML: parties, advocates, hearings, orders. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await ctx.params;
    const db = supabaseAdmin() as unknown as SupabaseClient;
    const byCnr = /^[A-Z]{4}\d{12}$/i.test(id);

    const { data: kase, error } = await db
      .from("court_cases")
      .select("*")
      .eq(byCnr ? "cnr" : "id", byCnr ? id.toUpperCase() : id)
      .maybeSingle();
    if (error) throw error;
    if (!kase) return NextResponse.json({ error: "That case is not in the database." }, { status: 404 });

    const [hearings, orders, advocates] = await Promise.all([
      db.from("court_case_hearings").select("seq, judge, business_date, next_date, purpose").eq("case_id", kase.id).order("seq"),
      db
        .from("court_case_orders")
        .select("id, kind, order_no, order_date, label, source_url, pdf_path, pdf_bytes, pdf_error, summary, summary_model, summary_source, summary_at, summary_by, summary_status, summary_error")
        .eq("case_id", kase.id)
        .order("order_date", { ascending: true, nullsFirst: true })
        .order("order_no", { ascending: true }),
      db.from("court_case_advocates").select("side, party_index, party_name, advocate_name, advocate_key").eq("case_id", kase.id),
    ]);
    for (const r of [hearings, orders, advocates]) if (r.error) throw r.error;

    return NextResponse.json({
      case: kase,
      hearings: hearings.data ?? [],
      orders: orders.data ?? [],
      advocates: advocates.data ?? [],
    });
  });
}
