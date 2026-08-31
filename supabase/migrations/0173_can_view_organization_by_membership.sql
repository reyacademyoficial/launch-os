-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Fix — can_view_organization() ahora exige membresía real                 │
-- │                                                                          │
-- │ 0166 introdujo can_view_organization() como "todo authenticated ve todo" │
-- │ porque en ese momento existía una sola org (Kingrow, sembrada en 0050).  │
-- │ 0171 usó ese helper para abrir SELECT en la tabla `organization`.        │
-- │                                                                          │
-- │ El pentest (scripts/pentest/sql/01_seed_users_and_data.sql) rompe esa    │
-- │ premisa: siembra una segunda org "Pentest Org B" para probar leaks       │
-- │ cross-tenant. Con la policy actual, cualquier authenticated ve las 2    │
-- │ filas → src/lib/organization/current.ts tira el guardarraíl              │
-- │ "Detecté más de una organización visible para tu rol" y el app entero   │
-- │ deja de renderizar.                                                     │
-- │                                                                          │
-- │ FIX                                                                      │
-- │   Reemplazar el `select true` por una comprobación de membresía real:   │
-- │     - superadmin/dev (is_superadmin()) ve TODAS las orgs. Se necesita   │
-- │       para tooling, migraciones futuras y el momento en que multi-org   │
-- │       tenga selector.                                                   │
-- │     - Cualquier otro rol solo ve las orgs donde tiene evidencia de       │
-- │       pertenencia:                                                      │
-- │         * project_members(user_id) → projects.organization_id           │
-- │         * organization_people(auth_user_id) → organization_id            │
-- │                                                                          │
-- │ Efecto en el pentest: admin_a/oper_a/closer_a/cliente_a solo ven        │
-- │ Kingrow (son miembros de P1). admin_b solo ve Pentest Org B (miembro    │
-- │ de P2). Cross-tenant deja de ser un default silencioso a nivel RLS de  │
-- │ `organization`, lo que además ENDURECE el propio pentest — Org B ya no │
-- │ es visible para todos los authenticated, solo para quienes le pertenecen.│
-- │                                                                          │
-- │ Superadmin sigue viendo las 2 orgs. Cuando corre el pentest, después de │
-- │ recolectar evidencias tiene que correr 99_cleanup_pentest_org_b.sql para│
-- │ desbloquear el resolver del app. Documentado en ambos scripts.          │
-- │                                                                          │
-- │ WRITE sin cambios: insert/update/delete en las tablas org-scope siguen  │
-- │ gateados por can_edit_organization() = is_superadmin() (0051). Este fix │
-- │ solo toca la firma de LECTURA. cliente_role sigue rebotando pre-RLS     │
-- │ por revoke explícito (0023, 0052).                                     │
-- ╰──────────────────────────────────────────────────────────────────────────╯

create or replace function public.can_view_organization(p_organization_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select
    public.is_superadmin()
    or exists (
      select 1
        from public.project_members pm
        join public.projects pr on pr.id = pm.project_id
       where pm.user_id = auth.uid()
         and pr.organization_id = p_organization_id
    )
    or exists (
      select 1
        from public.organization_people op
       where op.auth_user_id = auth.uid()
         and op.organization_id = p_organization_id
    );
$$;
