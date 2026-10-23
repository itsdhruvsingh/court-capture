import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { handle } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Headline numbers and the case-type facet for the filters. */
export async function GET() {
  return handle(async () => {
    const db = supabaseAdmin();
    const [stats, types] = await Promise.all([
      db.from("hc_stats_v").select("*").single(),
      db.from("hc_judgments").select("case_type_code, case_type").limit(20_000),
    ]);
    if (stats.error) throw stats.error;
    if (types.error) throw types.error;
    const facet = new Map<string, { code: string; name: string; count: number }>();
    for (const r of (types.data ?? []) as { case_type_code: string | null; case_type: string | null }[]) {
      if (!r.case_type_code) continue;
      const f = facet.get(r.case_type_code) ?? { code: r.case_type_code, name: r.case_type ?? r.case_type_code, count: 0 };
      f.count++;
      facet.set(r.case_type_code, f);
    }
    return NextResponse.json({ stats: stats.data, types: [...facet.values()].sort((a, b) => b.count - a.count) });
  });
}
