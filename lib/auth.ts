import { supabaseServer } from "./supabase/server";

export type StaffUser = { id: string; email: string | null; name: string | null };

/** Who is signed in, from the Supabase session cookie. Accounts live in Supabase Auth. */
export async function currentStaff(): Promise<StaffUser | null> {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  return {
    id: user.id,
    email: user.email ?? null,
    name: (meta.full_name as string) ?? (meta.name as string) ?? null,
  };
}

export class UnauthorisedError extends Error {
  constructor() {
    super("You need to sign in to do that.");
    this.name = "UnauthorisedError";
  }
}

export async function requireStaff(): Promise<StaffUser> {
  const staff = await currentStaff();
  if (!staff) throw new UnauthorisedError();
  return staff;
}
