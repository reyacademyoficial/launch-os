-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Operador puede crear + borrar launches (regla nueva)                     │
-- │                                                                          │
-- │ Antes: launches_insert y launches_delete gateaban por `can_edit_project` │
-- │ (admin/superadmin only). El operador podía editar launches existentes    │
-- │ (`can_edit_launches_in`) pero no crearlos ni borrarlos.                  │
-- │                                                                          │
-- │ Ahora: launches_insert y launches_delete gatean por `can_edit_launches_in`│
-- │ (admin + operador member del proyecto). Semántica más consistente:       │
-- │ "quien edita launches en este proyecto también los crea/borra".          │
-- │                                                                          │
-- │ NO cambia `can_edit_project` en sí — sigue siendo admin+ para lo         │
-- │ project-level (integraciones, project settings, member management).       │
-- ╰──────────────────────────────────────────────────────────────────────────╯

drop policy if exists launches_insert on public.launches;
drop policy if exists launches_delete on public.launches;

create policy launches_insert on public.launches
  for insert to authenticated
  with check (public.can_edit_launches_in(project_id));

create policy launches_delete on public.launches
  for delete to authenticated
  using (public.can_edit_launches_in(project_id));
