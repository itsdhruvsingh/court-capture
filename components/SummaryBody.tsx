"use client";

import { Badge } from "@/components/ui";

export type SummaryView = {
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

export type SummaryMeta = {
  summary_model: string | null;
  summary_source: string | null;
  summary_by: string | null;
  summary_at: string | null;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmt(iso: string) {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : iso;
}

/** An AI summary of an order or judgment, laid out the same way for both courts. */
export function SummaryBody({ s, meta, noun = "order" }: { s: SummaryView; meta: SummaryMeta; noun?: "order" | "judgment" }) {
  return (
    <div className="space-y-3">
      <div>
        <div className="flex flex-wrap items-center gap-1.5">
          {s.order_type && <Badge tone="info">{s.order_type}</Badge>}
          {s.outcome && <Badge tone="neutral">{s.outcome}</Badge>}
        </div>
        <p className="mt-2 text-[14px] font-medium leading-snug text-foreground">{s.headline}</p>
        <p className="mt-1.5 text-[13px] leading-relaxed text-dim">{s.summary}</p>
      </div>

      {s.directions.length > 0 && (
        <div>
          <div className="cc-label mb-1">Directions</div>
          <ul className="space-y-1 text-[12.5px] text-dim">
            {s.directions.map((d, i) => (
              <li key={i} className="flex gap-2">
                <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-accent" />
                {d}
              </li>
            ))}
          </ul>
        </div>
      )}

      {s.key_points.length > 0 && (
        <div>
          <div className="cc-label mb-1">Key points</div>
          <ul className="space-y-1 text-[12.5px] text-dim">
            {s.key_points.map((d, i) => (
              <li key={i} className="flex gap-2">
                <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-faint" />
                {d}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-2 text-[12.5px] sm:grid-cols-2">
        {s.present.length > 0 && (
          <div>
            <div className="cc-label mb-0.5">Present</div>
            <div className="text-dim">{s.present.map((x) => x.replace(/[.;\s]+$/, "")).join("; ")}</div>
          </div>
        )}
        {(s.next_date || s.next_purpose) && (
          <div>
            <div className="cc-label mb-0.5">Next date</div>
            <div className="text-foreground">
              {s.next_date ? fmt(s.next_date) : `Not fixed in this ${noun}`}
              {s.next_purpose && <span className="text-dim"> · {s.next_purpose}</span>}
            </div>
          </div>
        )}
        {s.judge && (
          <div>
            <div className="cc-label mb-0.5">Bench</div>
            <div className="text-dim">{s.judge}</div>
          </div>
        )}
      </div>

      <p className="border-t border-hairline pt-2 text-[11px] text-faint">
        AI summary{meta.summary_model ? ` · ${meta.summary_model}` : ""}
        {meta.summary_source === "pdf" ? " · read from the scanned PDF" : ` · read from the ${noun}'s text`}
        {meta.summary_by ? ` · requested by ${meta.summary_by}` : ""}
        {meta.summary_at ? ` · ${fmt(meta.summary_at.slice(0, 10))}` : ""}. Check it against the {noun} before relying on it.
      </p>
    </div>
  );
}
