"use client";

import { useEffect, useState } from "react";
import { Grid3x3 } from "lucide-react";
import { Button, Card, Empty, PageHeader, Skeleton, Stat } from "@/components/ui";
import { BarList, Heatmap, ScaleLegend, nf, share, type HeatColumn } from "@/components/viz";
import { SetupNotice, getJson } from "../../district/ui";
import { shortJudge } from "../ui";

type Judge = {
  id: string | null;
  code: string;
  name: string;
  from: string;
  to: string;
  listed: number;
  courtListed: number;
  byType: Record<string, number>;
  byYear: Record<string, number>;
  saved: number;
};
type Distribution = {
  totals: { listed: number; judges: number; withLists: number; types: number; saved: number };
  since: string | null;
  types: { code: string; name: string; listed: number; saved: number }[];
  judges: Judge[];
  waiting: { id: string | null; code: string; name: string }[];
};

/** Columns of the heatmap: the most common case types, then the rest together. */
const TOP_TYPES = 8;

/** "2025–26", "2019–26" or "2025". */
function yearSpan(byYear: Record<string, number>) {
  const ys = Object.keys(byYear).map(Number).sort((a, b) => a - b);
  if (!ys.length) return "";
  const [a, b] = [ys[0], ys[ys.length - 1]];
  return a === b ? String(a) : `${a}–${String(b).slice(2)}`;
}

export function TypesAndJudgesBoard() {
  const [data, setData] = useState<Distribution | null>(null);
  const [error, setError] = useState<{ message: string; setup?: boolean } | null>(null);
  const [numbers, setNumbers] = useState(false);

  useEffect(() => {
    getJson<Distribution>("/api/high-court/distribution")
      .then((d) => (setData(d), setError(null)))
      .catch((e) => setError({ message: e.message, setup: e.setup }));
  }, []);

  const since = data?.since ? data.since.slice(0, 4) : null;
  const header = (
    <PageHeader
      eyebrow="High Court of Delhi"
      title="Case types & judges"
      subtitle={`What the High Court decides, by case type, and what each sitting judge's work is made of, from every judge's complete list of judgments${since ? ` since ${since}` : ""}.`}
    />
  );

  if (error?.setup) return <>{header}<SetupNotice message={error.message} /></>;
  if (error) return <>{header}<Card className="p-6 text-[13px] text-dangerSoft">{error.message}</Card></>;
  if (!data) return <>{header}<Skeleton className="h-[420px]" /></>;
  if (!data.judges.length) {
    return (
      <>
        {header}
        <Card>
          <Empty
            icon={<Grid3x3 className="h-6 w-6" />}
            title="No judge's list yet"
            body="Each High Court search lists everything a judge uploaded in the last ten years. Start the High Court run on the Capture page; every judge searched appears here."
          />
        </Card>
      </>
    );
  }

  const listedTypes = data.types.filter((t) => t.listed > 0);
  const top = listedTypes.slice(0, TOP_TYPES);
  const columns: HeatColumn[] = [
    ...top.map((t) => ({ key: t.code, label: t.name, title: `${t.name} (${t.code})`, href: t.saved ? `/high-court?type=${encodeURIComponent(t.code)}` : undefined })),
    ...(listedTypes.length > TOP_TYPES ? [{ key: "__other", label: "Other", title: `${listedTypes.length - TOP_TYPES} other case types` }] : []),
  ];
  const rows = data.judges.map((j) => {
    const cells: Record<string, number> = {};
    let inTop = 0;
    for (const t of top) {
      cells[t.code] = j.byType[t.code] ?? 0;
      inTop += cells[t.code];
    }
    cells.__other = j.listed - inTop;
    const [mostCode, mostN] = Object.entries(j.byType).sort((a, b) => b[1] - a[1])[0] ?? ["", 0];
    const mostName = data.types.find((t) => t.code === mostCode)?.name ?? mostCode;
    return {
      key: j.code,
      label: shortJudge(j.name),
      href: j.id ? `/high-court/judges/${j.id}` : undefined,
      sub: [yearSpan(j.byYear), mostN ? `mostly ${mostName} (${share(mostN, j.listed)})` : ""].filter(Boolean).join(" · "),
      total: j.listed,
      cells,
    };
  });

  return (
    <>
      {header}
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Judgments listed" value={nf.format(data.totals.listed)} delta={since ? `since ${since}, a bench's judgment counted once` : undefined} />
          <Stat label="Judges with full lists" value={`${data.totals.withLists} of ${data.totals.judges}`} delta="the rest fill in as the run goes on" />
          <Stat label="Case types" value={nf.format(data.totals.types)} delta={listedTypes[0] ? `most common: ${listedTypes[0].name}` : undefined} />
          <Stat label="Saved in full" value={nf.format(data.totals.saved)} delta="with the court's text and PDF" />
        </div>

        <Card className="overflow-hidden p-0">
          <div className="border-b border-hairline px-4 py-3">
            <div className="text-[13px] font-semibold text-foreground">By case type</div>
            <div className="text-[12px] text-faint">Every judgment in the judges&apos; lists, each counted once · open one to see the judgments saved in full</div>
          </div>
          <BarList
            label="Judgments by case type"
            items={listedTypes.map((t) => ({
              key: t.code,
              label: t.name,
              sub: t.code,
              value: t.listed,
              href: t.saved ? `/high-court?type=${encodeURIComponent(t.code)}` : undefined,
              note: t.saved ? `${nf.format(t.saved)} saved` : "—",
              detail: t.saved ? `${nf.format(t.saved)} saved in full` : "None saved in full yet",
            }))}
            total={data.totals.listed}
            head={["Case type", "Judgments"]}
            noteHead="Saved"
            limit={12}
          />
        </Card>

        <Card className="overflow-hidden p-0">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-hairline px-4 py-3">
            <div>
              <div className="text-[13px] font-semibold text-foreground">Judges by case type</div>
              <div className="text-[12px] text-faint">What each judge&apos;s judgments are made of · a row adds up to 100%</div>
            </div>
            <Button size="sm" variant="ghost" onClick={() => setNumbers((v) => !v)} aria-pressed={numbers}>
              {numbers ? "Hide the numbers" : "Show every number"}
            </Button>
          </div>
          <div className="px-2 py-3">
            <Heatmap rows={rows} columns={columns} numbers={numbers} rowHead="Judge" totalHead="Listed" />
          </div>
          <div className="border-t border-hairline px-4 py-3">
            <ScaleLegend title="Share of the judge's judgments:" />
          </div>
        </Card>

        {data.waiting.length > 0 && (
          <Card className="p-4 text-[12px] leading-relaxed text-dim">
            <span className="text-foreground">
              {data.waiting.length} judge{data.waiting.length === 1 ? " has" : "s have"} no full list yet.
            </span>{" "}
            Each appears above once the High Court run searches them:{" "}
            {data.waiting
              .slice(0, 10)
              .map((j) => shortJudge(j.name))
              .join(", ")}
            {data.waiting.length > 10 ? ` and ${data.waiting.length - 10} more.` : "."}
          </Card>
        )}
      </div>
    </>
  );
}
