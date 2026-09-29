-- Ashur admin stages 13-14: official site control + append-only audit log

alter table public.audit_logs
  add column if not exists actor_role text,
  add column if not exists actor_name text,
  add column if not exists actor_username text;

create index if not exists audit_logs_created_desc_idx
  on public.audit_logs(created_at desc);
create index if not exists audit_logs_action_created_idx
  on public.audit_logs(action, created_at desc);
create index if not exists audit_logs_target_created_idx
  on public.audit_logs(target_type, created_at desc);
create index if not exists audit_logs_actor_created_idx
  on public.audit_logs(actor_user_id, created_at desc);
create index if not exists audit_logs_role_created_idx
  on public.audit_logs(actor_role, created_at desc);

update public.audit_logs l
set
  actor_role = coalesce(l.actor_role, a.role),
  actor_name = coalesce(l.actor_name, p.name),
  actor_username = coalesce(l.actor_username, p.username)
from public.profiles p
left join public.admins a on a.user_id = p.id
where l.actor_user_id = p.id
  and (l.actor_role is null or l.actor_name is null or l.actor_username is null);

create or replace function private.prevent_audit_log_delete()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  raise exception 'audit_logs is append-only: deletion is not allowed';
end;
$$;

drop trigger if exists audit_logs_no_delete on public.audit_logs;
create trigger audit_logs_no_delete
before delete on public.audit_logs
for each row execute function private.prevent_audit_log_delete();

revoke all on function private.prevent_audit_log_delete() from public;
grant execute on function private.prevent_audit_log_delete() to service_role;

insert into public.site_settings(key,value)
values
  ('features', '{"items":[{"title":"المنشورات","description":"شارك الصور والفيديو والنصوص مع التفاعل والحفظ والمشاركة.","enabled":true},{"title":"الريلز","description":"فيديو عمودي سريع مع التفاعل والمشاهدة السلسة.","enabled":true},{"title":"القصص","description":"شارك لحظاتك لمدة 24 ساعة.","enabled":true},{"title":"الرسائل","description":"محادثات خاصة ومجموعات وتنبيهات فورية.","enabled":true},{"title":"الخصوصية","description":"حساب عام أو خاص وتحكم بطلبات المتابعة.","enabled":true},{"title":"هوية آشور","description":"واجهة عربية موحدة بتصميم آشور.","enabled":true}]}'::jsonb),
  ('update', '{"text":"","label":"آخر تحديث"}'::jsonb),
  ('support', '{"url":"","email":"","label":"الدعم والمساعدة"}'::jsonb),
  ('legal', '{"privacy_url":"","terms_url":""}'::jsonb)
on conflict (key) do nothing;
