-- ASHUR 1.3 stories / mentions / privacy
-- Applied to project pwpjrwcynnicexrmunkd on 2026-09-28.

alter table public.stories
  add column if not exists reshared_from_story_id uuid references public.stories(id) on delete set null;

create table if not exists public.story_mentions (
  story_id uuid not null references public.stories(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  mentioned_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (story_id, user_id)
);

create index if not exists story_mentions_user_created_idx
  on public.story_mentions(user_id, created_at desc);

alter table public.story_mentions enable row level security;

drop policy if exists story_mentions_read on public.story_mentions;
create policy story_mentions_read on public.story_mentions
for select to authenticated
using (
  user_id = (select auth.uid())
  or mentioned_by = (select auth.uid())
);

drop policy if exists stories_read on public.stories;
create policy stories_read on public.stories
for select to authenticated
using (
  expires_at > now()
  and moderation_status = 'active'
  and deleted_at is null
  and exists (
    select 1 from public.profiles p
    where p.id = stories.author_id
      and p.deleted_at is null
      and p.is_banned = false
      and (p.banned_until is null or p.banned_until <= now())
  )
  and not private.is_blocked_between((select auth.uid()), author_id)
  and (
    author_id = (select auth.uid())
    or exists (
      select 1 from public.follows f
      where f.follower_id = (select auth.uid())
        and f.following_id = stories.author_id
        and f.status = 'accepted'
    )
  )
);
