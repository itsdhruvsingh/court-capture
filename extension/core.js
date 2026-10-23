/**
 * Court Capture — shared by both court drivers (district.js, highcourt.js).
 *
 * The plumbing every court needs: talking to the app (through the background
 * worker, because court pages forbid calls to other sites), the panel in the
 * corner, pointing at a captcha box and waiting while the person types, the
 * run loop, and keeping only one tab per court in charge.
 *
 * It never reads, guesses or fills a captcha. The person types every one.
 *
 * For testing in a plain page, set window.__CC_TRANSPORT (and optionally
 * __CC_STORE) before the scripts run.
 */
(() => {
  if (window.__ccCore) return;
  const CC = (window.__ccCore = {});

  // ── plumbing ────────────────────────────────────────────────────────────

  const hasChrome = typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.id;
  CC.hasChrome = hasChrome;
  CC.transport = window.__CC_TRANSPORT || ((path, method, body) => chrome.runtime.sendMessage({ type: "api", path, method, body }));
  CC.store = window.__CC_STORE || {
    get: async (k) => (await chrome.storage.local.get(k))[k],
    set: (k, v) => chrome.storage.local.set({ [k]: v }),
    remove: (k) => chrome.storage.local.remove(k),
  };
  const badge = (text) => {
    if (hasChrome) chrome.runtime.sendMessage({ type: "badge", text }).catch(() => {});
  };

  CC.$ = (sel, root = document) => root.querySelector(sel);
  CC.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  CC.shown = (el) => !!el && !el.closest(".hide") && el.getClientRects().length > 0;
  CC.fire = (el, type) => el.dispatchEvent(new Event(type, { bubbles: true }));

  class Stop extends Error {}
  class Fatal extends Error {}
  CC.Stop = Stop;
  CC.Fatal = Fatal;

  CC.state = { running: false, skip: false, runId: null, busy: false, court: null, tabId: Math.random().toString(36).slice(2) };

  const API = { district: "district", highcourt: "high-court" };
  CC.apiPath = (court, action) => `/api/capture/${API[court]}/${action}`;

  CC.call = async (path, method, body) => {
    for (let attempt = 0; attempt < 6; attempt++) {
      let r;
      try {
        r = await CC.transport(path, method, body);
      } catch (e) {
        r = { ok: false, status: 0, error: String(e && e.message ? e.message : e) };
      }
      if (r && r.ok) {
        CC.ui && CC.ui.error("");
        return r.data;
      }
      const status = r ? r.status : 0;
      if (status === 401 || (status >= 400 && status < 500 && status !== 409 && status !== 429)) {
        throw new Fatal((r && r.error) || `The app refused the request (${status}).`);
      }
      CC.ui && CC.ui.error(`The app is not answering (${(r && r.error) || status}). Retrying…`);
      await CC.sleep(Math.min(15000, 2000 * (attempt + 1)));
    }
    throw new Fatal("The app did not answer. Check it is running, then press Start.");
  };

  // ── the panel ───────────────────────────────────────────────────────────

  CC.mount = (title) => {
    const host = document.createElement("div");
    host.id = "court-capture-panel";
    host.style.cssText = "position:fixed;right:18px;bottom:18px;z-index:2147483647;";
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `
      <style>
        * { box-sizing: border-box; }
        .panel { width: 344px; font: 13px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; color: #ececec;
          background: #0f0f0f; border: 1px solid #2a2a2f; border-radius: 14px; box-shadow: 0 18px 50px rgba(0,0,0,.45); overflow: hidden; }
        .head { display: flex; align-items: center; gap: 8px; padding: 10px 14px; border-bottom: 1px solid #222226; }
        .dot { width: 8px; height: 8px; border-radius: 50%; background: #555; flex: none; }
        .dot.on { background: #e4342a; animation: pulse 1.4s infinite; }
        @keyframes pulse { 50% { opacity: .35; } }
        .title { font-weight: 650; font-size: 13px; }
        .court { color: #8a8a95; font-size: 11.5px; }
        .min { margin-left: auto; background: none; border: 0; color: #8a8a95; cursor: pointer; font-size: 16px; line-height: 1; }
        .body { padding: 12px 14px 14px; }
        .status { color: #cfcfd6; }
        .progress { margin-top: 4px; color: #8a8a95; font-size: 12px; }
        .bar { height: 3px; background: #222226; border-radius: 2px; margin-top: 8px; overflow: hidden; }
        .bar i { display: block; height: 100%; width: 0; background: #e4342a; transition: width .4s; }
        .prompt { margin-top: 12px; padding: 12px; border-radius: 10px; background: rgba(228,52,42,.12); border: 1px solid rgba(228,52,42,.45); }
        .prompt b { display: block; font-size: 15px; color: #fff; }
        .prompt span { display: block; margin-top: 3px; color: #e9a7a2; font-size: 12px; }
        .err { margin-top: 10px; color: #ff8a80; font-size: 12px; }
        .row { display: flex; gap: 8px; margin-top: 12px; }
        button.b { flex: 1; appearance: none; border: 0; border-radius: 8px; padding: 8px 10px; font: 600 12.5px system-ui, sans-serif; cursor: pointer; }
        .primary { background: #e4342a; color: #fff; }
        .ghost { background: #1d1d21; color: #ececec; border: 1px solid #2c2c31 !important; }
        [hidden] { display: none !important; }
        .collapsed .body { display: none; }
      </style>
      <div class="panel">
        <div class="head"><span class="dot"></span><span class="title">Court Capture</span><span class="court"></span><button class="min" title="Minimise">–</button></div>
        <div class="body">
          <div class="status">Loading…</div>
          <div class="progress"></div>
          <div class="bar"><i></i></div>
          <div class="prompt" hidden><b>Type the captcha, then press Enter</b><span></span></div>
          <div class="err" hidden></div>
          <div class="row">
            <button class="b primary start">Start</button>
            <button class="b ghost skip" hidden>Skip this one</button>
          </div>
        </div>
      </div>`;
    const q = (s) => root.querySelector(s);
    const els = {
      panel: q(".panel"), dot: q(".dot"), court: q(".court"), status: q(".status"), progress: q(".progress"), bar: q(".bar i"),
      prompt: q(".prompt"), promptCtx: q(".prompt span"), err: q(".err"), start: q(".start"), skip: q(".skip"), min: q(".min"),
    };
    els.court.textContent = `· ${title}`;
    els.min.addEventListener("click", () => els.panel.classList.toggle("collapsed"));
    document.documentElement.appendChild(host);
    const baseTitle = document.title;
    CC.ui = {
      els,
      status(t) { els.status.textContent = t; },
      progress(t, pct) { els.progress.textContent = t || ""; els.bar.style.width = `${Math.max(0, Math.min(100, pct || 0))}%`; },
      error(t) { els.err.hidden = !t; els.err.textContent = t || ""; },
      running(on) {
        els.dot.classList.toggle("on", on);
        els.start.textContent = on ? "Pause" : "Start";
        els.start.className = on ? "b ghost start" : "b primary start";
      },
      prompt(ctx) {
        els.prompt.hidden = !ctx;
        els.promptCtx.textContent = ctx || "";
        document.title = ctx ? `⌨ Captcha — ${baseTitle}` : baseTitle;
        badge(ctx ? "⌨" : "");
      },
      canSkip(on) { els.skip.hidden = !on; },
    };
    return CC.ui;
  };

  CC.highlight = (el, on) => {
    if (!el) return;
    el.style.outline = on ? "3px solid #e4342a" : "";
    el.style.outlineOffset = on ? "4px" : "";
    el.style.borderRadius = on ? "6px" : "";
  };

  CC.waitFor = async (fn, timeoutMs, what) => {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      if (!CC.state.running) throw new Stop();
      const v = fn();
      if (v) return v;
      await CC.sleep(200);
    }
    throw new Error(`The court's page did not ${what} in time.`);
  };

  /** How much the person typed for one step. */
  CC.effort = (seed) => {
    const started = (seed && seed.startedAt) || Date.now();
    const e = { prompts: (seed && seed.prompts) || 0 };
    e.done = () => ({ prompts: e.prompts, wrong: Math.max(0, e.prompts - 1), solveMs: e.prompts ? Date.now() - started : 0 });
    return e;
  };

  /**
   * Point at a captcha box and wait while the person types; `check` says when
   * the page has moved on. Counts each submission, and keeps this person's
   * claim alive with a heartbeat while they take their time.
   */
  CC.waitForPerson = async ({ input, box, context, eff, check, submitButton, onSubmit }) => {
    let last = 0;
    const count = () => {
      // Enter in a form fires both a keydown and a click on the submit button: count once.
      if (Date.now() - last < 500) return;
      last = Date.now();
      if (input.value.trim()) {
        eff.prompts++;
        if (onSubmit) onSubmit(eff.prompts);
      }
    };
    const onKey = (e) => { if (e.key === "Enter") count(); };
    const form = input.form;
    const onFormSubmit = () => count();
    if (submitButton) submitButton.addEventListener("click", count, true);
    if (form && !submitButton) form.addEventListener("submit", onFormSubmit, true);
    input.addEventListener("keydown", onKey, true);
    CC.highlight(box, true);
    box.scrollIntoView({ block: "center", behavior: "smooth" });
    input.focus({ preventScroll: true });
    CC.ui.prompt(context);
    let lastBeat = Date.now();
    try {
      for (;;) {
        if (!CC.state.running) throw new Stop();
        if (CC.state.skip) return { kind: "skip" };
        const out = check();
        if (out) return out;
        if (CC.state.runId && Date.now() - lastBeat > 60000) {
          lastBeat = Date.now();
          Promise.resolve(CC.transport(CC.apiPath(CC.state.court, "heartbeat"), "POST", { runId: CC.state.runId })).catch(() => {});
        }
        await CC.sleep(200);
      }
    } finally {
      input.removeEventListener("keydown", onKey, true);
      if (submitButton) submitButton.removeEventListener("click", count, true);
      if (form) form.removeEventListener("submit", onFormSubmit, true);
      CC.highlight(box, false);
      CC.ui.prompt(null);
    }
  };

  // ── status ──────────────────────────────────────────────────────────────

  CC.refreshStatus = async () => {
    try {
      const s = await CC.call("/api/capture/status", "GET");
      const r = s[CC.state.court];
      if (!r) {
        CC.ui.progress("No run is open. Start one from the extension's popup.", 0);
        return { who: s.who, run: null };
      }
      CC.state.runId = r.id;
      const mine = r.mine || {};
      const others = (r.others || []).map((o) => `${o.name} (${o.on.slice(0, 2).join(", ")}${o.on.length > 2 ? "…" : ""})`);
      const noun = CC.state.court === "highcourt" ? "judgments" : "cases";
      CC.ui.progress(
        `${r.done} of ${r.wanted} ${noun} · ${r.unitsLeft} of ${r.units} ${r.unitName} left · you: ${mine.cases || 0} ${noun}, ${mine.captchas || 0} captchas` +
          (others.length ? ` · also working: ${others.join(", ")}` : ""),
        r.wanted ? (r.done / r.wanted) * 100 : 0
      );
      return { who: s.who, run: r };
    } catch (e) {
      CC.ui.error(e.message);
      return null;
    }
  };

  // ── the loop ────────────────────────────────────────────────────────────

  const runningKey = () => `running_${CC.state.court}`;
  const leaderKey = () => `leader_${CC.state.court}`;

  /**
   * Run until done, paused or stopped. `first` may be an action already in hand
   * (the High Court driver resumes after each page reload); `step` performs one
   * action and returns the next.
   */
  CC.loop = async ({ step, first }) => {
    if (CC.state.busy) return;
    CC.state.busy = true;
    CC.state.running = true;
    CC.ui.running(true);
    CC.ui.error("");
    await CC.store.set(runningKey(), true);
    await CC.store.set(leaderKey(), CC.state.tabId);
    try {
      let next = first || (await CC.call(CC.apiPath(CC.state.court, "next"), "POST", { runId: CC.state.runId }));
      while (CC.state.running) {
        if (next.runId) CC.state.runId = next.runId;
        if (next.action === "wait") {
          CC.ui.status(next.message || "Others are on what is left.");
          CC.ui.canSkip(false);
          for (let i = 0; i < 40; i++) {
            if (!CC.state.running) throw new Stop();
            await CC.sleep(500);
          }
          next = await CC.call(CC.apiPath(CC.state.court, "next"), "POST", { runId: CC.state.runId });
          continue;
        }
        if (next.action !== "search" && next.action !== "details") {
          await CC.stop(next.action === "done" ? "Run complete — everything is done." : next.message || "Nothing to do.");
          break;
        }
        next = await step(next);
        CC.state.skip = false;
        CC.refreshStatus();
        await CC.sleep(700);
      }
    } catch (e) {
      if (!(e instanceof Stop)) {
        CC.ui.error(e.message || String(e));
        await CC.stop("Stopped. Fix the problem above, then press Start.");
      }
    } finally {
      CC.state.busy = false;
      CC.ui.canSkip(false);
      CC.ui.prompt(null);
    }
  };

  CC.stop = async (message, keepRunning) => {
    CC.state.running = false;
    CC.ui.running(false);
    if (!keepRunning) {
      await CC.store.set(runningKey(), false);
      // Hand this person's share back so teammates can take it now.
      if (CC.state.runId) Promise.resolve(CC.transport(CC.apiPath(CC.state.court, "release"), "POST", { runId: CC.state.runId })).catch(() => {});
    }
    CC.ui.status(message || "Paused. Press Start to carry on.");
  };

  /**
   * Wire the panel and decide whether to start: when the popup asked for this
   * court, or when a run was in progress here before a reload.
   */
  CC.boot = async ({ court, title, start }) => {
    CC.state.court = court;
    CC.mount(title);
    CC.ui.running(false);
    CC.ui.els.start.addEventListener("click", async () => {
      if (CC.state.running) await CC.stop();
      else start();
    });
    CC.ui.els.skip.addEventListener("click", () => {
      CC.state.skip = true;
    });

    // One tab per court in charge: if another takes over, this one stops.
    if (hasChrome) {
      chrome.storage.onChanged.addListener((changes) => {
        const c = changes[leaderKey()];
        if (c && c.newValue && c.newValue !== CC.state.tabId && CC.state.running) CC.stop("Another tab took over this court.", true);
        if (changes.connection && !CC.state.running) CC.refreshStatus().then((s) => s && CC.ui.status(`Connected as ${s.who}. Press Start.`));
      });
    }

    const s = await CC.refreshStatus();
    if (!s) {
      CC.ui.status("Not connected. Click the Court Capture icon in the toolbar to connect.");
      return;
    }
    if (!s.run) {
      CC.ui.status(`Connected as ${s.who}. Start a run from the extension's popup.`);
      return;
    }
    CC.ui.status(`Connected as ${s.who}. ${s.run.status === "paused" ? "This run is paused in the app." : "Press Start; you'll only type captchas."}`);
    const auto = await CC.store.get("autostart");
    const fresh = auto && auto.court === court && Date.now() - auto.at < 120000;
    if (fresh) await CC.store.remove("autostart");
    if (s.run.status === "running" && (fresh || (await CC.store.get(runningKey())))) start();
  };
})();
