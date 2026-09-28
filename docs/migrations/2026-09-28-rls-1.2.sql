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

-- Batch C: profile identity hardening

do $$
begin
  if not exists (select 1 from pg_constraint where conname='profiles_name_length' and conrelid='public.profiles'::regclass) then
    alter table public.profiles
      add constraint profiles_name_length check (char_length(trim(name)) between 1 and 80);
  end if;
  if not exists (select 1 from pg_constraint where conname='profiles_bio_length' and conrelid='public.profiles'::regclass) then
    alter table public.profiles
      add constraint profiles_bio_length check (char_length(bio) <= 300);
  end if;
  if not exists (select 1 from pg_constraint where conname='profiles_link_length' and conrelid='public.profiles'::regclass) then
    alter table public.profiles
      add constraint profiles_link_length check (char_length(profile_link) <= 220);
  end if;
  if not exists (select 1 from pg_constraint where conname='profiles_saved_visibility_values' and conrelid='public.profiles'::regclass) then
    alter table public.profiles
      add constraint profiles_saved_visibility_values check (saved_visibility in ('private','public'));
  end if;
  if not exists (select 1 from pg_constraint where conname='profiles_username_lowercase' and conrelid='public.profiles'::regclass) then
    alter table public.profiles
      add constraint profiles_username_lowercase check (username is null or username = lower(username));
  end if;
end $$;

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
  and char_length(trim(name)) between 1 and 80
  and char_length(bio) <= 300
  and char_length(profile_link) <= 220
  and saved_visibility in ('private','public')
  and (username is null or (
    username = lower(username)
    and username ~ '^[a-z0-9_]{3,24}$'
  ))
  and (
    avatar_media_id is null
    or exists (
      select 1
      from public.media_objects m
      where m.id = avatar_media_id
        and m.owner_id = (select auth.uid())
        and m.status = 'ready'
        and m.kind = 'profile'
    )
  )
  and (
    cover_media_id is null
    or exists (
      select 1
      from public.media_objects m
      where m.id = cover_media_id
        and m.owner_id = (select auth.uid())
        and m.status = 'ready'
        and m.kind = 'profile_cover'
    )
  )
);

-- Batch D: social content ownership and least-privilege hardening

revoke insert, update, delete, truncate on table
  public.posts,
  public.post_media,
  public.post_likes,
  public.reels,
  public.reel_likes,
  public.stories,
  public.comments
from anon;

revoke all on table
  public.saved_posts,
  public.saved_reels,
  public.story_views
from anon;

revoke truncate on table
  public.posts,
  public.post_media,
  public.post_likes,
  public.saved_posts,
  public.reels,
  public.reel_likes,
  public.saved_reels,
  public.stories,
  public.story_views,
  public.comments
from authenticated;

revoke update, delete on table
  public.posts,
  public.post_media,
  public.reels,
  public.stories,
  public.comments
from authenticated;

revoke update on table
  public.post_likes,
  public.reel_likes,
  public.saved_posts,
  public.saved_reels,
  public.story_views
from authenticated;

revoke insert on table public.posts from authenticated;
grant insert (author_id, caption, visibility, comments_enabled)
on table public.posts to authenticated;

revoke insert on table public.post_media from authenticated;
grant insert (post_id, media_id, sort_order)
on table public.post_media to authenticated;

revoke insert on table public.reels from authenticated;
grant insert (author_id, media_id, cover_media_id, caption, visibility, comments_enabled, explore_enabled)
on table public.reels to authenticated;

revoke insert on table public.stories from authenticated;
grant insert (author_id, media_id, caption, overlay_text, overlay_color, overlay_y, overlay_bg)
on table public.stories to authenticated;

revoke insert on table public.comments from authenticated;
grant insert (author_id, body, parent_id, post_id, reel_id)
on table public.comments to authenticated;

revoke insert, delete on table public.story_views from authenticated;

drop policy if exists post_media_insert on public.post_media;
create policy post_media_insert on public.post_media
for insert to authenticated
with check (
  exists (
    select 1
    from public.posts p
    where p.id = post_media.post_id
      and p.author_id = (select auth.uid())
  )
  and exists (
    select 1
    from public.media_objects m
    where m.id = post_media.media_id
      and m.owner_id = (select auth.uid())
      and m.status = 'ready'
      and m.kind in ('post_image','post_video')
  )
);

drop policy if exists post_media_update on public.post_media;
create policy post_media_update on public.post_media
for update to authenticated
using (
  exists (
    select 1 from public.posts p
    where p.id = post_media.post_id
      and p.author_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1 from public.posts p
    where p.id = post_media.post_id
      and p.author_id = (select auth.uid())
  )
  and exists (
    select 1
    from public.media_objects m
    where m.id = post_media.media_id
      and m.owner_id = (select auth.uid())
      and m.status = 'ready'
      and m.kind in ('post_image','post_video')
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
  and exists (
    select 1 from public.media_objects m
    where m.id = reels.media_id
      and m.owner_id = (select auth.uid())
      and m.status = 'ready'
      and m.kind = 'reel'
  )
  and (
    cover_media_id is null
    or exists (
      select 1 from public.media_objects m
      where m.id = reels.cover_media_id
        and m.owner_id = (select auth.uid())
        and m.status = 'ready'
        and m.kind = 'reel_cover'
    )
  )
);

drop policy if exists reels_update on public.reels;
create policy reels_update on public.reels
for update to authenticated
using (author_id = (select auth.uid()))
with check (
  author_id = (select auth.uid())
  and exists (
    select 1 from public.media_objects m
    where m.id = reels.media_id
      and m.owner_id = (select auth.uid())
      and m.status = 'ready'
      and m.kind = 'reel'
  )
  and (
    cover_media_id is null
    or exists (
      select 1 from public.media_objects m
      where m.id = reels.cover_media_id
        and m.owner_id = (select auth.uid())
        and m.status = 'ready'
        and m.kind = 'reel_cover'
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
  and exists (
    select 1 from public.media_objects m
    where m.id = stories.media_id
      and m.owner_id = (select auth.uid())
      and m.status = 'ready'
      and m.kind = 'story'
  )
);

drop policy if exists stories_update on public.stories;
create policy stories_update on public.stories
for update to authenticated
using (author_id = (select auth.uid()))
with check (
  author_id = (select auth.uid())
  and exists (
    select 1 from public.media_objects m
    where m.id = stories.media_id
      and m.owner_id = (select auth.uid())
      and m.status = 'ready'
      and m.kind = 'story'
  )
);

drop policy if exists comments_insert on public.comments;
create policy comments_insert on public.comments
for insert to authenticated
with check (
  author_id = (select auth.uid())
  and moderation_status = 'active'
  and deleted_at is null
  and char_length(trim(body)) between 1 and 2000
  and (
    (
      post_id is not null
      and reel_id is null
      and exists (
        select 1 from public.posts p
        where p.id = comments.post_id
          and p.comments_enabled = true
      )
    )
    or
    (
      reel_id is not null
      and post_id is null
      and exists (
        select 1 from public.reels r
        where r.id = comments.reel_id
          and r.comments_enabled = true
      )
    )
  )
  and (
    parent_id is null
    or exists (
      select 1
      from public.comments parent
      where parent.id = comments.parent_id
        and parent.deleted_at is null
        and parent.moderation_status = 'active'
        and parent.post_id is not distinct from comments.post_id
        and parent.reel_id is not distinct from comments.reel_id
    )
  )
);

drop policy if exists saved_posts_own on public.saved_posts;
drop policy if exists saved_posts_read_own on public.saved_posts;
drop policy if exists saved_posts_insert_own on public.saved_posts;
drop policy if exists saved_posts_delete_own on public.saved_posts;

create policy saved_posts_read_own on public.saved_posts
for select to authenticated
using (user_id = (select auth.uid()));

create policy saved_posts_insert_own on public.saved_posts
for insert to authenticated
with check (
  user_id = (select auth.uid())
  and exists (select 1 from public.posts p where p.id = saved_posts.post_id)
);

create policy saved_posts_delete_own on public.saved_posts
for delete to authenticated
using (user_id = (select auth.uid()));

drop policy if exists saved_reels_own on public.saved_reels;
drop policy if exists saved_reels_read_own on public.saved_reels;
drop policy if exists saved_reels_insert_own on public.saved_reels;
drop policy if exists saved_reels_delete_own on public.saved_reels;

create policy saved_reels_read_own on public.saved_reels
for select to authenticated
using (user_id = (select auth.uid()));

create policy saved_reels_insert_own on public.saved_reels
for insert to authenticated
with check (
  user_id = (select auth.uid())
  and exists (select 1 from public.reels r where r.id = saved_reels.reel_id)
);

create policy saved_reels_delete_own on public.saved_reels
for delete to authenticated
using (user_id = (select auth.uid()));

-- Batch E: messaging reliability, idempotency, and least privilege

alter table public.conversations
  add column if not exists is_deleted boolean not null default false;

alter table public.conversations
  add column if not exists direct_key text;

with pairs as (
  select
    cm.conversation_id,
    string_agg(cm.user_id::text, ':' order by cm.user_id::text) as direct_key
  from public.conversation_members cm
  join public.conversations c
    on c.id = cm.conversation_id
   and c.kind = 'direct'
  group by cm.conversation_id
  having count(*) = 2
)
update public.conversations c
set direct_key = p.direct_key
from pairs p
where c.id = p.conversation_id
  and c.direct_key is null;

drop index if exists public.conversations_direct_key_unique;
create unique index conversations_direct_key_unique
  on public.conversations (direct_key)
  where direct_key is not null and is_deleted = false;

alter table public.messages
  add column if not exists client_message_id uuid;

create unique index if not exists messages_sender_client_message_unique
  on public.messages (sender_id, client_message_id)
  where client_message_id is not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid='public.messages'::regclass
      and conname='messages_body_length'
  ) then
    alter table public.messages
      add constraint messages_body_length
      check (char_length(body) <= 4000);
  end if;
end $$;

revoke all on table
  public.conversations,
  public.conversation_members,
  public.messages,
  public.message_reads
from anon;

revoke insert, update, delete, truncate on table
  public.conversations,
  public.conversation_members,
  public.messages,
  public.message_reads
from authenticated;

grant select on table
  public.conversations,
  public.conversation_members,
  public.messages,
  public.message_reads
to authenticated;
