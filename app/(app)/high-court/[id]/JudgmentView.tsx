"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ChevronDown, Download, ExternalLink, FileText, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge, Button, Card, CopyButton, Skeleton, Spinner } from "@/components/ui";
import { useToast } from "@/components/Toaster";
import { SummaryBody, type SummaryMeta, type SummaryView } from "@/components/SummaryBody";
import { SetupNotice, fmtDate, getJson } from "../../district/ui";
import { JudgeLinks, titleCase, type JudgeRef } from "../ui";

type Judgment = SummaryMeta & {
  id: string;
  case_no: string;
  case_type: string | null;
  case_type_code: string | null;
  neutral_citation: string | null;
  order_date: string | null;
  petitioner: string | null;
  respondent: string | null;
  corrigendum: string | null;
  uploaded_on: string | null;
  remark: string | null;
  pdf_url: string | null;
  txt_url: string | null;
  pdf_path: string | null;
  pdf_bytes: number | null;
  pdf_error: string | null;
  body_text: string | null;
  text_error: string | null;
  summary: SummaryView | null;
  summary_status: string | null;
  summary_error: string | null;
  created_at: string;
  judges: JudgeRef[];
};

export function JudgmentView({ id }: { id: string }) {
  const { toast } = useToast();
  const [j, setJ] = useState<Judgment | null>(null);
  const [error, setError] = useState<{ message: string; setup?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [sumErr, setSumErr] = useState<string | null>(null);
  const [showText, setShowText] = useState(false);

  useEffect(() => {
    getJson<{ judgment: Judgment }>(`/api/high-court/judgments/${id}`)
      .then((b) => setJ(b.judgment))
      .catch((e) => setError({ message: e.message, setup: e.setup }));
  }, [id]);

  const summarise = async () => {
    setBusy(true);
    setSumErr(null);
    try {
      const b = await getJson<Partial<Judgment> & { cached: boolean }>(`/api/high-court/judgments/${id}/summary`, { method: "POST" });
      setJ((cur) => (cur ? { ...cur, ...b } : cur));
      if (!b.cached) toast({ title: "Summary written", description: "Saved for everyone.", tone: "success" });
    } catch (e) {
      setSumErr(e instanceof Error ? e.message : "Could not write the summary.");
    } finally {
      setBusy(false);
    }
  };

  if (error?.setup) return <SetupNotice message={error.message} />;
  if (error)
    return (
      <>
        <Back />
        <Card className="p-6 text-[13px] text-dangerSoft">{error.message}</Card>
      </>
    );
  if (!j)
    return (
      <div className="space-y-4">
        <Back />
        <Skeleton className="h-28" />
        <Skeleton className="h-64" />
      </div>
    );

  const pdf = `/api/high-court/judgments/${j.id}/pdf`;
  const facts: [string, string | null][] = [
    ["Date of judgment", fmtDate(j.order_date)],
    ["Case type", j.case_type ? `${j.case_type}${j.case_type_code ? ` (${j.case_type_code})` : ""}` : null],
    ["Neutral citation", j.neutral_citation],
    ["Corrigendum", j.corrigendum],
    ["Uploaded", j.uploaded_on],
    ["Remark", j.remark],
  ];

  return (
    <div className="mx-auto max-w-[1100px]">
      <Back />
      <div className="mb-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="cc-mono text-[13px] text-dim">{j.case_no}</span>
          {j.case_type && <Badge tone="muted">{j.case_type}</Badge>}
          {j.neutral_citation && (
            <span className="flex items-center gap-1.5">
              <span className="cc-mono text-[12px] text-faint">{j.neutral_citation}</span>
              <CopyButton text={j.neutral_citation} label="Copy" className="h-6 px-2 text-[11px]" />
            </span>
          )}
        </div>
        <h1 className="mt-2 text-[24px] font-semibold leading-tight tracking-[-0.02em] text-foreground md:text-[28px]">
          {titleCase(j.petitioner)} <span className="font-normal text-faint">vs</span> {titleCase(j.respondent)}
        </h1>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[12.5px] text-dim">
          <span>High Court of Delhi</span>
          <span className="text-faint">·</span>
          <JudgeLinks judges={j.judges} />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-6">
          <Card className="p-0">
            <div className="flex flex-wrap items-center gap-2 border-b border-hairline px-4 py-2.5">
              <Sparkles className="h-3.5 w-3.5 text-accent" />
              <span className="text-[13px] font-semibold text-foreground">Summary</span>
              <div className="ml-auto flex gap-1.5">
                <a href={pdf} target="_blank" rel="noreferrer">
                  <Button size="sm" variant="ghost" icon={<ExternalLink className="h-3 w-3" />}>
                    View PDF
                  </Button>
                </a>
                <a href={`${pdf}?download=1`}>
                  <Button size="sm" variant="ghost" icon={<Download className="h-3 w-3" />}>
                    Download
                  </Button>
                </a>
              </div>
            </div>
            <div className="px-4 py-4">
              {j.summary ? (
                <SummaryBody s={j.summary} meta={j} noun="judgment" />
              ) : busy ? (
                <div className="flex items-center gap-2.5 text-[12.5px] text-dim">
                  <Spinner className="text-accent" /> Reading the judgment. This takes 10–40 seconds, once.
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-3">
                  <Button variant="primary" onClick={summarise} icon={<Sparkles className="h-3.5 w-3.5" />}>
                    Summarise this judgment
                  </Button>
                  <span className="text-[12px] text-faint">Written once from the court&apos;s text, then kept for everyone.</span>
                  {(sumErr || (j.summary_status === "failed" && j.summary_error)) && <p className="w-full text-[12.5px] text-dangerSoft">{sumErr ?? j.summary_error}</p>}
                </div>
              )}
            </div>
          </Card>

          <Card className="p-0">
            <button onClick={() => setShowText((v) => !v)} className="flex w-full items-center gap-2 px-4 py-2.5 text-left">
              <FileText className="h-3.5 w-3.5 text-faint" />
              <span className="text-[13px] font-semibold text-foreground">Full text</span>
              <span className="text-[12px] text-faint">{j.body_text ? `${Math.round(j.body_text.length / 1000)}k characters, as the court published it` : j.text_error ?? "Not fetched yet"}</span>
              <ChevronDown className={cn("ml-auto h-3.5 w-3.5 text-faint transition-transform", showText && "rotate-180")} />
            </button>
            {showText && j.body_text && <div className="cc-prose max-h-[70vh] overflow-y-auto border-t border-hairline px-4 py-4">{j.body_text}</div>}
          </Card>
        </div>

        <aside className="space-y-4">
          <Card className="p-4">
            <dl className="space-y-2.5 text-[12.5px]">
              {facts
                .filter(([, v]) => v)
                .map(([k, v]) => (
                  <div key={k}>
                    <dt className="cc-label">{k}</dt>
                    <dd className="mt-0.5 text-foreground">{v}</dd>
                  </div>
                ))}
            </dl>
          </Card>
          <Card className="p-4 text-[12px] leading-relaxed text-faint">
            Read from the High Court&apos;s judgment search{j.created_at ? ` on ${fmtDate(j.created_at.slice(0, 10))}` : ""}. The court&apos;s copy is the authority.
            {j.pdf_url && (
              <>
                {" "}
                <a href={j.pdf_url} target="_blank" rel="noreferrer" className="text-dim underline underline-offset-2">
                  Open on the court&apos;s site
                </a>
                .
              </>
            )}
          </Card>
        </aside>
      </div>
    </div>
  );
}

function Back() {
  return (
    <Link href="/high-court" className="mb-4 inline-flex items-center gap-1.5 text-[12.5px] text-dim hover:text-foreground">
      <ArrowLeft className="h-3.5 w-3.5" /> High Court judgments
    </Link>
  );
}
