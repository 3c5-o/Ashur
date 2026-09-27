-- ASHUR 1.2 RLS hardening and moderation visibility
-- Applied to Supabase project pwpjrwcynnicexrmunkd on 2026-09-28.

create or replace function private.is_blocked_between(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, private
as $$
  select case
    when a is null or b is null or a = b then false
    else exists (
      select 1
      from public.blocks x
      where (x.blocker_id = a and x.blocked_id = b)
         or (x.blocker_id = b and x.blocked_id = a)
    )
  end
$$;

create or replace function private.can_send_to_conversation(p_conversation_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $$
declare
  me uuid := auth.uid();
  k text;
begin
  if me is null then return false; end if;
  if not exists (
    select 1 from public.conversation_members cm
    where cm.conversation_id = p_conversation_id and cm.user_id = me
  ) then return false; end if;

  select c.kind into k from public.conversations c where c.id = p_conversation_id;
  if k is distinct from 'direct' then return true; end if;

  return not exists (
    select 1
    from public.conversation_members cm
    join public.blocks b
      on ((b.blocker_id = me and b.blocked_id = cm.user_id)
       or (b.blocked_id = me and b.blocker_id = cm.user_id))
    where cm.conversation_id = p_conversation_id
      and cm.user_id <> me
  );
end
$$;

revoke all on function private.is_blocked_between(uuid,uuid) from public;
grant execute on function private.is_blocked_between(uuid,uuid) to anon, authenticated;
revoke all on function private.can_send_to_conversation(uuid) from public;
grant execute on function private.can_send_to_conversation(uuid) to authenticated;

drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles
for select to anon, authenticated
using (
  id = (select auth.uid())
  or (
    deleted_at is null
    and is_banned = false
    and (banned_until is null or banned_until <= now())
    and not private.is_blocked_between((select auth.uid()), id)
  )
);

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
for update to authenticated
using (
  id = (select auth.uid())
  and deleted_at is null
  and is_banned = false
  and (banned_until is null or banned_until <= now())
)
with check (
  id = (select auth.uid())
  and deleted_at is null
  and is_banned = false
  and (banned_until is null or banned_until <= now())
);

drop policy if exists posts_read on public.posts;
create policy posts_read on public.posts
for select to anon, authenticated
using (
  moderation_status = 'active'
  and deleted_at is null
  and exists (
    select 1 from public.profiles p
    where p.id = posts.author_id
      and p.deleted_at is null
      and p.is_banned = false
      and (p.banned_until is null or p.banned_until <= now())
  )
  and not private.is_blocked_between((select auth.uid()), author_id)
  and (
    author_id = (select auth.uid())
    or (
      visibility = 'public'
      and (
        exists (select 1 from public.profiles p where p.id = posts.author_id and p.is_private = false)
        or exists (
          select 1 from public.follows f
          where f.follower_id = (select auth.uid())
            and f.following_id = posts.author_id
            and f.status = 'accepted'
        )
      )
    )
    or (
      visibility = 'followers'
      and exists (
        select 1 from public.follows f
        where f.follower_id = (select auth.uid())
          and f.following_id = posts.author_id
          and f.status = 'accepted'
      )
    )
  )
);

drop policy if exists posts_insert on public.posts;
create policy posts_insert on public.posts
for insert to authenticated
with check (
  author_id = (select auth.uid())
  and moderation_status = 'active'
  and deleted_at is null
  and exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.deleted_at is null
      and p.is_banned = false
      and (p.banned_until is null or p.banned_until <= now())
  )
);

drop policy if exists reels_read on public.reels;
create policy reels_read on public.reels
for select to anon, authenticated
using (
  moderation_status = 'active'
  and deleted_at is null
  and exists (
    select 1 from public.profiles p
    where p.id = reels.author_id
      and p.deleted_at is null
      and p.is_banned = false
      and (p.banned_until is null or p.banned_until <= now())
  )
  and not private.is_blocked_between((select auth.uid()), author_id)
  and (
    author_id = (select auth.uid())
    or (
      visibility = 'public'
      and (
        exists (select 1 from public.profiles p where p.id = reels.author_id and p.is_private = false)
        or exists (
          select 1 from public.follows f
          where f.follower_id = (select auth.uid())
            and f.following_id = reels.author_id
            and f.status = 'accepted'
        )
      )
    )
    or (
      visibility = 'followers'
      and exists (
        select 1 from public.follows f
        where f.follower_id = (select auth.uid())
          and f.following_id = reels.author_id
          and f.status = 'accepted'
      )
    )
  )
);

drop policy if exists reels_insert on public.reels;
create policy reels_insert on public.reels
for insert to authenticated
with check (
  author_id = (select auth.uid())
  and moderation_status = 'active'
  and deleted_at is null
  and exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.deleted_at is null
      and p.is_banned = false
      and (p.banned_until is null or p.banned_until <= now())
  )
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
    or exists (select 1 from public.profiles p where p.id = stories.author_id and p.is_private = false)
    or exists (
      select 1 from public.follows f
      where f.follower_id = (select auth.uid())
        and f.following_id = stories.author_id
        and f.status = 'accepted'
    )
  )
);

drop policy if exists stories_insert on public.stories;
create policy stories_insert on public.stories
for insert to authenticated
with check (
  author_id = (select auth.uid())
  and moderation_status = 'active'
  and deleted_at is null
  and exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.deleted_at is null
      and p.is_banned = false
      and (p.banned_until is null or p.banned_until <= now())
  )
);

drop policy if exists comments_read on public.comments;
create policy comments_read on public.comments
for select to anon, authenticated
using (
  moderation_status = 'active'
  and deleted_at is null
  and (
    (post_id is not null and exists (select 1 from public.posts p where p.id = comments.post_id))
    or
    (reel_id is not null and exists (select 1 from public.reels r where r.id = comments.reel_id))
  )
);

drop policy if exists comments_insert on public.comments;
create policy comments_insert on public.comments
for insert to authenticated
with check (
  author_id = (select auth.uid())
  and moderation_status = 'active'
  and deleted_at is null
  and (
    (post_id is not null and exists (select 1 from public.posts p where p.id = comments.post_id and p.comments_enabled = true))
    or
    (reel_id is not null and exists (select 1 from public.reels r where r.id = comments.reel_id and r.comments_enabled = true))
  )
);

drop policy if exists follows_insert on public.follows;
create policy follows_insert on public.follows
for insert to authenticated
with check (
  follower_id = (select auth.uid())
  and follower_id <> following_id
  and not private.is_blocked_between(follower_id, following_id)
);

drop policy if exists messages_member_insert on public.messages;
create policy messages_member_insert on public.messages
for insert to authenticated
with check (
  sender_id = (select auth.uid())
  and private.can_send_to_conversation(conversation_id)
);

drop policy if exists messages_sender_update on public.messages;
create policy messages_sender_update on public.messages
for update to authenticated
using (
  sender_id = (select auth.uid())
  and private.is_conversation_member(conversation_id)
)
with check (
  sender_id = (select auth.uid())
  and private.can_send_to_conversation(conversation_id)
);

drop policy if exists post_likes_read on public.post_likes;
create policy post_likes_read on public.post_likes
for select to anon, authenticated
using (exists (select 1 from public.posts p where p.id = post_likes.post_id));

drop policy if exists post_likes_insert on public.post_likes;
create policy post_likes_insert on public.post_likes
for insert to authenticated
with check (
  user_id = (select auth.uid())
  and exists (select 1 from public.posts p where p.id = post_likes.post_id)
);

drop policy if exists reel_likes_read on public.reel_likes;
create policy reel_likes_read on public.reel_likes
for select to anon, authenticated
using (exists (select 1 from public.reels r where r.id = reel_likes.reel_id));

drop policy if exists reel_likes_insert on public.reel_likes;
create policy reel_likes_insert on public.reel_likes
for insert to authenticated
with check (
  user_id = (select auth.uid())
  and exists (select 1 from public.reels r where r.id = reel_likes.reel_id)
);
