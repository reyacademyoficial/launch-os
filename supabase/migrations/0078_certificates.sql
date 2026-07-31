-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Bloque 4 (Kingrow) — Academia: `certificates`                            │
-- │                                                                          │
-- │ Un certificate se emite a un student por haber completado un course.    │
-- │ La granularidad es (student, course): un student no puede tener dos     │
-- │ certificados del mismo course (unique). Si se re-emite, se actualiza    │
-- │ la fila existente (issue_number/notes cambian, code queda igual).       │
-- │                                                                          │
-- │ code: string humano-legible ("REY-2026-0042"). Único global — un        │
-- │ certificado debería ser verificable con un solo código, sin necesitar   │
-- │ el project. Nullable para permitir "emitido pero código pendiente".     │
-- │                                                                          │
-- │ project_id se DENORMALIZA desde course. Consistency check con student.  │
-- ╰──────────────────────────────────────────────────────────────────────────╯

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) certificates
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.certificates (
  id           uuid        primary key default gen_random_uuid(),
  student_id   uuid        not null references public.students(id) on delete cascade,
  course_id    uuid        not null references public.courses(id)  on delete cascade,
  project_id   uuid        not null references public.projects(id) on delete cascade,
  code         text        unique,
  issued_at    date        not null default current_date,
  url          text,
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (student_id, course_id)
);

create index if not exists certificates_student_idx  on public.certificates(student_id);
create index if not exists certificates_course_idx   on public.certificates(course_id);
create index if not exists certificates_project_idx  on public.certificates(project_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) Trigger: derivar project_id desde course + consistency con student
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.certificates_check_consistency()
returns trigger
language plpgsql
as $$
declare
  v_course_project  uuid;
  v_student_project uuid;
begin
  select project_id into v_course_project
    from public.courses  where id = new.course_id;
  select project_id into v_student_project
    from public.students where id = new.student_id;

  if v_course_project is null then
    raise exception 'certificates: course % no existe', new.course_id
      using errcode = '23503';
  end if;
  if v_student_project is null then
    raise exception 'certificates: student % no existe', new.student_id
      using errcode = '23503';
  end if;

  if v_course_project <> v_student_project then
    raise exception
      'certificates: student.project_id (%) no coincide con course.project_id (%). Academia no mezcla proyectos.',
      v_student_project, v_course_project
      using errcode = '23514';
  end if;

  new.project_id := v_course_project;
  return new;
end;
$$;

drop trigger if exists a_check_consistency on public.certificates;
create trigger a_check_consistency
  before insert or update of student_id, course_id, project_id on public.certificates
  for each row execute function public.certificates_check_consistency();

drop trigger if exists guard_propia_project on public.certificates;
create trigger guard_propia_project
  before insert or update of project_id on public.certificates
  for each row execute function public.guard_propia_project();

drop trigger if exists set_updated_at on public.certificates;
create trigger set_updated_at before update on public.certificates
  for each row execute function public.set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- 3) RLS
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.certificates enable row level security;
grant select, insert, update, delete on public.certificates to authenticated;

drop policy if exists certificates_select on public.certificates;
create policy certificates_select on public.certificates
  for select to authenticated
  using (public.has_project_access(project_id));

drop policy if exists certificates_insert on public.certificates;
create policy certificates_insert on public.certificates
  for insert to authenticated
  with check (public.can_edit_project(project_id));

drop policy if exists certificates_update on public.certificates;
create policy certificates_update on public.certificates
  for update to authenticated
  using      (public.can_edit_project(project_id))
  with check (public.can_edit_project(project_id));

drop policy if exists certificates_delete on public.certificates;
create policy certificates_delete on public.certificates
  for delete to authenticated
  using (public.can_edit_project(project_id));
