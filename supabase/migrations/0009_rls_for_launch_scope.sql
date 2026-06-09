-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Phase 2 — RLS rewrite for launch-level scope                             │
-- │                                                                          │
-- │ Replaces the project-only checks on `launches` and `launch_daily` with   │
-- │ the new launch-level helpers from 0008. Also tightens `audit_log` so     │
-- │ operador / cliente cannot read it, and adds policies for the new        │
-- │ `launch_assignments` table.                                              │
-- │                                                                          │
-- │ Untouched on purpose:                                                    │
-- │   - profiles, projects, project_members  → unchanged (project-scope)    │
-- │   - project_integrations / project_secrets → unchanged (Phase 3 will    │
-- │     reconvert integrations to launch scope; secrets stay blinded)       │
-- │   - projections                            → unchanged (project-scope)   │
-- ╰──────────────────────────────────────────────────────────────────────────╯

-- ═══════════════════════════════════════════════════════════════════════════
-- launches
--
-- SELECT  -> has_launch_access(id)     (operador/cliente: only assigned)
-- UPDATE  -> can_edit_launch(id)       (admin all-project + operador-assigned)
-- INSERT  -> can_edit_project(project_id)   admin/superadmin only
-- DELETE  -> can_edit_project(project_id)   admin/superadmin only
--
-- The split between UPDATE (launch-level) and INSERT/DELETE (project-level) is
-- intentional: an operador edits the daily numbers of the launches assigned to
-- them but never creates or deletes a launch.
-- ═══════════════════════════════════════════════════════════════════════════
drop policy if exists launches_select on public.launches;
drop policy if exists launches_insert on public.launches;
drop policy if exists launches_update on public.launches;
drop policy if exists launches_delete on public.launches;

create policy launches_select on public.launches
  for select to authenticated
  using (public.has_launch_access(id));

create policy launches_insert on public.launches
  for insert to authenticated
  with check (public.can_edit_project(project_id));

create policy launches_update on public.launches
  for update to authenticated
  using      (public.can_edit_launch(id))
  with check (public.can_edit_launch(id));

create policy launches_delete on public.launches
  for delete to authenticated
  using (public.can_edit_project(project_id));

-- ═══════════════════════════════════════════════════════════════════════════
-- launch_daily
--
-- Resolution by launch now goes through has_launch_access / can_edit_launch
-- (which themselves resolve to the parent project). The old project_of_launch
-- helper stays defined — nothing else still uses it but removing it is a
-- separate cleanup.
-- ═══════════════════════════════════════════════════════════════════════════
drop policy if exists launch_daily_select on public.launch_daily;
drop policy if exists launch_daily_insert on public.launch_daily;
drop policy if exists launch_daily_update on public.launch_daily;
drop policy if exists launch_daily_delete on public.launch_daily;

create policy launch_daily_select on public.launch_daily
  for select to authenticated
  using (public.has_launch_access(launch_id));

create policy launch_daily_insert on public.launch_daily
  for insert to authenticated
  with check (public.can_edit_launch(launch_id));

create policy launch_daily_update on public.launch_daily
  for update to authenticated
  using      (public.can_edit_launch(launch_id))
  with check (public.can_edit_launch(launch_id));

create policy launch_daily_delete on public.launch_daily
  for delete to authenticated
  using (public.can_edit_launch(launch_id));

-- ═══════════════════════════════════════════════════════════════════════════
-- audit_log
--
-- SELECT becomes admin / analista / superadmin only — operador and cliente
-- never see audit_log rows. INSERT/UPDATE/DELETE stay at can_edit_project
-- (effectively admin+/service-role); the audit_log is normally written by
-- Server Actions running as service-role anyway.
-- ═══════════════════════════════════════════════════════════════════════════
drop policy if exists audit_log_select on public.audit_log;

create policy audit_log_select on public.audit_log
  for select to authenticated
  using (
    public.is_superadmin()
    or exists (
      select 1
      from public.project_members m
      join public.profiles p on p.id = m.user_id
      where m.project_id = audit_log.project_id
        and m.user_id    = auth.uid()
        and p.role in ('admin', 'analista')
    )
  );

-- ═══════════════════════════════════════════════════════════════════════════
-- launch_assignments
--
-- SELECT  -> anyone who can read the parent launch can see who is assigned.
-- WRITE   -> only admin/superadmin on the launch's project assigns users.
--            Operador / analista / cliente never assign.
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.launch_assignments enable row level security;

drop policy if exists launch_assignments_select on public.launch_assignments;
drop policy if exists launch_assignments_insert on public.launch_assignments;
drop policy if exists launch_assignments_update on public.launch_assignments;
drop policy if exists launch_assignments_delete on public.launch_assignments;

create policy launch_assignments_select on public.launch_assignments
  for select to authenticated
  using (public.has_launch_access(launch_id));

create policy launch_assignments_insert on public.launch_assignments
  for insert to authenticated
  with check (public.can_edit_project(public.project_of_launch(launch_id)));

create policy launch_assignments_update on public.launch_assignments
  for update to authenticated
  using      (public.can_edit_project(public.project_of_launch(launch_id)))
  with check (public.can_edit_project(public.project_of_launch(launch_id)));

create policy launch_assignments_delete on public.launch_assignments
  for delete to authenticated
  using (public.can_edit_project(public.project_of_launch(launch_id)));
