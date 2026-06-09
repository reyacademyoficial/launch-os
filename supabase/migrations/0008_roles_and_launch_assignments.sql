-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Phase 2 — 5 roles + launch-level assignments                             │
-- │                                                                          │
-- │ This migration is schema + helpers only. RLS changes ride on these in    │
-- │ 0009. Together they replace the project-only permission model with one   │
-- │ that scopes operador/cliente down to specific launches while admin and   │
-- │ analista still see their whole project.                                  │
-- │                                                                          │
-- │ Pertenencia: every non-superadmin has a project_members row (defines the │
-- │ project). The new launch_assignments table is the extra scoping layer    │
-- │ that admin/analista do not need (they see all launches in their project) │
-- │ but operador and cliente do.                                             │
-- ╰──────────────────────────────────────────────────────────────────────────╯

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) Extend profiles.role to 5 values
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.profiles
  drop constraint if exists profiles_role_check;

alter table public.profiles
  add constraint profiles_role_check
  check (role in ('superadmin', 'admin', 'operador', 'analista', 'cliente'));

-- handle_new_user (defined in 0002) had the old 3-value whitelist hard-coded.
-- Without this update, invitations setting role to 'operador' or 'analista'
-- would silently fall back to 'cliente'. Replace the function in place.
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
  if v_role not in ('superadmin', 'admin', 'operador', 'analista', 'cliente') then
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

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) launch_assignments — per-launch scoping for operador / cliente
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.launch_assignments (
  id          uuid primary key default gen_random_uuid(),
  launch_id   uuid not null references public.launches(id)  on delete cascade,
  user_id     uuid not null references public.profiles(id)  on delete cascade,
  can_edit    boolean not null default false,
  created_at  timestamptz not null default now(),
  unique (launch_id, user_id)
);

create index if not exists launch_assignments_user_idx
  on public.launch_assignments(user_id);

create index if not exists launch_assignments_launch_idx
  on public.launch_assignments(launch_id);

grant select, insert, update, delete on public.launch_assignments to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3) Launch-level helpers (SECURITY DEFINER, mirror project-level ones)
-- ═══════════════════════════════════════════════════════════════════════════

-- READ on a single launch. Returns true when the caller can see this launch:
--   - superadmin always
--   - admin / analista that belong to the launch's project (project-wide read)
--   - operador / cliente assigned to this specific launch
create or replace function public.has_launch_access(p_launch_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  with l as (
    select project_id from public.launches where id = p_launch_id
  )
  select public.is_superadmin()
      or exists (
        select 1
        from public.project_members m
        join public.profiles p on p.id = m.user_id
        join l                  on l.project_id = m.project_id
        where m.user_id = auth.uid()
          and p.role in ('admin', 'analista')
      )
      or exists (
        select 1
        from public.launch_assignments a
        where a.launch_id = p_launch_id
          and a.user_id   = auth.uid()
      );
$$;

-- WRITE on the daily data of a single launch (NOT create / delete of the
-- launch itself — that stays at project level on can_edit_project):
--   - superadmin always
--   - admin that belongs to the launch's project
--   - operador assigned to this specific launch WITH can_edit = true
-- analista and cliente never get true here.
create or replace function public.can_edit_launch(p_launch_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  with l as (
    select project_id from public.launches where id = p_launch_id
  )
  select public.is_superadmin()
      or exists (
        select 1
        from public.project_members m
        join public.profiles p on p.id = m.user_id
        join l                  on l.project_id = m.project_id
        where m.user_id = auth.uid()
          and p.role = 'admin'
      )
      or exists (
        select 1
        from public.launch_assignments a
        join public.profiles p on p.id = a.user_id
        where a.launch_id = p_launch_id
          and a.user_id   = auth.uid()
          and p.role      = 'operador'
          and a.can_edit  = true
      );
$$;
