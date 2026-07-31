-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Rollback de la migración 0101 (banks + bank_movements org-scope)         │
-- │                                                                          │
-- │ CUÁNDO USAR                                                              │
-- │   Post-deploy de 0101, si aparece un problema y hay que volver al        │
-- │   estado anterior. Correr MANUALMENTE en Studio — no forma parte del    │
-- │   pipeline de migraciones y no se ejecuta con `supabase db push` ni     │
-- │   equivalente.                                                           │
-- │                                                                          │
-- │ QUÉ HACE                                                                 │
-- │   1. Restaura `banks.project_id` desde `_backup_banks_project_id_0101`. │
-- │   2. Vuelve `project_id` a NOT NULL (estado original de 0044).          │
-- │   3. Elimina el UNIQUE `banks_organization_id_name_key` y recrea el    │
-- │      UNIQUE original por (project_id, name).                            │
-- │   4. Revierte RLS de banks y bank_movements a project-scope             │
-- │      (has_project_access / project_of_bank).                           │
-- │                                                                          │
-- │ REQUISITOS PRE-ROLLBACK                                                 │
-- │   - La tabla `_backup_banks_project_id_0101` debe existir con datos.   │
-- │   - NO haber creado bancos nuevos post-0101 con `project_id=null` que   │
-- │     no puedan restaurarse. Si hay, el paso 2 (SET NOT NULL) va a       │
-- │     fallar; hay que decidir a qué proyecto asignarlos o borrarlos      │
-- │     antes de correr este script.                                       │
-- │   - Los `bank_movements` no se tocan — su `organization_id` sigue       │
-- │     válido, solo cambia el gate RLS.                                    │
-- │                                                                          │
-- │ PASO 1 DEL ROLLBACK — verificar viabilidad                              │
-- │   Corré esta query ANTES de aplicar el rollback:                        │
-- │                                                                          │
-- │     select id, name from public.banks                                   │
-- │      where project_id is null                                           │
-- │        and id not in (select bank_id                                    │
-- │                         from public._backup_banks_project_id_0101);    │
-- │                                                                          │
-- │   Si devuelve filas, son bancos creados DESPUÉS de 0101 sin project.   │
-- │   El rollback no puede restaurarlos automáticamente. Decidir manual.   │
-- ╰──────────────────────────────────────────────────────────────────────────╯

begin;

-- ─── 1) Restaurar project_id desde el backup ─────────────────────────────
update public.banks b
   set project_id = bkp.project_id_before
  from public._backup_banks_project_id_0101 bkp
 where b.id = bkp.bank_id
   and b.project_id is null;

-- Guard: si quedaron bancos con project_id NULL post-restore, abortar.
-- Son bancos creados DESPUÉS de 0101 sin proyecto — no se pueden restaurar
-- automáticamente. El humano tiene que resolver antes de reintentar.
do $$
declare
  v_orphans int;
begin
  select count(*) into v_orphans
    from public.banks
   where project_id is null;
  if v_orphans > 0 then
    raise exception 'ROLLBACK ABORTADO: % bancos con project_id NULL no tienen fila en el backup. Resolvé asignándoles proyecto o borrándolos antes de reintentar.', v_orphans;
  end if;
end $$;

-- ─── 2) Volver project_id a NOT NULL (estado original de 0044) ───────────
alter table public.banks
  alter column project_id set not null;

-- ─── 3) Revertir constraints UNIQUE ──────────────────────────────────────
alter table public.banks
  drop constraint if exists banks_organization_id_name_key;
alter table public.banks
  drop constraint if exists banks_project_id_name_key;
alter table public.banks
  add  constraint banks_project_id_name_key
  unique (project_id, name);

-- ─── 4) Revertir RLS de banks a project-scope (estado de 0044) ────────────
drop policy if exists banks_select on public.banks;
create policy banks_select on public.banks
  for select to authenticated
  using (public.has_project_access(project_id));

drop policy if exists banks_insert on public.banks;
create policy banks_insert on public.banks
  for insert to authenticated
  with check (public.can_edit_project(project_id));

drop policy if exists banks_update on public.banks;
create policy banks_update on public.banks
  for update to authenticated
  using      (public.can_edit_project(project_id))
  with check (public.can_edit_project(project_id));

drop policy if exists banks_delete on public.banks;
create policy banks_delete on public.banks
  for delete to authenticated
  using (public.can_edit_project(project_id));

-- ─── 5) Revertir RLS de bank_movements a project-scope ───────────────────
drop policy if exists bank_movements_select on public.bank_movements;
create policy bank_movements_select on public.bank_movements
  for select to authenticated
  using (public.has_project_access(public.project_of_bank(bank_id)));

drop policy if exists bank_movements_insert on public.bank_movements;
create policy bank_movements_insert on public.bank_movements
  for insert to authenticated
  with check (public.can_edit_project(public.project_of_bank(bank_id)));

drop policy if exists bank_movements_update on public.bank_movements;
create policy bank_movements_update on public.bank_movements
  for update to authenticated
  using      (public.can_edit_project(public.project_of_bank(bank_id)))
  with check (public.can_edit_project(public.project_of_bank(bank_id)));

drop policy if exists bank_movements_delete on public.bank_movements;
create policy bank_movements_delete on public.bank_movements
  for delete to authenticated
  using (public.can_edit_project(public.project_of_bank(bank_id)));

-- ─── 6) Revertir comentario de deprecation ───────────────────────────────
comment on function public.project_of_bank(uuid) is null;

-- La tabla `_backup_banks_project_id_0101` se conserva. Cuando el rollback
-- esté validado y quede claro que no hace falta re-restaurar, borrarla con
-- `drop table public._backup_banks_project_id_0101;`.

commit;

-- ═══════════════════════════════════════════════════════════════════════════
-- POST-ROLLBACK — validación
-- ═══════════════════════════════════════════════════════════════════════════
-- Correr esta query para confirmar que todos los bancos volvieron a tener
-- project_id y que el UNIQUE está en su lugar original:
--
--   select count(*) filter (where project_id is null) as sin_proyecto,
--          count(*) filter (where project_id is not null) as con_proyecto
--     from public.banks;
--
--   select conname from pg_constraint
--    where conrelid = 'public.banks'::regclass
--      and contype = 'u';
--
-- Y verificar que un operador (rol distinto a superadmin) recupera acceso
-- a banks de su proyecto — el gate anterior era has_project_access.
