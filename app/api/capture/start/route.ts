import { NextResponse } from "next/server";
import { z } from "zod";
import * as district from "@/lib/district/engine";
import * as highcourt from "@/lib/highcourt/engine";
import { body, withCapture } from "@/lib/capture";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ court: z.enum(["district", "highcourt"]) });

/**
 * "Start a new run" from the extension's popup, with the defaults: district —
 * the 10 newest pending cases of every case type, up to 10 years back; High
 * Court — up to 20 judgments for every sitting judge, picked at random from
 * everything since 10 years ago. Refused while a run for that court is still
 * open.
 */
export async function POST(req: Request) {
  return withCapture(req, async (cap) => {
    const parsed = Body.safeParse(await body(req));
    if (!parsed.success) return NextResponse.json({ error: "Bad request." }, { status: 400 });
    const staff = { id: cap.staffId ?? "00000000-0000-0000-0000-000000000000", name: cap.name, email: null };
    if (parsed.data.court === "district") {
      const open = await district.activeRun();
      if (open) return NextResponse.json({ error: "A district run is already open.", runId: open.id }, { status: 409 });
      return NextResponse.json({ runId: await district.createRun({ caseStatus: "P", staff }) }, { status: 201 });
    }
    const open = await highcourt.activeRun();
    if (open) return NextResponse.json({ error: "A High Court run is already open.", runId: open.id }, { status: 409 });
    return NextResponse.json({ runId: await highcourt.createRun({ staff }) }, { status: 201 });
  });
}
