-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Bloque 2 (Kingrow · Financiero) — Facturación de Kingrow a externos     │
-- │                                                                          │
-- │ NO CONFUNDIR con las ventas del lanzamiento (esas viven en `sales` a    │
-- │ nivel proyecto, ya existen). Estas `invoices` son el fee que Kingrow    │
-- │ le cobra al cliente externo (p.ej. Maestro Charcutero) por gestionarle  │
-- │ el lanzamiento — retainer mensual, honorarios, extras.                  │
-- │                                                                          │
-- │ FK a `projects` porque la factura se emite en el contexto del proyecto  │
-- │ gestionado (ese proyecto es la empresa cliente en LaunchOS). Si la      │
-- │ factura no está atada a un proyecto puntual (p.ej. servicio corporativo │
-- │ a un cliente sin proyecto en LaunchOS todavía), queda project_id NULL. │
-- │                                                                          │
-- │ MODELO DEVENGADO vs PERCIBIDO — igual que `expenses`:                   │
-- │   - `issue_date`  → fecha de emisión (devengo)                          │
-- │   - `due_date`    → vencimiento (AR aging)                              │
-- │   - `paid_at`     → cobro efectivo (NULL = no cobrada)                 │
-- │   - `bank_movement_id` → link al movimiento del cobro (opcional)       │
-- │                                                                          │
-- │ STATUS derivable (`emitida` / `cobrada` / `vencida` / `anulada`).       │
-- │ Guardamos status explícito porque `vencida` depende de now() y `anulada`│
-- │ no se puede derivar de fechas — necesita marca del operador.            │
-- │                                                                          │
-- │ NIVEL ORG — TEMPLATE de 0052/0053.                                      │
-- ╰──────────────────────────────────────────────────────────────────────────╯

create table if not exists public.invoices (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references public.organization(id) on delete restrict,

  -- Cliente al que se factura: FK opcional al project gestionado. NULL para
  -- clientes que no tienen project en LaunchOS todavía.
  project_id            uuid references public.projects(id) on delete set null,

  -- Número de factura (formato libre; puede ser 'A-0001-00012345', 'F-023', etc.)
  invoice_number        text,

  -- Concepto / descripción libre. Categoría alto-nivel opcional.
  description           text not null,
  category              text,

  account_id            uuid references public.accounts(id)     on delete set null,
  cost_center_id        uuid references public.cost_centers(id) on delete set null,
  tax_id                uuid references public.taxes(id)        on delete set null,

  -- Montos brutos y netos (ver `expenses` para el racional)
  amount_gross          numeric(14, 2) not null check (amount_gross >= 0),
  tax_amount            numeric(14, 2) not null default 0 check (tax_amount >= 0),
  currency              text not null default 'ARS',

  -- Fechas
  issue_date            date not null default current_date,
  due_date              date,
  paid_at               date,

  -- Cobro concreto
  bank_movement_id      uuid references public.bank_movements(id) on delete set null,

  status                text not null default 'emitida'
                        check (status in ('emitida', 'cobrada', 'vencida', 'anulada')),

  notes                 text,

  created_by            uuid references auth.users(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

alter table public.invoices
  drop constraint if exists invoices_tax_within_gross;
alter table public.invoices
  add  constraint invoices_tax_within_gross
  check (tax_amount <= amount_gross);

-- Invariante suave: si `paid_at` está seteado, status debe ser 'cobrada'.
-- (Anulada no lleva paid_at). Se enforza también en la server action que
-- marca el cobro; el CHECK es defense-in-depth.
alter table public.invoices
  drop constraint if exists invoices_paid_at_matches_status;
alter table public.invoices
  add  constraint invoices_paid_at_matches_status
  check (
    (paid_at is null and status <> 'cobrada')
    or (paid_at is not null and status = 'cobrada')
  );

create index if not exists invoices_org_date_idx
  on public.invoices(organization_id, issue_date desc);
create index if not exists invoices_org_uncollected_idx
  on public.invoices(organization_id, due_date)
  where paid_at is null and status <> 'anulada';
create index if not exists invoices_project_idx
  on public.invoices(project_id) where project_id is not null;
create index if not exists invoices_bank_movement_idx
  on public.invoices(bank_movement_id) where bank_movement_id is not null;

-- Unique de invoice_number POR organización cuando está seteado (evitar
-- duplicar el mismo comprobante). NULLs permitidos y no-únicos.
create unique index if not exists invoices_org_number_uniq
  on public.invoices(organization_id, invoice_number)
  where invoice_number is not null;

drop trigger if exists set_updated_at on public.invoices;
create trigger set_updated_at before update on public.invoices
  for each row execute function public.set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- Frontera org — TEMPLATE de 0052
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.invoices enable row level security;

revoke all on public.invoices from public;
revoke all on public.invoices from cliente_role;

grant select, insert, update, delete on public.invoices to authenticated;

drop policy if exists invoices_select on public.invoices;
create policy invoices_select on public.invoices
  for select to authenticated
  using (public.can_edit_organization(organization_id));

drop policy if exists invoices_insert on public.invoices;
create policy invoices_insert on public.invoices
  for insert to authenticated
  with check (public.can_edit_organization(organization_id));

drop policy if exists invoices_update on public.invoices;
create policy invoices_update on public.invoices
  for update to authenticated
  using      (public.can_edit_organization(organization_id))
  with check (public.can_edit_organization(organization_id));

drop policy if exists invoices_delete on public.invoices;
create policy invoices_delete on public.invoices
  for delete to authenticated
  using (public.can_edit_organization(organization_id));
