import "server-only";
import { presignGet, r2Config, r2Delete, r2Get, r2Head, r2Put, type R2Config } from "./r2";

/**
 * Where documents are kept: one Cloudflare R2 bucket, keys prefixed by space.
 *
 * Only one space, `court-orders`, and it is private — court documents are
 * served through this app (or a short-lived presigned URL), never publicly.
 * Keys are `court-orders/<path>`, the same layout the SCL dashboard used, so
 * every PDF stored before the move still resolves.
 */

export type Space = "court-orders";

function cfg(): R2Config {
  const c = r2Config();
  if (!c) throw new Error("R2 is not configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET.");
  return c;
}

export function objectKey(space: Space, path: string) {
  return `${space}/${path.replace(/^\/+/, "")}`;
}

export async function putObject(args: { space: Space; path: string; body: Buffer; contentType?: string }) {
  await r2Put(cfg(), {
    key: objectKey(args.space, args.path),
    body: args.body,
    contentType: args.contentType,
    // Paths are never rewritten with different content, so they cache hard.
    cacheControl: "private, max-age=31536000, immutable",
  });
  return { path: args.path };
}

export async function getObject(space: Space, path: string): Promise<Buffer | null> {
  return r2Get(cfg(), objectKey(space, path)).catch(() => null);
}

export async function headObject(space: Space, path: string) {
  const h = await r2Head(cfg(), objectKey(space, path)).catch(() => null);
  return h ? { size: h.size, contentType: h.contentType } : null;
}

export async function removeObjects(space: Space, paths: string[]) {
  const c = cfg();
  await Promise.all(paths.map((p) => r2Delete(c, objectKey(space, p)).catch(() => undefined)));
}

/** A short-lived link to a private object, optionally as a download. */
export function signedUrl(space: Space, path: string, opts?: { expiresIn?: number; downloadAs?: string | null }) {
  return presignGet({ cfg: cfg(), key: objectKey(space, path), expiresIn: opts?.expiresIn ?? 300, downloadAs: opts?.downloadAs ?? null });
}
