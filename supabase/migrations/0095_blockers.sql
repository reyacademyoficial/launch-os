-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Bloque 5 (Kingrow · Operaciones) — Bloqueos                              │
-- │                                                                          │
-- │ Bloqueo sobre una `task` o un `internal_project`. XOR estricto — nunca  │
-- │ ambos ni ninguno. Uso típico:                                            │
-- │   - Tarea "Publicar página" bloqueada por "falta copy final".           │
-- │   - Proyecto interno "Migración stack" bloqueado por "cliente no       │
-- │     define fecha de corte".                                             │
-- │                                                                          │
-- │ Múltiples bloqueos por tarea/proyecto son válidos (varios frentes       │
-- │ bloqueados simultáneamente) — no hay unique constraint.                 │
-- │                                                                          │
-- │ MODELO                                                                    │
-- │ - XOR (task_id, internal_project_id) enforzado por CHECK.               │
-- │ - `reason` NOT NULL — un bloqueo sin motivo es inútil. Texto libre.    │
-- │ - `opened_at` default now(); `resolved_at` NULL = bloqueo activo.       │
-- │ - `resolved_by` → organization_people (quién lo levantó). Nullable.    │
-- │ - Tanto task_id como internal_project_id: on delete cascade. Si muere │
-- │   el objeto bloqueado, el bloqueo pierde sentido.                       │
-- │                                                                          │
-- │ RELACIÓN con tasks.status='blocked': independientes por diseño. El     │
-- │ app-code puede sincronizar (crear blocker → poner status blocked), pero│
-- │ no lo forzamos con trigger. Motivo: a veces se registra un bloqueo     │
-- │ informativo sin cambiar el estado operativo de la tarea (ej. "esperando│
-- │ feedback pero seguimos avanzando").                                     │
-- │                                                                          │
-- │ NIVEL ORG — TEMPLATE de 0052/0053.                                       │
-- ╰──────────────────────────────────────────────────────────────────────────╯

create table if not exists public.blockers (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null references public.organization(id) on delete restrict,

  -- XOR: exactamente uno debe ser NOT NULL.
  task_id                uuid references public.tasks(id)              on delete cascade,
  internal_project_id    uuid references public.internal_projects(id)  on delete cascade,

  reason                 text not null,
  opened_at              timestamptz not null default now(),
  resolved_at            timestamptz,
  resolved_by            uuid references public.organization_people(id) on delete set null,

  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  constraint blockers_xor_parent check (
    (task_id is not null and internal_project_id is null)
    or (task_id is null and internal_project_id is not null)
  ),

  -- No podés registrar QUIÉN resolvió si el bloqueo no está resuelto.
  -- Al revés sí: resolver sin registrar quién (resolved_at NOT NULL,
  -- resolved_by NULL) es válido — no siempre se sabe/recuerda.
  constraint blockers_resolved_by_requires_resolved_at check (
    resolved_at is not null or resolved_by is null
  )
);

create index if not exists blockers_org_idx
  on public.blockers(organization_id);
create index if not exists blockers_org_open_idx
  on public.blockers(organization_id) where resolved_at is null;
create index if not exists blockers_task_idx
  on public.blockers(task_id) where task_id is not null;
create index if not exists blockers_project_idx
  on public.blockers(internal_project_id) where internal_project_id is not null;
create index if not exists blockers_resolved_by_idx
  on public.blockers(resolved_by) where resolved_by is not null;

drop trigger if exists set_updated_at on public.blockers;
create trigger set_updated_at before update on public.blockers
  for each row execute function public.set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- Frontera org — TEMPLATE de 0052
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.blockers enable row level security;

revoke all on public.blockers from public;
revoke all on public.blockers from cliente_role;

grant select, insert, update, delete on public.blockers to authenticated;

drop policy if exists blockers_select on public.blockers;
create policy blockers_select on public.blockers
  for select to authenticated
  using (public.can_edit_organization(organization_id));

drop policy if exists blockers_insert on public.blockers;
create policy blockers_insert on public.blockers
  for insert to authenticated
  with check (public.can_edit_organization(organization_id));

drop policy if exists blockers_update on public.blockers;
create policy blockers_update on public.blockers
  for update to authenticated
  using      (public.can_edit_organization(organization_id))
  with check (public.can_edit_organization(organization_id));

drop policy if exists blockers_delete on public.blockers;
create policy blockers_delete on public.blockers
  for delete to authenticated
  using (public.can_edit_organization(organization_id));
