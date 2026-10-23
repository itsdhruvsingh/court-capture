-- ═══════════════════════════════════════════════════════════════════════════
--  Court Capture, migration 053: High Court of Delhi
--
--  Requires 0050–0052 (the district court schema). Run once in Supabase →
--  SQL Editor. Safe to re-run.
--
--  The "Sitting Judges wise" judgment search: for every sitting judge, up to N
--  judgments and orders from random one-month windows. Each judgment keeps its
--  case type (from the court's own code), neutral citation, parties, PDF and
--  the court's plain-text copy, and — on request — an AI summary.
--
--  Like the district schema, a run is a row plus a queue of tasks (here, one
--  per judge) that several people's extensions claim and work through, each
--  typing the captcha the court shows them.
-- ═══════════════════════════════════════════════════════════════════════════


-- ── reference lists ───────────────────────────────────────────────────────

create table if not exists public.hc_judges (
  id          uuid primary key default gen_random_uuid(),
  court       text not null default 'delhihc',
  code        text not null,            -- the court's option value, e.g. '100'
  name        text not null,            -- 'JUSTICE PRATHIBA M. SINGH'
  sitting     boolean not null default true,
  seen_at     timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  unique (court, code)
);

create table if not exists public.hc_case_types (
  court  text not null default 'delhihc',
  code   text not null,                 -- 'CW'
  name   text not null,                 -- 'W.P.(C)'
  primary key (court, code)
);


-- ── runs and the queue ────────────────────────────────────────────────────

create table if not exists public.hc_runs (
  id              uuid primary key default gen_random_uuid(),
  court           text not null default 'delhihc',
  label           text,
  per_judge       int  not null default 20 check (per_judge between 1 and 100),
  max_tries       int  not null default 6  check (max_tries between 1 and 30),
  window_days     int  not null default 30 check (window_days between 1 and 366),
  earliest        date not null default '2018-01-01',
  status          text not null default 'running' check (status in ('running', 'paused', 'done', 'cancelled')),
  stats           jsonb not null default '{}'::jsonb,
  activity        jsonb not null default '[]'::jsonb,
  last_error      text,
  lease_until     timestamptz,
  created_by      uuid,
  created_by_name text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  finished_at     timestamptz
);

create index if not exists hc_runs_created_idx on public.hc_runs (created_at desc);

create table if not exists public.hc_tasks (
  id             uuid primary key default gen_random_uuid(),
  run_id         uuid not null references public.hc_runs (id) on delete cascade,
  seq            int  not null,
  judge_id       uuid references public.hc_judges (id) on delete set null,
  judge_code     text not null,
  judge_name     text not null,
  status         text not null default 'pending' check (status in ('pending', 'done', 'exhausted', 'skipped')),
  wanted         int  not null,
  found          int  not null default 0,
  tries          int  not null default 0,
  -- The window the next search uses, chosen when it is handed out; cleared
  -- once that search is reported, so a retry after a reload reuses it.
  win_from       date,
  win_to         date,
  windows        jsonb not null default '[]'::jsonb,   -- [{from, to, listed, took}]
  note           text,
  claimed_by     text,
  claimed_name   text,
  claimed_until  timestamptz,
  updated_at     timestamptz not null default now(),
  unique (run_id, judge_code)
);

create index if not exists hc_tasks_run_idx   on public.hc_tasks (run_id, seq);
create index if not exists hc_tasks_claim_idx on public.hc_tasks (run_id, claimed_by);


-- ── judgments ─────────────────────────────────────────────────────────────

create table if not exists public.hc_judgments (
  id                  uuid primary key default gen_random_uuid(),
  court               text not null default 'delhihc',
  dedupe_key          text not null unique,      -- the PDF link, else number|date
  case_no             text not null,             -- as printed: 'W.P.(C)-8028/2025'
  case_type           text,                      -- 'W.P.(C)'
  case_type_code      text,                      -- 'CW'
  case_number         int,
  case_year           int,
  neutral_citation    text,                      -- '2025:DHC:4853-DB'
  order_date          date,
  petitioner          text,
  respondent          text,
  corrigendum         text,
  uploaded_on         text,
  remark              text,
  pdf_url             text,
  txt_url             text,

  -- The court's copies, fetched in the background after capture.
  pdf_path            text,
  pdf_bytes           int,
  pdf_fetched_at      timestamptz,
  pdf_error           text,
  body_text           text,
  text_fetched_at     timestamptz,
  text_error          text,

  -- DERIVED. Written once on request, then served from here.
  summary             jsonb,
  summary_model       text,
  summary_source      text,
  summary_at          timestamptz,
  summary_by          text,
  summary_status      text check (summary_status in ('generating', 'failed')),
  summary_started_at  timestamptz,
  summary_error       text,

  row_html            text,                      -- RAW: the results row as the court sent it
  first_run_id        uuid references public.hc_runs (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists hc_judgments_date_idx on public.hc_judgments (order_date desc);
create index if not exists hc_judgments_type_idx on public.hc_judgments (case_type_code, case_year desc);

-- A judgment can be listed under several judges (a bench).
create table if not exists public.hc_judgment_judges (
  judgment_id  uuid not null references public.hc_judgments (id) on delete cascade,
  judge_id     uuid not null references public.hc_judges (id) on delete cascade,
  run_id       uuid references public.hc_runs (id) on delete set null,
  linked_at    timestamptz not null default now(),
  primary key (judgment_id, judge_id)
);

create index if not exists hc_judgment_judges_judge_idx on public.hc_judgment_judges (judge_id);

-- Every search as the court answered it: the listing and the HTML.
create table if not exists public.hc_search_results (
  id            uuid primary key default gen_random_uuid(),
  run_id        uuid references public.hc_runs (id) on delete set null,
  task_id       uuid references public.hc_tasks (id) on delete set null,
  judge_code    text not null,
  judge_name    text,
  from_date     date not null,
  to_date       date not null,
  outcome       text not null check (outcome in ('results', 'empty')),
  listed_total  int,
  rows          jsonb not null default '[]'::jsonb,
  html          text,
  captured_at   timestamptz not null default now()
);

create index if not exists hc_search_results_judge_idx on public.hc_search_results (judge_code, captured_at desc);


-- ── what AI summaries cost (both courts) ──────────────────────────────────

create table if not exists public.ai_usage (
  id                 uuid primary key default gen_random_uuid(),
  at                 timestamptz not null default now(),
  court              text not null check (court in ('district', 'highcourt')),
  kind               text not null default 'summary',
  ref_id             uuid,
  model              text not null,
  prompt_tokens      int  not null default 0,
  completion_tokens  int  not null default 0,
  cost_micros        bigint not null default 0
);

create index if not exists ai_usage_at_idx on public.ai_usage (at desc);


-- ── views ─────────────────────────────────────────────────────────────────

create or replace view public.hc_judge_stats_v as
  select j.id,
         j.code,
         j.name,
         j.sitting,
         count(l.judgment_id)                                        as judgments,
         max(g.order_date)                                           as latest_order,
         min(g.order_date)                                           as earliest_order,
         array_agg(distinct g.case_type) filter (where g.case_type is not null) as case_types
    from public.hc_judges j
    left join public.hc_judgment_judges l on l.judge_id = j.id
    left join public.hc_judgments g on g.id = l.judgment_id
   group by j.id;

create or replace view public.hc_stats_v as
  select (select count(*) from public.hc_judgments)                                   as judgments,
         (select count(distinct judge_id) from public.hc_judgment_judges)             as judges,
         (select count(distinct case_type_code) from public.hc_judgments)             as case_types,
         (select count(*) from public.hc_judgments where summary is not null)         as summaries,
         (select count(*) from public.hc_judgments where body_text is not null)       as texts,
         (select count(*) from public.hc_judgments where pdf_path is not null)        as pdfs;


-- ── functions ─────────────────────────────────────────────────────────────

-- Claim the next judge that still needs searching and that nobody else holds;
-- a person's own claim is preferred so they keep the judge they started.
create or replace function public.hc_claim_task(p_run uuid, p_capturer text, p_name text, p_seconds int)
returns uuid language plpgsql as $$
declare
  tid uuid;
begin
  select t.id into tid
    from public.hc_tasks t
   where t.run_id = p_run
     and t.status = 'pending'
     and (t.claimed_by is null or t.claimed_until < now() or t.claimed_by = p_capturer)
   order by (t.claimed_by = p_capturer) desc nulls last, t.seq
   limit 1
   for update skip locked;
  if tid is null then
    return null;
  end if;
  update public.hc_tasks
     set claimed_by = p_capturer, claimed_name = p_name, claimed_until = now() + make_interval(secs => p_seconds)
   where id = tid;
  return tid;
end $$;

-- Atomic counters, per-person counts and activity, as court_touch_run.
create or replace function public.hc_touch_run(
  p_run uuid, p_delta jsonb, p_person text, p_person_delta jsonb, p_notes jsonb, p_error text, p_set_error boolean
) returns void language plpgsql as $$
declare
  s   jsonb;
  ppl jsonb;
  me  jsonb;
  k   text;
  v   numeric;
begin
  select coalesce(stats, '{}'::jsonb) into s from public.hc_runs where id = p_run for update;
  if not found then
    return;
  end if;
  for k, v in select key, value::numeric from jsonb_each_text(coalesce(p_delta, '{}'::jsonb)) loop
    s := jsonb_set(s, array[k], to_jsonb(coalesce((s ->> k)::numeric, 0) + v));
  end loop;
  if p_person is not null and p_person <> '' then
    ppl := coalesce(s -> 'people', '{}'::jsonb);
    me  := coalesce(ppl -> p_person, '{}'::jsonb);
    for k, v in select key, value::numeric from jsonb_each_text(coalesce(p_person_delta, '{}'::jsonb)) loop
      me := jsonb_set(me, array[k], to_jsonb(coalesce((me ->> k)::numeric, 0) + v));
    end loop;
    s := jsonb_set(s, '{people}', jsonb_set(ppl, array[p_person], me));
  end if;
  update public.hc_runs
     set stats = s,
         activity = case
           when jsonb_array_length(coalesce(p_notes, '[]'::jsonb)) = 0 then activity
           else (select coalesce(jsonb_agg(e order by n), '[]'::jsonb)
                   from (select e, n
                           from jsonb_array_elements(coalesce(activity, '[]'::jsonb) || p_notes) with ordinality as t(e, n)
                          order by n desc
                          limit 60) z)
         end,
         last_error = case when p_set_error then p_error else last_error end,
         lease_until = now() + interval '90 seconds',
         updated_at = now()
   where id = p_run;
end $$;

-- Save the rows of one search for one judge, in the order given (the app
-- shuffles them), until `need` new judgments are linked to that judge.
-- Upserts each judgment by its dedupe key and returns how many it linked.
create or replace function public.hc_ingest_rows(p jsonb)
returns int language plpgsql as $$
declare
  r      jsonb;
  jid    uuid;
  linked int := 0;
  n      int;
  need   int := coalesce((p ->> 'need')::int, 0);
  judge  uuid := (p ->> 'judge_id')::uuid;
  run    uuid := (p ->> 'run_id')::uuid;
begin
  for r in select * from jsonb_array_elements(coalesce(p -> 'rows', '[]'::jsonb)) loop
    exit when linked >= need;
    insert into public.hc_judgments as g (
      dedupe_key, case_no, case_type, case_type_code, case_number, case_year, neutral_citation,
      order_date, petitioner, respondent, corrigendum, uploaded_on, remark, pdf_url, txt_url,
      row_html, first_run_id
    ) values (
      r ->> 'dedupeKey', r ->> 'caseNo', r ->> 'caseTypeLabel', r ->> 'caseTypeCode',
      (r ->> 'caseNumber')::int, (r ->> 'caseYear')::int, r ->> 'neutralCitation',
      (r ->> 'orderDate')::date, r ->> 'petitioner', r ->> 'respondent', r ->> 'corrigendum',
      r ->> 'uploadedOn', r ->> 'remark', r ->> 'pdfUrl', r ->> 'txtUrl', r ->> 'html', run
    )
    on conflict (dedupe_key) do update set
      neutral_citation = coalesce(excluded.neutral_citation, g.neutral_citation),
      corrigendum      = coalesce(excluded.corrigendum, g.corrigendum),
      uploaded_on      = coalesce(excluded.uploaded_on, g.uploaded_on),
      remark           = coalesce(excluded.remark, g.remark),
      case_type        = coalesce(g.case_type, excluded.case_type),
      case_type_code   = coalesce(g.case_type_code, excluded.case_type_code),
      updated_at       = now()
    returning id into jid;

    if judge is not null then
      insert into public.hc_judgment_judges (judgment_id, judge_id, run_id)
      values (jid, judge, run)
      on conflict do nothing;
      get diagnostics n = row_count;
      linked := linked + n;
    end if;
  end loop;
  return linked;
end $$;

create or replace function public.hc_claim_summary(p_id uuid)
returns boolean language sql as $$
  with u as (
    update public.hc_judgments
       set summary_status = 'generating', summary_started_at = now(), summary_error = null
     where id = p_id
       and summary is null
       and (summary_status is null or summary_status = 'failed' or summary_started_at < now() - interval '5 minutes')
    returning 1
  )
  select exists (select 1 from u);
$$;


-- ── access ────────────────────────────────────────────────────────────────

do $$
declare
  t text;
begin
  foreach t in array array[
    'hc_judges', 'hc_case_types', 'hc_runs', 'hc_tasks', 'hc_judgments',
    'hc_judgment_judges', 'hc_search_results', 'ai_usage'
  ] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

revoke all on public.hc_judge_stats_v from anon, authenticated;
revoke all on public.hc_stats_v       from anon, authenticated;

revoke all on function public.hc_claim_task(uuid, text, text, int)                        from public, anon, authenticated;
revoke all on function public.hc_touch_run(uuid, jsonb, text, jsonb, jsonb, text, boolean) from public, anon, authenticated;
revoke all on function public.hc_ingest_rows(jsonb)                                       from public, anon, authenticated;
revoke all on function public.hc_claim_summary(uuid)                                      from public, anon, authenticated;
grant execute on function public.hc_claim_task(uuid, text, text, int)                        to service_role;
grant execute on function public.hc_touch_run(uuid, jsonb, text, jsonb, jsonb, text, boolean) to service_role;
grant execute on function public.hc_ingest_rows(jsonb)                                       to service_role;
grant execute on function public.hc_claim_summary(uuid)                                      to service_role;

notify pgrst, 'reload schema';
