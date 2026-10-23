"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Search, UserRound } from "lucide-react";
import { Badge, Card, Empty, Input, PageHeader, Select, Skeleton } from "@/components/ui";
import { SetupNotice, fmtDate, getJson } from "../../district/ui";
import { shortJudge } from "../ui";

export type JudgeRow = {
  id: string;
  code: string;
  name: string;
  sitting: boolean;
  judgments: number;
  latest_order: string | null;
  earliest_order: string | null;
  case_types: string[] | null;
};

export function JudgesBoard() {
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("judgments");
  const [data, setData] = useState<JudgeRow[] | null>(null);
  const [error, setError] = useState<{ message: string; setup?: boolean } | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setQuery(q), 250);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const p = new URLSearchParams({ sort });
    if (query) p.set("q", query);
    getJson<{ judges: JudgeRow[] }>(`/api/high-court/judges?${p}`)
      .then((b) => (setData(b.judges), setError(null)))
      .catch((e) => setError({ message: e.message, setup: e.setup }));
  }, [query, sort]);

  return (
    <>
      <PageHeader eyebrow="High Court of Delhi" title="Judges" subtitle="Every sitting judge, with how many of their judgments are captured, which case types, and the span of dates." />
      {error?.setup ? (
        <SetupNotice message={error.message} />
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="flex flex-wrap items-center gap-2 border-b border-hairline p-3">
            <div className="relative min-w-[220px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a judge" className="h-9 pl-8" />
            </div>
            <Select value={sort} onChange={(e) => setSort(e.target.value)} className="h-9 !w-auto">
              <option value="judgments">Most judgments</option>
              <option value="name">Name A–Z</option>
            </Select>
          </div>
          {error ? (
            <div className="p-6 text-[13px] text-dangerSoft">{error.message}</div>
          ) : !data ? (
            <div className="space-y-2 p-3">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-12" />
              ))}
            </div>
          ) : !data.length ? (
            <Empty icon={<UserRound className="h-6 w-6" />} title="No judges yet" body="They appear once a High Court run has started." />
          ) : (
            <ul>
              {data.map((j) => (
                <li key={j.id}>
                  <Link
                    href={`/high-court/judges/${j.id}`}
                    className="grid grid-cols-1 gap-1.5 border-b border-hairline px-4 py-3 transition-colors last:border-b-0 hover:bg-tint md:grid-cols-[1fr_100px_1fr_170px] md:items-center md:gap-4"
                  >
                    <span className="flex items-center gap-2 text-[13.5px] font-medium text-foreground">
                      {shortJudge(j.name)}
                      {!j.sitting && <Badge tone="muted">Former</Badge>}
                    </span>
                    <span className="text-[13px] text-foreground md:text-right">{j.judgments}</span>
                    <span className="flex flex-wrap gap-1">
                      {(j.case_types ?? []).slice(0, 4).map((t) => (
                        <Badge key={t} tone="muted">
                          {t}
                        </Badge>
                      ))}
                      {(j.case_types?.length ?? 0) > 4 && <span className="text-[11px] text-faint">+{(j.case_types?.length ?? 0) - 4}</span>}
                    </span>
                    <span className="text-[12px] text-dim">{j.latest_order ? `${fmtDate(j.earliest_order)} – ${fmtDate(j.latest_order)}` : "—"}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </>
  );
}
