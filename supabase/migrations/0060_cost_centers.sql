-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Bloque 2 (Kingrow · Financiero) — Centros de costo                       │
-- │                                                                          │
-- │ Los centros de costo agrupan gastos por unidad de negocio o proyecto    │
-- │ interno para reportar utilidad por segmento. Un CC típico: "Growins",   │
-- │ "Rey Academy", "Overhead", "IT", "Comercial".                           │
-- │                                                                          │
-- │ ALCANCE HOY: catálogo. Otras tablas (`expenses`, `budgets`, `payroll`)  │
-- │ referencian por FK opcional. Un CC puede quedar sin asignar (nullable). │
-- │                                                                          │
-- │ CÓDIGO ÚNICO POR ORG.                                                   │
-- │                                                                          │
-- │ NIVEL ORG — TEMPLATE de 0052/0053.                                      │
-- ╰──────────────────────────────────────────────────────────────────────────╯

create table if not exists public.cost_centers (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organization(id) on delete restrict,

  code               text not null,
  name               text not null,
  description        text,
  active             boolean not null default true,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists cost_centers_org_idx
  on public.cost_centers(organization_id);
create index if not exists cost_centers_org_active_idx
  on public.cost_centers(organization_id, active);

create unique index if not exists cost_centers_org_code_uniq
  on public.cost_centers(organization_id, code);

drop trigger if exists set_updated_at on public.cost_centers;
create trigger set_updated_at before update on public.cost_centers
  for each row execute function public.set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- Frontera org — TEMPLATE de 0052
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.cost_centers enable row level security;

revoke all on public.cost_centers from public;
revoke all on public.cost_centers from cliente_role;

grant select, insert, update, delete on public.cost_centers to authenticated;

drop policy if exists cost_centers_select on public.cost_centers;
create policy cost_centers_select on public.cost_centers
  for select to authenticated
  using (public.can_edit_organization(organization_id));

drop policy if exists cost_centers_insert on public.cost_centers;
create policy cost_centers_insert on public.cost_centers
  for insert to authenticated
  with check (public.can_edit_organization(organization_id));

drop policy if exists cost_centers_update on public.cost_centers;
create policy cost_centers_update on public.cost_centers
  for update to authenticated
  using      (public.can_edit_organization(organization_id))
  with check (public.can_edit_organization(organization_id));

drop policy if exists cost_centers_delete on public.cost_centers;
create policy cost_centers_delete on public.cost_centers
  for delete to authenticated
  using (public.can_edit_organization(organization_id));
