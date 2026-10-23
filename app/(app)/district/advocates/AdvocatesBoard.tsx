"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Search, Users } from "lucide-react";
import { Badge, Button, Card, Empty, Input, PageHeader, Select, Skeleton } from "@/components/ui";
import { SetupNotice, fmtDate, getJson, titleName } from "../ui";

export type AdvocateRow = {
  advocate_key: string;
  name: string;
  cases: number;
  for_petitioner: number;
  for_respondent: number;
  pending: number;
  case_types: string[] | null;
  latest_next_hearing: string | null;
  latest_registration: string | null;
};

const nf = new Intl.NumberFormat("en-IN");
const PER = 50;

export function AdvocatesBoard() {
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("cases");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ advocates: AdvocateRow[]; total: number } | null>(null);
  const [error, setError] = useState<{ message: string; setup?: boolean } | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(q);
      setPage(1);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const mine = ++seq.current;
    const p = new URLSearchParams({ sort, page: String(page), per: String(PER) });
    if (query) p.set("q", query);
    getJson<{ advocates: AdvocateRow[]; total: number }>(`/api/district/advocates?${p}`)
      .then((b) => mine === seq.current && (setData(b), setError(null)))
      .catch((e) => mine === seq.current && setError({ message: e.message, setup: e.setup }));
  }, [query, sort, page]);

  const pages = data ? Math.max(1, Math.ceil(data.total / PER)) : 1;

  return (
    <>
      <PageHeader
        eyebrow="South Delhi District Court · Saket Court Complex"
        title="Advocates"
        subtitle="Every advocate on record in the cases read so far — how many matters they carry, for which side, and when they are next in court."
      />

      {error?.setup ? (
        <SetupNotice message={error.message} />
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="flex flex-wrap items-center gap-2 border-b border-hairline p-3">
            <div className="relative min-w-[220px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find an advocate" className="h-9 pl-8" />
            </div>
            <Select value={sort} onChange={(e) => setSort(e.target.value)} className="h-9 !w-auto">
              <option value="cases">Most cases</option>
              <option value="name">Name A–Z</option>
              <option value="next">Latest next hearing</option>
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
          ) : !data.advocates.length ? (
            <Empty icon={<Users className="h-6 w-6" />} title={query ? "No advocate by that name" : "No advocates yet"} body={query ? undefined : "They appear as case pages are read."} />
          ) : (
            <>
              <div className="hidden grid-cols-[1fr_90px_150px_1fr_130px] gap-4 border-b border-hairline px-4 py-2 md:grid">
                <span className="cc-label">Advocate</span>
                <span className="cc-label text-right">Cases</span>
                <span className="cc-label">For</span>
                <span className="cc-label">Case types</span>
                <span className="cc-label">Next in court</span>
              </div>
              <ul>
                {data.advocates.map((a) => (
                  <li key={a.advocate_key}>
                    <Link
                      href={`/district/advocates/${encodeURIComponent(a.advocate_key)}`}
                      className="grid grid-cols-1 gap-1.5 border-b border-hairline px-4 py-3 transition-colors last:border-b-0 hover:bg-tint md:grid-cols-[1fr_90px_150px_1fr_130px] md:items-center md:gap-4"
                    >
                      <span className="text-[13.5px] font-medium text-foreground">{titleName(a.name)}</span>
                      <span className="text-[13px] text-foreground md:text-right">
                        {nf.format(a.cases)}
                        {a.pending > 0 && <span className="ml-1 text-[11.5px] text-faint">({a.pending} pending)</span>}
                      </span>
                      <span className="text-[12px] text-dim">
                        {a.for_petitioner > 0 && `${a.for_petitioner} petitioner`}
                        {a.for_petitioner > 0 && a.for_respondent > 0 && " · "}
                        {a.for_respondent > 0 && `${a.for_respondent} respondent`}
                      </span>
                      <span className="flex flex-wrap gap-1">
                        {(a.case_types ?? []).slice(0, 4).map((t) => (
                          <Badge key={t} tone="muted">
                            {t}
                          </Badge>
                        ))}
                        {(a.case_types?.length ?? 0) > 4 && <span className="text-[11px] text-faint">+{(a.case_types?.length ?? 0) - 4}</span>}
                      </span>
                      <span className="text-[12.5px] text-dim">{fmtDate(a.latest_next_hearing)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
              <div className="flex items-center justify-between border-t border-hairline px-4 py-2.5">
                <span className="text-[12px] text-faint">{nf.format(data.total)} advocates</span>
                <div className="flex items-center gap-1.5">
                  <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => setPage(page - 1)} icon={<ChevronLeft className="h-3.5 w-3.5" />}>
                    Prev
                  </Button>
                  <span className="cc-mono text-faint">
                    {page} / {pages}
                  </span>
                  <Button size="sm" variant="ghost" disabled={page >= pages} onClick={() => setPage(page + 1)}>
                    Next <ChevronRight className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </Card>
      )}
    </>
  );
}
