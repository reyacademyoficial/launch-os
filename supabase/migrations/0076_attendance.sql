-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Bloque 4 (Kingrow) — Academia: `attendance`                              │
-- │                                                                          │
-- │ Registro de asistencia: por class + student, un booleano `present`      │
-- │ y notas opcionales. Un student puede tener 0 o 1 fila por class         │
-- │ (unique). La ausencia de fila se puede interpretar como "no registrado" │
-- │ (distinto de "ausente" explícito) — decisión de UX.                    │
-- │                                                                          │
-- │ project_id se DENORMALIZA desde class (cadena: class ← cohort ← project).│
-- │ Validación: class.project_id debe coincidir con student.project_id.     │
-- ╰──────────────────────────────────────────────────────────────────────────╯

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) attendance
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.attendance (
  id            uuid        primary key default gen_random_uuid(),
  class_id      uuid        not null references public.classes(id)  on delete cascade,
  student_id    uuid        not null references public.students(id) on delete cascade,
  project_id    uuid        not null references public.projects(id) on delete cascade,
  present       boolean     not null default true,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (class_id, student_id)
);

create index if not exists attendance_class_idx    on public.attendance(class_id);
create index if not exists attendance_student_idx  on public.attendance(student_id);
create index if not exists attendance_project_idx  on public.attendance(project_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) Trigger: derivar project_id desde class + consistency check con student
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.attendance_check_consistency()
returns trigger
language plpgsql
as $$
declare
  v_class_project   uuid;
  v_student_project uuid;
begin
  select project_id into v_class_project
    from public.classes  where id = new.class_id;
  select project_id into v_student_project
    from public.students where id = new.student_id;

  if v_class_project is null then
    raise exception 'attendance: class % no existe', new.class_id
      using errcode = '23503';
  end if;
  if v_student_project is null then
    raise exception 'attendance: student % no existe', new.student_id
      using errcode = '23503';
  end if;

  if v_class_project <> v_student_project then
    raise exception
      'attendance: student.project_id (%) no coincide con class.project_id (%). Academia no mezcla proyectos.',
      v_student_project, v_class_project
      using errcode = '23514';
  end if;

  new.project_id := v_class_project;
  return new;
end;
$$;

drop trigger if exists a_check_consistency on public.attendance;
create trigger a_check_consistency
  before insert or update of class_id, student_id, project_id on public.attendance
  for each row execute function public.attendance_check_consistency();

drop trigger if exists guard_propia_project on public.attendance;
create trigger guard_propia_project
  before insert or update of project_id on public.attendance
  for each row execute function public.guard_propia_project();

drop trigger if exists set_updated_at on public.attendance;
create trigger set_updated_at before update on public.attendance
  for each row execute function public.set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- 3) RLS
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.attendance enable row level security;
grant select, insert, update, delete on public.attendance to authenticated;

drop policy if exists attendance_select on public.attendance;
create policy attendance_select on public.attendance
  for select to authenticated
  using (public.has_project_access(project_id));

drop policy if exists attendance_insert on public.attendance;
create policy attendance_insert on public.attendance
  for insert to authenticated
  with check (public.can_edit_project(project_id));

drop policy if exists attendance_update on public.attendance;
create policy attendance_update on public.attendance
  for update to authenticated
  using      (public.can_edit_project(project_id))
  with check (public.can_edit_project(project_id));

drop policy if exists attendance_delete on public.attendance;
create policy attendance_delete on public.attendance
  for delete to authenticated
  using (public.can_edit_project(project_id));
