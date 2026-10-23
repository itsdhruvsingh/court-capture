-- ═══════════════════════════════════════════════════════════════════════════
--  SCL, migration 051: Court Cases — keep everything the court shows
--
--  Requires 0050. Run once in Supabase → SQL Editor. Safe to re-run.
--
--    court_cases.tables    every table on the case page, verbatim, including
--                          the ones already parsed into columns
--    court_cases.sections  the page's headings and captions, in order
--    court_search_results  every search the extension ran: all listed rows
--                          (not just the newest ten it opened) and the HTML
--
--  The raw case page was already kept in court_case_raw; these make the rest
--  queryable without re-parsing, and stop search listings being thrown away.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.court_cases add column if not exists tables   jsonb not null default '[]'::jsonb;
alter table public.court_cases add column if not exists sections jsonb not null default '[]'::jsonb;


create table if not exists public.court_search_results (
  id              uuid primary key default gen_random_uuid(),
  run_id          uuid references public.court_scrape_runs (id) on delete set null,
  task_id         uuid references public.court_scrape_tasks (id) on delete set null,
  court           text not null default 'southdelhi',
  case_type_code  text not null,
  case_type_name  text,
  reg_year        int  not null,
  case_status     text not null check (case_status in ('P', 'D')),
  outcome         text not null check (outcome in ('results', 'empty')),
  -- Per establishment: {estCode, establishment, total, nextPage, rows: [...]}
  blocks          jsonb not null default '[]'::jsonb,
  listed_total    int,
  message         text,
  html            text,
  captured_at     timestamptz not null default now()
);

create index if not exists court_search_results_type_idx on public.court_search_results (case_type_code, reg_year desc, captured_at desc);

alter table public.court_search_results enable row level security;


-- The ingest function, now also writing tables and sections. Everything else
-- is as in 0050.
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
    acts, fir, extra, tables, sections, masked, detail_status, detail_error, last_run_id, fetched_at, updated_at
  ) values (
    p ->> 'cnr', coalesce(p ->> 'court', 'southdelhi'), p ->> 'est_code', p ->> 'establishment',
    p ->> 'case_type_code', p ->> 'case_type', p ->> 'case_type_full',
    p ->> 'case_number', (p ->> 'case_no')::int, (p ->> 'case_year')::int,
    p ->> 'filing_number', (p ->> 'filing_date')::date, (p ->> 'registration_date')::date,
    (p ->> 'first_hearing_date')::date, (p ->> 'next_hearing_date')::date, (p ->> 'decision_date')::date,
    p ->> 'status', p ->> 'stage', p ->> 'nature_of_disposal', p ->> 'court_judge',
    p ->> 'title', coalesce(p -> 'petitioners', '[]'), coalesce(p -> 'respondents', '[]'), p ->> 'advocate_names',
    coalesce(p -> 'acts', '[]'), p -> 'fir', coalesce(p -> 'extra', '[]'),
    coalesce(p -> 'tables', '[]'), coalesce(p -> 'sections', '[]'),
    coalesce((p ->> 'masked')::boolean, false),
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
    tables             = excluded.tables,
    sections           = excluded.sections,
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

revoke all on function public.court_ingest_case(jsonb) from public, anon, authenticated;
grant execute on function public.court_ingest_case(jsonb) to service_role;

notify pgrst, 'reload schema';
