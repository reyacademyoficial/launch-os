-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ 0152 — Academia metrics RPCs (Fase F)                                    │
-- │                                                                          │
-- │ Tres funciones agregadoras para métricas de cursos con progress_source   │
-- │ = 'ghl_tags' (Máquina del Éxito). Alimentan la pestaña "Métricas" del    │
-- │ detalle del curso + KPI global del dashboard academia.                  │
-- │                                                                          │
-- │ Diseño clave — SECURITY INVOKER (NO DEFINER):                           │
-- │   Estas funciones consultan enrollments + student_module_progress +      │
-- │   course_modules. Las tres tienen RLS con `has_project_access`. Usando  │
-- │   INVOKER, si el caller no tiene acceso al proyecto del curso, las      │
-- │   subqueries devuelven 0 rows silenciosamente (equivalente a "curso no  │
-- │   existe / no visible"). Sin DEFINER = sin filtro manual, la RLS ya      │
-- │   filtra por proyecto.                                                  │
-- │                                                                          │
-- │ Universo de "students" del curso:                                       │
-- │   enrollments.status IN ('active','completed'). Excluye                 │
-- │   dropped/suspended/expired (esos no cursan hoy, no cuentan para       │
-- │   tasas de progreso vigentes).                                         │
-- │                                                                          │
-- │ Módulo "completado":                                                    │
-- │   student_module_progress.completed_at IS NOT NULL. Filas con           │
-- │   completed_at NULL cuentan como "trackeadas pero pendientes" —         │
-- │   equivalentes a "no completado" para todos los cálculos de acá.       │
-- ╰──────────────────────────────────────────────────────────────────────────╯

begin;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) rpc_course_module_completion_stats
--
-- Por cada módulo del curso: total de students (enrollments activos+completed)
-- y cuántos de esos tienen ese módulo completado. Base para el gráfico de
-- embudo. Si el curso no tiene enrollments, total_students=0 y
-- completion_rate=0 (no NULL — la fila del módulo igual aparece).
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.rpc_course_module_completion_stats(
  p_course_id uuid
)
returns table (
  course_module_id  uuid,
  module_name       text,
  order_index       integer,
  total_students    integer,
  completed_students integer,
  completion_rate   numeric
)
language plpgsql
security invoker
stable
set search_path = public
as $$
begin
  return query
    with course_enrollments as (
      -- Universo de alumnos del curso via cohorts.
      select e.id as enrollment_id
        from public.enrollments e
        join public.cohorts co on co.id = e.cohort_id
       where co.course_id = p_course_id
         and e.status in ('active','completed')
    ),
    total as (
      select count(*)::integer as total_students from course_enrollments
    )
    select
      cm.id                                            as course_module_id,
      cm.name                                          as module_name,
      cm.order_index                                   as order_index,
      t.total_students                                 as total_students,
      coalesce(pc.completed_count, 0)::integer         as completed_students,
      case
        when t.total_students = 0 then 0::numeric
        else round(
          (coalesce(pc.completed_count, 0)::numeric / t.total_students::numeric) * 100,
          2
        )
      end                                              as completion_rate
      from public.course_modules cm
      cross join total t
      left join lateral (
        select count(*)::integer as completed_count
          from public.student_module_progress smp
          join course_enrollments ce on ce.enrollment_id = smp.enrollment_id
         where smp.course_module_id = cm.id
           and smp.completed_at is not null
      ) pc on true
     where cm.course_id = p_course_id
     order by cm.order_index asc;
end;
$$;

grant execute on function public.rpc_course_module_completion_stats(uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) rpc_course_dropoff
--
-- Por cada módulo: cuántos students tienen ese módulo como "último
-- completado". El "último completado" para un enrollment es el módulo con
-- mayor order_index que tiene completed_at not null.
--
-- Decisión: los enrollments SIN ningún módulo completado se IGNORAN (no se
-- suman a ningún módulo). El propósito de la métrica es "identificar dónde
-- se atasca la gente que arrancó" — un student sin ningún avance todavía no
-- se atascó en un módulo concreto, es otro problema (no ingresó nunca).
-- Esos casos se detectan mirando total_students vs sum(students_stuck).
--
-- Devuelve una fila por CADA módulo del curso (incluye los que tengan 0
-- stuck, para que el gráfico tenga el eje completo).
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.rpc_course_dropoff(
  p_course_id uuid
)
returns table (
  course_module_id  uuid,
  module_name       text,
  order_index       integer,
  students_stuck    integer
)
language plpgsql
security invoker
stable
set search_path = public
as $$
begin
  return query
    with course_enrollments as (
      select e.id as enrollment_id
        from public.enrollments e
        join public.cohorts co on co.id = e.cohort_id
       where co.course_id = p_course_id
         and e.status in ('active','completed')
    ),
    -- Para cada enrollment, el order_index del último módulo completado.
    last_completed as (
      select
        smp.enrollment_id,
        max(cm.order_index) as max_order
        from public.student_module_progress smp
        join public.course_modules cm on cm.id = smp.course_module_id
        join course_enrollments ce on ce.enrollment_id = smp.enrollment_id
       where smp.completed_at is not null
         and cm.course_id = p_course_id
       group by smp.enrollment_id
    ),
    stuck_by_order as (
      select max_order, count(*)::integer as stuck_count
        from last_completed
       group by max_order
    )
    select
      cm.id                                    as course_module_id,
      cm.name                                  as module_name,
      cm.order_index                           as order_index,
      coalesce(sbo.stuck_count, 0)::integer    as students_stuck
      from public.course_modules cm
      left join stuck_by_order sbo on sbo.max_order = cm.order_index
     where cm.course_id = p_course_id
     order by cm.order_index asc;
end;
$$;

grant execute on function public.rpc_course_dropoff(uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3) rpc_course_overall_progress
--
-- KPI resumen del curso:
--   - avg_completion_percent: promedio de (módulos completados / total
--     módulos) * 100 por student. Si el curso no tiene módulos, es 0.
--   - total_students: enrollments activos+completed
--   - fully_completed_students: students con TODOS los módulos completados
--
-- Devuelve exactamente 1 fila (agregación global). Con dataset vacío
-- (0 enrollments), devuelve (0, 0, 0) — la UI decide cómo mostrarlo.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.rpc_course_overall_progress(
  p_course_id uuid
)
returns table (
  avg_completion_percent   numeric,
  total_students           integer,
  fully_completed_students integer
)
language plpgsql
security invoker
stable
set search_path = public
as $$
declare
  v_total_modules integer;
begin
  select count(*)::integer into v_total_modules
    from public.course_modules
   where course_id = p_course_id;

  return query
    with course_enrollments as (
      select e.id as enrollment_id
        from public.enrollments e
        join public.cohorts co on co.id = e.cohort_id
       where co.course_id = p_course_id
         and e.status in ('active','completed')
    ),
    per_student as (
      select
        ce.enrollment_id,
        (
          select count(*)::integer
            from public.student_module_progress smp
            join public.course_modules cm
              on cm.id = smp.course_module_id
           where smp.enrollment_id = ce.enrollment_id
             and smp.completed_at is not null
             and cm.course_id = p_course_id
        ) as completed_count
        from course_enrollments ce
    ),
    agg as (
      select
        count(*)::integer                                   as total_students,
        avg(ps.completed_count::numeric)                    as avg_completed,
        count(*) filter (
          where v_total_modules > 0 and ps.completed_count >= v_total_modules
        )::integer                                          as fully_completed
        from per_student ps
    )
    select
      case
        when v_total_modules = 0 or a.total_students = 0
          then 0::numeric
        else round(
          (coalesce(a.avg_completed, 0) / v_total_modules::numeric) * 100,
          2
        )
      end                       as avg_completion_percent,
      a.total_students          as total_students,
      a.fully_completed         as fully_completed_students
      from agg a;
end;
$$;

grant execute on function public.rpc_course_overall_progress(uuid) to authenticated;

commit;
