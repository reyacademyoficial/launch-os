-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ 0146 — student_parameter_values: valor de un parámetro para un enrollment │
-- │                                                                          │
-- │ Fase B del plan Academia. Cada (enrollment, parameter) tiene un único   │
-- │ valor. El campo value_* usado depende del `type` del parameter:         │
-- │   - type=boolean  → value_bool  no null, otros null                     │
-- │   - type=integer  → value_int   no null, otros null                     │
-- │   - type=text     → value_text  no null, otros null                     │
-- │ El trigger a_check_value_shape valida esto en insert/update.            │
-- │                                                                          │
-- │ Diseño:                                                                 │
-- │   - enrollment_id FK → enrollments (cascade). Un alumno tiene un valor │
-- │       distinto por cada inscripción — si cursa el mismo curso 2 veces, │
-- │       tiene 2 valores. La generación es la unidad de "instancia".      │
-- │   - parameter_id FK → course_parameters (cascade). Si se borra el      │
-- │       parámetro, se van sus valores.                                    │
-- │   - project_id DENORM desde enrollment (que a su vez matchea course).  │
-- │   - updated_by FK a auth.users (nullable — llenado por app, no trigger).│
-- ╰──────────────────────────────────────────────────────────────────────────╯

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) student_parameter_values
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.student_parameter_values (
  id             uuid        primary key default gen_random_uuid(),
  enrollment_id  uuid        not null references public.enrollments(id) on delete cascade,
  parameter_id   uuid        not null references public.course_parameters(id) on delete cascade,
  project_id     uuid        not null references public.projects(id) on delete cascade,
  value_bool     boolean,
  value_int      integer,
  value_text     text,
  updated_at     timestamptz not null default now(),
  updated_by     uuid        references auth.users(id) on delete set null,
  unique (enrollment_id, parameter_id)
);

create index if not exists student_parameter_values_enrollment_idx
  on public.student_parameter_values(enrollment_id);
create index if not exists student_parameter_values_parameter_idx
  on public.student_parameter_values(parameter_id);
create index if not exists student_parameter_values_project_idx
  on public.student_parameter_values(project_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) Trigger de denormalización: copia enrollment.project_id → spv.project_id
--    Nombre 'a_denorm_project_id' — 'a' antepuesto garantiza orden antes que
--    'guard_propia_project' y 'b_check_value_shape'.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.student_parameter_values_denorm_project_id()
returns trigger
language plpgsql
as $$
begin
  select project_id into new.project_id
    from public.enrollments
   where id = new.enrollment_id;
  return new;
end;
$$;

drop trigger if exists a_denorm_project_id on public.student_parameter_values;
create trigger a_denorm_project_id
  before insert or update of enrollment_id on public.student_parameter_values
  for each row execute function public.student_parameter_values_denorm_project_id();

-- ═══════════════════════════════════════════════════════════════════════════
-- 3) Trigger de validación de shape: value_* debe matchear parameter.type
--    Nombre 'b_check_value_shape' — corre después de la denorm ('a') pero
--    antes del guard ('g'). No es indispensable el orden vs guard, pero
--    mantenemos la convención alfabética por consistencia.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.student_parameter_values_check_shape()
returns trigger
language plpgsql
as $$
declare
  v_type text;
begin
  select type into v_type
    from public.course_parameters
   where id = new.parameter_id;

  if v_type is null then
    raise exception 'student_parameter_values: parameter % no existe',
      new.parameter_id using errcode = '23503';
  end if;

  if v_type = 'boolean' then
    if new.value_bool is null then
      raise exception 'student_parameter_values: parameter tipo boolean requiere value_bool no null'
        using errcode = '23514';
    end if;
    if new.value_int is not null or new.value_text is not null then
      raise exception 'student_parameter_values: parameter tipo boolean solo acepta value_bool (dejar value_int y value_text en null)'
        using errcode = '23514';
    end if;
  elsif v_type = 'integer' then
    if new.value_int is null then
      raise exception 'student_parameter_values: parameter tipo integer requiere value_int no null'
        using errcode = '23514';
    end if;
    if new.value_bool is not null or new.value_text is not null then
      raise exception 'student_parameter_values: parameter tipo integer solo acepta value_int (dejar value_bool y value_text en null)'
        using errcode = '23514';
    end if;
  elsif v_type = 'text' then
    if new.value_text is null then
      raise exception 'student_parameter_values: parameter tipo text requiere value_text no null'
        using errcode = '23514';
    end if;
    if new.value_bool is not null or new.value_int is not null then
      raise exception 'student_parameter_values: parameter tipo text solo acepta value_text (dejar value_bool y value_int en null)'
        using errcode = '23514';
    end if;
  else
    raise exception 'student_parameter_values: parameter.type % desconocido', v_type
      using errcode = '23514';
  end if;

  -- Mantener updated_at fresco en cada write (además del set_updated_at que
  -- corre en UPDATE — este cubre INSERT también).
  new.updated_at := now();

  return new;
end;
$$;

drop trigger if exists b_check_value_shape on public.student_parameter_values;
create trigger b_check_value_shape
  before insert or update on public.student_parameter_values
  for each row execute function public.student_parameter_values_check_shape();

drop trigger if exists guard_propia_project on public.student_parameter_values;
create trigger guard_propia_project
  before insert or update of project_id on public.student_parameter_values
  for each row execute function public.guard_propia_project();

-- set_updated_at no hace falta como trigger separado — el shape trigger ya
-- setea now(). Lo dejamos comentado para documentar la decisión.
-- (No set_updated_at trigger — handled inside b_check_value_shape.)

-- ═══════════════════════════════════════════════════════════════════════════
-- 4) RLS — patrón LaunchOS
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.student_parameter_values enable row level security;
grant select, insert, update, delete on public.student_parameter_values to authenticated;

drop policy if exists student_parameter_values_select on public.student_parameter_values;
create policy student_parameter_values_select on public.student_parameter_values
  for select to authenticated
  using (public.has_project_access(project_id));

drop policy if exists student_parameter_values_insert on public.student_parameter_values;
create policy student_parameter_values_insert on public.student_parameter_values
  for insert to authenticated
  with check (public.can_edit_project(project_id));

drop policy if exists student_parameter_values_update on public.student_parameter_values;
create policy student_parameter_values_update on public.student_parameter_values
  for update to authenticated
  using      (public.can_edit_project(project_id))
  with check (public.can_edit_project(project_id));

drop policy if exists student_parameter_values_delete on public.student_parameter_values;
create policy student_parameter_values_delete on public.student_parameter_values
  for delete to authenticated
  using (public.can_edit_project(project_id));

-- ═══════════════════════════════════════════════════════════════════════════
-- 5) Comentarios
-- ═══════════════════════════════════════════════════════════════════════════
comment on table public.student_parameter_values is
  'Valor de un parámetro (course_parameters) para un enrollment. Único por (enrollment, parameter). El trigger b_check_value_shape valida que el value_* seteado matchee parameter.type.';
comment on column public.student_parameter_values.updated_by is
  'auth.users.id del usuario que actualizó por última vez. Poblado por la app, nullable si se pierde el link.';
