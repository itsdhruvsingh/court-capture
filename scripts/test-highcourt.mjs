/**
 * Unit tests for the High Court parser — pure, no network, no DB.
 *
 *   node scripts/test-highcourt.mjs
 *
 * scripts/data/dhc-judge-results.html is a real results table captured from
 * delhihighcourt.nic.in (Justice Prathiba M. Singh, Jan–Jun 2025), trimmed to
 * one row per case type.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const req = createRequire(path.resolve("scripts/test-highcourt.mjs"));
req("./lib/tsx-require.cjs");

const p = req(path.resolve("lib/highcourt/parse.ts"));
const w = req(path.resolve("lib/highcourt/window.ts"));

let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => {
  cond ? pass++ : fail++;
  console.log(`${cond ? "  ok  " : "FAIL  "}${name}${cond ? "" : `\n        ${detail}`}`);
};
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

// ── case types ─────────────────────────────────────────────────────────────
eq("type by the court's code", p.caseTypeFor("CW", "anything"), { code: "CW", name: "W.P.(C)" });
eq("type by printed label", p.caseTypeFor(null, "FAO (COMM)")?.name, "FAO (COMM)");
eq("label match ignores spacing and dots", p.caseTypeFor(null, "w.p. (c)")?.name, "W.P.(C)");
eq("unknown label is null", p.caseTypeFor(null, "ZZZ"), null);
eq("split case number", p.splitCaseNo("W.P.(C)-8028/2025"), { label: "W.P.(C)", number: 8028, year: 2025 });
eq("split with spaces", p.splitCaseNo("FAO (COMM) - 142/2025"), { label: "FAO (COMM)", number: 142, year: 2025 });

// ── the results table ──────────────────────────────────────────────────────
const html = fs.readFileSync("scripts/data/dhc-judge-results.html", "utf8");
const res = p.parseJudgeResults(html, "Showing 1 to 100 of 701 entries");
eq("six rows", res.rows.length, 6);
eq("total from the table info", res.total, 701);
const r = res.rows[1];
eq("case number", [r.caseNo, r.caseNumber, r.caseYear], ["W.P.(C)-8028/2025", 8028, 2025]);
eq("type from the hidden code", [r.caseTypeCode, r.caseTypeLabel], ["CW", "W.P.(C)"]);
eq("neutral citation", r.neutralCitation, "2025:DHC:4853-DB");
eq("order date", r.orderDate, "2025-05-30");
eq("pdf + txt links", [r.pdfUrl, r.txtUrl], [
  "https://delhihighcourt.nic.in/app/showFileJudgment/PMS30052025CW80282025_174112.pdf",
  "https://delhihighcourt.nic.in/app/showFileJudgment/PMS30052025CW80282025_174112.txt",
]);
eq("parties", [r.petitioner, r.respondent], ["M/S LALA SHIVNATH RAI SUMERCHAND CONFECTIONER PRIVATE LIMITED", "ADDITIONAL COMMISSIONER, CGST DELHI-WEST, NEW DELHI"]);
eq("NA and - read as empty", [r.corrigendum, r.uploadedOn, r.remark], [null, null, null]);
eq("every row typed", res.rows.map((x) => x.caseTypeLabel), ["LPA", "W.P.(C)", "FAO (COMM)", "CRL.A.", "CS(COMM)", "SERTA"]);
eq("codes kept", res.rows.map((x) => x.caseTypeCode), ["LPA", "CW", "FAOC", "CRLA", "SC", "SERTA"]);
eq("citation without bench suffix", res.rows[4].neutralCitation, "2025:DHC:4674");
eq("serials", res.rows.map((x) => x.serial), [1, 2, 25, 39, 41, 99]);
ok("row html kept", res.rows.every((x) => x.html.startsWith("<tr>")));
eq("dedupe key is the pdf", p.dedupeKey(r), r.pdfUrl);
ok("judgment links recognised", p.isJudgmentUrl(r.pdfUrl) && p.isJudgmentUrl(r.txtUrl) && !p.isJudgmentUrl("https://example.com/x.pdf"));

const empty = p.parseJudgeResults('<table><tbody><tr><td colspan="7" class="dt-empty">No data available in table</td></tr></tbody></table>', "Showing 0 to 0 of 0 entries");
eq("empty table", [empty.rows.length, empty.total], [0, 0]);

// ── random windows ─────────────────────────────────────────────────────────
const today = "2026-10-23";
for (let i = 0; i < 200; i++) {
  const win = w.randomWindow({ earliest: "2018-01-01", days: 30, today, avoid: [] });
  if (!(win.from >= "2018-01-01" && win.to < today && w.daysBetween(win.from, win.to) === 29)) {
    ok("windows stay in range and are 30 days", false, JSON.stringify(win));
    break;
  }
  if (i === 199) ok("windows stay in range and are 30 days", true);
}
const avoid = [{ from: "2020-01-01", to: "2020-12-31" }];
let overlap = 0;
for (let i = 0; i < 200; i++) {
  const win = w.randomWindow({ earliest: "2020-01-01", days: 30, today: "2021-03-01", avoid });
  if (win.from <= "2020-12-31" && win.to >= "2020-01-01") overlap++;
}
ok("tried windows are avoided when there is room", overlap === 0, `${overlap} overlapped`);
eq("dd-mm-yyyy for the court's form", w.toDmy("2025-01-09"), "09-01-2025");
eq("ten years back", w.yearsBefore("2026-10-23", 10), "2016-10-23");
eq("29 February a year back is the 28th", w.yearsBefore("2028-02-29", 1), "2027-02-28");

// ── a whole list, as the extension sends it ────────────────────────────────
// Every row from every page, wrapped in a bare table: header kept, nothing else of the page.
const bare = `<table id="s_judgeTable">${html.match(/<thead[\s\S]*?<\/thead>/i)?.[0] ?? ""}<tbody>${(html.match(/<tbody[\s\S]*?<\/tbody>/i)?.[0] ?? "").replace(/^<tbody[^>]*>|<\/tbody>$/gi, "")}</tbody></table>`;
const whole = p.parseJudgeResults(bare, "Showing 1 to 7,012 of 7,012 entries");
eq("bare table reads the same rows", whole.rows.map((x) => x.caseNo), res.rows.map((x) => x.caseNo));
eq("court's code survives in a bare table", whole.rows[1].caseTypeCode, res.rows[1].caseTypeCode);
eq("thousands separator in the total", whole.total, 7012);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
