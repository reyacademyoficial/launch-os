-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Bloque 0 (Kingrow) — Frontera de seguridad del NIVEL ORGANIZACIÓN        │
-- │                                                                          │
-- │ El rol `cliente` (Portal del cliente) JAMÁS debe poder leer datos de     │
-- │ nivel organización. Como todavía no existe ninguna tabla de nivel org    │
-- │ (salvo `organization` misma), esta migración cumple dos cosas:           │
-- │                                                                          │
-- │  A) Aplica la frontera SOBRE `organization` (única tabla org existente): │
-- │       - REVOKE ALL from cliente_role (defense-in-depth: cliente_role fue │
-- │         creado en 0023 con NOINHERIT y sin default grants, así que hoy   │
-- │         no tendría acceso; el revoke explícito blinda ante cambios       │
-- │         futuros del bootstrap de Supabase — ver                          │
-- │         feedback_supabase_default_privileges).                           │
-- │       - GRANT r/w a `authenticated` para que admins/superadmin lleguen a │
-- │         la RLS.                                                          │
-- │       - Policies que usan `can_edit_organization` / `is_kingrow_admin`,  │
-- │         restringidas `to authenticated`. Ninguna se amplía a             │
-- │         `cliente_role`.                                                  │
-- │                                                                          │
-- │  B) Documenta la REGLA DURA (convención para todo el bloque Kingrow y    │
-- │     lo que sigue). Este comentario es la fuente de verdad para futuras   │
-- │     migraciones — pegar la plantilla de abajo en cada tabla nueva de     │
-- │     nivel org. NO desviarse.                                             │
-- │                                                                          │
-- │ ═══════════════════════════════════════════════════════════════════════  │
-- │ REGLA DURA — TABLAS DE NIVEL ORGANIZACIÓN                                │
-- │ ═══════════════════════════════════════════════════════════════════════  │
-- │                                                                          │
-- │  1. RLS habilitada desde la creación (`alter table ... enable rls`).    │
-- │  2. NINGÚN GRANT a `cliente_role`. Ni tabla, ni columna, ni ejecución.  │
-- │     `revoke all on <tabla> from cliente_role` explícito como defensa.   │
-- │  3. Policies que usan `can_edit_organization(org_id)` o                 │
-- │     `is_kingrow_admin()`. NUNCA `has_project_access` / `can_edit_project`│
-- │     ni ninguna variante project-scope: es OTRO nivel de tenancy.        │
-- │  4. Policies restringidas `to authenticated`. NO ampliar a               │
-- │     `authenticated, cliente_role` (patrón de 0023) — el cliente rebota   │
-- │     pre-RLS por falta de grant y esa es la barrera dura.                │
-- │  5. NO agregar la tabla al listado de grants de 0023.                   │
-- │                                                                          │
-- │ TEMPLATE — copiar en cada migración que cree una tabla de nivel org:    │
-- │                                                                          │
-- │   create table if not exists public.<tabla_org> (                       │
-- │     ...                                                                 │
-- │     organization_id uuid not null references public.organization(id),   │
-- │     ...                                                                 │
-- │   );                                                                    │
-- │   alter table public.<tabla_org> enable row level security;             │
-- │                                                                          │
-- │   revoke all on public.<tabla_org> from public;                         │
-- │   revoke all on public.<tabla_org> from cliente_role;                   │
-- │   grant select, insert, update, delete                                  │
-- │     on public.<tabla_org> to authenticated;                             │
-- │                                                                          │
-- │   drop policy if exists <tabla>_select on public.<tabla_org>;           │
-- │   create policy <tabla>_select on public.<tabla_org>                    │
-- │     for select to authenticated                                         │
-- │     using (public.can_edit_organization(organization_id));              │
-- │   -- (I/U/D análogas con `can_edit_organization`;                       │
-- │   --  usar `is_kingrow_admin()` sólo si la tabla no tiene org_id, como  │
-- │   --  es el caso de `organization` mismo — ver policies de abajo)       │
-- ╰──────────────────────────────────────────────────────────────────────────╯

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) Frontera pre-RLS sobre `organization`
--    cliente_role fue creado en 0023 con NOINHERIT y sólo tiene grants
--    explícitos sobre las tablas listadas ahí. `organization` no está en esa
--    lista, así que hoy no tiene acceso. El REVOKE ALL es defensa en
--    profundidad ante:
--      - cambios futuros en el bootstrap de Supabase.
--      - un `grant ... to public` accidental en migraciones futuras.
--      - un default privilege que alguien setee sin darse cuenta.
-- ═══════════════════════════════════════════════════════════════════════════
revoke all on public.organization from public;
revoke all on public.organization from cliente_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) Grants a `authenticated` — admins/superadmin llegan hasta RLS
--    (postgres/service_role usan bypass y no dependen de esto)
-- ═══════════════════════════════════════════════════════════════════════════
grant select, insert, update, delete on public.organization to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3) Policies sobre `organization`
--    - SELECT: lo lee cualquier admin de Kingrow (hoy = superadmin).
--    - I/U/D:  igual (crear/renombrar/borrar orgs es admin-only).
--    Usamos `is_kingrow_admin()` (no `can_edit_organization`) porque la
--    tabla ES la organización — el `id` del row Y `p_organization_id` son
--    la misma cosa, pero conceptualmente lo que chequeamos acá es "sos
--    admin del nivel org" (global), no "podés editar ESTA org".
-- ═══════════════════════════════════════════════════════════════════════════
drop policy if exists organization_select on public.organization;
create policy organization_select on public.organization
  for select to authenticated
  using (public.is_kingrow_admin());

drop policy if exists organization_insert on public.organization;
create policy organization_insert on public.organization
  for insert to authenticated
  with check (public.is_kingrow_admin());

drop policy if exists organization_update on public.organization;
create policy organization_update on public.organization
  for update to authenticated
  using      (public.is_kingrow_admin())
  with check (public.is_kingrow_admin());

drop policy if exists organization_delete on public.organization;
create policy organization_delete on public.organization
  for delete to authenticated
  using (public.is_kingrow_admin());
