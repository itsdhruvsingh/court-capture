/**
 * Court Capture — District court driver (southdelhi.dcourts.gov.in, Saket).
 *
 * Drives the court's own "search by case type" page as a person would: picks
 * the Saket complex, the case type, the year and pending/disposed; after the
 * person types the captcha and presses Enter it reads the result list, then
 * opens each case with the page's own "View" link. When the court asks for a
 * captcha before a case page, it points at the box and waits again. After a
 * case is saved it downloads that case's order PDFs from the court's own
 * links in the background, one at a time, and hands them to the app.
 */
(() => {
  const CC = window.__ccCore;
  if (!CC || window.__ccDistrict) return;
  window.__ccDistrict = true;
  const { $, sleep, shown, fire, Stop } = CC;

  function showSearchForm() {
    const form = $(".ecourt-services-form");
    if (form) form.classList.remove("hide");
    for (const sel of ["#cnrResultsDetails", "#inlineCaptchaChallenge", "#cnrResultsBusiness"]) {
      const el = $(sel);
      if (el) el.classList.add("hide");
    }
    document.querySelectorAll(".viewCnrDetailsBack, .printBusinessHolder").forEach((b) => b.classList.add("hide"));
  }

  /** Fill the form the way a person would. False if the court no longer lists the type. */
  async function fillSearchForm(a) {
    const complex = $("#chkYes");
    if (complex && !complex.checked) {
      complex.click();
      await sleep(300);
    }
    const est = $("#est_code");
    const type = $("#case_type");
    if (!est || !type) throw new Error("The court's search form has changed.");
    const ready = () => !type.disabled && type.options.length > 2;
    if (est.value !== a.complexCode || !ready()) {
      est.value = a.complexCode;
      fire(est, "change");
      await CC.waitFor(ready, 45000, "load its case types");
    }
    if (![...type.options].some((o) => o.value === a.caseType)) return false;
    type.value = a.caseType;
    fire(type, "change");
    const year = $("#reg_year");
    year.value = String(a.year);
    fire(year, "input");
    fire(year, "change");
    const status = a.status === "D" ? $("#chkNoStatus") : $("#chkYesStatus");
    if (status && !status.checked) status.click();
    return true;
  }

  function clearResults() {
    const r = $("#cnrResults");
    if (r) {
      r.innerHTML = "";
      r.classList.add("hide");
    }
  }

  function searchOutcome() {
    const r = $("#cnrResults");
    if (!r || r.classList.contains("hide")) return null;
    if (r.querySelector(".distTableContent")) return { kind: "results", html: r.innerHTML };
    const nf = r.querySelector(".notfound");
    if (nf) return { kind: "message", message: nf.textContent.trim() };
    return null;
  }

  /** The page's own "View" link for a case; made if the list is no longer on the page. */
  function viewLink(cnr, est) {
    const existing = document.querySelector(`#cnrResults .viewCnrDetails[data-cno="${cnr}"]`);
    if (existing) return existing;
    let box = document.getElementById("cc-capture-links");
    if (!box) {
      box = document.createElement("div");
      box.id = "cc-capture-links";
      box.style.display = "none";
      document.body.appendChild(box);
    }
    box.textContent = "";
    const wrap = document.createElement("div");
    wrap.className = "distTableContent";
    wrap.setAttribute("data-est-code", est);
    const a = document.createElement("a");
    a.className = "viewCnrDetails";
    a.href = "#";
    a.setAttribute("data-cno", cnr);
    a.textContent = "View";
    wrap.appendChild(a);
    box.appendChild(wrap);
    return a;
  }

  const base64 = (bytes) => {
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  };

  /** One order PDF from the court's link: the bytes, or why not, and whether the court showed its bot check. */
  async function download(url) {
    try {
      const r = await fetch(url, { credentials: "same-origin" });
      const buf = new Uint8Array(await r.arrayBuffer());
      if (r.ok && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) return { bytes: buf };
      const head = new TextDecoder().decode(buf.subarray(0, 2000));
      return {
        challenge: /security verification|verify you are human|captcha/i.test(head),
        why: `The court answered ${r.status} (${(r.headers.get("content-type") || "unknown").split(";")[0]}) instead of the PDF.`,
      };
    } catch (e) {
      return { why: `Could not download it: ${e && e.message ? e.message : e}` };
    }
  }

  /**
   * The order PDFs the app asks for, downloaded here from the links the case
   * page opens — in the background, one every 10 seconds, while the run goes
   * on. The court turns away requests that come too quickly: a refused one is
   * tried once more half a minute later, and if it is refused again the rest
   * wait for the app to hand them out again later. The court's bot check stops
   * the downloads at once. A PDF problem never stops the run.
   */
  const pdfQueue = [];
  let pdfWorker = null;

  const PDF_PAUSE = "districtPdfPausedUntil";

  async function queuePdfs(list) {
    if (((await CC.store.get(PDF_PAUSE)) || 0) > Date.now()) return;
    for (const p of list || []) if (!pdfQueue.some((q) => q.orderId === p.orderId)) pdfQueue.push(p);
    if (!pdfWorker && pdfQueue.length) pdfWorker = drainPdfs().finally(() => (pdfWorker = null));
  }

  async function drainPdfs() {
    const send = (body) => CC.call(CC.apiPath("district", "pdf"), "POST", body).catch(() => null);
    while (pdfQueue.length && CC.state.running) {
      const p = pdfQueue.shift();
      let got = await download(p.url);
      if (!got.bytes && !got.challenge) {
        await sleep(30000);
        if (!CC.state.running) return;
        got = await download(p.url);
      }
      if (!got.bytes) {
        await send({ orderId: p.orderId, error: got.why.slice(0, 300) });
        // The bot check: no downloads from this browser for half an hour.
        if (got.challenge) await CC.store.set(PDF_PAUSE, Date.now() + 30 * 60_000);
        pdfQueue.length = 0;
        return;
      }
      if (got.bytes.length > 2_900_000) await send({ orderId: p.orderId, error: "Over 3 MB; the app fetches it when somebody opens it." });
      else await send({ orderId: p.orderId, pdf: base64(got.bytes) });
      await sleep(10000);
    }
  }

  async function doSearch(a) {
    CC.ui.status(`Searching ${a.context}`);
    CC.ui.canSkip(false);
    showSearchForm();
    const listed = await fillSearchForm(a);
    const post = (report, eff) => CC.call(CC.apiPath("district", "search"), "POST", { runId: a.runId, taskId: a.taskId, year: a.year, report, effort: eff });
    if (!listed) return (await post({ kind: "missing" })).next;

    const eff = CC.effort();
    for (;;) {
      clearResults();
      const input = $("#siwp_captcha_value_0");
      if (!input) throw new Error("The court's captcha box is missing.");
      const out = await CC.waitForPerson({ input, box: input.closest(".siwp-captcha-cntr") || input, context: `Search · ${a.context}`, eff, check: searchOutcome });
      if (out.kind === "results") return (await post({ kind: "results", html: out.html }, eff.done())).next;
      const msg = out.message || "";
      if (/captcha/i.test(msg)) {
        CC.ui.error("That captcha didn't match. The court sent a new one.");
        continue;
      }
      if (/not\s*found|no\s*record|nothing|no\s*case/i.test(msg)) return (await post({ kind: "empty", message: msg }, eff.done())).next;
      CC.ui.error(`The court said: ${msg}`);
      await sleep(2500);
      return (await post({ kind: "error", message: msg.slice(0, 400) }, eff.done())).next;
    }
  }

  async function doDetails(a) {
    CC.ui.status(`Opening ${a.context}`);
    CC.ui.canSkip(true);
    const post = (report, eff) => CC.call(CC.apiPath("district", "details"), "POST", { runId: a.runId, caseId: a.caseId, report, effort: eff });
    const det = $("#cnrResultsDetails");
    const challenge = $("#inlineCaptchaChallenge");
    if (!det) throw new Error("The court's case panel is missing.");

    const eff = CC.effort();
    const open = () => {
      det.innerHTML = "";
      det.removeAttribute("data-cno");
      viewLink(a.cnr, a.estCode).click();
    };
    open();
    let quietSince = Date.now();

    for (;;) {
      if (!CC.state.running) throw new Stop();
      if (CC.state.skip) {
        CC.state.skip = false;
        return (await post({ kind: "skipped" })).next;
      }
      if (det.getAttribute("data-cno") === a.cnr && !det.classList.contains("hide") && !det.querySelector(".notfound") && det.innerHTML.length > 200) {
        const res = await post({ kind: "page", html: det.innerHTML }, eff.done());
        queuePdfs(res.pdfs);
        return res.next;
      }
      const nf = !det.classList.contains("hide") && det.querySelector(".notfound");
      if (nf) {
        const msg = nf.textContent.trim();
        if (/captcha/i.test(msg)) {
          // A wrong answer can come back as a message instead of a new challenge.
          CC.ui.error("That captcha didn't match. Asking the court again.");
          await sleep(800);
          open();
          quietSince = Date.now();
          continue;
        }
        if (/nonce|expired|session/i.test(msg)) {
          // The page's token went stale: reload and carry on where we were.
          location.reload();
          throw new Stop();
        }
        return (await post({ kind: "error", message: msg.slice(0, 400) || "The court showed nothing." }, eff.done())).next;
      }
      if (challenge && shown(challenge)) {
        const input = challenge.querySelector('input[type="text"]');
        // A code the court does not accept brings back the same box with a new picture and the same message, so say so.
        const picture = () => challenge.querySelector("img.siwp_img")?.src;
        let sent = null;
        const out = await CC.waitForPerson({
          input,
          box: challenge.querySelector(".siwp-captcha-cntr") || challenge,
          context: `Case page · ${a.context}`,
          eff,
          submitButton: $("#submitInlineCaptchaBtn"),
          onSubmit: () => (sent = picture()),
          check: () => {
            if (!shown(challenge) || det.getAttribute("data-cno") === a.cnr || (shown(det) && det.querySelector(".notfound"))) return { kind: "moved" };
            if (sent && picture() !== sent) {
              sent = null;
              CC.ui.error("The court didn't accept that code and showed a new picture. Type the new one.");
            }
            return null;
          },
        });
        if (out.kind === "skip") continue;
        quietSince = Date.now();
        continue;
      }
      if (Date.now() - quietSince > 60000) return (await post({ kind: "error", message: "The court did not answer within a minute." }, eff.done())).next;
      await sleep(200);
    }
  }

  const step = (next) => (next.action === "search" ? doSearch(next) : doDetails(next));

  CC.boot({ court: "district", title: "District court · Saket", start: () => CC.loop({ step }) });
})();
