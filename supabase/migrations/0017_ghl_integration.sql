-- ╭──────────────────────────────────────────────────────────────────────────╮
-- │ Fase 3b — GoHighLevel (CRM): match + idempotencia                        │
-- │                                                                          │
-- │ GHL trae appointments (agenda) y conversations (WhatsApp). Cada evento   │
-- │ se matchea con un lead por phone_normalized; si no existe, se crea.     │
-- │                                                                          │
-- │ Idempotencia: opción (c) del plan — un solo `external_id` por lead. Si   │
-- │ surge la necesidad de soportar 1→N (varios eventos GHL en el mismo lead) │
-- │ sumamos una tabla `lead_external_refs` en una migración posterior.      │
-- │                                                                          │
-- │ Sin cambios de RLS — los policies de `leads` (0013) ya cubren todo lo   │
-- │ nuevo. El INSERT/UPDATE del sync corre con service-role (bypassa RLS),   │
-- │ igual que `launch_daily_ads` de Meta.                                   │
-- ╰──────────────────────────────────────────────────────────────────────────╯

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) leads.external_id — id del evento original en el provider externo.
--    Sirve para que el sync, corrido N veces, detecte "este appointment/
--    conversación ya generó lead y no haga otro".
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.leads
  add column if not exists external_id text;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) Extender CHECK de source para incluir 'whatsapp'. Cuando llega una
--    conversation de WA de un teléfono que no matchea ningún lead nuestro,
--    se crea con este source (origen real: WA).
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.leads
  drop constraint if exists leads_source_check;

alter table public.leads
  add constraint leads_source_check
  check (source in ('manual', 'import', 'meta', 'ghl', 'whatsapp', 'otro'));

-- ═══════════════════════════════════════════════════════════════════════════
-- 3) Unique parcial sobre (project_id, source, external_id).
--    Garantiza idempotencia: dos corridas del sync ven el mismo evento y la
--    segunda detecta el conflicto en vez de crear duplicado. La cláusula
--    WHERE excluye leads sin external_id (los manuales/import) para que
--    su unicidad no compita con esto.
-- ═══════════════════════════════════════════════════════════════════════════
create unique index if not exists leads_external_id_unique_idx
  on public.leads(project_id, source, external_id)
  where external_id is not null;
