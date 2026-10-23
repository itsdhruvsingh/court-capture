/**
 * Court Capture — connect once, then pick a court.
 *
 * Picking a court opens that court's search page with a note to start; the
 * page's panel takes it from there. With no run open, the button offers to
 * start one with the defaults.
 */

const PAGES = {
  district: "https://southdelhi.dcourts.gov.in/case-status-search-by-case-type/",
  highcourt: "https://delhihighcourt.nic.in/app/sitting-judges-wise-data",
};
const $ = (id) => document.getElementById(id);

function say(text, err) {
  $("msg").textContent = text || "";
  $("msg").className = err ? "msg err" : "msg";
}

function decode(code) {
  const s = code.trim().replace(/-/g, "+").replace(/_/g, "/");
  const v = JSON.parse(atob(s + "===".slice((s.length + 3) % 4)));
  if (!v || !/^https?:\/\/[^/]+$/.test(v.url) || typeof v.token !== "string") throw new Error("bad code");
  return { url: v.url, token: v.token };
}

/** Match patterns ignore ports, so one pattern covers localhost:3100. */
function pattern(url) {
  const u = new URL(url);
  return `${u.protocol}//${u.hostname}/*`;
}

const api = (path, method = "GET", body) => chrome.runtime.sendMessage({ type: "api", path, method, body });

let state = null;

function describe(run, noun) {
  if (!run) return { text: "No run open — click to start one", open: false };
  if (run.status === "paused") return { text: `Run paused in the app · ${run.done} of ${run.wanted} ${noun}`, open: true };
  const mine = run.mine || {};
  return { text: `${run.done} of ${run.wanted} ${noun} · ${run.unitsLeft} ${run.unitName} left · you: ${mine.captchas || 0} captchas →`, open: true };
}

async function render() {
  const { connection } = await chrome.storage.local.get("connection");
  $("connect").hidden = !!connection;
  $("connected").hidden = !connection;
  if (!connection) return;
  $("who").textContent = `Connecting to ${connection.url}…`;
  const r = await api("/api/capture/status");
  if (!r.ok) {
    $("who").textContent = r.error || `The app answered ${r.status}.`;
    if (r.status === 401) $("connect").hidden = false;
    return;
  }
  state = r.data;
  $("who").innerHTML = "Connected to <b></b> as <b></b>";
  $("who").querySelectorAll("b")[0].textContent = new URL(connection.url).host;
  $("who").querySelectorAll("b")[1].textContent = state.who;
  $("district-run").textContent = describe(state.district, "cases").text;
  $("highcourt-run").textContent = describe(state.highcourt, "judgments").text;
}

async function go(court) {
  say("");
  const run = state && state[court];
  if (!run) {
    const r = await api("/api/capture/start", "POST", { court });
    if (!r.ok && r.status !== 409) return say(r.error || "Could not start a run.", true);
  } else if (run.status === "paused") {
    return say("That run is paused. Resume it on the app's Capture page first.", true);
  }
  await chrome.storage.local.set({ autostart: { court, at: Date.now() } });
  await chrome.tabs.create({ url: PAGES[court] });
  window.close();
}

$("district").addEventListener("click", () => go("district"));
$("highcourt").addEventListener("click", () => go("highcourt"));

$("save").addEventListener("click", async () => {
  let conn;
  try {
    conn = decode($("code").value);
  } catch {
    return say("That is not a connection code. Copy it again from the Capture page.", true);
  }
  const granted = await chrome.permissions.request({ origins: [pattern(conn.url)] });
  if (!granted) return say("The extension needs permission to reach your app.", true);
  await chrome.storage.local.set({ connection: conn });
  $("code").value = "";
  say("");
  await render();
});

$("disconnect").addEventListener("click", async () => {
  await chrome.storage.local.remove(["connection", "running_district", "running_highcourt", "hcPending"]);
  say("Disconnected.");
  await render();
});

render();
