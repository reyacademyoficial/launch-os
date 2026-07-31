-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Bloque 4 (Kingrow) — Academia: `exams`                                   │
-- │                                                                          │
-- │ Cada fila = un examen RENDIDO por un student en una cohort. La          │
-- │ granularidad es fina a propósito: si mañana el negocio quiere un        │
-- │ "template + resultados por alumno", se agrega una tabla `exam_templates`│
-- │ separada. Hoy, un exam = un resultado.                                  │
-- │                                                                          │
-- │ Campos:                                                                 │
-- │   - score: 0..100. Nullable si el examen está PENDIENTE (aún no se      │
-- │     corrigió). El check permite null o rango.                           │
-- │   - passed: bool computado offline por el operador (algunos cursos      │
-- │     tienen umbral distinto — no lo hardcodeamos).                      │
-- │   - title: nombre humano del examen ("Parcial 1", "Final").             │
-- │                                                                          │
-- │ project_id se DENORMALIZA desde cohort. Consistency check con student.  │
-- ╰──────────────────────────────────────────────────────────────────────────╯

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) exams
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.exams (
  id           uuid        primary key default gen_random_uuid(),
  student_id   uuid        not null references public.students(id) on delete cascade,
  cohort_id    uuid        not null references public.cohorts(id)  on delete cascade,
  project_id   uuid        not null references public.projects(id) on delete cascade,
  title        text        not null,
  score        numeric(5,2) check (score is null or (score >= 0 and score <= 100)),
  passed       boolean,
  taken_at     date        not null default current_date,
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists exams_student_idx  on public.exams(student_id);
create index if not exists exams_cohort_idx   on public.exams(cohort_id);
create index if not exists exams_project_idx  on public.exams(project_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) Trigger: derivar project_id desde cohort + consistency con student
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.exams_check_consistency()
returns trigger
language plpgsql
as $$
declare
  v_cohort_project  uuid;
  v_student_project uuid;
begin
  select project_id into v_cohort_project
    from public.cohorts  where id = new.cohort_id;
  select project_id into v_student_project
    from public.students where id = new.student_id;

  if v_cohort_project is null then
    raise exception 'exams: cohort % no existe', new.cohort_id
      using errcode = '23503';
  end if;
  if v_student_project is null then
    raise exception 'exams: student % no existe', new.student_id
      using errcode = '23503';
  end if;

  if v_cohort_project <> v_student_project then
    raise exception
      'exams: student.project_id (%) no coincide con cohort.project_id (%). Academia no mezcla proyectos.',
      v_student_project, v_cohort_project
      using errcode = '23514';
  end if;

  new.project_id := v_cohort_project;
  return new;
end;
$$;

drop trigger if exists a_check_consistency on public.exams;
create trigger a_check_consistency
  before insert or update of student_id, cohort_id, project_id on public.exams
  for each row execute function public.exams_check_consistency();

drop trigger if exists guard_propia_project on public.exams;
create trigger guard_propia_project
  before insert or update of project_id on public.exams
  for each row execute function public.guard_propia_project();

drop trigger if exists set_updated_at on public.exams;
create trigger set_updated_at before update on public.exams
  for each row execute function public.set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- 3) RLS
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.exams enable row level security;
grant select, insert, update, delete on public.exams to authenticated;

drop policy if exists exams_select on public.exams;
create policy exams_select on public.exams
  for select to authenticated
  using (public.has_project_access(project_id));

drop policy if exists exams_insert on public.exams;
create policy exams_insert on public.exams
  for insert to authenticated
  with check (public.can_edit_project(project_id));

drop policy if exists exams_update on public.exams;
create policy exams_update on public.exams
  for update to authenticated
  using      (public.can_edit_project(project_id))
  with check (public.can_edit_project(project_id));

drop policy if exists exams_delete on public.exams;
create policy exams_delete on public.exams
  for delete to authenticated
  using (public.can_edit_project(project_id));
