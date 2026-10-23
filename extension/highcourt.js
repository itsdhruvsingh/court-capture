/**
 * Court Capture — High Court of Delhi driver ("Sitting Judges wise" search).
 *
 * The court's page: pick a judge and a date range, type the 4-digit code it
 * shows, press Submit. The code is checked, then the whole page reloads with
 * the results table. So this driver keeps the search it started in storage
 * ("pending"), and on the reloaded page — recognised because the form still
 * holds that judge and those dates — reads the table and reports it.
 *
 * A judge's first search covers years, so the table can list thousands of
 * judgments. They are all in the page already (the table pages them in the
 * browser), so the driver shows them on one page, reads every row and sends
 * the list compressed; the app keeps a random sample.
 *
 * The code on this page is printed in plain text; the person still types it.
 * It is a human check, and this extension never fills one.
 */
(() => {
  const CC = window.__ccCore;
  if (!CC || window.__ccHighCourt) return;
  window.__ccHighCourt = true;
  const { $, sleep, Stop } = CC;

  const PENDING = "hcPending";
  const loadedAt = Date.now();
  /** A page left open this long has an expired session; reload before searching. */
  const PAGE_MAX_AGE_MS = 10 * 60_000;

  const form = () => ({
    judge: $("#s_judge_name"),
    from: $("#from_date"),
    to: $("#to_date"),
    input: $("#captchaInput"),
    submit: $("#search"),
  });

  const tableInfo = () => document.querySelector("#s_judgeTable_info, #s_judgeTable_wrapper .dt-info");
  const emptyCell = () => $("#s_judgeTable td.dt-empty, #s_judgeTable td.dataTables_empty");
  const bodyRows = () => [...document.querySelectorAll("#s_judgeTable tbody tr")].filter((tr) => !tr.querySelector("td.dt-empty, td.dataTables_empty"));

  /** The court's alert box (SweetAlert), if one is showing. */
  function swal() {
    const pop = document.querySelector(".swal2-popup");
    if (!pop || !CC.shown(pop)) return null;
    const box = pop.querySelector(".swal2-html-container, .swal2-content") || pop.querySelector(".swal2-title") || pop;
    const text = (box.textContent || "").replace(/\s+/g, " ").trim();
    if (/incorrect/i.test(text)) return { kind: "wrong", pop };
    if (/validation failed|try again later/i.test(text)) return { kind: "expired", pop };
    return { kind: "alert", text, pop };
  }

  function closeSwal(pop) {
    const ok = pop.querySelector(".swal2-confirm") || document.querySelector(".swal2-confirm");
    if (ok) ok.click();
  }

  /** Is this page the result of the search we started? */
  function isResultsFor(p) {
    const f = form();
    return !!f.judge && f.judge.value === p.judgeCode && f.from.value === p.fromDmy && f.to.value === p.toDmy;
  }

  /** Every row of the table: shown on one page (a length of -1 is "all"), or else page by page. */
  async function allRows(total) {
    const len = document.querySelector('select[name="s_judgeTable_length"], #s_judgeTable_wrapper .dt-length select, #s_judgeTable_length select');
    if (len) {
      if (![...len.options].some((o) => o.value === "-1")) len.add(new Option("All", "-1"));
      len.value = "-1";
      CC.fire(len, "change");
      const t0 = Date.now();
      while (Date.now() - t0 < 20000 && bodyRows().length < total) await sleep(250);
    }
    if (bodyRows().length >= total) return bodyRows().map((tr) => tr.outerHTML);
    const seen = new Set();
    for (let i = 0; i < 5000 && seen.size < total; i++) {
      for (const tr of bodyRows()) seen.add(tr.outerHTML);
      const next = document.querySelector("#s_judgeTable_wrapper .dt-paging-button.next, #s_judgeTable_next, #s_judgeTable_wrapper .paginate_button.next");
      if (!next || next.classList.contains("disabled") || next.getAttribute("aria-disabled") === "true" || next.disabled) break;
      next.click();
      await sleep(40);
    }
    return [...seen];
  }

  async function gzip64(text) {
    const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
    const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }

  async function readResults() {
    await CC.waitFor(() => tableInfo() || emptyCell(), 15000, "show its results");
    const info = (tableInfo()?.textContent || "").trim();
    const total = Number((info.match(/of\s+([\d,]+)\s+entries/i) || [])[1]?.replace(/,/g, "")) || 0;
    if (emptyCell() || !total) return { empty: true, info };
    CC.ui.status(`Reading ${total.toLocaleString("en-IN")} judgments from the list…`);
    const rows = await allRows(total);
    const head = $("#s_judgeTable")?.tHead?.outerHTML || "";
    return { empty: false, info, gz: await gzip64(`<table id="s_judgeTable">${head}<tbody>${rows.join("")}</tbody></table>`) };
  }

  async function report(p) {
    const r = await readResults();
    const eff = CC.effort({ prompts: p.prompts || 1, startedAt: p.startedAt });
    const res = await CC.call(CC.apiPath("highcourt", "results"), "POST", {
      runId: p.runId,
      taskId: p.taskId,
      from: p.from,
      to: p.to,
      report: r.empty ? { kind: "empty" } : { kind: "results", gz: r.gz, info: r.info },
      effort: eff.done(),
    });
    await CC.store.remove(PENDING);
    CC.ui.status(res.added ? `Saved ${res.added} judgment${res.added === 1 ? "" : "s"}.` : "Nothing new in that search.");
    return res.next;
  }

  async function doSearch(a) {
    CC.ui.status(`Searching ${a.context}`);
    CC.ui.canSkip(false);
    const pending = { ...a, startedAt: Date.now(), prompts: 0 };

    if (Date.now() - loadedAt > PAGE_MAX_AGE_MS) {
      location.reload();
      throw new Stop();
    }

    const f = form();
    if (!f.judge || !f.input || !f.submit) throw new Error("The High Court's search form has changed.");
    if (![...f.judge.options].some((o) => o.value === a.judgeCode)) {
      const res = await CC.call(CC.apiPath("highcourt", "results"), "POST", { runId: a.runId, taskId: a.taskId, from: a.from, to: a.to, report: { kind: "missing" } });
      return res.next;
    }

    f.judge.value = a.judgeCode;
    CC.fire(f.judge, "change");
    f.from.value = a.fromDmy;
    CC.fire(f.from, "change");
    f.to.value = a.toDmy;
    CC.fire(f.to, "change");
    f.input.value = "";
    await CC.store.set(PENDING, pending);

    const eff = CC.effort();
    for (;;) {
      // A correct code reloads the page, ending this script; the next page reports.
      const out = await CC.waitForPerson({
        input: f.input,
        box: f.input.closest(".form-group") || f.input,
        context: `Search · ${a.context}`,
        eff,
        submitButton: f.submit,
        onSubmit: (n) => CC.store.set(PENDING, { ...pending, prompts: n }),
        check: swal,
      });
      if (out.pop) closeSwal(out.pop);
      if (out.kind === "expired") {
        // The page's session ran out; a fresh page gets a fresh one.
        location.reload();
        throw new Stop();
      }
      if (out.kind !== "alert" || /captcha/i.test(out.text)) {
        CC.ui.error("That code didn't match. Type the one shown and press Enter again.");
        await sleep(300);
        continue;
      }
      // The court refused the search itself (dates, judge): the app picks another.
      await CC.store.remove(PENDING);
      const res = await CC.call(CC.apiPath("highcourt", "results"), "POST", {
        runId: a.runId,
        taskId: a.taskId,
        from: a.from,
        to: a.to,
        report: { kind: "error", message: out.text.slice(0, 480) },
        effort: eff.done(),
      });
      return res.next;
    }
  }

  /** The judge list as the page shows it, sent to the app twice a day so new judges join runs. */
  async function syncJudges() {
    const last = await CC.store.get("hcJudgesSyncedAt");
    if (last && Date.now() - last < 12 * 3600_000) return;
    const sel = $("#s_judge_name");
    if (!sel) return;
    const judges = [...sel.options].filter((o) => o.value).map((o) => ({ code: o.value, name: o.textContent.replace(/\s+/g, " ").trim() }));
    if (judges.length < 5) return;
    try {
      await CC.call(CC.apiPath("highcourt", "judges"), "POST", { judges });
      await CC.store.set("hcJudgesSyncedAt", Date.now());
    } catch {}
  }

  async function start() {
    const p = await CC.store.get(PENDING);
    if (p && p.runId) {
      CC.state.runId = p.runId;
      if (isResultsFor(p) && Date.now() - p.startedAt < 30 * 60_000) {
        CC.state.running = true; // so waitFor can run before the loop takes over
        try {
          const next = await report(p);
          CC.state.running = false;
          return CC.loop({ step: doSearch, first: next });
        } catch (e) {
          CC.state.running = false;
          CC.ui.error(e.message || String(e));
          return;
        }
      }
      // A search started before a reload (expired session, page reopened): the app hands it out again.
      await CC.store.remove(PENDING);
    }
    return CC.loop({ step: doSearch });
  }

  CC.boot({ court: "highcourt", title: "High Court of Delhi", start }).then(() => syncJudges());
})();
