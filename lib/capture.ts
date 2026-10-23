import { NextResponse } from "next/server";
import { verifyCaptureToken } from "./token";
import { failure } from "./http";
import type { Capturer } from "./district/types";

/**
 * The extension's routes. It calls from its background worker with the token
 * minted on the Capture page (not the sign-in cookie), and names itself with
 * `x-capture-id` — one id per browser, so two people (or one person in two
 * browsers) each hold their own share of the work.
 */
export async function withCapture(req: Request, fn: (cap: Capturer) => Promise<Response>): Promise<Response> {
  const auth = req.headers.get("authorization") ?? "";
  const who = verifyCaptureToken(auth.replace(/^Bearer\s+/i, "").trim());
  if (!who) {
    return NextResponse.json(
      { error: "The extension is not connected, or its code has expired. Connect it again from the Capture page." },
      { status: 401 }
    );
  }
  const raw = req.headers.get("x-capture-id") ?? "";
  const id = /^[a-z0-9-]{8,64}$/i.test(raw) ? raw : `user-${who.sub}`;
  try {
    return await fn({ id, name: who.name, staffId: who.sub });
  } catch (err) {
    return failure(err);
  }
}

export async function body<T>(req: Request): Promise<T | null> {
  return (await req.json().catch(() => null)) as T | null;
}
