-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Bloque 2 (Kingrow · Financiero) — Gastos                                 │
-- │                                                                          │
-- │ Todo egreso operativo de Kingrow. Incluye ads, herramientas, alquileres,│
-- │ IA, servicios profesionales — TODO menos nómina (0066) y transferencias │
-- │ a clientes (`client_transfers` 0056). Lo que en la utilidad neta se    │
-- │ resta como "gastos operativos + ads + costo IA".                        │
-- │                                                                          │
-- │ MODELO DEVENGADO vs PERCIBIDO                                            │
-- │                                                                          │
-- │ Un gasto se DEVENGA (nace la obligación) cuando llega la factura o el   │
-- │ compromiso. Se PERCIBE (sale la plata) cuando se paga efectivamente.    │
-- │ Modelamos ambas fechas:                                                 │
-- │   - `expense_date`  → fecha de devengo (imputación contable)            │
-- │   - `due_date`      → vencimiento (para AP aging)                        │
-- │   - `paid_at`       → fecha de pago efectivo (NULL = no pagado)        │
-- │   - `bank_movement_id` → link al movimiento bancario que lo pagó (opc.) │
-- │                                                                          │
-- │ Un gasto SIN paid_at es una cuenta por pagar. Con paid_at, deja de      │
-- │ contar en AP. El selector financiero usa este estado para AR/AP.       │
-- │                                                                          │
-- │ FKs OPCIONALES: supplier, cost_center, account, tax. Todos on delete   │
-- │ set null: si borran el catálogo, el gasto queda huérfano pero no se     │
-- │ pierde el registro histórico. `bank_movement_id` mismo tratamiento.    │
-- │                                                                          │
-- │ MONEDA: `currency text default 'ARS'`. Multi-moneda queda para futuro;  │
-- │ hoy asumimos ARS. Guardar la columna evita una migración cuando llegue. │
-- │                                                                          │
-- │ NIVEL ORG — TEMPLATE de 0052/0053.                                      │
-- ╰──────────────────────────────────────────────────────────────────────────╯

create table if not exists public.expenses (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references public.organization(id) on delete restrict,

  -- Descripción y clasificación
  description           text not null,
  category              text,
  -- Categoría alto-nivel para reporting rápido sin resolver plan de cuentas.
  -- Ejemplo: 'ads', 'ia', 'saas', 'oficina', 'servicios', 'otro'. Sin CHECK
  -- porque cada org va a extenderla; el análisis fino se hace vía accounts.

  supplier_id           uuid references public.suppliers(id)      on delete set null,
  account_id            uuid references public.accounts(id)       on delete set null,
  cost_center_id        uuid references public.cost_centers(id)   on delete set null,
  tax_id                uuid references public.taxes(id)          on delete set null,

  -- Montos. amount_gross incluye impuestos; amount_net = amount_gross - tax_amount.
  -- Ambos se guardan explícitos para no depender de recálculo con la alícuota
  -- de taxes (que puede cambiar en el catálogo después de cargar el gasto).
  amount_gross          numeric(14, 2) not null check (amount_gross >= 0),
  tax_amount            numeric(14, 2) not null default 0 check (tax_amount >= 0),
  currency              text not null default 'ARS',

  -- Fechas (ver comentario cabecera)
  expense_date          date not null default current_date,
  due_date              date,
  paid_at               date,

  -- Pago concreto — link opcional al bank_movement generado al pagar
  bank_movement_id      uuid references public.bank_movements(id) on delete set null,

  notes                 text,

  created_by            uuid references auth.users(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- Invariante: tax_amount no puede exceder amount_gross (impuesto ≤ total).
alter table public.expenses
  drop constraint if exists expenses_tax_within_gross;
alter table public.expenses
  add  constraint expenses_tax_within_gross
  check (tax_amount <= amount_gross);

create index if not exists expenses_org_date_idx
  on public.expenses(organization_id, expense_date desc);
create index if not exists expenses_org_unpaid_idx
  on public.expenses(organization_id, due_date)
  where paid_at is null;
create index if not exists expenses_supplier_idx
  on public.expenses(supplier_id) where supplier_id is not null;
create index if not exists expenses_account_idx
  on public.expenses(account_id) where account_id is not null;
create index if not exists expenses_cost_center_idx
  on public.expenses(cost_center_id) where cost_center_id is not null;
create index if not exists expenses_bank_movement_idx
  on public.expenses(bank_movement_id) where bank_movement_id is not null;

drop trigger if exists set_updated_at on public.expenses;
create trigger set_updated_at before update on public.expenses
  for each row execute function public.set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- Frontera org — TEMPLATE de 0052
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.expenses enable row level security;

revoke all on public.expenses from public;
revoke all on public.expenses from cliente_role;

grant select, insert, update, delete on public.expenses to authenticated;

drop policy if exists expenses_select on public.expenses;
create policy expenses_select on public.expenses
  for select to authenticated
  using (public.can_edit_organization(organization_id));

drop policy if exists expenses_insert on public.expenses;
create policy expenses_insert on public.expenses
  for insert to authenticated
  with check (public.can_edit_organization(organization_id));

drop policy if exists expenses_update on public.expenses;
create policy expenses_update on public.expenses
  for update to authenticated
  using      (public.can_edit_organization(organization_id))
  with check (public.can_edit_organization(organization_id));

drop policy if exists expenses_delete on public.expenses;
create policy expenses_delete on public.expenses
  for delete to authenticated
  using (public.can_edit_organization(organization_id));
