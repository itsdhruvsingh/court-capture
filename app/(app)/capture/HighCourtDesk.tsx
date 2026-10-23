"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CheckCircle2, CircleDashed, ExternalLink, Pause, Play, Plug, ScrollText, Square, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button, Card, Empty, Field, Input, Progress, Skeleton, Spinner } from "@/components/ui";
import { useToast } from "@/components/Toaster";
import { SetupNotice, fmtDate, getJson, todayIso } from "../district/ui";
import { HIGH_COURT_PAGE, Metric, People, RunStatusBadge, nf } from "./shared";
import type { HcRunSnapshot } from "@/lib/highcourt/types";
import { yearsBefore } from "@/lib/highcourt/window";

type RunListItem = {
  id: string;
  label: string | null;
  status: string;
  per_judge: number;
  max_tries: number;
  window_days: number;
  earliest: string;
  stats: HcRunSnapshot["run"]["stats"];
  created_at: string;
  created_by_name: string | null;
};

export function HighCourtDesk({ initialRun }: { initialRun: string | null }) {
  const { toast } = useToast();
  const [runs, setRuns] = useState<RunListItem[] | null>(null);
  const [runId, setRunId] = useState<string | null>(initialRun);
  const [snap, setSnap] = useState<HcRunSnapshot | null>(null);
  const [setup, setSetup] = useState<string | null>(null);

  const loadRuns = useCallback(async () => {
    try {
      const b = await getJson<{ runs: RunListItem[] }>("/api/high-court/runs");
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
    window.history.replaceState(null, "", `?court=highcourt&run=${runId}`);
    getJson<HcRunSnapshot>(`/api/high-court/runs/${runId}`)
      .then(setSnap)
      .catch((e) => toast({ title: "Could not open that run", description: e.message, tone: "error" }));
  }, [runId, toast]);

  if (setup) return <SetupNotice message={setup} />;

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-6">
        {runId && snap ? (
          <RunPanel key={runId} snap={snap} setSnap={setSnap} onChanged={loadRuns} />
        ) : runId ? (
          <Skeleton className="h-[420px]" />
        ) : (
          <Card className="p-0">
            <Empty
              icon={<ScrollText className="h-6 w-6" />}
              title="No High Court run open"
              body="Start one on the right. For every sitting judge, one search lists everything since the date you choose, and a random sample is kept."
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
  );
}

function RunPanel({ snap, setSnap, onChanged }: { snap: HcRunSnapshot; setSnap: (s: HcRunSnapshot) => void; onChanged: () => void }) {
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
        const next = await getJson<HcRunSnapshot>(`/api/high-court/runs/${id}`).catch(() => null);
        if (next && !stop) {
          if (next.run.status === "done" && lastStatus.current !== "done") {
            toast({ title: "High Court run finished", description: `${next.totals.found} judgments saved.`, tone: "success" });
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
      setSnap(await getJson<HcRunSnapshot>(`/api/high-court/runs/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status }) }));
      onChanged();
    } catch (e) {
      toast({ title: "Could not change the run", description: e instanceof Error ? e.message : "", tone: "error" });
    }
  };

  const s = snap.run.stats;
  const t = snap.totals;
  const answered = (s.captchasSolved ?? 0) + (s.captchasWrong ?? 0);
  const avgSolve = answered ? (s.solveMsTotal ?? 0) / answered / 1000 : null;
  const running = snap.run.status === "running";

  return (
    <>
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <RunStatusBadge status={snap.run.status} />
              <span className="text-[12px] text-faint">
                Up to {snap.run.perJudge} per judge, at random from everything since {fmtDate(snap.run.earliest)}
              </span>
            </div>
            <div className="mt-2 text-[22px] font-semibold tracking-[-0.02em] text-foreground">
              {nf.format(t.found)} <span className="text-[15px] font-normal text-faint">of {nf.format(t.wanted)} judgments saved</span>
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
              <Button size="sm" variant="danger" onClick={() => confirm("Stop this run for good? Judgments already saved stay.") && control("cancelled")} icon={<Square className="h-3 w-3" />}>
                Stop
              </Button>
            )}
          </div>
        </div>
        <Progress value={t.wanted ? (t.found / t.wanted) * 100 : 0} className="mt-4" />
        <div className="mt-4 grid grid-cols-2 gap-3 text-[12px] sm:grid-cols-4">
          <Metric label="Judges left" value={`${t.judges - t.judgesDone} / ${t.judges}`} />
          <Metric label="Searches" value={`${s.searches ?? 0}${s.emptyWindows ? ` · ${s.emptyWindows} empty` : ""}`} />
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
                <span className="text-foreground">{snap.capturers.length === 1 ? "1 person is" : `${snap.capturers.length} people are`} working on this run</span>
              </div>
              <ul className="flex flex-wrap gap-2">
                {snap.capturers.map((c) => (
                  <li key={c.name} className="cc-inset px-2.5 py-1.5 text-[12px]">
                    <span className="font-medium text-foreground">{c.name}</span>
                    <span className="text-dim"> · {c.judges.map(shortJudge).join(", ")}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <>
              <Plug className="h-4 w-4 text-faint" />
              <span className="text-dim">Waiting for the extension: click its icon and choose High Court.</span>
              <a href={HIGH_COURT_PAGE} target="_blank" rel="noreferrer" className="ml-auto">
                <Button size="sm" variant="primary" icon={<ExternalLink className="h-3.5 w-3.5" />}>
                  Open the High Court page
                </Button>
              </a>
            </>
          )}
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <JudgeGrid snap={snap} />
        <div className="space-y-6">
          <People people={s.people} unit="Judgments" />
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

/** Today's date `years` years ago (IST), as the date input wants it. */
function yearsAgoIso(years: number) {
  return yearsBefore(todayIso(), years);
}

/** "JUSTICE PRATHIBA M. SINGH" → "Prathiba M. Singh". */
function shortJudge(name: string) {
  return name
    .replace(/^(acting chief justice|chief justice|dr\.\s*justice|justice)\s+/i, "")
    .toLowerCase()
    .replace(/(^|[\s.(-])([a-z])/g, (_, p, c) => p + c.toUpperCase());
}

function JudgeGrid({ snap }: { snap: HcRunSnapshot }) {
  const [filter, setFilter] = useState<"all" | "open" | "done" | "short">("all");
  const tasks = snap.tasks.filter((t) => (filter === "all" ? true : filter === "open" ? t.status === "pending" : filter === "done" ? t.status === "done" : t.status === "exhausted"));
  return (
    <Card className="p-0">
      <div className="flex flex-wrap items-center gap-2 border-b border-hairline px-4 py-2.5">
        <span className="text-[13px] font-semibold text-foreground">Judges</span>
        <span className="text-[12px] text-faint">{snap.tasks.length}</span>
        <div className="ml-auto flex gap-1">
          {(["all", "open", "done", "short"] as const).map((k) => (
            <button key={k} onClick={() => setFilter(k)} className={cn("rounded-[6px] px-2 py-1 text-[11.5px] transition-colors", filter === k ? "bg-tint3 text-foreground" : "text-dim hover:bg-tint2")}>
              {k === "all" ? "All" : k === "open" ? "Searching" : k === "done" ? "Complete" : "Ran short"}
            </button>
          ))}
        </div>
      </div>
      <ul className="grid gap-px bg-hairline sm:grid-cols-2">
        {tasks.map((t) => (
          <li key={t.id} className="flex items-center gap-3 bg-panel px-4 py-2.5">
            {t.status === "done" ? (
              <CheckCircle2 className="h-4 w-4 shrink-0 text-ok" />
            ) : t.status === "exhausted" || t.status === "skipped" ? (
              <XCircle className="h-4 w-4 shrink-0 text-warn" />
            ) : (
              <CircleDashed className="h-4 w-4 shrink-0 text-faint" />
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12.5px] font-medium text-foreground">{shortJudge(t.judgeName)}</div>
              <div className="truncate text-[11px] text-faint">
                {t.claimedBy && <span className="text-accentSoft">{t.claimedBy} · </span>}
                {t.status === "pending" ? (t.tries ? `${t.tries} search${t.tries === 1 ? "" : "es"} so far` : "Not searched yet") : t.note ?? ""}
              </div>
            </div>
            <span className="cc-mono shrink-0 text-dim">
              {t.found}/{t.wanted}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function NewRun({ onCreated }: { onCreated: (id: string) => void }) {
  const { toast } = useToast();
  const [perJudge, setPerJudge] = useState(20);
  const [earliest, setEarliest] = useState(() => yearsAgoIso(10));
  const [busy, setBusy] = useState(false);
  const [judges, setJudges] = useState<{ code: string; name: string; sitting: boolean }[] | null>(null);
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [showJudges, setShowJudges] = useState(false);

  useEffect(() => {
    if (!showJudges || judges) return;
    getJson<{ judges: { code: string; name: string; sitting: boolean }[] }>("/api/high-court/runs?judges=1")
      .then((b) => {
        const sitting = b.judges.filter((j) => j.sitting);
        setJudges(sitting);
        setPicked(new Set(sitting.map((j) => j.code)));
      })
      .catch((e) => toast({ title: "Could not load judges", description: e.message, tone: "error" }));
  }, [showJudges, judges, toast]);

  const allPicked = !judges || (picked && picked.size === judges.length);

  const start = async () => {
    setBusy(true);
    try {
      const body: Record<string, unknown> = { perJudge, earliest };
      if (judges && picked && !allPicked) body.judgeCodes = [...picked];
      const b = await getJson<{ id: string }>("/api/high-court/runs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      onCreated(b.id);
    } catch (e) {
      toast({ title: "Could not start the run", description: e instanceof Error ? e.message : "", tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-4">
      <div className="mb-3 text-[13px] font-semibold text-foreground">New High Court run</div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Judgments per judge">
          <Input type="number" min={1} max={100} value={perJudge} onChange={(e) => setPerJudge(Math.min(100, Number(e.target.value) || 1))} />
        </Field>
        <Field label="Search back to">
          <Input type="date" min="1990-01-01" max={todayIso()} value={earliest} onChange={(e) => setEarliest(e.target.value || yearsAgoIso(10))} />
        </Field>
      </div>
      <button onClick={() => setShowJudges((v) => !v)} className="mt-3 text-[12px] text-dim underline-offset-2 hover:text-foreground hover:underline">
        {showJudges ? "Hide judges" : allPicked ? "All sitting judges · choose…" : `${picked?.size} judges · change…`}
      </button>
      {showJudges && (
        <div className="mt-2 rounded-[9px] border border-hairline">
          {!judges || !picked ? (
            <div className="flex items-center gap-2 p-3 text-[12px] text-dim">
              <Spinner /> Loading judges…
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3 border-b border-hairline px-3 py-1.5 text-[11.5px]">
                <button className="text-dim hover:text-foreground" onClick={() => setPicked(new Set(judges.map((j) => j.code)))}>
                  All
                </button>
                <button className="text-dim hover:text-foreground" onClick={() => setPicked(new Set())}>
                  None
                </button>
                <span className="ml-auto text-faint">{picked.size} chosen</span>
              </div>
              <ul className="max-h-[260px] overflow-y-auto p-1.5">
                {judges.map((j) => (
                  <li key={j.code}>
                    <label className="flex cursor-pointer items-center gap-2 rounded-[6px] px-2 py-1 text-[12.5px] text-dim hover:bg-tint2">
                      <input
                        type="checkbox"
                        checked={picked.has(j.code)}
                        onChange={(e) => {
                          const n = new Set(picked);
                          if (e.target.checked) n.add(j.code);
                          else n.delete(j.code);
                          setPicked(n);
                        }}
                      />
                      {shortJudge(j.name)}
                    </label>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
      <p className="mt-3 text-[11.5px] leading-relaxed text-faint">
        One captcha per judge: the search lists everything the judge uploaded since that date, and {perJudge} are picked from it at random. The
        whole list is kept too.
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
      <div className="border-b border-hairline px-4 py-2.5 text-[13px] font-semibold text-foreground">High Court runs</div>
      <ul>
        {runs.map((r) => (
          <li key={r.id}>
            <button
              onClick={() => onPick(r.id)}
              className={cn("flex w-full items-center gap-3 border-b border-hairline px-4 py-2.5 text-left transition-colors last:border-b-0 hover:bg-tint", r.id === active && "bg-tint2")}
            >
              <RunStatusBadge status={r.status} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] text-foreground">
                  {r.per_judge}/judge · since {fmtDate(r.earliest)}
                </span>
                <span className="block text-[11px] text-faint">
                  {fmtDate(r.created_at.slice(0, 10))}
                  {r.created_by_name ? ` · ${r.created_by_name}` : ""} · {r.stats?.judgments ?? 0} saved
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <div className="px-4 py-2.5 text-[11.5px] text-faint">
        Judgments from every run land in{" "}
        <Link href="/high-court" className="text-dim underline-offset-2 hover:underline">
          High Court judgments
        </Link>
        .
      </div>
    </Card>
  );
}
