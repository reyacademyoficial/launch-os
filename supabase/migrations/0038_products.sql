-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Fase 4b (extensión) — Catálogo de productos + product_id en sales        │
-- │                                                                          │
-- │ Concepto: un "producto" es lo que se vende. Vive por proyecto (mismo     │
-- │ patrón que payment_modalities). NO tiene precio fijo: el monto se sigue  │
-- │ ingresando venta a venta en `sales.total_amount`. El producto sólo       │
-- │ etiqueta la venta y permite filtrar/agrupar cobros por catálogo.         │
-- │                                                                          │
-- │ Relación con launches: SE DERIVA por la sale (via lead.launch_id). Un    │
-- │ mismo producto puede venderse en múltiples launches. No armamos          │
-- │ `launch_products` hoy — se puede agregar sin migrar datos si mañana el   │
-- │ negocio pide restringir catálogo por launch.                             │
-- │                                                                          │
-- │ PERMISOS — el catálogo lo gestiona SÓLO admin (can_edit_project), mismo │
-- │ criterio que payment_modalities: tocar el catálogo es decisión           │
-- │ estructural. El operador consume el catálogo al cerrar ventas            │
-- │ (can_edit_launches_in), sin poder crear/editar productos.                │
-- │                                                                          │
-- │ SALES.product_id ES OBLIGATORIO (NOT NULL). Para poder aplicar el        │
-- │ constraint sin romper ventas existentes:                                 │
-- │   1) Se crea un producto "Sin categoría" por cada proyecto que tenga    │
-- │      sales huérfanas.                                                    │
-- │   2) Se backfillean esas sales apuntándolas a ese producto.              │
-- │   3) Recién ahí se aplica SET NOT NULL.                                  │
-- │ El admin puede después renombrar/reasignar desde el catálogo.            │
-- ╰──────────────────────────────────────────────────────────────────────────╯

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) products — catálogo por proyecto
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.products (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  name        text not null,
  description text,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (project_id, name)
);

create index if not exists products_project_idx
  on public.products(project_id);

alter table public.products enable row level security;
grant select, insert, update, delete on public.products to authenticated;

drop trigger if exists set_updated_at on public.products;
create trigger set_updated_at before update on public.products
  for each row execute function public.set_updated_at();

drop policy if exists products_select on public.products;
create policy products_select on public.products
  for select to authenticated
  using (public.has_project_access(project_id));

drop policy if exists products_insert on public.products;
create policy products_insert on public.products
  for insert to authenticated
  with check (public.can_edit_project(project_id));

drop policy if exists products_update on public.products;
create policy products_update on public.products
  for update to authenticated
  using      (public.can_edit_project(project_id))
  with check (public.can_edit_project(project_id));

drop policy if exists products_delete on public.products;
create policy products_delete on public.products
  for delete to authenticated
  using (public.can_edit_project(project_id));

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) sales.product_id — se agrega nullable, se backfillea, se hace NOT NULL
--
--    on delete restrict: si un producto tiene ventas, no se puede borrar.
--    El admin lo desactiva (active=false) para sacarlo del catálogo sin
--    romper el histórico. Consistente con payment_modalities.
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.sales
  add column if not exists product_id uuid references public.products(id) on delete restrict;

-- 2a) Crear un producto "Sin categoría" por cada proyecto que tenga sales
--     todavía sin producto. Idempotente por `unique (project_id, name)`.
insert into public.products (project_id, name, description, active)
select distinct s.project_id,
                'Sin categoría',
                'Autogenerado en la migración 0038 para ventas previas. Renombrá o reasigná desde el catálogo.',
                true
from public.sales s
where s.product_id is null
on conflict (project_id, name) do nothing;

-- 2b) Apuntar cada sale huérfana al producto "Sin categoría" de su proyecto.
update public.sales s
   set product_id = p.id
  from public.products p
 where s.product_id is null
   and p.project_id = s.project_id
   and p.name = 'Sin categoría';

-- 2c) Cerrar el candado: obligatorio de ahora en adelante.
alter table public.sales
  alter column product_id set not null;

create index if not exists sales_product_idx
  on public.sales(product_id);
