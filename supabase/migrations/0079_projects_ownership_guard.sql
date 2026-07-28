-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Bloque 4 (Kingrow) — Guard sobre projects.ownership                      │
-- │                                                                          │
-- │ Regla: un project con datos de ACADEMIA colgados no puede cambiar de    │
-- │ ownership 'propia' a 'externa'. Motivo: los guards de academia          │
-- │ (`guard_propia_project`) validan la propiedad EN CADA INSERT/UPDATE de  │
-- │ la fila de academia — pero NO se revalidan si el project cambia por     │
-- │ debajo. Sin este trigger, quedarían filas de academia colgando de un    │
-- │ project no-propia, en un estado que la app trata como inválido y que    │
-- │ ningún check periódico detectaría.                                     │
-- │                                                                          │
-- │ Comportamiento: BEFORE UPDATE OF ownership on projects. Si el cambio    │
-- │ es 'propia' → cualquier otra cosa, y existen students / courses /       │
-- │ cohorts para ese project, se aborta con SQLSTATE 23514 y un mensaje    │
-- │ humano que dice qué falta resolver primero. Chequeamos SÓLO las 3       │
-- │ tablas "raíz" de academia (students, courses, cohorts) porque las      │
-- │ demás (classes, enrollments, attendance, exams, certificates) cuelgan  │
-- │ de esas — si no hay students/courses/cohorts, no puede haber nada más. │
-- │                                                                          │
-- │ Semántica: bloqueo DURO. Si algún día realmente hay que degradar un    │
-- │ project propio, primero se resuelve qué hacer con su academia          │
-- │ (borrado explícito, migración a otro project, etc.), a mano y a        │
-- │ conciencia. El trigger no ofrece salida silenciosa.                    │
-- ╰──────────────────────────────────────────────────────────────────────────╯

create or replace function public.projects_guard_ownership_downgrade()
returns trigger
language plpgsql
as $$
declare
  v_students int;
  v_courses  int;
  v_cohorts  int;
begin
  -- Sólo nos importa el downgrade propia → no-propia.
  if old.ownership is not distinct from new.ownership then
    return new;
  end if;
  if old.ownership <> 'propia' then
    return new;
  end if;

  select count(*) into v_students from public.students where project_id = old.id;
  select count(*) into v_courses  from public.courses  where project_id = old.id;
  select count(*) into v_cohorts  from public.cohorts  where project_id = old.id;

  if (v_students + v_courses + v_cohorts) > 0 then
    raise exception
      'projects: no se puede cambiar ownership de ''propia'' a ''%'' en el project % porque tiene academia colgada (students=%, courses=%, cohorts=%). Resolvé la academia primero (borrar o migrar) y volvé a intentar.',
      new.ownership, old.id, v_students, v_courses, v_cohorts
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists guard_ownership_downgrade on public.projects;
create trigger guard_ownership_downgrade
  before update of ownership on public.projects
  for each row execute function public.projects_guard_ownership_downgrade();
