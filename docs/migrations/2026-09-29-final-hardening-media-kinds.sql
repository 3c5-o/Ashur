-- Ashur final hardening after stages 1-14

alter table public.media_objects
  drop constraint if exists media_objects_kind_check;

alter table public.media_objects
  add constraint media_objects_kind_check
  check (kind = any (array[
    'profile'::text,
    'profile_cover'::text,
    'post_image'::text,
    'post_video'::text,
    'reel'::text,
    'reel_cover'::text,
    'story'::text,
    'chat_image'::text,
    'chat_video'::text,
    'chat_audio'::text,
    'chat_file'::text,
    'group_media'::text,
    'file'::text,
    'backup'::text
  ]));

create index if not exists content_mentions_mentioned_by_idx
  on public.content_mentions(mentioned_by);
