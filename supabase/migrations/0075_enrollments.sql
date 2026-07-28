-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Bloque 4 (Kingrow) — Academia: `enrollments` (student ↔ cohort junction) │
-- │                                                                          │
-- │ Registra que un student está inscripto en una cohort, con estado y      │
-- │ progreso. Un student puede estar en varias cohorts (varios cursos), y   │
-- │ una cohort tiene varios students. unique(student_id, cohort_id) evita   │
-- │ duplicar la misma inscripción.                                          │
-- │                                                                          │
-- │ project_id se DENORMALIZA desde cohort (source of truth de la cohorte). │
-- │ Además se valida que student.project_id = cohort.project_id — academia  │
-- │ no cruza proyectos.                                                     │
-- │                                                                          │
-- │ Puerta futura: si mañana se decide trazar "esta inscripción viene de    │
-- │ esta venta", basta con agregar `sale_id uuid references sales(id)` a    │
-- │ esta tabla — sin migrar datos. Hoy no se hace para preservar la         │
-- │ separación student ≠ lead ≠ cliente.                                    │
-- ╰──────────────────────────────────────────────────────────────────────────╯

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) enrollments
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.enrollments (
  id                uuid        primary key default gen_random_uuid(),
  student_id        uuid        not null references public.students(id) on delete cascade,
  cohort_id         uuid        not null references public.cohorts(id)  on delete cascade,
  project_id        uuid        not null references public.projects(id) on delete cascade,
  enrolled_at       date        not null default current_date,
  status            text        not null default 'active'
                       check (status in ('active','completed','dropped','suspended')),
  progress_percent  numeric(5,2) not null default 0
                       check (progress_percent >= 0 and progress_percent <= 100),
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (student_id, cohort_id)
);

create index if not exists enrollments_student_idx  on public.enrollments(student_id);
create index if not exists enrollments_cohort_idx   on public.enrollments(cohort_id);
create index if not exists enrollments_project_idx  on public.enrollments(project_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) Trigger: derivar project_id desde cohort + validar consistencia student
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.enrollments_check_consistency()
returns trigger
language plpgsql
as $$
declare
  v_cohort_project  uuid;
  v_student_project uuid;
begin
  select project_id into v_cohort_project
    from public.cohorts where id = new.cohort_id;
  select project_id into v_student_project
    from public.students where id = new.student_id;

  if v_cohort_project is null then
    raise exception 'enrollments: cohort % no existe', new.cohort_id
      using errcode = '23503';
  end if;
  if v_student_project is null then
    raise exception 'enrollments: student % no existe', new.student_id
      using errcode = '23503';
  end if;

  if v_cohort_project <> v_student_project then
    raise exception
      'enrollments: student.project_id (%) no coincide con cohort.project_id (%). Academia no mezcla proyectos.',
      v_student_project, v_cohort_project
      using errcode = '23514';
  end if;

  -- Denorm: gana el proyecto de la cohort (== student, por el check).
  new.project_id := v_cohort_project;
  return new;
end;
$$;

-- 'a_' antepuesto para garantizar orden < 'guard_...'
drop trigger if exists a_check_consistency on public.enrollments;
create trigger a_check_consistency
  before insert or update of student_id, cohort_id, project_id on public.enrollments
  for each row execute function public.enrollments_check_consistency();

drop trigger if exists guard_propia_project on public.enrollments;
create trigger guard_propia_project
  before insert or update of project_id on public.enrollments
  for each row execute function public.guard_propia_project();

drop trigger if exists set_updated_at on public.enrollments;
create trigger set_updated_at before update on public.enrollments
  for each row execute function public.set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- 3) RLS
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.enrollments enable row level security;
grant select, insert, update, delete on public.enrollments to authenticated;

drop policy if exists enrollments_select on public.enrollments;
create policy enrollments_select on public.enrollments
  for select to authenticated
  using (public.has_project_access(project_id));

drop policy if exists enrollments_insert on public.enrollments;
create policy enrollments_insert on public.enrollments
  for insert to authenticated
  with check (public.can_edit_project(project_id));

drop policy if exists enrollments_update on public.enrollments;
create policy enrollments_update on public.enrollments
  for update to authenticated
  using      (public.can_edit_project(project_id))
  with check (public.can_edit_project(project_id));

drop policy if exists enrollments_delete on public.enrollments;
create policy enrollments_delete on public.enrollments
  for delete to authenticated
  using (public.can_edit_project(project_id));
