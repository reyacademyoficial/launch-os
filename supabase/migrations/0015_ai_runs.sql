-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Phase 4 follow-up — Historial de análisis IA por lanzamiento            │
-- │                                                                          │
-- │ El AISummary actual genera y muestra el output sin persistir. Esta      │
-- │ migración agrega `ai_runs` para guardar cada ejecución y poder mostrar  │
-- │ el historial en la tab IA del detalle del launch.                       │
-- │                                                                          │
-- │ Modelo:                                                                  │
-- │   - Una fila por ejecución (no edit/undo — el historial es inmutable;   │
-- │     si querés purgar, hacé DELETE).                                     │
-- │   - `output_text` guarda el resultado completo (markdown). Es el valor  │
-- │     del historial.                                                     │
-- │   - `error_detail jsonb` cubre runs que fallaron (status='error') —    │
-- │     sirve para debug; no se renderiza en UI por ahora.                  │
-- │                                                                          │
-- │ Permisos:                                                                │
-- │   - SELECT  → has_project_access (todo el equipo del proyecto ve qué   │
-- │     se generó — útil para revisar antes de regenerar).                 │
-- │   - INSERT  → can_edit_launches_in (admin + operador disparan análisis).│
-- │   - UPDATE  → BLINDADA (historial inmutable).                          │
-- │   - DELETE  → can_edit_project (solo admin/superadmin purga).         │
-- ╰──────────────────────────────────────────────────────────────────────────╯

create table if not exists public.ai_runs (
  id            uuid primary key default gen_random_uuid(),
  launch_id     uuid not null references public.launches(id) on delete cascade,
  project_id    uuid not null references public.projects(id) on delete cascade,
  user_id       uuid references auth.users(id) on delete set null,

  model         text not null,
  status        text not null default 'success'
                check (status in ('success', 'error')),
  output_text   text,
  error_detail  jsonb,

  created_at    timestamptz not null default now()
);

create index if not exists ai_runs_launch_idx
  on public.ai_runs(launch_id, created_at desc);
create index if not exists ai_runs_project_idx
  on public.ai_runs(project_id, created_at desc);

alter table public.ai_runs enable row level security;
grant select, insert, delete on public.ai_runs to authenticated;
-- Historial inmutable: Supabase aplica `alter default privileges … grant all on
-- tables to authenticated` en `public`, así que un simple `grant select,insert,
-- delete` no alcanza para bloquear UPDATE — hay que revocarlo explícitamente.
revoke update on public.ai_runs from authenticated;

drop policy if exists ai_runs_select on public.ai_runs;
create policy ai_runs_select on public.ai_runs
  for select to authenticated
  using (public.has_project_access(project_id));

drop policy if exists ai_runs_insert on public.ai_runs;
create policy ai_runs_insert on public.ai_runs
  for insert to authenticated
  with check (public.can_edit_launches_in(project_id));

drop policy if exists ai_runs_delete on public.ai_runs;
create policy ai_runs_delete on public.ai_runs
  for delete to authenticated
  using (public.can_edit_project(project_id));
