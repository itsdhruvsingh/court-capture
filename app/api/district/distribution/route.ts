import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { handle } from "@/lib/http";
import { CASE_TYPES } from "@/lib/district/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TotalRow = { est_code: string; establishment: string | null; type_label: string; reg_year: number; case_status: "P" | "D"; total: number };
type Slice = { year: number; status: "P" | "D"; total: number };

/** "CS DJ" / "cs dj" / "CS-DJ" → "CSDJ": how printed types are compared. */
const typeKey = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

/**
 * How Saket's caseload splits by case type. The counts are the court's own,
 * from the searches the extension made — per establishment, printed type,
 * registration year and status — next to how many of each type are captured.
 * `?year=2026&status=P` picks the slice; the newest pending one by default.
 */
export async function GET(req: Request) {
  return handle(async () => {
    const url = new URL(req.url);
    const db = supabaseAdmin() as unknown as SupabaseClient;
    const [totalsQ, casesQ, searchedQ] = await Promise.all([
      db.from("court_type_totals_v").select("est_code, establishment, type_label, reg_year, case_status, total").limit(50_000),
      db.from("court_cases").select("case_type, detail_status").limit(50_000),
      db.from("court_search_results").select("case_type_code, reg_year, case_status").limit(50_000),
    ]);
    for (const q of [totalsQ, casesQ, searchedQ]) if (q.error) throw q.error;
    const totals = (totalsQ.data ?? []) as TotalRow[];

    const slices = new Map<string, Slice>();
    for (const t of totals) {
      const s = slices.get(`${t.reg_year}${t.case_status}`) ?? { year: t.reg_year, status: t.case_status, total: 0 };
      s.total += t.total;
      slices.set(`${t.reg_year}${t.case_status}`, s);
    }
    const list = [...slices.values()].sort((a, b) => b.year - a.year || (a.status === b.status ? 0 : a.status === "P" ? -1 : 1));
    const year = Number(url.searchParams.get("year")) || null;
    const status = url.searchParams.get("status");
    const slice = list.find((s) => (!year || s.year === year) && (!status || s.status === status)) ?? list[0] ?? null;

    const captured = new Map<string, { label: string; cases: number; read: number }>();
    for (const c of (casesQ.data ?? []) as { case_type: string | null; detail_status: string }[]) {
      if (!c.case_type) continue;
      const e = captured.get(typeKey(c.case_type)) ?? { label: c.case_type, cases: 0, read: 0 };
      e.cases++;
      if (c.detail_status === "fetched") e.read++;
      captured.set(typeKey(c.case_type), e);
    }

    const types = new Map<string, { label: string; total: number; courts: { est: string; name: string; total: number }[] }>();
    const courts = new Map<string, { est: string; name: string; total: number; types: number }>();
    for (const t of slice ? totals.filter((x) => x.reg_year === slice.year && x.case_status === slice.status) : []) {
      const name = t.establishment ?? t.est_code;
      const e = types.get(typeKey(t.type_label)) ?? { label: t.type_label, total: 0, courts: [] };
      e.total += t.total;
      e.courts.push({ est: t.est_code, name, total: t.total });
      types.set(typeKey(t.type_label), e);
      const c = courts.get(t.est_code) ?? { est: t.est_code, name, total: 0, types: 0 };
      c.total += t.total;
      if (t.total > 0) c.types++;
      courts.set(t.est_code, c);
    }
    const searched = new Set(
      ((searchedQ.data ?? []) as { case_type_code: string; reg_year: number; case_status: string }[])
        .filter((s) => slice && s.reg_year === slice.year && s.case_status === slice.status)
        .map((s) => s.case_type_code)
    );

    const all = [...captured.values()];
    return NextResponse.json({
      slices: list,
      slice,
      coverage: { searched: searched.size, codes: CASE_TYPES.length },
      types: [...types.entries()]
        .map(([k, t]) => ({ ...t, courts: t.courts.sort((a, b) => b.total - a.total), captured: captured.get(k)?.cases ?? 0, read: captured.get(k)?.read ?? 0 }))
        .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label)),
      courts: [...courts.values()].sort((a, b) => b.total - a.total),
      captured: { cases: all.reduce((n, c) => n + c.cases, 0), read: all.reduce((n, c) => n + c.read, 0), types: all.length },
    });
  });
}
