"use client";

import { useEffect, useState } from "react";
import { PieChart } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, Empty, PageHeader, Select, Skeleton, Stat } from "@/components/ui";
import { BarList, nf, share } from "@/components/viz";
import { SetupNotice, getJson } from "../ui";

type Slice = { year: number; status: "P" | "D"; total: number };
type Distribution = {
  slices: Slice[];
  slice: Slice | null;
  coverage: { searched: number; codes: number };
  types: { label: string; total: number; courts: { est: string; name: string; total: number }[]; captured: number; read: number }[];
  courts: { est: string; name: string; total: number; types: number }[];
  captured: { cases: number; read: number; types: number };
};

/** "Chief Metropolitan Magistrate, South , Saket" → "Chief Metropolitan Magistrate". */
const courtName = (s: string) => s.replace(/\s*,\s*South\s*,\s*Saket\s*$/i, "").trim();
const sliceKey = (s: Slice) => `${s.year}${s.status}`;
const statusWord = (s: Slice) => (s.status === "P" ? "pending" : "disposed");

export function CaseTypesBoard() {
  const [pick, setPick] = useState("");
  const [data, setData] = useState<Distribution | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ message: string; setup?: boolean } | null>(null);

  useEffect(() => {
    setLoading(true);
    const p = new URLSearchParams();
    if (pick) {
      p.set("year", pick.slice(0, 4));
      p.set("status", pick.slice(4));
    }
    getJson<Distribution>(`/api/district/distribution?${p}`)
      .then((d) => (setData(d), setError(null)))
      .catch((e) => setError({ message: e.message, setup: e.setup }))
      .finally(() => setLoading(false));
  }, [pick]);

  const header = (
    <PageHeader
      eyebrow="South Delhi District Court · Saket Court Complex"
      title="Case types"
      subtitle="How the court's caseload splits by case type, from the court's own counts in every search the extension makes, and how much of each type is captured."
    />
  );

  if (error?.setup) return <>{header}<SetupNotice message={error.message} /></>;
  if (error) return <>{header}<Card className="p-6 text-[13px] text-dangerSoft">{error.message}</Card></>;
  if (!data) return <>{header}<Skeleton className="h-[420px]" /></>;
  if (!data.slice) {
    return (
      <>
        {header}
        <Card>
          <Empty
            icon={<PieChart className="h-6 w-6" />}
            title="No court counts yet"
            body="Every search the extension makes records the court's own count for that case type, year and status. Start the district run on the Capture page and they appear here."
          />
        </Card>
      </>
    );
  }

  const slice = data.slice;
  const top = data.types[0];
  return (
    <>
      {header}
      {/* One filter row, above everything it scopes; the last view stays on screen while the next loads. */}
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Select value={sliceKey(slice)} onChange={(e) => setPick(e.target.value)} className="h-9 !w-auto" aria-label="Year and status">
          {data.slices.map((s) => (
            <option key={sliceKey(s)} value={sliceKey(s)}>
              {s.year} · {statusWord(s)}
            </option>
          ))}
        </Select>
        <span className="text-[12px] text-faint">
          Cases registered in {slice.year} and {statusWord(slice)}, as the court counts them.
        </span>
      </div>

      <div className={cn("space-y-5 transition-opacity", loading && "opacity-60")}>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label={`${slice.status === "P" ? "Pending" : "Disposed"} cases, ${slice.year}`} value={nf.format(slice.total)} delta={`in ${data.courts.length} court${data.courts.length === 1 ? "" : "s"} at Saket`} />
          <Stat label="Case types" value={nf.format(data.types.length)} delta={`${data.coverage.searched} of ${data.coverage.codes} type codes searched`} />
          <Stat label="Largest type" value={top ? top.label : "—"} delta={top ? `${share(top.total, slice.total)} of the year's cases` : undefined} />
          <Stat label="Captured in full" value={nf.format(data.captured.read)} delta={`of ${nf.format(data.captured.cases)} cases listed, ${data.captured.types} types`} />
        </div>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
          <Card className="overflow-hidden p-0">
            <div className="border-b border-hairline px-4 py-3">
              <div className="text-[13px] font-semibold text-foreground">By case type</div>
              <div className="text-[12px] text-faint">
                {slice.year}, {statusWord(slice)} · the type printed on each case · open one to see its captured cases
              </div>
            </div>
            <BarList
              label={`Cases by case type, ${slice.year}, ${statusWord(slice)}`}
              items={data.types.map((t) => ({
                key: t.label,
                label: t.label,
                sub: t.courts.map((c) => courtName(c.name)).join(" · "),
                value: t.total,
                href: t.captured ? `/district?type=${encodeURIComponent(t.label)}` : undefined,
                note: t.read ? `${nf.format(t.read)} read` : "—",
                detail: t.captured ? `${nf.format(t.captured)} in the database, ${nf.format(t.read)} read in full` : "None captured yet",
              }))}
              total={slice.total}
              head={["Case type", "Cases"]}
              noteHead="Captured"
              limit={15}
            />
          </Card>

          <div className="space-y-5">
            <Card className="overflow-hidden p-0">
              <div className="border-b border-hairline px-4 py-3">
                <div className="text-[13px] font-semibold text-foreground">By court</div>
                <div className="text-[12px] text-faint">The same cases, by the court that holds them</div>
              </div>
              <BarList
                label={`Cases by court, ${slice.year}, ${statusWord(slice)}`}
                items={data.courts.map((c) => ({ key: c.est, label: courtName(c.name), sub: `${c.types} case type${c.types === 1 ? "" : "s"}`, value: c.total }))}
                total={slice.total}
                head={["Court", "Cases"]}
                compact
              />
            </Card>
            <Card className="space-y-2 p-4 text-[12px] leading-relaxed text-dim">
              <div className="cc-label">Reading this</div>
              <p>
                The counts are the court&apos;s own: each search lists how many cases it holds for that type, year and status. {data.coverage.searched} of{" "}
                {data.coverage.codes} type codes are searched for {slice.year} so far; the rest appear as the district run reaches them.
              </p>
              <p>
                A case type here is the one printed on the case. The court&apos;s type codes mean different things in different courts (code 76 is ARB. A.(COMM.) at the
                District Judge but CC NI ACT at the Chief Metropolitan Magistrate), so one search can count several types.
              </p>
            </Card>
          </div>
        </div>
      </div>
    </>
  );
}
