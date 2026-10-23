/**
 * Court Capture — background worker.
 *
 * Court pages have a Content-Security-Policy that stops anything on them from
 * talking to other sites, so the page scripts hand every call for the app to
 * this worker, which makes it with the connection token. It never talks to a
 * court.
 */

async function connection() {
  const { connection } = await chrome.storage.local.get("connection");
  return connection || null;
}

/** One id per browser, so several people (or browsers) each hold their own share of the work. */
async function captureId() {
  const { captureId } = await chrome.storage.local.get("captureId");
  if (captureId) return captureId;
  const id = crypto.randomUUID();
  await chrome.storage.local.set({ captureId: id });
  return id;
}

async function api(path, method = "GET", body) {
  const conn = await connection();
  if (!conn) return { ok: false, status: 401, error: "Not connected. Click the Court Capture icon and connect it to your app." };
  let res;
  try {
    res = await fetch(conn.url + path, {
      method,
      headers: { "content-type": "application/json", authorization: `Bearer ${conn.token}`, "x-capture-id": await captureId() },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    return { ok: false, status: 0, error: `Could not reach ${conn.url}: ${e && e.message ? e.message : e}` };
  }
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data, error: data && data.error };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "api") {
    api(msg.path, msg.method, msg.body).then(sendResponse, (e) => sendResponse({ ok: false, status: 0, error: String(e && e.message ? e.message : e) }));
    return true;
  }
  if (msg && msg.type === "badge") {
    const tabId = sender.tab && sender.tab.id;
    chrome.action.setBadgeBackgroundColor({ color: "#e4342a" });
    chrome.action.setBadgeText(tabId ? { text: msg.text || "", tabId } : { text: msg.text || "" });
    sendResponse({});
    return false;
  }
  return false;
});
