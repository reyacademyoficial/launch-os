-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Bloque 4 (Kingrow) — Academia: `courses` (fino sobre `products`)         │
-- │                                                                          │
-- │ El catálogo comercial es UNO SOLO: `products` (0038). Un product se     │
-- │ vende en el lanzamiento (via sales.product_id) Y se cursa en academia   │
-- │ (via courses.product_id). Academia NO duplica el catálogo — le agrega   │
-- │ una capa fina con metadatos académicos (duración, módulos, syllabus).   │
-- │                                                                          │
-- │ Diseño:                                                                 │
-- │   - courses.product_id UNIQUE — un product es a lo sumo 1 course.       │
-- │     (No todo product es un course: puede haber merch/servicios/upsells  │
-- │     no académicos, y ésos simplemente no tienen fila en courses.)       │
-- │   - courses.project_id DENORMALIZADO desde products.project_id vía      │
-- │     trigger. Motivos:                                                   │
-- │       (a) RLS eficiente (has_project_access(project_id) directo, sin    │
-- │           hop a products).                                              │
-- │       (b) Consistente con el precedente de payments.project_id (0045).  │
-- │       (c) Permite indexar por (project_id) sin joinear.                 │
-- │                                                                          │
-- │ Guardarraíl: NO se toca `products`. Sólo se referencia.                 │
-- │                                                                          │
-- │ RLS: patrón LaunchOS. SIN grant a cliente_role.                        │
-- ╰──────────────────────────────────────────────────────────────────────────╯

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) courses
--    - product_id → products (unique — 1:1 con products cuando aplica).
--    - project_id → projects (denorm; enforce via trigger).
--    - Campos académicos opcionales: duration_hours, modules_count, syllabus.
--    - `active` bool para archivar sin borrar (mismo patrón que products).
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.courses (
  id              uuid        primary key default gen_random_uuid(),
  product_id      uuid        not null unique
                     references public.products(id) on delete cascade,
  project_id      uuid        not null references public.projects(id) on delete cascade,
  duration_hours  integer     check (duration_hours is null or duration_hours > 0),
  modules_count   integer     check (modules_count  is null or modules_count  > 0),
  syllabus        jsonb,
  active          boolean     not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists courses_project_idx
  on public.courses(project_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) Trigger de denormalización: copia products.project_id → courses.project_id
--
--    Nombre 'before_denorm_project_id_from_product' — la 'b' garantiza que
--    corre ANTES que 'guard_propia_project' (alphabetical trigger order).
--    Corre en INSERT y en UPDATE OF product_id: si alguien remapea el
--    course a otro product, el project_id se actualiza en cascada y el
--    guard revalida propia. Si NEW.project_id fue provisto manualmente y
--    difiere del product, ganamos: el source of truth es products.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.courses_denorm_project_id()
returns trigger
language plpgsql
as $$
begin
  select project_id into new.project_id
    from public.products
   where id = new.product_id;
  return new;
end;
$$;

drop trigger if exists before_denorm_project_id_from_product on public.courses;
create trigger before_denorm_project_id_from_product
  before insert or update of product_id on public.courses
  for each row execute function public.courses_denorm_project_id();

drop trigger if exists guard_propia_project on public.courses;
create trigger guard_propia_project
  before insert or update of project_id on public.courses
  for each row execute function public.guard_propia_project();

drop trigger if exists set_updated_at on public.courses;
create trigger set_updated_at before update on public.courses
  for each row execute function public.set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- 3) RLS
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.courses enable row level security;
grant select, insert, update, delete on public.courses to authenticated;

drop policy if exists courses_select on public.courses;
create policy courses_select on public.courses
  for select to authenticated
  using (public.has_project_access(project_id));

drop policy if exists courses_insert on public.courses;
create policy courses_insert on public.courses
  for insert to authenticated
  with check (public.can_edit_project(project_id));

drop policy if exists courses_update on public.courses;
create policy courses_update on public.courses
  for update to authenticated
  using      (public.can_edit_project(project_id))
  with check (public.can_edit_project(project_id));

drop policy if exists courses_delete on public.courses;
create policy courses_delete on public.courses
  for delete to authenticated
  using (public.can_edit_project(project_id));
