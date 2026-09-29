-- Ashur owner management: dynamic owner transfer (owner-only)

create unique index if not exists admins_single_active_owner_idx
  on public.admins ((role))
  where role='owner' and active=true;

create or replace function public.admin_transfer_owner(
  p_new_owner uuid,
  p_previous_owner_action text default 'secondary_admin'
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_old_owner uuid;
  v_profile public.profiles%rowtype;
begin
  if p_previous_owner_action not in ('secondary_admin','remove') then
    raise exception 'invalid previous owner action';
  end if;

  select * into v_profile
  from public.profiles
  where id = p_new_owner
    and deleted_at is null
    and coalesce(is_banned,false) = false
    and (banned_until is null or banned_until <= now());

  if not found then
    raise exception 'new owner account is unavailable';
  end if;

  select user_id into v_old_owner
  from public.admins
  where role='owner' and active=true
  order by created_at asc
  limit 1
  for update;

  if v_old_owner = p_new_owner then
    return jsonb_build_object(
      'ok',true,
      'changed',false,
      'old_owner_id',v_old_owner,
      'new_owner_id',p_new_owner
    );
  end if;

  if v_old_owner is not null then
    if p_previous_owner_action = 'remove' then
      delete from public.admins where user_id = v_old_owner;
    else
      update public.admins
      set role='secondary_admin',
          permissions='{}'::jsonb,
          active=true,
          updated_at=now()
      where user_id=v_old_owner;
    end if;
  end if;

  insert into public.admins(user_id,role,permissions,active,created_at,updated_at,last_active_at)
  values (p_new_owner,'owner','{}'::jsonb,true,now(),now(),now())
  on conflict (user_id) do update
  set role='owner',
      permissions='{}'::jsonb,
      active=true,
      updated_at=now(),
      last_active_at=now();

  return jsonb_build_object(
    'ok',true,
    'changed',true,
    'old_owner_id',v_old_owner,
    'new_owner_id',p_new_owner,
    'previous_owner_action',p_previous_owner_action
  );
end;
$$;

revoke all on function public.admin_transfer_owner(uuid,text) from public;
revoke all on function public.admin_transfer_owner(uuid,text) from anon;
revoke all on function public.admin_transfer_owner(uuid,text) from authenticated;
grant execute on function public.admin_transfer_owner(uuid,text) to service_role;
