/**
 * High Court — the run engine.
 *
 * A run is "up to N judgments for every sitting judge". The extension drives
 * the court's Sitting Judges search in a person's browser; this module plans
 * and records, and never contacts the court.
 *
 * Each person's extension claims a judge (`hc_claim_task`) and asks for a
 * search. The first search covers the run's whole range — the last 10 years
 * by default — so one typed code lists everything the judge uploaded; the
 * extension reads every row of that list (the court's table pages it in the
 * browser) and the server keeps a random sample, up to what the judge needs.
 * With the whole list read, the judge is finished either way: done, or short
 * because there are fewer. Only when a list could not be read whole, or the
 * court refused the search, do further searches use random windows, up to
 * `max_tries` in all. Reports are idempotent: a repeat or stale one is ignored.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { AppError } from "@/lib/errors";
import { CAPTURE_SEEN_SECONDS, CASE_TYPES, DEFAULT_MAX_TRIES, DEFAULT_PER_JUDGE, DEFAULT_WINDOW_DAYS, DEFAULT_YEARS_BACK, JUDGES } from "./config";
import { dedupeKey, parseJudgeResults } from "./parse";
import { daysBetween, istToday, randomWindow, toDmy, yearsBefore } from "./window";
import type { Capturer, CaptchaEffort, HcAction, HcRow, HcRunSnapshot, HcRunStats, HcRunStatus, HcTaskStatus, PersonStats } from "./types";

const CLAIM_SECONDS = 300;

function db(): SupabaseClient {
  return supabaseAdmin();
}

export function shortName(name: string) {
  return (name || "someone").split("@")[0];
}

// ── rows ──────────────────────────────────────────────────────────────────

type RunRow = {
  id: string;
  label: string | null;
  per_judge: number;
  max_tries: number;
  window_days: number;
  earliest: string;
  status: HcRunStatus;
  stats: HcRunStats;
  activity: { at: string; text: string }[];
  last_error: string | null;
  lease_until: string | null;
  created_at: string;
  finished_at: string | null;
  created_by_name: string | null;
};

type TaskRow = {
  id: string;
  run_id: string;
  seq: number;
  judge_id: string | null;
  judge_code: string;
  judge_name: string;
  status: HcTaskStatus;
  wanted: number;
  found: number;
  tries: number;
  win_from: string | null;
  win_to: string | null;
  windows: { from: string; to: string; listed?: number; read?: number; took?: number; error?: string }[];
  note: string | null;
  claimed_by: string | null;
  claimed_name: string | null;
  claimed_until: string | null;
};

const RUN_COLUMNS =
  "id, label, per_judge, max_tries, window_days, earliest, status, stats, activity, last_error, lease_until, created_at, finished_at, created_by_name";

// ── reference lists ───────────────────────────────────────────────────────

/** Judges and case types, seeded from the snapshot the first time they are needed. */
async function ensureReference() {
  const { count } = await db().from("hc_judges").select("*", { count: "exact", head: true });
  if (!count) {
    const { error } = await db()
      .from("hc_judges")
      .upsert(JUDGES.map((j) => ({ code: j.code, name: j.name, sitting: true })), { onConflict: "court,code", ignoreDuplicates: true });
    if (error) throw new AppError(error.message, 500);
  }
  const { count: types } = await db().from("hc_case_types").select("*", { count: "exact", head: true });
  if (!types) {
    const { error } = await db().from("hc_case_types").upsert(CASE_TYPES, { onConflict: "court,code", ignoreDuplicates: true });
    if (error) throw new AppError(error.message, 500);
  }
}

/**
 * The judge list as the court's page shows it today, sent by the extension.
 * New judges are added; judges no longer listed are marked not sitting.
 */
export async function syncJudges(list: { code: string; name: string }[]) {
  const clean = list.filter((j) => /^\d+$/.test(j.code) && j.name.trim()).map((j) => ({ code: j.code, name: j.name.replace(/\s+/g, " ").trim() }));
  if (clean.length < 5) throw new AppError("That judge list looks incomplete; not saved.");
  const now = new Date().toISOString();
  const { error } = await db()
    .from("hc_judges")
    .upsert(clean.map((j) => ({ ...j, sitting: true, seen_at: now })), { onConflict: "court,code" });
  if (error) throw new AppError(error.message, 500);
  await db().from("hc_judges").update({ sitting: false }).not("code", "in", `(${clean.map((j) => j.code).join(",")})`);
  return { judges: clean.length };
}

export async function judgeList() {
  await ensureReference();
  const { data, error } = await db().from("hc_judges").select("id, code, name, sitting").order("name");
  if (error) throw new AppError(error.message, 500);
  return data ?? [];
}

// ── runs ──────────────────────────────────────────────────────────────────

export async function createRun(args: {
  perJudge?: number;
  maxTries?: number;
  windowDays?: number;
  earliest?: string;
  judgeCodes?: string[];
  label?: string | null;
  staff: { id: string; name: string | null; email: string | null };
}): Promise<string> {
  await ensureReference();
  const { data: judges, error: jErr } = await db().from("hc_judges").select("id, code, name").eq("sitting", true);
  if (jErr) throw new AppError(jErr.message, 500);
  const order = new Map(JUDGES.map((j, i) => [j.code, i]));
  let list = (judges ?? []).sort((a, b) => (order.get(a.code) ?? 999) - (order.get(b.code) ?? 999));
  if (args.judgeCodes?.length) {
    const want = new Set(args.judgeCodes);
    list = list.filter((j) => want.has(j.code));
  }
  if (!list.length) throw new AppError("No judges selected.");

  const perJudge = clampInt(args.perJudge, DEFAULT_PER_JUDGE, 1, 100);
  const maxTries = clampInt(args.maxTries, DEFAULT_MAX_TRIES, 1, 30);
  const windowDays = clampInt(args.windowDays, DEFAULT_WINDOW_DAYS, 1, 366);
  const earliest = /^\d{4}-\d{2}-\d{2}$/.test(args.earliest ?? "") ? args.earliest! : yearsBefore(istToday(), DEFAULT_YEARS_BACK);

  const { data: run, error } = await db()
    .from("hc_runs")
    .insert({
      label: args.label?.trim() || null,
      per_judge: perJudge,
      max_tries: maxTries,
      window_days: windowDays,
      earliest,
      status: "running",
      created_by: args.staff.id,
      created_by_name: args.staff.name ?? args.staff.email,
      activity: [{ at: new Date().toISOString(), text: `Run created for ${list.length} judges.` }],
    })
    .select("id")
    .single();
  if (error || !run) throw new AppError(error?.message ?? "Could not create the run.", 500);

  const { error: tErr } = await db()
    .from("hc_tasks")
    .insert(list.map((j, i) => ({ run_id: run.id, seq: i + 1, judge_id: j.id, judge_code: j.code, judge_name: j.name, wanted: perJudge })));
  if (tErr) {
    await db().from("hc_runs").delete().eq("id", run.id);
    throw new AppError(tErr.message, 500);
  }
  return run.id as string;
}

export async function listRuns() {
  const { data, error } = await db()
    .from("hc_runs")
    .select("id, label, status, per_judge, max_tries, window_days, earliest, stats, created_at, finished_at, created_by_name")
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw error;
  return data ?? [];
}

export async function activeRun(): Promise<{ id: string; status: HcRunStatus } | null> {
  const { data, error } = await db()
    .from("hc_runs")
    .select("id, status")
    .in("status", ["running", "paused"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as { id: string; status: HcRunStatus }) ?? null;
}

async function loadRun(id: string): Promise<RunRow> {
  const { data, error } = await db().from("hc_runs").select(RUN_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw new AppError(error.message, 500);
  if (!data) throw new AppError("That run does not exist.", 404);
  return data as RunRow;
}

export async function setRunStatus(runId: string, status: "running" | "paused" | "cancelled") {
  const run = await loadRun(runId);
  if ((run.status === "done" || run.status === "cancelled") && status === "running") throw new AppError("That run has finished. Start a new one.");
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { status, updated_at: now };
  if (status === "cancelled") patch.finished_at = now;
  patch.activity = [...(run.activity ?? []), { at: now, text: `Run ${status === "running" ? "resumed" : status === "paused" ? "paused" : "stopped"}.` }].slice(-60);
  await db().from("hc_runs").update(patch).eq("id", runId);
}

export async function snapshot(runId: string): Promise<HcRunSnapshot> {
  const run = await loadRun(runId);
  const { data } = await db()
    .from("hc_tasks")
    .select("id, seq, judge_code, judge_name, status, wanted, found, tries, note, claimed_name, claimed_until")
    .eq("run_id", runId)
    .order("seq");
  const tasks = (data ?? []) as TaskRow[];
  const held = (t: TaskRow) => (t.claimed_name && t.claimed_until && Date.parse(t.claimed_until) > Date.now() ? shortName(t.claimed_name) : null);
  const working = new Map<string, string[]>();
  for (const t of tasks) {
    const who = held(t);
    if (who && t.status === "pending") working.set(who, [...(working.get(who) ?? []), t.judge_name]);
  }
  const totals = { found: 0, wanted: 0, judgesDone: 0, judges: tasks.length };
  for (const t of tasks) {
    totals.found += t.found;
    totals.wanted += t.status === "exhausted" || t.status === "skipped" ? t.found : t.wanted;
    if (t.status !== "pending") totals.judgesDone++;
  }
  return {
    run: {
      id: run.id,
      status: run.status,
      perJudge: run.per_judge,
      maxTries: run.max_tries,
      windowDays: run.window_days,
      earliest: run.earliest,
      label: run.label,
      stats: run.stats ?? {},
      lastError: run.last_error,
      createdAt: run.created_at,
      finishedAt: run.finished_at,
      createdByName: run.created_by_name,
    },
    capturers: [...working].map(([name, judges]) => ({ name, judges })),
    tasks: tasks.map((t) => ({
      id: t.id,
      judgeCode: t.judge_code,
      judgeName: t.judge_name,
      status: t.status,
      wanted: t.wanted,
      found: t.found,
      tries: t.tries,
      note: t.note,
      claimedBy: held(t),
    })),
    totals,
    activity: (run.activity ?? []).slice(-14).reverse().map((a) => a.text),
  };
}

// ── the ledger ────────────────────────────────────────────────────────────

async function touch(runId: string, delta: HcRunStats = {}, notes: string[] = [], lastError?: string | null, person?: { cap: Capturer; delta?: PersonStats }) {
  const at = new Date().toISOString();
  const who = person ? shortName(person.cap.name) : null;
  const { people: _people, ...numeric } = delta;
  const { error } = await db().rpc("hc_touch_run", {
    p_run: runId,
    p_delta: numeric,
    p_person: who,
    p_person_delta: person?.delta ?? {},
    p_notes: notes.map((text) => ({ at, text: who ? `${who} · ${text}` : text })),
    p_error: lastError ?? null,
    p_set_error: lastError !== undefined,
  });
  if (error) throw new AppError(error.message, 500);
}

function effortStats(e: CaptchaEffort | undefined, solved: boolean): HcRunStats {
  const prompts = Math.max(0, Math.min(50, Number(e?.prompts) || 0));
  return {
    captchasSolved: solved && prompts > 0 ? 1 : 0,
    captchasWrong: Math.max(0, Math.min(prompts, Number(e?.wrong) || 0)),
    solveMsTotal: Math.max(0, Math.min(30 * 60_000, Number(e?.solveMs) || 0)),
  };
}

// ── what to do next ───────────────────────────────────────────────────────

export async function nextAction(runId: string, cap: Capturer): Promise<HcAction> {
  const run = await loadRun(runId);
  if (run.status !== "running") {
    const action = run.status === "paused" ? "paused" : run.status === "cancelled" ? "cancelled" : "done";
    return { action, court: "highcourt", runId, message: action === "paused" ? "This run is paused in the app." : "This run has finished." };
  }
  await renewClaims(runId, cap);

  for (let attempt = 0; attempt < 3; attempt++) {
    const task = await myPendingTask(runId, cap);
    if (task) {
      const win = task.win_from && task.win_to ? { from: task.win_from, to: task.win_to } : await chooseWindow(run, task);
      await touch(runId);
      return {
        action: "search",
        court: "highcourt",
        runId,
        taskId: task.id,
        judgeCode: task.judge_code,
        judgeName: task.judge_name,
        from: win.from,
        to: win.to,
        fromDmy: toDmy(win.from),
        toDmy: toDmy(win.to),
        context: `${task.judge_name} · ${toDmy(win.from)} → ${toDmy(win.to)}`,
      };
    }
    const { data: claimed, error } = await db().rpc("hc_claim_task", { p_run: runId, p_capturer: cap.id, p_name: cap.name, p_seconds: CLAIM_SECONDS });
    if (error) throw new AppError(error.message, 500);
    if (!claimed) break;
  }

  const others = await heldByOthers(runId, cap);
  if (others.judges > 0) {
    await touch(runId);
    return {
      action: "wait",
      court: "highcourt",
      runId,
      message: `${others.people.join(", ")} ${others.people.length === 1 ? "has" : "have"} the last ${others.judges} judge${others.judges === 1 ? "" : "s"}. This picks up anything they leave.`,
    };
  }

  await touch(runId, {}, ["Every judge is done."]);
  await db().from("hc_runs").update({ status: "done", finished_at: new Date().toISOString(), lease_until: null }).eq("id", runId).eq("status", "running");
  return { action: "done", court: "highcourt", runId, message: "Every judge is done." };
}

async function chooseWindow(run: RunRow, task: TaskRow) {
  const today = istToday();
  const tried = task.windows ?? [];
  // First the whole range, one code for everything; after that, random windows the judge has not had.
  const win = !tried.some((w) => w.from <= run.earliest)
    ? { from: run.earliest, to: today }
    : randomWindow({ earliest: run.earliest, days: run.window_days, today, avoid: tried.filter((w) => daysBetween(w.from, w.to) < run.window_days) });
  // Only if still unset: a second tab asking at the same moment gets the same window.
  await db().from("hc_tasks").update({ win_from: win.from, win_to: win.to, updated_at: new Date().toISOString() }).eq("id", task.id).is("win_from", null);
  const { data } = await db().from("hc_tasks").select("win_from, win_to").eq("id", task.id).single();
  return { from: (data?.win_from as string) ?? win.from, to: (data?.win_to as string) ?? win.to };
}

async function renewClaims(runId: string, cap: Capturer) {
  await db()
    .from("hc_tasks")
    .update({ claimed_until: new Date(Date.now() + CLAIM_SECONDS * 1000).toISOString(), claimed_name: cap.name })
    .eq("run_id", runId)
    .eq("claimed_by", cap.id);
}

export async function heartbeat(runId: string, cap: Capturer) {
  await renewClaims(runId, cap);
  await touch(runId);
}

export async function release(runId: string, cap: Capturer) {
  await db().from("hc_tasks").update({ claimed_by: null, claimed_name: null, claimed_until: null }).eq("run_id", runId).eq("claimed_by", cap.id);
}

async function myPendingTask(runId: string, cap: Capturer): Promise<TaskRow | null> {
  const { data } = await db()
    .from("hc_tasks")
    .select("*")
    .eq("run_id", runId)
    .eq("claimed_by", cap.id)
    .eq("status", "pending")
    .order("seq")
    .limit(1)
    .maybeSingle();
  return (data as TaskRow) ?? null;
}

async function heldByOthers(runId: string, cap: Capturer) {
  const { data } = await db()
    .from("hc_tasks")
    .select("claimed_name")
    .eq("run_id", runId)
    .eq("status", "pending")
    .not("claimed_by", "is", null)
    .neq("claimed_by", cap.id)
    .gt("claimed_until", new Date().toISOString());
  const rows = (data ?? []) as { claimed_name: string | null }[];
  return { judges: rows.length, people: [...new Set(rows.map((r) => shortName(r.claimed_name ?? "")))] };
}

// ── a search, as the court's page showed it ───────────────────────────────

export type ResultsReport =
  | { kind: "results"; html: string; info?: string | null }
  | { kind: "empty"; message?: string }
  | { kind: "missing" }
  /** The court refused the search itself; its alert says why. */
  | { kind: "error"; message: string };

/** Fisher–Yates: "choose at random" within the window, not just its newest rows. */
function shuffle<T>(xs: T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export async function recordResults(args: { runId: string; taskId: string; from: string; to: string; report: ResultsReport; effort?: CaptchaEffort; cap: Capturer }) {
  const { runId, report, cap } = args;
  const { data } = await db().from("hc_tasks").select("*").eq("id", args.taskId).maybeSingle();
  const task = data as TaskRow | null;
  if (!task || task.run_id !== runId || task.status !== "pending" || task.win_from !== args.from) return { ignored: true, added: 0 };

  if (report.kind === "missing") {
    await db().from("hc_tasks").update({ status: "skipped", note: "No longer listed by the court", win_from: null, win_to: null }).eq("id", task.id);
    await touch(runId, {}, [`${task.judge_name}: the court no longer lists this judge. Skipped.`], undefined, { cap });
    return { ignored: false, added: 0 };
  }
  const run = await loadRun(runId);
  if (report.kind === "error") {
    // Note the refusal and clear the window: the next ask looks somewhere else.
    const tries = task.tries + 1;
    const status: HcTaskStatus = tries >= run.max_tries ? "exhausted" : "pending";
    await db()
      .from("hc_tasks")
      .update({
        tries,
        status,
        note: status === "exhausted" ? `The court refused: ${report.message}` : null,
        win_from: null,
        win_to: null,
        windows: [...(task.windows ?? []), { from: args.from, to: args.to, error: report.message }].slice(-40),
        updated_at: new Date().toISOString(),
      })
      .eq("id", task.id)
      .eq("win_from", args.from)
      .eq("status", "pending");
    await touch(runId, effortStats(args.effort, false), [`${task.judge_name}: the court said "${report.message}".`], report.message, { cap });
    return { ignored: false, added: 0 };
  }

  const parsed = report.kind === "results" ? parseJudgeResults(report.html, report.info) : { rows: [], total: 0 };
  const listed = parsed.total ?? parsed.rows.length;
  // Did the extension read the judge's whole list for this range?
  const whole = parsed.rows.length >= listed;
  const need = Math.max(0, task.wanted - task.found);
  const rows = shuffle(parsed.rows).map((r) => ({ ...r, dedupeKey: dedupeKey(r) }));

  await saveSearch({ runId, task, from: args.from, to: args.to, parsed, html: report.kind === "results" ? report.html : null });

  // A random sample, a batch at a time, until the judge has enough or the list runs out.
  let added = 0;
  const batch = need * 2 + 20;
  for (let i = 0; i < rows.length && added < need; i += batch) {
    const { data: n, error } = await db().rpc("hc_ingest_rows", { p: { judge_id: task.judge_id, run_id: runId, need: need - added, rows: rows.slice(i, i + batch) } });
    if (error) throw new AppError(`Could not save judgments: ${error.message}`, 500);
    added += Number(n) || 0;
  }

  const found = task.found + added;
  const tries = task.tries + 1;
  // The whole range, read whole: no other window can hold anything more.
  const everything = whole && args.from <= run.earliest;
  const status: HcTaskStatus = found >= task.wanted ? "done" : everything || tries >= run.max_tries ? "exhausted" : "pending";
  const since = `since ${run.earliest.slice(0, 4)}`;
  const note =
    status === "done"
      ? `${found} judgments`
      : status === "exhausted"
        ? everything
          ? found
            ? `Only ${found} ${since}`
            : `None ${since}`
          : found
            ? `Only ${found} in ${tries} searches`
            : `None in ${tries} searches`
        : null;
  await db()
    .from("hc_tasks")
    .update({
      found,
      tries,
      status,
      note,
      win_from: null,
      win_to: null,
      windows: [...(task.windows ?? []), { from: args.from, to: args.to, listed, read: parsed.rows.length, took: added }].slice(-40),
      updated_at: new Date().toISOString(),
    })
    .eq("id", task.id)
    .eq("win_from", args.from)
    .eq("status", "pending");

  await touch(
    runId,
    { searches: 1, emptyWindows: listed ? 0 : 1, judgments: added, ...effortStats(args.effort, true) },
    [
      listed
        ? `${task.judge_name} ${args.from} → ${args.to}: ${listed} listed${whole ? "" : `, ${parsed.rows.length} read`}, kept ${added}.`
        : `${task.judge_name} ${args.from} → ${args.to}: nothing uploaded.`,
    ],
    null,
    { cap, delta: { searches: 1, cases: added, captchas: Number(args.effort?.prompts) > 0 ? 1 : 0 } }
  );
  return { ignored: false, added };
}

/**
 * Every search as the court answered it: the whole list, each row's fields
 * and its PDF and text links, which open later without a captcha. A long list
 * is kept without its HTML (each saved judgment keeps its own row's).
 */
async function saveSearch(args: { runId: string; task: TaskRow; from: string; to: string; parsed: { rows: HcRow[]; total: number | null }; html: string | null }) {
  const { runId, task, parsed } = args;
  const record = {
    run_id: runId,
    task_id: task.id,
    judge_code: task.judge_code,
    judge_name: task.judge_name,
    from_date: args.from,
    to_date: args.to,
    outcome: parsed.rows.length ? "results" : "empty",
    listed_total: parsed.total,
    rows: parsed.rows.map(({ html: _h, ...r }) => r),
    html: parsed.rows.length <= 200 ? args.html : null,
  };
  const { error } = await db().from("hc_search_results").insert(record);
  // Too large for one write: keep the counts rather than hold up the judge.
  if (error) await db().from("hc_search_results").insert({ ...record, rows: [], html: null });
}

function clampInt(v: unknown, dflt: number, min: number, max: number) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && v !== null && v !== undefined && v !== "" ? Math.min(max, Math.max(min, n)) : dflt;
}

export { CAPTURE_SEEN_SECONDS };
