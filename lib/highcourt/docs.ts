/**
 * High Court — judgment documents and their AI summaries.
 *
 * Every judgment the court lists links two plain documents: the PDF and a .txt
 * of the same judgment. Right after a search is saved, both are fetched in the
 * background (one at a time, a few seconds apart): the text is kept on the row
 * — searchable, and what summaries are written from — and the PDF in the
 * private `court-orders` space for viewing and download.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getObject, putObject } from "@/lib/storage";
import { writeSummary } from "@/lib/summary";
import { recordUsage } from "@/lib/cost";
import { AppError } from "@/lib/errors";
import { CourtChallenge, looksLikeChallenge, pausedUntil, politely } from "@/lib/polite";
import { HC, USER_AGENT } from "./config";
import { isJudgmentUrl } from "./parse";
import type { DocumentSummary } from "@/lib/summary";

const HOST = new URL(HC.base).host;

function db(): SupabaseClient {
  return supabaseAdmin();
}

export type JudgmentRow = {
  id: string;
  case_no: string;
  case_type: string | null;
  neutral_citation: string | null;
  order_date: string | null;
  petitioner: string | null;
  respondent: string | null;
  pdf_url: string | null;
  txt_url: string | null;
  pdf_path: string | null;
  pdf_bytes: number | null;
  body_text: string | null;
  summary: DocumentSummary | null;
  summary_status: string | null;
};

const COLUMNS =
  "id, case_no, case_type, neutral_citation, order_date, petitioner, respondent, pdf_url, txt_url, pdf_path, pdf_bytes, body_text, summary, summary_status";

export async function loadJudgment(id: string): Promise<JudgmentRow> {
  const { data, error } = await db().from("hc_judgments").select(COLUMNS).eq("id", id).maybeSingle();
  if (error) throw new AppError(error.message, 500);
  if (!data) throw new AppError("That judgment does not exist.", 404);
  return data as JudgmentRow;
}

export function judgmentFileName(j: Pick<JudgmentRow, "case_no" | "order_date">) {
  return `DHC_${j.case_no.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "")}_${j.order_date ?? "undated"}.pdf`;
}

async function fetchDoc(url: string, kind: "pdf" | "txt"): Promise<Buffer> {
  if (!isJudgmentUrl(url)) throw new AppError("That is not a High Court judgment link.");
  let res: Response;
  try {
    res = await fetch(url, { headers: { "user-agent": USER_AGENT, referer: HC.base + HC.judgesPage }, signal: AbortSignal.timeout(45_000) });
  } catch (e) {
    throw new AppError(`Could not reach the High Court site: ${e instanceof Error ? e.message : String(e)}`, 502);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const head = buf.subarray(0, 400).toString("utf8");
  if (looksLikeChallenge(head)) throw new CourtChallenge("The High Court site showed its security verification, so downloads are paused for a while.");
  const type = res.headers.get("content-type") ?? "";
  const okPdf = kind === "pdf" && buf.subarray(0, 5).toString("latin1") === "%PDF-";
  const okTxt = kind === "txt" && /text\/plain/i.test(type) && !/<html/i.test(head);
  if (!res.ok || !(okPdf || okTxt)) throw new AppError(`The High Court site did not return the ${kind} (HTTP ${res.status}, ${type || "no type"}).`, 502);
  return buf;
}

/** The judgment's text — the court's own .txt — fetching and keeping it on first use. */
export async function judgmentText(j: JudgmentRow): Promise<string | null> {
  if (j.body_text) return j.body_text;
  if (!j.txt_url) return null;
  try {
    const buf = await politely(HOST, () => fetchDoc(j.txt_url!, "txt"));
    const text = buf.toString("utf8").replace(/\r\n/g, "\n").replace(/\u0000/g, "").trim();
    await db().from("hc_judgments").update({ body_text: text, text_fetched_at: new Date().toISOString(), text_error: null }).eq("id", j.id);
    return text;
  } catch (e) {
    await db().from("hc_judgments").update({ text_error: e instanceof Error ? e.message : String(e) }).eq("id", j.id);
    throw e;
  }
}

/** The judgment's PDF bytes, fetching and keeping them on first use. */
export async function judgmentPdf(j: JudgmentRow): Promise<{ path: string; bytes: Buffer }> {
  if (j.pdf_path) {
    const bytes = await getObject("court-orders", j.pdf_path);
    if (bytes) return { path: j.pdf_path, bytes };
  }
  if (!j.pdf_url) throw new AppError("The court has not published a PDF of this judgment.", 404);
  let bytes: Buffer;
  try {
    bytes = await politely(HOST, () => fetchDoc(j.pdf_url!, "pdf"));
  } catch (e) {
    await db().from("hc_judgments").update({ pdf_error: e instanceof Error ? e.message : String(e) }).eq("id", j.id);
    throw e;
  }
  const file = new URL(j.pdf_url).pathname.split("/").pop() ?? `${j.id}.pdf`;
  const path = `dhc/${(j.order_date ?? "undated").slice(0, 4)}/${file}`;
  await putObject({ space: "court-orders", path, body: bytes, contentType: "application/pdf" });
  await db().from("hc_judgments").update({ pdf_path: path, pdf_bytes: bytes.length, pdf_fetched_at: new Date().toISOString(), pdf_error: null }).eq("id", j.id);
  return { path, bytes };
}

/** After a search: fetch text and PDF for the judgments just saved that lack them. */
export async function prefetchJudgments(runId: string, since: string) {
  const { data } = await db()
    .from("hc_judgments")
    .select(COLUMNS)
    .eq("first_run_id", runId)
    .gte("created_at", since)
    .or("body_text.is.null,pdf_path.is.null")
    .limit(40);
  let saved = 0;
  for (const j of (data ?? []) as JudgmentRow[]) {
    if (pausedUntil(HOST)) break;
    try {
      if (!j.body_text) await judgmentText(j);
      if (!j.pdf_path) await judgmentPdf(j);
      saved++;
    } catch (e) {
      if (e instanceof CourtChallenge) break;
    }
  }
  return saved;
}

export class SummaryInProgress extends AppError {
  constructor() {
    super("Somebody else is writing this summary right now. It will appear in a moment.", 409);
  }
}

export async function summarizeJudgment(id: string, staff: { name: string | null; email: string | null }) {
  let j = await loadJudgment(id);
  if (j.summary) return { judgment: j, cached: true };
  const { data: claimed, error } = await db().rpc("hc_claim_summary", { p_id: id });
  if (error) throw new AppError(error.message, 500);
  if (!claimed) {
    j = await loadJudgment(id);
    if (j.summary) return { judgment: j, cached: true };
    throw new SummaryInProgress();
  }
  try {
    const { data: judges } = await db().from("hc_judgment_judges").select("hc_judges(name)").eq("judgment_id", id);
    const bench = ((judges ?? []) as unknown as { hc_judges: { name: string } | null }[]).map((r) => r.hc_judges?.name).filter(Boolean).join(", ");
    const text = await judgmentText(j).catch(() => null);
    const pdf = text && text.length >= 200 ? null : (await judgmentPdf(j)).bytes;
    const context = [
      `Court: High Court of Delhi${bench ? ` — ${bench}` : ""}`,
      `Case: ${j.petitioner ?? ""} vs ${j.respondent ?? ""}`,
      `Case number: ${j.case_no}${j.case_type ? ` (${j.case_type})` : ""}${j.neutral_citation ? `, neutral citation ${j.neutral_citation}` : ""}`,
      `Dated ${j.order_date ?? "unknown"}`,
    ].join("\n");
    const out = await writeSummary({ context, text, pdf, fileName: judgmentFileName(j) });
    await recordUsage({ court: "highcourt", refId: id, model: out.usage.model, prompt: out.usage.prompt, completion: out.usage.completion });
    const { error: upErr } = await db()
      .from("hc_judgments")
      .update({
        summary: out.summary,
        summary_model: out.model,
        summary_source: out.source,
        summary_at: new Date().toISOString(),
        summary_by: staff.name ?? staff.email,
        summary_status: null,
        summary_error: null,
      })
      .eq("id", id);
    if (upErr) throw new AppError(upErr.message, 500);
    return { judgment: await loadJudgment(id), cached: false };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db().from("hc_judgments").update({ summary_status: "failed", summary_error: msg }).eq("id", id);
    throw e instanceof AppError ? e : new AppError(msg, 502);
  }
}
