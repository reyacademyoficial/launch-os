-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Bloque 5 (Kingrow · Operaciones) — Proyectos internos de la agencia      │
-- │                                                                          │
-- │ ⚠️  COLISIÓN DE NOMBRE — LEER ANTES DE TOCAR ⚠️                         │
-- │                                                                          │
-- │ `public.projects` (0001, project-scope LaunchOS) = una empresa GESTIONADA│
-- │   por Kingrow (Growins, Rey Academy, cliente externo…). Ahí viven leads, │
-- │   sales, payments, comisiones. NO SE TOCA.                               │
-- │                                                                          │
-- │ `public.internal_projects` (esta tabla, org-scope Kingrow) = una         │
-- │   iniciativa INTERNA de la agencia (rediseño web, migración de stack,    │
-- │   contratación de closer nuevo, campaña de marca…). Nada que ver con    │
-- │   los lanzamientos de clientes.                                          │
-- │                                                                          │
-- │ La distinción vive en el nombre. Nunca reusar `projects` para esto y     │
-- │ nunca reusar `internal_projects` para empresas gestionadas.              │
-- │                                                                          │
-- │ MODELO                                                                    │
-- │                                                                          │
-- │ - `owner_id` → `organization_people` (identidad canónica de persona real │
-- │   nivel org, 0058). NO team_members (esa es project-scope). on delete    │
-- │   set null: si borran la persona, el proyecto queda huérfano pero no se │
-- │   pierde el registro.                                                    │
-- │ - `status` acotado: {backlog,active,paused,done,archived}. Ciclo típico │
-- │   backlog → active → done|archived; paused es pausa reversible.         │
-- │ - `priority` acotado: {low,med,high,urgent}.                             │
-- │ - `starts_on` / `due_on` / `closed_at` — fechas opcionales para plan.   │
-- │                                                                          │
-- │ NIVEL ORG — TEMPLATE de 0052/0053. RLS + REVOKE cliente_role +          │
-- │ policies vía can_edit_organization. Sin grant a cliente_role. Nunca      │
-- │ has_project_access acá (es otro nivel de tenancy).                       │
-- ╰──────────────────────────────────────────────────────────────────────────╯

create table if not exists public.internal_projects (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references public.organization(id) on delete restrict,

  name                  text not null,
  description           text,

  status                text not null default 'backlog' check (status in (
    'backlog', 'active', 'paused', 'done', 'archived'
  )),
  priority              text not null default 'med' check (priority in (
    'low', 'med', 'high', 'urgent'
  )),

  -- Persona canónica dueña del proyecto interno. Nullable — puede no estar
  -- asignada al crear. on delete set null: preserva histórico si borran la
  -- persona (mismo criterio que team_members.organization_person_id en 0058).
  owner_id              uuid references public.organization_people(id) on delete set null,

  starts_on             date,
  due_on                date,
  closed_at             timestamptz,

  notes                 text,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists internal_projects_org_idx
  on public.internal_projects(organization_id);
create index if not exists internal_projects_org_status_idx
  on public.internal_projects(organization_id, status);
create index if not exists internal_projects_org_open_due_idx
  on public.internal_projects(organization_id, due_on)
  where closed_at is null and status not in ('done', 'archived');
create index if not exists internal_projects_owner_idx
  on public.internal_projects(owner_id) where owner_id is not null;

drop trigger if exists set_updated_at on public.internal_projects;
create trigger set_updated_at before update on public.internal_projects
  for each row execute function public.set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- Frontera org — TEMPLATE de 0052
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.internal_projects enable row level security;

revoke all on public.internal_projects from public;
revoke all on public.internal_projects from cliente_role;

grant select, insert, update, delete on public.internal_projects to authenticated;

drop policy if exists internal_projects_select on public.internal_projects;
create policy internal_projects_select on public.internal_projects
  for select to authenticated
  using (public.can_edit_organization(organization_id));

drop policy if exists internal_projects_insert on public.internal_projects;
create policy internal_projects_insert on public.internal_projects
  for insert to authenticated
  with check (public.can_edit_organization(organization_id));

drop policy if exists internal_projects_update on public.internal_projects;
create policy internal_projects_update on public.internal_projects
  for update to authenticated
  using      (public.can_edit_organization(organization_id))
  with check (public.can_edit_organization(organization_id));

drop policy if exists internal_projects_delete on public.internal_projects;
create policy internal_projects_delete on public.internal_projects
  for delete to authenticated
  using (public.can_edit_organization(organization_id));
