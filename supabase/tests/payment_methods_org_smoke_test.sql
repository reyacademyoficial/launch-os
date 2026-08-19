-- supabase/tests/payment_methods_org_smoke_test.sql
-- Smoke-test específico para la migración 0134 (payment_methods org-scope).
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
-- │                                                                          │
-- │ CORRE POST-0134: si se corre antes de aplicar la migración, los tests   │
-- │ de schema/RLS fallan (organization_id no existe, unique viejo sigue).    │
-- │                                                                          │
-- │ Todo el smoke corre dentro de `begin … rollback`: NO deja residuos en   │
-- │ la DB. Los inserts a payment_methods / projects / auth.users se undo.   │
-- ╰──────────────────────────────────────────────────────────────────────────╯
begin;

create extension if not exists pgtap with schema extensions;

set local search_path = pg_temp, extensions, public;

-- ─── login_as (mismo helper que rls_smoke_test.sql) ─────────────────────────
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

-- ─── throws_ok wrapper (mismo motivo que rls_smoke_test) ────────────────────
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

-- ─── _smoke_results (mismo patrón) ──────────────────────────────────────────
create temporary table _smoke_results (
  n      serial primary key,
  result text
) on commit drop;

grant insert, select on _smoke_results to authenticated;
grant usage on sequence _smoke_results_n_seq to authenticated;
grant insert, select on _smoke_results to cliente_role;
grant usage on sequence _smoke_results_n_seq to cliente_role;
grant usage on schema extensions to cliente_role;

-- =====================  SEED  =====================
-- UUIDs fijos (no colisionan con rls_smoke_test porque acá corre en su propia
-- tx rolleable, y usamos el rango f… para no pisar el rango 1…5 del smoke
-- grande si algún día se ejecutan encadenados por error).
--   super:       f1111111-1111-1111-1111-111111111111
--   coordinador: f5555555-5555-5555-5555-555555555555
--   operador:    f4444444-4444-4444-4444-444444444444
--   cliente:     f3333333-3333-3333-3333-333333333333
--   proj_x:      fafafafa-afaf-afaf-afaf-afafafafafaf
--   bank_x:      fbfbfbfb-bfbf-bfbf-bfbf-bfbfbfbfbfbf
--
-- Reutilizamos la org existente (Kingrow, seed 0050). La resolvemos por
-- has_organization_access en el helper — cualquier proyecto de esa org sirve.

alter table public.profiles disable trigger guard_profile_role;

insert into auth.users (instance_id, id, aud, role, email,
                        encrypted_password, email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000000','f1111111-1111-1111-1111-111111111111',
   'authenticated','authenticated','super-pm@test.local','', now(), now(), now(),
   '{}'::jsonb, '{"full_name":"Super PM Test"}'::jsonb),
  ('00000000-0000-0000-0000-000000000000','f5555555-5555-5555-5555-555555555555',
   'authenticated','authenticated','coord-pm@test.local','', now(), now(), now(),
   '{}'::jsonb, '{"full_name":"Coord PM Test"}'::jsonb),
  ('00000000-0000-0000-0000-000000000000','f4444444-4444-4444-4444-444444444444',
   'authenticated','authenticated','oper-pm@test.local','', now(), now(), now(),
   '{}'::jsonb, '{"full_name":"Oper PM Test"}'::jsonb),
  ('00000000-0000-0000-0000-000000000000','f3333333-3333-3333-3333-333333333333',
   'authenticated','authenticated','cli-pm@test.local','', now(), now(), now(),
   '{}'::jsonb, '{"full_name":"Cliente PM Test"}'::jsonb)
on conflict (id) do nothing;

insert into public.profiles (id, full_name, role) values
  ('f1111111-1111-1111-1111-111111111111','Super PM Test','superadmin'),
  ('f5555555-5555-5555-5555-555555555555','Coord PM Test','coordinador'),
  ('f4444444-4444-4444-4444-444444444444','Oper PM Test','operador'),
  ('f3333333-3333-3333-3333-333333333333','Cliente PM Test','cliente')
on conflict (id) do update
  set role = excluded.role, full_name = excluded.full_name;

alter table public.profiles enable trigger guard_profile_role;

-- Proyecto ad-hoc dentro de la org de Kingrow (resuelta al vuelo). Si no hay
-- org sembrada, la migración 0050 no corrió — el test se aborta explícito.
do $$
declare
  v_org_id uuid;
begin
  select id into v_org_id from public.organization limit 1;
  if v_org_id is null then
    raise exception 'No hay organization seed (0050). Aplicá esa migración antes de correr este smoke.';
  end if;
  perform set_config('app.smoke_org_id', v_org_id::text, true);
end $$;

insert into public.projects (id, name, organization_id) values
  ('fafafafa-afaf-afaf-afaf-afafafafafaf', 'Proyecto PM Test',
   current_setting('app.smoke_org_id')::uuid)
on conflict (id) do nothing;

-- Coord/operador membership en el proyecto — habilita has_organization_access.
insert into public.project_members (project_id, user_id) values
  ('fafafafa-afaf-afaf-afaf-afafafafafaf','f5555555-5555-5555-5555-555555555555'),
  ('fafafafa-afaf-afaf-afaf-afafafafafaf','f4444444-4444-4444-4444-444444444444'),
  ('fafafafa-afaf-afaf-afaf-afafafafafaf','f3333333-3333-3333-3333-333333333333')
on conflict do nothing;

-- Banco ad-hoc para probar el bank_id link (0044 sigue vigente post-0134).
insert into public.banks (id, organization_id, project_id, name,
                          opening_balance, currency, active)
values ('fbfbfbfb-bfbf-bfbf-bfbf-bfbfbfbfbfbf',
        current_setting('app.smoke_org_id')::uuid,
        null,
        'PM Smoke Bank', 0, 'ARS', true)
on conflict (id) do nothing;

-- =====================  TESTS  =====================
insert into _smoke_results(result) values (plan(18));

-- ═══════════ Schema ═════════════════════════════════════════════════════════

-- 1) organization_id existe y es NOT NULL
insert into _smoke_results(result) values (is(
  (select is_nullable
     from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'payment_methods'
      and column_name  = 'organization_id'),
  'NO',
  '0134: payment_methods.organization_id existe y es NOT NULL'
));

-- 2) project_id ahora NULLABLE
insert into _smoke_results(result) values (is(
  (select is_nullable
     from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'payment_methods'
      and column_name  = 'project_id'),
  'YES',
  '0134: payment_methods.project_id pasó a NULLABLE'
));

-- 3) unique(project_id, name) DROPPED
insert into _smoke_results(result) values (is_empty(
  $$select 1 from pg_constraint
     where conname = 'payment_methods_project_id_name_key'
       and conrelid = 'public.payment_methods'::regclass$$,
  '0134: unique(project_id, name) fue dropeada'
));

-- 4) unique(organization_id, name) EXISTS
insert into _smoke_results(result) values (isnt_empty(
  $$select 1 from pg_constraint
     where conname = 'payment_methods_organization_id_name_key'
       and conrelid = 'public.payment_methods'::regclass$$,
  '0134: unique(organization_id, name) existe'
));

-- 5) RLS habilitada
insert into _smoke_results(result) values (ok(
  (select relrowsecurity
     from pg_class
    where oid = 'public.payment_methods'::regclass),
  '0134: RLS habilitada sobre payment_methods'
));

-- 6) cliente_role NO tiene privilegios sobre payment_methods
insert into _smoke_results(result) values (is_empty(
  $$select 1 from information_schema.role_table_grants
     where grantee    = 'cliente_role'
       and table_schema = 'public'
       and table_name   = 'payment_methods'$$,
  '0134: cliente_role no tiene grants sobre payment_methods'
));

-- 7) Todas las policies apuntan a helpers ORG (no project)
insert into _smoke_results(result) values (is(
  (select count(*)::int
     from pg_policies
    where schemaname = 'public'
      and tablename  = 'payment_methods'
      and (qual like '%has_organization_access%'
        or qual like '%can_edit_organization%'
        or with_check like '%can_edit_organization%')),
  4,
  '0134: 4 policies (S/I/U/D) referencian helpers org-scope'
));

-- ═══════════ Integridad de datos ═════════════════════════════════════════════

-- 8) No hay rows con organization_id null (backfill exitoso)
insert into _smoke_results(result) values (is(
  (select count(*)::int from public.payment_methods where organization_id is null),
  0,
  '0134: cero rows con organization_id null tras backfill'
));

-- 9) Tabla de backup existe (rescate ante rollback)
insert into _smoke_results(result) values (isnt_empty(
  $$select 1 from information_schema.tables
     where table_schema = 'public'
       and table_name   = '_backup_payment_methods_project_id_0134'$$,
  '0134: _backup_payment_methods_project_id_0134 existe'
));

-- ═══════════ Comportamiento — superadmin ═════════════════════════════════════

-- 10) superadmin SÍ inserta un método sin project_id (org-scope puro)
select pg_temp.login_as('f1111111-1111-1111-1111-111111111111');

insert into _smoke_results(result) values (lives_ok(
  format($sql$
    insert into public.payment_methods (organization_id, name, bank_id, currency, active)
    values (%L, %L, %L, null, true)
  $sql$, current_setting('app.smoke_org_id'),
        'Smoke PM Test',
        'fbfbfbfb-bfbf-bfbf-bfbf-bfbfbfbfbfbf'),
  'superadmin inserta payment_method sin project_id'
));

-- 11) unique (organization_id, name) bloquea duplicado
insert into _smoke_results(result) values (pg_temp.throws_ok(
  format($sql$
    insert into public.payment_methods (organization_id, name, bank_id, currency, active)
    values (%L, %L, null, 'ARS', true)
  $sql$, current_setting('app.smoke_org_id'), 'Smoke PM Test'),
  '23505'::text, null::text,
  'unique(organization_id, name) rechaza duplicado en la misma org'
));

-- 12) superadmin ve el método recién insertado
insert into _smoke_results(result) values (isnt_empty(
  $$select 1 from public.payment_methods where name = 'Smoke PM Test'$$,
  'superadmin ve el método que insertó'
));

-- ═══════════ Comportamiento — coordinador/operador ═══════════════════════════

-- 13) coordinador SÍ lee payment_methods (has_organization_access)
select pg_temp.login_as('f5555555-5555-5555-5555-555555555555');
insert into _smoke_results(result) values (isnt_empty(
  $$select 1 from public.payment_methods where name = 'Smoke PM Test'$$,
  'coordinador lee payment_methods (has_organization_access via project_members)'
));

-- 14) coordinador NO inserta payment_methods (can_edit_organization =
--     is_kingrow_admin = superadmin)
insert into _smoke_results(result) values (pg_temp.throws_ok(
  format($sql$
    insert into public.payment_methods (organization_id, name, currency, active)
    values (%L, %L, 'ARS', true)
  $sql$, current_setting('app.smoke_org_id'), 'Coord Intento'),
  '42501'::text, null::text,
  'coordinador NO inserta payment_methods (can_edit_organization gate)'
));

-- 15) operador SÍ lee payment_methods (mismo helper, es project_member)
select pg_temp.login_as('f4444444-4444-4444-4444-444444444444');
insert into _smoke_results(result) values (isnt_empty(
  $$select 1 from public.payment_methods where name = 'Smoke PM Test'$$,
  'operador lee payment_methods (has_organization_access via project_members)'
));

-- 16) operador NO inserta payment_methods (mismo gate write)
insert into _smoke_results(result) values (pg_temp.throws_ok(
  format($sql$
    insert into public.payment_methods (organization_id, name, currency, active)
    values (%L, %L, 'ARS', true)
  $sql$, current_setting('app.smoke_org_id'), 'Oper Intento'),
  '42501'::text, null::text,
  'operador NO inserta payment_methods (can_edit_organization gate)'
));

-- ═══════════ Comportamiento — cliente_role (blindaje) ════════════════════════

-- 17) cliente_role NO lee payment_methods (sin grant, PostgREST rebota antes
--     de la policy — defense-in-depth explícito post-0134).
select pg_temp.login_as('f3333333-3333-3333-3333-333333333333');
insert into _smoke_results(result) values (pg_temp.throws_ok(
  'select 1 from public.payment_methods'::text,
  '42501'::text, null::text,
  'cliente_role NO accede a payment_methods (no grant)'
));

-- ═══════════ Comentario deprecación ══════════════════════════════════════════

-- 18) comment on column payment_methods.project_id documenta deprecación
select pg_temp.login_as('f1111111-1111-1111-1111-111111111111');
insert into _smoke_results(result) values (ok(
  (select col_description('public.payment_methods'::regclass,
                          (select attnum
                             from pg_attribute
                            where attrelid = 'public.payment_methods'::regclass
                              and attname  = 'project_id'))
     like '%DEPRECATED (0134)%'),
  'payment_methods.project_id tiene comment de deprecación 0134'
));

reset role;

insert into _smoke_results(result) select * from finish();

reset role;

-- =====================  RESULTADO FINAL  =====================
select n, result from _smoke_results order by n;

rollback;
