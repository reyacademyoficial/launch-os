-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ 0137 — internal_projects: enum de status + priority alineado a Notion   │
-- │                                                                          │
-- │ Nuevos valores unificados con `tasks` (0138):                            │
-- │   status:   sin_empezar, en_proceso, bloqueado, alerta_maxima, listo    │
-- │   priority: alta, media, baja                                            │
-- │                                                                          │
-- │ El estado "atrasado" NO es persistido — se deriva en el read-time (due_on│
-- │ < hoy AND status abierto). Motivo: la cron de Notion es la fuente de    │
-- │ verdad para el status y pisaría cualquier flip local.                    │
-- │                                                                          │
-- │ BACKFILL de datos existentes (irreversible salvo restore):               │
-- │   status:                                                                │
-- │     backlog  → sin_empezar                                               │
-- │     active   → en_proceso                                                │
-- │     paused   → bloqueado                                                 │
-- │     done     → listo                                                     │
-- │     archived → listo   (colapsamos con done, no distinguimos)            │
-- │   priority:                                                              │
-- │     urgent   → alta                                                      │
-- │     high     → alta                                                      │
-- │     med      → media                                                     │
-- │     low      → baja                                                      │
-- │                                                                          │
-- │ Orden obligado: DROP check → UPDATE datos → ADD check nuevo. Si          │
-- │ agregáramos primero el check nuevo, las filas existentes lo violarían.   │
-- ╰──────────────────────────────────────────────────────────────────────────╯

-- ─── 1) Drop check constraints viejos ────────────────────────────────────────
alter table public.internal_projects
  drop constraint if exists internal_projects_status_check,
  drop constraint if exists internal_projects_priority_check;

-- ─── 2) Backfill datos ───────────────────────────────────────────────────────
update public.internal_projects set status = case status
  when 'backlog'  then 'sin_empezar'
  when 'active'   then 'en_proceso'
  when 'paused'   then 'bloqueado'
  when 'done'     then 'listo'
  when 'archived' then 'listo'
  else status
end;

update public.internal_projects set priority = case priority
  when 'urgent' then 'alta'
  when 'high'   then 'alta'
  when 'med'    then 'media'
  when 'low'    then 'baja'
  else priority
end;

-- ─── 3) Nuevos check constraints ─────────────────────────────────────────────
alter table public.internal_projects
  add constraint internal_projects_status_check check (status in (
    'sin_empezar', 'en_proceso', 'bloqueado', 'alerta_maxima', 'listo'
  )),
  add constraint internal_projects_priority_check check (priority in (
    'alta', 'media', 'baja'
  ));

-- ─── 4) Defaults nuevos ──────────────────────────────────────────────────────
alter table public.internal_projects
  alter column status   set default 'sin_empezar',
  alter column priority set default 'media';

-- ─── 5) Recrear índice parcial que referenciaba valores viejos ───────────────
-- El índice de "abiertas" listaba done/archived (cerrados). Con el nuevo enum
-- el único cerrado es 'listo'.
drop index if exists public.internal_projects_org_open_due_idx;
create index if not exists internal_projects_org_open_due_idx
  on public.internal_projects(organization_id, due_on)
  where closed_at is null and status <> 'listo';
