-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Fix pentest B4 — cerrar lectura cross-tenant de _backup_*                │
-- │                                                                          │
-- │ El pentest de Etapa 0 confirmó que las 3 tablas _backup_* (creadas por  │
-- │ 0101/0124/0134 como salvaguarda pre-migración) están expuestas vía      │
-- │ PostgREST a cualquier authenticated, sin RLS ni gate por org. Un admin  │
-- │ de Org B puede leer los backups de banks/team_members/payment_methods  │
-- │ de Org A entera (ver scripts/pentest/results/baseline_extra.md B4-cross)│
-- │                                                                          │
-- │ Superficie del fix                                                       │
-- │   Estas tablas son residuo operativo para revertir migraciones.         │
-- │   Solo debe leerlas service_role (Studio, backend con service key,      │
-- │   scripts/rollbacks/*.sql). Ningún src/ las usa (grep vacío al           │
-- │   2026-08-31), así que revocar el acceso a authenticated/anon no rompe │
-- │   funcionalidad de app.                                                 │
-- │                                                                          │
-- │ Estrategia — defensa en 2 capas                                          │
-- │   1) REVOKE ALL PRIVILEGES a `authenticated` y `anon` sobre las 3      │
-- │      tablas. PostgREST rechaza pre-RLS con 401/403 (permission denied). │
-- │   2) ENABLE ROW LEVEL SECURITY sin policies → implicit deny para       │
-- │      cualquier rol que se le añada GRANT en el futuro por error.       │
-- │                                                                          │
-- │ Efecto sobre rollbacks                                                  │
-- │   supabase/rollbacks/0101_rollback.sql (y análogos futuros) corren     │
-- │   como superuser desde Studio → bypass total. No los toca.             │
-- ╰──────────────────────────────────────────────────────────────────────────╯

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) REVOKE — cortar acceso vía PostgREST (authenticated, anon)
-- ═══════════════════════════════════════════════════════════════════════════
do $$
declare
  t text;
  tables text[] := array[
    '_backup_banks_project_id_0101',
    '_backup_team_members_project_id_0124',
    '_backup_payment_methods_project_id_0134'
  ];
begin
  foreach t in array tables loop
    if to_regclass('public.' || t) is not null then
      execute format('revoke all privileges on public.%I from authenticated', t);
      execute format('revoke all privileges on public.%I from anon',           t);
      execute format('alter table public.%I enable row level security',        t);
      -- no policies → deny total para authenticated/anon incluso si algún
      -- futuro grant vuelve a otorgar SELECT por error.
    end if;
  end loop;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) Verificación inline (opcional, se puede sacar antes de commitear)
--    Debe devolver 3 filas con has_select=false para authenticated.
-- ═══════════════════════════════════════════════════════════════════════════
select
  table_name,
  has_table_privilege('authenticated', 'public.' || table_name, 'SELECT') as auth_select,
  has_table_privilege('anon',          'public.' || table_name, 'SELECT') as anon_select,
  (select relrowsecurity from pg_class
     where oid = ('public.' || table_name)::regclass) as rls_enabled
from (values
  ('_backup_banks_project_id_0101'),
  ('_backup_team_members_project_id_0124'),
  ('_backup_payment_methods_project_id_0134')
) as t(table_name);
-- Esperado: auth_select=false, anon_select=false, rls_enabled=true en las 3.
