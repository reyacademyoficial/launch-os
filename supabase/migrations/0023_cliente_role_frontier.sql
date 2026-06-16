-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Phase 6 — Portal del cliente: frontera DB pura para el rol `cliente`     │
-- │                                                                          │
-- │ El rol `cliente` ya existe a nivel `profiles.role`. Hasta acá, RLS lo    │
-- │ trataba igual que cualquier miembro: `has_project_access(project_id)`   │
-- │ le abría la lectura de team_members / payment_modalities /              │
-- │ commission_rules / sales completas (incluido `team_member_id`).         │
-- │ La UI ocultaba esas secciones pero el dato seguía pidible por API.      │
-- │                                                                          │
-- │ Esta migración mueve la frontera al motor: el cliente entra a PostgREST │
-- │ con un rol Postgres distinto (`cliente_role`) que NO tiene `grant` a    │
-- │ las tablas "cocina interna" ni a la columna `sales.team_member_id`.    │
-- │ Sin grant, PostgREST responde 42501 antes de evaluar RLS — la frontera │
-- │ es pre-RLS, defensa-en-profundidad.                                     │
-- │                                                                          │
-- │ Cambio de modelo: hasta acá había un único rol PostgREST                │
-- │ (`authenticated`) para todos los users autenticados. Ahora hay dos:    │
-- │   - `authenticated` → super/admin/operador/analista (sin cambios).     │
-- │   - `cliente_role`  → cliente (solo).                                  │
-- │ Un Custom Access Token Hook reescribe `claims.role` a `cliente_role`   │
-- │ en el JWT de cada user con `profiles.role = 'cliente'`.                │
-- │                                                                          │
-- │ ╭─ ACCIÓN MANUAL POST-MIGRACIÓN (sin esto el hook no se aplica) ─╮     │
-- │ │ Studio → Authentication → Hooks → Custom Access Token Hook →   │     │
-- │ │ enable + select `public.custom_access_token_hook`.             │     │
-- │ ╰────────────────────────────────────────────────────────────────╯     │
-- │                                                                          │
-- │ Permisos para el cliente:                                                │
-- │   SÍ lee  : profiles propio, projects, project_members propios,        │
-- │             launches, launch_daily, launch_daily_ads,                  │
-- │             launch_opportunities, leads, sales (SIN team_member_id),  │
-- │             payments, projections, ai_runs.                            │
-- │   SÍ escribe: full_name de su propio profile, projections creadas por  │
-- │             él, ai_runs disparados por él.                             │
-- │   NO toca : team_members, payment_modalities, commission_rules,       │
-- │             integration_runs, project_integrations, project_secrets,  │
-- │             launch_secrets, audit_log, launches/launch_daily writes,  │
-- │             leads writes, sales/payments writes.                       │
-- ╰──────────────────────────────────────────────────────────────────────────╯

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) Rol PostgREST `cliente_role`
--    - nologin: nunca se loguea directo a Postgres; sólo via JWT + authenticator
--    - noinherit: explícito para que `set role cliente_role` no arrastre
--      permisos del invocador
--    - grant a `authenticator`: PostgREST hace `set role cliente_role` al ver
--      `claims.role='cliente_role'` en el JWT. Esto requiere que authenticator
--      sea miembro de cliente_role.
-- ═══════════════════════════════════════════════════════════════════════════
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'cliente_role') then
    create role cliente_role nologin noinherit;
  end if;
end$$;

grant cliente_role to authenticator;
grant usage on schema public to cliente_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) Helper `is_cliente()` (espejo de is_superadmin). No es estrictamente
--    necesario para esta migración — todos los gates duros se hacen via grants
--    + RLS por rol — pero queda disponible para futuras policies que necesiten
--    distinguir cliente de admin dentro de la misma policy SELECT.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.is_cliente()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'cliente'
  );
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3) Custom Access Token Hook — mapea `profiles.role='cliente'` a
--    `claims.role='cliente_role'` en el JWT.
--
--    Entrada: jsonb con shape { user_id, claims, ... }.
--    Salida : jsonb con shape { claims: <claims modificados> }.
--
--    Si el profile no existe o la lectura falla, devolvemos los claims
--    originales sin tocar para no bloquear logins de users recién creados o
--    estados degradados. Worst case: un cliente entra como `authenticated`
--    y queda atrapado por el redirect server-side del shell (defensa #2).
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  claims jsonb := event->'claims';
  v_role text;
begin
  select role into v_role
    from public.profiles
   where id = (event->>'user_id')::uuid
     and deleted_at is null;

  if v_role = 'cliente' then
    claims := jsonb_set(claims, '{role}', '"cliente_role"');
  end if;

  return jsonb_build_object('claims', claims);
exception when others then
  return jsonb_build_object('claims', event->'claims');
end;
$$;

-- Permisos sobre el hook: solo supabase_auth_admin lo ejecuta. Quitamos el
-- execute al resto para que no se pueda invocar como user normal y filtrar
-- el role mapping.
revoke execute on function public.custom_access_token_hook(jsonb) from public;
grant  execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4) Grants a `cliente_role` — frontera dura, columna a columna donde aplica.
--
--    Tablas NO listadas acá quedan sin grant para cliente_role → permission
--    denied antes de RLS. Eso cubre la "cocina interna":
--      team_members, payment_modalities, commission_rules,
--      project_integrations, project_secrets, launch_secrets,
--      integration_runs, audit_log.
-- ═══════════════════════════════════════════════════════════════════════════

-- profiles: SELECT total; UPDATE limitado a full_name (no toca role).
grant select on public.profiles to cliente_role;
grant update (full_name) on public.profiles to cliente_role;

-- Pertenencia / tenant.
grant select on public.projects        to cliente_role;
grant select on public.project_members to cliente_role;

-- Datos de marketing.
grant select on public.launches             to cliente_role;
grant select on public.launch_daily         to cliente_role;
grant select on public.launch_daily_ads     to cliente_role;
grant select on public.launch_opportunities to cliente_role;

-- Leads: lista nominal con teléfono — está en scope del cliente, pero la
-- columna `team_member_id` (asignación a setter/closer) NO. Grant
-- column-level idéntico al patrón de `sales`: el cliente pide cualquier
-- columna safe y postgREST responde; pide `team_member_id` y devuelve
-- 42501 antes de evaluar RLS.
grant select (
  id, project_id, launch_id, name, contact, source, status, notes,
  email, phone_normalized, external_id, pinned_to_kanban,
  created_at, updated_at
) on public.leads to cliente_role;

-- Sales: TODAS las columnas EXCEPTO team_member_id. El UUID
-- payment_modality_id queda accesible (es un identificador opaco; el cliente
-- no tiene grant para joinear payment_modalities).
grant select (
  id, project_id, lead_id, payment_modality_id,
  total_amount, closed_at, created_at, updated_at
) on public.sales to cliente_role;

-- Payments: la tabla no expone team — full SELECT está bien.
grant select on public.payments to cliente_role;

-- Projections (calculadora): el cliente CRUD sus propias filas.
grant select, insert, update, delete on public.projections to cliente_role;

-- ai_runs: el cliente puede pedir IA y leer historial. UPDATE ya está
-- revocado para authenticated en 0015 — extendemos el revoke explícito al
-- nuevo rol por simetría (historial inmutable).
grant select, insert, delete on public.ai_runs to cliente_role;
revoke update on public.ai_runs from cliente_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5) Ampliar policies a `cliente_role` donde el cliente DEBE leer / escribir.
--
--    Patrón: drop + create con `to authenticated, cliente_role`. La lógica
--    del USING/WITH CHECK no cambia — sigue derivando de los helpers
--    has_project_access / can_edit_project / can_edit_launches_in, que
--    funcionan sin tocar (consultan auth.uid(), no el rol Postgres).
--
--    Tablas con escritura DIRECTAMENTE bloqueada por falta de grant a
--    cliente_role (launches, launch_daily, leads, sales, payments,
--    ai_runs.delete, etc.) NO necesitan reformular sus policies — la barrera
--    es pre-RLS.
-- ═══════════════════════════════════════════════════════════════════════════

-- profiles ───────────────────────────────────────────────────────────────────
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated, cliente_role
  using (id = auth.uid() or public.is_superadmin());

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update to authenticated, cliente_role
  using      (id = auth.uid() or public.is_superadmin())
  with check (id = auth.uid() or public.is_superadmin());
-- (delete sigue solo authenticated/superadmin — cliente no borra profiles)

-- projects ───────────────────────────────────────────────────────────────────
drop policy if exists projects_select on public.projects;
create policy projects_select on public.projects
  for select to authenticated, cliente_role
  using (public.has_project_access(id));

-- project_members ────────────────────────────────────────────────────────────
drop policy if exists project_members_select on public.project_members;
create policy project_members_select on public.project_members
  for select to authenticated, cliente_role
  using (user_id = auth.uid() or public.is_superadmin());

-- launches ───────────────────────────────────────────────────────────────────
drop policy if exists launches_select on public.launches;
create policy launches_select on public.launches
  for select to authenticated, cliente_role
  using (public.has_project_access(project_id));

-- launch_daily ───────────────────────────────────────────────────────────────
drop policy if exists launch_daily_select on public.launch_daily;
create policy launch_daily_select on public.launch_daily
  for select to authenticated, cliente_role
  using (public.has_project_access(public.project_of_launch(launch_id)));

-- launch_daily_ads ───────────────────────────────────────────────────────────
drop policy if exists launch_daily_ads_select on public.launch_daily_ads;
create policy launch_daily_ads_select on public.launch_daily_ads
  for select to authenticated, cliente_role
  using (public.has_project_access(public.project_of_launch(launch_id)));

-- launch_opportunities ──────────────────────────────────────────────────────
drop policy if exists launch_opportunities_select on public.launch_opportunities;
create policy launch_opportunities_select on public.launch_opportunities
  for select to authenticated, cliente_role
  using (public.has_project_access(public.project_of_launch(launch_id)));

-- leads ─────────────────────────────────────────────────────────────────────
drop policy if exists leads_select on public.leads;
create policy leads_select on public.leads
  for select to authenticated, cliente_role
  using (public.has_project_access(project_id));

-- sales ─────────────────────────────────────────────────────────────────────
-- El grant column-level es lo que esconde team_member_id; la policy SELECT
-- solo amplía qué roles pueden invocarla.
drop policy if exists sales_select on public.sales;
create policy sales_select on public.sales
  for select to authenticated, cliente_role
  using (public.has_project_access(project_id));

-- payments ──────────────────────────────────────────────────────────────────
drop policy if exists payments_select on public.payments;
create policy payments_select on public.payments
  for select to authenticated, cliente_role
  using (public.has_project_access(public.project_of_sale(sale_id)));

-- projections ───────────────────────────────────────────────────────────────
-- Cliente puede:
--   - leer TODAS las proyecciones de su proyecto (consistencia con el equipo)
--   - escribir/editar/borrar las SUYAS (created_by = auth.uid()).
-- Equipo (admin) sigue con can_edit_project como antes.
drop policy if exists projections_select on public.projections;
create policy projections_select on public.projections
  for select to authenticated, cliente_role
  using (public.has_project_access(project_id));

drop policy if exists projections_insert on public.projections;
create policy projections_insert on public.projections
  for insert to authenticated, cliente_role
  with check (
    public.can_edit_project(project_id)
    or (
      public.has_project_access(project_id)
      and created_by = auth.uid()
    )
  );

drop policy if exists projections_update on public.projections;
create policy projections_update on public.projections
  for update to authenticated, cliente_role
  using (
    public.can_edit_project(project_id)
    or (public.has_project_access(project_id) and created_by = auth.uid())
  )
  with check (
    public.can_edit_project(project_id)
    or (public.has_project_access(project_id) and created_by = auth.uid())
  );

drop policy if exists projections_delete on public.projections;
create policy projections_delete on public.projections
  for delete to authenticated, cliente_role
  using (
    public.can_edit_project(project_id)
    or (public.has_project_access(project_id) and created_by = auth.uid())
  );

-- ai_runs ───────────────────────────────────────────────────────────────────
-- Cliente puede leer (consume su propio historial de análisis) e insertar las
-- que dispare él mismo (user_id = auth.uid()). El equipo sigue con
-- can_edit_launches_in. DELETE sigue admin-only.
drop policy if exists ai_runs_select on public.ai_runs;
create policy ai_runs_select on public.ai_runs
  for select to authenticated, cliente_role
  using (public.has_project_access(project_id));

drop policy if exists ai_runs_insert on public.ai_runs;
create policy ai_runs_insert on public.ai_runs
  for insert to authenticated, cliente_role
  with check (
    public.can_edit_launches_in(project_id)
    or (
      public.has_project_access(project_id)
      and user_id = auth.uid()
    )
  );
-- (delete sigue solo authenticated → admin/superadmin)
