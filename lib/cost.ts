import "server-only";
import { supabaseAdmin } from "./supabase/admin";

/**
 * What AI summaries cost, and a monthly ceiling on it.
 *
 * Rates are published US dollars per million tokens; the recorded figure errs
 * high. Every summary writes one row to `ai_usage`, and before writing one the
 * month's total is checked against AI_MONTHLY_BUDGET_USD (default $25), so a
 * runaway loop of clicks cannot become a surprise bill.
 */

const RATES: Record<string, { in: number; out: number }> = {
  "gpt-4o": { in: 2.5, out: 10 },
  "gpt-4o-mini": { in: 0.15, out: 0.6 },
  "gpt-4.1-mini": { in: 0.4, out: 1.6 },
  "gpt-4.1": { in: 2, out: 8 },
  "gpt-5.4": { in: 2.5, out: 15 },
};

/** US dollars for a call. Unknown models are priced at the top rate. */
export function priceTokens(model: string, prompt: number, completion: number): number {
  const r = RATES[model] ?? { in: 2.5, out: 15 };
  return (prompt * r.in + completion * r.out) / 1_000_000;
}

export class BudgetExceeded extends Error {
  constructor(spentUsd: number, capUsd: number) {
    super(`This month's AI budget is used up ($${spentUsd.toFixed(2)} of $${capUsd.toFixed(2)}). Raise AI_MONTHLY_BUDGET_USD to write more summaries.`);
    this.name = "BudgetExceeded";
  }
}

function monthStart() {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
}

export async function assertBudget(estimateUsd: number) {
  const cap = Number(process.env.AI_MONTHLY_BUDGET_USD ?? 25);
  if (!Number.isFinite(cap) || cap <= 0) return;
  const { data, error } = await supabaseAdmin().from("ai_usage").select("cost_micros").gte("at", monthStart()).limit(100_000);
  if (error) return; // the ledger missing must not stop work; the provider's dashboard is the backstop
  const spent = (data ?? []).reduce((n, r) => n + Number(r.cost_micros ?? 0), 0) / 1_000_000;
  if (spent + estimateUsd > cap) throw new BudgetExceeded(spent, cap);
}

/** One line in the ledger. Never throws: work already paid for must not be lost. */
export async function recordUsage(args: { court: "district" | "highcourt"; refId: string; model: string; prompt: number; completion: number; kind?: string }) {
  try {
    await supabaseAdmin()
      .from("ai_usage")
      .insert({
        court: args.court,
        ref_id: args.refId,
        kind: args.kind ?? "summary",
        model: args.model,
        prompt_tokens: args.prompt,
        completion_tokens: args.completion,
        cost_micros: Math.round(priceTokens(args.model, args.prompt, args.completion) * 1_000_000),
      });
  } catch (e) {
    console.error("[cost] ledger write failed:", e instanceof Error ? e.message : e);
  }
}
