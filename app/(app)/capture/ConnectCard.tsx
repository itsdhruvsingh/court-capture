"use client";

import { useEffect, useState } from "react";
import { Copy, Download, Plug } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button, Card, Spinner } from "@/components/ui";
import { useToast } from "@/components/Toaster";
import { getJson } from "../district/ui";

type ExtState = { installed: boolean; connected: boolean; url: string | null };

/** Talks to the extension's helper on this page (extension/connect.js). */
function useExtension() {
  const [ext, setExt] = useState<ExtState | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.source !== window || e.origin !== window.location.origin) return;
      const d = e.data as { source?: string; type?: string; message?: string } & Partial<ExtState>;
      if (d?.source !== "court-capture") return;
      if (d.type === "hello") window.postMessage({ target: "court-capture", type: "ping" }, window.location.origin);
      if (d.type === "status") {
        setExt({ installed: true, connected: !!d.connected, url: d.url ?? null });
        setError(null);
      }
      if (d.type === "error") setError(d.message ?? "The extension refused the code.");
    };
    window.addEventListener("message", onMsg);
    window.postMessage({ target: "court-capture", type: "ping" }, window.location.origin);
    // No answer means no extension in this browser (or this address is not one it trusts).
    const t = setTimeout(() => setExt((cur) => cur ?? { installed: false, connected: false, url: null }), 1200);
    return () => {
      window.removeEventListener("message", onMsg);
      clearTimeout(t);
    };
  }, []);
  return { ext, error };
}

async function mintCode() {
  const b = await getJson<{ code: string }>("/api/capture/token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ origin: window.location.origin }),
  });
  return b.code;
}

/** Install once; connect with one click, or paste a code into the extension's popup. */
export function ConnectCard() {
  const { toast } = useToast();
  const { ext, error } = useExtension();
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const connect = async () => {
    setBusy(true);
    try {
      window.postMessage({ target: "court-capture", type: "connect", code: await mintCode() }, window.location.origin);
    } catch (e) {
      toast({ title: "Could not connect", description: e instanceof Error ? e.message : "", tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  const makeCode = async () => {
    setBusy(true);
    try {
      setCode(await mintCode());
    } catch (e) {
      toast({ title: "Could not make a connection code", description: e instanceof Error ? e.message : "", tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  const connected = ext?.connected;
  return (
    <Card className={cn("p-4", connected && "border-ok/30")}>
      <div className="mb-2 flex items-center gap-2">
        <Plug className={cn("h-3.5 w-3.5", connected ? "text-ok" : "text-accent")} />
        <span className="text-[13px] font-semibold text-foreground">{connected ? "Extension connected" : "The Court Capture extension"}</span>
      </div>

      {ext === null ? (
        <div className="flex items-center gap-2 text-[12px] text-dim">
          <Spinner /> Looking for the extension…
        </div>
      ) : connected ? (
        <p className="text-[12px] leading-relaxed text-dim">
          Click the extension&apos;s icon in the toolbar and pick <span className="text-foreground">District court</span> or{" "}
          <span className="text-foreground">High Court</span>. It opens the court&apos;s page and does the work; you type each captcha.
        </p>
      ) : ext.installed ? (
        <div className="space-y-2">
          <p className="text-[12px] text-dim">Installed in this browser. One click links it to your account.</p>
          <Button size="sm" variant="primary" className="w-full" onClick={connect} loading={busy}>
            Connect this browser
          </Button>
        </div>
      ) : (
        <ol className="list-decimal space-y-1 pl-4 text-[12px] leading-relaxed text-dim">
          <li>Download the extension below and unzip it.</li>
          <li>
            Open <span className="cc-mono text-foreground">chrome://extensions</span> (or <span className="cc-mono text-foreground">edge://extensions</span>), turn on
            Developer mode.
          </li>
          <li>
            Load unpacked → choose the unzipped <span className="cc-mono text-foreground">court-capture</span> folder.
          </li>
          <li>Reload this page and connect — or paste a code (below) into the extension&apos;s popup.</li>
        </ol>
      )}
      {error && <p className="mt-2 text-[12px] text-dangerSoft">{error}</p>}

      <div className="mt-3 flex flex-wrap gap-2 border-t border-hairline pt-3">
        <a href="/api/capture/extension">
          <Button size="sm" variant="secondary" icon={<Download className="h-3 w-3" />}>
            Download extension
          </Button>
        </a>
        {!code && (
          <Button size="sm" variant="ghost" onClick={makeCode} loading={busy && !ext?.installed}>
            Connection code
          </Button>
        )}
      </div>
      {code && (
        <div className="mt-2 space-y-2">
          <textarea readOnly value={code} className="cc-input cc-mono h-[68px] resize-none text-[10.5px]" onFocus={(e) => e.currentTarget.select()} />
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              icon={<Copy className="h-3 w-3" />}
              onClick={async () => {
                await navigator.clipboard.writeText(code).catch(() => {});
                toast({ title: "Copied", description: "Paste it into the extension's popup.", tone: "success" });
              }}
            >
              Copy code
            </Button>
            <span className="text-[11px] text-faint">Valid 30 days, for you only. Treat it like a password.</span>
          </div>
        </div>
      )}
      <p className="mt-3 text-[11.5px] leading-relaxed text-faint">
        Sharing the work: each teammate installs the extension, signs in here with their own account and connects. Everyone gets different
        case types or judges automatically.
      </p>
    </Card>
  );
}
