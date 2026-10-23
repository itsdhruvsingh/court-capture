/**
 * District court — order PDFs, the one thing the server may fetch from the court.
 *
 * Searches and case pages are read by the Court Capture extension in a
 * person's browser (the court forbids direct API calls, and both sit behind a
 * captcha the person types). Order PDFs are plain, self-contained document
 * links (`input_strings` carries the CNR, order number and date) with no
 * captcha. The extension downloads them in the browser as it goes; the server
 * fetches one only when somebody opens an order that is not stored yet.
 */

import { COURT, USER_AGENT } from "./config";
import { AppError } from "@/lib/errors";
import { CourtChallenge, looksLikeChallenge } from "@/lib/polite";

/** Only the court's own order endpoint is ever fetched on a user's behalf. */
export function isCourtOrderUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.origin === COURT.base && u.pathname === COURT.ajax && u.searchParams.get("action") === "get_order_pdf";
  } catch {
    return false;
  }
}

export async function fetchOrderPdf(url: string): Promise<Buffer> {
  if (!isCourtOrderUrl(url)) throw new AppError("That is not a court order link.");
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "user-agent": USER_AGENT, referer: COURT.base + COURT.searchPage },
      signal: AbortSignal.timeout(45_000),
    });
  } catch (e) {
    throw new AppError(`Could not reach the court site: ${e instanceof Error ? e.message : String(e)}`, 502);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (!res.ok || buf.subarray(0, 5).toString("latin1") !== "%PDF-") {
    const head = buf.subarray(0, 400).toString("utf8");
    if (looksLikeChallenge(head)) {
      throw new CourtChallenge("The court site showed its security verification instead of the order, so order downloads are paused for a while.");
    }
    if (/captcha/i.test(head)) throw new AppError("The court site asked for a captcha before releasing this order.", 502);
    if (/forbidden/i.test(head)) throw new AppError("The court site refused to hand over this order.", 502);
    const type = res.headers.get("content-type") ?? "no content type";
    const said = head.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
    throw new AppError(`The court site did not return a PDF (HTTP ${res.status}, ${type}, ${buf.length} bytes${said ? `: "${said}"` : ""}).`, 502);
  }
  return buf;
}
