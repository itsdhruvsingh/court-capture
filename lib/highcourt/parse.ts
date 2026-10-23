/**
 * High Court — reading the "Sitting Judges wise" results table.
 *
 * Pure: no network, no database. Tested against a table captured from the
 * live site (scripts/data/dhc-judge-results.html).
 *
 * A row looks like this (comment included — it is how the court renders it):
 *
 *   <td>1</td>
 *   <!-- <td>CW - 8028/2025<br>…2025:DHC:4853-DB…</td> -->
 *   <td>W.P.(C)-8028/2025<br><a href="#">2025:DHC:4853-DB</a></td>
 *   <td><a href=".../showFileJudgment/PMS…_174112.pdf">30-05-2025 (pdf)</a><br>
 *       <a href=".../showFileJudgment/PMS…_174112.txt">30-05-2025 (txt)</a></td>
 *   <td>M/S LALA SHIVNATH …<br><b>Vs</b><br>ADDITIONAL COMMISSIONER, CGST …</td>
 *   <td>NA</td> <td>NA</td> <td>-</td>
 *
 * The comment carries the court's internal case-type code ("CW"), which maps
 * exactly onto the case-number search's type list ("W.P.(C)"). The printed
 * label is the fallback.
 */

import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import { clean, parseDate } from "@/lib/text";
import { CASE_TYPES, HC } from "./config";
import type { HcResults, HcRow } from "./types";

/** "W.P.(C)" / "w.p. (c)" / "WP(C)" → "WPC": how labels are compared. */
export function typeKey(s: string | null | undefined) {
  return clean(s).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

const BY_CODE = new Map(CASE_TYPES.map((t) => [t.code.toUpperCase(), t]));
const BY_KEY = new Map<string, { code: string; name: string }>();
for (const t of CASE_TYPES) if (!BY_KEY.has(typeKey(t.name))) BY_KEY.set(typeKey(t.name), t);

/**
 * The case type for a row: the court's code first, then the printed label,
 * then the longest known label the printed one starts with.
 */
export function caseTypeFor(code: string | null, label: string | null): { code: string; name: string } | null {
  if (code && BY_CODE.has(code.toUpperCase())) return BY_CODE.get(code.toUpperCase())!;
  const k = typeKey(label);
  if (!k) return null;
  if (BY_KEY.has(k)) return BY_KEY.get(k)!;
  let best: { code: string; name: string } | null = null;
  for (const [key, t] of BY_KEY) if (k.startsWith(key) && (!best || key.length > typeKey(best.name).length)) best = t;
  return best;
}

/** "W.P.(C)-8028/2025" → label "W.P.(C)", 8028, 2025. */
export function splitCaseNo(caseNo: string): { label: string | null; number: number | null; year: number | null } {
  const m = clean(caseNo).match(/^(.*?)\s*-\s*(\d+)\s*\/\s*(\d{4})\s*$/);
  if (!m) return { label: clean(caseNo) || null, number: null, year: null };
  return { label: m[1].trim() || null, number: Number(m[2]), year: Number(m[3]) };
}

const NONE = /^(na|n\/a|-|nil|none)?$/i;

function absolute(href: string | undefined): string | null {
  if (!href || href === "#" || /^javascript/i.test(href)) return null;
  try {
    return new URL(href, HC.base).toString();
  } catch {
    return null;
  }
}

export function parseJudgeResults(html: string, info?: string | null): HcResults {
  const $ = cheerio.load(html);
  const rows: HcRow[] = [];
  $("tbody tr").each((_, tr) => {
    const $tr = $(tr);
    const tds = $tr.children("td").toArray();
    if (tds.length < 4 || $tr.find("td.dt-empty").length) return;

    const comment = ($tr.contents().toArray() as AnyNode[])
      .filter((n) => n.type === "comment")
      .map((n) => (n as unknown as { data: string }).data)
      .join(" ");
    const code = comment.match(/<td>\s*([A-Z][A-Z0-9.()\- ]*?)\s*-\s*\d+\s*\/\s*\d{4}/i)?.[1]?.trim() ?? null;

    const caseCell = $(tds[1]);
    const caseNo = clean(caseCell.clone().find("a").remove().end().text());
    const citation = clean(caseCell.find("a").first().text()) || null;
    const parts = splitCaseNo(caseNo);

    const links = $(tds[2]).find("a[href]").toArray();
    const pdf = links.find((a) => /\.pdf(\?|$)/i.test($(a).attr("href") ?? ""));
    const txt = links.find((a) => /\.txt(\?|$)/i.test($(a).attr("href") ?? ""));
    const dateText = clean($(links[0] ?? tds[2]).text());

    // "PETITIONER <br><b>Vs</b><br> RESPONDENT"
    const NL = String.fromCharCode(10);
    const partyLines = cheerio
      .load(`<i>${($(tds[3]).html() ?? "").replace(/<br\s*\/?>/gi, NL)}</i>`)("i")
      .text()
      .split(NL)
      .map(clean)
      .filter(Boolean);
    const vs = partyLines.findIndex((l) => /^vs\.?$|^versus$/i.test(l));
    const petitioner = (vs > 0 ? partyLines.slice(0, vs) : partyLines.slice(0, 1)).join(" ") || null;
    const respondent = (vs >= 0 ? partyLines.slice(vs + 1) : partyLines.slice(1)).join(" ") || null;

    const cell = (i: number) => {
      const t = clean($(tds[i]).text());
      return NONE.test(t) ? null : t;
    };
    const serial = Number(clean($(tds[0]).text()));
    const type = caseTypeFor(code, parts.label);

    rows.push({
      serial: Number.isFinite(serial) && serial > 0 ? serial : null,
      caseNo,
      caseTypeCode: type?.code ?? code,
      caseTypeLabel: type?.name ?? parts.label,
      caseNumber: parts.number,
      caseYear: parts.year,
      neutralCitation: citation && /\d{4}:DHC:\d+/i.test(citation) ? citation : null,
      orderDate: parseDate(dateText),
      pdfUrl: absolute(pdf ? $(pdf).attr("href") : undefined),
      txtUrl: absolute(txt ? $(txt).attr("href") : undefined),
      petitioner,
      respondent,
      corrigendum: cell(4),
      uploadedOn: cell(5),
      remark: cell(6),
      html: $.html(tr),
    });
  });

  // "Showing 1 to 100 of 701 entries"
  const total = Number((info ?? "").match(/of\s+([\d,]+)\s+entries/i)?.[1]?.replace(/,/g, ""));
  return { rows, total: Number.isFinite(total) ? total : rows.length };
}

/** A row's identity: its PDF link when it has one (stable), else number and date. */
export function dedupeKey(r: Pick<HcRow, "pdfUrl" | "caseNo" | "orderDate">) {
  return r.pdfUrl ?? `${typeKey(r.caseNo)}|${r.orderDate ?? ""}`;
}

/** Only the court's own judgment documents are fetched on a user's behalf. */
export function isJudgmentUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    return u.origin === HC.base && u.pathname.startsWith(HC.docPath) && /\.(pdf|txt)$/i.test(u.pathname);
  } catch {
    return false;
  }
}
