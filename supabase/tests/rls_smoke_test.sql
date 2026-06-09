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

insert into _smoke_results(result) select * from finish();

reset role;

-- =====================  RESULTADO FINAL  =====================
select n, result from _smoke_results order by n;

rollback;
