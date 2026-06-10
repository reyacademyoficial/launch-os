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

set local search_path = extensions, public, pg_temp;

-- Helper: "loguearse" como un usuario autenticado (rol + claim sub del JWT)
create or replace function pg_temp.login_as(p_uid uuid)
returns void language plpgsql as $$
begin
  execute 'set local role authenticated';
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated')::text,
    true
  );
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

-- =====================  SEED (como postgres / owner)  =====================
-- UUIDs fijos para legibilidad
--   super:    11111111-... (superadmin, acceso global)
--   admin1:   22222222-... (admin, miembro de Proyecto A)
--   cliente1: 33333333-... (cliente, miembro de Proyecto A)
--   operador: 44444444-... (operador, miembro de Proyecto A)
--   analista: 55555555-... (analista, miembro de Proyecto A)
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
   'authenticated','authenticated','analista@test.local','', now(), now(), now(),
   '{}'::jsonb, '{"full_name":"Analista Uno"}'::jsonb)
on conflict (id) do nothing;

insert into public.profiles (id, full_name, role) values
  ('11111111-1111-1111-1111-111111111111','Super','superadmin'),
  ('22222222-2222-2222-2222-222222222222','Admin Uno','admin'),
  ('33333333-3333-3333-3333-333333333333','Cliente Uno','cliente'),
  ('44444444-4444-4444-4444-444444444444','Operador Uno','operador'),
  ('55555555-5555-5555-5555-555555555555','Analista Uno','analista')
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

-- =====================  TESTS  =====================
--
-- Semántica:
-- - INSERT bloqueado por WITH CHECK → 42501 (throws_ok).
-- - UPDATE/DELETE bloqueado por USING → fila se filtra silencioso, 0 filas.
--   Lo testeamos con `is_empty(WITH ... RETURNING 1)`.
--
insert into _smoke_results(result) values (plan(29));

-- 1) cliente NO puede insertar launches (WITH CHECK falla) → 42501
select pg_temp.login_as('33333333-3333-3333-3333-333333333333');
insert into _smoke_results(result) values (throws_ok(
  format('insert into public.launches (project_id, name) values (%L, %L)',
         'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Launch del cliente'),
  '42501', null,
  'cliente NO puede insertar launches'
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

-- 11) operador NO puede crear launches (WITH CHECK falla) → 42501
insert into _smoke_results(result) values (throws_ok(
  format('insert into public.launches (project_id, name) values (%L, %L)',
         'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'launch del operador'),
  '42501', null,
  'operador NO puede crear launches'
));

-- 12) operador NO puede borrar launches (USING filtra → 0 filas)
insert into _smoke_results(result) values (is_empty(
  format(
    'with d as (delete from public.launches where id = %L returning 1) select * from d',
    'cccccccc-cccc-cccc-cccc-cccccccccccc'
  ),
  'operador NO borra launches'
));

-- 13) analista LEE launches de su proyecto
select pg_temp.login_as('55555555-5555-5555-5555-555555555555');
insert into _smoke_results(result) values (isnt_empty(
  format('select 1 from public.launches where project_id = %L',
         'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  'analista SÍ lee launches de su proyecto'
));

-- 14) analista NO escribe launches (USING filtra UPDATE → 0 filas)
insert into _smoke_results(result) values (is_empty(
  format(
    'with u as (update public.launches set name = ''hack'' where id = %L returning 1) select * from u',
    'cccccccc-cccc-cccc-cccc-cccccccccccc'
  ),
  'analista NO edita launches'
));

-- 15) cliente NO escribe launches (USING filtra UPDATE → 0 filas)
select pg_temp.login_as('33333333-3333-3333-3333-333333333333');
insert into _smoke_results(result) values (is_empty(
  format(
    'with u as (update public.launches set name = ''cliente edit'' where id = %L returning 1) select * from u',
    'cccccccc-cccc-cccc-cccc-cccccccccccc'
  ),
  'cliente NO edita launches'
));

-- ── Tests del calendario (post-0011) ─────────────────────────────────────
-- Validan que las columnas GENERATED `date_start` y `date_end` reproducen
-- el ejemplo numérico del roadmap exactamente: launch_date = 2026-07-10
-- con defaults 21/14/5/3 → date_start = 2026-06-19, date_end = 2026-07-20.

-- Insertamos un launch dedicado con la fecha del ejemplo. RLS está activa
-- (estamos como cliente todavía del test 15) así que volvemos a superadmin
-- por la operación de seed y los queries de lectura.
select pg_temp.login_as('11111111-1111-1111-1111-111111111111');

insert into public.launches (id, project_id, name, launch_date) values
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'Launch ejemplo roadmap',
   '2026-07-10')
on conflict (id) do nothing;

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

-- 19) cliente NO ve launch_secrets (blindada — RLS sin policies)
insert into _smoke_results(result) values (is_empty(
  format('select 1 from public.launch_secrets where launch_id = %L',
         'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  'launch_secrets blindada — cliente ve 0 filas'
));

-- 20) cliente NO puede insertar en launch_daily_ads (sin policy de write)
insert into _smoke_results(result) values (throws_ok(
  format(
    'insert into public.launch_daily_ads (launch_id, date, provider, leads) values (%L, ''2026-07-11'', ''meta'', 99)',
    'cccccccc-cccc-cccc-cccc-cccccccccccc'
  ),
  '42501', null,
  'launch_daily_ads INSERT blindado para authenticated'
));

-- 21) cliente lee integration_runs de su proyecto → ✅
insert into _smoke_results(result) values (isnt_empty(
  format('select 1 from public.integration_runs where launch_id = %L',
         'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  'cliente lee integration_runs de su proyecto'
));

-- ── Tests de CRM (post-0013): team_members + leads ────────────────────────
-- Validan project-scope sobre las 2 tablas nuevas:
--   - team_members  → read miembro, write admin+operador, NO analista/cliente
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

-- 24) analista NO inserta team_members (gate = can_edit_launches_in)
select pg_temp.login_as('55555555-5555-5555-5555-555555555555');
insert into _smoke_results(result) values (throws_ok(
  format(
    'insert into public.team_members (project_id, name, role) values (%L, %L, %L)',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Hack', 'setter'
  ),
  '42501', null,
  'analista NO inserta team_members'
));

-- 25) cliente NO inserta team_members
select pg_temp.login_as('33333333-3333-3333-3333-333333333333');
insert into _smoke_results(result) values (throws_ok(
  format(
    'insert into public.team_members (project_id, name, role) values (%L, %L, %L)',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Hack cliente', 'setter'
  ),
  '42501', null,
  'cliente NO inserta team_members'
));

-- 26) cliente SÍ lee team_members de su proyecto (los 2 insertados arriba)
insert into _smoke_results(result) values (is(
  (select count(*)::int
     from public.team_members
    where project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  2,
  'cliente ve los 2 team_members de su proyecto'
));

-- 27) cliente NO ve team_members de proyecto ajeno (Proyecto B vacío igual,
--     pero seedeamos uno con postgres para validar el cross-tenant filter)
reset role;
insert into public.team_members (project_id, name, role) values
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Cross-tenant setter', 'setter');

select pg_temp.login_as('33333333-3333-3333-3333-333333333333');
insert into _smoke_results(result) values (is_empty(
  format('select 1 from public.team_members where project_id = %L',
         'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  'cliente NO ve team_members de proyecto ajeno'
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

-- 29) analista NO edita leads (USING filtra UPDATE → 0 filas)
select pg_temp.login_as('55555555-5555-5555-5555-555555555555');
insert into _smoke_results(result) values (is_empty(
  format(
    'with u as (update public.leads set status = ''cerrado'' where project_id = %L returning 1) select * from u',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  ),
  'analista NO edita leads (USING filtra)'
));

insert into _smoke_results(result) select * from finish();

reset role;

-- =====================  RESULTADO FINAL  =====================
select n, result from _smoke_results order by n;

rollback;
