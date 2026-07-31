-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Bloque 5 (Kingrow · Operaciones) — Checklists                            │
-- │                                                                          │
-- │ Lista de sub-ítems chequeables. Cuelga XOR de una `task` o de un        │
-- │ `internal_project`, nunca de ambos ni de ninguno. Uso típico:           │
-- │   - Tarea "Onboardear cliente nuevo" con checklist de 8 pasos.          │
-- │   - Proyecto interno "Rediseño web" con checklist de hitos macro.       │
-- │                                                                          │
-- │ XOR se enforza con CHECK a nivel DB — no depende del app-code. Si un    │
-- │ INSERT viola el XOR (ambos NULL o ambos con valor), rebota.             │
-- │                                                                          │
-- │ MODELO                                                                    │
-- │ - `checklists(task_id NULL, internal_project_id NULL, title)` + XOR.   │
-- │   on delete cascade en ambos parents: si borran task o project, cae la │
-- │   checklist (es sub-estructura pura, no tiene sentido histórico solo). │
-- │ - `checklist_items(checklist_id, content, done, position)`. `position` │
-- │   int para orden explícito — sin partial unique (dos ítems pueden      │
-- │   compartir posición, el orden es best-effort para UI).                │
-- │                                                                          │
-- │ NIVEL ORG — TEMPLATE de 0052/0053. `checklist_items.organization_id`   │
-- │ es aditivo (denormalizado) para que la policy filtre sin JOIN — mismo  │
-- │ patrón que 0045 denorm project_id en payments.                          │
-- ╰──────────────────────────────────────────────────────────────────────────╯

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) checklists
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.checklists (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null references public.organization(id) on delete restrict,

  -- XOR entre estos dos: exactamente uno debe ser NOT NULL.
  task_id                uuid references public.tasks(id)              on delete cascade,
  internal_project_id    uuid references public.internal_projects(id)  on delete cascade,

  title                  text not null,

  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  constraint checklists_xor_parent check (
    (task_id is not null and internal_project_id is null)
    or (task_id is null and internal_project_id is not null)
  )
);

create index if not exists checklists_org_idx
  on public.checklists(organization_id);
create index if not exists checklists_task_idx
  on public.checklists(task_id) where task_id is not null;
create index if not exists checklists_project_idx
  on public.checklists(internal_project_id) where internal_project_id is not null;

drop trigger if exists set_updated_at on public.checklists;
create trigger set_updated_at before update on public.checklists
  for each row execute function public.set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) checklist_items
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.checklist_items (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null references public.organization(id) on delete restrict,

  checklist_id           uuid not null references public.checklists(id) on delete cascade,

  content                text not null,
  done                   boolean not null default false,
  position               integer not null default 0,
  done_at                timestamptz,

  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index if not exists checklist_items_org_idx
  on public.checklist_items(organization_id);
create index if not exists checklist_items_checklist_idx
  on public.checklist_items(checklist_id, position);
create index if not exists checklist_items_open_idx
  on public.checklist_items(checklist_id) where done = false;

drop trigger if exists set_updated_at on public.checklist_items;
create trigger set_updated_at before update on public.checklist_items
  for each row execute function public.set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- Frontera org — TEMPLATE de 0052 (aplicada a las 2 tablas)
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.checklists       enable row level security;
alter table public.checklist_items  enable row level security;

revoke all on public.checklists       from public;
revoke all on public.checklists       from cliente_role;
revoke all on public.checklist_items  from public;
revoke all on public.checklist_items  from cliente_role;

grant select, insert, update, delete on public.checklists       to authenticated;
grant select, insert, update, delete on public.checklist_items  to authenticated;

-- checklists policies
drop policy if exists checklists_select on public.checklists;
create policy checklists_select on public.checklists
  for select to authenticated
  using (public.can_edit_organization(organization_id));

drop policy if exists checklists_insert on public.checklists;
create policy checklists_insert on public.checklists
  for insert to authenticated
  with check (public.can_edit_organization(organization_id));

drop policy if exists checklists_update on public.checklists;
create policy checklists_update on public.checklists
  for update to authenticated
  using      (public.can_edit_organization(organization_id))
  with check (public.can_edit_organization(organization_id));

drop policy if exists checklists_delete on public.checklists;
create policy checklists_delete on public.checklists
  for delete to authenticated
  using (public.can_edit_organization(organization_id));

-- checklist_items policies
drop policy if exists checklist_items_select on public.checklist_items;
create policy checklist_items_select on public.checklist_items
  for select to authenticated
  using (public.can_edit_organization(organization_id));

drop policy if exists checklist_items_insert on public.checklist_items;
create policy checklist_items_insert on public.checklist_items
  for insert to authenticated
  with check (public.can_edit_organization(organization_id));

drop policy if exists checklist_items_update on public.checklist_items;
create policy checklist_items_update on public.checklist_items
  for update to authenticated
  using      (public.can_edit_organization(organization_id))
  with check (public.can_edit_organization(organization_id));

drop policy if exists checklist_items_delete on public.checklist_items;
create policy checklist_items_delete on public.checklist_items
  for delete to authenticated
  using (public.can_edit_organization(organization_id));
