-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Bloque 4 (Kingrow · Academia) — Puente enrollment ↔ venta                │
-- │                                                                          │
-- │ Habilita trazabilidad "este alumno inscripto viene de esta venta de     │
-- │ LaunchOS" — el operador puede auto-fillear datos del comprador al       │
-- │ inscribirlo, y los reportes futuros pueden cruzar "revenue del launch   │
-- │ vs. alumnos que efectivamente cursaron".                                │
-- │                                                                          │
-- │ CADENA COMPLETA que este puente cierra:                                 │
-- │                                                                          │
-- │   student (0071)                                                        │
-- │     ↓                                                                    │
-- │   enrollment (0075) → sale (0014) → product (0038) → course (0072)      │
-- │                                                                          │
-- │ El trigger valida que la venta apunte al mismo producto que el          │
-- │ course de la cohort del enrollment. Es la única política válida:        │
-- │ inscribir un alumno via venta del producto X a una cohort que dicta el │
-- │ producto Y es un error de negocio.                                     │
-- │                                                                          │
-- │ ADITIVA — sin backfill. Todas las tablas de academia están en 0 filas  │
-- │ hoy (verificado en Studio 2026-08-04). Cuando se cargue el primer      │
-- │ enrollment via UI, el operador podrá elegir venta o carga manual.      │
-- │                                                                          │
-- │ on delete set null: si la venta se borra o desactiva, el enrollment    │
-- │ sobrevive con sale_id=null (badge "Manual" en UI). Es dato académico   │
-- │ — no se sacrifica por limpieza de catálogo comercial.                  │
-- ╰──────────────────────────────────────────────────────────────────────────╯

alter table public.enrollments
  add column if not exists sale_id uuid
    references public.sales(id) on delete set null;

create index if not exists enrollments_sale_idx
  on public.enrollments(sale_id)
  where sale_id is not null;

-- ═══════════════════════════════════════════════════════════════════════════
-- Trigger de consistencia: si sale_id está seteado, la venta tiene que
-- apuntar al mismo producto que el course de la cohort del enrollment.
--
-- Casos:
--   - sale_id NULL           → válido (inscripción manual, sin trazabilidad
--                              a venta).
--   - sale_id seteado y la cohort NO tiene course_id → rechaza. No hay
--                              cómo validar la coherencia si la cohort no
--                              está asociada a un curso; obligar a atar
--                              venta a cohort sin curso es abrir la puerta
--                              a datos inconsistentes.
--   - sale.product_id != course.product_id → rechaza con mensaje claro.
--   - sale.product_id == course.product_id → válido.
--
-- 23514 (check_violation) para mantener el patrón semántico del bloque
-- (mismo que guard_propia_project).
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.enrollments_check_sale_product()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale_product uuid;
  v_course_product uuid;
begin
  if new.sale_id is null then
    return new;
  end if;

  select product_id into v_sale_product
    from public.sales
   where id = new.sale_id;

  if v_sale_product is null then
    -- FK cubre este caso; guard defensivo.
    raise exception 'enrollments: la venta % no existe', new.sale_id
      using errcode = '23503';
  end if;

  select c.product_id into v_course_product
    from public.cohorts co
    join public.courses c on c.id = co.course_id
   where co.id = new.cohort_id;

  if v_course_product is null then
    raise exception
      'enrollments: la cohort no tiene un curso asociado, no se puede vincular la inscripción a una venta (la venta apunta a un producto y no hay contra qué chequear)'
      using errcode = '23514';
  end if;

  if v_sale_product <> v_course_product then
    raise exception
      'enrollments: la venta % es del producto %, distinto al producto % del curso de esta cohort',
      new.sale_id, v_sale_product, v_course_product
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists check_sale_product on public.enrollments;
create trigger check_sale_product
  before insert or update of sale_id, cohort_id on public.enrollments
  for each row execute function public.enrollments_check_sale_product();
