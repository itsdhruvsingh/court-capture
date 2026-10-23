import fs from "node:fs/promises";
import path from "node:path";
import { zipSync } from "fflate";
import { handle } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DIR = path.join(process.cwd(), "extension");

type Manifest = { host_permissions: string[]; content_scripts: { matches: string[]; js: string[] }[] };

/**
 * The manifest taught this app's address: the extension may call it, and the
 * one-click connect helper runs on its Capture page. Match patterns ignore
 * ports, so http://localhost covers localhost:3100 too.
 */
function forApp(manifest: string, origin: string) {
  const m = JSON.parse(manifest) as Manifest;
  const { protocol, hostname } = new URL(origin);
  const host = `${protocol}//${hostname}`;
  if (!m.host_permissions.includes(`${host}/*`)) m.host_permissions.push(`${host}/*`);
  const connect = m.content_scripts.find((c) => c.js.includes("connect.js"));
  if (connect && !connect.matches.includes(`${host}/capture*`)) connect.matches.push(`${host}/capture*`);
  return JSON.stringify(m, null, 2);
}

/**
 * The extension as a zip, for teammates who do not have this repository:
 * download, unzip, Load unpacked. Built from the folder on every request, so
 * it can never drift from the code, with the manifest pointed at whichever
 * deployment served it. (next.config traces the folder into the deployment
 * for this route.)
 */
export async function GET(req: Request) {
  return handle(async () => {
    const origin = new URL(req.url).origin;
    const names = (await fs.readdir(DIR)).filter((n) => /\.(js|json|html|css|png|svg)$/i.test(n));
    const files: Record<string, Uint8Array> = {};
    for (const n of names) {
      const raw = await fs.readFile(path.join(DIR, n));
      files[`court-capture/${n}`] = n === "manifest.json" ? new TextEncoder().encode(forApp(raw.toString("utf8"), origin)) : new Uint8Array(raw);
    }
    const zip = zipSync(files, { level: 6 });
    return new Response(zip, {
      headers: {
        "content-type": "application/zip",
        "content-disposition": 'attachment; filename="court-capture-extension.zip"',
        "cache-control": "no-store",
      },
    });
  });
}
