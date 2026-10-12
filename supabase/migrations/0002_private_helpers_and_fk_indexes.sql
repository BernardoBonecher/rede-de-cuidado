-- Follow-up to the Supabase advisors on 0001.
--
-- Security: the membership helpers used inside policies don't need to be callable through the API.
-- Move them to a schema that PostgREST does not expose. create_circle, join_circle and
-- regenerate_invite stay in public on purpose: they are the app's API and check the caller inside.
--
-- Performance: index the composite foreign keys.

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create function private.is_member(cid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.members m where m.circle_id = cid and m.user_id = (select auth.uid()));
$$;

create function private.is_admin(cid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.members m
                 where m.circle_id = cid and m.user_id = (select auth.uid()) and m.role = 'admin');
$$;

create function private.new_invite_code()
returns text language sql volatile set search_path = '' as $$
  select string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 1 + floor(random() * 31)::int, 1), '')
  from generate_series(1, 8);
$$;

revoke execute on all functions in schema private from public, anon;
grant execute on function private.is_member, private.is_admin to authenticated;

-- point policies at the private helpers
alter policy "members read their circle" on public.circles using (private.is_member(id));
alter policy "admins update their circle" on public.circles
  using (private.is_admin(id)) with check (private.is_admin(id));
alter policy "members see each other" on public.members using (private.is_member(circle_id));
alter policy "leave or be removed by an admin" on public.members
  using (user_id = (select auth.uid()) or private.is_admin(circle_id));
alter policy "members manage shifts" on public.shifts
  using (private.is_member(circle_id)) with check (private.is_member(circle_id));
alter policy "members manage tasks" on public.tasks
  using (private.is_member(circle_id)) with check (private.is_member(circle_id));
alter policy "members manage medications" on public.medications
  using (private.is_member(circle_id)) with check (private.is_member(circle_id));
alter policy "members read doses" on public.dose_logs using (private.is_member(circle_id));
alter policy "members log doses as themselves" on public.dose_logs
  with check (private.is_member(circle_id) and given_by = (select auth.uid()));

create or replace function public.create_circle(p_name text, p_recipient text, p_display_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare cid uuid;
begin
  if (select auth.uid()) is null then raise exception 'not authenticated'; end if;
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
  if not private.is_admin(cid) then raise exception 'only admins can change the invite code'; end if;
  code := private.new_invite_code();
  update public.circles set invite_code = code where id = cid;
  return code;
end $$;

drop function public.is_member(uuid);
drop function public.is_admin(uuid);
drop function public.new_invite_code();

create index circles_created_by_idx on public.circles (created_by);
create index dose_logs_given_by_idx on public.dose_logs (circle_id, given_by);
create index dose_logs_medication_idx on public.dose_logs (medication_id, circle_id);
create index shifts_user_idx on public.shifts (circle_id, user_id);
create index tasks_assignee_idx on public.tasks (circle_id, assignee);
create index tasks_done_by_idx on public.tasks (circle_id, done_by);
