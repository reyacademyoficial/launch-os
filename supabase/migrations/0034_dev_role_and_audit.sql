-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Phase 10 — Dev role + audit log                                          │
-- │                                                                          │
-- │ Cambios:                                                                 │
-- │   1) Nuevo rol `dev` por encima de `superadmin`. NO se puede setear vía  │
-- │      raw_user_meta_data (handle_new_user lo descarta). Sólo se promueve  │
-- │      por la RPC promote_to_dev(), pensada para correr con service_role   │
-- │      durante el seed manual desde Studio.                                │
-- │   2) Tablas `audit_log` (writes en tablas de tenant) y `auth_events`    │
-- │      (sesiones). Sólo `is_dev()` puede leerlas.                          │
-- │   3) Trigger genérico record_audit() attacheado a las tablas tenant.    │
-- │   4) Función purge_audit_old() — borra >90d. Schedule manual (Studio →   │
-- │      Database → Cron, o un Vercel cron).                                 │
-- │                                                                          │
-- │ NO se expone el rol dev en ninguna UI: handle_new_user lo bloquea,       │
-- │ listAllUsers filtra role != 'dev', y la página /dev/auditoria no está    │
-- │ enlazada desde ningún menú.                                              │
-- ╰──────────────────────────────────────────────────────────────────────────╯

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) Extender profiles.role con 'dev'
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.profiles
  drop constraint if exists profiles_role_check;

alter table public.profiles
  add constraint profiles_role_check
  check (role in ('dev', 'superadmin', 'admin', 'operador', 'analista', 'cliente'));

-- handle_new_user — 'dev' NUNCA se acepta desde metadata, aunque venga.
-- La única vía es promote_to_dev() o un UPDATE directo desde service_role.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  v_role := coalesce(new.raw_user_meta_data->>'role', 'cliente');
  if v_role not in ('superadmin', 'admin', 'operador', 'analista', 'cliente') then
    -- 'dev' cae acá explícitamente: lo degradamos a 'cliente'.
    v_role := 'cliente';
  end if;

  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    nullif(new.raw_user_meta_data->>'full_name', ''),
    v_role
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

-- guard_profile_role — extendemos para permitir cambios cuando el caller corre
-- como `service_role` (Studio SQL + Admin API). Esto habilita el seed del dev
-- sin tener que disable+enable el trigger manualmente.
create or replace function public.guard_profile_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is distinct from old.role then
    -- service_role bypass: el rol PostgREST/Admin API es 'service_role'.
    if current_setting('role', true) = 'service_role' then
      return new;
    end if;
    if not public.is_superadmin() then
      raise exception 'role changes are restricted to superadmin or service_role'
        using errcode = '42501';
    end if;
    -- Defensa adicional: ni siquiera un superadmin auth puede auto-asignarse
    -- 'dev'. Sólo service_role llega acá.
    if new.role = 'dev' then
      raise exception 'cannot self-promote to dev — use promote_to_dev() via service_role'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) is_dev() + is_superadmin() expandido
--    Hacemos que `is_superadmin()` devuelva true también para `dev`. Así toda
--    la RLS y los helpers existentes (can_edit_project, has_project_access,
--    can_edit_launches_in, etc.) tratan a dev como superadmin sin que tengamos
--    que tocar cada policy. La distinción entre dev y superadmin queda sólo en
--    los lugares que SÍ deben saberlo:
--      - is_dev() para la auditoría
--      - record_audit() salta cuando actor es dev
--      - listAllUsers filtra role='dev' en TS
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.is_superadmin()
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
      and role in ('superadmin', 'dev')
  );
$$;

create or replace function public.is_dev()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'dev'
  );
$$;

grant execute on function public.is_dev() to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3) audit_log — todo write en tablas tenant
--    Estructura denormalizada (actor_role snapshot) para que la consulta no
--    tenga que joinear contra profiles en cada lectura.
--    NOTA: usamos `occurred_at` en vez de `at` porque `AT` es keyword SQL y
--    rompe el parser de algunas DDL (ej. `ORDER BY at DESC` en CREATE INDEX).
-- ═══════════════════════════════════════════════════════════════════════════
-- Si una corrida previa quedó a medio aplicar, limpiamos. Sin filas vivas que
-- conservar todavía.
drop table if exists public.audit_log cascade;

create table public.audit_log (
  id           bigserial primary key,
  occurred_at  timestamptz not null default now(),
  actor_id     uuid,
  actor_role   text,
  schema_name  text not null default 'public',
  table_name   text not null,
  op           text not null check (op in ('INSERT','UPDATE','DELETE')),
  row_pk       text,
  before       jsonb,
  after        jsonb
);

create index audit_log_at_idx        on public.audit_log (occurred_at desc);
create index audit_log_actor_idx     on public.audit_log (actor_id, occurred_at desc);
create index audit_log_table_idx     on public.audit_log (table_name, occurred_at desc);

alter table public.audit_log enable row level security;
-- Sin grants a authenticated → el trigger inserta vía SECURITY DEFINER
-- (owner = postgres con BYPASSRLS) y los SELECT pasan por la policy de abajo.
revoke all on public.audit_log from anon, authenticated;
grant select on public.audit_log to authenticated; -- SELECT controlado por RLS

drop policy if exists audit_log_select_dev on public.audit_log;
create policy audit_log_select_dev on public.audit_log
  for select to authenticated using (public.is_dev());

-- ═══════════════════════════════════════════════════════════════════════════
-- 4) auth_events — session_start / session_end
--    INSERT lo hace el propio usuario (desde el proxy o el signOut action),
--    SELECT sólo dev.
-- ═══════════════════════════════════════════════════════════════════════════
drop table if exists public.auth_events cascade;

create table public.auth_events (
  id           bigserial primary key,
  occurred_at  timestamptz not null default now(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  kind         text not null check (kind in ('session_start','session_end')),
  ip           inet,
  user_agent   text
);

create index auth_events_user_idx on public.auth_events (user_id, occurred_at desc);
create index auth_events_at_idx   on public.auth_events (occurred_at desc);

alter table public.auth_events enable row level security;
revoke all on public.auth_events from anon, authenticated;
grant select, insert on public.auth_events to authenticated;

drop policy if exists auth_events_select_dev on public.auth_events;
create policy auth_events_select_dev on public.auth_events
  for select to authenticated using (public.is_dev());

drop policy if exists auth_events_insert_self on public.auth_events;
create policy auth_events_insert_self on public.auth_events
  for insert to authenticated with check (user_id = auth.uid());

-- ═══════════════════════════════════════════════════════════════════════════
-- 5) record_audit() — trigger genérico AFTER INSERT/UPDATE/DELETE
--    Captura auth.uid() y un snapshot del rol. Skip si no hay actor (sistemas)
--    o si el actor es dev (no nos auditamos a nosotros mismos para evitar
--    ruido en la propia traza forense).
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.record_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor    uuid;
  v_role     text;
  v_row_pk   text;
  v_before   jsonb;
  v_after    jsonb;
begin
  v_actor := auth.uid();

  if v_actor is not null then
    select role into v_role from public.profiles where id = v_actor;
    -- No auditar acciones del propio dev.
    if v_role = 'dev' then
      return coalesce(new, old);
    end if;
  end if;

  if tg_op = 'INSERT' then
    v_after := to_jsonb(new);
    v_row_pk := coalesce(v_after->>'id', '');
  elsif tg_op = 'UPDATE' then
    v_before := to_jsonb(old);
    v_after  := to_jsonb(new);
    v_row_pk := coalesce(v_after->>'id', v_before->>'id', '');
  else -- DELETE
    v_before := to_jsonb(old);
    v_row_pk := coalesce(v_before->>'id', '');
  end if;

  insert into public.audit_log
    (actor_id, actor_role, schema_name, table_name, op, row_pk, before, after)
  values
    (v_actor, v_role, tg_table_schema, tg_table_name, tg_op, v_row_pk, v_before, v_after);

  return coalesce(new, old);
end;
$$;

-- Helper para attachear el trigger a una tabla sin repetir DDL.
create or replace function public._attach_audit_trigger(p_table regclass)
returns void
language plpgsql
as $$
declare
  v_name text;
begin
  v_name := 'record_audit';
  execute format('drop trigger if exists %I on %s', v_name, p_table);
  execute format(
    'create trigger %I after insert or update or delete on %s
     for each row execute function public.record_audit()',
    v_name, p_table
  );
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6) Attach a las tablas de tenant data. Pivotes y cache quedan fuera para
--    no inflar el log con ruido.
--
--    Cada llamada va envuelta en `to_regclass IS NOT NULL` para tolerar tablas
--    que pudieron haber sido dropeadas en migraciones posteriores (caso
--    launch_assignments, eliminada en 0010_back_to_project_scope.sql).
-- ═══════════════════════════════════════════════════════════════════════════
do $$
declare
  v_table text;
  v_tables text[] := array[
    'public.profiles',
    'public.projects',
    'public.project_members',
    'public.launches',
    'public.team_members',
    'public.leads',
    'public.sales',
    'public.payments',
    'public.payment_modalities',
    'public.commission_rules',
    'public.commission_rule_tiers',
    'public.commission_rule_modalities',
    'public.team_member_payouts'
  ];
begin
  foreach v_table in array v_tables loop
    if to_regclass(v_table) is not null then
      perform public._attach_audit_trigger(v_table::regclass);
    end if;
  end loop;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 7) purge_audit_old() — retention 90 días.
--    Sin schedule automático en esta migración. Para activarlo:
--      a) Studio → Database → Cron → New cron job → `select purge_audit_old();`
--      b) o un Vercel cron que hitee un endpoint que llame la RPC.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.purge_audit_old()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted bigint := 0;
  v_count   bigint;
begin
  -- Gate explícito: sólo dev (sesión auth) o service_role (cron). Cualquier
  -- otro caller authenticated rebota con 42501.
  if not public.is_dev() and current_setting('role', true) <> 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  delete from public.audit_log where occurred_at < now() - interval '90 days';
  get diagnostics v_count = row_count;
  v_deleted := v_deleted + v_count;

  delete from public.auth_events where occurred_at < now() - interval '90 days';
  get diagnostics v_count = row_count;
  v_deleted := v_deleted + v_count;

  return v_deleted;
end;
$$;

revoke all on function public.purge_audit_old() from public;
grant execute on function public.purge_audit_old() to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 8) promote_to_dev(uid) — RPC pensada para correr desde service_role en
--    Studio. NO grantable a authenticated.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.promote_to_dev(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_setting('role', true) <> 'service_role' then
    raise exception 'promote_to_dev requires service_role' using errcode = '42501';
  end if;
  update public.profiles set role = 'dev' where id = p_user_id;
  if not found then
    raise exception 'profile not found for user_id=%', p_user_id;
  end if;
end;
$$;

revoke all on function public.promote_to_dev(uuid) from public, authenticated, anon;
-- service_role siempre tiene execute por default; no hace falta grant.
