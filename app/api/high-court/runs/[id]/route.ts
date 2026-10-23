import { NextResponse } from "next/server";
import { z } from "zod";
import { setRunStatus, snapshot } from "@/lib/highcourt/engine";
import { handle } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  return handle(async () => {
    const { id } = await ctx.params;
    return NextResponse.json(await snapshot(id));
  });
}

const Body = z.object({ status: z.enum(["running", "paused", "cancelled"]) });

export async function PATCH(req: Request, ctx: Ctx) {
  return handle(async () => {
    const { id } = await ctx.params;
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: "Unknown status." }, { status: 400 });
    await setRunStatus(id, parsed.data.status);
    return NextResponse.json(await snapshot(id));
  });
}
