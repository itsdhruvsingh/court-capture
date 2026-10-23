"use client";

import Link from "next/link";
import { Gavel } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge, Card, Empty } from "@/components/ui";

// ── shapes the API sends ──────────────────────────────────────────────────

export type PartyView = { index: number; name: string; advocate: string | null; advocates: string[]; lines?: string[] };

/** Lines of a party entry beyond its name and advocate — an address, a note. */
export function partyExtraLines(p: PartyView): string[] {
  return (p.lines ?? []).filter((l, i) => !(i === 0 && /^\d+\s*[).]/.test(l)) && l !== p.name && !/^advocate\b/i.test(l));
}

export type CaseListItem = {
  id: string;
  cnr: string;
  case_type: string | null;
  case_type_code: string | null;
  case_number: string | null;
  case_no: number | null;
  case_year: number | null;
  title: string | null;
  petitioners: PartyView[];
  respondents: PartyView[];
  status: "pending" | "disposed" | null;
  stage: string | null;
  next_hearing_date: string | null;
  decision_date: string | null;
  registration_date: string | null;
  court_judge: string | null;
  establishment: string | null;
  detail_status: "listed" | "fetched" | "failed";
  masked: boolean;
  fetched_at: string | null;
  orders?: { count: number }[];
};

export type OrderSummaryView = {
  headline: string;
  order_type: string;
  outcome: string;
  summary: string;
  present: string[];
  directions: string[];
  key_points: string[];
  next_date: string | null;
  next_purpose: string | null;
  judge: string | null;
};

export type OrderView = {
  id: string;
  kind: "interim" | "final";
  order_no: number;
  order_date: string | null;
  label: string | null;
  source_url: string | null;
  pdf_path: string | null;
  pdf_bytes: number | null;
  pdf_error: string | null;
  summary: OrderSummaryView | null;
  summary_model: string | null;
  summary_source: string | null;
  summary_at: string | null;
  summary_by: string | null;
  summary_status: string | null;
  summary_error: string | null;
};

export type HearingView = {
  seq: number;
  judge: string | null;
  business_date: string | null;
  next_date: string | null;
  purpose: string | null;
};

// ── formatting ────────────────────────────────────────────────────────────

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-10-01" → "1 Oct 2026", from the parts so IST never shifts it. */
export function fmtDate(iso: string | null | undefined, opts?: { short?: boolean }): string {
  if (!iso) return "—";
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  const d = `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}`;
  return opts?.short ? d : `${d} ${m[1]}`;
}

export function todayIso(): string {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Whole days from today (IST) to `iso`; negative is past. */
export function daysFromToday(iso: string | null): number | null {
  if (!iso) return null;
  const a = Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
  const t = todayIso();
  const b = Date.UTC(+t.slice(0, 4), +t.slice(5, 7) - 1, +t.slice(8, 10));
  return Math.round((a - b) / 86_400_000);
}

export function relDays(iso: string | null): string {
  const d = daysFromToday(iso);
  if (d === null) return "";
  if (d === 0) return "today";
  if (d === 1) return "tomorrow";
  if (d === -1) return "yesterday";
  if (d > 0) return d < 60 ? `in ${d} days` : `in ${Math.round(d / 30)} months`;
  return -d < 60 ? `${-d} days ago` : `${Math.round(-d / 30)} months ago`;
}

export function titleName(s: string): string {
  return s
    .toLowerCase()
    .split(/\s+/)
    .map((w, i) => (i > 0 && ["of", "and", "for", "the", "in"].includes(w) ? w : w.replace(/(^|[-/(.])([a-z])/g, (_, p, c) => p + c.toUpperCase())))
    .join(" ");
}

/** Same rule as the server's advocateKey, so a click on a name finds its page. */
export function advocateKeyOf(name: string): string {
  return name
    .replace(/ /g, " ")
    .toUpperCase()
    .replace(/[.,'’`()]/g, " ")
    .replace(/\b(ADV|ADVS|ADVOCATE|ADVOCATES|SH|SHRI|MR|MRS|MS|SMT|KUMARI|KM|DR|LD|COUNSEL|SR|SENIOR)\b/g, " ")
    .replace(/[^A-Z0-9 &/-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function advocateHref(name: string) {
  return `/district/advocates/${encodeURIComponent(advocateKeyOf(name))}`;
}

// ── small pieces ──────────────────────────────────────────────────────────

export function CaseStatusBadge({ status, detail }: { status: CaseListItem["status"]; detail?: CaseListItem["detail_status"] }) {
  if (detail && detail !== "fetched") {
    return <Badge tone={detail === "failed" ? "danger" : "muted"}>{detail === "failed" ? "Details failed" : "Details pending"}</Badge>;
  }
  if (status === "disposed") return <Badge tone="neutral">Disposed</Badge>;
  if (status === "pending") return <Badge tone="ok">Pending</Badge>;
  return null;
}

/** The advocates on one side, as links to their pages. */
export function AdvocateLinks({
  parties,
  className,
  empty = "No advocate recorded",
  max = 3,
}: {
  parties: PartyView[];
  className?: string;
  empty?: string;
  max?: number;
}) {
  const names = [...new Set(parties.flatMap((p) => p.advocates))];
  if (!names.length) return <span className={cn("text-[12px] text-faint", className)}>{empty}</span>;
  const shown = names.slice(0, max);
  return (
    <span className={cn("flex flex-wrap items-center gap-x-1.5 gap-y-1", className)}>
      {shown.map((n) => (
        <Link
          key={n}
          href={advocateHref(n)}
          onClick={(e) => e.stopPropagation()}
          className="rounded-[6px] border border-hairline bg-tint px-1.5 py-[1px] text-[12px] text-foreground transition-colors hover:border-accent/40 hover:text-accentSoft"
        >
          {titleName(n)}
        </Link>
      ))}
      {names.length > max && <span className="text-[11.5px] text-faint">+{names.length - max} more</span>}
    </span>
  );
}

export function SetupNotice({ message }: { message: string }) {
  return (
    <Card className="p-0">
      <Empty icon={<Gavel className="h-6 w-6" />} title="Not set up yet" body={message} />
    </Card>
  );
}

/** fetch → JSON, with the server's error sentence on failure. */
export async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.error ?? `Request failed (${res.status}).`) as Error & { setup?: boolean; status?: number };
    err.setup = !!body.setup_required;
    err.status = res.status;
    throw err;
  }
  return body as T;
}
