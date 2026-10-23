import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { handle } from "@/lib/http";
import { CASE_TYPES } from "@/lib/highcourt/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NAMES = new Map(CASE_TYPES.map((t) => [t.code, t.name]));
const typeName = (code: string) => (code === "?" ? "Unknown type" : (NAMES.get(code) ?? code));

type ListRow = { judge_code: string; judge_name: string; from_date: string; to_date: string; listed_total: number | null; read_total: number };
type Count = { judge_code: string; judgments: number };

/**
 * What the High Court decides, by case type, and what each sitting judge's
 * work is made of — from every judge's complete list (their widest search),
 * next to the judgments saved in full.
 */
export async function GET() {
  return handle(async () => {
    const db = supabaseAdmin() as unknown as SupabaseClient;
    const [lists, byType, byYear, overall, judges, saved, savedByJudge] = await Promise.all([
      db.from("hc_judge_lists_v").select("judge_code, judge_name, from_date, to_date, listed_total, read_total"),
      db.from("hc_judge_type_counts_v").select("judge_code, type_code, judgments").limit(100_000),
      db.from("hc_judge_year_counts_v").select("judge_code, year, judgments").limit(100_000),
      db.from("hc_type_counts_v").select("type_code, judgments").limit(10_000),
      db.from("hc_judges").select("id, code, name, sitting"),
      db.from("hc_judgments").select("case_type_code").limit(100_000),
      db.from("hc_judge_stats_v").select("code, judgments"),
    ]);
    for (const q of [lists, byType, byYear, overall, judges, saved, savedByJudge]) if (q.error) throw q.error;

    const ids = new Map(((judges.data ?? []) as { id: string; code: string }[]).map((j) => [j.code, j.id]));
    const savedJudge = new Map(((savedByJudge.data ?? []) as { code: string; judgments: number }[]).map((j) => [j.code, j.judgments]));
    const perJudge = <T extends Count>(rows: T[], key: (r: T) => string) => {
      const m = new Map<string, Record<string, number>>();
      for (const r of rows) m.set(r.judge_code, { ...(m.get(r.judge_code) ?? {}), [key(r)]: r.judgments });
      return m;
    };
    const types = perJudge((byType.data ?? []) as (Count & { type_code: string })[], (r) => r.type_code);
    const years = perJudge((byYear.data ?? []) as (Count & { year: number })[], (r) => String(r.year));

    const listed = ((lists.data ?? []) as ListRow[])
      .map((l) => ({
        id: ids.get(l.judge_code) ?? null,
        code: l.judge_code,
        name: l.judge_name,
        from: l.from_date,
        to: l.to_date,
        listed: l.read_total,
        courtListed: l.listed_total ?? l.read_total,
        byType: types.get(l.judge_code) ?? {},
        byYear: years.get(l.judge_code) ?? {},
        saved: savedJudge.get(l.judge_code) ?? 0,
      }))
      .sort((a, b) => b.listed - a.listed);
    const withList = new Set(listed.map((j) => j.code));

    const savedType = new Map<string, number>();
    for (const r of (saved.data ?? []) as { case_type_code: string | null }[]) {
      const k = r.case_type_code || "?";
      savedType.set(k, (savedType.get(k) ?? 0) + 1);
    }
    const listedType = new Map(((overall.data ?? []) as { type_code: string; judgments: number }[]).map((t) => [t.type_code, t.judgments]));
    const codes = new Set([...listedType.keys(), ...savedType.keys()]);
    const sitting = ((judges.data ?? []) as { code: string; name: string; sitting: boolean }[]).filter((j) => j.sitting);

    return NextResponse.json({
      totals: {
        listed: [...listedType.values()].reduce((n, v) => n + v, 0),
        judges: sitting.length,
        withLists: listed.length,
        types: listedType.size,
        saved: (saved.data ?? []).length,
      },
      since: listed.reduce<string | null>((m, j) => (!m || j.from < m ? j.from : m), null),
      types: [...codes]
        .map((code) => ({ code, name: typeName(code), listed: listedType.get(code) ?? 0, saved: savedType.get(code) ?? 0 }))
        .sort((a, b) => b.listed - a.listed || b.saved - a.saved || a.name.localeCompare(b.name)),
      judges: listed,
      waiting: sitting.filter((j) => !withList.has(j.code)).map((j) => ({ id: ids.get(j.code) ?? null, code: j.code, name: j.name })),
    });
  });
}
