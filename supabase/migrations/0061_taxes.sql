-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Bloque 2 (Kingrow · Financiero) — Impuestos                              │
-- │                                                                          │
-- │ Catálogo de impuestos aplicables (IVA 21%, IVA 10.5%, Ingresos Brutos,  │
-- │ retenciones, percepciones, IIBB por jurisdicción, etc.). Cada uno con   │
-- │ su alícuota y un tipo alto-nivel.                                        │
-- │                                                                          │
-- │ ALCANCE HOY: catálogo. `expenses` e `invoices` referencian por FK       │
-- │ opcional para etiquetar el impuesto aplicado a esa línea.               │
-- │                                                                          │
-- │ NIVEL ORG — TEMPLATE de 0052/0053.                                      │
-- ╰──────────────────────────────────────────────────────────────────────────╯

create table if not exists public.taxes (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organization(id) on delete restrict,

  code               text not null,
  name               text not null,
  -- Alícuota como porcentaje (0–100). Impuestos fijos (no %) se modelan con
  -- rate=0 y el monto se carga como línea aparte en el documento.
  rate               numeric not null default 0 check (rate >= 0 and rate <= 100),
  kind               text not null default 'iva' check (kind in (
    'iva', 'iibb', 'ganancias', 'retencion', 'percepcion', 'otro'
  )),
  active             boolean not null default true,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists taxes_org_idx
  on public.taxes(organization_id);
create index if not exists taxes_org_active_idx
  on public.taxes(organization_id, active);

create unique index if not exists taxes_org_code_uniq
  on public.taxes(organization_id, code);

drop trigger if exists set_updated_at on public.taxes;
create trigger set_updated_at before update on public.taxes
  for each row execute function public.set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- Frontera org — TEMPLATE de 0052
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.taxes enable row level security;

revoke all on public.taxes from public;
revoke all on public.taxes from cliente_role;

grant select, insert, update, delete on public.taxes to authenticated;

drop policy if exists taxes_select on public.taxes;
create policy taxes_select on public.taxes
  for select to authenticated
  using (public.can_edit_organization(organization_id));

drop policy if exists taxes_insert on public.taxes;
create policy taxes_insert on public.taxes
  for insert to authenticated
  with check (public.can_edit_organization(organization_id));

drop policy if exists taxes_update on public.taxes;
create policy taxes_update on public.taxes
  for update to authenticated
  using      (public.can_edit_organization(organization_id))
  with check (public.can_edit_organization(organization_id));

drop policy if exists taxes_delete on public.taxes;
create policy taxes_delete on public.taxes
  for delete to authenticated
  using (public.can_edit_organization(organization_id));
