-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Preflight checks para 0101_banks_org_scope                               │
-- │                                                                          │
-- │ Correr TODAS estas queries en Supabase Studio (SQL Editor) ANTES de     │
-- │ aplicar la migración 0101. Cada bloque tiene una interpretación:        │
-- │   - Si el resultado es el esperado → OK, seguir con la próxima.         │
-- │   - Si no → resolver el gap antes de aplicar la migración.              │
-- │                                                                          │
-- │ Se pueden correr una a una copiando cada bloque, o todas juntas — cada │
-- │ query devuelve un resultset independiente.                              │
-- ╰──────────────────────────────────────────────────────────────────────────╯

-- ═══════════════════════════════════════════════════════════════════════════
-- CHECK 1 — ¿Hay filas con organization_id NULL en banks o bank_movements?
-- ═══════════════════════════════════════════════════════════════════════════
-- Por qué importa: post-0101, RLS filtra por `can_edit_organization(organization_id)`.
-- Cualquier fila con organization_id NULL queda INVISIBLE para todos —
-- desaparece de la UI. La migración 0057 hizo `SET NOT NULL` con backfill
-- desde `banks.organization_id`, pero por si alguien insertó vía SQL directo
-- pasando por alto el default, verificamos.
--
-- INTERPRETACIÓN:
--   banks_null = 0 AND movements_null = 0  →  OK, proceder.
--   > 0 en alguno  →  filas huérfanas. Antes de la migración: UPDATE con
--                     el organization_id correcto (probable Kingrow:
--                     '00000000-0000-0000-0000-000000000001').

select
  (select count(*) from public.banks
    where organization_id is null) as banks_null_org,
  (select count(*) from public.bank_movements
    where organization_id is null) as movements_null_org;

-- ═══════════════════════════════════════════════════════════════════════════
-- CHECK 2 — ¿cliente_role hereda de authenticated?
-- ═══════════════════════════════════════════════════════════════════════════
-- Por qué importa: la migración hace
--   revoke all on public.banks from cliente_role;
--   grant select, insert, update, delete on public.banks to authenticated;
-- Si cliente_role hereda de authenticated (Supabase por default hace
-- `grant authenticated to cliente_role`), el revoke queda anulado por el
-- grant heredado. cliente_role terminaría con acceso a banks.
--
-- La consulta lee `pg_auth_members` para ver si hay una relación de
-- membresía cliente_role → authenticated.
--
-- INTERPRETACIÓN:
--   hereda = 0  →  OK, el revoke funciona.
--   hereda >= 1  →  cliente_role hereda de authenticated. Hay que blindar
--                   post-0101 con:
--                   revoke select, insert, update, delete
--                     on public.banks from cliente_role;
--                   (o rediseñar el patrón de grants).

select count(*) as cliente_hereda_de_authenticated
  from pg_auth_members am
  join pg_roles child  on child.oid  = am.member
  join pg_roles parent on parent.oid = am.roleid
 where child.rolname  = 'cliente_role'
   and parent.rolname = 'authenticated';

-- ═══════════════════════════════════════════════════════════════════════════
-- CHECK 3 — Nombre real del constraint UNIQUE que dropea 0101
-- ═══════════════════════════════════════════════════════════════════════════
-- Por qué importa: la migración hace
--   drop constraint if exists banks_project_id_name_key;
-- El nombre `banks_project_id_name_key` es la convención automática de
-- Postgres para `unique(project_id, name)` cuando la constraint se crea
-- sin nombre explícito. Si el schema original le puso otro nombre, o si
-- Supabase renombró algo, el DROP no hace nada (por el `IF EXISTS`) y
-- el UNIQUE queda vivo — lo que rompería el UNIQUE nuevo
-- por (organization_id, name) si aparecen colisiones cruzadas.
--
-- INTERPRETACIÓN:
--   Resultset con conname = 'banks_project_id_name_key'  →  OK, el DROP
--                                                             va a matchear.
--   conname distinto (ej. 'banks_name_project_id_uniq')  →  actualizar la
--     migración 0101 para que dropee el nombre correcto ANTES de aplicar.
--   Resultset vacío  →  no hay UNIQUE en banks. Extraño. Investigar.

select conname, pg_get_constraintdef(oid) as definition
  from pg_constraint
 where conrelid = 'public.banks'::regclass
   and contype  = 'u';
