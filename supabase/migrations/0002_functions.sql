-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Helpers + triggers                                                       │
-- │                                                                          │
-- │ Three SECURITY DEFINER helpers are the foundation of RLS in 0003. Build │
-- │ every policy on top of these so the permission intent stays centralized. │
-- ╰──────────────────────────────────────────────────────────────────────────╯

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) is_superadmin() — global role check
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.is_superadmin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'superadmin'
  );
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) has_project_access(uuid) — READ permission
--    Superadmin OR any project_members row (regardless of role).
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.has_project_access(p_project_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select public.is_superadmin()
      or exists (
        select 1
        from public.project_members
        where project_id = p_project_id
          and user_id = auth.uid()
      );
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3) can_edit_project(uuid) — WRITE permission
--    Superadmin OR (global role = 'admin' AND member of the project).
--    Cliente NEVER writes.
--
--    NOTE: the functional difference between superadmin and admin is left
--    intentionally collapsed here. When it gets defined, this is THE place to
--    change (along with the mirror in src/lib/auth/permissions.ts).
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.can_edit_project(p_project_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select public.is_superadmin()
      or exists (
        select 1
        from public.project_members m
        join public.profiles p on p.id = m.user_id
        where m.project_id = p_project_id
          and m.user_id = auth.uid()
          and p.role = 'admin'
      );
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4) project_of_launch(uuid) — used by launch_daily policies to resolve the
--    parent project. SECURITY DEFINER so policies can call it without needing
--    a SELECT grant on launches at the user level.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.project_of_launch(p_launch_id uuid)
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select project_id from public.launches where id = p_launch_id;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- handle_new_user — on auth.users INSERT, create the matching profile.
-- Reads `role` from raw_user_meta_data (set by the inviter via service-role).
-- Falls back to 'cliente' if missing or invalid.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  v_role := coalesce(new.raw_user_meta_data->>'role', 'cliente');
  if v_role not in ('superadmin', 'admin', 'cliente') then
    v_role := 'cliente';
  end if;

  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    nullif(new.raw_user_meta_data->>'full_name', ''),
    v_role
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ═══════════════════════════════════════════════════════════════════════════
-- guard_profile_role — anti-escalation. Only superadmin may change `role`.
-- The user can update other fields of their own profile freely.
--
-- Trigger name MUST stay `guard_profile_role`: the pgTAP smoke test disables
-- it by name during seed (`alter table ... disable trigger guard_profile_role`).
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.guard_profile_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is distinct from old.role and not public.is_superadmin() then
    raise exception 'role changes are restricted to superadmin'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_profile_role on public.profiles;
create trigger guard_profile_role
  before update on public.profiles
  for each row execute function public.guard_profile_role();

-- ═══════════════════════════════════════════════════════════════════════════
-- set_updated_at — generic BEFORE UPDATE touch for updated_at columns.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_updated_at on public.profiles;
create trigger set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at on public.projects;
create trigger set_updated_at before update on public.projects
  for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at on public.launches;
create trigger set_updated_at before update on public.launches
  for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at on public.launch_daily;
create trigger set_updated_at before update on public.launch_daily
  for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at on public.project_integrations;
create trigger set_updated_at before update on public.project_integrations
  for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at on public.project_secrets;
create trigger set_updated_at before update on public.project_secrets
  for each row execute function public.set_updated_at();
