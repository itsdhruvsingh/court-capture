"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, UserRound } from "lucide-react";
import { Badge, Card, Skeleton, Stat } from "@/components/ui";
import { CaseList, type CaseFilters } from "../../CasesBoard";
import { fmtDate, getJson, relDays, titleName } from "../../ui";
import type { AdvocateRow } from "../AdvocatesBoard";

export function AdvocateView({ advocateKey }: { advocateKey: string }) {
  const [a, setA] = useState<AdvocateRow | null | undefined>(undefined);
  const [f, setF] = useState<CaseFilters>({ q: "", type: "", status: "", sort: "newest", page: 1 });
  const change = useCallback((p: Partial<CaseFilters>) => setF((s) => ({ ...s, ...p, page: p.page ?? 1 })), []);

  useEffect(() => {
    getJson<{ advocates: AdvocateRow[] }>(`/api/district/advocates?key=${encodeURIComponent(advocateKey)}`)
      .then((b) => setA(b.advocates[0] ?? null))
      .catch(() => setA(null));
  }, [advocateKey]);

  return (
    <div className="mx-auto max-w-[1180px]">
      <Link href="/district/advocates" className="mb-4 inline-flex items-center gap-1.5 text-[12.5px] text-dim hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> Advocates
      </Link>

      {a === undefined ? (
        <Skeleton className="mb-6 h-24" />
      ) : a === null ? (
        <Card className="mb-6 p-6 text-[13px] text-dim">No case on record names this advocate yet.</Card>
      ) : (
        <>
          <div className="mb-6 flex items-start gap-4">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-hairline bg-raised">
              <UserRound className="h-5 w-5 text-accent" />
            </span>
            <div className="min-w-0">
              <div className="cc-label">Advocate</div>
              <h1 className="mt-1 text-[26px] font-semibold leading-tight tracking-[-0.02em] text-foreground">{titleName(a.name)}</h1>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {(a.case_types ?? []).map((t) => (
                  <Badge key={t} tone="muted">
                    {t}
                  </Badge>
                ))}
              </div>
            </div>
          </div>
          <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Cases" value={a.cases} delta={`${a.pending} pending`} />
            <Stat label="For petitioners" value={a.for_petitioner} />
            <Stat label="For respondents" value={a.for_respondent} />
            <Stat
              label="Latest listed date"
              value={<span className="text-[20px]">{fmtDate(a.latest_next_hearing)}</span>}
              delta={a.latest_next_hearing ? relDays(a.latest_next_hearing) : "No date fixed"}
            />
          </div>
        </>
      )}

      <div className="mb-2 cc-label">Cases</div>
      <CaseList filters={f} onChange={change} types={[]} advocate={advocateKey} compact />
    </div>
  );
}
