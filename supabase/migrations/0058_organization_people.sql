-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Bloque 2 (Kingrow · Financiero) — Capa de identidad de personas          │
-- │                                                                          │
-- │ CONTEXTO / POR QUÉ existe esta tabla                                     │
-- │                                                                          │
-- │ `team_members` (0013) es project-scoped: una fila POR (proyecto, rol).   │
-- │ La misma persona física puede estar como `setter` en Growins Y como     │
-- │ `media_buyer` en Rey Academy — son dos filas distintas. Eso es correcto │
-- │ para el pipeline operativo (comisiones, leaderboard, payouts por        │
-- │ launch), pero rompe para la nómina: no queremos pagarle a "la fila de   │
-- │ team_members X" sino a la PERSONA REAL que trabaja para Kingrow.        │
-- │                                                                          │
-- │ `organization_people` es esa capa: una fila POR persona real,           │
-- │ nivel-org. Payroll (0066) va a FK-ear acá — no a team_members.          │
-- │ `team_members.organization_person_id` (nullable, aditivo) linkea cada   │
-- │ fila operativa de team_member con su persona canónica. Cuando el        │
-- │ operador cargue un team_member, si es alguien que ya trabaja para       │
-- │ Kingrow lo linkea a la persona existente; si no, deja NULL o crea la    │
-- │ persona en el momento.                                                  │
-- │                                                                          │
-- │ CLARIFICACIÓN sobre el guardarraíl "no crear tabla de empleados nueva": │
-- │ ese guardarraíl era para no duplicar setters/closers que ya están en    │
-- │ team_members. Esta tabla NO los duplica — los VINCULA. Es una capa de   │
-- │ identidad, no un catálogo paralelo de empleados.                        │
-- │                                                                          │
-- │ NIVEL ORG. Sigue TEMPLATE de 0052/0053 al pie de la letra:              │
-- │   - RLS habilitada desde creación.                                      │
-- │   - REVOKE ALL from cliente_role explícito.                             │
-- │   - GRANT r/w a authenticated.                                          │
-- │   - Policies vía can_edit_organization.                                 │
-- ╰──────────────────────────────────────────────────────────────────────────╯

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) organization_people — identidad de persona real a nivel org
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.organization_people (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organization(id) on delete restrict,

  full_name          text not null,
  -- Identificador natural (cédula, CUIT, DNI, tax_id — lo que use la org
  -- para desambiguar). Nullable porque en la carga inicial puede no estar
  -- a mano; unique(org, national_id) cuando existe para prevenir duplicados.
  national_id        text,
  email              text,
  phone              text,
  notes              text,

  active             boolean not null default true,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists organization_people_org_idx
  on public.organization_people(organization_id);
create index if not exists organization_people_org_active_idx
  on public.organization_people(organization_id, active);

-- Un mismo national_id no puede repetirse dentro de la misma org. NULLs
-- se permiten repetidos (NULLS DISTINCT default) para no bloquear alta de
-- personas sin doc todavía.
create unique index if not exists organization_people_org_national_id_uniq
  on public.organization_people(organization_id, national_id)
  where national_id is not null;

drop trigger if exists set_updated_at on public.organization_people;
create trigger set_updated_at before update on public.organization_people
  for each row execute function public.set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) team_members.organization_person_id — link opcional
--    Aditivo (nullable). team_members existentes quedan sin link hasta que
--    un admin los mapee a mano; los nuevos pueden setearlo al crear.
--    on delete set null: si se borra la persona canónica, el team_member
--    queda huérfano pero no se pierde el registro operativo.
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.team_members
  add column if not exists organization_person_id uuid
    references public.organization_people(id) on delete set null;

create index if not exists team_members_organization_person_idx
  on public.team_members(organization_person_id)
  where organization_person_id is not null;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3) Frontera org — TEMPLATE de 0052
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.organization_people enable row level security;

revoke all on public.organization_people from public;
revoke all on public.organization_people from cliente_role;

grant select, insert, update, delete on public.organization_people to authenticated;

drop policy if exists organization_people_select on public.organization_people;
create policy organization_people_select on public.organization_people
  for select to authenticated
  using (public.can_edit_organization(organization_id));

drop policy if exists organization_people_insert on public.organization_people;
create policy organization_people_insert on public.organization_people
  for insert to authenticated
  with check (public.can_edit_organization(organization_id));

drop policy if exists organization_people_update on public.organization_people;
create policy organization_people_update on public.organization_people
  for update to authenticated
  using      (public.can_edit_organization(organization_id))
  with check (public.can_edit_organization(organization_id));

drop policy if exists organization_people_delete on public.organization_people;
create policy organization_people_delete on public.organization_people
  for delete to authenticated
  using (public.can_edit_organization(organization_id));
