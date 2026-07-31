-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Bloque 2 (Kingrow · Financiero) — Proveedores                            │
-- │                                                                          │
-- │ Contraparte de `expenses`: el vendor que emite la factura que Kingrow    │
-- │ paga. Datos mínimos + condiciones de pago (días hasta vencimiento).      │
-- │                                                                          │
-- │ `payment_terms_days` es informativo — la fecha de vencimiento efectiva  │
-- │ vive en cada `expenses.due_date`. Sirve como default sugerido cuando la │
-- │ UI cree un gasto de este proveedor.                                     │
-- │                                                                          │
-- │ NIVEL ORG — TEMPLATE de 0052/0053.                                      │
-- ╰──────────────────────────────────────────────────────────────────────────╯

create table if not exists public.suppliers (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references public.organization(id) on delete restrict,

  name                  text not null,
  tax_id                text,
  email                 text,
  phone                 text,
  address               text,
  payment_terms_days    integer check (payment_terms_days is null or payment_terms_days >= 0),
  notes                 text,
  active                boolean not null default true,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists suppliers_org_idx
  on public.suppliers(organization_id);
create index if not exists suppliers_org_active_idx
  on public.suppliers(organization_id, active);

-- Mismo criterio que organization_people: tax_id opcional (puede no estar
-- cargado al alta), pero cuando existe debe ser único dentro de la org.
create unique index if not exists suppliers_org_tax_id_uniq
  on public.suppliers(organization_id, tax_id)
  where tax_id is not null;

drop trigger if exists set_updated_at on public.suppliers;
create trigger set_updated_at before update on public.suppliers
  for each row execute function public.set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- Frontera org — TEMPLATE de 0052
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.suppliers enable row level security;

revoke all on public.suppliers from public;
revoke all on public.suppliers from cliente_role;

grant select, insert, update, delete on public.suppliers to authenticated;

drop policy if exists suppliers_select on public.suppliers;
create policy suppliers_select on public.suppliers
  for select to authenticated
  using (public.can_edit_organization(organization_id));

drop policy if exists suppliers_insert on public.suppliers;
create policy suppliers_insert on public.suppliers
  for insert to authenticated
  with check (public.can_edit_organization(organization_id));

drop policy if exists suppliers_update on public.suppliers;
create policy suppliers_update on public.suppliers
  for update to authenticated
  using      (public.can_edit_organization(organization_id))
  with check (public.can_edit_organization(organization_id));

drop policy if exists suppliers_delete on public.suppliers;
create policy suppliers_delete on public.suppliers
  for delete to authenticated
  using (public.can_edit_organization(organization_id));
