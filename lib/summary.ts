import "server-only";
import { askForJson, hasOpenAI } from "./openai";
import { assertBudget, priceTokens } from "./cost";
import { AppError } from "./errors";

/**
 * AI summaries of court documents — district court orders and High Court
 * judgments alike. Written once on request, stored on the document's row by
 * the caller, and served from there forever after.
 */

export type DocumentSummary = {
  headline: string;
  order_type: string;
  outcome: string;
  summary: string;
  present: string[];
  directions: string[];
  key_points: string[];
  next_date: string | null;
  next_purpose: string | null;
  judge: string | null;
};

/** The best writer on the account, with a fallback if it refuses or times out. */
const MODEL = "gpt-5.4";
const FALLBACK = "gpt-4.1";

/** Below this many characters of text the PDF is a scan; the model reads the file. */
const MIN_TEXT = 200;

const SYSTEM = `You summarise orders and judgments of Indian courts — Delhi's district courts and the High Court of Delhi — for lawyers and their staff.

You are given one document — a daily order ("judicial proceedings"), an interim order, or a judgment — and the case it belongs to.

Write for a busy advocate who needs to know, in under a minute, what the court decided and what happens next.

Rules:
- Use only what the document says. Never infer facts, outcomes or dates that are not written in it. If something is not stated, use null or an empty list.
- Plain English. Keep legal terms where they are the precise word (e.g. "ex parte", "written statement", "framing of charge", "writ of certiorari"), and keep section, rule and case citations exactly as written.
- Names: write parties and counsel as the document does. Do not add honorifics it does not use.
- Dates as YYYY-MM-DD. "next_date" is the date the matter is next listed, if the document fixes one.
- "headline": one sentence, at most 20 words, saying what the court did.
- "order_type": a short label such as "Adjournment", "Notice issued", "Interim order", "Evidence recorded", "Charge framed", "Final judgment", "Appeal allowed", "Petition dismissed", "Disposed — withdrawn", "Disposed — settled".
- "outcome": what this document leaves the matter as, in a few words (e.g. "Adjourned for plaintiff's evidence", "Suit decreed", "Bail granted", "Writ petition allowed").
- "summary": 2–6 sentences. What was before the court, what was argued, what the court decided and why, if the document says why.
- "present": who appeared, as recorded (e.g. "Mr X, Advocate for the petitioner"). Empty if not recorded.
- "directions": each thing the court directed someone to do, one per item, naming who must do it.
- "key_points": legal points, provisions and precedents relied on, findings or reliefs worth noting. Empty for a routine adjournment.
- "judge": the judge or bench, as the document names it.
- If the text is illegible or not a court document, say so in "summary" and keep the rest empty or null.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["headline", "order_type", "outcome", "summary", "present", "directions", "key_points", "next_date", "next_purpose", "judge"],
  properties: {
    headline: { type: "string" },
    order_type: { type: "string" },
    outcome: { type: "string" },
    summary: { type: "string" },
    present: { type: "array", items: { type: "string" } },
    directions: { type: "array", items: { type: "string" } },
    key_points: { type: "array", items: { type: "string" } },
    next_date: { type: ["string", "null"] },
    next_purpose: { type: ["string", "null"] },
    judge: { type: ["string", "null"] },
  },
} as const;

/** Selectable text out of a PDF; empty for a scan. */
export async function pdfText(bytes: Buffer): Promise<string> {
  try {
    const { extractText, getDocumentProxy } = await import("unpdf");
    // A copy: pdf.js detaches the buffer it is handed.
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const out = await extractText(pdf, { mergePages: true });
    return String(out.text ?? "").replace(/[ \t]+\n/g, "\n").trim();
  } catch {
    return "";
  }
}

/**
 * Write one summary. Give it the document's text when there is one (the High
 * Court publishes a .txt; district orders have a text layer); give it the PDF
 * as well so a scan can still be read.
 */
export async function writeSummary(args: { context: string; text?: string | null; pdf?: Buffer | null; fileName: string }) {
  if (!hasOpenAI()) throw new AppError("No OPENAI_API_KEY is configured, so summaries cannot be written.", 503);
  const text = (args.text ?? "").trim() || (args.pdf ? await pdfText(args.pdf) : "");
  const usePdf = text.length < MIN_TEXT && !!args.pdf;
  if (!usePdf && text.length < 40) throw new AppError("The court's copy of this document has no readable text.", 422);

  const user = usePdf
    ? `${args.context}\n\nThe document is the attached PDF.`
    : `${args.context}\n\nThe document's text:\n"""\n${text.slice(0, 90_000)}\n"""`;

  // Estimate high, so the monthly guard errs towards refusing.
  const estTokens = usePdf ? 8000 : Math.ceil(user.length / 3) + 800;
  await assertBudget(priceTokens(MODEL, estTokens, 1500));

  let usage = { prompt: 0, completion: 0, model: MODEL };
  const ask = (model: string, timeoutMs: number) =>
    askForJson<DocumentSummary>({
      system: SYSTEM,
      user,
      schemaName: "court_document_summary",
      schema: SCHEMA as unknown as Record<string, unknown>,
      model,
      timeoutMs,
      file: usePdf && args.pdf ? { name: args.fileName, data: args.pdf } : undefined,
      onUsage: (u) => {
        usage = u;
      },
    });

  let summary: DocumentSummary;
  let model = MODEL;
  try {
    summary = await ask(MODEL, 90_000);
  } catch (e) {
    console.error("[summary] fell back:", e instanceof Error ? e.message : e);
    model = FALLBACK;
    summary = await ask(FALLBACK, 60_000);
  }
  return { summary, model, usage, source: usePdf ? ("pdf" as const) : ("text" as const) };
}
