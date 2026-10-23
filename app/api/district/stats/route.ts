import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { handle } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Headline numbers and the case-type facet for the filters. The facet is the
 * type printed on each case, not the court's code: a code means different
 * types at different establishments (76 is ARB. A.(COMM.) at the District
 * Judge but CC NI ACT at the CMM).
 */
export async function GET() {
  return handle(async () => {
    const db = supabaseAdmin() as unknown as SupabaseClient;
    const [stats, types] = await Promise.all([
      db.from("court_case_stats_v").select("*").single(),
      db.from("court_cases").select("case_type").limit(50_000),
    ]);
    if (stats.error) throw stats.error;
    if (types.error) throw types.error;

    const facet = new Map<string, { code: string; name: string; count: number }>();
    for (const r of (types.data ?? []) as { case_type: string | null }[]) {
      if (!r.case_type) continue;
      const f = facet.get(r.case_type) ?? { code: r.case_type, name: r.case_type, count: 0 };
      f.count++;
      facet.set(r.case_type, f);
    }
    return NextResponse.json({
      stats: stats.data,
      types: [...facet.values()].sort((a, b) => a.name.localeCompare(b.name)),
    });
  });
}
