import { NextResponse } from "next/server";
import { requireStaff, UnauthorisedError, type StaffUser } from "./auth";
import { BudgetExceeded } from "./cost";
import { AppError } from "./errors";

export { AppError };

const MISSING = /(could not find the (table|function)|does not exist|schema cache)/i;

/**
 * Turn any failure into JSON a page can show. Above all, a missing table or
 * function means a migration has not been run yet — migrations are applied by
 * hand in the Supabase SQL editor, so the code is often a step ahead.
 */
export function failure(err: unknown): NextResponse {
  const e = err as { code?: string; message?: string };
  if (e?.code === "PGRST205" || e?.code === "PGRST202" || MISSING.test(e?.message ?? "")) {
    return NextResponse.json(
      {
        error: "The database is missing part of this app. Run the files in supabase/migrations (in order) in Supabase → SQL Editor.",
        hint: "If you have just run them, this clears within a minute while Supabase reloads its schema cache.",
        detail: e?.message,
        setup_required: true,
      },
      { status: 503 }
    );
  }
  if (err instanceof AppError) {
    if (err.status >= 500) console.error("[court-capture]", err.message);
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (err instanceof BudgetExceeded) return NextResponse.json({ error: err.message }, { status: 402 });
  console.error("[court-capture]", err);
  return NextResponse.json({ error: e?.message ?? "Something went wrong." }, { status: 500 });
}

/** A route for signed-in people: sign-in check first, then one place for errors. */
export async function handle(fn: (staff: StaffUser) => Promise<Response>): Promise<Response> {
  let staff: StaffUser;
  try {
    staff = await requireStaff();
  } catch (err) {
    if (err instanceof UnauthorisedError) return NextResponse.json({ error: err.message }, { status: 401 });
    throw err;
  }
  try {
    return await fn(staff);
  } catch (err) {
    return failure(err);
  }
}
