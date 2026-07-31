-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Bloque 2 (Kingrow · Financiero) — Presupuestos                           │
-- │                                                                          │
-- │ Presupuesto por PERÍODO + DIMENSIÓN OPCIONAL (account y/o cost_center). │
-- │ El período se modela como (period_start, period_end) para soportar     │
-- │ mensual, trimestral, anual sin CHECK duro sobre el granular.            │
-- │                                                                          │
-- │ COMPARACIÓN CON REAL: el selector financiero suma `expenses.amount_net` │
-- │ (o el que aplique) en el mismo período + misma account/cost_center y   │
-- │ lo compara. Este ratio (real / budget) es un KPI de control.            │
-- │                                                                          │
-- │ UNICIDAD: no forzamos unicidad sobre (org, período, account, cc) porque │
-- │ un presupuesto puede tener múltiples versiones (revisión, ajustado).    │
-- │ Un flag `active` sirve para marcar la versión vigente. Historial queda. │
-- │                                                                          │
-- │ NIVEL ORG — TEMPLATE de 0052/0053.                                      │
-- ╰──────────────────────────────────────────────────────────────────────────╯

create table if not exists public.budgets (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references public.organization(id) on delete restrict,

  name                  text not null,
  -- Al menos una de las dos dimensiones DEBE estar seteada (chequeado abajo).
  -- Ambas seteadas = presupuesto para (account × cost_center) — más granular.
  account_id            uuid references public.accounts(id)     on delete restrict,
  cost_center_id        uuid references public.cost_centers(id) on delete restrict,

  period_start          date not null,
  period_end            date not null,

  amount                numeric(14, 2) not null check (amount >= 0),
  currency              text not null default 'ARS',

  active                boolean not null default true,
  notes                 text,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- Al menos una dimensión debe estar seteada — un presupuesto "en el vacío"
-- no se puede comparar contra nada.
alter table public.budgets
  drop constraint if exists budgets_at_least_one_dimension;
alter table public.budgets
  add  constraint budgets_at_least_one_dimension
  check (account_id is not null or cost_center_id is not null);

-- Rango temporal coherente
alter table public.budgets
  drop constraint if exists budgets_period_ordered;
alter table public.budgets
  add  constraint budgets_period_ordered
  check (period_end >= period_start);

create index if not exists budgets_org_period_idx
  on public.budgets(organization_id, period_start, period_end);
create index if not exists budgets_org_active_idx
  on public.budgets(organization_id, active);
create index if not exists budgets_account_idx
  on public.budgets(account_id) where account_id is not null;
create index if not exists budgets_cost_center_idx
  on public.budgets(cost_center_id) where cost_center_id is not null;

drop trigger if exists set_updated_at on public.budgets;
create trigger set_updated_at before update on public.budgets
  for each row execute function public.set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- Frontera org — TEMPLATE de 0052
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.budgets enable row level security;

revoke all on public.budgets from public;
revoke all on public.budgets from cliente_role;

grant select, insert, update, delete on public.budgets to authenticated;

drop policy if exists budgets_select on public.budgets;
create policy budgets_select on public.budgets
  for select to authenticated
  using (public.can_edit_organization(organization_id));

drop policy if exists budgets_insert on public.budgets;
create policy budgets_insert on public.budgets
  for insert to authenticated
  with check (public.can_edit_organization(organization_id));

drop policy if exists budgets_update on public.budgets;
create policy budgets_update on public.budgets
  for update to authenticated
  using      (public.can_edit_organization(organization_id))
  with check (public.can_edit_organization(organization_id));

drop policy if exists budgets_delete on public.budgets;
create policy budgets_delete on public.budgets
  for delete to authenticated
  using (public.can_edit_organization(organization_id));
