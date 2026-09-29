-- ASHUR admin stages 11-12: releases + runtime settings control
-- Additive and backward-compatible.

alter table public.app_releases
  add column if not exists sha256 text not null default '',
  add column if not exists update_message text not null default '',
  add column if not exists updated_by uuid references auth.users(id) on delete set null,
  add column if not exists published_by uuid references auth.users(id) on delete set null,
  add column if not exists updated_at timestamptz not null default now();

create index if not exists app_releases_status_code_idx
  on public.app_releases(status, version_code desc);
create index if not exists app_releases_updated_by_idx
  on public.app_releases(updated_by);
create index if not exists app_releases_published_by_idx
  on public.app_releases(published_by);

create table if not exists public.app_settings_history (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references auth.users(id) on delete set null,
  source text not null default 'admin',
  reason text not null default '',
  snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists app_settings_history_created_idx
  on public.app_settings_history(created_at desc);
create index if not exists app_settings_history_actor_idx
  on public.app_settings_history(actor_user_id);

alter table public.app_settings_history enable row level security;

revoke all on table public.app_settings_history from anon, authenticated;
grant select, insert, update, delete on table public.app_settings_history to service_role;

revoke all on table public.app_releases from anon, authenticated;
grant select, insert, update, delete on table public.app_releases to service_role;

insert into public.app_settings_history(actor_user_id, source, reason, snapshot)
select
  null,
  'migration',
  'لقطة الإعدادات قبل تفعيل المرحلتين 11 و12',
  coalesce(jsonb_object_agg(key, value), '{}'::jsonb)
from public.app_settings
where public_read = true
and not exists (
  select 1 from public.app_settings_history where source='migration'
);
