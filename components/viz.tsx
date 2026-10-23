"use client";

import { useRef, useState, type FocusEvent, type PointerEvent, type ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * Charts for the "Case types" pages, in plain HTML:
 *
 *  - BarList: a table with a bar in each row. Every value is printed, so it is
 *    its own table view; the bar is for comparing at a glance.
 *  - Heatmap: rows × columns of shares in one hue stepped by size, with the
 *    share printed where it matters and on hover or focus everywhere.
 *
 * Colours are the --viz-* tokens in globals.css.
 */

export const nf = new Intl.NumberFormat("en-IN");

/** "12%", "<1%" or "0%". */
export function share(n: number, of: number) {
  if (!of || !n) return "0%";
  const p = (n / of) * 100;
  return p < 1 ? "<1%" : `${Math.round(p)}%`;
}

type TipText = { value: string; label: string; detail?: string };

/** One tooltip per chart, placed over the mark under the pointer or in focus. The value leads. */
function useTip() {
  const box = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<(TipText & { x: number; y: number }) | null>(null);
  const show = (e: PointerEvent<HTMLElement> | FocusEvent<HTMLElement>, t: TipText) => {
    const b = box.current?.getBoundingClientRect();
    if (!b) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = "clientX" in e ? e.clientX : r.left + r.width / 2;
    const y = "clientY" in e ? e.clientY : r.top;
    setTip({ ...t, x: Math.min(Math.max(x - b.left, 100), b.width - 100), y: y - b.top });
  };
  const node = tip && (
    <div role="tooltip" className="viz-tip" style={{ left: tip.x, top: tip.y }}>
      <div className="font-semibold text-foreground">{tip.value}</div>
      <div className="text-dim">{tip.label}</div>
      {tip.detail && <div className="text-faint">{tip.detail}</div>}
    </div>
  );
  return { box, show, hide: () => setTip(null), node };
}

export type BarItem = {
  key: string;
  label: string;
  sub?: string;
  value: number;
  href?: string;
  /** The right-hand column, e.g. how many are captured. */
  note?: ReactNode;
  /** An extra line for the tooltip. */
  detail?: string;
};

const ROW = "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 px-4 py-2 sm:grid-cols-[minmax(150px,1.1fr)_minmax(100px,2fr)_76px_44px]";
const ROW_NOTE = "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 px-4 py-2 sm:grid-cols-[minmax(150px,1.1fr)_minmax(100px,2fr)_76px_44px_84px]";
/** For narrow cards: label, bar, number; the share moves to the tooltip. */
const ROW_COMPACT = "grid grid-cols-[minmax(0,1.4fr)_minmax(40px,1fr)_auto] items-center gap-x-3 px-4 py-2";

/** A table with a bar in each row, in the order given. Shares are of `total`. */
export function BarList({
  items,
  total,
  head,
  noteHead,
  limit = 12,
  label,
  compact,
}: {
  items: BarItem[];
  total: number;
  head: [string, string];
  noteHead?: string;
  limit?: number;
  label: string;
  compact?: boolean;
}) {
  const [all, setAll] = useState(false);
  const { box, show, hide, node } = useTip();
  const max = Math.max(1, ...items.map((i) => i.value));
  const grid = compact ? ROW_COMPACT : noteHead ? ROW_NOTE : ROW;

  const row = (it: BarItem) => {
    const t = { value: `${nf.format(it.value)} · ${share(it.value, total)}`, label: it.label, detail: it.detail ?? it.sub };
    const cells = (
      <>
        <span role="cell" className="min-w-0">
          <span className="block truncate text-[13px] text-foreground">{it.label}</span>
          {it.sub && <span className="block truncate text-[11px] text-faint">{it.sub}</span>}
        </span>
        <span className={cn("relative h-[10px]", !compact && "order-last col-span-2 sm:order-none sm:col-span-1")} aria-hidden>
          {it.value > 0 && <span className="viz-bar" style={{ width: `max(2px, ${(it.value / max) * 100}%)` }} />}
        </span>
        <span role="cell" className="cc-mono text-right text-[12.5px] tabular-nums text-foreground">
          {nf.format(it.value)}
        </span>
        {!compact && (
          <span role="cell" className="hidden text-right text-[12px] tabular-nums text-dim sm:block">
            {share(it.value, total)}
          </span>
        )}
        {noteHead && !compact && (
          <span role="cell" className="hidden text-right text-[12px] text-dim sm:block">
            {it.note}
          </span>
        )}
      </>
    );
    const props = {
      role: "row",
      "aria-label": `${it.label}: ${nf.format(it.value)}, ${share(it.value, total)}`,
      className: cn(grid, "border-b border-hairline outline-none transition-colors last:border-b-0 hover:bg-tint focus-visible:bg-tint"),
      onPointerMove: (e: PointerEvent<HTMLElement>) => show(e, t),
      onPointerLeave: hide,
      onFocus: (e: FocusEvent<HTMLElement>) => show(e, t),
      onBlur: hide,
    };
    return it.href ? (
      <Link key={it.key} href={it.href} {...props}>
        {cells}
      </Link>
    ) : (
      <div key={it.key} tabIndex={0} {...props}>
        {cells}
      </div>
    );
  };

  return (
    <div ref={box} className="relative">
      <div role="table" aria-label={label}>
        <div role="row" className={cn(grid, "border-b border-hairline text-[11px] font-medium uppercase tracking-wide text-faint")}>
          <span role="columnheader">{head[0]}</span>
          <span className={compact ? "" : "hidden sm:block"} aria-hidden />
          <span role="columnheader" className="text-right">
            {head[1]}
          </span>
          {!compact && (
            <span role="columnheader" className="hidden text-right sm:block">
              Share
            </span>
          )}
          {noteHead && !compact && (
            <span role="columnheader" className="hidden text-right sm:block">
              {noteHead}
            </span>
          )}
        </div>
        {(all ? items : items.slice(0, limit)).map(row)}
      </div>
      {items.length > limit && (
        <button onClick={() => setAll((v) => !v)} className="w-full border-t border-hairline px-4 py-2.5 text-left text-[12px] text-dim transition-colors hover:text-foreground">
          {all ? `Show the top ${limit}` : `Show all ${items.length}`}
        </button>
      )}
      {node}
    </div>
  );
}

export type HeatColumn = { key: string; label: string; title: string; href?: string };
export type HeatRow = { key: string; label: string; sub?: string; href?: string; total: number; cells: Record<string, number> };

/** Share thresholds between the five steps. */
const STEPS = [0.05, 0.15, 0.3, 0.5];
const STEP_LABELS = ["under 5%", "5–15%", "15–30%", "30–50%", "50% or more"];
/** At or above this share a cell prints its number without being asked. */
const PRINT_FROM = 0.15;

function step(s: number) {
  return s <= 0 ? 0 : 1 + STEPS.filter((t) => s >= t).length;
}

export function ScaleLegend({ title }: { title: string }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-faint">
      <span>{title}</span>
      {STEP_LABELS.map((l, i) => (
        <span key={l} className="flex items-center gap-1.5">
          <span className="viz-swatch" data-bin={i + 1} />
          {l}
        </span>
      ))}
    </div>
  );
}

/** Each row's cells as shares of that row's total. `numbers` prints every share. */
export function Heatmap({ rows, columns, numbers, rowHead, totalHead }: { rows: HeatRow[]; columns: HeatColumn[]; numbers: boolean; rowHead: string; totalHead: string }) {
  const { box, show, hide, node } = useTip();
  return (
    <div ref={box} className="relative">
      <div className="overflow-x-auto">
        <table className="w-full border-separate text-left [border-spacing:2px]">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-panel px-2 pb-2 align-bottom text-[11px] font-medium uppercase tracking-wide text-faint">{rowHead}</th>
              {columns.map((c) => (
                <th key={c.key} title={c.title} className="max-w-[76px] px-1 pb-2 text-center align-bottom text-[11px] font-medium leading-tight text-dim">
                  {c.href ? (
                    <Link href={c.href} className="transition-colors hover:text-foreground">
                      {c.label}
                    </Link>
                  ) : (
                    c.label
                  )}
                </th>
              ))}
              <th className="px-2 pb-2 text-right align-bottom text-[11px] font-medium uppercase tracking-wide text-faint">{totalHead}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <th scope="row" className="sticky left-0 z-10 max-w-[230px] bg-panel py-0.5 pl-2 pr-3 font-normal">
                  {r.href ? (
                    <Link href={r.href} className="block truncate text-[12.5px] text-foreground hover:underline">
                      {r.label}
                    </Link>
                  ) : (
                    <span className="block truncate text-[12.5px] text-foreground">{r.label}</span>
                  )}
                  {r.sub && <span className="block truncate text-[11px] text-faint">{r.sub}</span>}
                </th>
                {columns.map((c) => {
                  const n = r.cells[c.key] ?? 0;
                  const s = r.total ? n / r.total : 0;
                  const t = { value: `${share(n, r.total)} · ${nf.format(n)} of ${nf.format(r.total)}`, label: c.title, detail: r.label };
                  return (
                    <td key={c.key} className="p-0">
                      <span
                        tabIndex={0}
                        className="viz-cell"
                        data-bin={step(s)}
                        aria-label={`${r.label}, ${c.title}: ${nf.format(n)} of ${nf.format(r.total)}, ${share(n, r.total)}`}
                        onPointerMove={(e) => show(e, t)}
                        onPointerLeave={hide}
                        onFocus={(e) => show(e, t)}
                        onBlur={hide}
                      >
                        {n > 0 && (numbers || s >= PRINT_FROM) ? share(n, r.total) : ""}
                      </span>
                    </td>
                  );
                })}
                <td className="cc-mono px-2 text-right text-[12.5px] tabular-nums text-foreground">{nf.format(r.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {node}
    </div>
  );
}
