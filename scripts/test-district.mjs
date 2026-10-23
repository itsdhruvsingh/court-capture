/**
 * Unit tests for the district-court parsers — pure, no network, no DB.
 *
 *   node scripts/test-district.mjs
 *
 * The fixtures in scripts/data/ecourts-*.html are real responses captured from
 * southdelhi.dcourts.gov.in (trimmed to a few rows). If the court changes its
 * markup, re-capture them and these tests say exactly which field broke.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const req = createRequire(path.resolve("scripts/test-district.mjs"));
req("./lib/tsx-require.cjs");

const p = req(path.resolve("lib/district/parse.ts"));

let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => {
  cond ? pass++ : fail++;
  console.log(`${cond ? "  ok  " : "FAIL  "}${name}${cond ? "" : `\n        ${detail}`}`);
};
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

// ── dates ──────────────────────────────────────────────────────────────────
eq("date dd-mm-yyyy", p.parseDate("24-12-2024 "), "2024-12-24");
eq("date dd-Month-yyyy", p.parseDate("24-December-2024"), "2024-12-24");
eq("date dd Mon yyyy", p.parseDate("1st Feb 2027"), "2027-02-01");
eq("date iso", p.parseDate("2026-10-01"), "2026-10-01");
eq("date dd/mm/yyyy", p.parseDate("09/05/2025"), "2025-05-09");
eq("date junk", p.parseDate("Not listed"), null);

// ── advocates ──────────────────────────────────────────────────────────────
eq("advocate key strips honorifics", p.advocateKey("Sh. Pratap Singh Rawat, Adv."), "PRATAP SINGH RAWAT");
eq("advocate key is case-blind", p.advocateKey("pratap  singh RAWAT"), "PRATAP SINGH RAWAT");
eq("advocate split on comma", p.splitAdvocates("A K Sharma, Ritu Jain; Advocate- Mohan Lal"), ["A K Sharma", "Ritu Jain", "Mohan Lal"]);
eq("advocate keeps firms whole", p.splitAdvocates("Singh and Associates"), ["Singh and Associates"]);
eq("title case", p.titleName("PRATAP SINGH RAWAT"), "Pratap Singh Rawat");

// ── case number ────────────────────────────────────────────────────────────
eq("case number", p.parseCaseNumber("CS DJ/4290/2024"), { typeLabel: "CS DJ", number: 4290, year: 2024 });
eq("case number with dots", p.parseCaseNumber("ARB. A.(COMM.)/12/2026"), { typeLabel: "ARB. A.(COMM.)", number: 12, year: 2026 });

// ── search results ─────────────────────────────────────────────────────────
const results = p.parseSearchResults(fs.readFileSync("scripts/data/ecourts-search-results.html", "utf8"));
eq("two establishment blocks", results.map((b) => b.estCode), ["DLST01", "DLST04"]);
eq("block totals", results.map((b) => b.total), [549, 20]);
const first = results[0].rows[0];
eq("row cnr", first.cnr, "DLST010153882024");
eq("row number", [first.typeLabel, first.number, first.year], ["CS DJ", 4290, 2024]);
eq("row parties", [first.petitioner, first.respondent], ["Goyal Publishers and Distributors Private Limited", "Preeti Bhutani"]);
ok("family court rows are masked", results[1].rows.every((r) => r.masked));
ok("district rows are not masked", results[0].rows.every((r) => !r.masked));

const newest = p.pickNewest(results, "CS DJ", 4, new Set(["DLST010152782024"]));
eq("pickNewest prefers the searched type, newest first, skips known", newest.map((r) => r.caseNumber), [
  "CS DJ/4290/2024", "CS DJ/4285/2024", "CS/10/2024", "CS/9/2024",
]);

// ── case details ───────────────────────────────────────────────────────────
const d = p.parseCaseDetails(fs.readFileSync("scripts/data/ecourts-detail-civil.html", "utf8"));
eq("cnr", d.cnr, "DLST010153882024");
eq("case type", [d.caseTypeLabel, d.caseTypeFull], ["CS DJ", "CS DJ - CIVIL SUIT FOR DJ ADJ"]);
eq("registration", [d.registrationNumber, d.caseNo, d.caseYear, d.registrationDate], ["4290/2024", 4290, 2024, "2024-12-24"]);
eq("filing", [d.filingNumber, d.filingDate], ["26957/2024", "2024-12-24"]);
eq("status block", [d.firstHearingDate, d.nextHearingDate, d.status, d.stage, d.courtJudge], [
  "2024-12-24", "2027-02-01", "pending", "Issues", "202-District Judge - 02",
]);
eq("petitioner", d.petitioners, [{ index: 1, name: "Goyal Publishers and Distributors Private Limited", advocate: "PRATAP SINGH RAWAT", advocates: ["PRATAP SINGH RAWAT"], lines: ["1) Goyal Publishers and Distributors Private Limited", "Advocate - PRATAP SINGH RAWAT"] }]);
eq("respondent without advocate", d.respondents, [{ index: 1, name: "Preeti Bhutani", advocate: null, advocates: [], lines: ["1) Preeti Bhutani"] }]);
eq("every table kept verbatim", d.tables.map((t) => t.caption), ["Case Details", "Case Status", "Acts", "Case History", "Orders", "Process Details", "Case Transfer Details within Establishment"]);
eq("parsed tables keep their raw rows too", d.tables[0].rows[0]["Filing Number"], "26957/2024");
eq("sections in page order", d.sections.slice(0, 5), ["District and Sessions Judge, South, Saket", "Case Details", "Case Status", "Petitioner and Advocate", "Respondent and Advocate"]);
eq("acts", d.acts, [{ act: "Permanent Injuction", sections: "39" }]);
eq("hearings", d.hearings.map((h) => [h.seq, h.judge, h.businessDate, h.nextDate, h.purpose]), [
  [1, "District Judge - 06", "2024-12-24", "2025-01-16", "Misc./ Appearance (Civil)"],
  [2, "District Judge - 06", "2025-01-16", "2025-02-18", "Misc./ Appearance (Civil)"],
  [3, "District Judge - 02", "2026-10-01", "2027-02-01", "Issues"],
]);
eq("hearing business blob decoded", d.hearings[0].business?.pet_adv, "PRATAP SINGH RAWAT");
eq("orders", d.orders.map((o) => [o.kind, o.orderNo, o.orderDate, o.label]), [
  ["interim", 1, "2024-12-24", "COPY OF JUDICIAL PROCEEDINGS"],
  ["interim", 2, "2025-01-16", "COPY OF JUDICIAL PROCEEDINGS"],
  ["interim", 15, "2026-10-01", "COPY OF ORDER"],
]);
ok("order url is the court's pdf endpoint", /action=get_order_pdf&input_strings=/.test(d.orders[2].sourceUrl ?? ""), d.orders[2].sourceUrl);
eq("order link decodes", p.decodeOrderLink(d.orders[2].sourceUrl), { cino: "DLST010153882024", order_no: "15", order_date: "2026-10-01" });
eq("extra tables kept", d.extra.map((t) => t.caption), ["Process Details", "Case Transfer Details within Establishment"]);
eq("transfer row", d.extra[1].rows[0]["Transfer Date"], "21-09-2026");
eq("not masked", d.masked, false);
eq("title", p.caseTitle(d.petitioners, d.respondents), "Goyal Publishers and Distributors Private Limited vs Preeti Bhutani");

// ── disposed shape, synthesised from the live markup's column names ─────────
const disposed = p.parseCaseDetails(`
  <table><caption>Case Details</caption><thead><tr><th>Case Type</th><th>Registration Number</th><th>CNR Number</th></tr></thead>
  <tbody><tr><td data-th="Case Type">ARBTN - ARBITRATION</td><td data-th="Registration Number">12/2020</td><td data-th="CNR Number">DLST010000122020</td></tr></tbody></table>
  <table><caption>Case Status</caption><thead><tr><th>First Hearing Date</th><th>Decision Date</th><th>Case Status</th><th>Nature of Disposal</th><th>Court Number and Judge</th></tr></thead>
  <tbody><tr><td data-th="First Hearing Date">03-February-2020</td><td data-th="Decision Date">14th March 2023</td><td data-th="Case Status">Case disposed</td><td data-th="Nature of Disposal">Contested--ALLOWED</td><td data-th="Court Number and Judge">5-District Judge (Commercial) - 01</td></tr></tbody></table>
  <h5>Petitioner and Advocate</h5><div class="Petitioner"><ul><li><p>1) ABC LTD</p> Advocate - Sh. R K Gupta, Meera Nair</li><li><p>2) XYZ PVT LTD</p></li></ul></div>
  <h5>Respondent and Advocate</h5><div class="respondent"><ul><li><p>1) UNION OF INDIA</p> Advocate- CGSC</li></ul></div>
  <table><caption>Final Orders / Judgements</caption><thead><tr><th>Order Number</th><th>Order Date</th><th>Order Details</th></tr></thead>
  <tbody><tr><td data-th="Order Number">1</td><td data-th="Order Date">14-03-2023</td><td data-th="Order Details"><a href="https://southdelhi.dcourts.gov.in/wp-admin/admin-ajax.php?es_ajax_request=1&action=get_order_pdf&input_strings=eyJjaW5vIjoiRExTVDAxMDAwMDEyMjAyMCIsIm9yZGVyX25vIjoiMSIsIm9yZGVyX2RhdGUiOiIyMDIzLTAzLTE0In0">JUDGEMENT</a></td></tr></tbody></table>
`);
eq("disposed status", [disposed.status, disposed.decisionDate, disposed.natureOfDisposal], ["disposed", "2023-03-14", "Contested--ALLOWED"]);
eq("multiple advocates on one party", disposed.petitioners[0].advocates, ["R K Gupta", "Meera Nair"]);
eq("second petitioner with none", disposed.petitioners[1].advocates, []);
eq("final order kind", disposed.orders.map((o) => [o.kind, o.orderNo, o.label]), [["final", 1, "JUDGEMENT"]]);

// A label/value table and a party entry with an address line.
const kv = p.parseCaseDetails(`
  <table><caption>Subordinate Court Information</caption>
    <tr><th>Court Number and Name</th><td>12 - MM South</td></tr>
    <tr><th>Case Number and Year</th><td>CC 345/2021</td></tr>
    <tr><th>Case Decision Date</th><td>01-02-2023</td></tr>
  </table>
  <h5>Petitioner and Advocate</h5><div class="Petitioner"><ul><li><p>1) STATE</p>Address - PS Saket<br> Advocate - APP for the State</li></ul></div>`);
eq("label/value table reads as one record", kv.tables[0].rows, [{ "Court Number and Name": "12 - MM South", "Case Number and Year": "CC 345/2021", "Case Decision Date": "01-02-2023" }]);
eq("label/value table lands in extra", kv.extra.map((t) => t.caption), ["Subordinate Court Information"]);
eq("party address line kept", kv.petitioners[0].lines, ["1) STATE", "Address - PS Saket", "Advocate - APP for the State"]);
eq("advocate still found after an address line", kv.petitioners[0].advocates, ["APP for the State"]);

// ── case types ─────────────────────────────────────────────────────────────
const types = p.parseCaseTypes('<option value="">--Select Case Type--</option><option value="76">ARB. A.(COMM.)</option><option value="61">ARBTN</option><option value="61">ARBTN</option>');
eq("case types", types, [{ code: "76", name: "ARB. A.(COMM.)" }, { code: "61", name: "ARBTN" }]);

// ── the court's bot check is recognised, never retried into ───────────────
const site = req(path.resolve("lib/district/site.ts"));
const { CourtChallenge } = req(path.resolve("lib/polite.ts"));
const realFetch = globalThis.fetch;
const pdfUrl = "https://southdelhi.dcourts.gov.in/wp-admin/admin-ajax.php?es_ajax_request=1&action=get_order_pdf&input_strings=eyJ9";
const answer = (body, type) => async () => new Response(body, { status: 200, headers: { "content-type": type } });
globalThis.fetch = answer("<html><title>Security Verification</title><link rel=stylesheet></html>", "text/html; charset=UTF-8");
let caught = null;
try { await site.fetchOrderPdf(pdfUrl); } catch (e) { caught = e; }
ok("security verification page → CourtChallenge", caught instanceof CourtChallenge, String(caught));
globalThis.fetch = answer("%PDF-1.7 fake", "application/pdf");
eq("a real PDF still comes through", (await site.fetchOrderPdf(pdfUrl)).subarray(0, 5).toString(), "%PDF-");
caught = null;
try { await site.fetchOrderPdf("https://example.com/x.pdf"); } catch (e) { caught = e; }
ok("non-court URLs are refused", caught && /not a court order link/.test(caught.message), String(caught));
globalThis.fetch = realFetch;

// ── extension tokens ───────────────────────────────────────────────────────
process.env.SUPABASE_SECRET_KEY ||= "test-secret-for-tokens";
const tok = req(path.resolve("lib/token.ts"));
const minted = tok.mintCaptureToken({ id: "u1", name: "Asha", email: null });
eq("token verifies", tok.verifyCaptureToken(minted.token)?.sub, "u1");
// Tamper with the signature's FIRST character: its last one carries base64 padding bits a decoder ignores.
const [tb, ts] = minted.token.split(".");
ok("tampered token is refused", tok.verifyCaptureToken(`${tb}.${ts[0] === "A" ? "B" : "A"}${ts.slice(1)}`) === null);
ok("forged body is refused", tok.verifyCaptureToken(Buffer.from('{"sub":"x","name":"x","exp":9999999999}').toString("base64url") + "." + minted.token.split(".")[1]) === null);
ok("expired token is refused", tok.verifyCaptureToken(minted.token, Date.now() + 31 * 86400_000) === null);
ok("garbage is refused", tok.verifyCaptureToken("not-a-token") === null && tok.verifyCaptureToken("") === null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
