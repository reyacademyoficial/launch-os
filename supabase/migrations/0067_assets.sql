-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Bloque 2 (Kingrow · Financiero) — Activos                                │
-- │                                                                          │
-- │ Bienes y derechos patrimoniales de Kingrow. Incluye caja/bancos (a      │
-- │ nivel snapshot manual — el saldo real de bancos se calcula runtime a    │
-- │ partir de `banks` + `bank_movements`), inversiones, activo fijo         │
-- │ (equipos, muebles), intangibles, créditos.                              │
-- │                                                                          │
-- │ ALCANCE HOY: es un registro contable. El selector de patrimonio suma    │
-- │ `assets.amount - liabilities.amount` para el patrimonio neto. No es un  │
-- │ motor de amortización — `depreciation` se guarda si el operador lo      │
-- │ calculó afuera, pero no lo recalculamos.                                │
-- │                                                                          │
-- │ NIVEL ORG — TEMPLATE de 0052/0053.                                      │
-- ╰──────────────────────────────────────────────────────────────────────────╯

create table if not exists public.assets (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references public.organization(id) on delete restrict,

  name                  text not null,
  description           text,
  -- Tipo alto-nivel para segmentar el balance.
  asset_type            text not null default 'otro' check (asset_type in (
    'caja', 'banco', 'inversion', 'inmueble', 'equipo', 'muebles',
    'intangible', 'credito', 'otro'
  )),

  account_id            uuid references public.accounts(id) on delete set null,

  -- Valor y depreciación (todos ARS por default; multi-moneda futuro).
  -- `amount` = valor actual en libros (después de amortizaciones si aplica).
  -- `original_cost` = valor de adquisición (informativo, para depreciación).
  amount                numeric(14, 2) not null check (amount >= 0),
  original_cost         numeric(14, 2) check (original_cost is null or original_cost >= 0),
  depreciation          numeric(14, 2) not null default 0 check (depreciation >= 0),
  currency              text not null default 'ARS',

  acquired_at           date,
  active                boolean not null default true,
  notes                 text,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists assets_org_idx
  on public.assets(organization_id);
create index if not exists assets_org_type_idx
  on public.assets(organization_id, asset_type) where active = true;
create index if not exists assets_account_idx
  on public.assets(account_id) where account_id is not null;

drop trigger if exists set_updated_at on public.assets;
create trigger set_updated_at before update on public.assets
  for each row execute function public.set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- Frontera org — TEMPLATE de 0052
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.assets enable row level security;

revoke all on public.assets from public;
revoke all on public.assets from cliente_role;

grant select, insert, update, delete on public.assets to authenticated;

drop policy if exists assets_select on public.assets;
create policy assets_select on public.assets
  for select to authenticated
  using (public.can_edit_organization(organization_id));

drop policy if exists assets_insert on public.assets;
create policy assets_insert on public.assets
  for insert to authenticated
  with check (public.can_edit_organization(organization_id));

drop policy if exists assets_update on public.assets;
create policy assets_update on public.assets
  for update to authenticated
  using      (public.can_edit_organization(organization_id))
  with check (public.can_edit_organization(organization_id));

drop policy if exists assets_delete on public.assets;
create policy assets_delete on public.assets
  for delete to authenticated
  using (public.can_edit_organization(organization_id));
