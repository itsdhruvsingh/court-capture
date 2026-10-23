/**
 * Court Cases — the run engine.
 *
 * A run is "the newest N cases of every case type at Saket". The court
 * forbids direct API calls and puts a captcha on every search and most case
 * pages, so the reading happens in a person's browser: the SCL Court Capture
 * extension drives the court's own page, the person types each captcha, and
 * the extension posts what the page shows back here.
 *
 * This module is the planner and the record-keeper. It never contacts the
 * court. The extension asks `nextAction()` what to do, does it on the page,
 * and reports with `recordSearch()` or `recordDetails()`.
 *
 * Order of work:
 *   1. a listed case whose page has not been read → open it
 *   2. a case type that still needs cases → search its next year
 *   3. nothing left → the run is done
 *
 * Every report is idempotent: a stale or repeated one (two tabs, a retry
 * after a dropped response) is recognised and ignored.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { AppError } from "@/lib/errors";
import { CAPTURE_SEEN_SECONDS, CASE_TYPES, COURT, DEFAULT_MAX_YEARS, DEFAULT_PER_TYPE, ESTABLISHMENTS } from "./config";
import { advocateKey, caseTitle, parseCaseDetails, parseSearchResults, pickNewest } from "./parse";
import type { Capturer, CaptchaEffort, CaptureAction, ParsedCase, PersonStats, RunSnapshot, RunStats, RunStatus, TaskStatus } from "./types";

/** A person's hold on a case type lapses this long after their extension last checked in. */
const CLAIM_SECONDS = 300;

/** "asha@example.com" → "asha": how people appear in activity and counts. */
export function shortName(name: string) {
  return (name || "someone").split("@")[0];
}

function db(): SupabaseClient {
  return supabaseAdmin() as unknown as SupabaseClient;
}

/** Engine failures are app errors: a status and a sentence somebody can act on. */
export const EngineError = AppError;

// ── rows ──────────────────────────────────────────────────────────────────

type RunRow = {
  id: string;
  label: string | null;
  case_status: "P" | "D";
  per_type: number;
  max_years: number;
  start_year: number;
  status: RunStatus;
  stats: RunStats;
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
  case_type_code: string;
  case_type_name: string;
  status: TaskStatus;
  next_year: number;
  years_tried: number;
  wanted: number;
  found: number;
  note: string | null;
  log: { at: string; text: string }[];
  claimed_by?: string | null;
  claimed_name?: string | null;
  claimed_until?: string | null;
};

type CaseStub = {
  id: string;
  cnr: string;
  est_code: string | null;
  case_number: string | null;
  case_type_code: string | null;
  detail_status: string;
  fetched_at: string | null;
};

type Queued = { id: string; task_id: string; case_id: string; attempts: number; status: string; stub: CaseStub; taskCode: string };

const RUN_COLUMNS =
  "id, label, case_status, per_type, max_years, start_year, status, stats, activity, last_error, lease_until, created_at, finished_at, created_by_name";

/** A case read this recently is counted, not read again. */
const FRESH_MS = 3 * 24 * 60 * 60_000;

/** Give up on one case page after this many failures that were not captchas. */
const MAX_DETAIL_ATTEMPTS = 3;

// ── creating and listing runs ─────────────────────────────────────────────

export function caseTypes() {
  return CASE_TYPES;
}

export async function createRun(args: {
  caseStatus: "P" | "D";
  perType?: number;
  maxYears?: number;
  startYear?: number;
  caseTypes?: string[];
  label?: string | null;
  staff: { id: string; name: string | null; email: string | null };
}): Promise<string> {
  let types = CASE_TYPES;
  if (args.caseTypes?.length) {
    const want = new Set(args.caseTypes);
    types = types.filter((t) => want.has(t.code));
  }
  if (!types.length) throw new EngineError("No case types selected.");

  const perType = clampInt(args.perType, DEFAULT_PER_TYPE, 1, 25);
  const maxYears = clampInt(args.maxYears, DEFAULT_MAX_YEARS, 1, 30);
  const startYear = clampInt(args.startYear, istYear(), 1950, istYear());

  const { data: run, error } = await db()
    .from("court_scrape_runs")
    .insert({
      label: args.label?.trim() || null,
      court: COURT.key,
      complex_code: COURT.complexCode,
      complex_name: COURT.complexName,
      case_status: args.caseStatus,
      per_type: perType,
      max_years: maxYears,
      start_year: startYear,
      status: "running",
      created_by: args.staff.id,
      created_by_name: args.staff.name ?? args.staff.email,
      activity: [{ at: new Date().toISOString(), text: `Run created for ${types.length} case types. Open the court's search page to start.` }],
    })
    .select("id")
    .single();
  if (error || !run) throw new EngineError(error?.message ?? "Could not create the run.", 500);

  const { error: tErr } = await db()
    .from("court_scrape_tasks")
    .insert(
      types.map((t, i) => ({
        run_id: run.id,
        seq: i + 1,
        case_type_code: t.code,
        case_type_name: t.name,
        next_year: startYear,
        wanted: perType,
      }))
    );
  if (tErr) {
    await db().from("court_scrape_runs").delete().eq("id", run.id);
    throw new EngineError(tErr.message, 500);
  }
  return run.id as string;
}

export async function listRuns() {
  const { data, error } = await db()
    .from("court_scrape_runs")
    .select("id, label, status, case_status, per_type, max_years, start_year, stats, created_at, finished_at, created_by_name")
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw error;
  return data ?? [];
}

/** The run the extension should work on: the newest one still open. */
export async function activeRun(): Promise<{ id: string; status: RunStatus; label: string | null; caseStatus: "P" | "D"; perType: number } | null> {
  const { data, error } = await db()
    .from("court_scrape_runs")
    .select("id, status, label, case_status, per_type")
    .in("status", ["running", "paused"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ? { id: data.id, status: data.status, label: data.label, caseStatus: data.case_status, perType: data.per_type } : null;
}

async function loadRun(id: string): Promise<RunRow> {
  const { data, error } = await db().from("court_scrape_runs").select(RUN_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw new EngineError(error.message, 500);
  if (!data) throw new EngineError("That run does not exist.", 404);
  return data as RunRow;
}

export async function snapshot(runId: string): Promise<RunSnapshot> {
  const run = await loadRun(runId);
  const { data: tasks } = await db()
    .from("court_scrape_tasks")
    .select("id, seq, case_type_code, case_type_name, status, next_year, years_tried, wanted, found, note, claimed_name, claimed_until")
    .eq("run_id", runId)
    .order("seq");
  const rows = (tasks ?? []) as TaskRow[];
  const held = (t: TaskRow) => (t.claimed_name && t.claimed_until && Date.parse(t.claimed_until) > Date.now() ? shortName(t.claimed_name) : null);
  // A run has at most ~80 tasks, comfortably inside one `in` filter.
  const { data: progress } = rows.length
    ? await db().from("court_scrape_task_progress").select("task_id, queued, fetched, failed").in("task_id", rows.map((t) => t.id))
    : { data: [] };
  const prog = new Map((progress ?? []).map((p) => [p.task_id as string, p as { queued: number; fetched: number; failed: number }]));

  const totals = { listed: 0, fetched: 0, failed: 0, wanted: 0 };
  for (const t of rows) {
    const p = prog.get(t.id);
    totals.listed += Number(p?.queued ?? 0);
    totals.fetched += Number(p?.fetched ?? 0);
    totals.failed += Number(p?.failed ?? 0);
    // A type that ran out of years only ever wanted what it found.
    totals.wanted += t.status === "exhausted" || t.status === "skipped" ? t.found : t.wanted;
  }
  const seen = run.lease_until ? Date.parse(run.lease_until) - CAPTURE_SEEN_SECONDS * 1000 : null;
  const working = new Map<string, string[]>();
  for (const t of rows) {
    const who = held(t);
    if (!who) continue;
    const p = prog.get(t.id);
    const hasWork = t.status === "pending" || Number(p?.queued ?? 0) > Number(p?.fetched ?? 0) + Number(p?.failed ?? 0);
    if (hasWork) working.set(who, [...(working.get(who) ?? []), t.case_type_name]);
  }
  return {
    run: {
      id: run.id,
      status: run.status,
      caseStatus: run.case_status,
      perType: run.per_type,
      maxYears: run.max_years,
      startYear: run.start_year,
      label: run.label,
      stats: run.stats ?? {},
      lastError: run.last_error,
      createdAt: run.created_at,
      finishedAt: run.finished_at,
      createdByName: run.created_by_name,
    },
    capturer: {
      active: !!run.lease_until && Date.parse(run.lease_until) > Date.now(),
      lastSeen: seen ? new Date(seen).toISOString() : null,
    },
    capturers: [...working].map(([name, caseTypes]) => ({ name, caseTypes })),
    tasks: rows.map((t) => ({
      id: t.id,
      code: t.case_type_code,
      name: t.case_type_name,
      status: t.status,
      nextYear: t.next_year,
      yearsTried: t.years_tried,
      wanted: t.wanted,
      found: t.found,
      fetched: Number(prog.get(t.id)?.fetched ?? 0),
      note: t.note,
      claimedBy: held(t),
    })),
    totals,
    activity: (run.activity ?? []).slice(-14).reverse().map((a) => a.text),
  };
}

export async function setRunStatus(runId: string, status: "running" | "paused" | "cancelled") {
  const run = await loadRun(runId);
  if ((run.status === "done" || run.status === "cancelled") && status === "running") {
    throw new EngineError("That run has finished. Start a new one.");
  }
  const patch: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
  if (status === "cancelled") patch.finished_at = new Date().toISOString();
  patch.activity = [...(run.activity ?? []), { at: new Date().toISOString(), text: `Run ${status === "running" ? "resumed" : status === "paused" ? "paused" : "stopped"}.` }].slice(-60);
  await db().from("court_scrape_runs").update(patch).eq("id", runId);
}

// ── the run's ledger: stats and activity ──────────────────────────────────

/**
 * Add to the run's counters (and one person's), append activity lines and
 * mark the run as seen — atomically in the database, because several people
 * report at once. Before migration 0052 it falls back to read-modify-write.
 */
async function touch(
  runId: string,
  delta: RunStats = {},
  notes: string[] = [],
  lastError?: string | null,
  person?: { cap: Capturer; delta?: PersonStats }
) {
  const at = new Date().toISOString();
  const who = person ? shortName(person.cap.name) : null;
  const lines = notes.map((text) => ({ at, text: who ? `${who} · ${text}` : text }));
  const { people: _ignored, ...numeric } = delta;
  const { error } = await db().rpc("court_touch_run", {
    p_run: runId,
    p_delta: numeric,
    p_person: who,
    p_person_delta: person?.delta ?? {},
    p_notes: lines,
    p_error: lastError ?? null,
    p_set_error: lastError !== undefined,
  });
  if (!error) return;
  if (!/court_touch_run/.test(error.message)) throw new EngineError(error.message, 500);
  await touchLegacy(runId, numeric, lines.map((l) => l.text), lastError);
}

async function touchLegacy(runId: string, delta: RunStats, notes: string[], lastError?: string | null) {
  const run = await loadRun(runId);
  const stats: RunStats = { ...(run.stats ?? {}) };
  for (const [k, v] of Object.entries(delta)) {
    if (!v || typeof v !== "number") continue;
    const key = k as Exclude<keyof RunStats, "people">;
    stats[key] = (stats[key] ?? 0) + v;
  }
  const now = new Date();
  const patch: Record<string, unknown> = {
    stats,
    lease_until: new Date(now.getTime() + CAPTURE_SEEN_SECONDS * 1000).toISOString(),
    updated_at: now.toISOString(),
  };
  if (notes.length) patch.activity = [...(run.activity ?? []), ...notes.map((text) => ({ at: now.toISOString(), text }))].slice(-60);
  if (lastError !== undefined) patch.last_error = lastError;
  await db().from("court_scrape_runs").update(patch).eq("id", runId);
}

function effortStats(e: CaptchaEffort | undefined, solved: boolean): RunStats {
  const prompts = Math.max(0, Math.min(50, Number(e?.prompts) || 0));
  const wrong = Math.max(0, Math.min(prompts, Number(e?.wrong) || 0));
  return {
    captchasSolved: solved && prompts > 0 ? 1 : 0,
    captchasWrong: wrong,
    solveMsTotal: Math.max(0, Math.min(30 * 60_000, Number(e?.solveMs) || 0)),
  };
}

/** One person's share of a step: a captcha if they typed one, plus what it achieved. */
function personDelta(e: CaptchaEffort | undefined, extra: PersonStats): PersonStats {
  return { captchas: Number(e?.prompts) > 0 ? 1 : 0, ...extra };
}

// ── what to do next ───────────────────────────────────────────────────────

/**
 * The next step for one person. Each person works through case types they
 * hold: first the listed cases still to open, then the next year to search.
 * When their types are finished they claim the next free one. When every type
 * left is held by somebody else, they are told to wait — and a type whose
 * holder went quiet for CLAIM_SECONDS becomes free again, cases and all.
 */
export async function nextAction(runId: string, cap: Capturer): Promise<CaptureAction> {
  const run = await loadRun(runId);
  if (run.status !== "running") {
    const action = run.status === "paused" ? "paused" : run.status === "cancelled" ? "cancelled" : "done";
    return { action, runId, message: action === "paused" ? "This run is paused in the dashboard." : "This run has finished." };
  }
  await renewClaims(runId, cap);

  for (let attempt = 0; attempt < 3; attempt++) {
    const q = await nextQueuedFor(runId, cap);
    if (q) {
      await touch(runId);
      return {
        action: "details",
        runId,
        caseId: q.case_id,
        cnr: q.stub.cnr,
        estCode: q.stub.est_code || q.stub.cnr.slice(0, 6),
        context: q.stub.case_number ?? q.stub.cnr,
      };
    }

    const task = await myPendingTask(runId, cap);
    if (task) {
      await touch(runId);
      return {
        action: "search",
        runId,
        taskId: task.id,
        caseType: task.case_type_code,
        caseTypeName: task.case_type_name,
        year: task.next_year,
        status: run.case_status,
        complexCode: COURT.complexCode,
        context: `${task.case_type_name} · ${task.next_year} · ${run.case_status === "P" ? "pending" : "disposed"}`,
      };
    }

    const { data: claimed, error } = await db().rpc("court_claim_task", {
      p_run: runId,
      p_capturer: cap.id,
      p_name: cap.name,
      p_seconds: CLAIM_SECONDS,
    });
    if (error) throw new EngineError(error.message, 500);
    if (!claimed) break;
    // Loop: the type just claimed is now this person's.
  }

  const others = await workHeldByOthers(runId, cap);
  if (others.types > 0) {
    await touch(runId);
    const names = others.people.join(", ");
    return {
      action: "wait",
      runId,
      message: `${names} ${others.people.length === 1 ? "has" : "have"} the last ${others.types} case type${others.types === 1 ? "" : "s"}. This picks up anything they leave.`,
    };
  }

  await touch(runId, {}, ["Every case type is done."]);
  await db()
    .from("court_scrape_runs")
    .update({ status: "done", finished_at: new Date().toISOString(), lease_until: null })
    .eq("id", runId)
    .eq("status", "running");
  return { action: "done", runId, message: "Every case type is done." };
}

/** Keep this person's case types theirs while their extension is checking in. */
async function renewClaims(runId: string, cap: Capturer) {
  await db()
    .from("court_scrape_tasks")
    .update({ claimed_until: new Date(Date.now() + CLAIM_SECONDS * 1000).toISOString(), claimed_name: cap.name })
    .eq("run_id", runId)
    .eq("claimed_by", cap.id);
}

/** Sent by the extension while it waits for a person to type, so their claim holds. */
export async function heartbeat(runId: string, cap: Capturer) {
  await renewClaims(runId, cap);
  await touch(runId);
}

/** Pause pressed on the panel: hand this person's case types back straight away. */
export async function release(runId: string, cap: Capturer) {
  await db()
    .from("court_scrape_tasks")
    .update({ claimed_by: null, claimed_name: null, claimed_until: null })
    .eq("run_id", runId)
    .eq("claimed_by", cap.id);
}

async function myPendingTask(runId: string, cap: Capturer): Promise<TaskRow | null> {
  const { data } = await db()
    .from("court_scrape_tasks")
    .select("*")
    .eq("run_id", runId)
    .eq("claimed_by", cap.id)
    .eq("status", "pending")
    .order("seq")
    .limit(1)
    .maybeSingle();
  return (data as TaskRow) ?? null;
}

/** Case types with work left that someone else holds right now. */
async function workHeldByOthers(runId: string, cap: Capturer): Promise<{ types: number; people: string[] }> {
  const { data: tasks } = await db()
    .from("court_scrape_tasks")
    .select("id, status, claimed_by, claimed_name, claimed_until")
    .eq("run_id", runId)
    .not("claimed_by", "is", null)
    .neq("claimed_by", cap.id)
    .gt("claimed_until", new Date().toISOString());
  const held = (tasks ?? []) as TaskRow[];
  if (!held.length) return { types: 0, people: [] };
  const { data: queued } = await db()
    .from("court_scrape_queue")
    .select("task_id")
    .eq("run_id", runId)
    .eq("status", "pending")
    .in("task_id", held.map((t) => t.id));
  const withQueue = new Set((queued ?? []).map((q) => q.task_id as string));
  const busy = held.filter((t) => t.status === "pending" || withQueue.has(t.id));
  return { types: busy.length, people: [...new Set(busy.map((t) => shortName(t.claimed_name ?? "")))] };
}

const QUEUE_SELECT =
  "id, task_id, case_id, attempts, status, court_cases(id, cnr, est_code, case_number, case_type_code, detail_status, fetched_at), court_scrape_tasks(case_type_code)";

function toQueued(data: unknown): Queued {
  const row = data as Omit<Queued, "stub" | "taskCode"> & { court_cases: CaseStub; court_scrape_tasks: { case_type_code: string } | null };
  return { ...row, stub: row.court_cases, taskCode: row.court_scrape_tasks?.case_type_code ?? "" };
}

/** The next listed case to open, among the case types this person holds. */
async function nextQueuedFor(runId: string, cap: Capturer): Promise<Queued | null> {
  const { data } = await db()
    .from("court_scrape_queue")
    .select(QUEUE_SELECT.replace("court_scrape_tasks(case_type_code)", "court_scrape_tasks!inner(case_type_code, claimed_by)"))
    .eq("run_id", runId)
    .eq("status", "pending")
    .eq("court_scrape_tasks.claimed_by", cap.id)
    .order("seq")
    .limit(1)
    .maybeSingle();
  return data ? toQueued(data) : null;
}

async function queuedByCase(runId: string, caseId: string): Promise<Queued | null> {
  const { data } = await db().from("court_scrape_queue").select(QUEUE_SELECT).eq("run_id", runId).eq("case_id", caseId).maybeSingle();
  return data ? toQueued(data) : null;
}

// ── a search, as the court's page showed it ───────────────────────────────

export type SearchReport =
  | { kind: "results"; html: string }
  | { kind: "empty"; message?: string }
  | { kind: "missing" }
  | { kind: "error"; message: string };

export async function recordSearch(args: { runId: string; taskId: string; year: number; report: SearchReport; effort?: CaptchaEffort; cap: Capturer }) {
  const { runId, report, cap } = args;
  const { data } = await db().from("court_scrape_tasks").select("*").eq("id", args.taskId).maybeSingle();
  const task = data as TaskRow | null;
  // Stale: already handled, by this tab's retry or by another tab.
  if (!task || task.run_id !== runId || task.status !== "pending" || task.next_year !== args.year) return { ignored: true };

  if (report.kind === "missing") {
    await db()
      .from("court_scrape_tasks")
      .update({ status: "skipped", note: "Not offered by the court any more", updated_at: new Date().toISOString() })
      .eq("id", task.id);
    await touch(runId, {}, [`${task.case_type_name}: the court no longer lists this case type. Skipped.`], undefined, { cap });
    return { ignored: false };
  }

  if (report.kind === "error") {
    await taskLog(task, `Search ${task.next_year} failed: ${report.message}`);
    await touch(runId, effortStats(args.effort, false), [`${task.case_type_name} ${task.next_year}: the court said "${report.message}". Trying again.`], report.message, { cap });
    return { ignored: false };
  }

  const run = await loadRun(runId);
  const label = run.case_status === "P" ? "pending" : "disposed";
  await keepSearch(run, task, report);

  if (report.kind === "empty") {
    await advanceYear(run, task, 0, `${task.next_year}: none`);
    await touch(runId, { searches: 1, emptyYears: 1, ...effortStats(args.effort, true) }, [`${task.case_type_name} ${task.next_year}: no ${label} cases.`], null, { cap, delta: personDelta(args.effort, { searches: 1 }) });
    return { ignored: false };
  }

  const blocks = parseSearchResults(report.html);
  if (!blocks.some((b) => b.rows.length)) {
    await advanceYear(run, task, 0, `${task.next_year}: none`);
    await touch(runId, { searches: 1, emptyYears: 1, ...effortStats(args.effort, true) }, [`${task.case_type_name} ${task.next_year}: no ${label} cases.`], null, { cap, delta: personDelta(args.effort, { searches: 1 }) });
    return { ignored: false };
  }

  // Already queued for this type (an earlier year can list the same case).
  const { data: queued } = await db().from("court_scrape_queue").select("court_cases(cnr)").eq("task_id", task.id);
  const skip = new Set(
    ((queued ?? []) as unknown as { court_cases: { cnr: string } | null }[]).map((q) => q.court_cases?.cnr).filter(Boolean) as string[]
  );
  const picks = pickNewest(blocks, task.case_type_name, task.wanted - task.found, skip);
  const listedTotal = blocks.reduce((n, b) => n + (b.total ?? b.rows.length), 0);

  let added = 0;
  for (const r of picks) {
    const stub = await upsertStub(runId, task, r);
    const fresh = stub.detail_status === "fetched" && stub.fetched_at && Date.now() - Date.parse(stub.fetched_at) < FRESH_MS;
    const { error } = await db()
      .from("court_scrape_queue")
      .insert({ run_id: runId, task_id: task.id, case_id: stub.id, status: fresh ? "reused" : "pending" });
    if (!error) added++;
  }
  await advanceYear(run, task, added, `${task.next_year}: ${listedTotal} listed, took ${added}`);
  await touch(runId, { searches: 1, ...effortStats(args.effort, true) }, [`${task.case_type_name} ${task.next_year}: ${listedTotal} listed, took the newest ${added}.`], null, { cap, delta: personDelta(args.effort, { searches: 1 }) });
  return { ignored: false };
}

/**
 * Every search as the court answered it — all listed rows, not only the ten
 * newest the run opens, and the HTML. Kept even when a year is empty, so
 * "nothing pending in 2019" is a recorded fact rather than an absence.
 * Before migration 0051 the table does not exist; the run carries on without it.
 */
async function keepSearch(run: RunRow, task: TaskRow, report: Extract<SearchReport, { kind: "results" | "empty" }>) {
  const blocks = report.kind === "results" ? parseSearchResults(report.html) : [];
  const { error } = await db()
    .from("court_search_results")
    .insert({
      run_id: run.id,
      task_id: task.id,
      court: COURT.key,
      case_type_code: task.case_type_code,
      case_type_name: task.case_type_name,
      reg_year: task.next_year,
      case_status: run.case_status,
      outcome: blocks.some((b) => b.rows.length) ? "results" : "empty",
      blocks,
      listed_total: blocks.reduce((n, b) => n + (b.total ?? b.rows.length), 0),
      message: report.kind === "empty" ? report.message ?? null : null,
      html: report.kind === "results" ? report.html : null,
    });
  if (error && !/court_search_results/.test(error.message)) console.error("[court-cases] could not keep a search:", error.message);
}

async function upsertStub(runId: string, task: TaskRow, r: ReturnType<typeof pickNewest>[number]): Promise<CaseStub> {
  const cols = "id, cnr, est_code, case_number, case_type_code, detail_status, fetched_at";
  const { data: existing } = await db().from("court_cases").select(cols).eq("cnr", r.cnr).maybeSingle();
  if (existing) {
    await db()
      .from("court_cases")
      .update({ last_run_id: runId, case_type_code: existing.case_type_code ?? task.case_type_code })
      .eq("id", existing.id);
    return existing as CaseStub;
  }
  const { data, error } = await db()
    .from("court_cases")
    .insert({
      cnr: r.cnr,
      court: COURT.key,
      est_code: r.estCode,
      establishment: ESTABLISHMENTS[r.estCode] ?? r.establishment,
      case_type_code: task.case_type_code,
      case_type: r.typeLabel || task.case_type_name,
      case_number: r.caseNumber,
      case_no: r.number,
      case_year: r.year,
      title: r.respondent ? `${r.petitioner} vs ${r.respondent}` : r.petitioner,
      masked: r.masked,
      detail_status: "listed",
      last_run_id: runId,
    })
    .select(cols)
    .single();
  if (error || !data) throw new EngineError(error?.message ?? "Could not save a listed case.", 500);
  return data as CaseStub;
}

async function advanceYear(run: RunRow, task: TaskRow, added: number, logLine: string) {
  const found = task.found + added;
  const yearsTried = task.years_tried + 1;
  let status: TaskStatus = "pending";
  let note: string | null = null;
  if (found >= task.wanted) {
    status = "done";
    note = `${found} cases`;
  } else if (yearsTried >= run.max_years) {
    status = "exhausted";
    note = found ? `Only ${found} in ${yearsTried} years` : `None in ${yearsTried} years`;
  }
  // Conditional on the year we searched, so a repeated report cannot advance twice.
  await db()
    .from("court_scrape_tasks")
    .update({
      found,
      years_tried: yearsTried,
      next_year: status === "pending" ? task.next_year - 1 : task.next_year,
      status,
      note,
      log: [...(task.log ?? []), { at: new Date().toISOString(), text: logLine }].slice(-30),
      updated_at: new Date().toISOString(),
    })
    .eq("id", task.id)
    .eq("next_year", task.next_year)
    .eq("status", "pending");
}

async function taskLog(task: TaskRow, text: string) {
  await db()
    .from("court_scrape_tasks")
    .update({ log: [...(task.log ?? []), { at: new Date().toISOString(), text }].slice(-30), updated_at: new Date().toISOString() })
    .eq("id", task.id);
}

// ── a case page, as the court's page showed it ────────────────────────────

export type DetailsReport = { kind: "page"; html: string } | { kind: "error"; message: string } | { kind: "skipped" };

export async function recordDetails(args: { runId: string; caseId: string; report: DetailsReport; effort?: CaptchaEffort; cap: Capturer }) {
  const { runId, report, cap } = args;
  const q = await queuedByCase(runId, args.caseId);
  if (!q || q.status !== "pending") return { ignored: true };

  if (report.kind === "skipped") {
    await failQueued(q, "Skipped from the extension.", true);
    await touch(runId, { detailsFailed: 1 }, [`${q.stub.case_number ?? q.stub.cnr}: skipped.`], undefined, { cap });
    return { ignored: false };
  }
  if (report.kind === "error") {
    const final = await failQueued(q, report.message, false);
    await touch(
      runId,
      { detailsFailed: final ? 1 : 0, ...effortStats(args.effort, false) },
      [`${q.stub.case_number ?? q.stub.cnr}: ${report.message}${final ? " — gave up." : " — will retry."}`],
      report.message,
      { cap }
    );
    return { ignored: false };
  }

  const parsed = parseCaseDetails(report.html);
  if (!parsed.cnr || parsed.cnr !== q.stub.cnr) {
    const msg = parsed.cnr ? `The court showed ${parsed.cnr} instead of ${q.stub.cnr}.` : "The page did not look like a case page.";
    await failQueued(q, msg, false);
    await touch(runId, effortStats(args.effort, false), [`${q.stub.case_number ?? q.stub.cnr}: ${msg}`], msg, { cap });
    return { ignored: false };
  }

  const payload = ingestPayload(parsed, {
    cnr: q.stub.cnr,
    estCode: q.stub.est_code || q.stub.cnr.slice(0, 6),
    caseTypeCode: q.stub.case_type_code ?? q.taskCode,
    runId,
    html: report.html,
  });
  const { error } = await db().rpc("court_ingest_case", { p: payload });
  if (error) throw new EngineError(`Could not save ${q.stub.cnr}: ${error.message}`, 500);
  await db().from("court_scrape_queue").update({ status: "done", error: null, updated_at: new Date().toISOString() }).eq("id", q.id);

  const free = !(Number(args.effort?.prompts) > 0);
  const adv = payload.advocates.length;
  await touch(
    runId,
    { details: 1, detailsFree: free ? 1 : 0, ...effortStats(args.effort, true) },
    [`${payload.case_number ?? q.stub.cnr}: ${parsed.hearings.length} hearings, ${parsed.orders.length} orders, ${adv} advocate${adv === 1 ? "" : "s"}.`],
    null,
    { cap, delta: personDelta(args.effort, { cases: 1 }) }
  );
  return { ignored: false };
}

/** Count a failed attempt; give up after a few. Returns true when it gave up. */
async function failQueued(q: Queued, message: string, now: boolean) {
  const attempts = q.attempts + 1;
  const final = now || attempts >= MAX_DETAIL_ATTEMPTS;
  await db()
    .from("court_scrape_queue")
    .update({ attempts, error: message, status: final ? "failed" : "pending", updated_at: new Date().toISOString() })
    .eq("id", q.id);
  if (final) {
    await db().from("court_cases").update({ detail_status: "failed", detail_error: message }).eq("id", q.case_id).neq("detail_status", "fetched");
  }
  return final;
}

export function ingestPayload(p: ParsedCase, extra: { cnr: string; estCode: string; caseTypeCode: string | null; runId: string | null; html: string }) {
  const advocates = (["petitioner", "respondent"] as const)
    .flatMap((side) =>
      (side === "petitioner" ? p.petitioners : p.respondents).flatMap((party) =>
        party.advocates.map((name) => ({ side, partyIndex: party.index, partyName: party.name, name, key: advocateKey(name) }))
      )
    )
    .filter((a) => a.key);
  const advocateNames = [...new Set(advocates.map((a) => a.name))].join(" · ");
  const caseNumber = p.caseTypeLabel && p.caseNo && p.caseYear ? `${p.caseTypeLabel}/${p.caseNo}/${p.caseYear}` : null;
  return {
    cnr: p.cnr || extra.cnr,
    court: COURT.key,
    est_code: extra.estCode,
    establishment: ESTABLISHMENTS[extra.estCode] ?? p.establishment,
    case_type_code: extra.caseTypeCode,
    case_type: p.caseTypeLabel,
    case_type_full: p.caseTypeFull,
    case_number: caseNumber,
    case_no: p.caseNo,
    case_year: p.caseYear,
    filing_number: p.filingNumber,
    filing_date: p.filingDate,
    registration_date: p.registrationDate,
    first_hearing_date: p.firstHearingDate,
    next_hearing_date: p.nextHearingDate,
    decision_date: p.decisionDate,
    status: p.status,
    stage: p.stage,
    nature_of_disposal: p.natureOfDisposal,
    court_judge: p.courtJudge,
    title: caseTitle(p.petitioners, p.respondents),
    petitioners: p.petitioners,
    respondents: p.respondents,
    advocate_names: advocateNames || null,
    acts: p.acts,
    fir: p.fir,
    extra: p.extra,
    tables: p.tables,
    sections: p.sections,
    masked: p.masked,
    run_id: extra.runId,
    raw_html: extra.html,
    hearings: p.hearings,
    advocates,
    orders: p.orders,
  };
}

// ── helpers ───────────────────────────────────────────────────────────────

function clampInt(v: unknown, dflt: number, min: number, max: number) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && v !== null && v !== undefined && v !== "" ? Math.min(max, Math.max(min, n)) : dflt;
}

/** The year in India, not wherever the server happens to be. */
function istYear() {
  return Number(new Intl.DateTimeFormat("en-IN", { year: "numeric", timeZone: "Asia/Kolkata" }).format(new Date()));
}
