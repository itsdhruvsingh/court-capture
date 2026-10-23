/**
 * Applies every migration (0050–0054) to a throwaway Postgres 14 — the version
 * Supabase runs — and exercises the High Court functions.
 *
 *   node scripts/test-sql.mjs
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import EmbeddedPostgres from "embedded-postgres";
import postgres from "postgres";

const PORT = 54332;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "court-pg-"));
const pg = new EmbeddedPostgres({ databaseDir: dir, user: "postgres", password: "pw", port: PORT, persistent: false, initdbFlags: ["--encoding=UTF8", "--locale=C"] });
await pg.initialise();
await pg.start();
const sql = postgres({ host: "localhost", port: PORT, user: "postgres", password: "pw", database: "postgres", onnotice: () => {} });

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { c ? pass++ : fail++; console.log(`${c ? "  ok  " : "FAIL  "}${n}${c ? "" : `\n        ${d}`}`); };

const row = (n, extra = {}) => ({
  dedupeKey: `https://delhihighcourt.nic.in/app/showFileJudgment/${n}.pdf`,
  caseNo: `W.P.(C)-${n}/2025`, caseTypeLabel: "W.P.(C)", caseTypeCode: "CW", caseNumber: n, caseYear: 2025,
  neutralCitation: null, orderDate: `2025-03-0${(n % 9) + 1}`, petitioner: "A", respondent: "B",
  corrigendum: null, uploadedOn: null, remark: null, pdfUrl: `https://delhihighcourt.nic.in/app/showFileJudgment/${n}.pdf`, txtUrl: null,
  html: "<tr></tr>", ...extra,
});

try {
  await sql.unsafe(`create role anon; create role authenticated; create role service_role;`);
  for (const f of fs.readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort()) {
    await sql.unsafe(fs.readFileSync(`supabase/migrations/${f}`, "utf8"));
  }
  await sql.unsafe(fs.readFileSync("supabase/migrations/0053_high_court.sql", "utf8"));
  ok("0050–0054 apply, 0053 re-runs", true);

  // ── claims ──────────────────────────────────────────────────────────────
  const judges = [];
  for (const [code, name] of [["100", "JUSTICE A"], ["101", "JUSTICE B"], ["102", "JUSTICE C"]]) {
    judges.push((await sql`insert into hc_judges (code, name) values (${code}, ${name}) returning id`)[0].id);
  }
  const [run] = await sql`insert into hc_runs (label) values ('test') returning id`;
  const tasks = [];
  for (let i = 0; i < 3; i++) {
    tasks.push((await sql`insert into hc_tasks (run_id, seq, judge_id, judge_code, judge_name, wanted) values (${run.id}, ${i + 1}, ${judges[i]}, ${String(100 + i)}, ${"J" + i}, 20) returning id`)[0].id);
  }
  const claim = async (cap) => (await sql`select hc_claim_task(${run.id}, ${cap}, ${cap + "@x.in"}, 300) as id`)[0].id;
  const a = await claim("A"), b = await claim("B");
  ok("two people get different judges", a === tasks[0] && b === tasks[1], `${a} ${b}`);
  ok("a person keeps the judge they hold", (await claim("A")) === tasks[0]);
  ok("third person gets the last judge", (await claim("C")) === tasks[2]);
  ok("nothing left for a fourth", (await claim("D")) === null);
  await sql`update hc_tasks set claimed_until = now() - interval '1 second' where id = ${tasks[1]}`;
  ok("lapsed claim is taken over", (await claim("D")) === tasks[1]);
  await sql`update hc_tasks set status = 'done' where id = ${tasks[0]}`;
  ok("finished judge is not handed out again", (await claim("A")) === null);

  // ── ingest ──────────────────────────────────────────────────────────────
  const ingest = async (judge, need, rows) => (await sql`select hc_ingest_rows(${sql.json({ judge_id: judge, run_id: run.id, need, rows })}) as n`)[0].n;
  const count = async (t) => (await sql`select count(*)::int as n from ${sql(t)}`)[0].n;
  ok("stops at `need`", (await ingest(judges[0], 3, [1, 2, 3, 4, 5].map((n) => row(n)))) === 3 && (await count("hc_judgments")) === 3);
  ok("already linked rows don't count", (await ingest(judges[0], 5, [row(1), row(2), row(6)])) === 1 && (await count("hc_judgments")) === 4);
  ok("a bench: same judgment, second judge", (await ingest(judges[1], 5, [row(1)])) === 1 && (await count("hc_judgments")) === 4 && (await count("hc_judgment_judges")) === 5);
  ok("need 0 saves nothing", (await ingest(judges[2], 0, [row(9)])) === 0 && (await count("hc_judgments")) === 4);
  await ingest(judges[0], 5, [row(1, { caseTypeCode: "ZZ", neutralCitation: "2025:DHC:1" })]);
  const [g] = await sql`select case_type_code, neutral_citation from hc_judgments where case_number = 1`;
  ok("re-seen row fills blanks, keeps its type", g.case_type_code === "CW" && g.neutral_citation === "2025:DHC:1", JSON.stringify(g));

  const [js] = await sql`select judgments::int from hc_judge_stats_v where id = ${judges[0]}`;
  const [st] = await sql`select judgments::int, judges::int from hc_stats_v`;
  ok("views count judgments per judge and overall", js.judgments === 4 && st.judgments === 4 && st.judges === 2, JSON.stringify({ js, st }));

  // ── summaries are written once ──────────────────────────────────────────
  const [{ id: gid }] = await sql`select id from hc_judgments where case_number = 1`;
  const sum = async () => (await sql`select hc_claim_summary(${gid}) as ok`)[0].ok;
  ok("first summary claim wins", (await sum()) === true);
  ok("second claim while generating loses", (await sum()) === false);
  await sql`update hc_judgments set summary_status = 'failed' where id = ${gid}`;
  ok("a failed summary can be retried", (await sum()) === true);
  await sql`update hc_judgments set summary_started_at = now() - interval '6 minutes' where id = ${gid}`;
  ok("a stuck one is retried after 5 minutes", (await sum()) === true);
  await sql`update hc_judgments set summary = '{}'::jsonb, summary_status = null where id = ${gid}`;
  ok("a written summary is never redone", (await sum()) === false);

  // ── counters ────────────────────────────────────────────────────────────
  await Promise.all(
    Array.from({ length: 40 }, (_, i) =>
      sql`select hc_touch_run(${run.id}, ${sql.json({ searches: 1, judgments: 2 })}, ${i % 2 ? "ravi" : "asha"}, ${sql.json({ cases: 2, captchas: 1 })}, ${sql.json([{ at: "t", text: `line ${i}` }])}, ${null}, ${false})`
    )
  );
  const [r] = await sql`select stats, jsonb_array_length(activity) as n from hc_runs where id = ${run.id}`;
  ok("40 concurrent touches all counted", r.stats.searches === 40 && r.stats.judgments === 80, JSON.stringify(r.stats));
  ok("per-person counts", r.stats.people.ravi.cases === 40 && r.stats.people.asha.captchas === 20, JSON.stringify(r.stats.people));
  for (let i = 0; i < 30; i++) await sql`select hc_touch_run(${run.id}, '{}'::jsonb, ${null}, '{}'::jsonb, ${sql.json([{ at: "t", text: `more ${i}` }])}, ${null}, ${false})`;
  const [r2] = await sql`select jsonb_array_length(activity) as n, activity -> -1 ->> 'text' as last from hc_runs where id = ${run.id}`;
  ok("activity capped at 60, newest last", r2.n === 60 && r2.last === "more 29", JSON.stringify(r2));

  // ── distributions (0054) ────────────────────────────────────────────────
  // One district search for code 76: each establishment lists a different printed type.
  const block = (est, name, total, label, n) => ({ estCode: est, establishment: name, total, rows: Array.from({ length: n }, (_, i) => ({ typeLabel: label, caseNumber: `${label}/${i + 1}/2026` })) });
  const blocks = [block("DLST01", "District Judge", 6, "ARB. A.(COMM.)", 6), block("DLST02", "CMM", 18049, "CC NI ACT", 25), block("DLST04", "Family Court", 0, null, 0)];
  await sql`insert into court_search_results (case_type_code, reg_year, case_status, outcome, blocks, captured_at) values ('76', 2026, 'P', 'results', ${sql.json(blocks)}, now() - interval '1 day')`;
  await sql`insert into court_search_results (case_type_code, reg_year, case_status, outcome, blocks) values ('76', 2026, 'P', 'results', ${sql.json([block("DLST02", "CMM", 18100, "CC NI ACT", 25)])})`;
  const totals = await sql`select est_code, type_label, total from court_type_totals_v order by est_code`;
  ok("district totals follow the printed type, per establishment", totals.length === 2 && totals[0].type_label === "ARB. A.(COMM.)" && totals[1].type_label === "CC NI ACT", JSON.stringify(totals));
  ok("the newest search's count wins", totals[1].total === 18100, JSON.stringify(totals[1]));

  // High Court: judge 100 has a narrow window and a whole-range list; judge 101 shares one judgment (a bench).
  const hrow = (n, code, date) => ({ caseNo: `X-${n}/2025`, caseTypeCode: code, orderDate: date, pdfUrl: `https://dhc/${n}.pdf` });
  // Cases 1 and 5 are connected matters decided by one common judgment (one PDF, two entries).
  const listA = [hrow(1, "CW", "2025-01-02"), hrow(2, "CW", "2024-05-06"), hrow(3, "LPA", "2025-03-04"), { ...hrow(5, "CW", "2025-01-02"), pdfUrl: "https://dhc/1.pdf" }];
  await sql`insert into hc_search_results (judge_code, judge_name, from_date, to_date, outcome, listed_total, rows) values ('100', 'JUSTICE A', '2016-10-23', '2026-10-23', 'results', 4, ${sql.json(listA)})`;
  await sql`insert into hc_search_results (judge_code, judge_name, from_date, to_date, outcome, listed_total, rows) values ('100', 'JUSTICE A', '2025-01-01', '2025-01-30', 'results', 1, ${sql.json([hrow(1, "CW", "2025-01-02")])})`;
  await sql`insert into hc_search_results (judge_code, judge_name, from_date, to_date, outcome, listed_total, rows) values ('101', 'JUSTICE B', '2016-10-23', '2026-10-23', 'results', 2, ${sql.json([hrow(3, "LPA", "2025-03-04"), hrow(4, "CRLA", "2023-07-08")])})`;
  const lists = await sql`select judge_code, read_total from hc_judge_lists_v order by judge_code`;
  ok("a judge's list is their widest search", lists.length === 2 && lists[0].read_total === 4, JSON.stringify(lists));
  const jt = Object.fromEntries((await sql`select type_code, judgments from hc_judge_type_counts_v where judge_code = '100'`).map((x) => [x.type_code, x.judgments]));
  ok("per judge, by case type", jt.CW === 3 && jt.LPA === 1, JSON.stringify(jt));
  const jy = Object.fromEntries((await sql`select year, judgments from hc_judge_year_counts_v where judge_code = '100'`).map((x) => [x.year, x.judgments]));
  ok("per judge, by year", jy[2025] === 3 && jy[2024] === 1, JSON.stringify(jy));
  const tc = Object.fromEntries((await sql`select type_code, judgments from hc_type_counts_v`).map((x) => [x.type_code, x.judgments]));
  ok("a bench's entry counts once; connected cases each count", tc.CW === 3 && tc.LPA === 1 && tc.CRLA === 1, JSON.stringify(tc));

  // ── access ──────────────────────────────────────────────────────────────
  let denied = false;
  try {
    await sql.begin(async (tx) => { await tx.unsafe("set local role anon"); await tx`select hc_claim_task(${run.id}, 'x', 'x', 300)`; });
  } catch (e) { denied = /permission denied/.test(e.message); }
  ok("anon cannot call the functions", denied);
  await sql`grant select on hc_judgments to anon`; // as Supabase's default grants do
  const seen = await sql.begin(async (tx) => { await tx.unsafe("set local role anon"); return (await tx`select count(*)::int as n from hc_judgments`)[0].n; });
  ok("row security hides judgments from anon", seen === 0, `saw ${seen}`);
  let viewDenied = false;
  try {
    await sql.begin(async (tx) => { await tx.unsafe("set local role anon"); await tx`select * from hc_type_counts_v`; });
  } catch (e) { viewDenied = /permission denied/.test(e.message); }
  ok("anon cannot read the distribution views", viewDenied);
} catch (e) {
  fail++;
  console.error("FAIL", e.message, e.position ?? "");
} finally {
  await sql.end();
  await pg.stop();
  fs.rmSync(dir, { recursive: true, force: true });
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
