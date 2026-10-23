/**
 * Court Cases — reading the court site's HTML.
 *
 * Pure: no network, no database, no React. Everything here is exercised by
 * scripts/test-court-cases.mjs against HTML captured from the live site
 * (scripts/data/ecourts-*.html), so a markup change on their side shows up as
 * a failing test rather than as quietly empty columns.
 *
 * Tables are read by their <caption> and header text, never by position: the
 * site drops whole sections (FIR, IA status, final orders) when they do not
 * apply, and adds columns for disposed cases.
 */

import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import type {
  CaseTypeOption,
  GenericTable,
  Hearing,
  ListedCase,
  ParsedCase,
  ParsedOrder,
  Party,
  ResultBlock,
} from "./types";
import { ESTABLISHMENTS } from "./config";

// ── text and dates ────────────────────────────────────────────────────────

export { clean, parseDate } from "@/lib/text";
import { clean, parseDate } from "@/lib/text";

/** "4290/2024" → { no: 4290, year: 2024 }. */
export function splitNumber(s: string | null | undefined): { no: number | null; year: number | null } {
  const m = clean(s).match(/(\d+)\s*\/\s*(\d{4})\s*$/);
  return m ? { no: Number(m[1]), year: Number(m[2]) } : { no: null, year: null };
}

/** Family-court listings print parties as XXXXXXX. */
export function isMasked(name: string): boolean {
  return /^x{4,}$/i.test(clean(name).replace(/\s/g, ""));
}

// ── advocates ─────────────────────────────────────────────────────────────

const HONORIFICS = /\b(ADV|ADVS|ADVOCATE|ADVOCATES|SH|SHRI|SHRI\.|MR|MRS|MS|SMT|KUMARI|KM|DR|LD|COUNSEL|SR|SENIOR)\b/g;

/**
 * The key two spellings of one advocate share: "Sh. Pratap Singh Rawat",
 * "PRATAP SINGH RAWAT, Adv." and "pratap  singh rawat" are one person.
 * Deliberately conservative — it does not guess at initials, so "P S RAWAT"
 * stays separate rather than being merged with somebody it is not.
 */
export function advocateKey(name: string): string {
  return clean(name)
    .toUpperCase()
    .replace(/[.,'’`()]/g, " ")
    .replace(HONORIFICS, " ")
    .replace(/[^A-Z0-9 &/-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const SMALL = new Set(["of", "and", "for", "the", "in", "&"]);

export function titleName(name: string): string {
  return clean(name)
    .toLowerCase()
    .split(" ")
    .map((w, i) => (i > 0 && SMALL.has(w) ? w : w.replace(/(^|[-/(])([a-z])/g, (_, p, c) => p + c.toUpperCase())))
    .join(" ");
}

/** "A, B; C" → three names. Not split on "and": firms are called "X and Associates". */
export function splitAdvocates(raw: string): string[] {
  return clean(raw)
    .split(/\s*[,;]\s*/)
    .map((s) =>
      s
        .replace(/^(advocate|adv)\.?\s*[-:–]?\s*/i, "")
        .replace(/^((sh|shri|mr|mrs|ms|smt|ld)\.?\s+)+/i, "")
        .trim()
    )
    .filter((s) => advocateKey(s).length >= 3);
}

// ── tables ────────────────────────────────────────────────────────────────

type $T = cheerio.CheerioAPI;

function cellText($: $T, el: AnyNode): string {
  return clean($(el).text());
}

/** Every table, as header → text rows, plus the raw cells for links. */
function readTables($: $T) {
  const out: { caption: string; headers: string[]; rows: Record<string, string>[]; cells: AnyNode[][] }[] = [];
  $("table").each((_, table) => {
    const caption = clean($(table).find("caption").first().text());
    // A label/value table (one <th> then the value on each row) reads as one record.
    const trs = $(table).find("tr").toArray();
    const keyValue =
      !$(table).find("thead").length &&
      trs.length > 0 &&
      trs.every((tr) => $(tr).children("th").length === 1 && $(tr).children("td").length >= 1);
    if (keyValue) {
      const row: Record<string, string> = {};
      const cells: AnyNode[] = [];
      for (const tr of trs) {
        const k = cellText($, $(tr).children("th").get(0)!);
        const tds = $(tr).children("td").toArray();
        row[k || `row${Object.keys(row).length + 1}`] = clean(tds.map((td) => cellText($, td)).join(" "));
        cells.push(...tds);
      }
      out.push({ caption, headers: Object.keys(row), rows: [row], cells: [cells] });
      return;
    }
    let headers = $(table)
      .find("thead tr")
      .first()
      .find("th,td")
      .map((__, th) => cellText($, th))
      .get();
    const bodyRows = $(table).find("tbody tr").length ? $(table).find("tbody tr") : $(table).find("tr").slice(headers.length ? 0 : 1);
    if (!headers.length) {
      headers = $(table).find("tr").first().find("th,td").map((__, th) => cellText($, th)).get();
    }
    const rows: Record<string, string>[] = [];
    const cells: AnyNode[][] = [];
    bodyRows.each((__, tr) => {
      const tds = $(tr).find("td").toArray();
      if (!tds.length) return;
      const row: Record<string, string> = {};
      tds.forEach((td, i) => {
        const key = clean($(td).attr("data-th")) || headers[i] || `col${i + 1}`;
        row[key] = cellText($, td);
      });
      rows.push(row);
      cells.push(tds);
    });
    out.push({ caption, headers, rows, cells });
  });
  return out;
}

function pick(row: Record<string, string> | undefined, ...patterns: RegExp[]): string | null {
  if (!row) return null;
  for (const p of patterns) {
    for (const [k, v] of Object.entries(row)) if (p.test(k) && v) return v;
  }
  return null;
}

// ── case types ────────────────────────────────────────────────────────────

/** The `<option>` list `get_case_types` returns for the complex. */
export function parseCaseTypes(html: string): CaseTypeOption[] {
  const $ = cheerio.load(`<select>${html}</select>`);
  const seen = new Set<string>();
  const out: CaseTypeOption[] = [];
  $("option").each((_, o) => {
    const code = clean($(o).attr("value"));
    const name = clean($(o).text());
    if (!code || !name || seen.has(code)) return;
    seen.add(code);
    out.push({ code, name });
  });
  return out;
}

// ── search results ────────────────────────────────────────────────────────

export function parseCaseNumber(text: string): { typeLabel: string; number: number | null; year: number | null } {
  const t = clean(text);
  const m = t.match(/^(.*?)\s*\/\s*(\d+)\s*\/\s*(\d{4})\s*$/);
  if (!m) return { typeLabel: t, number: null, year: null };
  return { typeLabel: m[1].trim(), number: Number(m[2]), year: Number(m[3]) };
}

export function parseSearchResults(html: string): ResultBlock[] {
  const $ = cheerio.load(html);
  const blocks: ResultBlock[] = [];
  $(".distTableContent").each((_, block) => {
    const $b = $(block);
    const estCode = clean($b.attr("data-est-code") || $b.attr("id"));
    const establishment = clean($b.find("caption").first().text()) || ESTABLISHMENTS[estCode] || estCode;
    const rows: ListedCase[] = [];
    $b.find("tbody tr").each((__, tr) => {
      const $tr = $(tr);
      const link = $tr.find("[data-cno]").first();
      const cnr = clean(link.attr("data-cno")).toUpperCase();
      if (!cnr) return;
      const tds = $tr.find("td").toArray();
      const byTh = (re: RegExp) => {
        const td = tds.find((d) => re.test(clean($(d).attr("data-th"))));
        return td ? $(td) : null;
      };
      const numberText = clean((byTh(/case type|case number/i) ?? $(tds[1])).text());
      const partiesCell = byTh(/petitioner|versus/i) ?? $(tds[2]);
      // The cell is "Petitioner <br>Versus <br>Respondent".
      const partsHtml = partiesCell.html() ?? "";
      const lines = partsHtml
        .split(/<br\s*\/?>/i)
        .map((h) => clean(cheerio.load(`<i>${h}</i>`)("i").text()))
        .filter(Boolean);
      const vIdx = lines.findIndex((l) => /^versus$|^vs\.?$/i.test(l));
      const petitioner = vIdx > 0 ? lines.slice(0, vIdx).join(" ") : lines[0] ?? "";
      const respondent = vIdx >= 0 ? lines.slice(vIdx + 1).join(" ") : lines.slice(1).join(" ");
      const parsed = parseCaseNumber(numberText);
      const serial = Number(clean((byTh(/serial/i) ?? $(tds[0])).text()));
      rows.push({
        cnr,
        estCode: estCode || cnr.slice(0, 6),
        establishment,
        serial: Number.isFinite(serial) && serial > 0 ? serial : null,
        caseNumber: numberText,
        typeLabel: parsed.typeLabel,
        number: parsed.number,
        year: parsed.year,
        petitioner,
        respondent,
        masked: isMasked(petitioner) || isMasked(respondent),
        requestToken: clean(link.attr("data-request-token")) || null,
      });
    });
    const total = Number($b.attr("data-total-cases"));
    const next = Number($b.attr("data-next-page"));
    blocks.push({
      estCode,
      establishment,
      total: Number.isFinite(total) ? total : null,
      nextPage: Number.isFinite(next) && next > 0 ? next : null,
      rows,
    });
  });
  return blocks;
}

/**
 * The newest `want` cases, newest first. The site lists each establishment
 * newest-first already; across establishments, rows whose printed type is the
 * one searched for come first (code 17 is "CS DJ" at the District Judge but
 * "CS" at the Family Court), then by year and number, descending.
 */
export function pickNewest(blocks: ResultBlock[], typeName: string, want: number, skip: Set<string>): ListedCase[] {
  const norm = (s: string) => clean(s).toUpperCase().replace(/[^A-Z0-9]/g, "");
  const target = norm(typeName);
  const all = blocks.flatMap((b) => b.rows).filter((r) => !skip.has(r.cnr));
  all.sort((a, b) => {
    const am = norm(a.typeLabel) === target ? 1 : 0;
    const bm = norm(b.typeLabel) === target ? 1 : 0;
    if (am !== bm) return bm - am;
    if ((b.year ?? 0) !== (a.year ?? 0)) return (b.year ?? 0) - (a.year ?? 0);
    return (b.number ?? 0) - (a.number ?? 0);
  });
  const seen = new Set<string>();
  return all.filter((r) => (seen.has(r.cnr) ? false : (seen.add(r.cnr), true))).slice(0, want);
}

// ── case details ──────────────────────────────────────────────────────────

function decodeBase64Json(s: string | undefined | null): Record<string, unknown> | null {
  if (!s) return null;
  try {
    const norm = s.replace(/-/g, "+").replace(/_/g, "/");
    const json = Buffer.from(norm, "base64").toString("utf8");
    const v = JSON.parse(json);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** The {cino, order_no, order_date} an order link carries in `input_strings`. */
export function decodeOrderLink(url: string): { cino?: string; order_no?: string; order_date?: string } | null {
  try {
    const u = new URL(url);
    return decodeBase64Json(u.searchParams.get("input_strings")) as { cino?: string; order_no?: string; order_date?: string } | null;
  } catch {
    return null;
  }
}

function readParties($: $T, side: "petitioner" | "respondent"): Party[] {
  const heading = $("h5,h4,h3")
    .filter((_, h) => new RegExp(`^${side}`, "i").test(clean($(h).text())))
    .first();
  let list = heading.length ? heading.nextAll("div").first() : $(side === "petitioner" ? ".Petitioner" : ".respondent").first();
  if (!list.length) list = $(`[class~="${side}"], [class~="${side[0].toUpperCase()}${side.slice(1)}"]`).first();
  const parties: Party[] = [];
  list.find("li").each((i, li) => {
    const $li = $(li);
    const nameRaw = clean($li.find("p").first().text()) || clean($li.contents().first().text());
    const name = nameRaw.replace(/^\d+\s*[).]\s*/, "").trim();
    const rest = clean($li.clone().find("p").remove().end().text());
    const m = rest.match(/advocate\s*[-:–]?\s*(.+)$/i);
    const advocate = m ? clean(m[1]) : null;
    // Every line as printed, so an address or "extra party" note is never lost.
    const NL = String.fromCharCode(10);
    const lines = cheerio
      .load(`<i>${($li.html() ?? "").replace(/<br\s*\/?>/gi, NL).replace(/<\/(p|div|li|span)>/gi, NL)}</i>`)("i")
      .text()
      .split(NL)
      .map(clean)
      .filter(Boolean);
    if (!name && !advocate && !lines.length) return;
    parties.push({
      index: i + 1,
      name,
      advocate,
      advocates: advocate ? splitAdvocates(advocate) : [],
      lines,
    });
  });
  return parties;
}

export function parseCaseDetails(html: string): ParsedCase {
  const $ = cheerio.load(html);
  const tables = readTables($);
  const byCaption = (re: RegExp) => tables.filter((t) => re.test(t.caption));

  const details = byCaption(/^case details/i)[0]?.rows[0];
  const status = byCaption(/^case status/i)[0]?.rows[0];

  const caseTypeFull = pick(details, /case type/i);
  const registrationNumber = pick(details, /registration number|reg.*no/i);
  const reg = splitNumber(registrationNumber);
  const cnr = (pick(details, /cnr/i) ?? "").toUpperCase().replace(/\s/g, "");

  const statusText = pick(status, /^case status/i) ?? "";
  const decisionDate = parseDate(pick(status, /decision date/i));
  const nature = pick(status, /nature of disposal/i);

  // ── hearings ──
  const hearings: Hearing[] = [];
  for (const t of byCaption(/history/i)) {
    t.rows.forEach((row, i) => {
      const link = $(t.cells[i]).find("[data-case]").first();
      const business = decodeBase64Json(link.attr("data-case"));
      hearings.push({
        seq: hearings.length + 1,
        judge: pick(row, /judge/i),
        businessDate: parseDate(link.attr("data-business-date") ?? pick(row, /business/i)),
        nextDate: parseDate(pick(row, /hearing date/i)),
        purpose: pick(row, /purpose/i),
        business,
      });
    });
  }

  // ── orders ──
  const orders: ParsedOrder[] = [];
  for (const t of tables.filter((t) => /order|judg/i.test(t.caption) && t.headers.some((h) => /order/i.test(h)))) {
    const kind: ParsedOrder["kind"] = /final|judg/i.test(t.caption) ? "final" : "interim";
    t.rows.forEach((row, i) => {
      const a = $(t.cells[i]).find("a[href]").filter((__, el) => !/^javascript/i.test($(el).attr("href") ?? "")).first();
      const href = a.attr("href") ?? null;
      const decoded = href ? decodeOrderLink(href) : null;
      const no = Number(pick(row, /order number|order no/i) ?? decoded?.order_no);
      if (!Number.isFinite(no)) return;
      orders.push({
        kind,
        orderNo: no,
        orderDate: parseDate(pick(row, /order date/i) ?? decoded?.order_date),
        label: clean(a.text()) || pick(row, /order details/i),
        sourceUrl: href,
      });
    });
  }

  // ── acts, FIR ──
  const acts = (byCaption(/^acts?$/i)[0]?.rows ?? [])
    .map((r) => ({ act: pick(r, /act/i) ?? "", sections: pick(r, /section/i) ?? "" }))
    .filter((a) => a.act || a.sections);
  const firRow = byCaption(/fir/i)[0]?.rows[0];

  // Everything on the page, verbatim, known or not.
  const all: GenericTable[] = tables.map(({ caption, headers, rows }) => ({ caption, headers, rows }));

  const known = /^(case details|case status|acts?|case history|orders?|final orders?.*|.*judg.*|fir.*)$/i;
  const extra: GenericTable[] = tables
    .filter((t) => t.caption && !known.test(t.caption))
    .map(({ caption, headers, rows }) => ({ caption, headers, rows }));

  const petitioners = readParties($, "petitioner");
  const respondents = readParties($, "respondent");

  return {
    cnr,
    establishment: clean($("h2").first().text()) || null,
    caseTypeFull,
    caseTypeLabel: caseTypeFull ? clean(caseTypeFull.split(" - ")[0]) : null,
    filingNumber: pick(details, /filing number/i),
    filingDate: parseDate(pick(details, /filing date/i)),
    registrationNumber,
    registrationDate: parseDate(pick(details, /registration date/i)),
    caseNo: reg.no,
    caseYear: reg.year,
    firstHearingDate: parseDate(pick(status, /first hearing/i)),
    nextHearingDate: parseDate(pick(status, /next hearing/i)),
    decisionDate,
    status: /dispos/i.test(statusText) || decisionDate || nature ? "disposed" : statusText ? "pending" : null,
    stage: pick(status, /stage/i),
    natureOfDisposal: nature,
    courtJudge: pick(status, /court number|judge/i),
    petitioners,
    respondents,
    acts,
    fir: firRow ?? null,
    hearings,
    orders,
    extra,
    tables: all,
    sections: $("h2,h3,h4,h5,caption").map((_, h) => clean($(h).text())).get().filter(Boolean),
    masked: [...petitioners, ...respondents].some((p) => isMasked(p.name)),
  };
}

/** "Goyal Publishers … vs Preeti Bhutani (+2)". */
export function caseTitle(pet: Party[], res: Party[], fallback?: { petitioner: string; respondent: string }): string {
  const side = (ps: Party[], fb?: string) => {
    if (!ps.length) return fb ?? "";
    return ps[0].name + (ps.length > 1 ? ` and ${ps.length - 1} other${ps.length > 2 ? "s" : ""}` : "");
  };
  const p = side(pet, fallback?.petitioner);
  const r = side(res, fallback?.respondent);
  return r ? `${p} vs ${r}` : p;
}
