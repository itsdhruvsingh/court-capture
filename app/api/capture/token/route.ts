import { NextResponse } from "next/server";
import { mintCaptureToken } from "@/lib/token";
import { handle } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A connection code for the extension: this app's address plus a 30-day token
 * for the signed-in person, in one string to paste. The address comes from the
 * browser that asked, so the code points back at whichever deployment minted it.
 */
export async function POST(req: Request) {
  return handle(async (staff) => {
    const { origin } = (await req.json().catch(() => ({}))) as { origin?: string };
    const base = origin && /^https?:\/\/[^/]+$/.test(origin) ? origin : new URL(req.url).origin;
    const { token, expiresAt } = mintCaptureToken(staff);
    const code = Buffer.from(JSON.stringify({ v: 1, url: base, token })).toString("base64url");
    return NextResponse.json({ code, expiresAt, url: base });
  });
}
