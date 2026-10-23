-- ═══════════════════════════════════════════════════════════════════════════
--  SCL, migration 052: Court Cases — several people on one run
--
--  Requires 0050. Run once in Supabase → SQL Editor. Safe to re-run.
--
--  Each person's extension claims a case type, does its searches and opens its
--  cases, then claims the next free one. A claim lapses a few minutes after
--  its holder stops checking in (window closed, laptop asleep), and the case
--  type — with whatever cases it had already listed — goes to whoever asks next.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.court_scrape_tasks add column if not exists claimed_by    text;
alter table public.court_scrape_tasks add column if not exists claimed_name  text;
alter table public.court_scrape_tasks add column if not exists claimed_until timestamptz;

create index if not exists court_scrape_tasks_claim_idx on public.court_scrape_tasks (run_id, claimed_by);

-- Claim the next case type that still has work (a search to do, or listed
-- cases still to open) and that nobody else holds. A capturer's own claim is
-- preferred, so a person keeps the type they started. Returns the task id, or
-- null when everything left is held by somebody else.
create or replace function public.court_claim_task(p_run uuid, p_capturer text, p_name text, p_seconds int)
returns uuid language plpgsql as $$
declare
  tid uuid;
begin
  select t.id into tid
    from public.court_scrape_tasks t
   where t.run_id = p_run
     and (t.status = 'pending'
          or exists (select 1 from public.court_scrape_queue q where q.task_id = t.id and q.status = 'pending'))
     and (t.claimed_by is null or t.claimed_until < now() or t.claimed_by = p_capturer)
   order by (t.claimed_by = p_capturer) desc nulls last, t.seq
   limit 1
   for update skip locked;

  if tid is null then
    return null;
  end if;

  update public.court_scrape_tasks
     set claimed_by = p_capturer,
         claimed_name = p_name,
         claimed_until = now() + make_interval(secs => p_seconds)
   where id = tid;
  return tid;
end $$;

-- Add to a run's counters (and one person's), append activity lines and mark
-- the run as seen, in one statement. With several people reporting at once a
-- read-modify-write in the app would lose increments; this cannot.
create or replace function public.court_touch_run(
  p_run uuid, p_delta jsonb, p_person text, p_person_delta jsonb, p_notes jsonb, p_error text, p_set_error boolean
) returns void language plpgsql as $$
declare
  s   jsonb;
  ppl jsonb;
  me  jsonb;
  k   text;
  v   numeric;
begin
  select coalesce(stats, '{}'::jsonb) into s from public.court_scrape_runs where id = p_run for update;
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

  update public.court_scrape_runs
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

revoke all on function public.court_claim_task(uuid, text, text, int) from public, anon, authenticated;
grant execute on function public.court_claim_task(uuid, text, text, int) to service_role;
revoke all on function public.court_touch_run(uuid, jsonb, text, jsonb, jsonb, text, boolean) from public, anon, authenticated;
grant execute on function public.court_touch_run(uuid, jsonb, text, jsonb, jsonb, text, boolean) to service_role;

notify pgrst, 'reload schema';
