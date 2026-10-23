"use client";

import { useState } from "react";
import { ChevronDown, Download, ExternalLink, FileText, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge, Button, Spinner } from "@/components/ui";
import { useToast } from "@/components/Toaster";
import { SummaryBody } from "@/components/SummaryBody";
import { fmtDate, getJson, type OrderView } from "../ui";

function prettyLabel(label: string | null, kind: OrderView["kind"]) {
  if (kind === "final") return "Final order / judgment";
  if (!label) return "Order";
  const l = label.toLowerCase();
  if (l.includes("judicial proceeding")) return "Judicial proceedings";
  if (l.includes("copy of order")) return "Order";
  return label.charAt(0) + label.slice(1).toLowerCase();
}

/**
 * One order: open it, download it, and read (or write) its AI summary.
 * A summary is written once on request and then served from the database —
 * the button changes from "Summarise" to "Read summary" for everybody.
 */
export function OrderCard({ order, onChange }: { order: OrderView; onChange: (o: OrderView) => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(order.summary_status === "failed" ? order.summary_error : null);
  const pdfUrl = `/api/district/orders/${order.id}/pdf`;
  const s = order.summary;

  const summarise = async () => {
    setBusy(true);
    setErr(null);
    setOpen(true);
    try {
      const b = await getJson<Partial<OrderView> & { cached: boolean }>(`/api/district/orders/${order.id}/summary`, { method: "POST" });
      onChange({ ...order, ...b } as OrderView);
      if (!b.cached) toast({ title: "Summary written", description: `Order ${order.order_no} of ${fmtDate(order.order_date)} — saved for everyone.`, tone: "success" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not write the summary.";
      setErr(msg);
      if ((e as { status?: number }).status === 409) {
        // Someone else is writing it; fetch theirs shortly.
        setTimeout(async () => {
          const b = await getJson<Partial<OrderView>>(`/api/district/orders/${order.id}/summary`).catch(() => null);
          if (b?.summary) {
            onChange({ ...order, ...b } as OrderView);
            setErr(null);
          }
        }, 8000);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={cn("rounded-[10px] border bg-raised/40", order.kind === "final" ? "border-accent/35" : "border-hairline")}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
        <FileText className={cn("h-4 w-4 shrink-0", order.kind === "final" ? "text-accent" : "text-faint")} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-medium text-foreground">{prettyLabel(order.label, order.kind)}</span>
            <span className="cc-mono text-faint">No. {order.order_no}</span>
            {order.kind === "final" && <Badge tone="accent">Final</Badge>}
          </div>
          {s && !open && <p className="mt-0.5 line-clamp-1 text-[12.5px] text-dim">{s.headline}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {s ? (
            <Button size="sm" variant={open ? "secondary" : "outline"} onClick={() => setOpen((v) => !v)} icon={<Sparkles className="h-3 w-3 text-accentSoft" />}>
              {open ? "Hide summary" : "Read summary"}
              <ChevronDown className={cn("h-3 w-3 transition-transform", open && "rotate-180")} />
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={summarise} loading={busy} icon={<Sparkles className="h-3 w-3 text-accentSoft" />}>
              {busy ? "Reading the order…" : "Summarise"}
            </Button>
          )}
          <a href={pdfUrl} target="_blank" rel="noreferrer">
            <Button size="sm" variant="ghost" icon={<ExternalLink className="h-3 w-3" />}>
              View
            </Button>
          </a>
          <a href={`${pdfUrl}?download=1`}>
            <Button size="sm" variant="ghost" icon={<Download className="h-3 w-3" />}>
              PDF
            </Button>
          </a>
        </div>
      </div>

      {(open || busy || err) && (
        <div className="border-t border-hairline px-4 py-3.5">
          {busy && !s ? (
            <div className="flex items-center gap-2.5 text-[12.5px] text-dim">
              <Spinner className="text-accent" />
              Fetching the order from the court and reading it. This takes 10–30 seconds, once.
            </div>
          ) : err && !s ? (
            <div className="flex flex-wrap items-center gap-3 text-[12.5px] text-dangerSoft">
              {err}
              <Button size="sm" variant="outline" onClick={summarise}>
                Try again
              </Button>
            </div>
          ) : s ? (
            <SummaryBody s={s} meta={order} />
          ) : null}
        </div>
      )}
    </div>
  );
}
