-- The RPCs raised plain exceptions, which PostgREST returns as HTTP 500: the app couldn't tell
-- "wrong invite code" from "server down". SQLSTATE 'PTxyz' makes PostgREST answer with status xyz.

create or replace function public.join_circle(p_code text, p_display_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare cid uuid;
begin
  if (select auth.uid()) is null then raise sqlstate 'PT401' using message = 'not authenticated'; end if;
  select id into cid from public.circles where invite_code = upper(trim(p_code));
  if cid is null then raise sqlstate 'PT404' using message = 'invalid invite code'; end if;
  insert into public.members (circle_id, user_id, display_name)
  values (cid, (select auth.uid()), trim(p_display_name))
  on conflict (circle_id, user_id) do nothing;
  return cid;
end $$;

create or replace function public.create_circle(p_name text, p_recipient text, p_display_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare cid uuid;
begin
  if (select auth.uid()) is null then raise sqlstate 'PT401' using message = 'not authenticated'; end if;
  insert into public.circles (name, care_recipient, invite_code, created_by)
  values (trim(p_name), trim(p_recipient), private.new_invite_code(), (select auth.uid()))
  returning id into cid;
  insert into public.members (circle_id, user_id, display_name, role)
  values (cid, (select auth.uid()), trim(p_display_name), 'admin');
  return cid;
end $$;

create or replace function public.regenerate_invite(cid uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare code text;
begin
  if not private.is_admin(cid) then raise sqlstate 'PT403' using message = 'only admins can change the invite code'; end if;
  code := private.new_invite_code();
  update public.circles set invite_code = code where id = cid;
  return code;
end $$;
