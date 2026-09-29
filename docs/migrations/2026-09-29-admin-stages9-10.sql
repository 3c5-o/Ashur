-- ASHUR admin stages 9-10: system observability + notification center
-- Additive and backward-compatible.

alter table public.system_errors
  add column if not exists severity text not null default 'error',
  add column if not exists fingerprint text not null default '',
  add column if not exists occurrence_count integer not null default 1,
  add column if not exists first_seen_at timestamptz,
  add column if not exists last_seen_at timestamptz,
  add column if not exists resolved_by uuid references auth.users(id) on delete set null,
  add column if not exists resolution_note text not null default '',
  add column if not exists updated_at timestamptz not null default now();

update public.system_errors
set first_seen_at = coalesce(first_seen_at, created_at),
    last_seen_at = coalesce(last_seen_at, created_at),
    updated_at = coalesce(updated_at, created_at)
where first_seen_at is null or last_seen_at is null;

create index if not exists system_errors_service_status_last_seen_idx
  on public.system_errors(service, status, last_seen_at desc);
create index if not exists system_errors_severity_status_last_seen_idx
  on public.system_errors(severity, status, last_seen_at desc);
create index if not exists system_errors_fingerprint_open_idx
  on public.system_errors(fingerprint, last_seen_at desc)
  where status <> 'resolved' and fingerprint <> '';

create table if not exists public.admin_notification_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  title text not null default '',
  body text not null default '',
  audience text not null default 'all',
  deep_link jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists admin_notification_templates_enabled_updated_idx
  on public.admin_notification_templates(enabled, updated_at desc);

alter table public.admin_notification_history
  add column if not exists target_user_ids jsonb not null default '[]'::jsonb,
  add column if not exists recipient_count integer not null default 0,
  add column if not exists failure_count integer not null default 0,
  add column if not exists template_id uuid references public.admin_notification_templates(id) on delete set null,
  add column if not exists cancelled_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

create index if not exists admin_notification_history_status_schedule_idx
  on public.admin_notification_history(status, scheduled_at);
create index if not exists admin_notification_history_audience_created_idx
  on public.admin_notification_history(audience, created_at desc);

alter table public.admin_notification_templates enable row level security;

revoke all on table public.admin_notification_templates from anon, authenticated;
grant select, insert, update, delete on table public.admin_notification_templates to service_role;

revoke all on table public.system_errors from anon, authenticated;
grant select, insert, update, delete on table public.system_errors to service_role;

revoke all on table public.admin_notification_history from anon, authenticated;
grant select, insert, update, delete on table public.admin_notification_history to service_role;
