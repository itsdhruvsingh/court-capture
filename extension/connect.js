/**
 * Court Capture — one-click connect from the app's Capture page.
 *
 * Runs only on the app origins listed in the manifest. The page asks whether
 * the extension is here ("ping") and, when the person clicks Connect, hands
 * over a connection code. Only a code minted for this very page's origin is
 * accepted, so no other site can point the extension somewhere else.
 */
(() => {
  const origin = location.origin;
  const reply = (msg) => window.postMessage({ source: "court-capture", ...msg }, origin);

  function decode(code) {
    const s = String(code).trim().replace(/-/g, "+").replace(/_/g, "/");
    const v = JSON.parse(atob(s + "===".slice((s.length + 3) % 4)));
    if (!v || typeof v.token !== "string" || typeof v.url !== "string") throw new Error("That is not a connection code.");
    return { url: v.url, token: v.token };
  }

  async function status() {
    const { connection } = await chrome.storage.local.get("connection");
    return { installed: true, connected: !!connection && connection.url === origin, url: connection ? connection.url : null };
  }

  window.addEventListener("message", async (e) => {
    if (e.source !== window || e.origin !== origin) return;
    const d = e.data;
    if (!d || d.target !== "court-capture") return;
    if (d.type === "ping") {
      reply({ type: "status", ...(await status()) });
      return;
    }
    if (d.type === "connect") {
      try {
        const conn = decode(d.code);
        if (conn.url !== origin) throw new Error("This code was made for a different app address.");
        await chrome.storage.local.set({ connection: conn });
        reply({ type: "status", ...(await status()) });
      } catch (err) {
        reply({ type: "error", message: String((err && err.message) || err) });
      }
    }
  });

  reply({ type: "hello" });
})();
