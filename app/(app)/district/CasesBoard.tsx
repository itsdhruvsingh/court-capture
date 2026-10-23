"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarClock, ChevronLeft, ChevronRight, FileText, Gavel, Landmark, Search, Sparkles, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button, Card, Empty, Input, PageHeader, Select, Skeleton, Stat } from "@/components/ui";
import {
  AdvocateLinks,
  CaseStatusBadge,
  SetupNotice,
  daysFromToday,
  fmtDate,
  getJson,
  relDays,
  type CaseListItem,
} from "./ui";

type Stats = { cases: number; fetched: number; advocates: number; orders: number; summaries: number; upcoming: number };
type Facet = { code: string; name: string; count: number };

const nf = new Intl.NumberFormat("en-IN");

export type CaseFilters = { q: string; type: string; status: string; sort: string; page: number };

export function CasesBoard({ initial }: { initial: CaseFilters }) {
  const [f, setF] = useState<CaseFilters>(initial);
  const [stats, setStats] = useState<Stats | null>(null);
  const [types, setTypes] = useState<Facet[]>([]);
  const [setup, setSetup] = useState<string | null>(null);
  const change = useCallback((p: Partial<CaseFilters>) => setF((s) => ({ ...s, ...p, page: p.page ?? 1 })), []);

  useEffect(() => {
    getJson<{ stats: Stats; types: Facet[] }>("/api/district/stats")
      .then((b) => {
        setStats(b.stats);
        setTypes(b.types);
      })
      .catch((e) => (e.setup ? setSetup(e.message) : null));
  }, []);

  // Keep the URL in step so a filtered view can be shared or reloaded.
  useEffect(() => {
    const p = new URLSearchParams();
    if (f.q) p.set("q", f.q);
    if (f.type) p.set("type", f.type);
    if (f.status) p.set("status", f.status);
    if (f.sort !== "newest") p.set("sort", f.sort);
    if (f.page > 1) p.set("page", String(f.page));
    const qs = p.toString();
    window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
  }, [f]);

  if (setup) {
    return (
      <>
        <Header />
        <SetupNotice message={setup} />
      </>
    );
  }

  return (
    <>
      <Header />

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-5">
        {stats ? (
          <>
            <Stat label="Cases" value={nf.format(stats.cases)} delta={`${nf.format(stats.fetched)} with full details`} icon={<Landmark className="h-3.5 w-3.5" />} />
            <Stat label="Advocates" value={nf.format(stats.advocates)} delta="on record across cases" icon={<Users className="h-3.5 w-3.5" />} />
            <Stat label="Orders" value={nf.format(stats.orders)} delta="interim and final" icon={<FileText className="h-3.5 w-3.5" />} />
            <Stat label="AI summaries" value={nf.format(stats.summaries)} delta="written once, kept" icon={<Sparkles className="h-3.5 w-3.5" />} />
            <Stat label="Upcoming hearings" value={nf.format(stats.upcoming)} delta="next date today or later" icon={<CalendarClock className="h-3.5 w-3.5" />} />
          </>
        ) : (
          Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-[104px]" />)
        )}
      </div>

      <CaseList filters={f} onChange={change} types={types} />
    </>
  );
}

function Header() {
  return (
    <PageHeader
      eyebrow="South Delhi District Court · Saket Court Complex"
      title="District court cases"
      subtitle="Cases read from the eCourts district site — who appears for whom, every hearing, and every order with a summary you can read in a minute."
      actions={
        <Link href="/capture">
          <Button variant="secondary" icon={<Gavel className="h-3.5 w-3.5" />}>
            Capture
          </Button>
        </Link>
      }
    />
  );
}

/** The filterable case list. Also used on an advocate's page, pinned to that advocate. */
export function CaseList({
  filters,
  onChange,
  types,
  advocate,
  compact,
}: {
  filters: CaseFilters;
  onChange: (p: Partial<CaseFilters>) => void;
  types: Facet[];
  advocate?: string;
  compact?: boolean;
}) {
  const router = useRouter();
  const [data, setData] = useState<{ cases: CaseListItem[]; total: number; per: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState(filters.q);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    const p = new URLSearchParams({ sort: filters.sort, page: String(filters.page), per: "25" });
    if (filters.q) p.set("q", filters.q);
    if (filters.type) p.set("type", filters.type);
    if (filters.status) p.set("status", filters.status);
    if (advocate) p.set("advocate", advocate);
    try {
      const b = await getJson<{ cases: CaseListItem[]; total: number; per: number }>(`/api/district/cases?${p}`);
      if (mine === seq.current) {
        setData(b);
        setError(null);
      }
    } catch (e) {
      if (mine === seq.current) setError(e instanceof Error ? e.message : "Could not load cases.");
    }
  }, [filters, advocate]);

  useEffect(() => {
    load();
  }, [load]);

  // Debounced search box.
  useEffect(() => {
    if (q === filters.q) return;
    const t = setTimeout(() => onChange({ q }), 300);
    return () => clearTimeout(t);
  }, [q, filters.q, onChange]);

  const pages = data ? Math.max(1, Math.ceil(data.total / data.per)) : 1;
  const typeOptions = useMemo(() => types.filter((t) => t.count > 0), [types]);

  return (
    <Card className="overflow-hidden p-0">
      <div className="flex flex-wrap items-center gap-2 border-b border-hairline p-3">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={advocate ? "Search this advocate's cases" : "Party, advocate, case number or CNR"}
            className="h-9 pl-8"
          />
        </div>
        {!compact && (
          <Select value={filters.type} onChange={(e) => onChange({ type: e.target.value })} className="h-9 !w-auto min-w-[160px]">
            <option value="">All case types</option>
            {typeOptions.map((t) => (
              <option key={t.code} value={t.code}>
                {t.name} ({t.count})
              </option>
            ))}
          </Select>
        )}
        <Select value={filters.status} onChange={(e) => onChange({ status: e.target.value })} className="h-9 !w-auto">
          <option value="">Any status</option>
          <option value="pending">Pending</option>
          <option value="disposed">Disposed</option>
          {!compact && <option value="listed">Details not read yet</option>}
        </Select>
        <Select value={filters.sort} onChange={(e) => onChange({ sort: e.target.value })} className="h-9 !w-auto">
          <option value="newest">Newest cases</option>
          <option value="next">Next hearing soonest</option>
          <option value="updated">Recently read</option>
        </Select>
      </div>

      {error ? (
        <div className="p-6 text-[13px] text-dangerSoft">{error}</div>
      ) : !data ? (
        <div className="space-y-2 p-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-[74px]" />
          ))}
        </div>
      ) : !data.cases.length ? (
        <Empty
          icon={<Landmark className="h-6 w-6" />}
          title={filters.q || filters.type || filters.status ? "No cases match" : "No cases yet"}
          body={filters.q || filters.type || filters.status ? "Try a wider search." : "Start a district run on the Capture page; the extension reads the cases in."}
        />
      ) : (
        <>
          <div className="hidden grid-cols-[150px_1fr_150px_120px] gap-4 border-b border-hairline px-4 py-2 md:grid">
            <span className="cc-label">Case</span>
            <span className="cc-label">Parties and advocates</span>
            <span className="cc-label">Next hearing</span>
            <span className="cc-label text-right">Orders</span>
          </div>
          <ul>
            {data.cases.map((c) => (
              <CaseRow key={c.id} c={c} onOpen={() => router.push(`/district/${c.id}`)} />
            ))}
          </ul>
          <div className="flex items-center justify-between border-t border-hairline px-4 py-2.5">
            <span className="text-[12px] text-faint">
              {nf.format(data.total)} case{data.total === 1 ? "" : "s"}
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

function CaseRow({ c, onOpen }: { c: CaseListItem; onOpen: () => void }) {
  const orders = c.orders?.[0]?.count ?? 0;
  const days = daysFromToday(c.next_hearing_date);
  const soon = days !== null && days >= 0 && days <= 7;
  return (
    <li
      role="link"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => e.key === "Enter" && onOpen()}
      className="grid cursor-pointer grid-cols-1 gap-2 border-b border-hairline px-4 py-3 transition-colors last:border-b-0 hover:bg-tint md:grid-cols-[150px_1fr_150px_120px] md:gap-4"
    >
      <div className="min-w-0">
        <div className="cc-mono truncate text-[12.5px] text-foreground">{c.case_number ?? c.cnr}</div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <CaseStatusBadge status={c.status} detail={c.detail_status} />
        </div>
      </div>

      <div className="min-w-0">
        <div className="truncate text-[13.5px] font-medium text-foreground">{c.masked ? "Names withheld by the court" : c.title ?? "—"}</div>
        {c.detail_status === "fetched" ? (
          <div className="mt-1.5 grid gap-1 text-[12px] sm:grid-cols-2">
            <div className="flex min-w-0 items-start gap-1.5">
              <span className="mt-[3px] shrink-0 text-[10.5px] uppercase tracking-wide text-faint">Pet.</span>
              <AdvocateLinks parties={c.petitioners} max={2} />
            </div>
            <div className="flex min-w-0 items-start gap-1.5">
              <span className="mt-[3px] shrink-0 text-[10.5px] uppercase tracking-wide text-faint">Res.</span>
              <AdvocateLinks parties={c.respondents} max={2} />
            </div>
          </div>
        ) : (
          <div className="mt-1 text-[12px] text-faint">Advocates appear once the case page has been read.</div>
        )}
      </div>

      <div className="text-[12.5px]">
        {c.status === "disposed" ? (
          <span className="text-dim">Decided {fmtDate(c.decision_date)}</span>
        ) : c.next_hearing_date ? (
          <>
            <div className={cn("font-medium", soon ? "text-accentSoft" : "text-foreground")}>{fmtDate(c.next_hearing_date)}</div>
            <div className="text-[11.5px] text-faint">
              {relDays(c.next_hearing_date)}
              {c.stage ? ` · ${c.stage}` : ""}
            </div>
          </>
        ) : (
          <span className="text-faint">—</span>
        )}
      </div>

      <div className="flex items-center gap-1.5 text-[12.5px] text-dim md:justify-end">
        <FileText className="h-3.5 w-3.5 text-faint" />
        {orders}
      </div>
    </li>
  );
}
