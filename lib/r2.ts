import { createHash, createHmac } from "crypto";

/**
 * Cloudflare R2, over its S3-compatible API.
 *
 * Written against the protocol rather than against a vendor SDK. `@aws-sdk/
 * client-s3` is roughly twenty megabytes of dependency tree and a cold-start
 * penalty on every serverless function that imports it, to do four things —
 * PUT an object, GET one, DELETE one, LIST a prefix — plus presigning. Signature
 * Version 4 is a published algorithm and the whole of it fits below.
 *
 * The one thing to know before editing any of this: SigV4 fails closed and
 * silently. A signature computed over a canonical request that differs from the
 * real one by a single byte comes back as 403 SignatureDoesNotMatch with no
 * indication of which byte. So the canonicalisation rules are spelled out where
 * they are applied, and `debugCanonical` exists to print what was actually
 * signed when one of them is eventually got wrong.
 */

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  /** Where the world reads public objects. A custom domain, or the r2.dev URL. */
  publicBaseUrl: string | null;
}

export function r2Config(): R2Config | null {
  const accountId = process.env.R2_ACCOUNT_ID?.trim();
  const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();
  const bucket = process.env.R2_BUCKET?.trim();

  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return null;

  return {
    accountId,
    accessKeyId,
    secretAccessKey,
    bucket,
    publicBaseUrl: process.env.R2_PUBLIC_BASE_URL?.trim().replace(/\/$/, "") || null,
  };
}

const REGION = "auto";
const SERVICE = "s3";

function endpoint(cfg: R2Config) {
  return `https://${cfg.accountId}.r2.cloudflarestorage.com`;
}

function sha256hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

/**
 * RFC 3986, which is not what encodeURIComponent does.
 *
 * encodeURIComponent leaves ! ' ( ) * alone; AWS requires them encoded. A key
 * containing an apostrophe — which is most legal documents with a party name in
 * them — signs correctly and then 403s without this.
 */
function uriEncode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

/** Each path segment encoded, the separators left alone. */
function canonicalPath(key: string): string {
  return `/${key.split("/").map(uriEncode).join("/")}`;
}

/**
 * The request path for an object, or for the bucket itself.
 *
 * The empty-key case is the one that matters and the one that is easy to get
 * wrong. `canonicalPath("bucket/")` yields `/bucket/` — a trailing empty
 * segment — and a bucket-level call such as ListObjectsV2 addresses `/bucket`.
 * Signing one and sending the other is a guaranteed SignatureDoesNotMatch, and
 * SigV4 gives no hint which of the many inputs disagreed.
 */
function bucketPath(bucket: string, key: string): string {
  return key ? canonicalPath(`${bucket}/${key}`) : `/${uriEncode(bucket)}`;
}

function amzDate(now: Date) {
  const iso = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  return { full: iso, day: iso.slice(0, 8) };
}

function signingKey(cfg: R2Config, day: string): Buffer {
  return hmac(hmac(hmac(hmac(`AWS4${cfg.secretAccessKey}`, day), REGION), SERVICE), "aws4_request");
}

interface SignedRequest {
  url: string;
  headers: Record<string, string>;
}

/**
 * Sign a request with the Authorization header (used for every call we make
 * ourselves, as opposed to a URL handed to a browser).
 */
function signRequest(args: {
  cfg: R2Config;
  method: string;
  key: string;
  query?: Record<string, string>;
  body?: Buffer;
  extraHeaders?: Record<string, string>;
}): SignedRequest {
  const { cfg, method, key } = args;
  const now = new Date();
  const { full, day } = amzDate(now);

  const host = `${cfg.accountId}.r2.cloudflarestorage.com`;
  const path = bucketPath(cfg.bucket, key);

  const payloadHash = args.body ? sha256hex(args.body) : sha256hex("");

  const headers: Record<string, string> = {
    host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": full,
    ...(args.extraHeaders ?? {}),
  };

  // Header names lowercased, sorted, values trimmed — and the SignedHeaders
  // list has to match the set exactly, in the same order.
  const sortedNames = Object.keys(headers)
    .map((h) => h.toLowerCase())
    .sort();
  const canonicalHeaders = sortedNames
    .map((name) => {
      const original = Object.keys(headers).find((h) => h.toLowerCase() === name)!;
      return `${name}:${String(headers[original]).trim().replace(/\s+/g, " ")}\n`;
    })
    .join("");
  const signedHeaders = sortedNames.join(";");

  const canonicalQuery = Object.entries(args.query ?? {})
    .map(([k, v]) => [uriEncode(k), uriEncode(v)] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");

  const canonicalRequest = [
    method,
    path,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const scope = `${day}/${REGION}/${SERVICE}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    full,
    scope,
    sha256hex(canonicalRequest),
  ].join("\n");

  const signature = hmac(signingKey(cfg, day), stringToSign).toString("hex");

  return {
    url: `${endpoint(cfg)}${path}${canonicalQuery ? `?${canonicalQuery}` : ""}`,
    headers: {
      ...headers,
      authorization:
        `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${scope}, ` +
        `SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  };
}

/**
 * A URL a browser can open for a few minutes without holding a credential.
 *
 * Query-string signing rather than header signing, because a browser cannot be
 * told to send an Authorization header on a plain navigation. Used for the
 * private space — court orders — where the object must not be world-readable.
 */
export function presignGet(args: {
  cfg: R2Config;
  key: string;
  expiresIn: number;
  downloadAs?: string | null;
}): string {
  const { cfg, key } = args;
  const now = new Date();
  const { full, day } = amzDate(now);

  const host = `${cfg.accountId}.r2.cloudflarestorage.com`;
  const path = bucketPath(cfg.bucket, key);
  const scope = `${day}/${REGION}/${SERVICE}/aws4_request`;

  const query: Record<string, string> = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${cfg.accessKeyId}/${scope}`,
    "X-Amz-Date": full,
    // Clamped: a week is the protocol maximum and anything longer signs fine
    // and then 403s at request time, which is a confusing way to find out.
    "X-Amz-Expires": String(Math.min(Math.max(args.expiresIn, 1), 604800)),
    "X-Amz-SignedHeaders": "host",
  };

  if (args.downloadAs) {
    // Quotes escaped, because a filename with one in it otherwise terminates
    // the header value early and the browser saves the file under a truncated
    // name.
    const safe = args.downloadAs.replace(/"/g, "'");
    query["response-content-disposition"] = `attachment; filename="${safe}"`;
  }

  const canonicalQuery = Object.entries(query)
    .map(([k, v]) => [uriEncode(k), uriEncode(v)] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");

  const canonicalRequest = [
    "GET",
    path,
    canonicalQuery,
    `host:${host}\n`,
    "host",
    "UNSIGNED-PAYLOAD",
  ].join("\n");

  const stringToSign = ["AWS4-HMAC-SHA256", full, scope, sha256hex(canonicalRequest)].join("\n");
  const signature = hmac(signingKey(cfg, day), stringToSign).toString("hex");

  return `${endpoint(cfg)}${path}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

export interface R2PutArgs {
  key: string;
  body: Buffer;
  contentType?: string;
  /** Sent as object metadata, so the origin serves it on a public GET. */
  cacheControl?: string;
}

export async function r2Put(cfg: R2Config, args: R2PutArgs): Promise<void> {
  const extra: Record<string, string> = {};
  if (args.contentType) extra["content-type"] = args.contentType;
  if (args.cacheControl) extra["cache-control"] = args.cacheControl;

  const signed = signRequest({
    cfg,
    method: "PUT",
    key: args.key,
    body: args.body,
    extraHeaders: extra,
  });

  const res = await fetch(signed.url, {
    method: "PUT",
    headers: signed.headers,
    body: new Uint8Array(args.body),
    signal: AbortSignal.timeout(120_000),
  });

  if (!res.ok) throw new Error(await describe(res, `upload ${args.key}`));
}

export async function r2Get(cfg: R2Config, key: string): Promise<Buffer | null> {
  const signed = signRequest({ cfg, method: "GET", key });
  const res = await fetch(signed.url, {
    method: "GET",
    headers: signed.headers,
    signal: AbortSignal.timeout(120_000),
  });

  if (res.status === 404) return null;
  if (!res.ok) throw new Error(await describe(res, `read ${key}`));
  return Buffer.from(await res.arrayBuffer());
}

export async function r2Head(
  cfg: R2Config,
  key: string
): Promise<{ size: number; contentType: string | null; lastModified: string | null } | null> {
  const signed = signRequest({ cfg, method: "HEAD", key });
  const res = await fetch(signed.url, {
    method: "HEAD",
    headers: signed.headers,
    signal: AbortSignal.timeout(30_000),
  });

  if (res.status === 404) return null;
  if (!res.ok) throw new Error(await describe(res, `stat ${key}`));

  return {
    size: Number(res.headers.get("content-length") ?? 0),
    contentType: res.headers.get("content-type"),
    lastModified: res.headers.get("last-modified"),
  };
}

export async function r2Delete(cfg: R2Config, key: string): Promise<void> {
  const signed = signRequest({ cfg, method: "DELETE", key });
  const res = await fetch(signed.url, {
    method: "DELETE",
    headers: signed.headers,
    signal: AbortSignal.timeout(30_000),
  });
  // S3 deletes are idempotent: a missing object is a successful delete.
  if (!res.ok && res.status !== 404) throw new Error(await describe(res, `delete ${key}`));
}

export interface R2Listing {
  keys: { key: string; size: number; lastModified: string | null }[];
  nextToken: string | null;
}

/**
 * One page of a prefix. Paged rather than exhaustive on purpose — the asset
 * migration walks tens of thousands of objects and must not hold them all in
 * memory to do it.
 */
export async function r2List(
  cfg: R2Config,
  prefix: string,
  token?: string | null,
  limit = 1000
): Promise<R2Listing> {
  const query: Record<string, string> = {
    "list-type": "2",
    prefix,
    "max-keys": String(limit),
  };
  if (token) query["continuation-token"] = token;

  // ListObjectsV2 addresses the bucket, not a key inside it. The URL is sent
  // exactly as it was signed — rewriting it afterwards was the bug this
  // comment now guards against.
  const signed = signRequest({ cfg, method: "GET", key: "", query });

  const res = await fetch(signed.url, {
    method: "GET",
    headers: signed.headers,
    signal: AbortSignal.timeout(60_000),
  });

  if (!res.ok) throw new Error(await describe(res, `list ${prefix}`));

  const xml = await res.text();
  const keys: R2Listing["keys"] = [];

  for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
    const block = m[1];
    const key = block.match(/<Key>([\s\S]*?)<\/Key>/)?.[1];
    if (!key) continue;
    keys.push({
      key: decodeXml(key),
      size: Number(block.match(/<Size>(\d+)<\/Size>/)?.[1] ?? 0),
      lastModified: block.match(/<LastModified>([\s\S]*?)<\/LastModified>/)?.[1] ?? null,
    });
  }

  const truncated = /<IsTruncated>true<\/IsTruncated>/.test(xml);
  const next = xml.match(/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/)?.[1];

  return { keys, nextToken: truncated && next ? decodeXml(next) : null };
}

/**
 * Every bucket these credentials can see.
 *
 * Addresses the account rather than a bucket, so the config's `bucket` is not
 * used and may be empty — which is exactly the case at setup time, before
 * anybody knows what to put there.
 */
export async function r2ListBuckets(cfg: R2Config): Promise<string[]> {
  const signed = signRequest({ cfg: { ...cfg, bucket: "" }, method: "GET", key: "" });

  const res = await fetch(signed.url, {
    method: "GET",
    headers: signed.headers,
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) throw new Error(await describe(res, "list buckets"));

  const xml = await res.text();
  return [...xml.matchAll(/<Bucket>[\s\S]*?<Name>([\s\S]*?)<\/Name>[\s\S]*?<\/Bucket>/g)]
    .map((m) => decodeXml(m[1]));
}

/**
 * Make the bucket if it is not there.
 *
 * Used by the setup script, not by the app. Creating a bucket from something
 * that may be running in twenty places at once is a worse idea than it looks,
 * so the runtime path assumes the bucket exists and says so plainly when it
 * does not.
 */
export async function r2CreateBucket(cfg: R2Config, name: string): Promise<"created" | "exists"> {
  // The bucket goes in the config, not the key: PUT /{bucket} with an empty
  // key is the create call. Passing it as a key would sign `//{bucket}`.
  const signed = signRequest({ cfg: { ...cfg, bucket: name }, method: "PUT", key: "" });

  const res = await fetch(signed.url, {
    method: "PUT",
    headers: signed.headers,
    signal: AbortSignal.timeout(30_000),
  });

  if (res.ok) return "created";

  const body = await res.text().catch(() => "");
  if (/BucketAlreadyOwnedByYou|BucketAlreadyExists/i.test(body)) return "exists";

  throw new Error(await describe(new Response(body, { status: res.status }), `create bucket ${name}`));
}

function decodeXml(s: string) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

/**
 * R2 answers failures in S3's XML, which is unreadable in a log line. Pull the
 * code and message out so the error says what went wrong.
 */
async function describe(res: Response, what: string): Promise<string> {
  const body = await res.text().catch(() => "");
  const code = body.match(/<Code>([\s\S]*?)<\/Code>/)?.[1];
  const message = body.match(/<Message>([\s\S]*?)<\/Message>/)?.[1];

  if (code === "SignatureDoesNotMatch") {
    return `R2 rejected the signature on ${what}. The access key and secret do not match, or the secret has a stray space in .env.local.`;
  }
  if (code === "NoSuchBucket") {
    return `R2 has no bucket named in R2_BUCKET. Create it in the Cloudflare dashboard, or fix the name.`;
  }
  if (res.status === 401 || res.status === 403) {
    return `R2 refused ${what} (HTTP ${res.status}${code ? `, ${code}` : ""}). The R2 API token needs Object Read & Write on this bucket.`;
  }
  return `Could not ${what}: HTTP ${res.status}${code ? ` ${code}` : ""}${message ? ` — ${message}` : ""}`;
}

/**
 * What was actually signed, for the day a signature mismatch has to be chased.
 * Never called in normal operation; deliberately kept rather than reconstructed
 * from memory at 2am.
 */
export function debugCanonical(cfg: R2Config, method: string, key: string) {
  const signed = signRequest({ cfg, method, key });
  return { url: signed.url, headers: { ...signed.headers, authorization: "<redacted>" } };
}
