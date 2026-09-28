-- ASHUR stage 4: profile identity limits
-- Applied to Supabase on 2026-09-28.

alter table public.profiles drop constraint if exists profiles_name_length;
alter table public.profiles add constraint profiles_name_length
  check (char_length(trim(name)) between 1 and 30);

alter table public.profiles drop constraint if exists profiles_bio_length;
alter table public.profiles add constraint profiles_bio_length
  check (char_length(bio) <= 150);

alter table public.profiles drop constraint if exists profiles_username_format;
alter table public.profiles add constraint profiles_username_format
  check (username is null or username ~ '^[a-z0-9_.]{2,10}$');

create or replace function public.claim_username(p_username text, p_name text)
returns profiles
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
declare
  v_uid uuid := auth.uid();
  v_profile public.profiles;
  v_username text := lower(trim(p_username));
  v_name text := trim(p_name);
begin
  if v_uid is null then
    raise exception 'غير مصرح';
  end if;
  if v_username !~ '^[a-z0-9_.]{2,10}$' then
    raise exception 'اسم المستخدم غير صالح';
  end if;
  if char_length(v_name) < 1 or char_length(v_name) > 30 then
    raise exception 'الاسم غير صالح';
  end if;

  update public.profiles
     set username = v_username,
         name = v_name,
         updated_at = now()
   where id = v_uid
   returning * into v_profile;

  if v_profile.id is null then
    raise exception 'الحساب غير موجود';
  end if;
  return v_profile;
exception
  when unique_violation then
    raise exception 'اسم المستخدم مستخدم';
end;
$$;
