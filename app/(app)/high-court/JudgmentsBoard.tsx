"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, FileText, Radio, ScrollText, Search, Sparkles, UserRound } from "lucide-react";
import { Badge, Button, Card, Empty, Input, PageHeader, Select, Skeleton, Stat } from "@/components/ui";
import { SetupNotice, fmtDate, getJson } from "../district/ui";
import { JudgeLinks, titleCase, type JudgmentListItem } from "./ui";

type Stats = { judgments: number; judges: number; case_types: number; summaries: number; texts: number; pdfs: number };
type Facet = { code: string; name: string; count: number };
export type JudgmentFilters = { q: string; type: string; year: string; sort: string; page: number };

const nf = new Intl.NumberFormat("en-IN");

export function JudgmentsBoard({ initial }: { initial: JudgmentFilters }) {
  const [f, setF] = useState<JudgmentFilters>(initial);
  const [stats, setStats] = useState<Stats | null>(null);
  const [types, setTypes] = useState<Facet[]>([]);
  const [setup, setSetup] = useState<string | null>(null);
  const change = useCallback((p: Partial<JudgmentFilters>) => setF((s) => ({ ...s, ...p, page: p.page ?? 1 })), []);

  useEffect(() => {
    getJson<{ stats: Stats; types: Facet[] }>("/api/high-court/stats")
      .then((b) => {
        setStats(b.stats);
        setTypes(b.types);
      })
      .catch((e) => (e.setup ? setSetup(e.message) : null));
  }, []);

  useEffect(() => {
    const p = new URLSearchParams();
    if (f.q) p.set("q", f.q);
    if (f.type) p.set("type", f.type);
    if (f.year) p.set("year", f.year);
    if (f.sort !== "newest") p.set("sort", f.sort);
    if (f.page > 1) p.set("page", String(f.page));
    const qs = p.toString();
    window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
  }, [f]);

  const header = (
    <PageHeader
      eyebrow="High Court of Delhi"
      title="Judgments"
      subtitle="Judgments and orders of the sitting judges, read from the High Court's judgment search — each with its case type, citation, full text, PDF and a one-click summary."
      actions={
        <Link href="/capture?court=highcourt">
          <Button variant="secondary" icon={<Radio className="h-3.5 w-3.5" />}>
            Capture
          </Button>
        </Link>
      }
    />
  );

  if (setup)
    return (
      <>
        {header}
        <SetupNotice message={setup} />
      </>
    );

  return (
    <>
      {header}
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        {stats ? (
          <>
            <Stat label="Judgments" value={nf.format(stats.judgments)} delta={`${nf.format(stats.texts)} with full text`} icon={<ScrollText className="h-3.5 w-3.5" />} />
            <Stat label="Judges" value={nf.format(stats.judges)} delta="with judgments captured" icon={<UserRound className="h-3.5 w-3.5" />} />
            <Stat label="Case types" value={nf.format(stats.case_types)} delta="from the court's own codes" icon={<FileText className="h-3.5 w-3.5" />} />
            <Stat label="AI summaries" value={nf.format(stats.summaries)} delta="written once, kept" icon={<Sparkles className="h-3.5 w-3.5" />} />
          </>
        ) : (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[104px]" />)
        )}
      </div>
      <JudgmentList filters={f} onChange={change} types={types} />
    </>
  );
}

/** The filterable judgment list. Also used on a judge's page, pinned to that judge. */
export function JudgmentList({
  filters,
  onChange,
  types,
  judge,
}: {
  filters: JudgmentFilters;
  onChange: (p: Partial<JudgmentFilters>) => void;
  types: Facet[];
  judge?: string;
}) {
  const router = useRouter();
  const [data, setData] = useState<{ judgments: JudgmentListItem[]; total: number; per: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState(filters.q);
  const seq = useRef(0);

  useEffect(() => {
    const mine = ++seq.current;
    const p = new URLSearchParams({ sort: filters.sort, page: String(filters.page), per: "25" });
    if (filters.q) p.set("q", filters.q);
    if (filters.type) p.set("type", filters.type);
    if (filters.year) p.set("year", filters.year);
    if (judge) p.set("judge", judge);
    getJson<{ judgments: JudgmentListItem[]; total: number; per: number }>(`/api/high-court/judgments?${p}`)
      .then((b) => mine === seq.current && (setData(b), setError(null)))
      .catch((e) => mine === seq.current && setError(e.message));
  }, [filters, judge]);

  useEffect(() => {
    if (q === filters.q) return;
    const t = setTimeout(() => onChange({ q }), 300);
    return () => clearTimeout(t);
  }, [q, filters.q, onChange]);

  const pages = data ? Math.max(1, Math.ceil(data.total / data.per)) : 1;
  const years = Array.from({ length: 12 }, (_, i) => String(new Date().getFullYear() - i));

  return (
    <Card className="overflow-hidden p-0">
      <div className="flex flex-wrap items-center gap-2 border-b border-hairline p-3">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Party, case number, citation or words in the judgment" className="h-9 pl-8" />
        </div>
        {types.length > 0 && (
          <Select value={filters.type} onChange={(e) => onChange({ type: e.target.value })} className="h-9 !w-auto min-w-[150px]">
            <option value="">All case types</option>
            {types.map((t) => (
              <option key={t.code} value={t.code}>
                {t.name} ({t.count})
              </option>
            ))}
          </Select>
        )}
        <Select value={filters.year} onChange={(e) => onChange({ year: e.target.value })} className="h-9 !w-auto">
          <option value="">Any year</option>
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </Select>
        <Select value={filters.sort} onChange={(e) => onChange({ sort: e.target.value })} className="h-9 !w-auto">
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="added">Recently captured</option>
        </Select>
      </div>

      {error ? (
        <div className="p-6 text-[13px] text-dangerSoft">{error}</div>
      ) : !data ? (
        <div className="space-y-2 p-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-[70px]" />
          ))}
        </div>
      ) : !data.judgments.length ? (
        <Empty
          icon={<ScrollText className="h-6 w-6" />}
          title={filters.q || filters.type || filters.year ? "No judgments match" : "No judgments yet"}
          body={filters.q || filters.type || filters.year ? "Try a wider search." : "Start a High Court run on the Capture page; the extension reads the judgments in."}
        />
      ) : (
        <>
          <div className="hidden grid-cols-[110px_190px_1fr_120px] gap-4 border-b border-hairline px-4 py-2 md:grid">
            <span className="cc-label">Date</span>
            <span className="cc-label">Case</span>
            <span className="cc-label">Parties and bench</span>
            <span className="cc-label text-right">Ready</span>
          </div>
          <ul>
            {data.judgments.map((j) => (
              <li
                key={j.id}
                role="link"
                tabIndex={0}
                onClick={() => router.push(`/high-court/${j.id}`)}
                onKeyDown={(e) => e.key === "Enter" && router.push(`/high-court/${j.id}`)}
                className="grid cursor-pointer grid-cols-1 gap-2 border-b border-hairline px-4 py-3 transition-colors last:border-b-0 hover:bg-tint md:grid-cols-[110px_190px_1fr_120px] md:gap-4"
              >
                <div className="text-[12.5px] font-medium text-foreground">{fmtDate(j.order_date)}</div>
                <div className="min-w-0">
                  <div className="cc-mono truncate text-[12.5px] text-foreground">{j.case_no}</div>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {j.case_type && <Badge tone="muted">{j.case_type}</Badge>}
                    {j.neutral_citation && <span className="cc-mono text-[11px] text-faint">{j.neutral_citation}</span>}
                  </div>
                </div>
                <div className="min-w-0">
                  <div className="truncate text-[13.5px] font-medium text-foreground">
                    {titleCase(j.petitioner)} <span className="text-faint">vs</span> {titleCase(j.respondent)}
                  </div>
                  <JudgeLinks judges={j.judges} className="mt-1.5" />
                </div>
                <div className="flex items-center gap-1.5 md:justify-end">
                  {j.summary_at && <Badge tone="info">Summary</Badge>}
                  {j.pdf_path ? <Badge tone="neutral">PDF</Badge> : null}
                  {j.body_text_present ? <Badge tone="neutral">Text</Badge> : null}
                </div>
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between border-t border-hairline px-4 py-2.5">
            <span className="text-[12px] text-faint">
              {nf.format(data.total)} judgment{data.total === 1 ? "" : "s"}
            </span>
            <div className="flex items-center gap-1.5">
              <Button size="sm" variant="ghost" disabled={filters.page <= 1} onClick={() => onChange({ page: filters.page - 1 })} icon={<ChevronLeft className="h-3.5 w-3.5" />}>
                Prev
              </Button>
              <span className="cc-mono text-faint">
                {filters.page} / {pages}
              </span>
              <Button size="sm" variant="ghost" disabled={filters.page >= pages} onClick={() => onChange({ page: filters.page + 1 })}>
                Next <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </>
      )}
    </Card>
  );
}
