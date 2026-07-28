-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Bloque 0 (Kingrow) — Helpers SECURITY DEFINER para nivel organización    │
-- │                                                                          │
-- │ Espejo del patrón de 0002/0010: `security definer + stable + set        │
-- │ search_path = public`. Cada helper es el ÚNICO lugar donde vive la       │
-- │ semántica de un permiso — todas las RLS policies lo llaman.              │
-- │                                                                          │
-- │ Estado hoy (Bloque 0):                                                   │
-- │   No existe todavía un rol Kingrow granular. `is_kingrow_admin()` es un  │
-- │   alias fino de `is_superadmin()` (que incluye 'superadmin' y 'dev'      │
-- │   desde 0034). El día que se agregue una tabla `organization_members`   │
-- │   con roles finos (p.ej. 'kingrow_admin', 'kingrow_finanzas'), se        │
-- │   refina el CUERPO de estos dos helpers y todos los callers heredan el   │
-- │   cambio sin tocar nada más. La firma de `can_edit_organization` ya      │
-- │   toma `p_organization_id` para que ese día no cambie tampoco.           │
-- ╰──────────────────────────────────────────────────────────────────────────╯

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) is_kingrow_admin() — global org-level admin check
--    Hoy: exactamente is_superadmin() ('superadmin' + 'dev' via 0034).
--    Refinable: agregar OR sobre organization_members con rol admin.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.is_kingrow_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select public.is_superadmin();
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) can_edit_organization(p_organization_id uuid) — WRITE permission org-scope
--    Hoy: mismo criterio que is_kingrow_admin() (no depende del id todavía).
--    El parámetro se acepta y se ignora a propósito: los callers ya escriben
--    la firma final y cuando se refine el cuerpo (organization_members) no
--    hay que tocar ninguna policy.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.can_edit_organization(p_organization_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  -- p_organization_id: reservado para el refinamiento futuro (rol granular
  -- por organización). Hoy la respuesta es global.
  select public.is_kingrow_admin();
$$;
