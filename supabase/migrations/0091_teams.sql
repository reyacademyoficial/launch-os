-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Bloque 5 (Kingrow · Operaciones) — Equipos internos                      │
-- │                                                                          │
-- │ Un `team` = agrupación de personas de la org bajo una etiqueta común     │
-- │ (ej. "Producto", "Growth", "Media Buying", "Comercial"). Uso: filtros    │
-- │ de tareas, distribución de trabajo, reportes de carga por equipo.        │
-- │                                                                          │
-- │ DIFERENCIA con `team_members` (0013):                                    │
-- │ - `team_members` (project-scope) = fila operativa POR (proyecto, rol)   │
-- │   de LaunchOS. Cada empresa gestionada tiene sus setters/closers/etc.   │
-- │ - `teams` (org-scope) = agrupación INTERNA de Kingrow. La persona real  │
-- │   (`organization_people`) puede pertenecer a varios teams a la vez.     │
-- │   No hay solapamiento — son dos niveles distintos de tenancy.           │
-- │                                                                          │
-- │ MEMBRESÍA                                                                │
-- │ - `team_membership` es la tabla puente. `organization_person_id` no es  │
-- │   nullable — no tiene sentido una membresía sin persona.                 │
-- │ - `role_in_team` es TEXTO libre (Lead, Contributor, Owner… lo decide    │
-- │   el operador). Sin CHECK porque cada equipo va a inventarse el suyo.   │
-- │ - Unique parcial `(team_id, organization_person_id) where active=true`  │
-- │   permite historial de membresías inactivas (ej. persona que salió y    │
-- │   volvió) sin bloquear alta.                                             │
-- │                                                                          │
-- │ FK behavior:                                                             │
-- │ - team_id on delete cascade: si borran el team, cae la membresía.       │
-- │ - organization_person_id on delete cascade: si borran la persona,       │
-- │   cae la membresía (link puro, no tiene sentido histórico).             │
-- │                                                                          │
-- │ NIVEL ORG — TEMPLATE de 0052/0053.                                       │
-- ╰──────────────────────────────────────────────────────────────────────────╯

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) teams
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.teams (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references public.organization(id) on delete restrict,

  name                  text not null,
  description           text,
  active                boolean not null default true,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists teams_org_idx
  on public.teams(organization_id);
create index if not exists teams_org_active_idx
  on public.teams(organization_id, active);

-- Unique por nombre dentro de la org (para equipos activos). Historial de
-- teams inactivos con mismo nombre está OK — permite renombrar/reciclar.
create unique index if not exists teams_org_name_active_uniq
  on public.teams(organization_id, lower(name))
  where active = true;

drop trigger if exists set_updated_at on public.teams;
create trigger set_updated_at before update on public.teams
  for each row execute function public.set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) team_membership — tabla puente
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.team_membership (
  id                       uuid primary key default gen_random_uuid(),
  organization_id          uuid not null references public.organization(id) on delete restrict,

  team_id                  uuid not null references public.teams(id)               on delete cascade,
  organization_person_id   uuid not null references public.organization_people(id) on delete cascade,

  role_in_team             text,
  joined_at                date not null default current_date,
  left_at                  date,
  active                   boolean not null default true,

  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create index if not exists team_membership_org_idx
  on public.team_membership(organization_id);
create index if not exists team_membership_team_idx
  on public.team_membership(team_id);
create index if not exists team_membership_person_idx
  on public.team_membership(organization_person_id);

-- Una persona puede estar como miembro ACTIVO del mismo team una sola vez.
-- Inactivos coexisten para preservar historial.
create unique index if not exists team_membership_team_person_active_uniq
  on public.team_membership(team_id, organization_person_id)
  where active = true;

drop trigger if exists set_updated_at on public.team_membership;
create trigger set_updated_at before update on public.team_membership
  for each row execute function public.set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- Frontera org — TEMPLATE de 0052 (aplicada a las 2 tablas)
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.teams            enable row level security;
alter table public.team_membership  enable row level security;

revoke all on public.teams            from public;
revoke all on public.teams            from cliente_role;
revoke all on public.team_membership  from public;
revoke all on public.team_membership  from cliente_role;

grant select, insert, update, delete on public.teams            to authenticated;
grant select, insert, update, delete on public.team_membership  to authenticated;

-- teams policies
drop policy if exists teams_select on public.teams;
create policy teams_select on public.teams
  for select to authenticated
  using (public.can_edit_organization(organization_id));

drop policy if exists teams_insert on public.teams;
create policy teams_insert on public.teams
  for insert to authenticated
  with check (public.can_edit_organization(organization_id));

drop policy if exists teams_update on public.teams;
create policy teams_update on public.teams
  for update to authenticated
  using      (public.can_edit_organization(organization_id))
  with check (public.can_edit_organization(organization_id));

drop policy if exists teams_delete on public.teams;
create policy teams_delete on public.teams
  for delete to authenticated
  using (public.can_edit_organization(organization_id));

-- team_membership policies
drop policy if exists team_membership_select on public.team_membership;
create policy team_membership_select on public.team_membership
  for select to authenticated
  using (public.can_edit_organization(organization_id));

drop policy if exists team_membership_insert on public.team_membership;
create policy team_membership_insert on public.team_membership
  for insert to authenticated
  with check (public.can_edit_organization(organization_id));

drop policy if exists team_membership_update on public.team_membership;
create policy team_membership_update on public.team_membership
  for update to authenticated
  using      (public.can_edit_organization(organization_id))
  with check (public.can_edit_organization(organization_id));

drop policy if exists team_membership_delete on public.team_membership;
create policy team_membership_delete on public.team_membership
  for delete to authenticated
  using (public.can_edit_organization(organization_id));
