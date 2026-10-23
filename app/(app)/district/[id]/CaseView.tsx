"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowDownUp, ArrowLeft, CalendarClock, Gavel, Scale, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge, Button, Card, CopyButton, Skeleton } from "@/components/ui";
import {
  CaseStatusBadge,
  SetupNotice,
  advocateHref,
  partyExtraLines,
  daysFromToday,
  fmtDate,
  getJson,
  relDays,
  titleName,
  type CaseListItem,
  type HearingView,
  type OrderView,
  type PartyView,
} from "../ui";
import { OrderCard } from "./OrderCard";

type CaseFull = CaseListItem & {
  case_type_full: string | null;
  filing_number: string | null;
  filing_date: string | null;
  first_hearing_date: string | null;
  nature_of_disposal: string | null;
  acts: { act: string; sections: string }[];
  fir: Record<string, string> | null;
  extra: { caption: string; headers: string[]; rows: Record<string, string>[] }[];
};

type Payload = { case: CaseFull; hearings: HearingView[]; orders: OrderView[] };

export function CaseView({ id }: { id: string }) {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<{ message: string; setup?: boolean } | null>(null);

  useEffect(() => {
    getJson<Payload>(`/api/district/cases/${id}`)
      .then(setData)
      .catch((e) => setError({ message: e.message, setup: e.setup }));
  }, [id]);

  const updateOrder = useCallback((o: OrderView) => {
    setData((d) => (d ? { ...d, orders: d.orders.map((x) => (x.id === o.id ? o : x)) } : d));
  }, []);

  if (error?.setup) return <SetupNotice message={error.message} />;
  if (error) {
    return (
      <>
        <BackLink />
        <Card className="p-6 text-[13px] text-dangerSoft">{error.message}</Card>
      </>
    );
  }
  if (!data) {
    return (
      <div className="space-y-4">
        <BackLink />
        <Skeleton className="h-28" />
        <Skeleton className="h-40" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  const c = data.case;
  return (
    <div className="mx-auto max-w-[1180px]">
      <BackLink />
      <Header c={c} />
      <Facts c={c} />
      <Advocates c={c} />

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Timeline c={c} hearings={data.hearings} orders={data.orders} onOrder={updateOrder} />
        <aside className="space-y-4">
          <Acts c={c} />
          <Extra c={c} />
          <Card className="p-4 text-[12px] leading-relaxed text-faint">
            Read from the eCourts district site{c.fetched_at ? ` on ${fmtDate(c.fetched_at.slice(0, 10))}` : ""}. The court's own record is
            the authority; it can lag the orders by a few days.
          </Card>
        </aside>
      </div>
    </div>
  );
}

function BackLink() {
  return (
    <Link href="/district" className="mb-4 inline-flex items-center gap-1.5 text-[12.5px] text-dim hover:text-foreground">
      <ArrowLeft className="h-3.5 w-3.5" /> District cases
    </Link>
  );
}

function Header({ c }: { c: CaseFull }) {
  return (
    <div className="mb-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="cc-mono text-[13px] text-dim">{c.case_number ?? "—"}</span>
        <CaseStatusBadge status={c.status} detail={c.detail_status} />
        {c.case_type_full && <Badge tone="muted">{c.case_type_full}</Badge>}
      </div>
      <h1 className="mt-2 text-[24px] font-semibold leading-tight tracking-[-0.02em] text-foreground md:text-[28px]">
        {c.masked ? "Names withheld by the court" : c.title}
      </h1>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-dim">
        <span>{c.establishment}</span>
        {c.court_judge && (
          <>
            <span className="text-faint">·</span>
            <span className="flex items-center gap-1">
              <Gavel className="h-3 w-3 text-faint" />
              {c.court_judge}
            </span>
          </>
        )}
        <span className="text-faint">·</span>
        <span className="flex items-center gap-1.5">
          <span className="cc-mono">CNR {c.cnr}</span>
          <CopyButton text={c.cnr} label="Copy" className="h-6 px-2 text-[11px]" />
        </span>
      </div>
    </div>
  );
}

function Facts({ c }: { c: CaseFull }) {
  const days = daysFromToday(c.next_hearing_date);
  const items: { label: string; value: string; sub?: string; accent?: boolean }[] = [
    { label: "Filed", value: fmtDate(c.filing_date), sub: c.filing_number ? `No. ${c.filing_number}` : undefined },
    { label: "Registered", value: fmtDate(c.registration_date), sub: c.case_number ?? undefined },
    { label: "First hearing", value: fmtDate(c.first_hearing_date) },
    c.status === "disposed"
      ? { label: "Decided", value: fmtDate(c.decision_date), sub: c.nature_of_disposal ?? undefined }
      : {
          label: "Next hearing",
          value: fmtDate(c.next_hearing_date),
          sub: c.next_hearing_date ? relDays(c.next_hearing_date) : undefined,
          accent: days !== null && days >= 0 && days <= 14,
        },
    { label: "Stage", value: c.stage ?? "—" },
  ];
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[12px] border border-hairline bg-hairline md:grid-cols-5">
      {items.map((it) => (
        <div key={it.label} className="bg-panel px-4 py-3">
          <div className="cc-label">{it.label}</div>
          <div className={cn("mt-1 text-[14px] font-medium", it.accent ? "text-accentSoft" : "text-foreground")}>{it.value}</div>
          {it.sub && <div className="mt-0.5 truncate text-[11.5px] text-faint">{it.sub}</div>}
        </div>
      ))}
    </div>
  );
}

/** Who appears for whom — the first thing on the page after the facts. */
function Advocates({ c }: { c: CaseFull }) {
  const sides: { key: string; label: string; parties: PartyView[] }[] = [
    { key: "pet", label: "Petitioner side", parties: c.petitioners },
    { key: "res", label: "Respondent side", parties: c.respondents },
  ];
  return (
    <Card className="mt-6 p-0">
      <div className="flex items-center gap-2 border-b border-hairline px-4 py-2.5">
        <Scale className="h-3.5 w-3.5 text-accent" />
        <span className="text-[13px] font-semibold text-foreground">Parties and advocates</span>
      </div>
      <div className="grid md:grid-cols-2">
        {sides.map((side, i) => (
          <div key={side.key} className={cn("p-4", i === 1 && "border-t border-hairline md:border-l md:border-t-0")}>
            <div className="cc-label mb-2.5">{side.label}</div>
            {side.parties.length === 0 ? (
              <div className="text-[12.5px] text-faint">Not recorded.</div>
            ) : (
              <ul className="space-y-3">
                {side.parties.map((p) => (
                  <li key={p.index} className="flex gap-3">
                    <span className="cc-mono mt-0.5 w-4 shrink-0 text-faint">{p.index}</span>
                    <div className="min-w-0">
                      <div className="text-[13.5px] font-medium text-foreground">{p.name || "—"}</div>
                      {p.advocates.length ? (
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {p.advocates.map((a) => (
                            <Link
                              key={a}
                              href={advocateHref(a)}
                              className="group inline-flex items-center gap-1.5 rounded-full border border-hairline bg-tint px-2.5 py-1 text-[12.5px] text-foreground transition-colors hover:border-accent/40"
                            >
                              <UserRound className="h-3 w-3 text-faint group-hover:text-accent" />
                              {titleName(a)}
                            </Link>
                          ))}
                        </div>
                      ) : (
                        <div className="mt-1 text-[12px] text-faint">No advocate recorded</div>
                      )}
                      {partyExtraLines(p).map((l, k) => (
                        <div key={k} className="mt-1 text-[12px] text-dim">
                          {l}
                        </div>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}

// ── the timeline ──────────────────────────────────────────────────────────

type Node =
  | { kind: "next"; date: string; purpose: string | null }
  | { kind: "hearing"; date: string | null; hearing: HearingView | null; orders: OrderView[] }
  | { kind: "milestone"; date: string; label: string };

function buildTimeline(c: CaseFull, hearings: HearingView[], orders: OrderView[]): Node[] {
  const byDate = new Map<string, Extract<Node, { kind: "hearing" }>>();
  const nodes: Node[] = [];
  for (const h of hearings) {
    const key = h.business_date ?? `h${h.seq}`;
    const n = { kind: "hearing" as const, date: h.business_date, hearing: h, orders: [] as OrderView[] };
    byDate.set(key, n);
    nodes.push(n);
  }
  for (const o of orders) {
    const key = o.order_date ?? `o${o.id}`;
    const n = byDate.get(key);
    if (n) n.orders.push(o);
    else {
      const m = { kind: "hearing" as const, date: o.order_date, hearing: null, orders: [o] };
      byDate.set(key, m);
      nodes.push(m);
    }
  }
  const last = hearings[hearings.length - 1];
  if (c.status !== "disposed" && c.next_hearing_date && (daysFromToday(c.next_hearing_date) ?? -1) >= 0) {
    nodes.push({ kind: "next", date: c.next_hearing_date, purpose: last?.next_date === c.next_hearing_date ? last.purpose : c.stage });
  }
  if (c.registration_date) nodes.push({ kind: "milestone", date: c.registration_date, label: "Registered" });
  if (c.filing_date && c.filing_date !== c.registration_date) nodes.push({ kind: "milestone", date: c.filing_date, label: "Filed" });
  if (c.status === "disposed" && c.decision_date && !byDate.has(c.decision_date)) {
    nodes.push({ kind: "milestone", date: c.decision_date, label: `Decided${c.nature_of_disposal ? ` — ${c.nature_of_disposal}` : ""}` });
  }

  const rank = (n: Node) => (n.kind === "milestone" ? (n.label === "Filed" ? 0 : 1) : n.kind === "hearing" ? 2 : 3);
  return nodes.sort((a, b) => {
    const da = a.date ?? "";
    const db = b.date ?? "";
    if (da !== db) return da < db ? -1 : 1;
    return rank(a) - rank(b);
  });
}

function Timeline({
  c,
  hearings,
  orders,
  onOrder,
}: {
  c: CaseFull;
  hearings: HearingView[];
  orders: OrderView[];
  onOrder: (o: OrderView) => void;
}) {
  const [newestFirst, setNewestFirst] = useState(true);
  const nodes = useMemo(() => {
    const n = buildTimeline(c, hearings, orders);
    return newestFirst ? n.reverse() : n;
  }, [c, hearings, orders, newestFirst]);
  const summarised = orders.filter((o) => o.summary).length;

  return (
    <Card className="p-0">
      <div className="flex flex-wrap items-center gap-3 border-b border-hairline px-4 py-2.5">
        <CalendarClock className="h-3.5 w-3.5 text-accent" />
        <span className="text-[13px] font-semibold text-foreground">Case history</span>
        <span className="text-[12px] text-faint">
          {hearings.length} hearing{hearings.length === 1 ? "" : "s"} · {orders.length} order{orders.length === 1 ? "" : "s"} · {summarised} summarised
        </span>
        <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setNewestFirst((v) => !v)} icon={<ArrowDownUp className="h-3 w-3" />}>
          {newestFirst ? "Newest first" : "Oldest first"}
        </Button>
      </div>

      {c.detail_status !== "fetched" ? (
        <div className="p-6 text-[13px] text-dim">
          This case was listed in a search but its page has not been read yet. It will fill in when the scraper reaches it.
        </div>
      ) : nodes.length === 0 ? (
        <div className="p-6 text-[13px] text-dim">The court has recorded no hearings or orders yet.</div>
      ) : (
        <ol className="relative px-4 py-4">
          <span className="absolute bottom-6 left-[27px] top-6 w-px bg-hairline" aria-hidden />
          {nodes.map((n, i) => (
            <Fragment key={i}>
              <TimelineNode node={n} onOrder={onOrder} />
            </Fragment>
          ))}
        </ol>
      )}
    </Card>
  );
}

function Dot({ tone }: { tone: "accent" | "order" | "plain" | "milestone" }) {
  return (
    <span
      className={cn(
        "relative z-10 mt-1 flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border bg-panel",
        tone === "accent" && "border-accent",
        tone === "order" && "border-hairlineStrong",
        tone === "plain" && "border-hairline",
        tone === "milestone" && "border-hairline"
      )}
    >
      <span
        className={cn(
          "h-2 w-2 rounded-full",
          tone === "accent" && "cc-pulse bg-accent",
          tone === "order" && "bg-foreground",
          tone === "plain" && "bg-faint",
          tone === "milestone" && "bg-transparent ring-1 ring-faint"
        )}
      />
    </span>
  );
}

function TimelineNode({ node, onOrder }: { node: Node; onOrder: (o: OrderView) => void }) {
  if (node.kind === "next") {
    return (
      <li className="flex gap-3 pb-5">
        <Dot tone="accent" />
        <div className="min-w-0 flex-1 rounded-[10px] border border-accent/30 bg-accent/[0.06] px-3 py-2.5">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-[13.5px] font-semibold text-foreground">Next hearing · {fmtDate(node.date)}</span>
            <span className="text-[12px] text-accentSoft">{relDays(node.date)}</span>
          </div>
          {node.purpose && <div className="mt-0.5 text-[12.5px] text-dim">For {node.purpose}</div>}
        </div>
      </li>
    );
  }
  if (node.kind === "milestone") {
    return (
      <li className="flex gap-3 pb-5">
        <Dot tone="milestone" />
        <div className="pt-1 text-[12.5px] text-dim">
          <span className="font-medium text-foreground">{node.label}</span> · {fmtDate(node.date)}
        </div>
      </li>
    );
  }
  const h = node.hearing;
  return (
    <li className="flex gap-3 pb-5">
      <Dot tone={node.orders.length ? "order" : "plain"} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 pt-0.5">
          <span className="text-[13.5px] font-semibold text-foreground">{fmtDate(node.date)}</span>
          {h?.judge && <span className="text-[12px] text-dim">before {h.judge}</span>}
        </div>
        {h && (h.next_date || h.purpose) && (
          <div className="mt-0.5 text-[12.5px] text-dim">
            {h.next_date ? (
              <>
                Adjourned to <span className="text-foreground">{fmtDate(h.next_date)}</span>
                {h.purpose ? ` for ${h.purpose}` : ""}
              </>
            ) : (
              h.purpose
            )}
          </div>
        )}
        {node.orders.length > 0 && (
          <div className="mt-2 space-y-2">
            {node.orders.map((o) => (
              <OrderCard key={o.id} order={o} onChange={onOrder} />
            ))}
          </div>
        )}
      </div>
    </li>
  );
}

// ── sidebar ───────────────────────────────────────────────────────────────

function Acts({ c }: { c: CaseFull }) {
  const fir = c.fir ? Object.entries(c.fir).filter(([, v]) => v) : [];
  if (!c.acts.length && !fir.length) return null;
  return (
    <Card className="p-4">
      {c.acts.length > 0 && (
        <>
          <div className="cc-label mb-2">Acts and sections</div>
          <ul className="space-y-1.5 text-[12.5px]">
            {c.acts.map((a, i) => (
              <li key={i} className="flex justify-between gap-3">
                <span className="text-foreground">{a.act || "—"}</span>
                <span className="cc-mono shrink-0 text-dim">{a.sections ? `s. ${a.sections}` : ""}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {fir.length > 0 && (
        <div className={cn(c.acts.length > 0 && "mt-4 border-t border-hairline pt-3")}>
          <div className="cc-label mb-2">FIR</div>
          <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1 text-[12.5px]">
            {fir.map(([k, v]) => (
              <Fragment key={k}>
                <dt className="text-faint">{k}</dt>
                <dd className="text-dim">{v}</dd>
              </Fragment>
            ))}
          </dl>
        </div>
      )}
    </Card>
  );
}

function Extra({ c }: { c: CaseFull }) {
  if (!c.extra?.length) return null;
  return (
    <>
      {c.extra.map((t) => (
        <Card key={t.caption} className="p-4">
          <div className="cc-label mb-2">{t.caption}</div>
          <div className="space-y-2.5">
            {t.rows.map((r, i) => (
              <dl key={i} className={cn("grid grid-cols-[110px_1fr] gap-x-3 gap-y-0.5 text-[12px]", i > 0 && "border-t border-hairline pt-2.5")}>
                {Object.entries(r)
                  .filter(([, v]) => v)
                  .map(([k, v]) => (
                    <Fragment key={k}>
                      <dt className="text-faint">{k}</dt>
                      <dd className="text-dim">{v}</dd>
                    </Fragment>
                  ))}
              </dl>
            ))}
          </div>
        </Card>
      ))}
    </>
  );
}
