-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ 0145 — course_parameters: parámetros configurables por curso             │
-- │                                                                          │
-- │ Fase B del plan Academia. Cada curso puede declarar N parámetros que se │
-- │ setean a nivel alumno (via student_parameter_values, migración 0146).   │
-- │ Ejemplos:                                                                │
-- │   - Nitro:   "diagnostico_hecho" (boolean, required)                    │
-- │   - MdE:     "coaching_sessions" (integer)                              │
-- │   - Genérico: "objetivo_personal" (text)                                │
-- │                                                                          │
-- │ Diseño:                                                                 │
-- │   - course_id FK → courses (cascade on delete): borrar el curso también │
-- │       tira los parámetros (que a su vez cascadean los valores).         │
-- │   - project_id DENORM desde course (mismo patrón que course_modules).  │
-- │   - type ∈ (boolean, integer, text) — determina qué value_* se llena   │
-- │       en student_parameter_values (validado por trigger allí).         │
-- │   - key: identificador estable por curso (unique). label: display.     │
-- │   - order_index: orden de display; no unique — el reorder acepta       │
-- │       colisiones temporales, no vale la pena la unique constraint.    │
-- ╰──────────────────────────────────────────────────────────────────────────╯

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) course_parameters
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.course_parameters (
  id           uuid        primary key default gen_random_uuid(),
  course_id    uuid        not null references public.courses(id) on delete cascade,
  project_id   uuid        not null references public.projects(id) on delete cascade,
  key          text        not null,
  label        text        not null,
  type         text        not null
                 check (type in ('boolean','integer','text')),
  required     boolean     not null default false,
  order_index  integer     not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (course_id, key)
);

create index if not exists course_parameters_course_idx
  on public.course_parameters(course_id, order_index);
create index if not exists course_parameters_project_idx
  on public.course_parameters(project_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) Trigger de denormalización: copia courses.project_id → course_parameters
--    Nombre 'before_denorm_project_id_from_course' — 'b' < 'g' garantiza que
--    corre antes que guard_propia_project.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.course_parameters_denorm_project_id()
returns trigger
language plpgsql
as $$
begin
  select project_id into new.project_id
    from public.courses
   where id = new.course_id;
  return new;
end;
$$;

drop trigger if exists before_denorm_project_id_from_course on public.course_parameters;
create trigger before_denorm_project_id_from_course
  before insert or update of course_id on public.course_parameters
  for each row execute function public.course_parameters_denorm_project_id();

drop trigger if exists guard_propia_project on public.course_parameters;
create trigger guard_propia_project
  before insert or update of project_id on public.course_parameters
  for each row execute function public.guard_propia_project();

drop trigger if exists set_updated_at on public.course_parameters;
create trigger set_updated_at before update on public.course_parameters
  for each row execute function public.set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- 3) RLS — patrón LaunchOS
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.course_parameters enable row level security;
grant select, insert, update, delete on public.course_parameters to authenticated;

drop policy if exists course_parameters_select on public.course_parameters;
create policy course_parameters_select on public.course_parameters
  for select to authenticated
  using (public.has_project_access(project_id));

drop policy if exists course_parameters_insert on public.course_parameters;
create policy course_parameters_insert on public.course_parameters
  for insert to authenticated
  with check (public.can_edit_project(project_id));

drop policy if exists course_parameters_update on public.course_parameters;
create policy course_parameters_update on public.course_parameters
  for update to authenticated
  using      (public.can_edit_project(project_id))
  with check (public.can_edit_project(project_id));

drop policy if exists course_parameters_delete on public.course_parameters;
create policy course_parameters_delete on public.course_parameters
  for delete to authenticated
  using (public.can_edit_project(project_id));

-- ═══════════════════════════════════════════════════════════════════════════
-- 4) Comentarios
-- ═══════════════════════════════════════════════════════════════════════════
comment on table public.course_parameters is
  'Parámetros configurables por curso. Los valores por alumno viven en student_parameter_values.';
comment on column public.course_parameters.key is
  'Identificador estable dentro del curso (unique). Usado por integraciones.';
comment on column public.course_parameters.type is
  'boolean | integer | text — determina qué value_* del row de student_parameter_values se completa.';
