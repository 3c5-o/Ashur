-- ASHUR 1.2 bot administration and alerts
-- Applied to Supabase project pwpjrwcynnicexrmunkd on 2026-09-28.

create table if not exists public.bot_admins (
  telegram_user_id text primary key,
  role text not null default 'moderator',
  permissions jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  added_by_telegram_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists bot_admins_active_role_idx
  on public.bot_admins(active, role);

alter table public.bot_admins enable row level security;

alter table public.system_errors
  add column if not exists bot_alerted_at timestamptz;

create index if not exists system_errors_unalerted_idx
  on public.system_errors(created_at desc)
  where status='new' and bot_alerted_at is null;
