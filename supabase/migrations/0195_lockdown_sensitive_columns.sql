-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Pentest Etapa 2 — lockdown columnas sensibles (B2, B3)                   │
-- │                                                                          │
-- │ Root cause: 0166/0182 reemplazaron el `using` de las policies SELECT de  │
-- │ `organization_people` y `notion_workspaces` de `can_edit_organization()` │
-- │ (superadmin/dev) a `can_view_organization()` (CUALQUIER authenticated).  │
-- │ Ese cambio fue correcto para el resto de las columnas (necesarias para   │
-- │ que ops/coordinador vean nombres, mapeos, etc.) pero de paso expuso dos   │
-- │ columnas que el diseño original SÍ pensaba admin-only:                   │
-- │   - organization_people.monthly_salary / salary_currency (nómina)       │
-- │   - notion_workspaces.secret_token (integration token en claro)         │
-- │                                                                          │
-- │ RLS es row-level — no puede diferenciar columnas por rol. El fix real es │
-- │ GRANT/REVOKE column-level (PostgREST lo respeta: columnas sin SELECT      │
-- │ grant para el rol no aparecen ni se puede pedirlas con ?select=).         │
-- │                                                                          │
-- │ Las columnas quedan legibles SOLO vía función SECURITY DEFINER que        │
-- │ valida `is_kingrow_admin()` explícitamente adentro — no dependen de la    │
-- │ policy de la tabla. El código server-side (payroll UI, notion sync) ya   │
-- │ corre siempre detrás de `requireRole("superadmin")` a nivel Next.js, así │
-- │ que esto es defensa en profundidad sin romper ningún flujo legítimo.     │
-- ╰──────────────────────────────────────────────────────────────────────────╯

-- ═══════════════════════════════════════════════════════════════════════════
-- 0) can_view_payroll() — igual al gate de FinancieroLayout (superadmin +
--    admin + dev pueden VER el módulo Financiero/Nómina; escritura sigue
--    superadmin-only vía can_edit_organization/requireRole("superadmin")).
--    is_kingrow_admin() no alcanza acá porque excluye el rol 'admin' plano,
--    que sí tiene acceso de lectura a /financiero/nomina hoy.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.can_view_payroll()
returns boolean
language sql
security definer
stable
set search_path = public, pg_catalog
as $$
  select public.is_superadmin() or exists (
    select 1 from public.profiles where id = auth.uid() and role = 'admin'
  );
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) organization_people — revocar columnas de sueldo, exponer el resto
-- ═══════════════════════════════════════════════════════════════════════════
revoke select on public.organization_people from authenticated;
grant select (
  id, organization_id, full_name, national_id, email, phone, notes,
  active, created_at, updated_at
) on public.organization_people to authenticated;
-- INSERT/UPDATE/DELETE ya están gateados por can_edit_organization() (admin/dev
-- únicamente) desde 0058 — no hace falta tocar esos grants ni policies.

create or replace function public.get_person_salary(p_person_id uuid)
returns table (monthly_salary numeric, salary_currency text)
language plpgsql
security definer
stable
set search_path = public, pg_catalog
as $$
begin
  if not public.can_view_payroll() then
    raise exception 'access denied';
  end if;

  return query
    select op.monthly_salary, op.salary_currency
    from public.organization_people op
    where op.id = p_person_id;
end;
$$;

revoke all on function public.get_person_salary(uuid) from public;
grant execute on function public.get_person_salary(uuid) to authenticated;

-- Variante bulk para listados (nómina, personas): evita N+1 RPC calls.
create or replace function public.get_people_salaries(p_organization_id uuid)
returns table (id uuid, monthly_salary numeric, salary_currency text)
language plpgsql
security definer
stable
set search_path = public, pg_catalog
as $$
begin
  if not public.can_view_payroll() then
    raise exception 'access denied';
  end if;

  return query
    select op.id, op.monthly_salary, op.salary_currency
    from public.organization_people op
    where op.organization_id = p_organization_id;
end;
$$;

revoke all on function public.get_people_salaries(uuid) from public;
grant execute on function public.get_people_salaries(uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) notion_workspaces — revocar secret_token, exponer el resto
-- ═══════════════════════════════════════════════════════════════════════════
revoke select on public.notion_workspaces from authenticated;
grant select (
  id, organization_id, name, enabled, last_verified_at, last_verify_ok,
  created_at, updated_at
) on public.notion_workspaces to authenticated;

create or replace function public.get_notion_workspace_secret(p_workspace_id uuid)
returns text
language plpgsql
security definer
stable
set search_path = public, pg_catalog
as $$
declare
  v_token text;
begin
  if not public.is_kingrow_admin() then
    raise exception 'access denied';
  end if;

  select secret_token into v_token
  from public.notion_workspaces
  where id = p_workspace_id;

  return v_token;
end;
$$;

revoke all on function public.get_notion_workspace_secret(uuid) from public;
grant execute on function public.get_notion_workspace_secret(uuid) to authenticated;
