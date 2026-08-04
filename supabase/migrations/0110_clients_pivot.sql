-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Bloque 3.5 (Kingrow · Clientes) — Modelo cliente-céntrico               │
-- │                                                                          │
-- │ REFACTOR SEMÁNTICO. El CLIENTE (empresa B2B externa que contrata a      │
-- │ Kingrow) pasa a ser entidad de primer orden. Antes:                     │
-- │                                                                          │
-- │   project → cliente implícito (business_name texto libre en projects)   │
-- │                                                                          │
-- │ Ahora:                                                                   │
-- │                                                                          │
-- │   client → tiene N projects; los datos de relación (tickets, renewals,  │
-- │   upsells, nps, health) cuelgan del CLIENTE, no del project.            │
-- │                                                                          │
-- │ DESTRUCTIVA POR DECISIÓN — las 5 tablas de bloque 3 están en 0 filas    │
-- │ (Studio, 2026-08-04). Dropear project_id y agregar client_id NOT NULL   │
-- │ es seguro. Con datos habría que backfillear — no aplica hoy y nunca va  │
-- │ a haber una ventana tan barata para hacerlo bien.                       │
-- │                                                                          │
-- │ TICKETS es la excepción: client_id NOT NULL + project_id NULLABLE.      │
-- │ Un ticket puede ser cross-project ("reunión de coordinación") o         │
-- │ específico ("campaña de Maratón G7 rota"). El trigger valida que si     │
-- │ project_id está seteado, el project pertenece al mismo cliente que el  │
-- │ ticket — imposible que un ticket del cliente A referencie un project    │
-- │ del cliente B.                                                          │
-- │                                                                          │
-- │ PROJECTS.client_id: nullable. Un project puede existir sin cliente     │
-- │ (proyecto interno, o project heredado de LaunchOS sin mapear). Al       │
-- │ construir la ficha del cliente se muestran los projects con             │
-- │ client_id = ese cliente.                                                 │
-- │                                                                          │
-- │ CASCADAS:                                                                │
-- │   - Borrar cliente → cascade a health/nps/renewals/upsells/tickets      │
-- │     del cliente. El project sobrevive con client_id=null (histórico     │
-- │     de LaunchOS no se pierde).                                          │
-- │   - Borrar project → NO borra tickets (project_id pasa a null; el       │
-- │     ticket sigue vivo atado al cliente). Antes era CASCADE; se cambia   │
-- │     a SET NULL para no destruir histórico de tickets cross-project si   │
-- │     alguna vez se borra un launch.                                      │
-- ╰──────────────────────────────────────────────────────────────────────────╯

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) clients — entidad principal
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.clients (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organization(id) on delete restrict,

  -- Nombre principal del cliente. Se muestra en listados y fichas. Puede
  -- ser el nombre comercial (marca) o la razón social — la elige el
  -- operador al crear.
  name              text not null,

  -- Razón social opcional. Si se factura al cliente, va en la invoice.
  -- Nullable porque no todos los clientes son personas jurídicas (algunos
  -- son PF/monotributistas y usan el mismo name).
  business_name     text,

  -- Industria libre (ecommerce, gastronomía, coach). Sirve para segmentar
  -- reportes; texto libre para no atarnos a un enum que hay que ampliar.
  industry          text,

  notes             text,
  active            boolean not null default true,

  created_by        uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- Unicidad por (org, nombre normalizado) SOLO en clientes activos.
-- Un cliente reactivado con mismo nombre que uno archivado es OK — no se
-- pisa el histórico. lower() elimina duplicados por typo de mayúsculas.
create unique index if not exists clients_org_name_unique
  on public.clients(organization_id, lower(name))
  where active;

create index if not exists clients_org_active_idx
  on public.clients(organization_id, active);

drop trigger if exists set_updated_at on public.clients;
create trigger set_updated_at before update on public.clients
  for each row execute function public.set_updated_at();

-- RLS — TEMPLATE de 0058 (org-scope, sin cliente_role).
alter table public.clients enable row level security;

revoke all on public.clients from public;
revoke all on public.clients from cliente_role;

grant select, insert, update, delete on public.clients to authenticated;

drop policy if exists clients_select on public.clients;
create policy clients_select on public.clients
  for select to authenticated
  using (public.can_edit_organization(organization_id));

drop policy if exists clients_insert on public.clients;
create policy clients_insert on public.clients
  for insert to authenticated
  with check (public.can_edit_organization(organization_id));

drop policy if exists clients_update on public.clients;
create policy clients_update on public.clients
  for update to authenticated
  using      (public.can_edit_organization(organization_id))
  with check (public.can_edit_organization(organization_id));

drop policy if exists clients_delete on public.clients;
create policy clients_delete on public.clients
  for delete to authenticated
  using (public.can_edit_organization(organization_id));

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) projects.client_id — nullable
--
-- Nullable: un project puede existir sin cliente asignado (interno, o
-- heredado de LaunchOS sin mapear). Cuando el operador lo asocia desde la
-- ficha del cliente, se popula.
--
-- on delete set null: si se borra un cliente, los projects sobreviven
-- huérfanos — LaunchOS no pierde nada.
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.projects
  add column if not exists client_id uuid
    references public.clients(id) on delete set null;

create index if not exists projects_client_idx
  on public.projects(client_id)
  where client_id is not null;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3) project_health — pivot a client_id
--
-- Antes: 1 fila por project (unique project_id). Ahora: 1 fila por CLIENTE
-- (unique client_id). La salud es de la RELACIÓN, no de un launch puntual.
-- Si el cliente tiene 3 projects, hay 1 health que los cubre.
-- ═══════════════════════════════════════════════════════════════════════════
drop trigger if exists set_org_from_project on public.project_health;
drop function if exists public.project_health_set_org_from_project();

alter table public.project_health
  drop constraint if exists project_health_project_id_fkey;
alter table public.project_health
  drop constraint if exists project_health_project_id_key;

drop index if exists project_health_org_idx;
drop index if exists project_health_status_idx;

alter table public.project_health
  drop column if exists project_id;

alter table public.project_health
  add column client_id uuid not null references public.clients(id) on delete cascade;

alter table public.project_health
  add constraint project_health_client_unique unique (client_id);

create index if not exists project_health_org_idx
  on public.project_health(organization_id);
create index if not exists project_health_status_idx
  on public.project_health(organization_id, relationship_status);

create or replace function public.project_health_set_org_from_client()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  select c.organization_id into new.organization_id
    from public.clients c
   where c.id = new.client_id;
  return new;
end;
$$;

drop trigger if exists set_org_from_client on public.project_health;
create trigger set_org_from_client
  before insert or update of client_id on public.project_health
  for each row execute function public.project_health_set_org_from_client();

-- ═══════════════════════════════════════════════════════════════════════════
-- 4) nps_responses — pivot a client_id
-- ═══════════════════════════════════════════════════════════════════════════
drop trigger if exists set_org_from_project on public.nps_responses;
drop function if exists public.nps_responses_set_org_from_project();

alter table public.nps_responses
  drop constraint if exists nps_responses_project_id_fkey;

drop index if exists nps_responses_project_idx;

alter table public.nps_responses
  drop column if exists project_id;

alter table public.nps_responses
  add column client_id uuid not null references public.clients(id) on delete cascade;

create index if not exists nps_responses_client_idx
  on public.nps_responses(client_id, responded_at desc);

create or replace function public.nps_responses_set_org_from_client()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  select c.organization_id into new.organization_id
    from public.clients c
   where c.id = new.client_id;
  return new;
end;
$$;

drop trigger if exists set_org_from_client on public.nps_responses;
create trigger set_org_from_client
  before insert or update of client_id on public.nps_responses
  for each row execute function public.nps_responses_set_org_from_client();

-- ═══════════════════════════════════════════════════════════════════════════
-- 5) renewals — pivot a client_id
--
-- El contrato de gestión es CON EL CLIENTE, no con un launch. Si el
-- cliente renueva 2026, es 1 renewal cross-projects. Los detalles de qué
-- projects cubre van en notes.
-- ═══════════════════════════════════════════════════════════════════════════
drop trigger if exists set_org_from_project on public.renewals;
drop function if exists public.renewals_set_org_from_project();

alter table public.renewals
  drop constraint if exists renewals_project_id_fkey;

drop index if exists renewals_project_idx;
drop index if exists renewals_org_period_idx;

alter table public.renewals
  drop column if exists project_id;

alter table public.renewals
  add column client_id uuid not null references public.clients(id) on delete cascade;

create index if not exists renewals_client_idx
  on public.renewals(client_id, period_start desc);
create index if not exists renewals_org_period_idx
  on public.renewals(organization_id, period_end desc);

create or replace function public.renewals_set_org_from_client()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  select c.organization_id into new.organization_id
    from public.clients c
   where c.id = new.client_id;
  return new;
end;
$$;

drop trigger if exists set_org_from_client on public.renewals;
create trigger set_org_from_client
  before insert or update of client_id on public.renewals
  for each row execute function public.renewals_set_org_from_client();

-- ═══════════════════════════════════════════════════════════════════════════
-- 6) upsells — pivot a client_id
--
-- Igual criterio: la venta adicional es AL CLIENTE. "Vendí un módulo nuevo
-- a Empresa X" — no importa a qué launch específico se atribuye.
-- ═══════════════════════════════════════════════════════════════════════════
drop trigger if exists set_org_from_project on public.upsells;
drop function if exists public.upsells_set_org_from_project();

alter table public.upsells
  drop constraint if exists upsells_project_id_fkey;

drop index if exists upsells_project_idx;
drop index if exists upsells_org_cobrada_idx;

alter table public.upsells
  drop column if exists project_id;

alter table public.upsells
  add column client_id uuid not null references public.clients(id) on delete cascade;

create index if not exists upsells_client_idx
  on public.upsells(client_id, created_at desc);
create index if not exists upsells_org_cobrada_idx
  on public.upsells(organization_id, closed_at desc)
  where status = 'cobrada';

create or replace function public.upsells_set_org_from_client()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  select c.organization_id into new.organization_id
    from public.clients c
   where c.id = new.client_id;
  return new;
end;
$$;

drop trigger if exists set_org_from_client on public.upsells;
create trigger set_org_from_client
  before insert or update of client_id on public.upsells
  for each row execute function public.upsells_set_org_from_client();

-- ═══════════════════════════════════════════════════════════════════════════
-- 7) tickets — pivot híbrido: client_id NOT NULL + project_id NULLABLE
--
-- Un ticket vive con el cliente. project_id opcional para el caso "esto
-- pasa en un launch específico". Si está seteado, el trigger valida que el
-- project pertenezca al mismo cliente — imposible referenciar un project
-- ajeno.
--
-- ON DELETE del project: cambia de CASCADE (original) a SET NULL. Antes,
-- borrar un launch mataba los tickets. Ahora el ticket sobrevive atado al
-- cliente (project_id = null). Ese es el modelo correcto: un ticket es del
-- cliente, no del launch.
-- ═══════════════════════════════════════════════════════════════════════════
drop trigger if exists set_org_from_project on public.tickets;
drop function if exists public.tickets_set_org_from_project();

alter table public.tickets
  drop constraint if exists tickets_project_id_fkey;

drop index if exists tickets_project_idx;

alter table public.tickets
  alter column project_id drop not null;

alter table public.tickets
  add constraint tickets_project_id_fkey
    foreign key (project_id) references public.projects(id) on delete set null;

alter table public.tickets
  add column client_id uuid references public.clients(id) on delete cascade;

-- Tabla vacía: safe para forzar NOT NULL sin backfill.
alter table public.tickets
  alter column client_id set not null;

create index if not exists tickets_client_idx
  on public.tickets(client_id, created_at desc);
create index if not exists tickets_project_partial_idx
  on public.tickets(project_id)
  where project_id is not null;

-- Trigger unificado: rellena organization_id desde clients Y valida que si
-- project_id está seteado, el project pertenezca al mismo cliente. Un
-- ticket huérfano en RLS (client de otra org) es imposible.
create or replace function public.tickets_set_org_and_check_project()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_project_client uuid;
begin
  select c.organization_id into v_org
    from public.clients c
   where c.id = new.client_id;
  new.organization_id := v_org;

  if new.project_id is not null then
    select p.client_id into v_project_client
      from public.projects p
     where p.id = new.project_id;

    if v_project_client is null then
      raise exception 'tickets: el project % no tiene cliente asignado. Asigná el cliente al project desde la ficha del cliente, o dejá project_id nulo en el ticket.', new.project_id
        using errcode = '23514';
    end if;

    if v_project_client <> new.client_id then
      raise exception 'tickets: el project % pertenece al cliente %, pero el ticket es del cliente %. Un ticket no puede referenciar un project de otro cliente.', new.project_id, v_project_client, new.client_id
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists set_org_and_check_project on public.tickets;
create trigger set_org_and_check_project
  before insert or update of client_id, project_id on public.tickets
  for each row execute function public.tickets_set_org_and_check_project();
