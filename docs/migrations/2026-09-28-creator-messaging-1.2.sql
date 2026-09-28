-- ASHUR 1.2 creator/messaging enhancements
-- Applied to Supabase project pwpjrwcynnicexrmunkd on 2026-09-28.

alter table public.profiles
  add column if not exists saved_visibility text not null default 'private';

alter table public.reels
  add column if not exists cover_media_id uuid references public.media_objects(id) on delete set null;

alter table public.stories
  add column if not exists overlay_text text not null default '',
  add column if not exists overlay_color text not null default '#FFFFFF',
  add column if not exists overlay_y numeric not null default 0.5,
  add column if not exists overlay_bg boolean not null default true,
  add column if not exists shared_type text,
  add column if not exists shared_id uuid;

alter table public.messages
  add column if not exists shared_type text,
  add column if not exists shared_id uuid;

create index if not exists reels_cover_media_idx on public.reels(cover_media_id) where cover_media_id is not null;
create index if not exists messages_shared_idx on public.messages(shared_type,shared_id) where shared_id is not null;
create index if not exists stories_shared_idx on public.stories(shared_type,shared_id) where shared_id is not null;
