-- supabase/tests/rls_smoke_test.sql
-- Smoke-test de RLS multi-tenant. Modelo project-scope (post-0010).
--
-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ CÓMO CORRERLO                                                            │
-- │                                                                          │
-- │ 1. Studio → SQL editor → pegar el ARCHIVO ENTERO en un solo query.      │
-- │ 2. APAGAR el toggle "Limit rows" (arriba a la derecha del editor).       │
-- │ 3. Si aparece el aviso "creates a table without enabling RLS" elegir    │
-- │    "Run without RLS" (la _smoke_results es temp y rolleable).            │
-- │ 4. Run. El resultado final es una tabla `n | result`. Filas que          │
-- │    empiezan con `ok …` pasaron; `not ok …` fallaron (con diag debajo).   │
-- ╰──────────────────────────────────────────────────────────────────────────╯
begin;

create extension if not exists pgtap with schema extensions;

set local search_path = pg_temp, extensions, public;

-- Helper: "loguearse" como un usuario autenticado (rol + claim sub del JWT).
--
-- Post-0023 hay dos roles PostgREST: `authenticated` (super/admin/operador/
-- coordinador) y `cliente_role` (cliente). El access_token_hook reescribe
-- claims.role según profiles.role; replicamos ese mapping acá para que los
-- tests reflejen el comportamiento real en runtime.
--
-- `reset role` al inicio es crítico: tras un `set local role X`, current_user
-- queda en X. Postgres (session_user, superuser) puede revertir y luego
-- setear cualquier role; un rol no-superuser no. Sin el reset, una segunda
-- llamada login_as falla cuando cambia entre authenticated y cliente_role.
create or replace function pg_temp.login_as(p_uid uuid)
returns void language plpgsql as $$
declare
  v_profile_role text;
  v_pg_role      text := 'authenticated';
begin
  reset role;
  select role into v_profile_role from public.profiles where id = p_uid;
  if v_profile_role = 'cliente' then
    v_pg_role := 'cliente_role';
  end if;
  execute format('set local role %I', v_pg_role);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', p_uid, 'role', v_pg_role)::text,
    true
  );
end;
$$;

-- Wrapper local de `throws_ok`. La versión de pgtap embebida en este Supabase
-- declara `throws_ok` con CHAR(5) para el sqlstate; algunos casts (`text`,
-- `character`) no resuelven entre las firmas disponibles y postgres tira
-- "function does not exist" antes de poder ejecutar. Definir un override en
-- pg_temp con firma fija (text, text, text, text) — y poner `pg_temp`
-- primero en el search_path — hace que TODAS las llamadas `throws_ok(...)`
-- caigan acá sin importar la versión de pgtap. Internamente ejecutamos el
-- SQL, capturamos el SQLSTATE y emitimos un `ok()` con el verdict (mismo
-- TAP que las demás aserciones).
create or replace function pg_temp.throws_ok(
  p_sql      text,
  p_sqlstate text,
  p_errmsg   text,
  p_desc     text
) returns text language plpgsql as $$
declare
  got_sqlstate text;
  raised       boolean := false;
begin
  begin
    execute p_sql;
  exception when others then
    got_sqlstate := SQLSTATE;
    raised := true;
  end;

  if not raised then
    return extensions.ok(false, p_desc || ' — esperaba excepción, no hubo');
  end if;
  if p_sqlstate is not null and got_sqlstate <> p_sqlstate then
    return extensions.ok(
      false,
      p_desc || ' — SQLSTATE esperado ' || p_sqlstate || ', obtuve ' || got_sqlstate
    );
  end if;
  return extensions.ok(true, p_desc);
end;
$$;

-- Tabla temporal que captura el output de cada aserción para que Studio lo
-- muestre. Grants explícitos porque los inserts corren como `authenticated`.
create temporary table _smoke_results (
  n      serial primary key,
  result text
) on commit drop;

grant insert, select on _smoke_results to authenticated;
grant usage on sequence _smoke_results_n_seq to authenticated;
-- Post-0023: los tests del cliente corren bajo `cliente_role`, que no hereda
-- nada de `authenticated`. Sin estos grants, el primer insert al log de
-- resultados (test 1) lanza 42501 porque el rol activo no tiene permisos
-- sobre la tabla temp.
grant insert, select on _smoke_results to cliente_role;
grant usage on sequence _smoke_results_n_seq to cliente_role;
-- pgtap vive en el schema `extensions`. Las llamadas a `plan`, `is`,
-- `isnt_empty`, `is_empty`, `lives_ok` y `extensions.ok` (que el wrapper
-- pg_temp.throws_ok invoca al final) requieren USAGE sobre el schema. El
-- rol authenticated lo tiene por bootstrap de Supabase; cliente_role no.
grant usage on schema extensions to cliente_role;

-- =====================  SEED (como postgres / owner)  =====================
-- UUIDs fijos para legibilidad
--   super:    11111111-... (superadmin, acceso global)
--   admin1:   22222222-... (admin, miembro de Proyecto A)
--   cliente1: 33333333-... (cliente, miembro de Proyecto A)
--   operador: 44444444-... (operador, miembro de Proyecto A)
--   coordinador: 55555555-... (coordinador, miembro de Proyecto A)
--   proj_a:   aaaaaaaa-...
--   proj_b:   bbbbbbbb-... (sin miembros)
--   launch1:  cccccccc-... (proj_a)
--   launch2:  dddddddd-... (proj_a)
-- Sin launch_assignments — el modelo es project-scope.

alter table public.profiles disable trigger guard_profile_role;

insert into auth.users (instance_id, id, aud, role, email,
                        encrypted_password, email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000000','11111111-1111-1111-1111-111111111111',
   'authenticated','authenticated','super@test.local','', now(), now(), now(),
   '{}'::jsonb, '{"full_name":"Super"}'::jsonb),
  ('00000000-0000-0000-0000-000000000000','22222222-2222-2222-2222-222222222222',
   'authenticated','authenticated','admin@test.local','', now(), now(), now(),
   '{}'::jsonb, '{"full_name":"Admin Uno"}'::jsonb),
  ('00000000-0000-0000-0000-000000000000','33333333-3333-3333-3333-333333333333',
   'authenticated','authenticated','cliente@test.local','', now(), now(), now(),
   '{}'::jsonb, '{"full_name":"Cliente Uno"}'::jsonb),
  ('00000000-0000-0000-0000-000000000000','44444444-4444-4444-4444-444444444444',
   'authenticated','authenticated','operador@test.local','', now(), now(), now(),
   '{}'::jsonb, '{"full_name":"Operador Uno"}'::jsonb),
  ('00000000-0000-0000-0000-000000000000','55555555-5555-5555-5555-555555555555',
   'authenticated','authenticated','coordinador@test.local','', now(), now(), now(),
   '{}'::jsonb, '{"full_name":"Coordinador Uno"}'::jsonb)
on conflict (id) do nothing;

insert into public.profiles (id, full_name, role) values
  ('11111111-1111-1111-1111-111111111111','Super','superadmin'),
  ('22222222-2222-2222-2222-222222222222','Admin Uno','admin'),
  ('33333333-3333-3333-3333-333333333333','Cliente Uno','cliente'),
  ('44444444-4444-4444-4444-444444444444','Operador Uno','operador'),
  ('55555555-5555-5555-5555-555555555555','Coordinador Uno','coordinador')
on conflict (id) do update
  set role = excluded.role, full_name = excluded.full_name;

alter table public.profiles enable trigger guard_profile_role;

insert into public.projects (id, name) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Proyecto A'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','Proyecto B')
on conflict (id) do nothing;

-- Todos los no-superadmin son miembros de Proyecto A. Proyecto B queda vacío.
insert into public.project_members (project_id, user_id) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','22222222-2222-2222-2222-222222222222'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','33333333-3333-3333-3333-333333333333'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','44444444-4444-4444-4444-444444444444'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','55555555-5555-5555-5555-555555555555')
on conflict do nothing;

-- Dos launches en Proyecto A.
insert into public.launches (id, project_id, name) values
  ('cccccccc-cccc-cccc-cccc-cccccccccccc','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Launch Uno'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Launch Dos')
on conflict (id) do nothing;

-- Post-0038: sales.product_id es NOT NULL. Sembramos un producto genérico
-- "Sin categoría" por cada proyecto (mismo nombre que usa el backfill de
-- 0038 para ventas huérfanas) para que todos los inserts de sales del smoke
-- puedan referenciarlo. `unique (project_id, name)` hace la seed idempotente.
insert into public.products (project_id, name) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Sin categoría'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Sin categoría')
on conflict (project_id, name) do nothing;

-- =====================  TESTS  =====================
--
-- Semántica:
-- - INSERT bloqueado por WITH CHECK → 42501 (throws_ok).
-- - UPDATE/DELETE bloqueado por USING → fila se filtra silencioso, 0 filas.
--   Lo testeamos con `is_empty(WITH ... RETURNING 1)`.
--
insert into _smoke_results(result) values (plan(187));

-- 1) cliente NO puede insertar launches (WITH CHECK falla) → 42501
select pg_temp.login_as('33333333-3333-3333-3333-333333333333');
insert into _smoke_results(result) values (pg_temp.throws_ok(
  format('insert into public.launches (project_id, name) values (%L, %L)',
         'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Launch del cliente'),
  '42501'::text, null::text,
  'cliente NO puede insertar launches'::text
));

-- 2) admin SÍ puede insertar launches en su proyecto
select pg_temp.login_as('22222222-2222-2222-2222-222222222222');
insert into _smoke_results(result) values (lives_ok(
  format('insert into public.launches (project_id, name) values (%L, %L)',
         'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Launch del admin'),
  'admin SÍ puede insertar launches en su proyecto'
));

-- 3) admin SÍ ve su proyecto asignado
insert into _smoke_results(result) values (isnt_empty(
  format('select 1 from public.projects where id = %L',
         'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  'admin SÍ ve su proyecto'
));

-- 4) admin NO ve un proyecto que no tiene asignado
insert into _smoke_results(result) values (is_empty(
  format('select 1 from public.projects where id = %L',
         'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  'admin NO ve proyecto ajeno'
));

-- 5) superadmin ve los 2 proyectos seedeados (filtra por UUIDs del seed)
select pg_temp.login_as('11111111-1111-1111-1111-111111111111');
insert into _smoke_results(result) values (is(
  (select count(*)::int
     from public.projects
    where id in (
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
    )),
  2,
  'superadmin ve ambos proyectos seedeados'
));

-- 6) project_secrets blindada para el rol authenticated
select pg_temp.login_as('22222222-2222-2222-2222-222222222222');
insert into _smoke_results(result) values (is_empty(
  'select 1 from public.project_secrets',
  'project_secrets inaccesible para authenticated (tabla blindada)'
));

-- 7) cliente lee TODOS los launches de su proyecto (sin assignments)
select pg_temp.login_as('33333333-3333-3333-3333-333333333333');
insert into _smoke_results(result) values (is(
  (select count(*)::int
     from public.launches
    where project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  3,  -- launch1, launch2, "Launch del admin" del test 2
  'cliente ve los 3 launches de su proyecto por pertenencia'
));

-- 8) cliente NO ve un proyecto ajeno
insert into _smoke_results(result) values (is_empty(
  format('select 1 from public.projects where id = %L',
         'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  'cliente NO ve proyecto ajeno'
));

-- 9) operador SÍ edita CUALQUIER launch de su proyecto (sin assignment)
select pg_temp.login_as('44444444-4444-4444-4444-444444444444');
insert into _smoke_results(result) values (lives_ok(
  format('update public.launches set name = ''edit by operador'' where id = %L',
         'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  'operador edita launch1 (pertenencia + rol)'
));

-- 10) operador también edita launch2 (mismo proyecto)
insert into _smoke_results(result) values (lives_ok(
  format('update public.launches set name = ''edit by operador 2'' where id = %L',
         'dddddddd-dddd-dddd-dddd-dddddddddddd'),
  'operador edita launch2 sin asignación per-launch'
));

-- 11) operador SÍ puede crear launches (regla nueva 2026-08-08: launches_insert
-- ahora gatea por can_edit_launches_in, que incluye operador miembro).
insert into _smoke_results(result) values (lives_ok(
  format('insert into public.launches (project_id, name) values (%L, %L)',
         'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'launch del operador'),
  'operador SÍ puede crear launches (regla 2026-08-08)'::text
));

-- 12) operador SÍ puede borrar launches (mismo cambio: launches_delete gatea
-- por can_edit_launches_in). Borramos el que acabamos de insertar para no
-- afectar los conteos posteriores.
insert into _smoke_results(result) values (lives_ok(
  format(
    'delete from public.launches where project_id = %L and name = %L',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'launch del operador'
  ),
  'operador SÍ borra launches (regla 2026-08-08)'
));

-- 13) coordinador LEE launches de su proyecto
select pg_temp.login_as('55555555-5555-5555-5555-555555555555');
insert into _smoke_results(result) values (isnt_empty(
  format('select 1 from public.launches where project_id = %L',
         'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  'coordinador SÍ lee launches de su proyecto'
));

-- 14) coordinador NO escribe launches (USING filtra UPDATE → 0 filas)
insert into _smoke_results(result) values (is_empty(
  format(
    'with u as (update public.launches set name = ''hack'' where id = %L returning 1) select * from u',
    'cccccccc-cccc-cccc-cccc-cccccccccccc'
  ),
  'coordinador NO edita launches'
));

-- 15) cliente NO escribe launches. Post-0023 entra con cliente_role que NO
--     tiene grant UPDATE on launches → permission denied (42501) ANTES de RLS.
--     La frontera es pre-policy (grant), no la cláusula USING.
select pg_temp.login_as('33333333-3333-3333-3333-333333333333');
insert into _smoke_results(result) values (pg_temp.throws_ok(
  format(
    'update public.launches set name = ''cliente edit'' where id = %L',
    'cccccccc-cccc-cccc-cccc-cccccccccccc'
  ),
  '42501'::text, null::text,
  'cliente_role NO edita launches (no grant UPDATE)'::text
));

-- ── Tests del calendario (post-0011) ─────────────────────────────────────
-- Validan que las columnas GENERATED `date_start` y `date_end` reproducen
-- el ejemplo numérico del roadmap exactamente: launch_date = 2026-07-10
-- con defaults 21/14/5/3 → date_start = 2026-06-19, date_end = 2026-07-20.

-- Insertamos un launch dedicado con la fecha del ejemplo. RLS está activa
-- (estamos como cliente todavía del test 15) así que volvemos a superadmin
-- por la operación de seed y los queries de lectura.
--
-- DELETE + INSERT (no upsert): `date_start` y `date_end` son columnas
-- GENERATED STORED calculadas al INSERT. Un `on conflict do nothing` deja
-- vivo un row viejo con duraciones desactualizadas (past runs con otro
-- default de dur_captacion daban date_start incorrecto). El delete garantiza
-- row limpio con los defaults actuales.
select pg_temp.login_as('11111111-1111-1111-1111-111111111111');

delete from public.launches where id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

insert into public.launches (id, project_id, name, launch_date) values
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'Launch ejemplo roadmap',
   '2026-07-10');

-- 16) date_start derivado correctamente: 2026-07-10 − 21 = 2026-06-19
insert into _smoke_results(result) values (is(
  (select date_start::text
     from public.launches
    where id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'),
  '2026-06-19',
  'date_start = L − dur_captacion (ejemplo del roadmap)'
));

-- 17) date_end derivado: 2026-07-10 + 2 + 5 + 3 = 2026-07-20
insert into _smoke_results(result) values (is(
  (select date_end::text
     from public.launches
    where id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'),
  '2026-07-20',
  'date_end = L + 2 + dur_compra + dur_cierre (ejemplo del roadmap)'
));

-- ── Tests de integraciones (post-0012) ──────────────────────────────────
-- Validan que las 3 tablas nuevas tienen la RLS correcta:
--   - launch_daily_ads: SELECT visible a miembros, write blindada
--   - launch_secrets:   blindada total (SELECT devuelve 0 filas)
--   - integration_runs: SELECT visible a miembros, write blindada

-- Seed: estas 3 tablas tienen RLS sin policies de write, así que ni
-- superadmin (via authenticated + JWT) puede insertar. Volvemos al rol
-- postgres del connection — bypasea RLS — para popularlas. Después
-- re-login como cliente para los tests de visibilidad.
reset role;

insert into public.launch_daily_ads (launch_id, date, provider, spend, leads) values
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', '2026-07-10', 'meta', 50, 5)
on conflict (launch_id, date, provider) do nothing;

insert into public.launch_secrets (launch_id, provider, secret) values
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'meta', 'EAAB-dummy-token-for-tests')
on conflict (launch_id, provider) do nothing;

insert into public.integration_runs (launch_id, provider, status, rows_written) values
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'meta', 'success', 1);

-- 18) cliente lee launch_daily_ads del launch de su proyecto → ✅
select pg_temp.login_as('33333333-3333-3333-3333-333333333333');
insert into _smoke_results(result) values (isnt_empty(
  format('select 1 from public.launch_daily_ads where launch_id = %L',
         'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  'cliente lee launch_daily_ads de su proyecto'
));

-- 19) cliente NO ve launch_secrets. Post-0023 cliente_role tampoco tiene
--     grant SELECT en launch_secrets → permission denied. Doble blindaje:
--     grant ausente + RLS sin policies.
insert into _smoke_results(result) values (pg_temp.throws_ok(
  format('select 1 from public.launch_secrets where launch_id = %L',
         'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  '42501'::text, null::text,
  'cliente_role NO accede a launch_secrets (no grant)'::text
));

-- 20) cliente NO puede insertar en launch_daily_ads (sin policy de write)
insert into _smoke_results(result) values (pg_temp.throws_ok(
  format(
    'insert into public.launch_daily_ads (launch_id, date, provider, leads) values (%L, ''2026-07-11'', ''meta'', 99)',
    'cccccccc-cccc-cccc-cccc-cccccccccccc'
  ),
  '42501'::text, null::text,
  'launch_daily_ads INSERT blindado para authenticated'::text
));

-- 21) cliente NO ve integration_runs. Post-0023 cliente_role NO tiene grant
--     SELECT en integration_runs — el cliente no le interesa el "ultima sync"
--     de las integraciones (cocina del equipo). El equipo (authenticated)
--     sigue leyendo via has_project_access en su rol propio.
insert into _smoke_results(result) values (pg_temp.throws_ok(
  format('select 1 from public.integration_runs where launch_id = %L',
         'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  '42501'::text, null::text,
  'cliente_role NO accede a integration_runs (no grant)'::text
));

-- ── Tests de CRM (post-0013): team_members + leads ────────────────────────
-- Validan project-scope sobre las 2 tablas nuevas:
--   - team_members  → read miembro, write admin+operador, NO coordinador/cliente
--   - leads         → mismo gate; FK opcional a launches y a team_members
-- Pre-condición: team_members vacía para Proyecto A. Si una corrida anterior
-- dejó datos, los limpiamos como postgres (sin RLS) para que el conteo sea
-- determinístico. Esto y los seeds van como postgres, los gates como rol.

reset role;
delete from public.leads where project_id in (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
);
delete from public.team_members where project_id in (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
);

-- 22) admin SÍ puede insertar team_members en su proyecto
select pg_temp.login_as('22222222-2222-2222-2222-222222222222');
insert into _smoke_results(result) values (lives_ok(
  format(
    'insert into public.team_members (project_id, name, role) values (%L, %L, %L)',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Setter Uno', 'setter'
  ),
  'admin inserta team_member en su proyecto'
));

-- 23) operador SÍ puede insertar team_members en su proyecto (mismo gate)
select pg_temp.login_as('44444444-4444-4444-4444-444444444444');
insert into _smoke_results(result) values (lives_ok(
  format(
    'insert into public.team_members (project_id, name, role) values (%L, %L, %L)',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Closer Uno', 'closer'
  ),
  'operador inserta team_member en su proyecto'
));

-- 24) coordinador NO inserta team_members (gate = can_edit_launches_in)
select pg_temp.login_as('55555555-5555-5555-5555-555555555555');
insert into _smoke_results(result) values (pg_temp.throws_ok(
  format(
    'insert into public.team_members (project_id, name, role) values (%L, %L, %L)',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Hack', 'setter'
  ),
  '42501'::text, null::text,
  'coordinador NO inserta team_members'::text
));

-- 25) cliente NO inserta team_members
select pg_temp.login_as('33333333-3333-3333-3333-333333333333');
insert into _smoke_results(result) values (pg_temp.throws_ok(
  format(
    'insert into public.team_members (project_id, name, role) values (%L, %L, %L)',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Hack cliente', 'setter'
  ),
  '42501'::text, null::text,
  'cliente NO inserta team_members'::text
));

-- 26) cliente NO lee team_members. Post-0023 (frontera-cliente) team_members
--     es cocina interna del equipo — cliente_role no tiene grant SELECT.
--     Antes era lectura libre via has_project_access; ahora la barrera es
--     pre-RLS y dura. Mismo razonamiento que para commission_rules y
--     payment_modalities (tests 47/48).
insert into _smoke_results(result) values (pg_temp.throws_ok(
  format('select 1 from public.team_members where project_id = %L',
         'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  '42501'::text, null::text,
  'cliente_role NO accede a team_members (no grant)'::text
));

-- 27) cliente sigue sin acceso a team_members aun cross-tenant. Sanity check
--     del mismo permission denied — no importa el project_id, el rol no
--     accede a la tabla en absoluto. Seedeamos uno en Proyecto B para que
--     queden datos disponibles para los tests cross-tenant posteriores.
reset role;
insert into public.team_members (project_id, name, role) values
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Cross-tenant setter', 'setter');

select pg_temp.login_as('33333333-3333-3333-3333-333333333333');
insert into _smoke_results(result) values (pg_temp.throws_ok(
  format('select 1 from public.team_members where project_id = %L',
         'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  '42501'::text, null::text,
  'cliente_role NO accede a team_members ni cross-tenant'::text
));

-- 28) operador SÍ inserta lead en su proyecto (source default = manual)
select pg_temp.login_as('44444444-4444-4444-4444-444444444444');
insert into _smoke_results(result) values (lives_ok(
  format(
    'insert into public.leads (project_id, name) values (%L, %L)',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Lead manual del operador'
  ),
  'operador inserta lead manual en su proyecto'
));

-- 29) coordinador NO edita leads (USING filtra UPDATE → 0 filas)
select pg_temp.login_as('55555555-5555-5555-5555-555555555555');
insert into _smoke_results(result) values (is_empty(
  format(
    'with u as (update public.leads set status = ''cerrado'' where project_id = %L returning 1) select * from u',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  ),
  'coordinador NO edita leads (USING filtra)'
));

-- ── Tests de ventas/comisiones (post-0014) ────────────────────────────────
-- Validan project-scope + el split admin vs operador:
--   - payment_modalities + commission_rules → can_edit_project (admin only)
--   - sales + payments                       → can_edit_launches_in (admin+op)
--
-- Limpieza previa para que los conteos sean deterministicos entre corridas.
reset role;
delete from public.payments where sale_id in (
  select id from public.sales where project_id in (
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
  )
);
delete from public.sales where project_id in (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
);
delete from public.commission_rules where project_id in (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
);
delete from public.payment_modalities where project_id in (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
);

-- 30) admin SÍ inserta modalidad de pago (can_edit_project)
select pg_temp.login_as('22222222-2222-2222-2222-222222222222');
insert into _smoke_results(result) values (lives_ok(
  format(
    'insert into public.payment_modalities (project_id, name) values (%L, %L)',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Pago total'
  ),
  'admin inserta payment_modality'
));

-- 31) operador NO inserta modalidad (gate = can_edit_project, no _launches_in)
select pg_temp.login_as('44444444-4444-4444-4444-444444444444');
insert into _smoke_results(result) values (pg_temp.throws_ok(
  format(
    'insert into public.payment_modalities (project_id, name) values (%L, %L)',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Hack del operador'
  ),
  '42501'::text, null::text,
  'operador NO inserta payment_modality (es admin-only)'::text
));

-- 32) admin SÍ inserta commission_rule vía RPC (1 tier 10%, default, 1 modalidad).
--     Post-0040 la firma es (project, launch, product, accrual_mode, thr_type,
--     thr_value, modalidades, tiers): pasamos null en launch y product porque
--     la regla es default de proyecto (no override).
select pg_temp.login_as('22222222-2222-2222-2222-222222222222');
insert into _smoke_results(result) values (lives_ok(
  format(
    $sql$select public.create_commission_rule(
      %L, null, null,
      'proportional', null, null,
      array[(select id from public.payment_modalities where project_id = %L and name = 'Pago total')],
      '[{"min_count":0,"max_count":null,"type":"percent","value":10}]'::jsonb
    )$sql$,
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  ),
  'admin inserta commission_rule via RPC'
));

-- 33) operador NO inserta commission_rule (RLS sobre commission_rules)
select pg_temp.login_as('44444444-4444-4444-4444-444444444444');
insert into _smoke_results(result) values (pg_temp.throws_ok(
  format(
    $sql$select public.create_commission_rule(
      %L, null, null,
      'proportional', null, null,
      array[(select id from public.payment_modalities where project_id = %L and name = 'Pago total')],
      '[{"min_count":0,"max_count":null,"type":"fixed","value":500}]'::jsonb
    )$sql$,
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  ),
  '42501'::text, null::text,
  'operador NO inserta commission_rule (RLS bloquea INSERT)'::text
));

-- 34) Trigger del pivot: NO se puede tener 2 reglas para la misma (modalidad,
--     launch). El trigger usa SQLSTATE 23505 ("ya hay otra regla").
select pg_temp.login_as('22222222-2222-2222-2222-222222222222');
insert into _smoke_results(result) values (pg_temp.throws_ok(
  format(
    $sql$select public.create_commission_rule(
      %L, null, null,
      'proportional', null, null,
      array[(select id from public.payment_modalities where project_id = %L and name = 'Pago total')],
      '[{"min_count":0,"max_count":null,"type":"fixed","value":999}]'::jsonb
    )$sql$,
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  ),
  '23505'::text, null::text,
  'pivot trigger bloquea segunda rule default por modalidad'::text
));

-- 35) operador SÍ inserta sale (can_edit_launches_in). Necesita un lead +
--     una modalidad + un producto (post-0038 product_id es NOT NULL): usamos
--     el lead que el operador creó en el test 28, la modalidad de pago total
--     y el producto "Sin categoría" sembrado arriba. Operador hace todo el
--     flujo.
select pg_temp.login_as('44444444-4444-4444-4444-444444444444');
insert into _smoke_results(result) values (lives_ok(
  format(
    $sql$insert into public.sales (project_id, lead_id, payment_modality_id, product_id, total_amount)
         select %L,
                (select id from public.leads where project_id = %L limit 1),
                (select id from public.payment_modalities where project_id = %L and name = 'Pago total'),
                (select id from public.products where project_id = %L and name = 'Sin categoría'),
                1000$sql$,
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  ),
  'operador inserta sale en su proyecto'
));

-- 36) coordinador NO inserta sale
select pg_temp.login_as('55555555-5555-5555-5555-555555555555');
insert into _smoke_results(result) values (pg_temp.throws_ok(
  format(
    $sql$insert into public.sales (project_id, lead_id, payment_modality_id, product_id, total_amount)
         select %L,
                (select id from public.leads where project_id = %L limit 1),
                (select id from public.payment_modalities where project_id = %L limit 1),
                (select id from public.products where project_id = %L and name = 'Sin categoría'),
                500$sql$,
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  ),
  '42501'::text, null::text,
  'coordinador NO inserta sale'::text
));

-- 37) operador SÍ inserta payment (carga cobros día a día)
select pg_temp.login_as('44444444-4444-4444-4444-444444444444');
insert into _smoke_results(result) values (lives_ok(
  format(
    $sql$insert into public.payments (sale_id, amount)
         select id, 300 from public.sales where project_id = %L limit 1$sql$,
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  ),
  'operador inserta payment'
));

-- 38) check amount > 0 → 0 o negativo rechaza
insert into _smoke_results(result) values (pg_temp.throws_ok(
  format(
    $sql$insert into public.payments (sale_id, amount)
         select id, 0 from public.sales where project_id = %L limit 1$sql$,
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  ),
  '23514'::text, null::text,
  'payments.amount > 0 (check rechaza 0)'::text
));

-- 39) cliente lee sales de su proyecto. Post-0023 cliente_role tiene grant
--     SELECT en columnas seguras (sin team_member_id); pedimos `id` para
--     verificar que el grant column-level está y la policy SELECT lo deja
--     pasar. La frontera de columna se prueba en el test 49.
select pg_temp.login_as('33333333-3333-3333-3333-333333333333');
insert into _smoke_results(result) values (isnt_empty(
  format('select id from public.sales where project_id = %L',
         'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  'cliente_role lee sales (columnas safe) de su proyecto'
));

-- 40) cliente NO ve sales de proyecto ajeno (seed en B como postgres)
reset role;
insert into public.payment_modalities (project_id, name) values
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Cross-tenant total');
insert into public.leads (project_id, name) values
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Cross-tenant lead');
insert into public.sales (project_id, lead_id, payment_modality_id, product_id, total_amount)
  select 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
         (select id from public.leads where project_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' limit 1),
         (select id from public.payment_modalities where project_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' limit 1),
         (select id from public.products where project_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' and name = 'Sin categoría'),
         5000;

select pg_temp.login_as('33333333-3333-3333-3333-333333333333');
insert into _smoke_results(result) values (is_empty(
  format('select id from public.sales where project_id = %L',
         'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  'cliente_role NO ve sales de proyecto ajeno (RLS filtra)'
));

-- 41) cliente NO ve payments de proyecto ajeno (project_of_sale resuelve B)
reset role;
insert into public.payments (sale_id, amount)
  select id, 100 from public.sales where project_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' limit 1;

select pg_temp.login_as('33333333-3333-3333-3333-333333333333');
insert into _smoke_results(result) values (is_empty(
  $sql$select 1 from public.payments where sale_id in (
         select id from public.sales where project_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
       )$sql$,
  'cliente NO ve payments de sale ajena'
));

-- ── Tests de ai_runs (post-0015) ──────────────────────────────────────────
-- Historial de ejecuciones de análisis IA por launch.
--   - SELECT  → has_project_access (todo miembro lee)
--   - INSERT  → can_edit_launches_in (admin+operador)
--   - UPDATE  → sin GRANT → blindado (historial inmutable)
--   - DELETE  → can_edit_project (admin/superadmin purga)

reset role;
delete from public.ai_runs where project_id in (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
);

-- 42) operador SÍ inserta ai_run en su proyecto
select pg_temp.login_as('44444444-4444-4444-4444-444444444444');
insert into _smoke_results(result) values (lives_ok(
  format(
    $sql$insert into public.ai_runs (launch_id, project_id, model, output_text)
         values (%L, %L, 'gpt-test', 'salida ejemplo')$sql$,
    'cccccccc-cccc-cccc-cccc-cccccccccccc',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  ),
  'operador inserta ai_run'
));

-- 43) coordinador NO inserta ai_run (no es can_edit_launches_in)
select pg_temp.login_as('55555555-5555-5555-5555-555555555555');
insert into _smoke_results(result) values (pg_temp.throws_ok(
  format(
    $sql$insert into public.ai_runs (launch_id, project_id, model, output_text)
         values (%L, %L, 'gpt-test', 'hack')$sql$,
    'cccccccc-cccc-cccc-cccc-cccccccccccc',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  ),
  '42501'::text, null::text,
  'coordinador NO inserta ai_run'::text
));

-- 44) cliente lee ai_runs de su proyecto
select pg_temp.login_as('33333333-3333-3333-3333-333333333333');
insert into _smoke_results(result) values (isnt_empty(
  format('select 1 from public.ai_runs where project_id = %L',
         'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  'cliente lee ai_runs de su proyecto'
));

-- 45) historial inmutable: UPDATE no tiene GRANT → permission denied 42501
insert into _smoke_results(result) values (pg_temp.throws_ok(
  format(
    $sql$update public.ai_runs set output_text = 'tampered'
         where project_id = %L$sql$,
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  ),
  '42501'::text, null::text,
  'ai_runs UPDATE blindado (historial inmutable)'::text
));

-- 46) operador NO puede DELETE (es can_edit_project) → USING filtra a 0
select pg_temp.login_as('44444444-4444-4444-4444-444444444444');
insert into _smoke_results(result) values (is_empty(
  format(
    $sql$with d as (delete from public.ai_runs where project_id = %L returning 1) select * from d$sql$,
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  ),
  'operador NO borra ai_runs (es admin-only)'
));

-- ── Tests de frontera-cliente (post-0023) ─────────────────────────────────
-- Bloque dedicado a las garantías nuevas del rol PostgREST `cliente_role`:
--   - "cocina interna" (commission_rules, payment_modalities) inaccesible.
--   - sales.team_member_id imposible de pedir aun con grant column-level.
--   - sales.total_amount sí legible.
--   - projections: cliente CRUDea las suyas, no las ajenas.
--   - launches/leads: sin grant INSERT al cliente_role.

select pg_temp.login_as('33333333-3333-3333-3333-333333333333');

-- 47) cliente_role NO accede a commission_rules (no grant)
insert into _smoke_results(result) values (pg_temp.throws_ok(
  format('select 1 from public.commission_rules where project_id = %L',
         'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  '42501'::text, null::text,
  'cliente_role NO accede a commission_rules (no grant)'::text
));

-- 48) cliente_role NO accede a payment_modalities (no grant)
insert into _smoke_results(result) values (pg_temp.throws_ok(
  format('select 1 from public.payment_modalities where project_id = %L',
         'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  '42501'::text, null::text,
  'cliente_role NO accede a payment_modalities (no grant)'::text
));

-- 49) cliente_role NO puede pedir sales.team_member_id (frontera de COLUMNA).
--     El grant column-level a cliente_role omite team_member_id; pedirlo
--     explícito lanza permission denied. La RLS de fila igual lo dejaría
--     pasar — esta barrera es el grant.
insert into _smoke_results(result) values (pg_temp.throws_ok(
  format('select team_member_id from public.sales where project_id = %L',
         'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  '42501'::text, null::text,
  'cliente_role NO accede a sales.team_member_id (columna no grantada)'::text
));

-- 50) cliente_role SÍ lee total_amount / closed_at de su proyecto.
insert into _smoke_results(result) values (isnt_empty(
  format('select total_amount, closed_at from public.sales where project_id = %L',
         'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  'cliente_role SÍ lee total_amount/closed_at (columnas safe)'
));

-- 51) cliente_role SÍ inserta projection propia (created_by = auth.uid()).
--     La policy projections_insert acepta cuando created_by = auth.uid() AND
--     has_project_access(project_id). cliente1 es miembro de Proyecto A.
insert into _smoke_results(result) values (lives_ok(
  format(
    $sql$insert into public.projections (project_id, created_by, name, mode)
         values (%L, %L, 'Proyección cliente', 'forward')$sql$,
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '33333333-3333-3333-3333-333333333333'
  ),
  'cliente_role inserta projection propia'
));

-- 52) cliente_role NO actualiza projection ajena (created_by ≠ auth.uid()).
--     Seedeamos una projection de admin1 como postgres. La policy update
--     filtra: cliente no es admin (can_edit_project=false) y created_by ≠ uid
--     → USING devuelve false → UPDATE no toca filas (silencioso 0 filas).
reset role;
insert into public.projections (project_id, created_by, name, mode) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   '22222222-2222-2222-2222-222222222222',
   'Proyección de admin', 'forward');

select pg_temp.login_as('33333333-3333-3333-3333-333333333333');
insert into _smoke_results(result) values (is_empty(
  $sql$with u as (
    update public.projections set name = 'hack'
     where created_by = '22222222-2222-2222-2222-222222222222'
     returning 1
  ) select * from u$sql$,
  'cliente_role NO edita projections ajenas (RLS filtra)'
));

-- 53) cliente_role NO puede INSERT en launches (no grant) → 42501.
insert into _smoke_results(result) values (pg_temp.throws_ok(
  format('insert into public.launches (project_id, name) values (%L, %L)',
         'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'launch del cliente'),
  '42501'::text, null::text,
  'cliente_role NO inserta launches (no grant)'::text
));

-- 54) cliente_role NO puede INSERT en leads (no grant) → 42501.
--     Frontera pre-RLS: ni siquiera lleva la request a evaluar can_edit_*.
insert into _smoke_results(result) values (pg_temp.throws_ok(
  format('insert into public.leads (project_id, name) values (%L, %L)',
         'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'lead del cliente'),
  '42501'::text, null::text,
  'cliente_role NO inserta leads (no grant)'::text
));

-- 55) cliente_role NO puede pedir leads.team_member_id (frontera de columna).
--     Mismo patrón que el test 49 sobre sales: la asignación setter/closer es
--     "cocina interna" y el grant column-level la omite.
insert into _smoke_results(result) values (pg_temp.throws_ok(
  format('select team_member_id from public.leads where project_id = %L',
         'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  '42501'::text, null::text,
  'cliente_role NO accede a leads.team_member_id (columna no grantada)'::text
));

-- ── Tests de notificaciones (post-0024 — Fase 7a) ─────────────────────────
-- Seed via service-role-equivalent (postgres) usando el helper RPC. Cada
-- insert pasa por `create_notification` (SECURITY DEFINER), igual que en
-- runtime. La dedup_key del test 62 fuerza colisión para validar el ON
-- CONFLICT.
reset role;
delete from public.notifications where project_id in (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
);

-- Notif al equipo del Proyecto A (target_role='team').
select public.create_notification(
  p_project_id  := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  p_type        := 'sync_failed',
  p_title       := 'Sync meta falló',
  p_severity    := 'error',
  p_body        := null,
  p_target_role := 'team',
  p_dedup_key   := 'sync_failed:test:meta:2026-06-16'
);

-- Notif al cliente del Proyecto A (target_role='cliente').
select public.create_notification(
  p_project_id  := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  p_type        := 'launch_started',
  p_title       := 'Tu lanzamiento arrancó',
  p_severity    := 'info',
  p_body        := null,
  p_target_role := 'cliente',
  p_dedup_key   := 'launch_started:test:launch1'
);

-- Notif personal al admin del Proyecto A (target_user_id).
select public.create_notification(
  p_project_id     := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  p_type           := 'test_personal',
  p_title          := 'Ping para admin',
  p_target_user_id := '22222222-2222-2222-2222-222222222222'
);

-- 56) operador SÍ ve la notif target_role='team' de su proyecto.
select pg_temp.login_as('44444444-4444-4444-4444-444444444444');
insert into _smoke_results(result) values (isnt_empty(
  $sql$select 1 from public.notifications
        where type = 'sync_failed'$sql$,
  'operador (team) ve notif target_role=team'
));

-- 57) operador NO ve la notif target_role='cliente' (su rol no matchea).
insert into _smoke_results(result) values (is_empty(
  $sql$select 1 from public.notifications
        where type = 'launch_started'$sql$,
  'operador NO ve notif target_role=cliente'
));

-- 58) cliente SÍ ve la notif target_role='cliente' de su proyecto.
select pg_temp.login_as('33333333-3333-3333-3333-333333333333');
insert into _smoke_results(result) values (isnt_empty(
  $sql$select 1 from public.notifications
        where type = 'launch_started'$sql$,
  'cliente ve notif target_role=cliente'
));

-- 59) cliente NO ve la notif target_role='team' (cocina del equipo).
insert into _smoke_results(result) values (is_empty(
  $sql$select 1 from public.notifications
        where type = 'sync_failed'$sql$,
  'cliente NO ve notif target_role=team (frontera dura)'
));

-- 60) admin SÍ ve su notif target_user_id propia.
select pg_temp.login_as('22222222-2222-2222-2222-222222222222');
insert into _smoke_results(result) values (isnt_empty(
  $sql$select 1 from public.notifications
        where type = 'test_personal'$sql$,
  'admin ve notif personal (target_user_id)'
));

-- 61) operador NO ve la notif personal del admin (target_user_id ajeno).
select pg_temp.login_as('44444444-4444-4444-4444-444444444444');
insert into _smoke_results(result) values (is_empty(
  $sql$select 1 from public.notifications
        where type = 'test_personal'$sql$,
  'operador NO ve notif personal de otro usuario'
));

-- 62) dedup_key bloquea el segundo insert con la misma clave. ON CONFLICT
--     DO NOTHING absorbe — no lanza excepción, devuelve NULL. Comprobamos
--     que la cantidad de filas con esa key sigue en 1.
reset role;
select public.create_notification(
  p_project_id  := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  p_type        := 'sync_failed',
  p_title       := 'duplicado',
  p_target_role := 'team',
  p_dedup_key   := 'sync_failed:test:meta:2026-06-16'
);
insert into _smoke_results(result) values (is(
  (select count(*)::int from public.notifications
    where dedup_key = 'sync_failed:test:meta:2026-06-16'),
  1,
  'dedup_key bloquea segundo insert (ON CONFLICT absorbe)'
));

-- ── Tests de alert_rules (post-0025 — Fase 7b) ────────────────────────────
-- Pre-seed limpio para que los conteos sean deterministas.
reset role;
delete from public.alert_rules where launch_id in (
  'cccccccc-cccc-cccc-cccc-cccccccccccc',
  'dddddddd-dddd-dddd-dddd-dddddddddddd'
);

-- 63) admin SÍ inserta alert_rule en launch de su proyecto.
select pg_temp.login_as('22222222-2222-2222-2222-222222222222');
insert into _smoke_results(result) values (lives_ok(
  format(
    $sql$insert into public.alert_rules (launch_id, metric, operator, threshold)
         values (%L, 'cpl', '>', 25)$sql$,
    'cccccccc-cccc-cccc-cccc-cccccccccccc'
  ),
  'admin inserta alert_rule (can_edit_launches_in)'
));

-- 64) operador SÍ inserta alert_rule (mismo gate que admin).
select pg_temp.login_as('44444444-4444-4444-4444-444444444444');
insert into _smoke_results(result) values (lives_ok(
  format(
    $sql$insert into public.alert_rules (launch_id, metric, operator, threshold)
         values (%L, 'inversion', '>', 500)$sql$,
    'cccccccc-cccc-cccc-cccc-cccccccccccc'
  ),
  'operador inserta alert_rule'
));

-- 65) coordinador NO inserta alert_rule — can_edit_launches_in es false.
select pg_temp.login_as('55555555-5555-5555-5555-555555555555');
insert into _smoke_results(result) values (pg_temp.throws_ok(
  format(
    $sql$insert into public.alert_rules (launch_id, metric, operator, threshold)
         values (%L, 'cpl', '>', 99)$sql$,
    'cccccccc-cccc-cccc-cccc-cccccccccccc'
  ),
  '42501'::text, null::text,
  'coordinador NO inserta alert_rule (RLS WITH CHECK)'::text
));

-- 66) coordinador SÍ lee alert_rules de su proyecto (has_project_access).
insert into _smoke_results(result) values (isnt_empty(
  format('select 1 from public.alert_rules where launch_id = %L',
         'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  'coordinador lee alert_rules de su proyecto'
));

-- 67) UNIQUE (launch_id, metric, operator, threshold) bloquea duplicado.
select pg_temp.login_as('22222222-2222-2222-2222-222222222222');
insert into _smoke_results(result) values (pg_temp.throws_ok(
  format(
    $sql$insert into public.alert_rules (launch_id, metric, operator, threshold)
         values (%L, 'cpl', '>', 25)$sql$,
    'cccccccc-cccc-cccc-cccc-cccccccccccc'
  ),
  '23505'::text, null::text,
  'UNIQUE bloquea segunda regla idéntica'::text
));

-- 68) cliente_role NO accede a alert_rules (no grant en 0025 — frontera dura).
select pg_temp.login_as('33333333-3333-3333-3333-333333333333');
insert into _smoke_results(result) values (pg_temp.throws_ok(
  format('select 1 from public.alert_rules where launch_id = %L',
         'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  '42501'::text, null::text,
  'cliente_role NO accede a alert_rules (no grant)'::text
));

-- 69) cliente_role NO inserta alert_rules (no grant insert).
insert into _smoke_results(result) values (pg_temp.throws_ok(
  format(
    $sql$insert into public.alert_rules (launch_id, metric, operator, threshold)
         values (%L, 'cpl', '>', 1)$sql$,
    'cccccccc-cccc-cccc-cccc-cccccccccccc'
  ),
  '42501'::text, null::text,
  'cliente_role NO inserta alert_rules (no grant)'::text
));

-- 70) admin NO inserta alert_rule de un launch ajeno (proyecto B sin miembros
--     no es accesible). RLS WITH CHECK bloquea.
select pg_temp.login_as('22222222-2222-2222-2222-222222222222');
reset role;
insert into public.launches (id, project_id, name) values
  ('ffffffff-ffff-ffff-ffff-ffffffffffff',
   'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   'Launch ajeno B')
on conflict (id) do nothing;
select pg_temp.login_as('22222222-2222-2222-2222-222222222222');
insert into _smoke_results(result) values (pg_temp.throws_ok(
  format(
    $sql$insert into public.alert_rules (launch_id, metric, operator, threshold)
         values (%L, 'cpl', '>', 25)$sql$,
    'ffffffff-ffff-ffff-ffff-ffffffffffff'
  ),
  '42501'::text, null::text,
  'admin NO inserta alert_rule en launch de proyecto ajeno'::text
));

-- ── Tests de notificaciones al cliente (post-0026 — Fase 7c) ──────────────
-- Limpieza previa para conteos deterministas.
reset role;
delete from public.notifications where launch_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
update public.launches set status = null where id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

-- 71) AFTER UPDATE OF status a 'Activo' crea notif `launch_started` para
--     cliente. Disparamos el UPDATE como postgres (bypass RLS); el trigger
--     corre con SECURITY DEFINER y el create_notification también.
update public.launches set status = 'Activo'
 where id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

insert into _smoke_results(result) values (is(
  (select count(*)::int from public.notifications
    where type = 'launch_started'
      and launch_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  1,
  'AFTER UPDATE status=Activo crea notif launch_started'
));

-- 72) cliente_role SÍ ve la notif launch_started de su proyecto.
select pg_temp.login_as('33333333-3333-3333-3333-333333333333');
insert into _smoke_results(result) values (isnt_empty(
  $sql$select 1 from public.notifications
        where type = 'launch_started'$sql$,
  'cliente ve notif launch_started (target_role=cliente)'
));

-- 73) operador NO ve la notif launch_started (es del scope cliente).
select pg_temp.login_as('44444444-4444-4444-4444-444444444444');
insert into _smoke_results(result) values (is_empty(
  $sql$select 1 from public.notifications
        where type = 'launch_started'$sql$,
  'operador NO ve notif launch_started (frontera cliente)'
));

-- 74) Reabrir (Activo → Finalizado → Activo) NO genera segunda notif —
--     dedup_key 'launch_started:<launch_id>' absorbe.
reset role;
update public.launches set status = 'Finalizado'
 where id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
update public.launches set status = 'Activo'
 where id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

insert into _smoke_results(result) values (is(
  (select count(*)::int from public.notifications
    where type = 'launch_started'
      and launch_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  1,
  'reabrir launch NO duplica notif (dedup_key absorbe)'
));

-- 75) AFTER INSERT ai_runs status=success crea notif `ai_summary_ready` al
--     cliente. INSERT como postgres (bypass RLS) para no pelearnos con la
--     RLS de ai_runs_insert.
reset role;
delete from public.ai_runs where launch_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
delete from public.notifications
 where type = 'ai_summary_ready'
   and launch_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

insert into public.ai_runs (launch_id, project_id, user_id, model, status, output_text)
values ('cccccccc-cccc-cccc-cccc-cccccccccccc',
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        '22222222-2222-2222-2222-222222222222',
        'gpt-test', 'success', 'Resumen de prueba 7c');

insert into _smoke_results(result) values (is(
  (select count(*)::int from public.notifications
    where type = 'ai_summary_ready'
      and launch_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  1,
  'AFTER INSERT ai_run success crea notif ai_summary_ready'
));

-- ═══════════════════════════════════════════════════════════════════════════
-- Fase 8a — Reciclado de leads evergreen
--
-- Setup local del test (en proj_a, como postgres para evitar RLS).
-- Usamos NAMES para localizar los launches/leads (sin uuids hardcoded) para
-- evitar cualquier colisión accidental por uuid pre-existente. Las
-- variables temporales guardan los uuids generados para reusarlos.
-- ═══════════════════════════════════════════════════════════════════════════
reset role;

-- Limpieza defensiva — si una corrida previa dejó datos sueltos (no debería
-- por el ROLLBACK, pero por las dudas), borramos primero.
delete from public.sales
 where project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
   and lead_id in (
     select id from public.leads
      where project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
        and name in ('Lead 8a Uno', 'Lead 8a Dos', 'Lead 8a Tres')
   );
delete from public.leads
 where project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
   and name in ('Lead 8a Uno', 'Lead 8a Dos', 'Lead 8a Tres');
delete from public.launches
 where project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
   and name in ('Evergreen 8a origen', 'Target 8a grande');
delete from public.payment_modalities
 where project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
   and name = 'Pago total 8a';

-- Crear target primero (FK del evergreen apunta acá), después evergreen,
-- después modality, después leads, después sale para L3.
insert into public.launches (project_id, name, is_evergreen)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Target 8a grande', false);

insert into public.launches (project_id, name, is_evergreen, recycle_target_launch_id)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'Evergreen 8a origen', true,
   (select id from public.launches
     where project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
       and name = 'Target 8a grande'));

insert into public.payment_modalities (project_id, name)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Pago total 8a');

-- L1, L2, L3 en evergreen. Phones distintos para no chocar el unique parcial.
insert into public.leads (project_id, launch_id, name, phone_normalized, source, status)
select 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
       (select id from public.launches
         where project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
           and name = 'Evergreen 8a origen'),
       n, p, 'manual', s
from (values
        ('Lead 8a Uno',  '+5491100000001'::text, 'frio'::text),
        ('Lead 8a Dos',  '+5491100000002'::text, 'frio'::text),
        ('Lead 8a Tres', '+5491100000003'::text, 'cerrado'::text)
     ) as v(n, p, s);

-- Sale para L3 — esto lo excluye del reciclado (NOT EXISTS sale).
insert into public.sales (project_id, lead_id, payment_modality_id, product_id, total_amount)
select 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
       (select id from public.leads
         where project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
           and name = 'Lead 8a Tres'),
       (select id from public.payment_modalities
         where project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
           and name = 'Pago total 8a'),
       (select id from public.products
         where project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
           and name = 'Sin categoría'),
       1000;

-- 76) recycle_evergreen_leads sobre un launch NO evergreen (target launch
--     mismo) → 0 y nada se inserta. Confirma el guard silencioso.
insert into _smoke_results(result) values (is(
  (select public.recycle_evergreen_leads(
    (select id from public.launches
      where project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
        and name = 'Target 8a grande')
  )),
  0,
  '8a: recycle sobre launch no-evergreen devuelve 0 (no-op)'
));

-- 77) Diagnóstico — confirma que el seed creó los 3 leads en el evergreen.
--     Si esto falla, el problema está en el seed (no en el RPC).
insert into _smoke_results(result) values (is(
  (select count(*)::int from public.leads
    where launch_id = (
      select id from public.launches
       where project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
         and name = 'Evergreen 8a origen'
    )),
  3,
  '8a [diag]: el evergreen tiene 3 leads tras el seed'
));

-- 78) Diagnóstico — confirma que 2 de esos leads NO tienen sale (L1 + L2).
--     Si esto falla, alguna sale extra está pegada y el RPC ve menos
--     candidatos.
insert into _smoke_results(result) values (is(
  (select count(*)::int from public.leads l
    where l.launch_id = (
      select id from public.launches
       where project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
         and name = 'Evergreen 8a origen'
    )
      and not exists (select 1 from public.sales s where s.lead_id = l.id)),
  2,
  '8a [diag]: 2 leads del evergreen están sin sale (candidatos a reciclar)'
));

-- 79) Llamada al recycle del evergreen real → devuelve 2 (L1 + L2 movidos).
insert into _smoke_results(result) values (is(
  (select public.recycle_evergreen_leads(
    (select id from public.launches
      where project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
        and name = 'Evergreen 8a origen')
  )),
  2,
  '8a: recycle de evergreen transfiere exactamente 2 leads sin venta'
));

-- 80) El target quedó con 2 leads cuyo recycled_from apunta al evergreen.
--     La traza vive en `recycled_from_launch_id` (source NO se pisa: L1/L2
--     mantienen su source original 'manual').
insert into _smoke_results(result) values (is(
  (select count(*)::int from public.leads
    where launch_id = (
      select id from public.launches
       where project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
         and name = 'Target 8a grande'
    )
      and recycled_from_launch_id = (
        select id from public.launches
         where project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
           and name = 'Evergreen 8a origen'
      )),
  2,
  '8a: target recibió 2 leads con traza al evergreen origen'
));

-- 81) L3 (con sale) NO se transfirió — sigue colgando del evergreen.
insert into _smoke_results(result) values (is(
  (select launch_id from public.leads
    where project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
      and name = 'Lead 8a Tres'),
  (select id from public.launches
    where project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
      and name = 'Evergreen 8a origen'),
  '8a: lead con venta cerrada NO se mueve, queda en el evergreen'
));

-- 82) Idempotencia: segunda llamada filtra `recycled_from IS NULL` así que
--     no re-mueve nada. Target sigue con 2 leads.
select public.recycle_evergreen_leads(
  (select id from public.launches
    where project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
      and name = 'Evergreen 8a origen')
);
insert into _smoke_results(result) values (is(
  (select count(*)::int from public.leads
    where launch_id = (
      select id from public.launches
       where project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
         and name = 'Target 8a grande'
    )
      and recycled_from_launch_id = (
        select id from public.launches
         where project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
           and name = 'Evergreen 8a origen'
      )),
  2,
  '8a: segunda llamada no re-mueve leads (idempotente vía recycled_from filter)'
));

-- ── Tests de nivel organización (post-0050/0051/0052 — Bloque 0 Kingrow) ──
-- Regla central: el rol `cliente` (Portal del cliente) jamás toca datos de
-- nivel org. La barrera dura es pre-RLS: `cliente_role` no tiene ningún
-- grant sobre `organization`, así que PostgREST responde 42501 antes de
-- evaluar policy. Además chequeamos que no rompimos lo que el cliente ya
-- podía leer (regresión) y que superadmin sí llega.
--
-- Tests de esquema (backfill + defaults) van al final: se corren como owner
-- (postgres/service) porque son verificaciones estructurales, no de RLS.

-- 83) cliente_role NO accede a organization (sin grant → 42501 pre-RLS).
--     Esta es la garantía central del bloque.
select pg_temp.login_as('33333333-3333-3333-3333-333333333333');
insert into _smoke_results(result) values (pg_temp.throws_ok(
  'select 1 from public.organization'::text,
  '42501'::text, null::text,
  'cliente_role NO accede a organization (sin grant, pre-RLS)'::text
));

-- 84) Regresión: cliente_role sigue leyendo lo project-scope que ya leía.
--     Usamos launches del Proyecto A del cliente — path canónico.
insert into _smoke_results(result) values (isnt_empty(
  format('select 1 from public.launches where project_id = %L',
         'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  'cliente_role sigue leyendo launches de su proyecto (no rompimos nada)'
));

-- 85) superadmin SÍ lee organization (ve la semilla Kingrow).
select pg_temp.login_as('11111111-1111-1111-1111-111111111111');
insert into _smoke_results(result) values (isnt_empty(
  $sql$select 1 from public.organization where name = 'Kingrow'$sql$,
  'superadmin SÍ lee organization (semilla Kingrow visible)'
));

-- 86) admin normal (no superadmin) NO lee organization todavía.
--     is_kingrow_admin() hoy = is_superadmin(); admin1 es 'admin', no
--     'superadmin'/'dev' → policy filtra. Prueba que la frontera no depende
--     sólo del grant sino también de la policy.
select pg_temp.login_as('22222222-2222-2222-2222-222222222222');
insert into _smoke_results(result) values (is_empty(
  $sql$select 1 from public.organization$sql$,
  'admin normal NO lee organization (no es kingrow admin todavía)'
));

-- 87) Backfill: cero rows en projects con organization_id null.
reset role;
insert into _smoke_results(result) values (is(
  (select count(*)::int from public.projects where organization_id is null),
  0,
  'projects.organization_id: cero nulls tras backfill 0050'
));

-- 88) Default de ownership funciona: nuevo project sin ownership → 'externa'.
--     Insertamos un project temporal (sin especificar ownership ni org_id) y
--     leemos las columnas. Cleanup al final del bloque.
insert into public.projects (id, name)
values ('cafecafe-cafe-cafe-cafe-cafecafecafe', 'Proyecto default-check');

insert into _smoke_results(result) values (is(
  (select ownership from public.projects
    where id = 'cafecafe-cafe-cafe-cafe-cafecafecafe'),
  'externa',
  'projects.ownership default = externa cuando se omite'
));

-- 89) Default de organization_id funciona: mismo project apunta a Kingrow.
insert into _smoke_results(result) values (is(
  (select organization_id from public.projects
    where id = 'cafecafe-cafe-cafe-cafe-cafecafecafe'),
  '00000000-0000-0000-0000-000000000001'::uuid,
  'projects.organization_id default = Kingrow cuando se omite'
));

delete from public.projects
 where id = 'cafecafe-cafe-cafe-cafe-cafecafecafe';

-- ── Tests del Bloque 1 (Kingrow) — 0053/0055/0056 + bancos 0057 ───────────
-- Frontera dura sobre las 3 tablas nuevas de nivel org (settlement_rules,
-- launch_settlements, client_transfers): cliente_role rebota pre-RLS por
-- falta de grant (42501). admin normal tiene grant pero la policy con
-- can_edit_organization filtra a 0. Superadmin llega y lee.
--
-- Además: 0057 sumó organization_id a banks / bank_movements de forma
-- aditiva. Chequeamos backfill (cero nulls) y que la RLS project-scope
-- histórica sigue funcionando (no rompimos la UX de bancos por proyecto).

-- 90) cliente_role NO accede a settlement_rules (sin grant → 42501 pre-RLS)
select pg_temp.login_as('33333333-3333-3333-3333-333333333333');
insert into _smoke_results(result) values (pg_temp.throws_ok(
  'select 1 from public.settlement_rules'::text,
  '42501'::text, null::text,
  'cliente_role NO accede a settlement_rules (sin grant, pre-RLS)'::text
));

-- 91) cliente_role NO accede a launch_settlements
insert into _smoke_results(result) values (pg_temp.throws_ok(
  'select 1 from public.launch_settlements'::text,
  '42501'::text, null::text,
  'cliente_role NO accede a launch_settlements (sin grant, pre-RLS)'::text
));

-- 92) cliente_role NO accede a client_transfers
insert into _smoke_results(result) values (pg_temp.throws_ok(
  'select 1 from public.client_transfers'::text,
  '42501'::text, null::text,
  'cliente_role NO accede a client_transfers (sin grant, pre-RLS)'::text
));

-- 93) admin normal NO ve settlement_rules — grant existe (authenticated
--     tiene SELECT), pero can_edit_organization() = is_kingrow_admin() =
--     is_superadmin(); admin1 es 'admin', no 'superadmin'/'dev' → filtra a 0.
--     lives_ok prueba que el grant está; is_empty prueba que la policy filtra.
select pg_temp.login_as('22222222-2222-2222-2222-222222222222');
insert into _smoke_results(result) values (lives_ok(
  'select 1 from public.settlement_rules'::text,
  'admin normal tiene grant SELECT en settlement_rules (llega a RLS)'
));
insert into _smoke_results(result) values (is_empty(
  'select 1 from public.settlement_rules'::text,
  'admin normal NO ve settlement_rules (policy org-scope filtra)'
));

-- 94) admin normal NO ve launch_settlements
insert into _smoke_results(result) values (is_empty(
  'select 1 from public.launch_settlements'::text,
  'admin normal NO ve launch_settlements (policy org-scope filtra)'
));

-- 95) admin normal NO ve client_transfers
insert into _smoke_results(result) values (is_empty(
  'select 1 from public.client_transfers'::text,
  'admin normal NO ve client_transfers (policy org-scope filtra)'
));

-- 96) superadmin lee settlement_rules (grant + policy OK — tabla vacía,
--     pero el SELECT completa sin error). Prueba end-to-end del path.
select pg_temp.login_as('11111111-1111-1111-1111-111111111111');
insert into _smoke_results(result) values (lives_ok(
  'select 1 from public.settlement_rules'::text,
  'superadmin lee settlement_rules (path grant+policy OK)'
));

-- 97) superadmin lee launch_settlements
insert into _smoke_results(result) values (lives_ok(
  'select 1 from public.launch_settlements'::text,
  'superadmin lee launch_settlements (path grant+policy OK)'
));

-- 98) superadmin lee client_transfers
insert into _smoke_results(result) values (lives_ok(
  'select 1 from public.client_transfers'::text,
  'superadmin lee client_transfers (path grant+policy OK)'
));

-- 99) 0057 backfill: cero nulls en banks.organization_id
reset role;
insert into _smoke_results(result) values (is(
  (select count(*)::int from public.banks where organization_id is null),
  0,
  'banks.organization_id: cero nulls tras backfill 0057'
));

-- 100) 0057 backfill: cero nulls en bank_movements.organization_id
insert into _smoke_results(result) values (is(
  (select count(*)::int from public.bank_movements where organization_id is null),
  0,
  'bank_movements.organization_id: cero nulls tras backfill 0057'
));

-- 101) Regresión banks: admin del proyecto sigue insertando bank en su
--      proyecto (RLS project-scope intacta post-0057, aditivo puro).
--      El default de organization_id se aplica solo — no hay que pasarlo.
select pg_temp.login_as('22222222-2222-2222-2222-222222222222');
insert into _smoke_results(result) values (lives_ok(
  format(
    'insert into public.banks (project_id, name) values (%L, %L)',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'Banco regresión 0057'
  ),
  'banks: admin del proyecto sigue insertando (RLS project-scope intacta)'
));

-- ── Tests del Bloque 2 (Kingrow · Financiero) — 0058-0068 ─────────────────
-- Frontera dura sobre las 11 tablas org-scope nuevas del módulo financiero.
-- Mismo patrón que Bloque 1 (tests 90-98):
--   - cliente_role rebota pre-RLS por falta de grant → 42501
--   - admin normal (no superadmin) tiene grant pero la policy con
--     can_edit_organization filtra a 0 filas
--   - superadmin llega y lee sin error
--
-- Estos son los datos MÁS SENSIBLES de Kingrow (sueldos, cuentas por pagar,
-- facturación interna). El gate anti-cliente es no-negociable.

-- ═══════════ Bloque 2 · Grupo A: cliente_role NO accede (42501) ═══════════
select pg_temp.login_as('33333333-3333-3333-3333-333333333333');

-- 102) organization_people
insert into _smoke_results(result) values (pg_temp.throws_ok(
  'select 1 from public.organization_people'::text,
  '42501'::text, null::text,
  'cliente_role NO accede a organization_people (identidad de personas)'::text
));

-- 103) accounts
insert into _smoke_results(result) values (pg_temp.throws_ok(
  'select 1 from public.accounts'::text,
  '42501'::text, null::text,
  'cliente_role NO accede a accounts (plan de cuentas)'::text
));

-- 104) cost_centers
insert into _smoke_results(result) values (pg_temp.throws_ok(
  'select 1 from public.cost_centers'::text,
  '42501'::text, null::text,
  'cliente_role NO accede a cost_centers'::text
));

-- 105) taxes
insert into _smoke_results(result) values (pg_temp.throws_ok(
  'select 1 from public.taxes'::text,
  '42501'::text, null::text,
  'cliente_role NO accede a taxes'::text
));

-- 106) suppliers
insert into _smoke_results(result) values (pg_temp.throws_ok(
  'select 1 from public.suppliers'::text,
  '42501'::text, null::text,
  'cliente_role NO accede a suppliers'::text
));

-- 107) expenses
insert into _smoke_results(result) values (pg_temp.throws_ok(
  'select 1 from public.expenses'::text,
  '42501'::text, null::text,
  'cliente_role NO accede a expenses (gastos org)'::text
));

-- 108) invoices
insert into _smoke_results(result) values (pg_temp.throws_ok(
  'select 1 from public.invoices'::text,
  '42501'::text, null::text,
  'cliente_role NO accede a invoices (facturación Kingrow→externos)'::text
));

-- 109) budgets
insert into _smoke_results(result) values (pg_temp.throws_ok(
  'select 1 from public.budgets'::text,
  '42501'::text, null::text,
  'cliente_role NO accede a budgets'::text
));

-- 110) payroll — el más sensible: sueldos
insert into _smoke_results(result) values (pg_temp.throws_ok(
  'select 1 from public.payroll'::text,
  '42501'::text, null::text,
  'cliente_role NO accede a payroll (sueldos — máxima confidencialidad)'::text
));

-- 111) assets
insert into _smoke_results(result) values (pg_temp.throws_ok(
  'select 1 from public.assets'::text,
  '42501'::text, null::text,
  'cliente_role NO accede a assets (activos org)'::text
));

-- 112) liabilities
insert into _smoke_results(result) values (pg_temp.throws_ok(
  'select 1 from public.liabilities'::text,
  '42501'::text, null::text,
  'cliente_role NO accede a liabilities (pasivos org)'::text
));

-- ═══════════ Bloque 2 · Grupo B: superadmin lee sin error ═════════════════
-- Prueba end-to-end del path grant+policy. Tablas vacías, pero el SELECT
-- completa — si el grant o la policy estuvieran mal, este bloque revienta.
select pg_temp.login_as('11111111-1111-1111-1111-111111111111');

-- 113) organization_people
insert into _smoke_results(result) values (lives_ok(
  'select 1 from public.organization_people'::text,
  'superadmin lee organization_people (path grant+policy OK)'
));

-- 114) accounts
insert into _smoke_results(result) values (lives_ok(
  'select 1 from public.accounts'::text,
  'superadmin lee accounts (path grant+policy OK)'
));

-- 115) cost_centers
insert into _smoke_results(result) values (lives_ok(
  'select 1 from public.cost_centers'::text,
  'superadmin lee cost_centers (path grant+policy OK)'
));

-- 116) taxes
insert into _smoke_results(result) values (lives_ok(
  'select 1 from public.taxes'::text,
  'superadmin lee taxes (path grant+policy OK)'
));

-- 117) suppliers
insert into _smoke_results(result) values (lives_ok(
  'select 1 from public.suppliers'::text,
  'superadmin lee suppliers (path grant+policy OK)'
));

-- 118) expenses
insert into _smoke_results(result) values (lives_ok(
  'select 1 from public.expenses'::text,
  'superadmin lee expenses (path grant+policy OK)'
));

-- 119) invoices
insert into _smoke_results(result) values (lives_ok(
  'select 1 from public.invoices'::text,
  'superadmin lee invoices (path grant+policy OK)'
));

-- 120) budgets
insert into _smoke_results(result) values (lives_ok(
  'select 1 from public.budgets'::text,
  'superadmin lee budgets (path grant+policy OK)'
));

-- 121) payroll
insert into _smoke_results(result) values (lives_ok(
  'select 1 from public.payroll'::text,
  'superadmin lee payroll (path grant+policy OK)'
));

-- 122) assets
insert into _smoke_results(result) values (lives_ok(
  'select 1 from public.assets'::text,
  'superadmin lee assets (path grant+policy OK)'
));

-- 123) liabilities
insert into _smoke_results(result) values (lives_ok(
  'select 1 from public.liabilities'::text,
  'superadmin lee liabilities (path grant+policy OK)'
));

-- ═══════════ Bloque 2 · Grupo C: admin normal filtrado por policy ═════════
-- Grant existe (authenticated tiene SELECT en todas), pero
-- can_edit_organization() = is_kingrow_admin() = is_superadmin(); admin1 es
-- 'admin', no 'superadmin' → policy filtra a 0 filas. Es la garantía de que
-- la frontera no depende solo del grant sino de la combinación grant+policy.
select pg_temp.login_as('22222222-2222-2222-2222-222222222222');

-- 124) organization_people
insert into _smoke_results(result) values (is_empty(
  'select 1 from public.organization_people'::text,
  'admin normal NO ve organization_people (policy org-scope filtra)'
));

-- 125) accounts
insert into _smoke_results(result) values (is_empty(
  'select 1 from public.accounts'::text,
  'admin normal NO ve accounts (policy org-scope filtra)'
));

-- 126) cost_centers
insert into _smoke_results(result) values (is_empty(
  'select 1 from public.cost_centers'::text,
  'admin normal NO ve cost_centers (policy org-scope filtra)'
));

-- 127) taxes
insert into _smoke_results(result) values (is_empty(
  'select 1 from public.taxes'::text,
  'admin normal NO ve taxes (policy org-scope filtra)'
));

-- 128) suppliers
insert into _smoke_results(result) values (is_empty(
  'select 1 from public.suppliers'::text,
  'admin normal NO ve suppliers (policy org-scope filtra)'
));

-- 129) expenses
insert into _smoke_results(result) values (is_empty(
  'select 1 from public.expenses'::text,
  'admin normal NO ve expenses (policy org-scope filtra)'
));

-- 130) invoices
insert into _smoke_results(result) values (is_empty(
  'select 1 from public.invoices'::text,
  'admin normal NO ve invoices (policy org-scope filtra)'
));

-- 131) budgets
insert into _smoke_results(result) values (is_empty(
  'select 1 from public.budgets'::text,
  'admin normal NO ve budgets (policy org-scope filtra)'
));

-- 132) payroll
insert into _smoke_results(result) values (is_empty(
  'select 1 from public.payroll'::text,
  'admin normal NO ve payroll (policy org-scope filtra)'
));

-- 133) assets
insert into _smoke_results(result) values (is_empty(
  'select 1 from public.assets'::text,
  'admin normal NO ve assets (policy org-scope filtra)'
));

-- 134) liabilities
insert into _smoke_results(result) values (is_empty(
  'select 1 from public.liabilities'::text,
  'admin normal NO ve liabilities (policy org-scope filtra)'
));

-- 135) Regresión 0058: team_members.organization_person_id existe (aditivo,
--      nullable, sin default). Chequea que la column se agregó y que las
--      filas existentes quedaron con NULL (sin backfill).
reset role;
insert into _smoke_results(result) values (is(
  (select count(*)::int from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'team_members'
      and column_name  = 'organization_person_id'),
  1,
  'team_members.organization_person_id existe (columna aditiva de 0058)'
));

-- ═══════════════════════════════════════════════════════════════════════════
-- Bloque 4 (Kingrow — Academia) — post-0070..0079
--
-- Setup del test suite:
--   - Proyecto A pasa a ownership='propia' (era 'externa' por default).
--     Los tests previos siguen andando porque `ownership` no participa en
--     has_project_access ni can_edit_project — sólo en el guard nuevo.
--   - Proyecto B queda 'externa' (default) — sirve para probar el guard.
--   - Tercer proyecto proj_c = propia, admin1 miembro, para probar el
--     cross-project consistency check (student de A + cohort de C).
-- ═══════════════════════════════════════════════════════════════════════════
reset role;
update public.projects
   set ownership = 'propia'
 where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

insert into public.projects (id, name, ownership) values
  ('77777777-7777-7777-7777-777777777777', 'Proyecto C (propia)', 'propia')
on conflict (id) do nothing;

insert into public.project_members (project_id, user_id) values
  ('77777777-7777-7777-7777-777777777777','22222222-2222-2222-2222-222222222222')
on conflict do nothing;

-- Producto "Sin categoría" para proj_c (mismo patrón que A y B).
insert into public.products (project_id, name) values
  ('77777777-7777-7777-7777-777777777777', 'Sin categoría')
on conflict (project_id, name) do nothing;

-- 136) admin1 inserta student en Proyecto A (ahora propia) → OK
select pg_temp.login_as('22222222-2222-2222-2222-222222222222');
insert into _smoke_results(result) values (lives_ok(
  format(
    'insert into public.students (project_id, name) values (%L, %L)',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'Alumno A uno'
  ),
  'academia: admin inserta student en proyecto propia (A)'
));

-- 137) superadmin intenta insertar student en Proyecto B (externa) → FAIL
--      con 23514 (guard_propia_project). Se prueba con superadmin porque
--      admin1 no es miembro de B y sería rechazado antes por RLS (42501,
--      otro path). El guard debe pinchar independiente del permiso.
select pg_temp.login_as('11111111-1111-1111-1111-111111111111');
insert into _smoke_results(result) values (pg_temp.throws_ok(
  format(
    'insert into public.students (project_id, name) values (%L, %L)',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    'Alumno prohibido en externa'
  ),
  '23514'::text, null::text,
  'academia: guard bloquea student en project externa (23514)'::text
));

-- 138) cliente_role SELECT students → 42501 (sin grant). Frontera pre-RLS
--      igual que team_members / commission_rules / etc. El portal de
--      alumno es otro bloque futuro; por ahora academia está cerrada al
--      cliente_role.
select pg_temp.login_as('33333333-3333-3333-3333-333333333333');
insert into _smoke_results(result) values (pg_temp.throws_ok(
  format('select 1 from public.students where project_id = %L',
         'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  '42501'::text, null::text,
  'academia: cliente_role NO accede a students (no grant)'::text
));

-- 139) admin1 inserta course sobre el product "Sin categoría" de A → OK.
--      El trigger before_denorm_project_id_from_product copia project_id
--      desde products, y guard_propia_project lo valida (A es propia).
select pg_temp.login_as('22222222-2222-2222-2222-222222222222');
insert into _smoke_results(result) values (lives_ok(
  $sql$insert into public.courses (product_id, project_id)
       select id, project_id from public.products
        where project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
          and name = 'Sin categoría'$sql$,
  'academia: admin inserta course sobre product de proyecto propia'
));

-- 140) admin1 inserta cohort en A → OK
insert into _smoke_results(result) values (lives_ok(
  format(
    'insert into public.cohorts (project_id, name) values (%L, %L)',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'Cohorte A #1'
  ),
  'academia: admin inserta cohort en proyecto propia'
));

-- 141) admin1 inserta enrollment (student A + cohort A) → OK. El trigger
--      a_check_consistency deriva project_id desde cohort y valida que
--      coincida con el del student.
insert into _smoke_results(result) values (lives_ok(
  $sql$insert into public.enrollments (student_id, cohort_id, project_id)
       values (
         (select id from public.students where project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and name = 'Alumno A uno'),
         (select id from public.cohorts  where project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and name = 'Cohorte A #1'),
         'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
       )$sql$,
  'academia: enrollment consistente (student A + cohort A)'
));

-- 142) cross-project: cohort en proj_c (propia), student de A. Enrollment
--      debe pinchar con 23514 (consistency check: student.project ≠
--      cohort.project). La cohort de C se seedea como postgres (bypass RLS)
--      porque acá probamos el trigger, no la policy.
reset role;
insert into public.cohorts (project_id, name) values
  ('77777777-7777-7777-7777-777777777777', 'Cohorte C #1');

select pg_temp.login_as('22222222-2222-2222-2222-222222222222');
insert into _smoke_results(result) values (pg_temp.throws_ok(
  $sql$insert into public.enrollments (student_id, cohort_id, project_id)
       values (
         (select id from public.students where project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and name = 'Alumno A uno'),
         (select id from public.cohorts  where project_id = '77777777-7777-7777-7777-777777777777' and name = 'Cohorte C #1'),
         'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
       )$sql$,
  '23514'::text, null::text,
  'academia: enrollment cross-project (student A + cohort C) rebota consistency 23514'::text
));

-- 143) guard_ownership_downgrade: superadmin intenta bajar A de propia a
--      externa con academia colgada (student + course + cohort +
--      enrollment). Debe fallar con 23514 y no dejar A en estado
--      inconsistente.
select pg_temp.login_as('11111111-1111-1111-1111-111111111111');
insert into _smoke_results(result) values (pg_temp.throws_ok(
  format(
    'update public.projects set ownership = %L where id = %L',
    'externa',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  ),
  '23514'::text, null::text,
  'academia: guard downgrade propia→externa con academia colgada rebota 23514'::text
));

-- 144) Contra-ejemplo del guard: proj_c es propia SIN academia (borramos
--      la cohort que creamos en 142). Bajar C a externa debe pasar. Es
--      la garantía de que el guard es dirigido — no bloquea todo cambio
--      de ownership, sólo el que dejaría academia huérfana.
reset role;
delete from public.cohorts where project_id = '77777777-7777-7777-7777-777777777777';

select pg_temp.login_as('11111111-1111-1111-1111-111111111111');
insert into _smoke_results(result) values (lives_ok(
  format(
    'update public.projects set ownership = %L where id = %L',
    'externa',
    '77777777-7777-7777-7777-777777777777'
  ),
  'academia: guard downgrade propia→externa SIN academia colgada pasa OK'
));

-- ── Tests del Bloque 3 (Kingrow · Clientes) — 0080-0084 ──────────────────
-- Frontera dura sobre las 5 tablas nuevas del módulo Clientes:
-- project_health, nps_responses, tickets, renewals, upsells. TODAS org-scope.
--
-- Recordatorio: en este módulo "cliente" = `project` gestionado (empresa),
-- NO cliente final del launch. Son datos internos de Kingrow (salud
-- comercial, NPS, tickets, renewals, upsells) que el `cliente_role` no
-- debe ver JAMÁS — es el racional de mantener las tablas org-scope y no
-- meterlas como columnas de `projects`.
--
-- Mismo patrón que Bloque 2 (tests 102-134):
--   - cliente_role rebota pre-RLS por falta de grant → 42501
--   - superadmin lee sin error (grant + policy OK)
--   - admin normal (no superadmin) tiene grant pero can_edit_organization
--     filtra a 0 filas

-- ═══════════ Bloque 3 · Grupo A: cliente_role NO accede (42501) ═══════════
select pg_temp.login_as('33333333-3333-3333-3333-333333333333');

-- 145) project_health
insert into _smoke_results(result) values (pg_temp.throws_ok(
  'select 1 from public.project_health'::text,
  '42501'::text, null::text,
  'cliente_role NO accede a project_health (salud comercial interna Kingrow)'::text
));

-- 146) nps_responses
insert into _smoke_results(result) values (pg_temp.throws_ok(
  'select 1 from public.nps_responses'::text,
  '42501'::text, null::text,
  'cliente_role NO accede a nps_responses (NPS a Kingrow)'::text
));

-- 147) tickets
insert into _smoke_results(result) values (pg_temp.throws_ok(
  'select 1 from public.tickets'::text,
  '42501'::text, null::text,
  'cliente_role NO accede a tickets (soporte interno Kingrow↔cliente)'::text
));

-- 148) renewals
insert into _smoke_results(result) values (pg_temp.throws_ok(
  'select 1 from public.renewals'::text,
  '42501'::text, null::text,
  'cliente_role NO accede a renewals (contrato periódico Kingrow)'::text
));

-- 149) upsells
insert into _smoke_results(result) values (pg_temp.throws_ok(
  'select 1 from public.upsells'::text,
  '42501'::text, null::text,
  'cliente_role NO accede a upsells (venta adicional Kingrow)'::text
));

-- ═══════════ Bloque 3 · Grupo B: superadmin lee sin error ═════════════════
select pg_temp.login_as('11111111-1111-1111-1111-111111111111');

-- 150) project_health
insert into _smoke_results(result) values (lives_ok(
  'select 1 from public.project_health'::text,
  'superadmin lee project_health (path grant+policy OK)'
));

-- 151) nps_responses
insert into _smoke_results(result) values (lives_ok(
  'select 1 from public.nps_responses'::text,
  'superadmin lee nps_responses (path grant+policy OK)'
));

-- 152) tickets
insert into _smoke_results(result) values (lives_ok(
  'select 1 from public.tickets'::text,
  'superadmin lee tickets (path grant+policy OK)'
));

-- 153) renewals
insert into _smoke_results(result) values (lives_ok(
  'select 1 from public.renewals'::text,
  'superadmin lee renewals (path grant+policy OK)'
));

-- 154) upsells
insert into _smoke_results(result) values (lives_ok(
  'select 1 from public.upsells'::text,
  'superadmin lee upsells (path grant+policy OK)'
));

-- ═══════════ Bloque 3 · Grupo C: admin normal filtrado por policy ═════════
-- Mismo criterio que Grupo C de Bloque 2 (tests 124-134): grant existe
-- (authenticated tiene SELECT), pero can_edit_organization() =
-- is_kingrow_admin() = is_superadmin(); admin1 es 'admin', no 'superadmin'
-- → policy filtra a 0 filas.
select pg_temp.login_as('22222222-2222-2222-2222-222222222222');

-- 155) project_health
insert into _smoke_results(result) values (is_empty(
  'select 1 from public.project_health'::text,
  'admin normal NO ve project_health (policy org-scope filtra)'
));

-- 156) nps_responses
insert into _smoke_results(result) values (is_empty(
  'select 1 from public.nps_responses'::text,
  'admin normal NO ve nps_responses (policy org-scope filtra)'
));

-- 157) tickets
insert into _smoke_results(result) values (is_empty(
  'select 1 from public.tickets'::text,
  'admin normal NO ve tickets (policy org-scope filtra)'
));

-- 158) renewals
insert into _smoke_results(result) values (is_empty(
  'select 1 from public.renewals'::text,
  'admin normal NO ve renewals (policy org-scope filtra)'
));

-- 159) upsells
insert into _smoke_results(result) values (is_empty(
  'select 1 from public.upsells'::text,
  'admin normal NO ve upsells (policy org-scope filtra)'
));

-- ── Tests del Bloque 5 (Kingrow · Operaciones) — 0090-0096 ────────────────
-- Frontera dura sobre las 9 tablas org-scope nuevas del módulo Operaciones
-- (internal_projects, teams, team_membership, tasks, checklists,
--  checklist_items, processes, blockers, time_entries).
-- Mismo patrón que Bloque 2 (tests 102-134):
--   - cliente_role rebota pre-RLS por falta de grant → 42501
--   - superadmin lee sin error (grant + policy OK)
--   - admin normal (no superadmin) tiene grant pero can_edit_organization
--     filtra a 0 filas
--
-- Recordatorio: "internal_projects" NO es "projects". Son 2 tablas distintas
-- en 2 niveles de tenancy distintos. Los tests confirman que la nueva no
-- se cruza con la vieja.

-- ═══════════ Bloque 5 · Grupo A: cliente_role NO accede (42501) ═══════════
select pg_temp.login_as('33333333-3333-3333-3333-333333333333');

-- 160) internal_projects
insert into _smoke_results(result) values (pg_temp.throws_ok(
  'select 1 from public.internal_projects'::text,
  '42501'::text, null::text,
  'cliente_role NO accede a internal_projects (proyectos internos de la agencia)'::text
));

-- 161) teams
insert into _smoke_results(result) values (pg_temp.throws_ok(
  'select 1 from public.teams'::text,
  '42501'::text, null::text,
  'cliente_role NO accede a teams (equipos internos)'::text
));

-- 162) team_membership
insert into _smoke_results(result) values (pg_temp.throws_ok(
  'select 1 from public.team_membership'::text,
  '42501'::text, null::text,
  'cliente_role NO accede a team_membership'::text
));

-- 163) tasks
insert into _smoke_results(result) values (pg_temp.throws_ok(
  'select 1 from public.tasks'::text,
  '42501'::text, null::text,
  'cliente_role NO accede a tasks (tareas internas)'::text
));

-- 164) checklists
insert into _smoke_results(result) values (pg_temp.throws_ok(
  'select 1 from public.checklists'::text,
  '42501'::text, null::text,
  'cliente_role NO accede a checklists'::text
));

-- 165) checklist_items
insert into _smoke_results(result) values (pg_temp.throws_ok(
  'select 1 from public.checklist_items'::text,
  '42501'::text, null::text,
  'cliente_role NO accede a checklist_items'::text
));

-- 166) processes
insert into _smoke_results(result) values (pg_temp.throws_ok(
  'select 1 from public.processes'::text,
  '42501'::text, null::text,
  'cliente_role NO accede a processes (SOPs internas)'::text
));

-- 167) blockers
insert into _smoke_results(result) values (pg_temp.throws_ok(
  'select 1 from public.blockers'::text,
  '42501'::text, null::text,
  'cliente_role NO accede a blockers'::text
));

-- 168) time_entries
insert into _smoke_results(result) values (pg_temp.throws_ok(
  'select 1 from public.time_entries'::text,
  '42501'::text, null::text,
  'cliente_role NO accede a time_entries (horas trabajadas)'::text
));

-- ═══════════ Bloque 5 · Grupo B: superadmin lee sin error ═════════════════
-- Prueba end-to-end del path grant+policy. Tablas vacías, pero el SELECT
-- completa — si el grant o la policy estuvieran mal, este bloque revienta.
select pg_temp.login_as('11111111-1111-1111-1111-111111111111');

-- 169) internal_projects
insert into _smoke_results(result) values (lives_ok(
  'select 1 from public.internal_projects'::text,
  'superadmin lee internal_projects (path grant+policy OK)'
));

-- 170) teams
insert into _smoke_results(result) values (lives_ok(
  'select 1 from public.teams'::text,
  'superadmin lee teams (path grant+policy OK)'
));

-- 171) team_membership
insert into _smoke_results(result) values (lives_ok(
  'select 1 from public.team_membership'::text,
  'superadmin lee team_membership (path grant+policy OK)'
));

-- 172) tasks
insert into _smoke_results(result) values (lives_ok(
  'select 1 from public.tasks'::text,
  'superadmin lee tasks (path grant+policy OK)'
));

-- 173) checklists
insert into _smoke_results(result) values (lives_ok(
  'select 1 from public.checklists'::text,
  'superadmin lee checklists (path grant+policy OK)'
));

-- 174) checklist_items
insert into _smoke_results(result) values (lives_ok(
  'select 1 from public.checklist_items'::text,
  'superadmin lee checklist_items (path grant+policy OK)'
));

-- 175) processes
insert into _smoke_results(result) values (lives_ok(
  'select 1 from public.processes'::text,
  'superadmin lee processes (path grant+policy OK)'
));

-- 176) blockers
insert into _smoke_results(result) values (lives_ok(
  'select 1 from public.blockers'::text,
  'superadmin lee blockers (path grant+policy OK)'
));

-- 177) time_entries
insert into _smoke_results(result) values (lives_ok(
  'select 1 from public.time_entries'::text,
  'superadmin lee time_entries (path grant+policy OK)'
));

-- ═══════════ Bloque 5 · Grupo C: admin normal filtrado por policy ═════════
-- Mismo criterio que Grupo C de Bloque 2 (tests 124-134): grant existe
-- (authenticated tiene SELECT), pero can_edit_organization() =
-- is_kingrow_admin() = is_superadmin(); admin1 es 'admin', no 'superadmin'
-- → policy filtra a 0 filas.
select pg_temp.login_as('22222222-2222-2222-2222-222222222222');

-- 178) internal_projects
insert into _smoke_results(result) values (is_empty(
  'select 1 from public.internal_projects'::text,
  'admin normal NO ve internal_projects (policy org-scope filtra)'
));

-- 179) teams
insert into _smoke_results(result) values (is_empty(
  'select 1 from public.teams'::text,
  'admin normal NO ve teams (policy org-scope filtra)'
));

-- 180) team_membership
insert into _smoke_results(result) values (is_empty(
  'select 1 from public.team_membership'::text,
  'admin normal NO ve team_membership (policy org-scope filtra)'
));

-- 181) tasks
insert into _smoke_results(result) values (is_empty(
  'select 1 from public.tasks'::text,
  'admin normal NO ve tasks (policy org-scope filtra)'
));

-- 182) checklists
insert into _smoke_results(result) values (is_empty(
  'select 1 from public.checklists'::text,
  'admin normal NO ve checklists (policy org-scope filtra)'
));

-- 183) checklist_items
insert into _smoke_results(result) values (is_empty(
  'select 1 from public.checklist_items'::text,
  'admin normal NO ve checklist_items (policy org-scope filtra)'
));

-- 184) processes
insert into _smoke_results(result) values (is_empty(
  'select 1 from public.processes'::text,
  'admin normal NO ve processes (policy org-scope filtra)'
));

-- 185) blockers
insert into _smoke_results(result) values (is_empty(
  'select 1 from public.blockers'::text,
  'admin normal NO ve blockers (policy org-scope filtra)'
));

-- 186) time_entries
insert into _smoke_results(result) values (is_empty(
  'select 1 from public.time_entries'::text,
  'admin normal NO ve time_entries (policy org-scope filtra)'
));

reset role;

insert into _smoke_results(result) select * from finish();

reset role;

-- =====================  RESULTADO FINAL  =====================
select n, result from _smoke_results order by n;

rollback;
