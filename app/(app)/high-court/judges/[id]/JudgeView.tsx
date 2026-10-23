"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, UserRound } from "lucide-react";
import { Badge, Card, Skeleton, Stat } from "@/components/ui";
import { fmtDate, getJson } from "../../../district/ui";
import { JudgmentList, type JudgmentFilters } from "../../JudgmentsBoard";
import { shortJudge } from "../../ui";
import type { JudgeRow } from "../JudgesBoard";

export function JudgeView({ id }: { id: string }) {
  const [j, setJ] = useState<JudgeRow | null | undefined>(undefined);
  const [f, setF] = useState<JudgmentFilters>({ q: "", type: "", year: "", sort: "newest", page: 1 });
  const change = useCallback((p: Partial<JudgmentFilters>) => setF((s) => ({ ...s, ...p, page: p.page ?? 1 })), []);

  useEffect(() => {
    getJson<{ judges: JudgeRow[] }>(`/api/high-court/judges?id=${encodeURIComponent(id)}`)
      .then((b) => setJ(b.judges[0] ?? null))
      .catch(() => setJ(null));
  }, [id]);

  return (
    <div className="mx-auto max-w-[1180px]">
      <Link href="/high-court/judges" className="mb-4 inline-flex items-center gap-1.5 text-[12.5px] text-dim hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> Judges
      </Link>
      {j === undefined ? (
        <Skeleton className="mb-6 h-24" />
      ) : j === null ? (
        <Card className="mb-6 p-6 text-[13px] text-dim">No judge on record with that id.</Card>
      ) : (
        <>
          <div className="mb-6 flex items-start gap-4">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-hairline bg-raised">
              <UserRound className="h-5 w-5 text-accent" />
            </span>
            <div className="min-w-0">
              <div className="cc-label">{j.sitting ? "Sitting judge · High Court of Delhi" : "Judge · High Court of Delhi"}</div>
              <h1 className="mt-1 text-[26px] font-semibold leading-tight tracking-[-0.02em] text-foreground">Justice {shortJudge(j.name)}</h1>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {(j.case_types ?? []).map((t) => (
                  <Badge key={t} tone="muted">
                    {t}
                  </Badge>
                ))}
              </div>
            </div>
          </div>
          <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3">
            <Stat label="Judgments captured" value={j.judgments} />
            <Stat label="Earliest" value={<span className="text-[20px]">{fmtDate(j.earliest_order)}</span>} />
            <Stat label="Latest" value={<span className="text-[20px]">{fmtDate(j.latest_order)}</span>} />
          </div>
        </>
      )}
      <div className="cc-label mb-2">Judgments</div>
      <JudgmentList filters={f} onChange={change} types={[]} judge={id} />
    </div>
  );
}
