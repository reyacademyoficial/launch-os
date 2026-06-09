-- supabase/tests/rls_smoke_test.sql
-- Smoke-test de RLS multi-tenant.
--
-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ CÓMO CORRERLO                                                            │
-- │                                                                          │
-- │ 1. Studio → SQL editor → pegar el ARCHIVO ENTERO en un solo query.      │
-- │ 2. APAGAR el toggle "Limit rows" (arriba a la derecha del editor).       │
-- │    Si lo dejás prendido, Studio agrega LIMIT 100 y rompe el script.      │
-- │ 3. Run. El resultado final es una tabla `n | result` con 15 filas.       │
-- │    Filas verdes empiezan con `ok …`; rojas con `not ok …` + diag.        │
-- │                                                                          │
-- │ Por qué la tabla en vez de pgTAP plano: Studio solo muestra el output    │
-- │ del último statement. Las 15 aserciones (cada una un SELECT) se          │
-- │ ejecutan pero no se ven. Las guardamos en una temp table y mostramos     │
-- │ todo al final.                                                           │
-- ╰──────────────────────────────────────────────────────────────────────────╯
begin;

create extension if not exists pgtap with schema extensions;

-- pgTAP queda en `extensions`; lo agregamos al search_path para llamar
-- plan/is_empty/throws_ok/etc. sin tener que prefijarlos cada vez.
set local search_path = extensions, public, pg_temp;

-- Helper: "loguearse" como un usuario autenticado (setea rol + claim sub del JWT)
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

-- Tabla temporal que captura el output de cada aserción. La SELECT final la
-- vuelca a Studio. Los tests insertan en esta tabla MIENTRAS están con
-- `set role authenticated` (por login_as), así que necesitamos grants
-- explícitos: la temp table queda owned por postgres y authenticated no
-- llega por defecto.
create temporary table _smoke_results (
  n      serial primary key,
  result text
) on commit drop;

grant insert, select on _smoke_results to authenticated;
grant usage on sequence _smoke_results_n_seq to authenticated;

-- =====================  SEED (como postgres / owner)  =====================
-- UUIDs fijos para legibilidad
--   super:    11111111-... (superadmin, acceso global)
--   admin1:   22222222-... (admin, asignado a Proyecto A)
--   cliente1: 33333333-... (cliente, asignado a Proyecto A + launch1)
--   operador: 44444444-... (operador, asignado a Proyecto A + launch1 can_edit=true)
--   analista: 55555555-... (analista, asignado a Proyecto A)
--   proj_a:   aaaaaaaa-...
--   proj_b:   bbbbbbbb-... (sin nadie asignado)
--   launch1:  cccccccc-... (proj_a) — cliente y operador asignados
--   launch2:  dddddddd-... (proj_a) — sin asignaciones de cliente/operador

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

insert into public.project_members (project_id, user_id) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','22222222-2222-2222-2222-222222222222'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','33333333-3333-3333-3333-333333333333'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','44444444-4444-4444-4444-444444444444'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','55555555-5555-5555-5555-555555555555')
on conflict do nothing;

insert into public.launches (id, project_id, name) values
  ('cccccccc-cccc-cccc-cccc-cccccccccccc','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Launch Asignado'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Launch No Asignado')
on conflict (id) do nothing;

insert into public.launch_assignments (launch_id, user_id, can_edit) values
  ('cccccccc-cccc-cccc-cccc-cccccccccccc','33333333-3333-3333-3333-333333333333', false),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc','44444444-4444-4444-4444-444444444444', true)
on conflict do nothing;

-- =====================  TESTS  =====================
insert into _smoke_results(result) values (plan(15));

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
  'admin SÍ ve su proyecto asignado'
));

-- 4) admin NO ve un proyecto que no tiene asignado
insert into _smoke_results(result) values (is_empty(
  format('select 1 from public.projects where id = %L',
         'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  'admin NO ve proyecto no asignado'
));

-- 5) superadmin ve los proyectos seedeados (no asume DB limpia: pueden haber
--    proyectos reales en paralelo del uso productivo; el test filtra por los
--    UUIDs del seed).
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

-- 6) project_secrets es inaccesible desde el rol authenticated
select pg_temp.login_as('22222222-2222-2222-2222-222222222222');
insert into _smoke_results(result) values (is_empty(
  'select 1 from public.project_secrets',
  'project_secrets inaccesible para authenticated (tabla blindada)'
));

-- 7) cliente SÍ puede leer launches asignados (launch1 está en assignments)
select pg_temp.login_as('33333333-3333-3333-3333-333333333333');
insert into _smoke_results(result) values (isnt_empty(
  format('select 1 from public.launches where id = %L',
         'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  'cliente SÍ puede leer launches asignados'
));

-- 8) cliente NO ve un proyecto ajeno
insert into _smoke_results(result) values (is_empty(
  format('select 1 from public.projects where id = %L',
         'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  'cliente NO ve proyecto ajeno'
));

-- 9) operador EDITA launch asignado con can_edit=true → ✅
select pg_temp.login_as('44444444-4444-4444-4444-444444444444');
insert into _smoke_results(result) values (lives_ok(
  format('update public.launches set name = ''edit by operador'' where id = %L',
         'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  'operador SÍ edita launch asignado con can_edit=true'
));

-- 10) operador NO edita launch NO asignado (USING filtra → 0 filas)
insert into _smoke_results(result) values (is_empty(
  format(
    'with u as (update public.launches set name = ''leak'' where id = %L returning 1) select * from u',
    'dddddddd-dddd-dddd-dddd-dddddddddddd'
  ),
  'operador NO edita launch no asignado (0 filas afectadas)'
));

-- 11) operador NO puede crear launches (WITH CHECK falla) → 42501
insert into _smoke_results(result) values (throws_ok(
  format('insert into public.launches (project_id, name) values (%L, %L)',
         'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'launch del operador'),
  '42501', null,
  'operador NO puede crear launches'
));

-- 12) operador NO puede borrar launches (USING filtra → 0 filas), ni el asignado
insert into _smoke_results(result) values (is_empty(
  format(
    'with d as (delete from public.launches where id = %L returning 1) select * from d',
    'cccccccc-cccc-cccc-cccc-cccccccccccc'
  ),
  'operador NO borra launches (ni el asignado)'
));

-- 13) analista LEE launches de su proyecto (vía pertenencia, sin assignment)
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
  'analista NO edita launches (0 filas afectadas)'
));

-- 15) cliente NO ve un launch del mismo proyecto que NO le fue asignado
select pg_temp.login_as('33333333-3333-3333-3333-333333333333');
insert into _smoke_results(result) values (is_empty(
  format('select 1 from public.launches where id = %L',
         'dddddddd-dddd-dddd-dddd-dddddddddddd'),
  'cliente NO ve launches no asignados del mismo proyecto'
));

-- Cierre del plan de pgTAP (no aporta al resultado final pero deja la sesión limpia)
insert into _smoke_results(result) select * from finish();

-- Reset role para poder leer la temp table sin trabas RLS.
reset role;

-- =====================  RESULTADO FINAL  =====================
-- Studio muestra esta tabla. Filas con `ok …` pasaron, `not ok …` fallaron.
select n, result from _smoke_results order by n;

rollback;
