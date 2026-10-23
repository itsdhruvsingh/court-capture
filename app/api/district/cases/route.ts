import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { handle } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COLUMNS =
  "id, cnr, case_type, case_type_code, case_number, case_no, case_year, title, petitioners, respondents, status, stage, " +
  "next_hearing_date, decision_date, registration_date, court_judge, establishment, detail_status, masked, fetched_at, " +
  "orders:court_case_orders(count)";

/** PostgREST's `or=` grammar treats these as syntax; a search term must not. */
function term(s: string) {
  return s.replace(/[%*,()\\:"]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
}

export async function GET(req: Request) {
  return handle(async () => {
    const url = new URL(req.url);
    const q = term(url.searchParams.get("q") ?? "");
    const type = url.searchParams.get("type") ?? "";
    const status = url.searchParams.get("status") ?? "";
    const advocate = url.searchParams.get("advocate") ?? "";
    const sort = url.searchParams.get("sort") ?? "newest";
    const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
    const per = Math.min(100, Math.max(10, Number(url.searchParams.get("per")) || 25));

    const db = supabaseAdmin() as unknown as SupabaseClient;
    let query = db.from("court_cases").select(COLUMNS, { count: "exact" });

    if (advocate) {
      const { data: rows, error } = await db.from("court_case_advocates").select("case_id").eq("advocate_key", advocate).limit(5000);
      if (error) throw error;
      const ids = [...new Set((rows ?? []).map((r) => r.case_id as string))];
      if (!ids.length) return NextResponse.json({ cases: [], total: 0, page, per });
      query = query.in("id", ids);
    }
    if (q) query = query.or(`title.ilike.*${q}*,case_number.ilike.*${q}*,cnr.ilike.*${q}*,advocate_names.ilike.*${q}*`);
    // The printed type ("CC NI ACT"): the court's codes repeat across establishments.
    if (type) query = query.eq("case_type", type);
    if (status === "pending" || status === "disposed") query = query.eq("status", status);
    if (status === "listed") query = query.neq("detail_status", "fetched");

    if (sort === "next") {
      query = query.gte("next_hearing_date", new Date().toISOString().slice(0, 10)).order("next_hearing_date", { ascending: true });
    } else if (sort === "updated") {
      query = query.order("fetched_at", { ascending: false, nullsFirst: false });
    } else {
      query = query.order("case_year", { ascending: false, nullsFirst: false }).order("case_no", { ascending: false, nullsFirst: false });
    }

    const { data, count, error } = await query.range((page - 1) * per, page * per - 1);
    if (error) throw error;
    return NextResponse.json({ cases: data ?? [], total: count ?? 0, page, per });
  });
}
