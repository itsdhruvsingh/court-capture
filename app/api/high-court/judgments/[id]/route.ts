import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { handle } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** One judgment: everything but the raw row HTML, with its bench. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await ctx.params;
    const db = supabaseAdmin();
    const { data, error } = await db
      .from("hc_judgments")
      .select(
        "id, case_no, case_type, case_type_code, case_number, case_year, neutral_citation, order_date, petitioner, respondent, corrigendum, uploaded_on, remark, pdf_url, txt_url, pdf_path, pdf_bytes, pdf_error, body_text, text_error, summary, summary_model, summary_source, summary_at, summary_by, summary_status, summary_error, created_at, judges:hc_judgment_judges(hc_judges(id, code, name))"
      )
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "That judgment is not in the database." }, { status: 404 });
    return NextResponse.json({ judgment: data });
  });
}
