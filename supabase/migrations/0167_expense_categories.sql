-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Bloque 2 (Kingrow · Financiero) — Catálogo de categorías de gastos       │
-- │                                                                          │
-- │ Antes de esta migración el vocabulario vivía hardcodeado en             │
-- │ `src/lib/finance/expense-categories.ts` (9 valores fijos). La columna   │
-- │ `expenses.category` es `text` libre (0063 línea 38), así que la         │
-- │ restricción era pura UI. Este catálogo pasa el vocabulario a DB para   │
-- │ que el humano lo pueda ABMear desde el módulo Financiero.              │
-- │                                                                          │
-- │ Modelo:                                                                  │
-- │   · slug   = valor persistido en `expenses.category` (normalizado:      │
-- │              minúscula / sin acentos / sin espacios)                    │
-- │   · label  = presentación en la UI                                      │
-- │   · bucket = clasificador del P&L (direct/tax/operating). Se editar   │
-- │              por categoría en vez de vivir hardcodeado. Si el usuario  │
-- │              agrega "publicidad LinkedIn" con bucket='direct',         │
-- │              cae al mismo lugar del estado de resultados que la actual │
-- │              'publicidad'.                                              │
-- │                                                                          │
-- │ Baja: SOFT-DELETE via `is_active=false` (decisión del usuario). No       │
-- │ rompe históricos y permite reactivar. La UI filtra inactivas del select │
-- │ del form de gastos, pero sigue mostrándolas en la tabla / gráfico si   │
-- │ hay filas históricas apuntando al slug.                                 │
-- │                                                                          │
-- │ RLS: mismo pattern que 0060 (cost_centers) — lectura y escritura por    │
-- │ `can_edit_organization`. Un `cliente_role` nunca llega (revoke a nivel │
-- │ tabla).                                                                  │
-- │                                                                          │
-- │ NO se agrega FK `expenses.category → expense_categories.slug`. La        │
-- │ columna sigue siendo texto libre porque:                                 │
-- │   · Filas históricas (o import xlsx con typo) no se rompen.             │
-- │   · Cambiar la categoría de un gasto no requiere existir en el          │
-- │     catálogo (import bulk con valores no listados cae como "Sin         │
-- │     categoría" en el gráfico, coherente con el comportamiento previo).  │
-- ╰──────────────────────────────────────────────────────────────────────────╯

create table if not exists public.expense_categories (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organization(id) on delete restrict,

  slug               text not null,
  label              text not null,
  bucket             text not null default 'operating'
                       check (bucket in ('direct', 'tax', 'operating')),
  sort_order         int  not null default 100,
  is_active          boolean not null default true,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists expense_categories_org_idx
  on public.expense_categories(organization_id);
create index if not exists expense_categories_org_active_idx
  on public.expense_categories(organization_id, is_active);

-- Slug único por org (case-insensitive gracias a la normalización en app).
create unique index if not exists expense_categories_org_slug_uniq
  on public.expense_categories(organization_id, slug);

drop trigger if exists set_updated_at on public.expense_categories;
create trigger set_updated_at before update on public.expense_categories
  for each row execute function public.set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- Frontera org — mismo template que 0060
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.expense_categories enable row level security;

revoke all on public.expense_categories from public;
revoke all on public.expense_categories from cliente_role;

grant select, insert, update, delete on public.expense_categories to authenticated;

drop policy if exists expense_categories_select on public.expense_categories;
create policy expense_categories_select on public.expense_categories
  for select to authenticated
  using (public.can_edit_organization(organization_id));

drop policy if exists expense_categories_insert on public.expense_categories;
create policy expense_categories_insert on public.expense_categories
  for insert to authenticated
  with check (public.can_edit_organization(organization_id));

drop policy if exists expense_categories_update on public.expense_categories;
create policy expense_categories_update on public.expense_categories
  for update to authenticated
  using      (public.can_edit_organization(organization_id))
  with check (public.can_edit_organization(organization_id));

drop policy if exists expense_categories_delete on public.expense_categories;
create policy expense_categories_delete on public.expense_categories
  for delete to authenticated
  using (public.can_edit_organization(organization_id));

-- ═══════════════════════════════════════════════════════════════════════════
-- Seed — las 9 categorías históricas por cada organización existente.
--
-- Buckets copiados de `bucketOfCategory` (src/lib/finance/expense-categories.ts):
--   direct    → publicidad
--   tax       → impuestos
--   operating → todo el resto
--
-- ON CONFLICT: si ya existe (re-run de la migración o seed manual previo), se
-- deja como está. Cambiar `bucket` / `label` post-seed es responsabilidad del
-- ABM desde la UI — no se pisa acá.
-- ═══════════════════════════════════════════════════════════════════════════
insert into public.expense_categories (organization_id, slug, label, bucket, sort_order)
select o.id, c.slug, c.label, c.bucket, c.sort_order
from public.organization o
cross join (values
  ('alquiler',       'Alquiler',       'operating', 10),
  ('servicios',      'Servicios',      'operating', 20),
  ('software',       'Software',       'operating', 30),
  ('publicidad',     'Publicidad',     'direct',    40),
  ('oficina',        'Oficina',        'operating', 50),
  ('representacion', 'Representación', 'operating', 60),
  ('impuestos',      'Impuestos',      'tax',       70),
  ('comisiones',     'Comisiones',     'operating', 80),
  ('otros',          'Otros',          'operating', 90)
) as c(slug, label, bucket, sort_order)
on conflict (organization_id, slug) do nothing;
