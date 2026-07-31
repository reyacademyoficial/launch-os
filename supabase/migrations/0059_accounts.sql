-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Bloque 2 (Kingrow · Financiero) — Plan de cuentas                        │
-- │                                                                          │
-- │ Estructura contable estándar: cada cuenta tiene código, nombre, tipo    │
-- │ (activo/pasivo/patrimonio/ingreso/gasto) y opcionalmente un padre       │
-- │ (`parent_id`) para armar la jerarquía. Un contador o el admin de        │
-- │ Kingrow define el árbol según necesidad.                                │
-- │                                                                          │
-- │ ALCANCE HOY: es un catálogo. Otras tablas (`expenses`, `invoices`,      │
-- │ `budgets`, `payroll`) van a referenciarlo por FK opcional. NO se        │
-- │ arma acá un motor de asientos contables por partida doble — eso es      │
-- │ scope de un módulo contable futuro. Hoy alcanza con etiquetar cada      │
-- │ movimiento con la cuenta correspondiente para los reportes.             │
-- │                                                                          │
-- │ CÓDIGO ÚNICO POR ORG. `(organization_id, code)` unique para prevenir    │
-- │ duplicados. La forma del código (jerárquico "1.1.01" o plano) queda     │
-- │ libre — text, sin CHECK — porque cada org puede tener su convención.    │
-- │                                                                          │
-- │ NIVEL ORG — TEMPLATE de 0052/0053.                                      │
-- ╰──────────────────────────────────────────────────────────────────────────╯

create table if not exists public.accounts (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organization(id) on delete restrict,

  code               text not null,
  name               text not null,
  -- Tipos contables estándar. `patrimonio` incluye capital + resultados
  -- acumulados. `ingreso`/`gasto` cierran contra patrimonio al final del
  -- ejercicio pero acá NO se computa esa mecánica — es solo etiqueta.
  account_type       text not null check (account_type in (
    'activo', 'pasivo', 'patrimonio', 'ingreso', 'gasto'
  )),
  parent_id          uuid references public.accounts(id) on delete restrict,

  active             boolean not null default true,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists accounts_org_idx
  on public.accounts(organization_id);
create index if not exists accounts_org_type_idx
  on public.accounts(organization_id, account_type) where active = true;
create index if not exists accounts_parent_idx
  on public.accounts(parent_id) where parent_id is not null;

create unique index if not exists accounts_org_code_uniq
  on public.accounts(organization_id, code);

drop trigger if exists set_updated_at on public.accounts;
create trigger set_updated_at before update on public.accounts
  for each row execute function public.set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- Frontera org — TEMPLATE de 0052
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.accounts enable row level security;

revoke all on public.accounts from public;
revoke all on public.accounts from cliente_role;

grant select, insert, update, delete on public.accounts to authenticated;

drop policy if exists accounts_select on public.accounts;
create policy accounts_select on public.accounts
  for select to authenticated
  using (public.can_edit_organization(organization_id));

drop policy if exists accounts_insert on public.accounts;
create policy accounts_insert on public.accounts
  for insert to authenticated
  with check (public.can_edit_organization(organization_id));

drop policy if exists accounts_update on public.accounts;
create policy accounts_update on public.accounts
  for update to authenticated
  using      (public.can_edit_organization(organization_id))
  with check (public.can_edit_organization(organization_id));

drop policy if exists accounts_delete on public.accounts;
create policy accounts_delete on public.accounts
  for delete to authenticated
  using (public.can_edit_organization(organization_id));
