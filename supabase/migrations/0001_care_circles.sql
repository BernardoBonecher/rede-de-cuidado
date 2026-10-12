-- Rede de Cuidado: shared care of an older relative by a small family group (a "circle").
--
-- Security model: every row belongs to a circle, and Row Level Security only lets members of that
-- circle read or write it. Circles and memberships are created through two functions
-- (create_circle, join_circle) instead of direct inserts, so nobody can add themselves to a circle
-- without its invite code.

-- ---------- tables ----------

create table public.circles (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  care_recipient text not null check (char_length(care_recipient) between 1 and 80),
  invite_code text not null unique,
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.members (
  circle_id uuid not null references public.circles (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 40),
  role text not null default 'member' check (role in ('admin', 'member')),
  joined_at timestamptz not null default now(),
  primary key (circle_id, user_id)
);
create index members_user_idx on public.members (user_id);

-- Who covers each part of the day. One row per (circle, day, period); user_id null = nobody yet.
create table public.shifts (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null references public.circles (id) on delete cascade,
  day date not null,
  period text not null check (period in ('manha', 'tarde', 'noite')),
  user_id uuid,
  note text check (char_length(note) <= 200),
  unique (circle_id, day, period),
  -- the person covering must be a member of the same circle
  foreign key (circle_id, user_id) references public.members (circle_id, user_id) on delete set null (user_id)
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null references public.circles (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  due_at timestamptz,
  assignee uuid,
  done_at timestamptz,
  done_by uuid,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  foreign key (circle_id, assignee) references public.members (circle_id, user_id) on delete set null (assignee),
  foreign key (circle_id, done_by) references public.members (circle_id, user_id) on delete set null (done_by),
  check ((done_at is null) = (done_by is null))
);
create index tasks_circle_idx on public.tasks (circle_id, done_at, due_at);

create table public.medications (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null references public.circles (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  dose text not null check (char_length(dose) between 1 and 60),
  times time[] not null check (cardinality(times) between 1 and 8),
  instructions text check (char_length(instructions) <= 200),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (id, circle_id)   -- target for the composite key below
);
create index medications_circle_idx on public.medications (circle_id) where active;

-- One row per dose actually given. The unique key is the product rule: a scheduled dose can be
-- marked as given only once, so two relatives can't both give the same dose.
create table public.dose_logs (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null,
  medication_id uuid not null,
  day date not null,
  slot time not null,
  given_at timestamptz not null default now(),
  given_by uuid default auth.uid(),   -- null only after that person left the circle; history stays
  unique (medication_id, day, slot),
  foreign key (medication_id, circle_id) references public.medications (id, circle_id) on delete cascade,
  foreign key (circle_id, given_by) references public.members (circle_id, user_id) on delete set null (given_by)
);
create index dose_logs_circle_day_idx on public.dose_logs (circle_id, day);

-- ---------- membership helpers ----------

-- security definer so policies on members can call it without recursing into members' own policy
create function public.is_member(cid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.members m where m.circle_id = cid and m.user_id = (select auth.uid()));
$$;

create function public.is_admin(cid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.members m
                 where m.circle_id = cid and m.user_id = (select auth.uid()) and m.role = 'admin');
$$;

-- 8 characters from an alphabet without look-alikes (no 0/O, 1/I/L)
create function public.new_invite_code()
returns text language sql volatile set search_path = '' as $$
  select string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 1 + floor(random() * 31)::int, 1), '')
  from generate_series(1, 8);
$$;

create function public.create_circle(p_name text, p_recipient text, p_display_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare cid uuid;
begin
  if (select auth.uid()) is null then raise exception 'not authenticated'; end if;
  insert into public.circles (name, care_recipient, invite_code, created_by)
  values (trim(p_name), trim(p_recipient), public.new_invite_code(), (select auth.uid()))
  returning id into cid;
  insert into public.members (circle_id, user_id, display_name, role)
  values (cid, (select auth.uid()), trim(p_display_name), 'admin');
  return cid;
end $$;

create function public.join_circle(p_code text, p_display_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare cid uuid;
begin
  if (select auth.uid()) is null then raise exception 'not authenticated'; end if;
  select id into cid from public.circles where invite_code = upper(trim(p_code));
  if cid is null then raise exception 'invalid invite code' using errcode = 'P0002'; end if;
  insert into public.members (circle_id, user_id, display_name)
  values (cid, (select auth.uid()), trim(p_display_name))
  on conflict (circle_id, user_id) do nothing;
  return cid;
end $$;

create function public.regenerate_invite(cid uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare code text;
begin
  if not public.is_admin(cid) then raise exception 'only admins can change the invite code'; end if;
  code := public.new_invite_code();
  update public.circles set invite_code = code where id = cid;
  return code;
end $$;

revoke execute on function public.create_circle, public.join_circle, public.regenerate_invite,
  public.is_member, public.is_admin, public.new_invite_code from public, anon;
grant execute on function public.create_circle, public.join_circle, public.regenerate_invite,
  public.is_member, public.is_admin to authenticated;

-- ---------- row level security ----------

alter table public.circles enable row level security;
alter table public.members enable row level security;
alter table public.shifts enable row level security;
alter table public.tasks enable row level security;
alter table public.medications enable row level security;
alter table public.dose_logs enable row level security;

-- circles: members read; admins rename. Creation only through create_circle.
create policy "members read their circle" on public.circles
  for select to authenticated using (public.is_member(id));
create policy "admins update their circle" on public.circles
  for update to authenticated using (public.is_admin(id)) with check (public.is_admin(id));

-- members: see the people in your circles; change your own name; leave, or be removed by an admin.
-- Only display_name is updatable (column privilege), so nobody can promote themselves to admin.
revoke update on public.members from anon, authenticated;
grant update (display_name) on public.members to authenticated;
create policy "members see each other" on public.members
  for select to authenticated using (public.is_member(circle_id));
create policy "members rename themselves" on public.members
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "leave or be removed by an admin" on public.members
  for delete to authenticated using (user_id = (select auth.uid()) or public.is_admin(circle_id));

-- day-to-day data: any member can read and write; nobody outside the circle can see it.
create policy "members manage shifts" on public.shifts
  for all to authenticated using (public.is_member(circle_id)) with check (public.is_member(circle_id));
create policy "members manage tasks" on public.tasks
  for all to authenticated using (public.is_member(circle_id)) with check (public.is_member(circle_id));
create policy "members manage medications" on public.medications
  for all to authenticated using (public.is_member(circle_id)) with check (public.is_member(circle_id));

create policy "members read doses" on public.dose_logs
  for select to authenticated using (public.is_member(circle_id));
create policy "members log doses as themselves" on public.dose_logs
  for insert to authenticated with check (public.is_member(circle_id) and given_by = (select auth.uid()));
create policy "undo your own dose log" on public.dose_logs
  for delete to authenticated using (given_by = (select auth.uid()));

-- ---------- realtime: relatives see each other's changes without reloading ----------

alter publication supabase_realtime add table public.shifts, public.tasks, public.medications, public.dose_logs;
