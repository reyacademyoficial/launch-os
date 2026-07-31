-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Bloque 1 (Kingrow) — Bancos aditivos a nivel organización (Opción B)     │
-- │                                                                          │
-- │ DECISIÓN OPERATIVA (documentada al arrancar Bloque 1):                  │
-- │ NO se movieron banks/bank_movements a scope org completo. Se agrega     │
-- │ organization_id como columna aditiva (NOT NULL con default Kingrow +    │
-- │ backfill), pero se PRESERVA project_id y la RLS project-scope existente.│
-- │                                                                          │
-- │ Razón: la app tiene ~15 archivos que consumen la UI "bancos del         │
-- │ proyecto" (bancos/page, actions, components, lib/banks/*). Además los   │
-- │ clientes externos hoy tienen sus propios bancos configurados — un       │
-- │ backfill "todo a Kingrow" y RLS org-scope borraría esa distinción y     │
-- │ rompería la UX sin un rediseño previo.                                  │
-- │                                                                          │
-- │ Con esta migración queda desbloqueado:                                  │
-- │   - client_transfers.bank_movement_id (0056) puede FK-linkear a         │
-- │     cualquier bank_movement existente sin cambio de esquema.            │
-- │   - Reportes/queries org-wide pueden filtrar bank_movements por         │
-- │     organization_id sin joinear a banks.                                │
-- │                                                                          │
-- │ Diferido a bloque futuro (cuando exista el shell de Kingrow):           │
-- │   - Decidir qué bancos se muestran en "Bancos de Kingrow" (los de      │
-- │     projects ownership='propia'? un flag visible_at_org_level?).       │
-- │   - Eventualmente restringir RLS de banks a org-scope cuando la UX      │
-- │     esté redefinida.                                                   │
-- │                                                                          │
-- │ IMPACTO EN CÓDIGO EXISTENTE: cero. project_id y RLS quedan iguales.    │
-- │ Los inserts existentes siguen funcionando por el default a Kingrow.    │
-- ╰──────────────────────────────────────────────────────────────────────────╯

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) banks.organization_id — aditivo, con default a Kingrow
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.banks
  add column if not exists organization_id uuid
    references public.organization(id) on delete restrict;

update public.banks
   set organization_id = '00000000-0000-0000-0000-000000000001'
 where organization_id is null;

alter table public.banks
  alter column organization_id set default '00000000-0000-0000-0000-000000000001',
  alter column organization_id set not null;

create index if not exists banks_organization_idx
  on public.banks(organization_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) bank_movements.organization_id — aditivo, backfill desde el banco
--    (más principled que hardcodear a Kingrow: si mañana algún banco cambia
--    de org, la denormalización sigue coherente).
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.bank_movements
  add column if not exists organization_id uuid
    references public.organization(id) on delete restrict;

update public.bank_movements bm
   set organization_id = b.organization_id
  from public.banks b
 where bm.bank_id = b.id
   and bm.organization_id is null;

alter table public.bank_movements
  alter column organization_id set default '00000000-0000-0000-0000-000000000001',
  alter column organization_id set not null;

create index if not exists bank_movements_organization_idx
  on public.bank_movements(organization_id, occurred_at desc);

-- ═══════════════════════════════════════════════════════════════════════════
-- 3) RLS: NO se toca. banks y bank_movements siguen project-scope con
--    has_project_access / can_edit_project. La columna organization_id
--    queda disponible para queries pero no cambia quién ve qué.
--
-- Grants: NO se toca — sigue el patrón existente (authenticated only,
-- sin grant a cliente_role — se mantiene como estaba en 0044).
-- ═══════════════════════════════════════════════════════════════════════════
