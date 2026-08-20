-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ 0138 — tasks: enum de status + priority alineado con 0137               │
-- │                                                                          │
-- │ Mismos valores que internal_projects (una sola convención):              │
-- │   status:   sin_empezar, en_proceso, bloqueado, alerta_maxima, listo    │
-- │   priority: alta, media, baja                                            │
-- │                                                                          │
-- │ BACKFILL:                                                                │
-- │   status:                                                                │
-- │     todo      → sin_empezar                                              │
-- │     doing     → en_proceso                                               │
-- │     blocked   → bloqueado                                                │
-- │     done      → listo                                                    │
-- │     cancelled → listo   (colapsamos, no distinguimos cancelled de done) │
-- │   priority:                                                              │
-- │     urgent    → alta                                                     │
-- │     high      → alta                                                     │
-- │     med       → media                                                    │
-- │     low       → baja                                                     │
-- │                                                                          │
-- │ Efecto colateral: `computeThroughput` pierde la separación de           │
-- │ completadas vs canceladas — ya no es reconstruible. La UI deja de       │
-- │ mostrar "N canceladas" en el dashboard de Ops.                          │
-- ╰──────────────────────────────────────────────────────────────────────────╯

-- ─── 1) Drop checks + índices parciales que referencian valores viejos ─────
-- Los índices parciales tienen los valores literales en el WHERE — si no los
-- dropeamos primero, los updates disparan errores de constraint por CHECK
-- solo, pero los índices seguirían apuntando a valores que ya no existen y
-- no serían útiles (Postgres los tolera pero quedan muertos). Mejor rehacer.
drop index if exists public.tasks_org_open_due_idx;
drop index if exists public.tasks_assignee_open_idx;

alter table public.tasks
  drop constraint if exists tasks_status_check,
  drop constraint if exists tasks_priority_check;

-- ─── 2) Backfill datos ───────────────────────────────────────────────────────
update public.tasks set status = case status
  when 'todo'      then 'sin_empezar'
  when 'doing'     then 'en_proceso'
  when 'blocked'   then 'bloqueado'
  when 'done'      then 'listo'
  when 'cancelled' then 'listo'
  else status
end;

update public.tasks set priority = case priority
  when 'urgent' then 'alta'
  when 'high'   then 'alta'
  when 'med'    then 'media'
  when 'low'    then 'baja'
  else priority
end;

-- ─── 3) Nuevos check constraints ─────────────────────────────────────────────
alter table public.tasks
  add constraint tasks_status_check check (status in (
    'sin_empezar', 'en_proceso', 'bloqueado', 'alerta_maxima', 'listo'
  )),
  add constraint tasks_priority_check check (priority in (
    'alta', 'media', 'baja'
  ));

-- ─── 4) Defaults nuevos ──────────────────────────────────────────────────────
alter table public.tasks
  alter column status   set default 'sin_empezar',
  alter column priority set default 'media';

-- ─── 5) Recrear los índices parciales con los valores nuevos ─────────────────
create index if not exists tasks_org_open_due_idx
  on public.tasks(organization_id, due_on)
  where status in ('sin_empezar', 'en_proceso', 'bloqueado', 'alerta_maxima');

create index if not exists tasks_assignee_open_idx
  on public.tasks(assignee_id)
  where assignee_id is not null
    and status in ('sin_empezar', 'en_proceso', 'bloqueado', 'alerta_maxima');
