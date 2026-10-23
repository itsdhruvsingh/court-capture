/**
 * Court Cases — the extension's credential.
 *
 * The capture extension runs in the person's browser on the court's site and
 * talks to this app from its background worker, where the dashboard's sign-in
 * cookie cannot be relied on. So a signed-in person mints a token on the
 * Scraper tab and pastes it into the extension once.
 *
 * The token is stateless — `{sub, name, exp}` signed with HMAC — so there is no
 * table to manage. The key is derived from SUPABASE_SECRET_KEY (or
 * COURT_CAPTURE_SECRET when set) under its own label, so it can never collide
 * with any other use of that secret. Rotating either secret revokes every token.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

const LABEL = "scl-court-capture-token-v1";
const TTL_DAYS = 30;

export type CaptureClaims = { sub: string; name: string; exp: number };

function key(): Buffer {
  const secret = process.env.COURT_CAPTURE_SECRET || process.env.SUPABASE_SECRET_KEY;
  if (!secret) throw new Error("No secret is configured to sign capture tokens.");
  return createHmac("sha256", secret).update(LABEL).digest();
}

const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");

export function mintCaptureToken(staff: { id: string; name: string | null; email: string | null }, now = Date.now()) {
  const claims: CaptureClaims = {
    sub: staff.id,
    name: staff.name ?? staff.email ?? "staff",
    exp: Math.floor(now / 1000) + TTL_DAYS * 86_400,
  };
  const body = b64(JSON.stringify(claims));
  const sig = b64(createHmac("sha256", key()).update(body).digest());
  return { token: `${body}.${sig}`, expiresAt: new Date(claims.exp * 1000).toISOString() };
}

export function verifyCaptureToken(token: string | null | undefined, now = Date.now()): CaptureClaims | null {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const want = createHmac("sha256", key()).update(body).digest();
  const got = Buffer.from(sig, "base64url");
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  try {
    const claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as CaptureClaims;
    if (!claims?.sub || typeof claims.exp !== "number" || claims.exp * 1000 < now) return null;
    return claims;
  } catch {
    return null;
  }
}
