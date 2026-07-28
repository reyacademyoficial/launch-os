-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Bloque 4 (Kingrow) — Academia: `cohorts`                                 │
-- │                                                                          │
-- │ Una cohort (cohorte, generación) es un GRUPO de alumnos que cursan      │
-- │ juntos: comparten cronograma, clases y —típicamente— un curso. La       │
-- │ granularidad "grupo" es la que después usan enrollments (student ↔      │
-- │ cohort), classes (sesiones de la cohorte) y exams (evaluaciones a los   │
-- │ alumnos de la cohorte).                                                 │
-- │                                                                          │
-- │ course_id es OPCIONAL — a veces una cohorte es multi-curso (una         │
-- │ "generación 2026" que hace 3 cursos secuencialmente), y a veces todavía │
-- │ no se decidió qué course cursa. Cuando está seteado, se valida que      │
-- │ course.project_id = cohort.project_id (no se mezclan proyectos).        │
-- │                                                                          │
-- │ Scope: project_id → projects (con guard propia).                        │
-- │ RLS: patrón LaunchOS. SIN grant a cliente_role.                        │
-- ╰──────────────────────────────────────────────────────────────────────────╯

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) cohorts
--    - name: legible para el equipo ("Gen 2026 T1", "Grupo A", etc.).
--    - course_id: opcional. `on delete set null` para no romper cohorts si
--      un course se borra en cascada por su product.
--    - start_date / end_date: cronograma. end puede ser null si "abierto".
--    - status: 'planned' (aún no arrancó), 'active' (cursando ahora),
--      'finished' (terminó), 'cancelled'.
--    - unique(project_id, name): dos cohorts con el mismo nombre en el
--      mismo project sería confuso al operar. Nombres deben ser únicos.
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.cohorts (
  id           uuid        primary key default gen_random_uuid(),
  project_id   uuid        not null references public.projects(id) on delete cascade,
  course_id    uuid        references public.courses(id) on delete set null,
  name         text        not null,
  start_date   date,
  end_date     date,
  status       text        not null default 'planned'
                  check (status in ('planned','active','finished','cancelled')),
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (project_id, name),
  check (end_date is null or start_date is null or end_date >= start_date)
);

create index if not exists cohorts_project_idx on public.cohorts(project_id);
create index if not exists cohorts_course_idx  on public.cohorts(course_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) Trigger: si course_id está seteado, project_id de cohort debe coincidir
--    con project_id del course. Consistencia cross-tabla que no se puede
--    expresar en CHECK.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.cohorts_check_course_project()
returns trigger
language plpgsql
as $$
declare
  v_course_project uuid;
begin
  if new.course_id is null then
    return new;
  end if;

  select project_id into v_course_project
    from public.courses
   where id = new.course_id;

  if v_course_project is null then
    -- FK cubre esto, pero por completitud.
    raise exception 'cohorts: course % no existe', new.course_id
      using errcode = '23503';
  end if;

  if v_course_project <> new.project_id then
    raise exception
      'cohorts: course.project_id (%) no coincide con cohort.project_id (%). Academia no mezcla proyectos.',
      v_course_project, new.project_id
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists check_course_project on public.cohorts;
create trigger check_course_project
  before insert or update of project_id, course_id on public.cohorts
  for each row execute function public.cohorts_check_course_project();

drop trigger if exists guard_propia_project on public.cohorts;
create trigger guard_propia_project
  before insert or update of project_id on public.cohorts
  for each row execute function public.guard_propia_project();

drop trigger if exists set_updated_at on public.cohorts;
create trigger set_updated_at before update on public.cohorts
  for each row execute function public.set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- 3) RLS
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.cohorts enable row level security;
grant select, insert, update, delete on public.cohorts to authenticated;

drop policy if exists cohorts_select on public.cohorts;
create policy cohorts_select on public.cohorts
  for select to authenticated
  using (public.has_project_access(project_id));

drop policy if exists cohorts_insert on public.cohorts;
create policy cohorts_insert on public.cohorts
  for insert to authenticated
  with check (public.can_edit_project(project_id));

drop policy if exists cohorts_update on public.cohorts;
create policy cohorts_update on public.cohorts
  for update to authenticated
  using      (public.can_edit_project(project_id))
  with check (public.can_edit_project(project_id));

drop policy if exists cohorts_delete on public.cohorts;
create policy cohorts_delete on public.cohorts
  for delete to authenticated
  using (public.can_edit_project(project_id));
