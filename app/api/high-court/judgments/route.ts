import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { handle } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COLUMNS =
  "id, case_no, case_type, case_type_code, case_number, case_year, neutral_citation, order_date, petitioner, respondent, corrigendum, remark, pdf_path, body_text_present:text_fetched_at, summary_at, judges:hc_judgment_judges(hc_judges(id, name))";

/** PostgREST's `or=` grammar treats these as syntax; a search term must not. */
function term(s: string) {
  return s.replace(/[%*,()\\:"]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
}

export async function GET(req: Request) {
  return handle(async () => {
    const url = new URL(req.url);
    const q = term(url.searchParams.get("q") ?? "");
    const judge = url.searchParams.get("judge") ?? "";
    const type = url.searchParams.get("type") ?? "";
    const year = Number(url.searchParams.get("year")) || null;
    const sort = url.searchParams.get("sort") ?? "newest";
    const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
    const per = Math.min(100, Math.max(10, Number(url.searchParams.get("per")) || 25));
    const db = supabaseAdmin();

    let query = db.from("hc_judgments").select(COLUMNS, { count: "exact" });
    if (judge) {
      const { data: rows, error } = await db.from("hc_judgment_judges").select("judgment_id").eq("judge_id", judge).limit(10_000);
      if (error) throw error;
      const ids = (rows ?? []).map((r) => r.judgment_id as string);
      if (!ids.length) return NextResponse.json({ judgments: [], total: 0, page, per });
      query = query.in("id", ids);
    }
    if (q) query = query.or(`case_no.ilike.*${q}*,petitioner.ilike.*${q}*,respondent.ilike.*${q}*,neutral_citation.ilike.*${q}*,body_text.ilike.*${q}*`);
    if (type) query = query.eq("case_type_code", type);
    if (year) query = query.gte("order_date", `${year}-01-01`).lte("order_date", `${year}-12-31`);
    query =
      sort === "oldest"
        ? query.order("order_date", { ascending: true, nullsFirst: false })
        : sort === "added"
          ? query.order("created_at", { ascending: false })
          : query.order("order_date", { ascending: false, nullsFirst: false });

    const { data, count, error } = await query.range((page - 1) * per, page * per - 1);
    if (error) throw error;
    return NextResponse.json({ judgments: data ?? [], total: count ?? 0, page, per });
  });
}
