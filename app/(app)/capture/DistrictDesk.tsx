"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { CheckCircle2, CircleDashed, Copy, ExternalLink, KeyRound, Pause, Play, Plug, Square, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge, Button, Card, Empty, Field, Input, PageHeader, Progress, Select, Skeleton, Spinner } from "@/components/ui";
import { useToast } from "@/components/Toaster";
import { SetupNotice, fmtDate, getJson, todayIso } from "../district/ui";
import { DISTRICT_PAGE as COURT_PAGE, Metric, People, RunStatusBadge } from "./shared";
import type { RunSnapshot } from "@/lib/district/types";

type RunListItem = {
  id: string;
  label: string | null;
  status: string;
  case_status: "P" | "D";
  per_type: number;
  max_years: number;
  start_year: number;
  stats: RunSnapshot["run"]["stats"];
  created_at: string;
  finished_at: string | null;
  created_by_name: string | null;
};

type CaseType = { code: string; name: string };

const nf = new Intl.NumberFormat("en-IN");

export function DistrictDesk({ initialRun }: { initialRun: string | null }) {
  const { toast } = useToast();
  const [runs, setRuns] = useState<RunListItem[] | null>(null);
  const [runId, setRunId] = useState<string | null>(initialRun);
  const [snap, setSnap] = useState<RunSnapshot | null>(null);
  const [setup, setSetup] = useState<string | null>(null);

  const loadRuns = useCallback(async () => {
    try {
      const b = await getJson<{ runs: RunListItem[] }>("/api/district/runs");
      setRuns(b.runs);
      setRunId((cur) => cur ?? b.runs.find((r) => r.status === "running" || r.status === "paused")?.id ?? null);
    } catch (e) {
      if ((e as { setup?: boolean }).setup) setSetup((e as Error).message);
      setRuns([]);
    }
  }, []);

  useEffect(() => {
    loadRuns();
  }, [loadRuns]);

  useEffect(() => {
    if (!runId) return setSnap(null);
    window.history.replaceState(null, "", `?court=district&run=${runId}`);
    getJson<RunSnapshot>(`/api/district/runs/${runId}`).then(setSnap).catch((e) => toast({ title: "Could not open that run", description: e.message, tone: "error" }));
  }, [runId, toast]);

  if (setup) return <SetupNotice message={setup} />;

  return (
    <>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-6">
          {runId && snap ? (
            <RunPanel key={runId} snap={snap} setSnap={setSnap} onChanged={loadRuns} />
          ) : runId ? (
            <Skeleton className="h-[420px]" />
          ) : (
            <Card className="p-0">
              <Empty
                icon={<KeyRound className="h-6 w-6" />}
                title="No run open"
                body="Connect the extension, then start a run on the right. It reads the newest cases of every case type at Saket, going back a year at a time until it has enough."
              />
            </Card>
          )}
        </div>
        <div className="space-y-6">
          <NewRun
            onCreated={(id) => {
              setRunId(id);
              loadRuns();
            }}
          />
          <RunList runs={runs} active={runId} onPick={setRunId} />
        </div>
      </div>
    </>
  );
}

// ── one run ───────────────────────────────────────────────────────────────


/**
 * A run's progress. The work itself happens in the extension on the court's
 * page; this polls the run every few seconds while it is open.
 */
function RunPanel({ snap, setSnap, onChanged }: { snap: RunSnapshot; setSnap: (s: RunSnapshot) => void; onChanged: () => void }) {
  const { toast } = useToast();
  const id = snap.run.id;
  const open = snap.run.status === "running" || snap.run.status === "paused";
  const lastStatus = useRef(snap.run.status);

  useEffect(() => {
    if (!open) return;
    let stop = false;
    const tick = async () => {
      if (stop) return;
      if (!document.hidden) {
        const next = await getJson<RunSnapshot>(`/api/district/runs/${id}`).catch(() => null);
        if (next && !stop) {
          if (next.run.status === "done" && lastStatus.current !== "done") {
            toast({ title: "Run finished", description: `${next.totals.fetched} cases read.`, tone: "success" });
            onChanged();
          }
          lastStatus.current = next.run.status;
          setSnap(next);
        }
      }
      setTimeout(tick, 4000);
    };
    const t = setTimeout(tick, 4000);
    return () => {
      stop = true;
      clearTimeout(t);
    };
  }, [id, open, setSnap, toast, onChanged]);

  const control = async (status: "running" | "paused" | "cancelled") => {
    try {
      setSnap(await getJson<RunSnapshot>(`/api/district/runs/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status }) }));
      onChanged();
    } catch (e) {
      toast({ title: "Could not change the run", description: e instanceof Error ? e.message : "", tone: "error" });
    }
  };

  const s = snap.run.stats;
  const t = snap.totals;
  const pct = t.wanted ? (t.fetched / t.wanted) * 100 : 0;
  const answered = (s.captchasSolved ?? 0) + (s.captchasWrong ?? 0);
  const avgSolve = answered ? (s.solveMsTotal ?? 0) / answered / 1000 : null;
  const tasksOpen = snap.tasks.filter((x) => x.status === "pending").length;
  const running = snap.run.status === "running";

  return (
    <>
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <RunStatusBadge status={snap.run.status} />
              <span className="text-[12px] text-faint">
                {snap.run.caseStatus === "P" ? "Pending" : "Disposed"} cases · {snap.run.perType} per type · from {snap.run.startYear}, up to {snap.run.maxYears} years back
              </span>
            </div>
            <div className="mt-2 text-[22px] font-semibold tracking-[-0.02em] text-foreground">
              {nf.format(t.fetched)} <span className="text-[15px] font-normal text-faint">of {nf.format(t.wanted)} cases read</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {running ? (
              <Button size="sm" variant="secondary" onClick={() => control("paused")} icon={<Pause className="h-3.5 w-3.5" />}>
                Pause
              </Button>
            ) : snap.run.status === "paused" ? (
              <Button size="sm" variant="primary" onClick={() => control("running")} icon={<Play className="h-3.5 w-3.5" />}>
                Resume
              </Button>
            ) : null}
            {open && (
              <Button
                size="sm"
                variant="danger"
                onClick={() => confirm("Stop this run for good? Cases already read stay.") && control("cancelled")}
                icon={<Square className="h-3 w-3" />}
              >
                Stop
              </Button>
            )}
          </div>
        </div>
        <Progress value={pct} className="mt-4" />
        <div className="mt-4 grid grid-cols-2 gap-3 text-[12px] sm:grid-cols-4">
          <Metric label="Case types left to search" value={`${tasksOpen} / ${snap.tasks.length}`} />
          <Metric label="Listed, awaiting their page" value={nf.format(Math.max(0, t.listed - t.fetched - t.failed))} />
          <Metric label="Captchas typed" value={`${s.captchasSolved ?? 0}${s.captchasWrong ? ` · ${s.captchasWrong} retyped` : ""}`} />
          <Metric label="Pace" value={avgSolve ? `${avgSolve.toFixed(1)} s per captcha` : "—"} />
        </div>
        {snap.run.lastError && running && <p className="mt-3 text-[12px] text-warn">Last hiccup: {snap.run.lastError}</p>}
      </Card>

      {running && (
        <Card className={cn("flex flex-wrap items-center gap-3 p-4 text-[13px]", snap.capturers.length ? "border-accent/35" : "")}>
          {snap.capturers.length ? (
            <div className="w-full space-y-2">
              <div className="flex items-center gap-2">
                <span className="cc-pulse h-2 w-2 rounded-full bg-accent" />
                <span className="text-foreground">
                  {snap.capturers.length === 1 ? "1 person is" : `${snap.capturers.length} people are`} working on this run
                </span>
                <span className="text-dim">— each on their own case types, so nobody types a captcha twice.</span>
              </div>
              <ul className="flex flex-wrap gap-2">
                {snap.capturers.map((c) => (
                  <li key={c.name} className="cc-inset px-2.5 py-1.5 text-[12px]">
                    <span className="font-medium text-foreground">{c.name}</span>
                    <span className="text-dim"> · {c.caseTypes.join(", ")}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <>
              <Plug className="h-4 w-4 text-faint" />
              <span className="text-dim">Waiting for the extension. Open the court&apos;s search page and press Start on the SCL panel.</span>
              <a href={COURT_PAGE} target="_blank" rel="noreferrer" className="ml-auto">
                <Button size="sm" variant="primary" icon={<ExternalLink className="h-3.5 w-3.5" />}>
                  Open the court&apos;s page
                </Button>
              </a>
            </>
          )}
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <TaskGrid snap={snap} />
        <div className="space-y-6">
        <People people={s.people} />
        <Card className="p-4">
          <div className="cc-label mb-2">Activity</div>
          {snap.activity.length ? (
            <ul className="space-y-1.5 text-[12px] leading-snug text-dim">
              {snap.activity.map((a, i) => (
                <li key={i} className={cn(i === 0 && "text-foreground")}>
                  {a}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[12px] text-faint">Nothing yet.</p>
          )}
        </Card>
        </div>
      </div>
    </>
  );
}

// ── case types ────────────────────────────────────────────────────────────

function TaskGrid({ snap }: { snap: RunSnapshot }) {
  const [filter, setFilter] = useState<"all" | "open" | "done" | "short">("all");
  const tasks = snap.tasks.filter((t) =>
    filter === "all" ? true : filter === "open" ? t.status === "pending" : filter === "done" ? t.status === "done" : t.status === "exhausted"
  );
  return (
    <Card className="p-0">
      <div className="flex flex-wrap items-center gap-2 border-b border-hairline px-4 py-2.5">
        <span className="text-[13px] font-semibold text-foreground">Case types</span>
        <span className="text-[12px] text-faint">{snap.tasks.length}</span>
        <div className="ml-auto flex gap-1">
          {(["all", "open", "done", "short"] as const).map((k) => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              className={cn(
                "rounded-[6px] px-2 py-1 text-[11.5px] transition-colors",
                filter === k ? "bg-tint3 text-foreground" : "text-dim hover:bg-tint2"
              )}
            >
              {k === "all" ? "All" : k === "open" ? "Searching" : k === "done" ? "Complete" : "Ran short"}
            </button>
          ))}
        </div>
      </div>
      <ul className="grid gap-px bg-hairline sm:grid-cols-2 2xl:grid-cols-3">
        {tasks.map((t) => (
          <li key={t.id} className="flex items-center gap-3 bg-panel px-4 py-2.5">
            {t.status === "done" ? (
              <CheckCircle2 className="h-4 w-4 shrink-0 text-ok" />
            ) : t.status === "exhausted" ? (
              <XCircle className="h-4 w-4 shrink-0 text-warn" />
            ) : (
              <CircleDashed className="h-4 w-4 shrink-0 text-faint" />
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12.5px] font-medium text-foreground">{t.name}</div>
              <div className="truncate text-[11px] text-faint">
                {t.claimedBy && <span className="text-accentSoft">{t.claimedBy} · </span>}
                {t.status === "pending"
                  ? `next: ${t.nextYear}${t.yearsTried ? ` · ${t.yearsTried} yr${t.yearsTried === 1 ? "" : "s"} tried` : ""}`
                  : t.note ?? ""}
              </div>
            </div>
            <span className="cc-mono shrink-0 text-dim">
              {t.fetched}/{t.status === "exhausted" ? t.found : t.wanted}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

// ── starting a run ────────────────────────────────────────────────────────

function NewRun({ onCreated }: { onCreated: (id: string) => void }) {
  const { toast } = useToast();
  const year = Number(todayIso().slice(0, 4));
  const [caseStatus, setCaseStatus] = useState<"P" | "D">("P");
  const [perType, setPerType] = useState(10);
  const [maxYears, setMaxYears] = useState(10);
  const [startYear, setStartYear] = useState(year);
  const [types, setTypes] = useState<CaseType[] | null>(null);
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [showTypes, setShowTypes] = useState(false);
  const [busy, setBusy] = useState(false);
  const [typeErr, setTypeErr] = useState<string | null>(null);

  const loadTypes = useCallback(() => {
    setTypeErr(null);
    getJson<{ types: CaseType[] }>("/api/district/case-types")
      .then((b) => {
        setTypes(b.types);
        setPicked(new Set(b.types.map((t) => t.code)));
      })
      .catch((e) => setTypeErr(e.message));
  }, []);

  useEffect(() => {
    if (showTypes && !types) loadTypes();
  }, [showTypes, types, loadTypes]);

  const count = picked?.size ?? null;
  const allPicked = !types || (picked && picked.size === types.length);
  const estimate = useMemo(() => {
    const n = (count ?? 79) * perType;
    return n;
  }, [count, perType]);

  const start = async () => {
    setBusy(true);
    try {
      const body: Record<string, unknown> = { caseStatus, perType, maxYears, startYear };
      if (types && picked && !allPicked) body.caseTypes = [...picked];
      const b = await getJson<{ id: string }>("/api/district/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      onCreated(b.id);
    } catch (e) {
      toast({ title: "Could not start the run", description: e instanceof Error ? e.message : "", tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-4">
      <div className="mb-3 text-[13px] font-semibold text-foreground">New run</div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Cases">
          <Select value={caseStatus} onChange={(e) => setCaseStatus(e.target.value as "P" | "D")}>
            <option value="P">Pending</option>
            <option value="D">Disposed</option>
          </Select>
        </Field>
        <Field label="Per case type">
          <Input type="number" min={1} max={25} value={perType} onChange={(e) => setPerType(Math.min(25, Number(e.target.value) || 1))} />
        </Field>
        <Field label="Start year">
          <Input type="number" min={1990} max={year} value={startYear} onChange={(e) => setStartYear(Number(e.target.value) || year)} />
        </Field>
        <Field label="Years back, at most">
          <Input type="number" min={1} max={30} value={maxYears} onChange={(e) => setMaxYears(Number(e.target.value) || 1)} />
        </Field>
      </div>

      <button onClick={() => setShowTypes((v) => !v)} className="mt-3 text-[12px] text-dim underline-offset-2 hover:text-foreground hover:underline">
        {showTypes ? "Hide case types" : allPicked ? "All case types · choose…" : `${count} case types · change…`}
      </button>
      {showTypes && (
        <div className="mt-2 rounded-[9px] border border-hairline">
          {typeErr ? (
            <div className="p-3 text-[12px] text-dangerSoft">
              {typeErr}{" "}
              <button className="underline" onClick={loadTypes}>
                Retry
              </button>
            </div>
          ) : !types || !picked ? (
            <div className="flex items-center gap-2 p-3 text-[12px] text-dim">
              <Spinner /> Loading case types…
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3 border-b border-hairline px-3 py-1.5 text-[11.5px]">
                <button className="text-dim hover:text-foreground" onClick={() => setPicked(new Set(types.map((t) => t.code)))}>
                  All
                </button>
                <button className="text-dim hover:text-foreground" onClick={() => setPicked(new Set())}>
                  None
                </button>
                <span className="ml-auto text-faint">{picked.size} chosen</span>
              </div>
              <ul className="max-h-[260px] overflow-y-auto p-1.5">
                {types.map((t) => (
                  <li key={t.code}>
                    <label className="flex cursor-pointer items-center gap-2 rounded-[6px] px-2 py-1 text-[12.5px] text-dim hover:bg-tint2">
                      <input
                        type="checkbox"
                        checked={picked.has(t.code)}
                        onChange={(e) => {
                          const n = new Set(picked);
                          if (e.target.checked) n.add(t.code);
                          else n.delete(t.code);
                          setPicked(n);
                        }}
                        className="accent-[rgb(var(--accent))]"
                      />
                      {t.name}
                    </label>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      <p className="mt-3 text-[11.5px] leading-relaxed text-faint">
        Up to {nf.format(estimate)} cases. Expect a captcha for every year searched, and for some case pages when the court asks, a
        few seconds each. Then open the court&apos;s search page and press Start on the panel there.
      </p>
      <Button variant="primary" className="mt-3 w-full" onClick={start} loading={busy} disabled={picked?.size === 0} icon={<Play className="h-3.5 w-3.5" />}>
        Start run
      </Button>
    </Card>
  );
}

function RunList({ runs, active, onPick }: { runs: RunListItem[] | null; active: string | null; onPick: (id: string) => void }) {
  if (runs === null) return <Skeleton className="h-40" />;
  if (!runs.length) return null;
  return (
    <Card className="p-0">
      <div className="border-b border-hairline px-4 py-2.5 text-[13px] font-semibold text-foreground">Runs</div>
      <ul>
        {runs.map((r) => (
          <li key={r.id}>
            <button
              onClick={() => onPick(r.id)}
              className={cn(
                "flex w-full items-center gap-3 border-b border-hairline px-4 py-2.5 text-left transition-colors last:border-b-0 hover:bg-tint",
                r.id === active && "bg-tint2"
              )}
            >
              <RunStatusBadge status={r.status} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] text-foreground">
                  {r.case_status === "P" ? "Pending" : "Disposed"} · {r.per_type}/type · from {r.start_year}
                </span>
                <span className="block text-[11px] text-faint">
                  {fmtDate(r.created_at.slice(0, 10))}
                  {r.created_by_name ? ` · ${r.created_by_name}` : ""} · {r.stats?.details ?? 0} read
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <div className="px-4 py-2.5 text-[11.5px] text-faint">
        Cases from every run land in <Link href="/district" className="text-dim underline-offset-2 hover:underline">Court Cases</Link>.
      </div>
    </Card>
  );
}
