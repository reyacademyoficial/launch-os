-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ 0151 — cohorts.system_id: linkeo opcional a un sistema del curso         │
-- │                                                                          │
-- │ Fase E del plan Academia. Una cohorte puede pertenecer a UN sistema del │
-- │ curso al que pertenece (ej: la Gen 2026-Q1 de Nitro cursa el sistema    │
-- │ Producto). Es nullable — las cohortes viejas o cursos sin has_systems   │
-- │ quedan con NULL.                                                        │
-- │                                                                          │
-- │ Consistencia: si system_id no es null, system.course_id debe coincidir  │
-- │ con cohort.course_id. Un sistema del curso X no puede asignarse a una  │
-- │ cohorte del curso Y.                                                    │
-- │                                                                          │
-- │ Orden de triggers en cohorts (post 0073):                              │
-- │   - check_course_project (before insert/update project_id, course_id)  │
-- │   - guard_propia_project (before insert/update project_id)             │
-- │   - set_updated_at        (before update)                             │
-- │                                                                          │
-- │ Este trigger va con prefijo 'check_' (nombre canónico) y filtra por    │
-- │ system_id y course_id — corre antes del guard (alfabético 'c' < 'g'). │
-- │ La validación es independiente de las otras.                           │
-- ╰──────────────────────────────────────────────────────────────────────────╯

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) Nueva columna
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.cohorts
  add column if not exists system_id uuid
    references public.academia_systems(id) on delete set null;

create index if not exists cohorts_system_idx on public.cohorts(system_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) Trigger de consistencia system.course_id = cohort.course_id
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.cohorts_check_system_consistency()
returns trigger
language plpgsql
as $$
declare
  v_system_course uuid;
begin
  if new.system_id is null then
    return new;
  end if;

  select course_id into v_system_course
    from public.academia_systems
   where id = new.system_id;

  if v_system_course is null then
    raise exception 'cohorts: academia_system % no existe', new.system_id
      using errcode = '23503';
  end if;

  if new.course_id is null then
    raise exception
      'cohorts: no se puede asignar un sistema si la cohorte no tiene curso (system.course_id = %).',
      v_system_course
      using errcode = '23514';
  end if;

  if v_system_course <> new.course_id then
    raise exception
      'cohorts: system.course_id (%) no coincide con cohort.course_id (%). El sistema debe pertenecer al mismo curso que la cohorte.',
      v_system_course, new.course_id
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists check_system_consistency on public.cohorts;
create trigger check_system_consistency
  before insert or update of system_id, course_id on public.cohorts
  for each row execute function public.cohorts_check_system_consistency();

-- ═══════════════════════════════════════════════════════════════════════════
-- 3) Comentario
-- ═══════════════════════════════════════════════════════════════════════════
comment on column public.cohorts.system_id is
  'Sistema del curso al que pertenece la cohorte (opcional, solo si el curso tiene has_systems=true).';
