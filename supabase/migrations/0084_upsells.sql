-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Bloque 3 (Kingrow · Clientes) — Upsells sobre cliente existente        │
-- │                                                                          │
-- │ Ventas ADICIONALES a un cliente que ya está en el portfolio (nuevo     │
-- │ producto, servicio extra, expansión del alcance). NO es la renewal     │
-- │ (0083, contrato periódico) ni el fee suelto de invoices (0064).       │
-- │                                                                          │
-- │ Ejemplo típico: cliente contrató gestión de launch, ahora paga extra   │
-- │ por gestión de comunidad, o segundo launch, o creación de embudo.     │
-- │                                                                          │
-- │ Para LTV: se cuenta solo status='cobrada' (criterio percibido,        │
-- │ mismo que renewals/invoices). Los otros estados sirven para pipeline. │
-- │                                                                          │
-- │ NIVEL ORG — TEMPLATE de 0058.                                           │
-- ╰──────────────────────────────────────────────────────────────────────────╯

create table if not exists public.upsells (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null references public.organization(id) on delete restrict,
  project_id           uuid not null references public.projects(id)     on delete cascade,

  title                text not null,
  description          text,

  -- Categoría del upsell (p.ej. 'nuevo_launch', 'gestion_comunidad',
  -- 'consultoria'). Texto libre — evita explotar el enum cada vez que
  -- aparece una vertical nueva.
  category             text,

  amount               numeric(14, 2) not null check (amount >= 0),
  currency             text not null default 'ARS',

  status               text not null default 'propuesta'
                       check (status in ('propuesta','confirmada','facturada','cobrada','perdida')),

  -- Fecha efectiva del cierre / cobro. Solo relevante si status='cobrada'.
  closed_at            date,

  loss_reason          text,

  notes                text,

  created_by           uuid references auth.users(id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- Invariante: closed_at consistente con status.
alter table public.upsells
  drop constraint if exists upsells_closed_at_matches_status;
alter table public.upsells
  add  constraint upsells_closed_at_matches_status
  check (
    (status = 'cobrada' and closed_at is not null)
    or (status <> 'cobrada' and closed_at is null)
  );

-- Invariante: loss_reason solo cuando status='perdida'.
alter table public.upsells
  drop constraint if exists upsells_loss_reason_matches_status;
alter table public.upsells
  add  constraint upsells_loss_reason_matches_status
  check (
    (status = 'perdida') or (loss_reason is null)
  );

create index if not exists upsells_project_idx
  on public.upsells(project_id, created_at desc);
create index if not exists upsells_org_status_idx
  on public.upsells(organization_id, status);
create index if not exists upsells_org_cobrada_idx
  on public.upsells(organization_id, closed_at desc)
  where status = 'cobrada';

drop trigger if exists set_updated_at on public.upsells;
create trigger set_updated_at before update on public.upsells
  for each row execute function public.set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- Trigger de consistencia org.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.upsells_set_org_from_project()
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

drop trigger if exists set_org_from_project on public.upsells;
create trigger set_org_from_project
  before insert or update of project_id on public.upsells
  for each row execute function public.upsells_set_org_from_project();

-- ═══════════════════════════════════════════════════════════════════════════
-- Frontera org — TEMPLATE de 0058
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.upsells enable row level security;

revoke all on public.upsells from public;
revoke all on public.upsells from cliente_role;

grant select, insert, update, delete on public.upsells to authenticated;

drop policy if exists upsells_select on public.upsells;
create policy upsells_select on public.upsells
  for select to authenticated
  using (public.can_edit_organization(organization_id));

drop policy if exists upsells_insert on public.upsells;
create policy upsells_insert on public.upsells
  for insert to authenticated
  with check (public.can_edit_organization(organization_id));

drop policy if exists upsells_update on public.upsells;
create policy upsells_update on public.upsells
  for update to authenticated
  using      (public.can_edit_organization(organization_id))
  with check (public.can_edit_organization(organization_id));

drop policy if exists upsells_delete on public.upsells;
create policy upsells_delete on public.upsells
  for delete to authenticated
  using (public.can_edit_organization(organization_id));
