/**
 * A small OpenAI client for the things the dashboard does itself.
 *
 * n8n keeps its own key for the workflows that run there. This one exists for
 * work that is short enough to finish inside a request and pointless to send
 * on a round trip: reading an uploaded brief, mostly.
 *
 * Deliberately not a general-purpose wrapper. Every caller uses a strict
 * `json_schema`, so the model cannot return a shape we then have to guess at.
 */

const ENDPOINT = "https://api.openai.com/v1/chat/completions";

export class OpenAIUnavailable extends Error {
  constructor() {
    super("No OPENAI_API_KEY is configured, so this needs doing by hand.");
    this.name = "OpenAIUnavailable";
  }
}

export function hasOpenAI(): boolean {
  return !!process.env.OPENAI_API_KEY;
}

/**
 * Ask for one strictly-shaped answer.
 *
 * Returns the parsed object, or throws with a message a person can act on.
 * The failure modes are checked in the order they actually happen: a refusal
 * carries no content, so parsing first would report "invalid JSON" when the
 * real answer is "the model declined".
 */
export async function askForJson<T>(args: {
  system: string;
  user: string;
  schemaName: string;
  schema: Record<string, unknown>;
  model?: string;
  /** Kept short by default. This runs inside a request, and a caller that
   *  needs minutes belongs in n8n instead. */
  timeoutMs?: number;
  /** Called with the token counts the request actually used.
   *  A callback rather than a changed return type, so the six existing callers
   *  that do not care about cost keep working unchanged. */
  onUsage?: (u: { prompt: number; completion: number; model: string }) => void;
  /** A document the model reads itself — for a scanned PDF with no text layer. */
  file?: { name: string; data: Buffer; mime?: string };
}): Promise<T> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new OpenAIUnavailable();

  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(args.timeoutMs ?? 45_000),
      body: JSON.stringify({
        model: args.model ?? "gpt-4o",
        response_format: {
          type: "json_schema",
          json_schema: { name: args.schemaName, strict: true, schema: args.schema },
        },
        messages: [
          { role: "system", content: args.system },
          {
            role: "user",
            content: args.file
              ? [
                  {
                    type: "file",
                    file: {
                      filename: args.file.name,
                      file_data: `data:${args.file.mime ?? "application/pdf"};base64,${args.file.data.toString("base64")}`,
                    },
                  },
                  { type: "text", text: args.user },
                ]
              : args.user,
          },
        ],
      }),
    });
  } catch (e) {
    const msg = e instanceof Error && e.name === "TimeoutError"
      ? "OpenAI took too long to answer. Try a smaller file."
      : `Could not reach OpenAI: ${e instanceof Error ? e.message : "unknown error"}`;
    throw new Error(msg);
  }

  const body = (await res.json().catch(() => null)) as {
    error?: { message?: string };
    usage?: { prompt_tokens?: number; completion_tokens?: number };
    choices?: { finish_reason?: string; message?: { content?: string; refusal?: string } }[];
  } | null;

  if (body?.usage && args.onUsage) {
    args.onUsage({
      prompt: body.usage.prompt_tokens ?? 0,
      completion: body.usage.completion_tokens ?? 0,
      model: args.model ?? "gpt-4o",
    });
  }

  if (!res.ok || body?.error) {
    // 429 here is almost always a spend cap rather than real rate limiting,
    // and saying so saves somebody half an hour.
    const detail = body?.error?.message ?? `HTTP ${res.status}`;
    throw new Error(
      res.status === 429
        ? `OpenAI refused the request: ${detail}. This usually means the account is out of credit.`
        : `OpenAI refused the request: ${detail}`
    );
  }

  const choice = body?.choices?.[0];
  if (!choice) throw new Error("OpenAI returned no result.");
  if (choice.message?.refusal) throw new Error(`The model declined: ${choice.message.refusal}`);
  if (choice.finish_reason === "length") {
    throw new Error("The answer was cut off before it finished. Try a smaller file.");
  }
  if (choice.finish_reason === "content_filter") {
    throw new Error("The answer was blocked by OpenAI content filtering.");
  }

  try {
    return JSON.parse(choice.message?.content ?? "") as T;
  } catch {
    throw new Error("The model returned something that could not be read as JSON.");
  }
}
