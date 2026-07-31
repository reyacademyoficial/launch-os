-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Bloque 2 (Kingrow · Financiero) — Pasivos                                │
-- │                                                                          │
-- │ Deudas y obligaciones de Kingrow: préstamos, líneas de crédito, deudas  │
-- │ fiscales, provisiones. NO incluye:                                      │
-- │   - Cuentas por pagar corrientes (esas son `expenses`/`payroll` sin    │
-- │     pagar todavía — se derivan runtime en el selector AP).             │
-- │   - Deuda con clientes externos (esa vive en `client_transfers`         │
-- │     direction='a_favor_cliente' sin `transferido`).                     │
-- │                                                                          │
-- │ Un pasivo acá típicamente tiene una CONTRAPARTE que no encaja en las   │
-- │ tablas operativas: préstamo bancario, obligación de largo plazo, cuenta │
-- │ contable de provisión, etc.                                              │
-- │                                                                          │
-- │ El selector de patrimonio hace: patrimonio_neto = Σ activos − Σ         │
-- │ pasivos (esta tabla) − AP corriente (derivada). Ver src/lib/finance.   │
-- │                                                                          │
-- │ NIVEL ORG — TEMPLATE de 0052/0053.                                      │
-- ╰──────────────────────────────────────────────────────────────────────────╯

create table if not exists public.liabilities (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references public.organization(id) on delete restrict,

  name                  text not null,
  description           text,
  liability_type        text not null default 'otro' check (liability_type in (
    'prestamo', 'credito', 'deuda_fiscal', 'provision', 'otro'
  )),

  account_id            uuid references public.accounts(id) on delete set null,

  amount                numeric(14, 2) not null check (amount >= 0),
  currency              text not null default 'ARS',

  -- Fechas relevantes
  incurred_at           date,
  due_date              date,
  settled_at            date,

  active                boolean not null default true,
  notes                 text,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists liabilities_org_idx
  on public.liabilities(organization_id);
create index if not exists liabilities_org_type_idx
  on public.liabilities(organization_id, liability_type) where active = true;
create index if not exists liabilities_org_pending_idx
  on public.liabilities(organization_id, due_date)
  where settled_at is null and active = true;
create index if not exists liabilities_account_idx
  on public.liabilities(account_id) where account_id is not null;

drop trigger if exists set_updated_at on public.liabilities;
create trigger set_updated_at before update on public.liabilities
  for each row execute function public.set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- Frontera org — TEMPLATE de 0052
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.liabilities enable row level security;

revoke all on public.liabilities from public;
revoke all on public.liabilities from cliente_role;

grant select, insert, update, delete on public.liabilities to authenticated;

drop policy if exists liabilities_select on public.liabilities;
create policy liabilities_select on public.liabilities
  for select to authenticated
  using (public.can_edit_organization(organization_id));

drop policy if exists liabilities_insert on public.liabilities;
create policy liabilities_insert on public.liabilities
  for insert to authenticated
  with check (public.can_edit_organization(organization_id));

drop policy if exists liabilities_update on public.liabilities;
create policy liabilities_update on public.liabilities
  for update to authenticated
  using      (public.can_edit_organization(organization_id))
  with check (public.can_edit_organization(organization_id));

drop policy if exists liabilities_delete on public.liabilities;
create policy liabilities_delete on public.liabilities
  for delete to authenticated
  using (public.can_edit_organization(organization_id));
