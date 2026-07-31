-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Bloque 3 (Kingrow · Clientes) — Renovaciones del contrato de gestión  │
-- │                                                                          │
-- │ NO CONFUNDIR con:                                                       │
-- │   - `client_transfers` (0056): plata que Kingrow le devuelve al        │
-- │     externo del SPLIT del launch. Dirección: Kingrow → cliente externo.│
-- │   - `invoices` (0064): fee suelto (retainer, honorarios extras).       │
-- │                                                                          │
-- │ `renewals` es el CONTRATO PERIÓDICO que Kingrow le cobra al cliente    │
-- │ por gestionarlo (mensual/trimestral/anual). Dirección: cliente →       │
-- │ Kingrow. Es lo que en un SaaS sería el MRR/ARR — la renovación         │
-- │ automática del acuerdo comercial.                                       │
-- │                                                                          │
-- │ Cuando la renewal se factura efectivamente, la fila de `invoices`     │
-- │ referencia esta con `renewal_id` (aditivo en migración futura si hace  │
-- │ falta el link fuerte). Hoy la relación es informal.                    │
-- │                                                                          │
-- │ STATUS lifecycle:                                                        │
-- │   propuesta  → cotizada al cliente, no firmada                          │
-- │   confirmada → cliente aceptó, aún no facturada/cobrada                │
-- │   facturada  → invoice emitida, no cobrada                             │
-- │   cobrada    → plata en la caja de Kingrow (cuenta LTV)                │
-- │   perdida    → cliente no renovó (señal fuerte de churn)               │
-- │                                                                          │
-- │ Para LTV: contamos SOLO status='cobrada' — criterio percibido, mismo   │
-- │ criterio que usa el resto del Financiero (ver revenue.ts).             │
-- │                                                                          │
-- │ NIVEL ORG — TEMPLATE de 0058.                                           │
-- ╰──────────────────────────────────────────────────────────────────────────╯

create table if not exists public.renewals (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null references public.organization(id) on delete restrict,
  project_id           uuid not null references public.projects(id)     on delete cascade,

  -- Período que cubre esta renovación. Ej: mensual 2026-03-01..2026-03-31,
  -- trimestral 2026-Q1..end, anual 2026. Cerrado por ambos lados y con
  -- start <= end (invariante suave abajo).
  period_start         date not null,
  period_end           date not null,

  -- Monto contratado NETO de IVA por el período completo. La conversión a
  -- MRR/ARR se hace en TS (dividiendo por meses del período), no en DB.
  amount               numeric(14, 2) not null check (amount >= 0),
  currency             text not null default 'ARS',

  status               text not null default 'propuesta'
                       check (status in ('propuesta','confirmada','facturada','cobrada','perdida')),

  -- Fecha efectiva del cobro. Solo relevante si status='cobrada'.
  -- Invariante abajo la enforza.
  collected_at         date,

  -- Motivo cuando status='perdida'. Texto libre para análisis de churn.
  loss_reason          text,

  notes                text,

  created_by           uuid references auth.users(id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- Invariante: período coherente.
alter table public.renewals
  drop constraint if exists renewals_period_order;
alter table public.renewals
  add  constraint renewals_period_order
  check (period_start <= period_end);

-- Invariante: collected_at consistente con status.
--   - status='cobrada' → collected_at is not null
--   - status distinto  → collected_at is null (no ensuciar el dato)
alter table public.renewals
  drop constraint if exists renewals_collected_at_matches_status;
alter table public.renewals
  add  constraint renewals_collected_at_matches_status
  check (
    (status = 'cobrada' and collected_at is not null)
    or (status <> 'cobrada' and collected_at is null)
  );

-- Invariante: loss_reason solo cuando status='perdida'.
-- (Guardarlo cuando la renewal se cobró sería inconsistente.)
alter table public.renewals
  drop constraint if exists renewals_loss_reason_matches_status;
alter table public.renewals
  add  constraint renewals_loss_reason_matches_status
  check (
    (status = 'perdida') or (loss_reason is null)
  );

create index if not exists renewals_project_idx
  on public.renewals(project_id, period_start desc);
create index if not exists renewals_org_status_idx
  on public.renewals(organization_id, status);
create index if not exists renewals_org_period_idx
  on public.renewals(organization_id, period_end desc);

drop trigger if exists set_updated_at on public.renewals;
create trigger set_updated_at before update on public.renewals
  for each row execute function public.set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- Trigger de consistencia org.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.renewals_set_org_from_project()
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

drop trigger if exists set_org_from_project on public.renewals;
create trigger set_org_from_project
  before insert or update of project_id on public.renewals
  for each row execute function public.renewals_set_org_from_project();

-- ═══════════════════════════════════════════════════════════════════════════
-- Frontera org — TEMPLATE de 0058
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.renewals enable row level security;

revoke all on public.renewals from public;
revoke all on public.renewals from cliente_role;

grant select, insert, update, delete on public.renewals to authenticated;

drop policy if exists renewals_select on public.renewals;
create policy renewals_select on public.renewals
  for select to authenticated
  using (public.can_edit_organization(organization_id));

drop policy if exists renewals_insert on public.renewals;
create policy renewals_insert on public.renewals
  for insert to authenticated
  with check (public.can_edit_organization(organization_id));

drop policy if exists renewals_update on public.renewals;
create policy renewals_update on public.renewals
  for update to authenticated
  using      (public.can_edit_organization(organization_id))
  with check (public.can_edit_organization(organization_id));

drop policy if exists renewals_delete on public.renewals;
create policy renewals_delete on public.renewals
  for delete to authenticated
  using (public.can_edit_organization(organization_id));
