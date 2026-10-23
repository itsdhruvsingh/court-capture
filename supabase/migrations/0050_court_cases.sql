-- ═══════════════════════════════════════════════════════════════════════════
--  SCL, migration 050: Court Cases
--
--  District-court case records read from the eCourts district site
--  (southdelhi.dcourts.gov.in, Saket Court Complex): parties and their
--  advocates, the hearing history, every order, and AI summaries of orders.
--
--  Run once in Supabase → SQL Editor. Safe to re-run.
--
--  ── THE THREE LAYERS ─────────────────────────────────────────────────────
--
--    RAW      court_case_raw.html — the case page exactly as the court sent it.
--    PARSED   court_cases / _hearings / _orders / _advocates — our reading.
--    DERIVED  court_case_orders.summary — what a model said about an order.
--
--  A parser fix re-reads RAW. Re-scraping costs a person typing captchas, so
--  nothing here is ever thrown away to be fetched again.
--
--  ── WHY A RUN IS A TABLE ─────────────────────────────────────────────────
--
--  A run (79 case types × 10 cases, each behind a captcha somebody types) is
--  far longer than an HTTP request. So, like Advanced Intelligence, it is a
--  row plus a queue: each tick from the dashboard claims the run's lease, does
--  ~25 seconds of work, writes what it learned and returns. Close the tab and
--  the run simply waits; open it tomorrow and it carries on.
-- ═══════════════════════════════════════════════════════════════════════════


-- ── runs ──────────────────────────────────────────────────────────────────

create table if not exists public.court_scrape_runs (
  id              uuid primary key default gen_random_uuid(),
  label           text,
  court           text not null default 'southdelhi',
  complex_code    text not null,
  complex_name    text not null,
  case_status     text not null default 'P' check (case_status in ('P', 'D')),
  per_type        int  not null default 10 check (per_type between 1 and 50),
  max_years       int  not null default 10 check (max_years between 1 and 30),
  start_year      int  not null,
  status          text not null default 'running'
                  check (status in ('running', 'paused', 'done', 'cancelled', 'failed')),

  -- The court-site session: cookies, the page nonce, the hidden captcha
  -- tokens. Private to the server; never sent to the browser.
  session         jsonb not null default '{}'::jsonb,

  -- The captcha currently on screen (image inline), or null. Written by the
  -- tick that fetched it; `answer` is added by the person who solved it.
  captcha         jsonb,

  -- Single-writer lease. A tick claims it; a crashed tick frees it by expiry.
  lease_until     timestamptz,

  stats           jsonb not null default '{}'::jsonb,
  activity        jsonb not null default '[]'::jsonb,
  last_error      text,

  created_by      uuid,
  created_by_name text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  finished_at     timestamptz
);

create index if not exists court_scrape_runs_created_idx on public.court_scrape_runs (created_at desc);


-- One per case type in a run. `next_year` walks backwards from start_year
-- until `found` reaches `wanted` or `years_tried` reaches the run's max_years.
create table if not exists public.court_scrape_tasks (
  id              uuid primary key default gen_random_uuid(),
  run_id          uuid not null references public.court_scrape_runs (id) on delete cascade,
  seq             int  not null,
  case_type_code  text not null,
  case_type_name  text not null,
  status          text not null default 'pending'
                  check (status in ('pending', 'done', 'exhausted', 'failed', 'skipped')),
  next_year       int  not null,
  years_tried     int  not null default 0,
  wanted          int  not null,
  found           int  not null default 0,
  note            text,
  log             jsonb not null default '[]'::jsonb,
  updated_at      timestamptz not null default now(),
  unique (run_id, case_type_code)
);

create index if not exists court_scrape_tasks_run_idx on public.court_scrape_tasks (run_id, seq);


-- ── cases ─────────────────────────────────────────────────────────────────

create table if not exists public.court_cases (
  id                  uuid primary key default gen_random_uuid(),
  cnr                 text not null unique,
  court               text not null default 'southdelhi',
  est_code            text,
  establishment       text,

  case_type_code      text,          -- the court's code for the type, e.g. '17'
  case_type           text,          -- as printed: 'CS DJ'
  case_type_full      text,          -- 'CS DJ - CIVIL SUIT FOR DJ ADJ'
  case_number         text,          -- 'CS DJ/4290/2024'
  case_no             int,
  case_year           int,

  filing_number       text,
  filing_date         date,
  registration_date   date,
  first_hearing_date  date,
  next_hearing_date   date,
  decision_date       date,
  status              text check (status in ('pending', 'disposed')),
  stage               text,
  nature_of_disposal  text,
  court_judge         text,

  title               text,
  petitioners         jsonb not null default '[]'::jsonb,  -- [{index, name, advocate, advocates[]}]
  respondents         jsonb not null default '[]'::jsonb,
  advocate_names      text,          -- every advocate, for search
  acts                jsonb not null default '[]'::jsonb,
  fir                 jsonb,
  extra               jsonb not null default '[]'::jsonb,  -- other tables, verbatim
  masked              boolean not null default false,       -- family court hides names

  -- 'listed' = seen in a search result, details not read yet.
  detail_status       text not null default 'listed' check (detail_status in ('listed', 'fetched', 'failed')),
  detail_error        text,
  last_run_id         uuid references public.court_scrape_runs (id) on delete set null,

  listed_at           timestamptz not null default now(),
  fetched_at          timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists court_cases_type_idx   on public.court_cases (case_type_code, case_year desc, case_no desc);
create index if not exists court_cases_next_idx   on public.court_cases (next_hearing_date);
create index if not exists court_cases_status_idx on public.court_cases (detail_status, status);


create table if not exists public.court_case_raw (
  case_id     uuid primary key references public.court_cases (id) on delete cascade,
  html        text not null,
  fetched_at  timestamptz not null default now()
);


create table if not exists public.court_case_advocates (
  id             uuid primary key default gen_random_uuid(),
  case_id        uuid not null references public.court_cases (id) on delete cascade,
  side           text not null check (side in ('petitioner', 'respondent')),
  party_index    int  not null,
  party_name     text,
  advocate_name  text not null,
  advocate_key   text not null,
  unique (case_id, side, party_index, advocate_key)
);

create index if not exists court_case_advocates_key_idx on public.court_case_advocates (advocate_key);


create table if not exists public.court_case_hearings (
  id             uuid primary key default gen_random_uuid(),
  case_id        uuid not null references public.court_cases (id) on delete cascade,
  seq            int  not null,
  judge          text,
  business_date  date,
  next_date      date,
  purpose        text,
  business       jsonb,
  unique (case_id, seq)
);


create table if not exists public.court_case_orders (
  id                  uuid primary key default gen_random_uuid(),
  case_id             uuid not null references public.court_cases (id) on delete cascade,
  kind                text not null check (kind in ('interim', 'final')),
  order_no            int  not null,
  order_date          date,
  label               text,
  source_url          text,

  -- The PDF, fetched from the court the first time somebody opens it.
  pdf_path            text,
  pdf_bytes           int,
  pdf_fetched_at      timestamptz,
  pdf_error           text,

  -- DERIVED. Written once, then served from here: nobody pays twice.
  summary             jsonb,
  summary_model       text,
  summary_source      text,          -- 'text' (extracted) or 'pdf' (model read the file)
  summary_at          timestamptz,
  summary_by          text,
  summary_status      text check (summary_status in ('generating', 'failed')),
  summary_started_at  timestamptz,
  summary_error       text,

  created_at          timestamptz not null default now(),
  unique (case_id, kind, order_no)
);

create index if not exists court_case_orders_case_idx on public.court_case_orders (case_id, order_date);


-- ── the queue: which cases a run still has to read ────────────────────────

create table if not exists public.court_scrape_queue (
  id          uuid primary key default gen_random_uuid(),
  run_id      uuid not null references public.court_scrape_runs (id) on delete cascade,
  task_id     uuid not null references public.court_scrape_tasks (id) on delete cascade,
  case_id     uuid not null references public.court_cases (id) on delete cascade,
  seq         bigint generated always as identity,
  status      text not null default 'pending' check (status in ('pending', 'done', 'failed', 'reused')),
  attempts    int  not null default 0,
  error       text,
  updated_at  timestamptz not null default now(),
  unique (run_id, case_id)
);

create index if not exists court_scrape_queue_next_idx on public.court_scrape_queue (run_id, status, seq);


-- ── views ─────────────────────────────────────────────────────────────────

create or replace view public.court_scrape_task_progress as
  select task_id,
         count(*)                                         as queued,
         count(*) filter (where status in ('done', 'reused')) as fetched,
         count(*) filter (where status = 'failed')        as failed
    from public.court_scrape_queue
   group by task_id;

create or replace view public.court_advocates_v as
  select a.advocate_key,
         mode() within group (order by a.advocate_name)                    as name,
         count(distinct a.case_id)                                          as cases,
         count(distinct a.case_id) filter (where a.side = 'petitioner')     as for_petitioner,
         count(distinct a.case_id) filter (where a.side = 'respondent')     as for_respondent,
         count(distinct a.case_id) filter (where c.status = 'pending')      as pending,
         array_agg(distinct c.case_type) filter (where c.case_type is not null) as case_types,
         max(c.next_hearing_date)                                           as latest_next_hearing,
         max(c.registration_date)                                           as latest_registration
    from public.court_case_advocates a
    join public.court_cases c on c.id = a.case_id
   group by a.advocate_key;

create or replace view public.court_case_stats_v as
  select (select count(*) from public.court_cases)                                        as cases,
         (select count(*) from public.court_cases where detail_status = 'fetched')        as fetched,
         (select count(distinct advocate_key) from public.court_case_advocates)           as advocates,
         (select count(*) from public.court_case_orders)                                  as orders,
         (select count(*) from public.court_case_orders where summary is not null)        as summaries,
         (select count(*) from public.court_cases where next_hearing_date >= current_date) as upcoming;


-- ── functions ─────────────────────────────────────────────────────────────

-- Claim a run for one tick. True when this caller now holds it.
create or replace function public.court_claim_run(p_run uuid, p_seconds int)
returns boolean language sql as $$
  with c as (
    update public.court_scrape_runs
       set lease_until = now() + make_interval(secs => p_seconds)
     where id = p_run
       and (lease_until is null or lease_until < now())
    returning 1
  )
  select exists (select 1 from c);
$$;

-- Record a person's answer against the captcha they were shown — and only
-- that one, so an answer typed into a stale image never lands on a new one.
create or replace function public.court_answer_captcha(p_run uuid, p_captcha text, p_answer text)
returns boolean language sql as $$
  with u as (
    update public.court_scrape_runs
       set captcha = captcha || jsonb_build_object('answer', p_answer, 'answeredAt', now()),
           updated_at = now()
     where id = p_run
       and captcha ->> 'id' = p_captcha
       and coalesce(captcha ->> 'answer', '') = ''
    returning 1
  )
  select exists (select 1 from u);
$$;

-- Write one parsed case page in a single transaction: the case, its raw HTML,
-- hearings, advocates and orders. Orders are upserted, never replaced, so a
-- re-read keeps the stored PDF and the summary somebody already paid for.
create or replace function public.court_ingest_case(p jsonb)
returns uuid language plpgsql as $$
declare
  cid uuid;
begin
  insert into public.court_cases as c (
    cnr, court, est_code, establishment, case_type_code, case_type, case_type_full,
    case_number, case_no, case_year, filing_number, filing_date, registration_date,
    first_hearing_date, next_hearing_date, decision_date, status, stage,
    nature_of_disposal, court_judge, title, petitioners, respondents, advocate_names,
    acts, fir, extra, masked, detail_status, detail_error, last_run_id, fetched_at, updated_at
  ) values (
    p ->> 'cnr', coalesce(p ->> 'court', 'southdelhi'), p ->> 'est_code', p ->> 'establishment',
    p ->> 'case_type_code', p ->> 'case_type', p ->> 'case_type_full',
    p ->> 'case_number', (p ->> 'case_no')::int, (p ->> 'case_year')::int,
    p ->> 'filing_number', (p ->> 'filing_date')::date, (p ->> 'registration_date')::date,
    (p ->> 'first_hearing_date')::date, (p ->> 'next_hearing_date')::date, (p ->> 'decision_date')::date,
    p ->> 'status', p ->> 'stage', p ->> 'nature_of_disposal', p ->> 'court_judge',
    p ->> 'title', coalesce(p -> 'petitioners', '[]'), coalesce(p -> 'respondents', '[]'), p ->> 'advocate_names',
    coalesce(p -> 'acts', '[]'), p -> 'fir', coalesce(p -> 'extra', '[]'), coalesce((p ->> 'masked')::boolean, false),
    'fetched', null, (p ->> 'run_id')::uuid, now(), now()
  )
  on conflict (cnr) do update set
    est_code           = coalesce(excluded.est_code, c.est_code),
    establishment      = coalesce(excluded.establishment, c.establishment),
    case_type_code     = coalesce(excluded.case_type_code, c.case_type_code),
    case_type          = coalesce(excluded.case_type, c.case_type),
    case_type_full     = excluded.case_type_full,
    case_number        = coalesce(excluded.case_number, c.case_number),
    case_no            = coalesce(excluded.case_no, c.case_no),
    case_year          = coalesce(excluded.case_year, c.case_year),
    filing_number      = excluded.filing_number,
    filing_date        = excluded.filing_date,
    registration_date  = excluded.registration_date,
    first_hearing_date = excluded.first_hearing_date,
    next_hearing_date  = excluded.next_hearing_date,
    decision_date      = excluded.decision_date,
    status             = excluded.status,
    stage              = excluded.stage,
    nature_of_disposal = excluded.nature_of_disposal,
    court_judge        = excluded.court_judge,
    title              = excluded.title,
    petitioners        = excluded.petitioners,
    respondents        = excluded.respondents,
    advocate_names     = excluded.advocate_names,
    acts               = excluded.acts,
    fir                = excluded.fir,
    extra              = excluded.extra,
    masked             = excluded.masked,
    detail_status      = 'fetched',
    detail_error       = null,
    last_run_id        = coalesce(excluded.last_run_id, c.last_run_id),
    fetched_at         = now(),
    updated_at         = now()
  returning id into cid;

  insert into public.court_case_raw (case_id, html, fetched_at)
  values (cid, coalesce(p ->> 'raw_html', ''), now())
  on conflict (case_id) do update set html = excluded.html, fetched_at = now();

  delete from public.court_case_hearings where case_id = cid;
  insert into public.court_case_hearings (case_id, seq, judge, business_date, next_date, purpose, business)
  select cid, (h ->> 'seq')::int, h ->> 'judge', (h ->> 'businessDate')::date,
         (h ->> 'nextDate')::date, h ->> 'purpose', h -> 'business'
    from jsonb_array_elements(coalesce(p -> 'hearings', '[]')) h;

  delete from public.court_case_advocates where case_id = cid;
  insert into public.court_case_advocates (case_id, side, party_index, party_name, advocate_name, advocate_key)
  select cid, a ->> 'side', (a ->> 'partyIndex')::int, a ->> 'partyName', a ->> 'name', a ->> 'key'
    from jsonb_array_elements(coalesce(p -> 'advocates', '[]')) a
  on conflict do nothing;

  insert into public.court_case_orders (case_id, kind, order_no, order_date, label, source_url)
  select cid, o ->> 'kind', (o ->> 'orderNo')::int, (o ->> 'orderDate')::date, o ->> 'label', o ->> 'sourceUrl'
    from jsonb_array_elements(coalesce(p -> 'orders', '[]')) o
  on conflict (case_id, kind, order_no) do update set
    order_date = excluded.order_date,
    label      = excluded.label,
    source_url = excluded.source_url;

  return cid;
end $$;

-- Claim an order's summary for generation. True for exactly one caller, so
-- two people clicking at once pay for one summary. A claim older than five
-- minutes is treated as abandoned.
create or replace function public.court_claim_summary(p_order uuid)
returns boolean language sql as $$
  with u as (
    update public.court_case_orders
       set summary_status = 'generating', summary_started_at = now(), summary_error = null
     where id = p_order
       and summary is null
       and (summary_status is null
            or summary_status = 'failed'
            or summary_started_at < now() - interval '5 minutes')
    returning 1
  )
  select exists (select 1 from u);
$$;


-- ── access ────────────────────────────────────────────────────────────────
-- RLS on, no policies: the dashboard reaches these with the service key only,
-- the same posture as the rest of the engine. Views and functions are locked
-- down by grant because Postgres 14 has no security_invoker views.

do $$
declare
  t text;
begin
  foreach t in array array[
    'court_scrape_runs', 'court_scrape_tasks', 'court_scrape_queue',
    'court_cases', 'court_case_raw', 'court_case_advocates',
    'court_case_hearings', 'court_case_orders'
  ] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

revoke all on public.court_scrape_task_progress from anon, authenticated;
revoke all on public.court_advocates_v          from anon, authenticated;
revoke all on public.court_case_stats_v         from anon, authenticated;

revoke all on function public.court_claim_run(uuid, int)             from public, anon, authenticated;
revoke all on function public.court_answer_captcha(uuid, text, text) from public, anon, authenticated;
revoke all on function public.court_ingest_case(jsonb)               from public, anon, authenticated;
revoke all on function public.court_claim_summary(uuid)              from public, anon, authenticated;
grant execute on function public.court_claim_run(uuid, int)             to service_role;
grant execute on function public.court_answer_captcha(uuid, text, text) to service_role;
grant execute on function public.court_ingest_case(jsonb)               to service_role;
grant execute on function public.court_claim_summary(uuid)              to service_role;

notify pgrst, 'reload schema';
