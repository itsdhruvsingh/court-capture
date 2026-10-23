"use client";

import { Badge, Card } from "@/components/ui";

export const DISTRICT_PAGE = "https://southdelhi.dcourts.gov.in/case-status-search-by-case-type/";
export const HIGH_COURT_PAGE = "https://delhihighcourt.nic.in/app/sitting-judges-wise-data";

export const nf = new Intl.NumberFormat("en-IN");

type PersonStats = { captchas?: number; cases?: number; searches?: number };

/** Who has done what on this run. */
export function People({ people, unit }: { people: Record<string, PersonStats> | undefined; unit?: string }) {
  const rows = Object.entries(people ?? {}).sort((a, b) => (b[1].cases ?? 0) - (a[1].cases ?? 0));
  if (!rows.length) return null;
  return (
    <Card className="p-4">
      <div className="cc-label mb-2">By person</div>
      <table className="w-full text-[12px]">
        <thead>
          <tr className="text-faint">
            <th className="pb-1 text-left font-normal">Person</th>
            <th className="pb-1 text-right font-normal">{unit ?? "Cases"}</th>
            <th className="pb-1 text-right font-normal">Searches</th>
            <th className="pb-1 text-right font-normal">Captchas</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([name, p]) => (
            <tr key={name} className="border-t border-hairline">
              <td className="py-1 text-foreground">{name}</td>
              <td className="cc-mono py-1 text-right text-dim">{p.cases ?? 0}</td>
              <td className="cc-mono py-1 text-right text-dim">{p.searches ?? 0}</td>
              <td className="cc-mono py-1 text-right text-dim">{p.captchas ?? 0}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

export function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="cc-inset px-3 py-2">
      <div className="cc-label">{label}</div>
      <div className="mt-0.5 text-[13px] font-medium text-foreground">{value}</div>
    </div>
  );
}

export function RunStatusBadge({ status }: { status: string }) {
  const map: Record<string, { tone: "ok" | "warn" | "neutral" | "danger" | "accent"; label: string }> = {
    running: { tone: "accent", label: "Running" },
    paused: { tone: "warn", label: "Paused" },
    done: { tone: "ok", label: "Done" },
    cancelled: { tone: "neutral", label: "Stopped" },
    failed: { tone: "danger", label: "Failed" },
  };
  const m = map[status] ?? { tone: "neutral" as const, label: status };
  return (
    <Badge tone={m.tone}>
      {status === "running" && <span className="cc-pulse h-1.5 w-1.5 rounded-full bg-accent" />}
      {m.label}
    </Badge>
  );
}
