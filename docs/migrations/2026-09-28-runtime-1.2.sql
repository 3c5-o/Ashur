-- ASHUR 1.2 realtime + interaction counters
-- Runtime support for real-time chat and feed/reel interaction counters.

do $
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='message_reads'
  ) then
    alter publication supabase_realtime add table public.message_reads;
  end if;
end $;

create or replace function public.content_interaction_counts(p_kind text, p_ids uuid[])
returns table(content_id uuid, likes bigint, comments bigint)
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select x.id,
    case when p_kind='reel'
      then (select count(*) from public.reel_likes rl where rl.reel_id=x.id)
      else (select count(*) from public.post_likes pl where pl.post_id=x.id)
    end as likes,
    case when p_kind='reel'
      then (select count(*) from public.comments c where c.reel_id=x.id and c.deleted_at is null and c.moderation_status='active')
      else (select count(*) from public.comments c where c.post_id=x.id and c.deleted_at is null and c.moderation_status='active')
    end as comments
  from unnest(coalesce(p_ids,'{}'::uuid[])) as x(id)
  where p_kind in ('post','reel');
$$;

revoke all on function public.content_interaction_counts(text,uuid[]) from public;
grant execute on function public.content_interaction_counts(text,uuid[]) to authenticated;
