"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";

export type JudgeRef = { hc_judges: { id: string; name: string; code?: string } | null };

export type JudgmentListItem = {
  id: string;
  case_no: string;
  case_type: string | null;
  case_type_code: string | null;
  case_number: number | null;
  case_year: number | null;
  neutral_citation: string | null;
  order_date: string | null;
  petitioner: string | null;
  respondent: string | null;
  corrigendum: string | null;
  remark: string | null;
  pdf_path: string | null;
  body_text_present: string | null;
  summary_at: string | null;
  judges: JudgeRef[];
};

/** "JUSTICE PRATHIBA M. SINGH" → "Prathiba M. Singh". */
export function shortJudge(name: string) {
  return name
    .replace(/^(acting chief justice|chief justice|dr\.\s*justice|justice)\s+/i, "")
    .toLowerCase()
    .replace(/(^|[\s.(-])([a-z])/g, (_, p, c) => p + c.toUpperCase());
}

export function titleCase(s: string | null | undefined) {
  return String(s ?? "")
    .toLowerCase()
    .replace(/(^|[\s(/&-])([a-z])/g, (_, p, c) => p + c.toUpperCase())
    .replace(/\b(Of|And|The|For|In|Vs)\b/g, (w) => w.toLowerCase())
    .replace(/\bM\/S\b/gi, "M/s")
    .replace(/\bOrs\b/g, "Ors.");
}

export function JudgeLinks({ judges, className }: { judges: JudgeRef[]; className?: string }) {
  const list = judges.map((j) => j.hc_judges).filter(Boolean) as { id: string; name: string }[];
  if (!list.length) return null;
  return (
    <span className={cn("flex flex-wrap gap-1.5", className)}>
      {list.map((j) => (
        <Link
          key={j.id}
          href={`/high-court/judges/${j.id}`}
          onClick={(e) => e.stopPropagation()}
          className="rounded-[6px] border border-hairline bg-tint px-1.5 py-[1px] text-[12px] text-foreground transition-colors hover:border-accent/40 hover:text-accentSoft"
        >
          {shortJudge(j.name)}
        </Link>
      ))}
    </span>
  );
}
