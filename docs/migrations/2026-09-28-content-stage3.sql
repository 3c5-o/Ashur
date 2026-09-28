-- ASHUR stage 3: reels, posts, comments
-- Applied to Supabase project pwpjrwcynnicexrmunkd on 2026-09-28.

alter table public.posts
  add column if not exists pinned_at timestamptz;

alter table public.reels
  add column if not exists view_count bigint not null default 0;

alter table public.comments
  add column if not exists pinned_at timestamptz;

create index if not exists posts_author_pinned_created_idx
  on public.posts(author_id, pinned_at desc nulls last, created_at desc)
  where deleted_at is null and moderation_status = 'active';

create index if not exists comments_post_pinned_created_idx
  on public.comments(post_id, pinned_at desc nulls last, created_at asc)
  where post_id is not null and deleted_at is null and moderation_status = 'active';

create index if not exists comments_reel_pinned_created_idx
  on public.comments(reel_id, pinned_at desc nulls last, created_at asc)
  where reel_id is not null and deleted_at is null and moderation_status = 'active';

create table if not exists public.reel_views (
  reel_id uuid not null references public.reels(id) on delete cascade,
  viewer_id uuid not null references auth.users(id) on delete cascade,
  viewed_at timestamptz not null default now(),
  primary key (reel_id, viewer_id)
);

alter table public.reel_views enable row level security;
revoke all on table public.reel_views from anon, authenticated;
grant all on table public.reel_views to service_role;

create table if not exists public.content_mentions (
  content_type text not null check (content_type in ('post','reel','comment')),
  content_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  mentioned_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (content_type, content_id, user_id)
);

alter table public.content_mentions enable row level security;
revoke all on table public.content_mentions from anon, authenticated;
grant all on table public.content_mentions to service_role;

create or replace function public.record_reel_view(p_reel_id uuid, p_viewer_id uuid)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted_count integer := 0;
  current_count bigint := 0;
begin
  if p_reel_id is null or p_viewer_id is null then
    return 0;
  end if;

  insert into public.reel_views(reel_id, viewer_id)
  select r.id, p_viewer_id
  from public.reels r
  where r.id = p_reel_id
    and r.deleted_at is null
    and r.moderation_status = 'active'
  on conflict (reel_id, viewer_id) do nothing;

  get diagnostics inserted_count = row_count;

  if inserted_count > 0 then
    update public.reels
    set view_count = view_count + 1
    where id = p_reel_id
    returning view_count into current_count;
  else
    select coalesce(view_count,0)
    into current_count
    from public.reels
    where id = p_reel_id;
  end if;

  return coalesce(current_count,0);
end;
$$;

revoke all on function public.record_reel_view(uuid,uuid) from public, anon, authenticated;
grant execute on function public.record_reel_view(uuid,uuid) to service_role;
