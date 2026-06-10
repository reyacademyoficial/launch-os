-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Phase 4a — Equipo + Pipeline de leads (CRM core)                         │
-- │                                                                          │
-- │ Decisiones del brief Fase 4:                                             │
-- │  - Los setters/closers NO son usuarios del sistema: son REGISTROS que    │
-- │    carga el equipo (no tocan la app, no entran en RLS de roles). Por eso │
-- │    `team_members` es solo metadata por proyecto, sin FK a auth.users.    │
-- │  - Los leads entran de dos orígenes: manual (ahora) y automático desde   │
-- │    integraciones (Meta/GHL, a futuro). La estructura soporta ambos       │
-- │    desde el día uno vía `source`. El flujo automático se deja PREPARADO │
-- │    y DESCONECTADO — el helper `insert_lead_from_provider` queda como     │
-- │    gancho documentado pero no se expone todavía.                        │
-- │                                                                          │
-- │ Permisos (centralizado en los helpers existentes):                      │
-- │  - SELECT  → has_project_access(project_id)        (todo miembro lee)   │
-- │  - I/U/D   → can_edit_launches_in(project_id)      (operador + admin +  │
-- │              superadmin escriben — analista y cliente NO).              │
-- │                                                                          │
-- │ El brief lista al operador en "los que manejan datos" y el operador es  │
-- │ exactamente el rol que carga leads/ventas día a día. Por eso usamos     │
-- │ can_edit_launches_in (admin+operador) y no can_edit_project (admin     │
-- │ only). En 4b la regla de comisión sí va a can_edit_project.            │
-- ╰──────────────────────────────────────────────────────────────────────────╯

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) team_members — registros del equipo por proyecto
--    `role` enumera las funciones del equipo de ventas/ads. Lo dejamos como
--    text + check para que el equipo pueda extender sin migración mayor.
--    `commission_rate` es un % de fallback informativo a nivel miembro. La
--    regla autoritativa de comisión vive en `commission_rules` (Fase 4b)
--    keyada por modalidad de pago + launch override. Si en 4b se decide que
--    el override per-member es innecesario, esta columna se deprecará allí.
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.team_members (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null references public.projects(id) on delete cascade,
  name             text not null,
  role             text not null check (role in (
    'setter', 'closer', 'media_buyer', 'manager', 'otro'
  )),
  commission_rate  numeric,
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists team_members_project_idx
  on public.team_members(project_id);
create index if not exists team_members_project_active_idx
  on public.team_members(project_id, active);

alter table public.team_members enable row level security;
grant select, insert, update, delete on public.team_members to authenticated;

drop trigger if exists set_updated_at on public.team_members;
create trigger set_updated_at before update on public.team_members
  for each row execute function public.set_updated_at();

drop policy if exists team_members_select on public.team_members;
create policy team_members_select on public.team_members
  for select to authenticated
  using (public.has_project_access(project_id));

drop policy if exists team_members_insert on public.team_members;
create policy team_members_insert on public.team_members
  for insert to authenticated
  with check (public.can_edit_launches_in(project_id));

drop policy if exists team_members_update on public.team_members;
create policy team_members_update on public.team_members
  for update to authenticated
  using      (public.can_edit_launches_in(project_id))
  with check (public.can_edit_launches_in(project_id));

drop policy if exists team_members_delete on public.team_members;
create policy team_members_delete on public.team_members
  for delete to authenticated
  using (public.can_edit_launches_in(project_id));

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) leads — pipeline de leads, con origen auditable
--    `launch_id` es opcional: un lead puede entrar sin launch asociado y
--    asignarse después. `team_member_id` también opcional (lead sin dueño).
--    `source` default 'manual'. Los providers automáticos (meta/ghl/...) van a
--    setear este campo cuando se cablee el camino auto en una fase posterior.
--    `status` cubre el pipeline canónico del brief: nuevo → contactado →
--    calificado → agendado → cerrado | perdido.
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.leads (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.projects(id) on delete cascade,
  launch_id       uuid references public.launches(id) on delete set null,
  team_member_id  uuid references public.team_members(id) on delete set null,

  name            text not null,
  contact         text,
  source          text not null default 'manual' check (source in (
    'manual', 'meta', 'ghl', 'otro'
  )),
  status          text not null default 'nuevo' check (status in (
    'nuevo', 'contactado', 'calificado', 'agendado', 'cerrado', 'perdido'
  )),
  notes           text,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists leads_project_idx
  on public.leads(project_id);
create index if not exists leads_project_status_idx
  on public.leads(project_id, status);
create index if not exists leads_launch_idx
  on public.leads(launch_id) where launch_id is not null;
create index if not exists leads_team_member_idx
  on public.leads(team_member_id) where team_member_id is not null;

alter table public.leads enable row level security;
grant select, insert, update, delete on public.leads to authenticated;

drop trigger if exists set_updated_at on public.leads;
create trigger set_updated_at before update on public.leads
  for each row execute function public.set_updated_at();

drop policy if exists leads_select on public.leads;
create policy leads_select on public.leads
  for select to authenticated
  using (public.has_project_access(project_id));

drop policy if exists leads_insert on public.leads;
create policy leads_insert on public.leads
  for insert to authenticated
  with check (public.can_edit_launches_in(project_id));

drop policy if exists leads_update on public.leads;
create policy leads_update on public.leads
  for update to authenticated
  using      (public.can_edit_launches_in(project_id))
  with check (public.can_edit_launches_in(project_id));

drop policy if exists leads_delete on public.leads;
create policy leads_delete on public.leads
  for delete to authenticated
  using (public.can_edit_launches_in(project_id));

-- ═══════════════════════════════════════════════════════════════════════════
-- 3) Gancho documentado para entrada AUTOMÁTICA de leads (NO se cablea acá)
--
-- Cuando las integraciones (Fase 3 / posteriores) empiecen a emitir leads,
-- el camino esperado es:
--   - El sync corre como service-role (bypasea RLS, igual que
--     launch_daily_ads / integration_runs).
--   - Inserta filas en `public.leads` con `source` = provider (meta/ghl/...).
--   - El resto del pipeline (kanban, asignación, status) funciona idéntico al
--     manual — son los mismos campos.
--
-- No exponemos un endpoint dedicado todavía: lo dejamos sin función pública
-- para evitar que el camino "automático" se use por accidente antes de tener
-- la integración real. Cuando esté listo, agregar acá una función SECURITY
-- DEFINER `insert_lead_from_provider(p_launch_id, p_provider, p_payload jsonb)`
-- que valide el provider y normalice el payload antes del insert.
-- ═══════════════════════════════════════════════════════════════════════════
