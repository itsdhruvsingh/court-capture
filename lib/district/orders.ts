/**
 * District court — order PDFs and their AI summaries.
 *
 * Each order PDF is fetched from the court once and kept in the private
 * `court-orders` space; everybody after reads our copy. The extension
 * downloads them in the person's browser right after it reads their case (the
 * court shows its bot check to servers that fetch them); the server fetches
 * one itself only when somebody opens an order that is not stored yet.
 *
 * Summaries follow the same rule, harder: written once on request, stored on
 * the order row, served from there forever after. `court_claim_summary`
 * guarantees one writer, so two people clicking at once pay for one summary.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getObject, putObject } from "@/lib/storage";
import { writeSummary } from "@/lib/summary";
import { recordUsage } from "@/lib/cost";
import { AppError } from "@/lib/errors";
import { politely } from "@/lib/polite";
import { COURT } from "./config";
import { fetchOrderPdf, isCourtOrderUrl } from "./site";
import type { OrderSummary } from "./types";

const HOST = new URL(COURT.base).host;

function db(): SupabaseClient {
  return supabaseAdmin();
}

export type OrderRow = {
  id: string;
  case_id: string;
  kind: "interim" | "final";
  order_no: number;
  order_date: string | null;
  label: string | null;
  source_url: string | null;
  pdf_path: string | null;
  pdf_bytes: number | null;
  summary: OrderSummary | null;
  summary_model: string | null;
  summary_source: string | null;
  summary_at: string | null;
  summary_by: string | null;
  summary_status: string | null;
  summary_error: string | null;
};

const ORDER_COLUMNS =
  "id, case_id, kind, order_no, order_date, label, source_url, pdf_path, pdf_bytes, summary, summary_model, summary_source, summary_at, summary_by, summary_status, summary_error";

export async function loadOrder(id: string): Promise<OrderRow & { cnr: string }> {
  const { data, error } = await db().from("court_case_orders").select(`${ORDER_COLUMNS}, court_cases(cnr)`).eq("id", id).maybeSingle();
  if (error) throw new AppError(error.message, 500);
  if (!data) throw new AppError("That order does not exist.", 404);
  const row = data as unknown as OrderRow & { court_cases: { cnr: string } };
  return { ...row, cnr: row.court_cases?.cnr };
}

export function orderFileName(o: { cnr: string; kind: string; order_no: number; order_date: string | null }) {
  return `${o.cnr}_${o.kind === "final" ? "judgment" : "order"}-${o.order_no}_${o.order_date ?? "undated"}.pdf`;
}

/** The order's PDF bytes, fetching and keeping them on first use. */
export async function orderPdf(o: OrderRow & { cnr: string }): Promise<{ path: string; bytes: Buffer }> {
  if (o.pdf_path) {
    const bytes = await getObject("court-orders", o.pdf_path);
    if (bytes) return { path: o.pdf_path, bytes };
  }
  if (!o.source_url) throw new AppError("The court has not published a copy of this order.", 404);

  let bytes: Buffer;
  try {
    bytes = await politely(HOST, () => fetchOrderPdf(o.source_url!));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db().from("court_case_orders").update({ pdf_error: msg }).eq("id", o.id);
    throw e instanceof AppError ? e : new AppError(msg, 502);
  }
  return { path: await keepPdf(o, bytes), bytes };
}

async function keepPdf(o: OrderRow & { cnr: string }, bytes: Buffer) {
  const path = `ecourts/${o.cnr}/${o.kind}-${String(o.order_no).padStart(3, "0")}-${o.order_date ?? "undated"}.pdf`;
  await putObject({ space: "court-orders", path, body: bytes, contentType: "application/pdf" });
  const { error } = await db()
    .from("court_case_orders")
    .update({ pdf_path: path, pdf_bytes: bytes.length, pdf_fetched_at: new Date().toISOString(), pdf_error: null })
    .eq("id", o.id);
  if (error) throw new AppError(error.message, 500);
  return path;
}

/** An order PDF the extension downloaded in the person's browser. */
export async function storeOrderPdf(orderId: string, bytes: Buffer) {
  if (bytes.subarray(0, 5).toString("latin1") !== "%PDF-") throw new AppError("That is not a PDF.", 400);
  const o = await loadOrder(orderId);
  if (o.pdf_path) return { stored: false };
  await keepPdf(o, bytes);
  return { stored: true };
}

/**
 * The court answered a download with something other than the PDF. Note why
 * and when (`pdf_fetched_at` doubles as "last tried" while there is no PDF),
 * so the backlog tries it again later, after the ones never tried.
 */
export async function notePdfFailure(orderId: string, message: string) {
  await db().from("court_case_orders").update({ pdf_error: message, pdf_fetched_at: new Date().toISOString() }).eq("id", orderId).is("pdf_path", null);
}

const RETRY_AFTER_MS = 30 * 60_000;

/**
 * Order PDFs for the extension to download next: every one of the case it has
 * just read, then a few older orders still waiting for theirs — never tried
 * first, then those last tried longest ago (and over half an hour back) — so
 * the backlog drains as the run goes on.
 */
export async function pdfsToFetch(caseId: string, backlog = 4): Promise<{ orderId: string; url: string }[]> {
  const base = () => db().from("court_case_orders").select("id, source_url").is("pdf_path", null).not("source_url", "is", null);
  const before = new Date(Date.now() - RETRY_AFTER_MS).toISOString();
  const [mine, older] = await Promise.all([
    base().eq("case_id", caseId).order("order_date", { ascending: false, nullsFirst: false }).limit(40),
    base()
      .neq("case_id", caseId)
      .or(`pdf_fetched_at.is.null,pdf_fetched_at.lt.${before}`)
      .order("pdf_fetched_at", { ascending: true, nullsFirst: true })
      .order("created_at", { ascending: false })
      .limit(backlog),
  ]);
  if (mine.error) throw new AppError(mine.error.message, 500);
  return [...(mine.data ?? []), ...(older.data ?? [])]
    .filter((o) => isCourtOrderUrl(o.source_url))
    .map((o) => ({ orderId: o.id as string, url: o.source_url as string }));
}

export class SummaryInProgress extends AppError {
  constructor() {
    super("Somebody else is writing this summary right now. It will appear in a moment.", 409);
  }
}

export async function summarizeOrder(orderId: string, staff: { name: string | null; email: string | null }) {
  let order = await loadOrder(orderId);
  if (order.summary) return { order, cached: true };

  const { data: claimed, error } = await db().rpc("court_claim_summary", { p_order: orderId });
  if (error) throw new AppError(error.message, 500);
  if (!claimed) {
    order = await loadOrder(orderId);
    if (order.summary) return { order, cached: true };
    throw new SummaryInProgress();
  }

  try {
    const { data: kase } = await db()
      .from("court_cases")
      .select("cnr, title, case_number, case_type_full, establishment, court_judge")
      .eq("id", order.case_id)
      .single();
    const { bytes } = await orderPdf(order);
    const context = [
      `Court: ${kase?.establishment ?? "District court"}${kase?.court_judge ? ` — ${kase.court_judge}` : ""}`,
      `Case: ${kase?.title ?? ""}`,
      `Case number: ${kase?.case_number ?? ""} (${kase?.case_type_full ?? ""}), CNR ${kase?.cnr ?? order.cnr}`,
      `Order ${order.order_no}${order.kind === "final" ? " (final order / judgment)" : ""}, dated ${order.order_date ?? "unknown"}`,
    ].join("\n");

    const out = await writeSummary({ context, pdf: bytes, fileName: orderFileName(order) });
    await recordUsage({ court: "district", refId: order.id, model: out.usage.model, prompt: out.usage.prompt, completion: out.usage.completion });

    const { error: upErr } = await db()
      .from("court_case_orders")
      .update({
        summary: out.summary,
        summary_model: out.model,
        summary_source: out.source,
        summary_at: new Date().toISOString(),
        summary_by: staff.name ?? staff.email,
        summary_status: null,
        summary_error: null,
      })
      .eq("id", order.id);
    if (upErr) throw new AppError(upErr.message, 500);
    return { order: await loadOrder(orderId), cached: false };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db().from("court_case_orders").update({ summary_status: "failed", summary_error: msg }).eq("id", orderId);
    throw e instanceof AppError ? e : new AppError(msg, 502);
  }
}
