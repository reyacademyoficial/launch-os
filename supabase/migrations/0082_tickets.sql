-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Bloque 3 (Kingrow · Clientes) — Tickets de soporte por cliente         │
-- │                                                                          │
-- │ Sistema de tickets a nivel org: Kingrow trackea pedidos, incidencias,   │
-- │ tareas por empresa gestionada. NO es soporte al alumno del launch      │
-- │ (eso, si existe, viviría project-scope). Este ticket es Kingrow↔       │
-- │ empresa cliente: reunión pendiente, campaña en pausa, cambio de plan.  │
-- │                                                                          │
-- │ ASIGNADO: FK a `organization_people` (Bloque 2), NULLABLE.              │
-- │   - Persona REAL de Kingrow (no auth.users), consistente con payroll.  │
-- │   - Nullable para permitir tickets no asignados (backlog).             │
-- │   - on delete set null: si la persona sale de Kingrow, el ticket se   │
-- │     queda huérfano pero no se pierde el historial.                     │
-- │                                                                          │
-- │ STATUS / PRIORIDAD: enums acotados. `resolved_at` se completa cuando    │
-- │ el status pasa a 'resuelto' o 'cerrado' (invariante suave por CHECK).  │
-- │                                                                          │
-- │ NIVEL ORG — TEMPLATE de 0058.                                           │
-- ╰──────────────────────────────────────────────────────────────────────────╯

create table if not exists public.tickets (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references public.organization(id) on delete restrict,
  project_id            uuid not null references public.projects(id)     on delete cascade,

  -- Asignado dentro de Kingrow (opcional). FK a la CAPA DE IDENTIDAD
  -- (organization_people, 0058), no a auth.users, para que un cambio en
  -- el user auth de una persona no rompa el ticket, y para poder asignar
  -- a personas que no tienen usuario Kingrow todavía.
  assignee_person_id    uuid references public.organization_people(id) on delete set null,

  title                 text not null,
  description           text,

  status                text not null default 'abierto'
                        check (status in ('abierto','en_progreso','esperando_cliente','resuelto','cerrado')),

  priority              text not null default 'media'
                        check (priority in ('baja','media','alta','urgente')),

  -- Categoría libre (billing, técnico, comercial, campaña, etc). Texto
  -- porque un enum obligaría a migrar cada vez que aparezca una categoría
  -- nueva.
  category              text,

  -- Fecha de vencimiento comprometida (opcional). Sirve para reportes de
  -- SLA / tickets vencidos.
  due_date              date,

  -- Cierre efectivo. Se completa cuando el ticket transiciona a
  -- resuelto/cerrado. Constraint suave abajo lo enforza.
  resolved_at           timestamptz,

  created_by            uuid references auth.users(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- Invariante: si status ∈ {resuelto, cerrado} entonces resolved_at != null.
-- Los estados abiertos jamás tienen resolved_at seteado.
alter table public.tickets
  drop constraint if exists tickets_resolved_at_matches_status;
alter table public.tickets
  add  constraint tickets_resolved_at_matches_status
  check (
    (status in ('resuelto','cerrado') and resolved_at is not null)
    or (status not in ('resuelto','cerrado') and resolved_at is null)
  );

create index if not exists tickets_project_idx
  on public.tickets(project_id, created_at desc);
create index if not exists tickets_org_open_idx
  on public.tickets(organization_id, status)
  where status not in ('resuelto','cerrado');
create index if not exists tickets_assignee_idx
  on public.tickets(assignee_person_id)
  where assignee_person_id is not null;
create index if not exists tickets_org_priority_idx
  on public.tickets(organization_id, priority, status);

drop trigger if exists set_updated_at on public.tickets;
create trigger set_updated_at before update on public.tickets
  for each row execute function public.set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- Trigger de consistencia org: rellena organization_id desde projects.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.tickets_set_org_from_project()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  select p.organization_id into new.organization_id
    from public.projects p
   where p.id = new.project_id;
  return new;
end;
$$;

drop trigger if exists set_org_from_project on public.tickets;
create trigger set_org_from_project
  before insert or update of project_id on public.tickets
  for each row execute function public.tickets_set_org_from_project();

-- ═══════════════════════════════════════════════════════════════════════════
-- Frontera org — TEMPLATE de 0058
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.tickets enable row level security;

revoke all on public.tickets from public;
revoke all on public.tickets from cliente_role;

grant select, insert, update, delete on public.tickets to authenticated;

drop policy if exists tickets_select on public.tickets;
create policy tickets_select on public.tickets
  for select to authenticated
  using (public.can_edit_organization(organization_id));

drop policy if exists tickets_insert on public.tickets;
create policy tickets_insert on public.tickets
  for insert to authenticated
  with check (public.can_edit_organization(organization_id));

drop policy if exists tickets_update on public.tickets;
create policy tickets_update on public.tickets
  for update to authenticated
  using      (public.can_edit_organization(organization_id))
  with check (public.can_edit_organization(organization_id));

drop policy if exists tickets_delete on public.tickets;
create policy tickets_delete on public.tickets
  for delete to authenticated
  using (public.can_edit_organization(organization_id));
