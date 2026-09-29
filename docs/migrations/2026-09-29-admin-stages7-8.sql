-- Ashur Admin stages 7-8
-- Stage 7 uses the existing admins.permissions jsonb model.
-- Stage 8 adds storage counters and retry metadata for upload operations.

alter table public.storage_channels
  add column if not exists files_count bigint not null default 0,
  add column if not exists bytes_total bigint not null default 0,
  add column if not exists last_error text not null default '',
  add column if not exists last_health_at timestamptz;

alter table public.storage_channels
  drop constraint if exists storage_channels_status_check;

alter table public.storage_channels
  add constraint storage_channels_status_check
  check (status in ('connected','disabled','error','checking'));

alter table public.upload_jobs
  add column if not exists mime_type text not null default '',
  add column if not exists sha256 text not null default '',
  add column if not exists failure_stage text not null default '',
  add column if not exists retry_available boolean not null default false,
  add column if not exists retry_expires_at timestamptz,
  add column if not exists attempt_count integer not null default 1,
  add column if not exists last_retry_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.upload_jobs'::regclass
      and conname='upload_jobs_attempt_count_check'
  ) then
    alter table public.upload_jobs
      add constraint upload_jobs_attempt_count_check check (attempt_count >= 1);
  end if;
end $$;

create index if not exists upload_jobs_retryable_idx
  on public.upload_jobs(retry_expires_at)
  where retry_available = true;

create index if not exists upload_jobs_status_created_idx
  on public.upload_jobs(status, created_at desc);

create index if not exists upload_jobs_user_created_idx
  on public.upload_jobs(user_id, created_at desc)
  where user_id is not null;

create index if not exists upload_jobs_kind_created_idx
  on public.upload_jobs(kind, created_at desc);

create or replace function private.refresh_storage_channel_counters()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  old_key text;
  new_key text;
begin
  if tg_op <> 'INSERT' then old_key := old.channel_key; end if;
  if tg_op <> 'DELETE' then new_key := new.channel_key; end if;

  if old_key is not null then
    update public.storage_channels sc
       set files_count = coalesce((
             select count(*) from public.media_objects m
             where m.channel_key = old_key and m.status = 'ready'
           ),0),
           bytes_total = coalesce((
             select sum(m.size_bytes) from public.media_objects m
             where m.channel_key = old_key and m.status = 'ready'
           ),0)
     where sc.channel_key = old_key;
  end if;

  if new_key is not null and new_key is distinct from old_key then
    update public.storage_channels sc
       set files_count = coalesce((
             select count(*) from public.media_objects m
             where m.channel_key = new_key and m.status = 'ready'
           ),0),
           bytes_total = coalesce((
             select sum(m.size_bytes) from public.media_objects m
             where m.channel_key = new_key and m.status = 'ready'
           ),0)
     where sc.channel_key = new_key;
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_refresh_storage_channel_counters on public.media_objects;
create trigger trg_refresh_storage_channel_counters
after insert or delete or update of channel_key,size_bytes,status
on public.media_objects
for each row
execute function private.refresh_storage_channel_counters();

revoke all on function private.refresh_storage_channel_counters() from public;
revoke all on function private.refresh_storage_channel_counters() from anon;
revoke all on function private.refresh_storage_channel_counters() from authenticated;

update public.storage_channels sc
set files_count = coalesce((
      select count(*) from public.media_objects m
      where m.channel_key=sc.channel_key and m.status='ready'
    ),0),
    bytes_total = coalesce((
      select sum(m.size_bytes) from public.media_objects m
      where m.channel_key=sc.channel_key and m.status='ready'
    ),0);
