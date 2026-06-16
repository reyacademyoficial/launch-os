-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Phase 7b — Reglas de alertas por umbral                                  │
-- │                                                                          │
-- │ El equipo configura umbrales por launch ("CPL > $X", "inversión del día │
-- │ > $Y", "sin leads hace N días"). Cuando entran datos nuevos (sync OK o  │
-- │ daily manual cargado), el evaluator corre, compara contra el estado     │
-- │ actual del launch y emite una notificación deduplicada por (launch,     │
-- │ rule, día) si cruzó.                                                    │
-- │                                                                          │
-- │ Decisiones:                                                              │
-- │   - 3 métricas hardcoded (CHECK): cpl / inversion / sin_leads. Si       │
-- │     querés sumar otras, requiere migración + lógica nueva en evaluate.  │
-- │   - 4 operadores: >, >=, <, <=. Para `sin_leads` se ignora — el         │
-- │     evaluator chequea "días consecutivos sin leads >= threshold".      │
-- │     La policy de input igual obliga uno (default '>=').                │
-- │   - UNIQUE (launch_id, metric, operator, threshold) bloquea duplicados │
-- │     exactos. Querés varias reglas de cpl con thresholds distintos? OK; │
-- │     querés "CPL > 20" dos veces? bloqueado.                            │
-- │   - Permisos (split como en F4):                                       │
-- │       SELECT  → has_project_access                                     │
-- │       I/U/D   → can_edit_launches_in (admin/operador, NO analista)    │
-- │       cliente_role: SIN grant (no aplica al cliente).                  │
-- ╰──────────────────────────────────────────────────────────────────────────╯

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) Helper project_of_launch ya existe (mig 0002). Se reutiliza para RLS.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.alert_rules (
  id          uuid primary key default gen_random_uuid(),
  launch_id   uuid not null references public.launches(id) on delete cascade,

  metric      text not null check (metric in ('cpl', 'inversion', 'sin_leads')),
  operator    text not null check (operator in ('>', '>=', '<', '<=')),
  threshold   numeric not null check (threshold >= 0),
  active      boolean not null default true,

  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  unique (launch_id, metric, operator, threshold)
);

create index if not exists alert_rules_launch_idx
  on public.alert_rules(launch_id);
create index if not exists alert_rules_launch_active_idx
  on public.alert_rules(launch_id, active)
  where active = true;

alter table public.alert_rules enable row level security;

-- Grants: equipo CRUD, cliente NO toca. Sin grant a cliente_role → 42501.
grant select, insert, update, delete on public.alert_rules to authenticated;

drop trigger if exists set_updated_at on public.alert_rules;
create trigger set_updated_at before update on public.alert_rules
  for each row execute function public.set_updated_at();

-- RLS — resolución del project_id via helper para no escanear launches en
-- cada policy.
drop policy if exists alert_rules_select on public.alert_rules;
create policy alert_rules_select on public.alert_rules
  for select to authenticated
  using (public.has_project_access(public.project_of_launch(launch_id)));

drop policy if exists alert_rules_insert on public.alert_rules;
create policy alert_rules_insert on public.alert_rules
  for insert to authenticated
  with check (public.can_edit_launches_in(public.project_of_launch(launch_id)));

drop policy if exists alert_rules_update on public.alert_rules;
create policy alert_rules_update on public.alert_rules
  for update to authenticated
  using      (public.can_edit_launches_in(public.project_of_launch(launch_id)))
  with check (public.can_edit_launches_in(public.project_of_launch(launch_id)));

drop policy if exists alert_rules_delete on public.alert_rules;
create policy alert_rules_delete on public.alert_rules
  for delete to authenticated
  using (public.can_edit_launches_in(public.project_of_launch(launch_id)));
