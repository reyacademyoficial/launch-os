-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Bloque 1 (Kingrow) — Cuenta corriente con clientes externos              │
-- │                                                                          │
-- │ Cuando un lanzamiento de una empresa EXTERNA cobra por bancos de        │
-- │ Kingrow, se genera un pasivo: Kingrow le debe al cliente lo cobrado     │
-- │ menos su retención. Esa cuenta corriente vive en esta tabla.            │
-- │                                                                          │
-- │ SALDO DEL CLIENTE = Σ(a_favor_cliente) − Σ(transferido)                 │
-- │                                                                          │
-- │ direction:                                                              │
-- │   a_favor_cliente → devengado (cerró liquidación externa, plata queda   │
-- │                     debiendo). Origen típico: launch_settlement.        │
-- │   transferido     → se le movió la plata al cliente. Origen: bank       │
-- │                     movement 'out' (link opcional via bank_movement_id).│
-- │                                                                          │
-- │ launch_settlement_id: NULL para ajustes manuales (correcciones,          │
-- │ arrastre inicial). Cuando existe, traza la liquidación de origen.       │
-- │                                                                          │
-- │ bank_movement_id: NULL cuando aún no se sabe qué movimiento bancario    │
-- │ concretará la transferencia (o para el lado 'a_favor_cliente', que es  │
-- │ un devengo, no un movimiento). Cuando se transfiere, se linkea al       │
-- │ movement real y queda trazado.                                          │
-- │                                                                          │
-- │ NIVEL ORG — misma frontera dura que settlement_rules / launch_          │
-- │ settlements (ver 0052 / 0053 / 0055).                                   │
-- ╰──────────────────────────────────────────────────────────────────────────╯

create table if not exists public.client_transfers (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references public.organization(id)          on delete restrict,
  project_id            uuid not null references public.projects(id)              on delete cascade,
  launch_settlement_id  uuid references public.launch_settlements(id)             on delete set null,
  bank_movement_id      uuid references public.bank_movements(id)                 on delete set null,

  amount                numeric not null check (amount > 0),
  direction             text not null check (direction in ('a_favor_cliente', 'transferido')),
  date                  date not null default current_date,
  notes                 text,

  created_at            timestamptz not null default now()
);

create index if not exists client_transfers_project_idx
  on public.client_transfers(project_id, date desc);
create index if not exists client_transfers_organization_idx
  on public.client_transfers(organization_id, date desc);
create index if not exists client_transfers_settlement_idx
  on public.client_transfers(launch_settlement_id)
  where launch_settlement_id is not null;
create index if not exists client_transfers_bank_movement_idx
  on public.client_transfers(bank_movement_id)
  where bank_movement_id is not null;

-- ═══════════════════════════════════════════════════════════════════════════
-- Frontera org — TEMPLATE de 0052
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.client_transfers enable row level security;

revoke all on public.client_transfers from public;
revoke all on public.client_transfers from cliente_role;

grant select, insert, update, delete on public.client_transfers to authenticated;

drop policy if exists client_transfers_select on public.client_transfers;
create policy client_transfers_select on public.client_transfers
  for select to authenticated
  using (public.can_edit_organization(organization_id));

drop policy if exists client_transfers_insert on public.client_transfers;
create policy client_transfers_insert on public.client_transfers
  for insert to authenticated
  with check (public.can_edit_organization(organization_id));

drop policy if exists client_transfers_update on public.client_transfers;
create policy client_transfers_update on public.client_transfers
  for update to authenticated
  using      (public.can_edit_organization(organization_id))
  with check (public.can_edit_organization(organization_id));

drop policy if exists client_transfers_delete on public.client_transfers;
create policy client_transfers_delete on public.client_transfers
  for delete to authenticated
  using (public.can_edit_organization(organization_id));
