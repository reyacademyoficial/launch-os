-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ 0140 — internal_project_owners: M2M owners para proyectos internos      │
-- │                                                                          │
-- │ Notion permite N personas por page. `internal_projects.owner_id` era    │
-- │ una FK simple → obligaba a elegir un único responsable y descartar el   │
-- │ resto en el sync. Reemplazamos por junction table many-to-many.         │
-- │                                                                          │
-- │ SHAPE                                                                    │
-- │   internal_project_owners(                                              │
-- │     internal_project_id, person_id, organization_id                     │
-- │   )                                                                     │
-- │   PK compuesto (project, person) — misma persona no puede aparecer 2x   │
-- │   en el mismo proyecto. `organization_id` redundante para RLS directa. │
-- │                                                                          │
-- │ ON DELETE                                                                │
-- │   project_id CASCADE — si desaparece el proyecto, sus owners tampoco   │
-- │                        tienen sentido.                                   │
-- │   person_id  CASCADE — si desaparece la persona, sale del proyecto.    │
-- │                        (Notion sync la re-agrega si vuelve a estar).   │
-- │                                                                          │
-- │ BACKFILL                                                                 │
-- │   Copiamos internal_projects.owner_id (los NOT NULL) a la junction     │
-- │   antes de dropear la columna.                                          │
-- │                                                                          │
-- │ IMPACTO EN APP                                                           │
-- │   - Sync Notion: persiste TODOS los responsables mapeados.             │
-- │   - Form nativo: multi-select en vez de dropdown único.                │
-- │   - Mi Jornada: filtro "mío" via EXISTS en la junction.                │
-- ╰──────────────────────────────────────────────────────────────────────────╯

-- ─── 1) Tabla junction ─────────────────────────────────────────────────────
create table if not exists public.internal_project_owners (
  internal_project_id uuid not null
    references public.internal_projects(id) on delete cascade,
  person_id           uuid not null
    references public.organization_people(id) on delete cascade,
  organization_id     uuid not null
    references public.organization(id) on delete restrict,
  created_at          timestamptz not null default now(),

  primary key (internal_project_id, person_id)
);

create index if not exists internal_project_owners_person_idx
  on public.internal_project_owners(person_id);
create index if not exists internal_project_owners_project_idx
  on public.internal_project_owners(internal_project_id);
create index if not exists internal_project_owners_org_idx
  on public.internal_project_owners(organization_id);

-- ─── 2) Backfill desde owner_id existente ──────────────────────────────────
insert into public.internal_project_owners
  (internal_project_id, person_id, organization_id)
select ip.id, ip.owner_id, ip.organization_id
from public.internal_projects ip
where ip.owner_id is not null
on conflict do nothing;

-- ─── 3) Drop columna vieja ──────────────────────────────────────────────────
-- Antes: dropear el índice parcial que la referenciaba.
drop index if exists public.internal_projects_owner_idx;
alter table public.internal_projects drop column if exists owner_id;

-- ─── 4) RLS ────────────────────────────────────────────────────────────────
alter table public.internal_project_owners enable row level security;

revoke all on public.internal_project_owners from public;
revoke all on public.internal_project_owners from cliente_role;
grant select, insert, update, delete on public.internal_project_owners to authenticated;

drop policy if exists internal_project_owners_select on public.internal_project_owners;
create policy internal_project_owners_select on public.internal_project_owners
  for select to authenticated
  using (public.can_edit_organization(organization_id));

drop policy if exists internal_project_owners_insert on public.internal_project_owners;
create policy internal_project_owners_insert on public.internal_project_owners
  for insert to authenticated
  with check (public.can_edit_organization(organization_id));

drop policy if exists internal_project_owners_update on public.internal_project_owners;
create policy internal_project_owners_update on public.internal_project_owners
  for update to authenticated
  using      (public.can_edit_organization(organization_id))
  with check (public.can_edit_organization(organization_id));

drop policy if exists internal_project_owners_delete on public.internal_project_owners;
create policy internal_project_owners_delete on public.internal_project_owners
  for delete to authenticated
  using (public.can_edit_organization(organization_id));
