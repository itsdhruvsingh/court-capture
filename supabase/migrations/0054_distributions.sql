-- ═══════════════════════════════════════════════════════════════════════════
--  Court Capture, migration 054: case-type distributions
--
--  Requires 0050–0053. Run once in Supabase → SQL Editor. Safe to re-run.
--  Read-only views behind the two "Case types" pages; nothing is stored.
--
--  District: the court's own count of cases for every establishment and
--  printed case type, per registration year and status, from the searches the
--  extension made. Counts follow the type printed on the rows, because a
--  case-type code means different types at different establishments (76 is
--  ARB. A.(COMM.) at the District Judge but CC NI ACT at the CMM).
--
--  High Court: each judge's complete list — their widest search — counted by
--  case type and by year, and every case type across all the lists with each
--  case's entry counted once (a bench lists it under each of its judges).
-- ═══════════════════════════════════════════════════════════════════════════


-- ── district ──────────────────────────────────────────────────────────────

create or replace view public.court_type_totals_v as
  select distinct on (est_code, type_label, reg_year, case_status)
         est_code, establishment, type_label, reg_year, case_status, total, captured_at
    from (
      select b ->> 'estCode'       as est_code,
             b ->> 'establishment' as establishment,
             (select r ->> 'typeLabel'
                from jsonb_array_elements(coalesce(b -> 'rows', '[]'::jsonb)) r
               where coalesce(r ->> 'typeLabel', '') <> ''
               group by 1
               order by count(*) desc
               limit 1)            as type_label,
             s.reg_year,
             s.case_status,
             coalesce((b ->> 'total')::int, jsonb_array_length(coalesce(b -> 'rows', '[]'::jsonb))) as total,
             s.captured_at
        from public.court_search_results s
       cross join lateral jsonb_array_elements(coalesce(s.blocks, '[]'::jsonb)) b
       where s.outcome = 'results'
    ) t
   where type_label is not null
   order by est_code, type_label, reg_year, case_status, captured_at desc;


-- ── High Court ────────────────────────────────────────────────────────────

-- A judge's complete list: the widest search, the newest of equals.
create or replace view public.hc_judge_lists_v as
  select distinct on (s.judge_code)
         s.judge_code, s.judge_name, s.from_date, s.to_date, s.listed_total,
         jsonb_array_length(s.rows) as read_total, s.rows, s.captured_at
    from public.hc_search_results s
   where s.outcome = 'results' and jsonb_array_length(s.rows) > 0
   order by s.judge_code, (s.to_date - s.from_date) desc, s.captured_at desc;

create or replace view public.hc_judge_type_counts_v as
  select l.judge_code,
         coalesce(nullif(r ->> 'caseTypeCode', ''), '?') as type_code,
         count(*)::int                                    as judgments
    from public.hc_judge_lists_v l
   cross join lateral jsonb_array_elements(l.rows) r
   group by 1, 2;

create or replace view public.hc_judge_year_counts_v as
  select l.judge_code,
         left(r ->> 'orderDate', 4)::int as year,
         count(*)::int                   as judgments
    from public.hc_judge_lists_v l
   cross join lateral jsonb_array_elements(l.rows) r
   where r ->> 'orderDate' ~ '^\d{4}-'
   group by 1, 2;

-- One entry per case decided: a common judgment for connected cases is listed
-- once per case (same PDF, different numbers) and counts for each; a bench's
-- entry (same case, same PDF, under each judge) counts once.
create or replace view public.hc_type_counts_v as
  select coalesce(nullif(r ->> 'caseTypeCode', ''), '?') as type_code,
         count(distinct (r ->> 'caseNo') || '|' || coalesce(r ->> 'pdfUrl', r ->> 'orderDate', ''))::int as judgments
    from public.hc_judge_lists_v l
   cross join lateral jsonb_array_elements(l.rows) r
   group by 1;


-- ── access: the server only ───────────────────────────────────────────────

revoke all on public.court_type_totals_v    from anon, authenticated;
revoke all on public.hc_judge_lists_v       from anon, authenticated;
revoke all on public.hc_judge_type_counts_v from anon, authenticated;
revoke all on public.hc_judge_year_counts_v from anon, authenticated;
revoke all on public.hc_type_counts_v       from anon, authenticated;
grant select on public.court_type_totals_v, public.hc_judge_lists_v, public.hc_judge_type_counts_v,
                public.hc_judge_year_counts_v, public.hc_type_counts_v to service_role;

notify pgrst, 'reload schema';
