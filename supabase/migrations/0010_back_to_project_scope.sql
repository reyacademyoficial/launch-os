-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Phase 2.1 — back to project-scope (walk-back from 0008/0009)            │
-- │                                                                          │
-- │ Decisión 2026-06-09 del stakeholder: la pertenencia a un proyecto da     │
-- │ acceso a TODOS sus lanzamientos. El can_edit deja de ser un flag         │
-- │ asignable y se deriva del rol:                                           │
-- │   - superadmin    → write global                                         │
-- │   - admin         → write en sus proyectos (launches + integraciones)   │
-- │   - operador      → write en launches/daily de sus proyectos            │
-- │   - analista      → read-only                                            │
-- │   - cliente       → read-only                                            │
-- │                                                                          │
-- │ Esto elimina launch_assignments y los helpers per-launch que 0008 y     │
-- │ 0009 introdujeron. is_superadmin / has_project_access / can_edit_project │
-- │ siguen igual. Estamos pre-primer-usuario real, así que el drop es seguro.│
-- │                                                                          │
-- │ Orden importante: las policies de launches/launch_daily dependen de     │
-- │ has_launch_access y can_edit_launch. Hay que dropear las policies        │
-- │ ANTES de dropear las funciones, sino Postgres se queja por dependencia. │
-- ╰──────────────────────────────────────────────────────────────────────────╯

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) Drop policies que dependen de los helpers viejos
--    (launches y launch_daily se rehacen abajo; launch_assignments se va con
--    la tabla)
-- ═══════════════════════════════════════════════════════════════════════════
drop policy if exists launches_select on public.launches;
drop policy if exists launches_insert on public.launches;
drop policy if exists launches_update on public.launches;
drop policy if exists launches_delete on public.launches;

drop policy if exists launch_daily_select on public.launch_daily;
drop policy if exists launch_daily_insert on public.launch_daily;
drop policy if exists launch_daily_update on public.launch_daily;
drop policy if exists launch_daily_delete on public.launch_daily;

drop policy if exists launch_assignments_select on public.launch_assignments;
drop policy if exists launch_assignments_insert on public.launch_assignments;
drop policy if exists launch_assignments_update on public.launch_assignments;
drop policy if exists launch_assignments_delete on public.launch_assignments;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) Drop tabla launch_assignments — ya sin policies que la apunten
-- ═══════════════════════════════════════════════════════════════════════════
drop table if exists public.launch_assignments cascade;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3) Drop helpers per-launch — ya sin policies que los referencien
-- ═══════════════════════════════════════════════════════════════════════════
drop function if exists public.has_launch_access(uuid);
drop function if exists public.can_edit_launch(uuid);

-- ═══════════════════════════════════════════════════════════════════════════
-- 4) Nuevo helper para writes en launches/launch_daily
--    SECURITY DEFINER + stable, mismo patrón que los demás. Devuelve true si:
--      - el caller es superadmin, O
--      - es miembro del proyecto con rol admin u operador.
--    Analista y cliente son siempre read-only acá.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.can_edit_launches_in(p_project_id uuid)
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
          and m.user_id    = auth.uid()
          and p.role in ('admin', 'operador')
      );
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5) RLS de launches → vuelve a project-scope con el split admin/operador
--
-- SELECT  → has_project_access(project_id)        (cualquier miembro lee)
-- INSERT  → can_edit_project(project_id)          (admin/superadmin crea)
-- UPDATE  → can_edit_launches_in(project_id)      (admin + operador editan)
-- DELETE  → can_edit_project(project_id)          (admin/superadmin borra)
-- ═══════════════════════════════════════════════════════════════════════════
create policy launches_select on public.launches
  for select to authenticated
  using (public.has_project_access(project_id));

create policy launches_insert on public.launches
  for insert to authenticated
  with check (public.can_edit_project(project_id));

create policy launches_update on public.launches
  for update to authenticated
  using      (public.can_edit_launches_in(project_id))
  with check (public.can_edit_launches_in(project_id));

create policy launches_delete on public.launches
  for delete to authenticated
  using (public.can_edit_project(project_id));

-- ═══════════════════════════════════════════════════════════════════════════
-- 6) RLS de launch_daily → mismo patrón, resolviendo el project_id vía el
--    helper project_of_launch que ya existe (0002).
-- ═══════════════════════════════════════════════════════════════════════════
create policy launch_daily_select on public.launch_daily
  for select to authenticated
  using (public.has_project_access(public.project_of_launch(launch_id)));

create policy launch_daily_insert on public.launch_daily
  for insert to authenticated
  with check (public.can_edit_launches_in(public.project_of_launch(launch_id)));

create policy launch_daily_update on public.launch_daily
  for update to authenticated
  using      (public.can_edit_launches_in(public.project_of_launch(launch_id)))
  with check (public.can_edit_launches_in(public.project_of_launch(launch_id)));

create policy launch_daily_delete on public.launch_daily
  for delete to authenticated
  using (public.can_edit_launches_in(public.project_of_launch(launch_id)));

-- audit_log policy de 0009 (admin/analista/superadmin lectura) queda intacta.
-- project_integrations, project_secrets, projections, projects, profiles,
-- project_members: sin cambios — siguen en project_scope con can_edit_project.
