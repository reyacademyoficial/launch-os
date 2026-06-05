-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ RLS + policies                                                           │
-- │                                                                          │
-- │ Every policy is built on the SECURITY DEFINER helpers from 0002:        │
-- │   is_superadmin(), has_project_access(), can_edit_project()             │
-- │                                                                          │
-- │ project_secrets gets RLS enabled with ZERO policies on purpose —        │
-- │ blocked for anon/authenticated, only service-role bypasses it.          │
-- ╰──────────────────────────────────────────────────────────────────────────╯

-- ═══════════════════════════════════════════════════════════════════════════
-- Table-level grants. The Supabase default API role is `authenticated`.
-- RLS does the actual filtering — these grants only open the door.
-- `project_secrets` is granted SELECT too so that read attempts return an
-- empty result set (RLS-filtered) instead of a permission-denied error, which
-- matches the "blinded" UX the pgTAP smoke test asserts.
-- ═══════════════════════════════════════════════════════════════════════════
grant usage on schema public to anon, authenticated;

grant select, insert, update, delete on public.profiles             to authenticated;
grant select, insert, update, delete on public.projects             to authenticated;
grant select, insert, update, delete on public.project_members      to authenticated;
grant select, insert, update, delete on public.launches             to authenticated;
grant select, insert, update, delete on public.launch_daily         to authenticated;
grant select, insert, update, delete on public.project_integrations to authenticated;
grant select, insert, update, delete on public.project_secrets      to authenticated;
grant select, insert, update, delete on public.audit_log            to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- profiles
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.profiles enable row level security;

drop policy if exists profiles_select on public.profiles;
drop policy if exists profiles_update on public.profiles;
drop policy if exists profiles_delete on public.profiles;

create policy profiles_select on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_superadmin());

create policy profiles_update on public.profiles
  for update to authenticated
  using      (id = auth.uid() or public.is_superadmin())
  with check (id = auth.uid() or public.is_superadmin());

create policy profiles_delete on public.profiles
  for delete to authenticated
  using (public.is_superadmin());

-- (no INSERT policy — profiles are created by the handle_new_user trigger
--  running as definer; explicit user inserts are blocked.)

-- ═══════════════════════════════════════════════════════════════════════════
-- projects
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.projects enable row level security;

drop policy if exists projects_select on public.projects;
drop policy if exists projects_insert on public.projects;
drop policy if exists projects_update on public.projects;
drop policy if exists projects_delete on public.projects;

create policy projects_select on public.projects
  for select to authenticated
  using (public.has_project_access(id));

-- Only superadmin can create new projects (per spec).
create policy projects_insert on public.projects
  for insert to authenticated
  with check (public.is_superadmin());

create policy projects_update on public.projects
  for update to authenticated
  using      (public.can_edit_project(id))
  with check (public.can_edit_project(id));

create policy projects_delete on public.projects
  for delete to authenticated
  using (public.can_edit_project(id));

-- ═══════════════════════════════════════════════════════════════════════════
-- project_members
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.project_members enable row level security;

drop policy if exists project_members_select on public.project_members;
drop policy if exists project_members_write  on public.project_members;

create policy project_members_select on public.project_members
  for select to authenticated
  using (user_id = auth.uid() or public.is_superadmin());

-- Write membership is superadmin-only for now (opens to admin if/when defined).
create policy project_members_write on public.project_members
  for all to authenticated
  using      (public.is_superadmin())
  with check (public.is_superadmin());

-- ═══════════════════════════════════════════════════════════════════════════
-- launches
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.launches enable row level security;

drop policy if exists launches_select on public.launches;
drop policy if exists launches_insert on public.launches;
drop policy if exists launches_update on public.launches;
drop policy if exists launches_delete on public.launches;

create policy launches_select on public.launches
  for select to authenticated
  using (public.has_project_access(project_id));

create policy launches_insert on public.launches
  for insert to authenticated
  with check (public.can_edit_project(project_id));

create policy launches_update on public.launches
  for update to authenticated
  using      (public.can_edit_project(project_id))
  with check (public.can_edit_project(project_id));

create policy launches_delete on public.launches
  for delete to authenticated
  using (public.can_edit_project(project_id));

-- ═══════════════════════════════════════════════════════════════════════════
-- launch_daily  (project_id resolved via project_of_launch helper)
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.launch_daily enable row level security;

drop policy if exists launch_daily_select on public.launch_daily;
drop policy if exists launch_daily_insert on public.launch_daily;
drop policy if exists launch_daily_update on public.launch_daily;
drop policy if exists launch_daily_delete on public.launch_daily;

create policy launch_daily_select on public.launch_daily
  for select to authenticated
  using (public.has_project_access(public.project_of_launch(launch_id)));

create policy launch_daily_insert on public.launch_daily
  for insert to authenticated
  with check (public.can_edit_project(public.project_of_launch(launch_id)));

create policy launch_daily_update on public.launch_daily
  for update to authenticated
  using      (public.can_edit_project(public.project_of_launch(launch_id)))
  with check (public.can_edit_project(public.project_of_launch(launch_id)));

create policy launch_daily_delete on public.launch_daily
  for delete to authenticated
  using (public.can_edit_project(public.project_of_launch(launch_id)));

-- ═══════════════════════════════════════════════════════════════════════════
-- project_integrations
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.project_integrations enable row level security;

drop policy if exists project_integrations_select on public.project_integrations;
drop policy if exists project_integrations_insert on public.project_integrations;
drop policy if exists project_integrations_update on public.project_integrations;
drop policy if exists project_integrations_delete on public.project_integrations;

create policy project_integrations_select on public.project_integrations
  for select to authenticated
  using (public.has_project_access(project_id));

create policy project_integrations_insert on public.project_integrations
  for insert to authenticated
  with check (public.can_edit_project(project_id));

create policy project_integrations_update on public.project_integrations
  for update to authenticated
  using      (public.can_edit_project(project_id))
  with check (public.can_edit_project(project_id));

create policy project_integrations_delete on public.project_integrations
  for delete to authenticated
  using (public.can_edit_project(project_id));

-- ═══════════════════════════════════════════════════════════════════════════
-- project_secrets — BLINDED. RLS on, ZERO policies. Only service-role passes.
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.project_secrets enable row level security;
-- (intentionally no policies)

-- ═══════════════════════════════════════════════════════════════════════════
-- audit_log
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.audit_log enable row level security;

drop policy if exists audit_log_select on public.audit_log;
drop policy if exists audit_log_insert on public.audit_log;
drop policy if exists audit_log_update on public.audit_log;
drop policy if exists audit_log_delete on public.audit_log;

create policy audit_log_select on public.audit_log
  for select to authenticated
  using (public.has_project_access(project_id));

create policy audit_log_insert on public.audit_log
  for insert to authenticated
  with check (public.can_edit_project(project_id));

create policy audit_log_update on public.audit_log
  for update to authenticated
  using      (public.can_edit_project(project_id))
  with check (public.can_edit_project(project_id));

create policy audit_log_delete on public.audit_log
  for delete to authenticated
  using (public.can_edit_project(project_id));
