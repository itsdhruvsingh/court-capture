import { NextResponse } from "next/server";
import * as district from "@/lib/district/engine";
import * as highcourt from "@/lib/highcourt/engine";
import { withCapture } from "@/lib/capture";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Who the extension is connected as, and the open run of each court with its
 * progress, this person's share and who else is on it. The popup shows both;
 * each court's page panel reads its own.
 */
export async function GET(req: Request) {
  return withCapture(req, async (cap) => {
    const me = district.shortName(cap.name);
    const [d, h] = await Promise.all([district.activeRun(), highcourt.activeRun()]);
    const [ds, hs] = await Promise.all([d ? district.snapshot(d.id) : null, h ? highcourt.snapshot(h.id) : null]);
    return NextResponse.json({
      who: cap.name,
      district: ds
        ? {
            id: ds.run.id,
            status: ds.run.status,
            label: ds.run.label,
            done: ds.totals.fetched,
            wanted: ds.totals.wanted,
            unitsLeft: ds.tasks.filter((t) => t.status === "pending").length,
            units: ds.tasks.length,
            unitName: "case types",
            mine: ds.run.stats.people?.[me] ?? {},
            others: ds.capturers.filter((c) => c.name !== me).map((c) => ({ name: c.name, on: c.caseTypes })),
          }
        : null,
      highcourt: hs
        ? {
            id: hs.run.id,
            status: hs.run.status,
            label: hs.run.label,
            done: hs.totals.found,
            wanted: hs.totals.wanted,
            unitsLeft: hs.totals.judges - hs.totals.judgesDone,
            units: hs.totals.judges,
            unitName: "judges",
            mine: hs.run.stats.people?.[me] ?? {},
            others: hs.capturers.filter((c) => c.name !== me).map((c) => ({ name: c.name, on: c.judges })),
          }
        : null,
    });
  });
}
